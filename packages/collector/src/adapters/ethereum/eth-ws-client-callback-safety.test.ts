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
});
