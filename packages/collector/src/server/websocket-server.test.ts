import type { DiffEvent, NodeEntity, ServerMessage } from "@chainviz/shared";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { WorldStateStore } from "../world-state/store.js";
import { CollectorServer } from "./websocket-server.js";

function node(): NodeEntity {
  return {
    kind: "node",
    id: "chainviz-ethereum/reth1",
    containerName: "reth1",
    ip: "172.28.1.1",
    ports: [8545],
    resources: { cpuPercent: 10, memMB: 100 },
    process: { name: "reth" },
    chainType: "ethereum",
    clientType: "reth",
    syncStatus: "syncing",
    blockHeight: 0,
    headBlockHash: "",
  };
}

/**
 * ソケット生成時からメッセージをバッファするクライアント。接続直後に
 * サーバーが送る snapshot を取りこぼさないよう、open を待つ前から
 * message リスナーを張っておく。
 */
class TestClient {
  readonly ws: WebSocket;
  private readonly queue: ServerMessage[] = [];
  private waiter?: (msg: ServerMessage) => void;

  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = undefined;
        w(msg);
      } else {
        this.queue.push(msg);
      }
    });
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
  }

  /** 次のメッセージ（バッファ済みがあればそれ）を待つ。 */
  next(): Promise<ServerMessage> {
    const buffered = this.queue.shift();
    if (buffered) return Promise.resolve(buffered);
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }

  close(): void {
    this.ws.close();
  }
}

async function connect(port: number): Promise<TestClient> {
  const client = new TestClient(port);
  await client.open();
  return client;
}

describe("CollectorServer", () => {
  let server: CollectorServer | undefined;
  const clients: TestClient[] = [];

  afterEach(async () => {
    for (const c of clients) c.close();
    clients.length = 0;
    await server?.close();
    server = undefined;
  });

  async function start(store: WorldStateStore): Promise<number> {
    server = new CollectorServer(store);
    await server.listen(0);
    const addr = server.address;
    if (!addr) throw new Error("server did not bind a port");
    return addr.port;
  }

  it("sends a snapshot on connection", async () => {
    const store = new WorldStateStore("ethereum");
    store.applyInfra([node()]);
    const port = await start(store);

    const client = await connect(port);
    clients.push(client);
    const message = await client.next();

    expect(message.type).toBe("snapshot");
    if (message.type === "snapshot") {
      expect(message.payload.chainType).toBe("ethereum");
      expect(message.payload.entities).toHaveLength(1);
    }
  });

  it("broadcasts diffs to connected clients", async () => {
    const store = new WorldStateStore("ethereum");
    const port = await start(store);

    const client = await connect(port);
    clients.push(client);
    await client.next(); // 最初の snapshot を読み飛ばす

    const diffPromise = client.next();
    const events: DiffEvent[] = [{ type: "entityAdded", entity: node() }];
    server!.broadcastDiff(events);

    const message = await diffPromise;
    expect(message.type).toBe("diff");
    if (message.type === "diff") {
      expect(message.payload).toEqual(events);
    }
  });

  it("does not broadcast when the diff is empty", async () => {
    const store = new WorldStateStore("ethereum");
    const port = await start(store);
    const client = await connect(port);
    clients.push(client);
    await client.next(); // snapshot

    let received = false;
    client.ws.on("message", () => {
      received = true;
    });
    server!.broadcastDiff([]);
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toBe(false);
  });

  it("replies with a failing commandResult for commands (not yet implemented)", async () => {
    const store = new WorldStateStore("ethereum");
    const port = await start(store);
    const client = await connect(port);
    clients.push(client);
    await client.next(); // snapshot

    const replyPromise = client.next();
    client.ws.send(
      JSON.stringify({
        type: "command",
        commandId: "cmd-1",
        command: { action: "addWorkbench", label: "Alice" },
      }),
    );

    const message = await replyPromise;
    expect(message.type).toBe("commandResult");
    if (message.type === "commandResult") {
      expect(message.commandId).toBe("cmd-1");
      expect(message.ok).toBe(false);
      expect(message.error).toBeTruthy();
    }
  });

  it("ignores malformed client messages without crashing", async () => {
    const store = new WorldStateStore("ethereum");
    const port = await start(store);
    const client = await connect(port);
    clients.push(client);
    await client.next(); // snapshot

    client.ws.send("not json at all");
    // クラッシュしないこと・接続が生きていることを確認する
    await new Promise((r) => setTimeout(r, 50));
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("broadcasts a diff to every connected client", async () => {
    const store = new WorldStateStore("ethereum");
    const port = await start(store);

    const a = await connect(port);
    const b = await connect(port);
    clients.push(a, b);
    await a.next(); // snapshot
    await b.next(); // snapshot

    const aDiff = a.next();
    const bDiff = b.next();
    const events: DiffEvent[] = [{ type: "entityAdded", entity: node() }];
    server!.broadcastDiff(events);

    for (const msg of await Promise.all([aDiff, bDiff])) {
      expect(msg.type).toBe("diff");
      if (msg.type === "diff") expect(msg.payload).toEqual(events);
    }
  });

  it("gives a newly connected client a snapshot reflecting the latest state", async () => {
    const store = new WorldStateStore("ethereum");
    const port = await start(store);

    const early = await connect(port);
    clients.push(early);
    await early.next(); // 空スナップショット

    // 接続後に状態が変わる
    store.applyInfra([node()]);

    const late = await connect(port);
    clients.push(late);
    const message = await late.next();
    expect(message.type).toBe("snapshot");
    if (message.type === "snapshot") {
      expect(message.payload.entities).toHaveLength(1);
    }
  });

  it("keeps broadcasting to remaining clients after one disconnects", async () => {
    const store = new WorldStateStore("ethereum");
    const port = await start(store);

    const a = await connect(port);
    const b = await connect(port);
    clients.push(a, b);
    await a.next(); // snapshot
    await b.next(); // snapshot

    // a を切断し、サーバー側が close を認識するのを待つ
    a.ws.close();
    await new Promise((r) => setTimeout(r, 50));

    const bDiff = b.next();
    const events: DiffEvent[] = [{ type: "entityRemoved", id: "x" }];
    // 切断済みクライアントがいてもクラッシュせず、生存クライアントには届く
    server!.broadcastDiff(events);
    const message = await bDiff;
    expect(message.type).toBe("diff");
  });

  it("does not reply to a well-formed message that is not a command", async () => {
    const store = new WorldStateStore("ethereum");
    const port = await start(store);
    const client = await connect(port);
    clients.push(client);
    await client.next(); // snapshot

    let received = false;
    client.ws.on("message", () => {
      received = true;
    });
    client.ws.send(JSON.stringify({ type: "subscribe", topic: "blocks" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toBe(false);
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("ignores JSON primitives sent by the client", async () => {
    const store = new WorldStateStore("ethereum");
    const port = await start(store);
    const client = await connect(port);
    clients.push(client);
    await client.next(); // snapshot

    let received = false;
    client.ws.on("message", () => {
      received = true;
    });
    client.ws.send("null");
    client.ws.send("123");
    client.ws.send('"just a string"');
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toBe(false);
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("is a no-op to broadcast before the server starts listening", () => {
    const store = new WorldStateStore("ethereum");
    const idle = new CollectorServer(store);
    // listen() 前でも例外を投げない
    expect(() =>
      idle.broadcastDiff([{ type: "entityRemoved", id: "x" }]),
    ).not.toThrow();
    expect(idle.address).toBeNull();
  });

  it("resolves close() even when the server never listened", async () => {
    const store = new WorldStateStore("ethereum");
    const idle = new CollectorServer(store);
    await expect(idle.close()).resolves.toBeUndefined();
  });
});
