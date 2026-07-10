// onResult（呼び出し側の onHeader/onTxHash）が例外を投げた場合に、
// collector プロセス全体を巻き込まず、この購読1本の異常として onError へ
// 転送されることを確認する回帰テスト（Issue #238）。
//
// 修正前の実装は、message ハンドラの中で onResult(result) を try/catch なし
// に呼んでいたため、onResult が例外を投げると ws ライブラリの "message"
// イベント発火の同期呼び出しスタックの中でその例外がそのまま伝播し、
// どこにも catch されないまま Node の uncaughtException としてプロセスを
// 落としていた（他の spec 実行中に collector が死に、以降のテストが
// カスケード失敗する事象の原因）。
//
// vitest のテストプロセス内で実際に uncaughtException を発生させると
// テストランナー自体を巻き込みかねないため、「例外が起きても外へ伝播せず
// onError 経由で捕捉される」ことを直接アサートする形で確認する
// （プロセス自体を落とさずに済んでいることの代替確認として、
// process の "uncaughtException" リスナー数が変化していないことも見る）。

import { WebSocket, WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createWsEthClient } from "./eth-ws-client.js";
import type { Subscription } from "./eth-ws-client.js";

/** reth の eth_subscribe エンドポイントを模した最小限の WebSocket サーバー。 */
class FakeNodeServer {
  private readonly wss: WebSocketServer;
  private connectionResolvers: ((ws: WebSocket) => void)[] = [];
  private readonly pendingConnections: WebSocket[] = [];

  constructor() {
    this.wss = new WebSocketServer({ port: 0 });
    this.wss.on("connection", (ws) => {
      const resolve = this.connectionResolvers.shift();
      if (resolve) resolve(ws);
      else this.pendingConnections.push(ws);
    });
  }

  ready(): Promise<void> {
    const addr = this.wss.address();
    if (addr !== null) return Promise.resolve();
    return new Promise((resolve) => this.wss.once("listening", resolve));
  }

  get port(): number {
    const addr = this.wss.address();
    if (addr === null || typeof addr === "string") {
      throw new Error("FakeNodeServer did not bind a port");
    }
    return addr.port;
  }

  nextConnection(): Promise<WebSocket> {
    const buffered = this.pendingConnections.shift();
    if (buffered) return Promise.resolve(buffered);
    return new Promise((resolve) => this.connectionResolvers.push(resolve));
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

/** 接続から届く次の JSON-RPC フレームを 1 つ待つ。 */
function nextJsonMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once("message", (data) => {
      resolve(JSON.parse(data.toString()) as Record<string, unknown>);
    });
  });
}

/** newHeads の eth_subscription 通知を 1 件送る。 */
function sendHeadNotification(ws: WebSocket, hash: string): void {
  ws.send(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_subscription",
      params: {
        subscription: "0x1",
        result: { hash, number: "0x10", parentHash: "0xdef", timestamp: "0x64" },
      },
    }),
  );
}

/** newPendingTransactions の eth_subscription 通知を 1 件送る。 */
function sendTxNotification(ws: WebSocket, hash: string): void {
  ws.send(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_subscription",
      params: { subscription: "0x2", result: hash },
    }),
  );
}

/** 指定ミリ秒だけ待つ。 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("createWsEthClient: onResult がコールバック内で例外を投げた場合の分離 (Issue #238)", () => {
  let server: FakeNodeServer | undefined;
  let subscription: Subscription | undefined;

  afterEach(async () => {
    subscription?.close();
    subscription = undefined;
    await server?.close();
    server = undefined;
  });

  it("onHeader が投げた例外はプロセスへ伝播せず onError に転送される", async () => {
    server = new FakeNodeServer();
    await server.ready();

    const errors: unknown[] = [];
    const uncaughtBefore = process.listenerCount("uncaughtException");
    const client = createWsEthClient({ reconnectDelayMs: 20 });
    subscription = client.subscribeNewHeads(
      `ws://127.0.0.1:${server.port}`,
      () => {
        throw new Error("onHeader が想定外に例外を投げた（テスト用）");
      },
      (err) => errors.push(err),
    );

    const conn = await server.nextConnection();
    await nextJsonMessage(conn);

    conn.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_subscription",
        params: {
          subscription: "0x1",
          result: {
            hash: "0xabc",
            number: "0x10",
            parentHash: "0xdef",
            timestamp: "0x64",
          },
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 60));

    // onHeader の例外が onError へ転送されている。
    expect(errors).toHaveLength(1);
    expect(String((errors[0] as Error).message)).toContain(
      "onHeader が想定外に例外を投げた",
    );
    // プロセスの uncaughtException ハンドラ集合には変化がない
    // （= installProcessSafetyNet の安全網まで例外が届いていない）。
    expect(process.listenerCount("uncaughtException")).toBe(uncaughtBefore);
  });

  it("onHeader の例外後も、次に届く正常な通知は引き続き処理される（購読自体は継続する）", async () => {
    server = new FakeNodeServer();
    await server.ready();

    const errors: unknown[] = [];
    const headers: unknown[] = [];
    let callCount = 0;
    const client = createWsEthClient({ reconnectDelayMs: 20 });
    subscription = client.subscribeNewHeads(
      `ws://127.0.0.1:${server.port}`,
      (header) => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error("1回目の通知の処理で例外（テスト用）");
        }
        headers.push(header);
      },
      (err) => errors.push(err),
    );

    const conn = await server.nextConnection();
    await nextJsonMessage(conn);

    const send = (hash: string) =>
      conn.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_subscription",
          params: {
            subscription: "0x1",
            result: { hash, number: "0x10", parentHash: "0xdef", timestamp: "0x64" },
          },
        }),
      );

    send("0xfirst");
    await new Promise((resolve) => setTimeout(resolve, 40));
    send("0xsecond");
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(errors).toHaveLength(1);
    expect(headers).toEqual([
      { hash: "0xsecond", number: "0x10", parentHash: "0xdef", timestamp: "0x64" },
    ]);
  });

  it("onTxHash が投げた例外も同様にプロセスへ伝播せず onError に転送される", async () => {
    server = new FakeNodeServer();
    await server.ready();

    const errors: unknown[] = [];
    const client = createWsEthClient({ reconnectDelayMs: 20 });
    subscription = client.subscribePendingTransactions(
      `ws://127.0.0.1:${server.port}`,
      () => {
        throw new Error("onTxHash が想定外に例外を投げた（テスト用）");
      },
      (err) => errors.push(err),
    );

    const conn = await server.nextConnection();
    await nextJsonMessage(conn);

    conn.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_subscription",
        params: { subscription: "0x2", result: "0xdeadbeef" },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(errors).toHaveLength(1);
    expect(String((errors[0] as Error).message)).toContain(
      "onTxHash が想定外に例外を投げた",
    );
  });

  it("onTxHash の例外後も、次に届く正常な通知は引き続き処理される（購読自体は継続する）", async () => {
    // onHeader 側と同じく onTxHash 側でも、1 回例外が起きた後の通知が
    // 正しく処理されること（購読が壊れないこと）を確認する。両コールバック
    // 境界が同じ subscribe() の try/catch で対称に守られていることの裏付け。
    server = new FakeNodeServer();
    await server.ready();

    const errors: unknown[] = [];
    const hashes: string[] = [];
    let callCount = 0;
    const client = createWsEthClient({ reconnectDelayMs: 20 });
    subscription = client.subscribePendingTransactions(
      `ws://127.0.0.1:${server.port}`,
      (hash) => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error("1回目の tx 通知の処理で例外（テスト用）");
        }
        hashes.push(hash);
      },
      (err) => errors.push(err),
    );

    const conn = await server.nextConnection();
    await nextJsonMessage(conn);

    sendTxNotification(conn, "0xfirst");
    await delay(40);
    sendTxNotification(conn, "0xsecond");
    await delay(40);

    expect(errors).toHaveLength(1);
    expect(hashes).toEqual(["0xsecond"]);
  });

  it("連続して複数回例外が起きても、そのたびに onError へ転送され購読は生き続ける", async () => {
    // 「1 回だけ耐えて 2 回目でクラッシュする」といった見落としが無いことを
    // 確認する。3 連続で例外を起こしてもすべて onError に届き、その後の
    // 正常な通知も処理できる。
    server = new FakeNodeServer();
    await server.ready();

    const errors: unknown[] = [];
    const headers: unknown[] = [];
    const uncaughtBefore = process.listenerCount("uncaughtException");
    let callCount = 0;
    const client = createWsEthClient({ reconnectDelayMs: 20 });
    subscription = client.subscribeNewHeads(
      `ws://127.0.0.1:${server.port}`,
      (header) => {
        callCount += 1;
        if (callCount <= 3) {
          throw new Error(`通知 ${callCount} 件目で例外（テスト用）`);
        }
        headers.push(header);
      },
      (err) => errors.push(err),
    );

    const conn = await server.nextConnection();
    await nextJsonMessage(conn);

    for (const hash of ["0xa", "0xb", "0xc", "0xd"]) {
      sendHeadNotification(conn, hash);
      await delay(30);
    }

    // 3 回すべての例外が onError に届いている（途中で握りつぶされていない）。
    expect(errors).toHaveLength(3);
    // 4 件目の正常な通知は処理されている（購読が壊れていない）。
    expect(headers).toEqual([
      { hash: "0xd", number: "0x10", parentHash: "0xdef", timestamp: "0x64" },
    ]);
    // プロセス全体の安全網まで例外は届いていない。
    expect(process.listenerCount("uncaughtException")).toBe(uncaughtBefore);
  });
});

describe("createWsEthClient: onResult が投げる値の種類による違い (Issue #238)", () => {
  let server: FakeNodeServer | undefined;
  let subscription: Subscription | undefined;

  afterEach(async () => {
    subscription?.close();
    subscription = undefined;
    await server?.close();
    server = undefined;
  });

  // Error インスタンス以外の値（文字列・null・undefined・数値・オブジェクト）を
  // throw しても、subscribe() の try/catch は `catch (err)` で何でも受けるため、
  // 投げられた値がそのまま（ラップされず）onError に転送され、かつプロセスは
  // 落ちないことを確認する。JS では throw できる値に型の制限が無く、実装の
  // どこかが Error 以外を投げる可能性があるため、境界として押さえておく。
  const nonErrorCases: { name: string; thrown: unknown }[] = [
    { name: "文字列", thrown: "plain string failure" },
    { name: "null", thrown: null },
    { name: "undefined", thrown: undefined },
    { name: "数値", thrown: 42 },
    { name: "プレーンオブジェクト", thrown: { code: "E_CUSTOM", detail: "boom" } },
  ];

  for (const { name, thrown } of nonErrorCases) {
    it(`onHeader が ${name} を throw しても、その値がそのまま onError に転送される`, async () => {
      server = new FakeNodeServer();
      await server.ready();

      const errors: unknown[] = [];
      const uncaughtBefore = process.listenerCount("uncaughtException");
      const client = createWsEthClient({ reconnectDelayMs: 20 });
      subscription = client.subscribeNewHeads(
        `ws://127.0.0.1:${server.port}`,
        () => {
          throw thrown;
        },
        (err) => errors.push(err),
      );

      const conn = await server.nextConnection();
      await nextJsonMessage(conn);
      sendHeadNotification(conn, "0xabc");
      await delay(60);

      // 投げられた値がラップ・変換されずそのまま届く（undefined を含む）。
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(thrown);
      // Error 以外を投げてもプロセスは落ちない。
      expect(process.listenerCount("uncaughtException")).toBe(uncaughtBefore);
    });
  }
});

describe("createWsEthClient: onResult が非同期に reject するコールバックの場合の境界 (Issue #238)", () => {
  let server: FakeNodeServer | undefined;
  let subscription: Subscription | undefined;

  afterEach(async () => {
    subscription?.close();
    subscription = undefined;
    await server?.close();
    server = undefined;
  });

  it("reject する Promise を返すコールバックは同期 try/catch の対象外で、unhandledRejection として表面化する（onError には転送されず uncaughtException にもならない）", async () => {
    // onHeader/onTxHash の型は `(result) => void`（同期）であり、subscribe() の
    // try/catch は onResult(...) の「同期的な throw」だけを捕捉する。コール
    // バックが async 関数で内部が reject した場合、その拒否は呼び出し後の
    // マイクロタスクで起きるため try/catch では捕まらず、onError には転送
    // されない。ただし collector の安全網（installProcessSafetyNet）では
    // unhandledRejection は「ログして生かし続ける」扱いであり、
    // uncaughtException（process.exit する側）には至らない。この非同期境界の
    // 挙動を回帰として固定する。
    //
    // vitest 本体の unhandledRejection リスナーに拾われてテストが失敗するのを
    // 避けるため、この試験の間だけ自前のリスナーへ差し替え、拒否理由を捕捉
    // してから元のリスナーを復元する。
    server = new FakeNodeServer();
    await server.ready();

    const errors: unknown[] = [];
    const uncaughtBefore = process.listenerCount("uncaughtException");
    const savedRejectionListeners = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    const rejections: unknown[] = [];
    const captureRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", captureRejection);

    try {
      const client = createWsEthClient({ reconnectDelayMs: 20 });
      subscription = client.subscribeNewHeads(
        `ws://127.0.0.1:${server.port}`,
        // async コールバックが reject する（内部の await 先が失敗する等を模す）。
        async () => {
          await Promise.resolve();
          throw new Error("非同期コールバックが reject（テスト用）");
        },
        (err) => errors.push(err),
      );

      const conn = await server.nextConnection();
      await nextJsonMessage(conn);
      sendHeadNotification(conn, "0xabc");
      await delay(60);

      // 同期の try/catch では捕まらないため onError には届かない。
      expect(errors).toEqual([]);
      // 代わりに unhandledRejection として表面化する。
      expect(rejections).toHaveLength(1);
      expect(String((rejections[0] as Error).message)).toContain(
        "非同期コールバックが reject",
      );
      // uncaughtException（process.exit する側）には至っていない。
      expect(process.listenerCount("uncaughtException")).toBe(uncaughtBefore);
    } finally {
      process.removeListener("unhandledRejection", captureRejection);
      for (const listener of savedRejectionListeners) {
        process.on(
          "unhandledRejection",
          listener as (reason: unknown) => void,
        );
      }
    }
  });
});

describe("createWsEthClient: onError 未指定時の onResult 例外のフォールバック (Issue #238)", () => {
  let server: FakeNodeServer | undefined;
  let subscription: Subscription | undefined;

  afterEach(async () => {
    subscription?.close();
    subscription = undefined;
    await server?.close();
    server = undefined;
  });

  it("onError を渡していなくても、onHeader の例外でプロセスは落ちず購読は継続する", async () => {
    // 実運用の呼び出し元（EthereumAdapter）は必ず onError（console.error への
    // ログ）を渡すが、subscribe() は onError を省略可能にしている。onError が
    // undefined の場合 `onError?.(err)` は何もしないため、例外は握りつぶされる
    // 形になる。ここで確認したい最重要の安全特性は「onError が無くても
    // uncaughtException でプロセス全体を巻き込まない」こと。あわせて、握り
    // つぶし後も購読が壊れず次の通知を処理できることを固定する。
    //
    // 注意（テスト強化担当メモ）: onError 未指定時に例外がログにも残らず
    // 静かに消える点は、CLAUDE.md の「エラーを握りつぶさない」方針からは
    // 望ましくない。ただし全ての実運用呼び出し元は onError を渡しており、
    // 本テストはあくまで安全特性（非クラッシュ・購読継続）の固定であって
    // 現状挙動の追認である。改善（onError 未指定時のフォールバックログ等）は
    // 実装担当への申し送りとする。
    server = new FakeNodeServer();
    await server.ready();

    const headers: unknown[] = [];
    const uncaughtBefore = process.listenerCount("uncaughtException");
    let callCount = 0;
    const client = createWsEthClient({ reconnectDelayMs: 20 });
    // onError を渡さない。
    subscription = client.subscribeNewHeads(
      `ws://127.0.0.1:${server.port}`,
      (header) => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error("onError 未指定でも落ちないことの確認（テスト用）");
        }
        headers.push(header);
      },
    );

    const conn = await server.nextConnection();
    await nextJsonMessage(conn);

    sendHeadNotification(conn, "0xfirst");
    await delay(40);
    sendHeadNotification(conn, "0xsecond");
    await delay(40);

    // プロセス全体の安全網まで例外は届いていない。
    expect(process.listenerCount("uncaughtException")).toBe(uncaughtBefore);
    // 握りつぶし後も購読は継続し、2 件目は正しく処理される。
    expect(headers).toEqual([
      { hash: "0xsecond", number: "0x10", parentHash: "0xdef", timestamp: "0x64" },
    ]);
  });
});
