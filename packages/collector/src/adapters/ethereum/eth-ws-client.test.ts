import { WebSocket, WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import type { NewHeadHeader, Subscription } from "./eth-ws-client.js";
import { createWsEthClient, parseSubscriptionResult } from "./eth-ws-client.js";

describe("parseSubscriptionResult", () => {
  it("extracts the header object from a newHeads notification", () => {
    const header = {
      hash: "0xabc",
      number: "0x10",
      parentHash: "0xpar",
      timestamp: "0x64",
    };
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_subscription",
      params: { subscription: "0x1", result: header },
    });
    expect(parseSubscriptionResult(raw)).toEqual(header);
  });

  it("extracts a tx hash string from a newPendingTransactions notification", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_subscription",
      params: { subscription: "0x2", result: "0xdeadbeef" },
    });
    expect(parseSubscriptionResult(raw)).toBe("0xdeadbeef");
  });

  it("ignores the eth_subscribe reply that carries the subscription id", () => {
    // 購読開始時の応答（{id, result: "0x1"}）は method を持たないので無視する。
    const raw = JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" });
    expect(parseSubscriptionResult(raw)).toBeUndefined();
  });

  it("ignores non-subscription methods", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_somethingElse",
      params: { result: "0xabc" },
    });
    expect(parseSubscriptionResult(raw)).toBeUndefined();
  });

  it("returns undefined for a notification without a result", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_subscription",
      params: { subscription: "0x1" },
    });
    expect(parseSubscriptionResult(raw)).toBeUndefined();
  });

  it("returns undefined for malformed JSON instead of throwing", () => {
    expect(parseSubscriptionResult("not json")).toBeUndefined();
  });

  it("preserves a falsy-but-present result such as an empty string", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_subscription",
      params: { subscription: "0x1", result: "" },
    });
    expect(parseSubscriptionResult(raw)).toBe("");
  });
});

/**
 * 値を push した順に取り出せる待ち行列。まだ push されていない値を next() で
 * 待つ場合は resolver を保持しておき push 時に解決する
 * （websocket-server.test.ts の TestClient と同じパターン）。
 */
class Recorder<T> {
  private readonly queue: T[] = [];
  private waiter?: (value: T) => void;

  push(value: T): void {
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = undefined;
      resolve(value);
    } else {
      this.queue.push(value);
    }
  }

  next(): Promise<T> {
    const buffered = this.queue.shift();
    if (buffered !== undefined) return Promise.resolve(buffered);
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }
}

/** reth の eth_subscribe エンドポイントを模した最小限の WebSocket サーバー。 */
class FakeNodeServer {
  private readonly wss: WebSocketServer;
  private readonly connections = new Recorder<WebSocket>();

  constructor() {
    this.wss = new WebSocketServer({ port: 0 });
    this.wss.on("connection", (ws) => this.connections.push(ws));
  }

  /** listen が完了して port が確定するまで待つ。 */
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

  /** 次に張られるクライアント接続を待つ（張られ済みならそれを返す）。 */
  nextConnection(): Promise<WebSocket> {
    return this.connections.next();
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

describe("createWsEthClient reconnect (Issue #135)", () => {
  let server: FakeNodeServer | undefined;
  let subscription: Subscription | undefined;

  afterEach(async () => {
    subscription?.close();
    subscription = undefined;
    await server?.close();
    server = undefined;
  });

  it("reconnects and re-subscribes with the same params after the server drops the connection, using the same onResult callback", async () => {
    server = new FakeNodeServer();
    await server.ready();

    const headers = new Recorder<NewHeadHeader>();
    const client = createWsEthClient({ reconnectDelayMs: 20 });
    subscription = client.subscribeNewHeads(
      `ws://127.0.0.1:${server.port}`,
      (header) => headers.push(header),
    );

    const firstConn = await server.nextConnection();
    const firstSubscribeMsg = await nextJsonMessage(firstConn);
    expect(firstSubscribeMsg.method).toBe("eth_subscribe");
    expect(firstSubscribeMsg.params).toEqual(["newHeads"]);

    // ノードコンテナが再作成された状況を模し、正常なクローズハンドシェイク
    // なしで接続を切断する。
    firstConn.terminate();

    // 再接続後、同じ subscribeParams で eth_subscribe をやり直すはず。
    const secondConn = await server.nextConnection();
    const secondSubscribeMsg = await nextJsonMessage(secondConn);
    expect(secondSubscribeMsg.method).toBe("eth_subscribe");
    expect(secondSubscribeMsg.params).toEqual(["newHeads"]);

    const header: NewHeadHeader = {
      hash: "0xabc",
      number: "0x11",
      parentHash: "0xdef",
      timestamp: "0x65",
    };
    secondConn.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_subscription",
        params: { subscription: "0x1", result: header },
      }),
    );

    // subscribeNewHeads に最初に渡した onHeader コールバックがそのまま
    // 呼ばれ、再接続後の通知も受け取れていることを確認する。
    await expect(headers.next()).resolves.toEqual(header);
  });

  it("does not attempt to reconnect after the caller explicitly closes the subscription", async () => {
    server = new FakeNodeServer();
    await server.ready();

    const client = createWsEthClient({ reconnectDelayMs: 20 });
    subscription = client.subscribeNewHeads(
      `ws://127.0.0.1:${server.port}`,
      () => {
        /* この試験では通知内容は見ない */
      },
    );

    const firstConn = await server.nextConnection();
    await nextJsonMessage(firstConn);

    // 呼び出し側が意図的に購読解除する（ノード側都合の切断ではない）。
    subscription.close();

    // reconnectDelayMs より十分長く待っても、新しい接続が張られないことを
    // 確認する（closedByCaller により再接続がスキップされる）。
    let reconnected = false;
    void server.nextConnection().then(() => {
      reconnected = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reconnected).toBe(false);
  });
});

describe("createWsEthClient reconnect edge cases (Issue #135)", () => {
  let server: FakeNodeServer | undefined;
  const openSubscriptions: Subscription[] = [];

  afterEach(async () => {
    for (const sub of openSubscriptions) sub.close();
    openSubscriptions.length = 0;
    await server?.close();
    server = undefined;
  });

  function track(sub: Subscription): Subscription {
    openSubscriptions.push(sub);
    return sub;
  }

  it("keeps retrying across consecutive drops (drop happens again before the resubscribe completes)", async () => {
    // 再接続で張り直した接続がすぐにまた切れる（例: コンテナがまだ安定して
    // いない）状況。無期限リトライにより、複数回の切断を跨いでも最終的に
    // 購読が復旧して通知を受け取れることを確認する。
    server = new FakeNodeServer();
    await server.ready();

    const headers = new Recorder<NewHeadHeader>();
    const client = createWsEthClient({ reconnectDelayMs: 20 });
    track(
      client.subscribeNewHeads(`ws://127.0.0.1:${server.port}`, (header) =>
        headers.push(header),
      ),
    );

    // 1 回目の接続 → 切断。
    const firstConn = await server.nextConnection();
    await nextJsonMessage(firstConn);
    firstConn.terminate();

    // 2 回目（再接続）→ resubscribe を確認する間もなく再度切断。
    const secondConn = await server.nextConnection();
    expect((await nextJsonMessage(secondConn)).params).toEqual(["newHeads"]);
    secondConn.terminate();

    // 3 回目（再々接続）→ ここで安定し、通知が届く。
    const thirdConn = await server.nextConnection();
    expect((await nextJsonMessage(thirdConn)).params).toEqual(["newHeads"]);

    const header: NewHeadHeader = {
      hash: "0xabc",
      number: "0x12",
      parentHash: "0xdef",
      timestamp: "0x66",
    };
    thirdConn.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_subscription",
        params: { subscription: "0x1", result: header },
      }),
    );
    await expect(headers.next()).resolves.toEqual(header);
  });

  it("cancels a pending reconnect when the caller closes during the backoff wait", async () => {
    // 切断された直後、再接続タイマーの待機中（バックオフ中）に呼び出し側が
    // close() したケース。保留中のタイマーがクリアされ、再接続が起きない
    // ことを確認する（close() 内の clearTimeout 分岐を通す）。
    server = new FakeNodeServer();
    await server.ready();

    // タイマーが確実に「セット済みだがまだ発火していない」状態で close()
    // できるよう、待機時間を長めにとる。
    const client = createWsEthClient({ reconnectDelayMs: 300 });
    const subscription = track(
      client.subscribeNewHeads(`ws://127.0.0.1:${server.port}`, () => {
        /* この試験では通知内容は見ない */
      }),
    );

    const firstConn = await server.nextConnection();
    await nextJsonMessage(firstConn);
    firstConn.terminate();

    // クライアント側の "close" イベントが発火し reconnectTimer がセット
    // されるのを待つ（reconnectDelayMs=300 より十分短い時間）。
    await new Promise((resolve) => setTimeout(resolve, 50));
    subscription.close();

    // reconnectDelayMs を跨いで待っても新しい接続は張られない。
    let reconnected = false;
    void server.nextConnection().then(() => {
      reconnected = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(reconnected).toBe(false);
  });

  it("isolates a drop on one subscription from another subscription on the same client", async () => {
    // 同じ eth-ws-client から newHeads と newPendingTransactions を購読して
    // いるとき、片方（newHeads）の切断がもう片方（pendingTx）に影響しない
    // ことを確認する。subscribe() ごとにソケット・タイマー・closedByCaller
    // を独立したクロージャで持つため、互いに干渉しないはず。
    server = new FakeNodeServer();
    await server.ready();

    const headers = new Recorder<NewHeadHeader>();
    const txHashes = new Recorder<string>();
    const client = createWsEthClient({ reconnectDelayMs: 20 });
    const url = `ws://127.0.0.1:${server.port}`;
    track(client.subscribeNewHeads(url, (h) => headers.push(h)));
    track(client.subscribePendingTransactions(url, (t) => txHashes.push(t)));

    // 2 本の接続が張られる。subscribeParams でどちらか判別する。
    const connA = await server.nextConnection();
    const connB = await server.nextConnection();
    const paramsA = (await nextJsonMessage(connA)).params;
    await nextJsonMessage(connB);
    const isNewHeadsA = JSON.stringify(paramsA) === JSON.stringify(["newHeads"]);
    const newHeadsConn = isNewHeadsA ? connA : connB;
    const pendingConn = isNewHeadsA ? connB : connA;

    // newHeads 側だけを切断する。
    newHeadsConn.terminate();

    // newHeads 側は再接続して resubscribe する。
    const reconnectedConn = await server.nextConnection();
    expect((await nextJsonMessage(reconnectedConn)).params).toEqual([
      "newHeads",
    ]);

    // pendingTx 側は切断されておらず、そのまま通知を届けられる。
    pendingConn.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_subscription",
        params: { subscription: "0x2", result: "0xfeed" },
      }),
    );
    await expect(txHashes.next()).resolves.toBe("0xfeed");

    // 再接続した newHeads 側も引き続き通知を届けられる。
    const header: NewHeadHeader = {
      hash: "0xaaa",
      number: "0x13",
      parentHash: "0xbbb",
      timestamp: "0x67",
    };
    reconnectedConn.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_subscription",
        params: { subscription: "0x3", result: header },
      }),
    );
    await expect(headers.next()).resolves.toEqual(header);
  });

  it("still delivers notifications after reconnect when the node assigns a different subscription id", async () => {
    // 再接続で eth_subscribe をやり直すと、ノードは新しい subscription id を
    // 割り当てる。クライアントは通知の result だけを見て id を照合しないため、
    // id が変わっても通知を受け取れることを確認する。
    server = new FakeNodeServer();
    await server.ready();

    const headers = new Recorder<NewHeadHeader>();
    const client = createWsEthClient({ reconnectDelayMs: 20 });
    track(
      client.subscribeNewHeads(`ws://127.0.0.1:${server.port}`, (h) =>
        headers.push(h),
      ),
    );

    const firstConn = await server.nextConnection();
    await nextJsonMessage(firstConn);
    // 最初の subscription id は "0x1"。
    firstConn.terminate();

    const secondConn = await server.nextConnection();
    await nextJsonMessage(secondConn);

    // 再接続後は別の subscription id ("0x99") で通知が届く。
    const header: NewHeadHeader = {
      hash: "0xccc",
      number: "0x14",
      parentHash: "0xddd",
      timestamp: "0x68",
    };
    secondConn.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_subscription",
        params: { subscription: "0x99", result: header },
      }),
    );
    await expect(headers.next()).resolves.toEqual(header);
  });

  it("does not surface a JSON-RPC error reply to eth_subscribe as onError (documents current behavior)", async () => {
    // ノードが eth_subscribe に対して（通知ではなく）エラー応答を返した場合の
    // 現状の挙動を固定する。現実装は eth_subscription 通知だけを解釈するため、
    // subscribe のエラー応答は静かに無視され、onError も onResult も呼ばれず
    // クラッシュもしない。これは既知の制限（報告済み）を記録するテスト。
    server = new FakeNodeServer();
    await server.ready();

    const errors: unknown[] = [];
    const headers = new Recorder<NewHeadHeader>();
    const client = createWsEthClient({ reconnectDelayMs: 20 });
    track(
      client.subscribeNewHeads(
        `ws://127.0.0.1:${server.port}`,
        (h) => headers.push(h),
        (err) => errors.push(err),
      ),
    );

    const conn = await server.nextConnection();
    const subscribeMsg = await nextJsonMessage(conn);
    // eth_subscribe に対しエラー応答を返す（reth が未対応メソッドを拒否する等）。
    conn.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: subscribeMsg.id,
        error: { code: -32601, message: "method not found" },
      }),
    );

    // エラー応答は静かに無視される（onError も onResult も呼ばれない）。
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(errors).toEqual([]);
  });
});
