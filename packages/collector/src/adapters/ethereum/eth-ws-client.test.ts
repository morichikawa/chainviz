import { WebSocket, WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import type { NewHeadHeader, Subscription } from "./eth-ws-client.js";
import {
  createWsEthClient,
  parseSubscribeError,
  parseSubscriptionResult,
} from "./eth-ws-client.js";

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

describe("parseSubscribeError (Issue #143)", () => {
  it("extracts the error object from an eth_subscribe JSON-RPC error reply", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "method not found" },
    });
    expect(parseSubscribeError(raw)).toEqual({
      code: -32601,
      message: "method not found",
    });
  });

  it("returns undefined for a successful eth_subscribe reply (no error field)", () => {
    const raw = JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" });
    expect(parseSubscribeError(raw)).toBeUndefined();
  });

  it("returns undefined for an eth_subscription notification", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_subscription",
      params: { subscription: "0x1", result: "0xabc" },
    });
    expect(parseSubscribeError(raw)).toBeUndefined();
  });

  it("returns undefined for malformed JSON instead of throwing", () => {
    expect(parseSubscribeError("not json")).toBeUndefined();
  });

  it("returns an empty error object as-is when error is present but empty", () => {
    // error フィールドは存在するが code/message を含まない不正な応答。
    // 「error の有無だけで判定する」設計上、空オブジェクトでも「エラー応答」
    // として扱われる（undefined ではない）ことを記録する。
    const raw = JSON.stringify({ jsonrpc: "2.0", id: 1, error: {} });
    expect(parseSubscribeError(raw)).toEqual({});
  });

  it("returns the error object even when message is missing", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601 },
    });
    expect(parseSubscribeError(raw)).toEqual({ code: -32601 });
  });

  it("returns the error object even when code is missing", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { message: "boom" },
    });
    expect(parseSubscribeError(raw)).toEqual({ message: "boom" });
  });

  it("prioritizes the error field over a result field in a malformed reply", () => {
    // JSON-RPC 仕様上 result と error は排他だが、両方を含む不正な応答が
    // 来ても error の抽出を優先する（購読失敗を見逃さない方向に倒す）。
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: "0x1",
      error: { code: -32000, message: "conflict" },
    });
    expect(parseSubscribeError(raw)).toEqual({
      code: -32000,
      message: "conflict",
    });
  });

  it("returns the error field even when the frame also looks like a notification", () => {
    // method: eth_subscription と error を同時に持つ（通常あり得ない）不正な
    // フレーム。error を持つ以上エラー応答として抽出する。
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_subscription",
      params: { subscription: "0x1", result: "0xabc" },
      error: { code: -32601, message: "method not found" },
    });
    expect(parseSubscribeError(raw)).toEqual({
      code: -32601,
      message: "method not found",
    });
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

  it("surfaces a JSON-RPC error reply to eth_subscribe via onError (Issue #143)", async () => {
    // ノードが eth_subscribe に対して（通知ではなく）エラー応答を返した場合
    // （例: 未対応メソッドを reth が -32601 で拒否する）、接続自体は張られた
    // ままで "close"/"error" イベントは発火しない。onError が呼ばれることで
    // 呼び出し側が購読の失敗に気づけることを確認する。
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

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain("method not found");
    expect(String(errors[0])).toContain("-32601");

    // 通知は届いていない（onResult は呼ばれない）ことを確認する。
    let headerReceived = false;
    void headers.next().then(() => {
      headerReceived = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(headerReceived).toBe(false);
  });

  it("still processes normal eth_subscription notifications after an unrelated error-free connection", async () => {
    // エラー応答検知のロジックが、正常な eth_subscription 通知の処理に
    // 影響しないことを確認する（エラーが無ければ従来どおり onResult が
    // 呼ばれる）。
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
    // 正常な eth_subscribe 応答（購読 id を返すだけで error は含まない）。
    conn.send(JSON.stringify({ jsonrpc: "2.0", id: subscribeMsg.id, result: "0x1" }));

    const header: NewHeadHeader = {
      hash: "0xabc",
      number: "0x10",
      parentHash: "0xdef",
      timestamp: "0x64",
    };
    conn.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_subscription",
        params: { subscription: "0x1", result: header },
      }),
    );

    await expect(headers.next()).resolves.toEqual(header);
    expect(errors).toEqual([]);
  });

  it("detects an eth_subscribe error reply after reconnecting", async () => {
    // 一度目の接続は正常に切断され、再接続後の eth_subscribe 再送に対して
    // ノードがエラーを返すケース。再接続後も同じ message ハンドラを通るため
    // エラーが検知できることを確認する。
    server = new FakeNodeServer();
    await server.ready();

    const errors: unknown[] = [];
    const client = createWsEthClient({ reconnectDelayMs: 20 });
    track(
      client.subscribeNewHeads(
        `ws://127.0.0.1:${server.port}`,
        () => {
          /* この試験では通知内容は見ない */
        },
        (err) => errors.push(err),
      ),
    );

    const firstConn = await server.nextConnection();
    await nextJsonMessage(firstConn);
    firstConn.terminate();

    const secondConn = await server.nextConnection();
    const secondSubscribeMsg = await nextJsonMessage(secondConn);
    secondConn.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: secondSubscribeMsg.id,
        error: { code: -32601, message: "method not found" },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain("method not found");
  });

  it("still surfaces onError when the error object is missing code and message", async () => {
    // error フィールドは存在するが中身が空（code/message 欠落）の不正な応答。
    // 詳細メッセージは欠けるが、購読失敗自体は onError で必ず表面化させ、
    // 静かに無視されないことを確認する。
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
    conn.send(JSON.stringify({ jsonrpc: "2.0", id: subscribeMsg.id, error: {} }));

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain("eth_subscribe rejected");

    // 通知は届いていない（onResult は呼ばれない）。
    let headerReceived = false;
    void headers.next().then(() => {
      headerReceived = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(headerReceived).toBe(false);
  });

  it("prioritizes an error reply over a frame that also carries a notification result", async () => {
    // method: eth_subscription と error を同時に含む（通常あり得ない）不正な
    // フレームが来ても、error 検知が通知解釈より先に働き、onError が呼ばれ
    // onResult は呼ばれないことを確認する（防御的な優先順位）。
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
    await nextJsonMessage(conn);
    const header: NewHeadHeader = {
      hash: "0xabc",
      number: "0x10",
      parentHash: "0xdef",
      timestamp: "0x64",
    };
    conn.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_subscription",
        params: { subscription: "0x1", result: header },
        error: { code: -32601, message: "method not found" },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain("method not found");

    // 通知の result は届けられない。
    let headerReceived = false;
    void headers.next().then(() => {
      headerReceived = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(headerReceived).toBe(false);
  });

  it("isolates an error reply on one subscription from another subscription on the same client", async () => {
    // 同じ eth-ws-client から newHeads と newPendingTransactions を購読して
    // いるとき、片方（newHeads）が eth_subscribe をエラーで拒否されても、
    // もう片方（pendingTx）はそのまま通知を届けられることを確認する。
    server = new FakeNodeServer();
    await server.ready();

    const newHeadsErrors: unknown[] = [];
    const pendingErrors: unknown[] = [];
    const headers = new Recorder<NewHeadHeader>();
    const txHashes = new Recorder<string>();
    const client = createWsEthClient({ reconnectDelayMs: 20 });
    const url = `ws://127.0.0.1:${server.port}`;
    track(
      client.subscribeNewHeads(
        url,
        (h) => headers.push(h),
        (err) => newHeadsErrors.push(err),
      ),
    );
    track(
      client.subscribePendingTransactions(
        url,
        (t) => txHashes.push(t),
        (err) => pendingErrors.push(err),
      ),
    );

    const connA = await server.nextConnection();
    const connB = await server.nextConnection();
    const msgA = await nextJsonMessage(connA);
    const msgB = await nextJsonMessage(connB);
    const isNewHeadsA =
      JSON.stringify(msgA.params) === JSON.stringify(["newHeads"]);
    const newHeadsConn = isNewHeadsA ? connA : connB;
    const pendingConn = isNewHeadsA ? connB : connA;
    const pendingMsg = isNewHeadsA ? msgB : msgA;

    // newHeads 側だけ eth_subscribe をエラーで拒否する。
    newHeadsConn.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: (isNewHeadsA ? msgA : msgB).id,
        error: { code: -32601, message: "method not found" },
      }),
    );

    // pendingTx 側は影響を受けず、通知を届けられる。
    pendingConn.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: pendingMsg.id,
        result: "0x2",
      }),
    );
    pendingConn.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_subscription",
        params: { subscription: "0x2", result: "0xfeed" },
      }),
    );

    await expect(txHashes.next()).resolves.toBe("0xfeed");
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(newHeadsErrors).toHaveLength(1);
    expect(String(newHeadsErrors[0])).toContain("method not found");
    expect(pendingErrors).toEqual([]);
  });

  it("surfaces onError for each of several consecutive error replies", async () => {
    // 同じ接続で複数回エラー応答が届いた場合、そのたびに onError が呼ばれる
    // （最初の1回だけ処理して以降を握りつぶさない）ことを確認する。
    server = new FakeNodeServer();
    await server.ready();

    const errors: unknown[] = [];
    const client = createWsEthClient({ reconnectDelayMs: 20 });
    track(
      client.subscribeNewHeads(
        `ws://127.0.0.1:${server.port}`,
        () => {
          /* この試験では通知内容は見ない */
        },
        (err) => errors.push(err),
      ),
    );

    const conn = await server.nextConnection();
    const subscribeMsg = await nextJsonMessage(conn);
    conn.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: subscribeMsg.id,
        error: { code: -32601, message: "method not found" },
      }),
    );
    conn.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: subscribeMsg.id,
        error: { code: -32000, message: "server error" },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(errors).toHaveLength(2);
    expect(String(errors[0])).toContain("method not found");
    expect(String(errors[1])).toContain("server error");
  });

  it("keeps the subscription alive after an error reply so a later drop still reconnects", async () => {
    // eth_subscribe のエラー応答はソケットを閉じない（"close" は発火しない）。
    // その後にノード都合でソケットが切れた場合、購読が死んでおらず再接続・
    // 再購読が働くことを確認する（エラー検知が再接続ロジックを壊さない）。
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

    const firstConn = await server.nextConnection();
    const firstMsg = await nextJsonMessage(firstConn);
    firstConn.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: firstMsg.id,
        error: { code: -32601, message: "method not found" },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(errors).toHaveLength(1);

    // エラー応答の後にノード都合で切断されても、再接続して購読し直す。
    firstConn.terminate();
    const secondConn = await server.nextConnection();
    expect((await nextJsonMessage(secondConn)).params).toEqual(["newHeads"]);

    const header: NewHeadHeader = {
      hash: "0xabc",
      number: "0x15",
      parentHash: "0xdef",
      timestamp: "0x69",
    };
    secondConn.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_subscription",
        params: { subscription: "0x1", result: header },
      }),
    );
    await expect(headers.next()).resolves.toEqual(header);
  });

  // 回帰テスト: ノードが success 応答に error: null を含めて返す（JSON-RPC
  // 仕様には反するが実在する実装がある）ケース。修正前は parseSubscribeError
  // が null をそのまま返し、`subscribeError.message` で
  // TypeError: Cannot read properties of null が発生してonErrorにも渡らず
  // uncaughtExceptionでcollectorプロセスを落としていた。修正後はerrorが
  // null/非オブジェクトの場合は「エラーなし」として扱う。
  it("treats error:null as a non-error reply and does not crash", async () => {
    server = new FakeNodeServer();
    await server.ready();

    const errors: unknown[] = [];
    const client = createWsEthClient({ reconnectDelayMs: 20 });
    track(
      client.subscribeNewHeads(
        `ws://127.0.0.1:${server.port}`,
        () => {
          /* この試験では通知内容は見ない */
        },
        (err) => errors.push(err),
      ),
    );

    const conn = await server.nextConnection();
    const subscribeMsg = await nextJsonMessage(conn);
    conn.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: subscribeMsg.id,
        result: "0x1",
        error: null,
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 60));
    // error: null は「エラーではない」success 応答として扱われ、onError は
    // 呼ばれず、プロセスも落ちない。
    expect(errors).toEqual([]);
  });
});
