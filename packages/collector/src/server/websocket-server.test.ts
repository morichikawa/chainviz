import type {
  Command,
  DiffEvent,
  NodeEntity,
  ServerMessage,
} from "@chainviz/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { WebSocketServer } from "ws";
import type { CommandProcessor } from "./websocket-server.js";
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

  async function start(
    store: WorldStateStore,
    commands?: CommandProcessor,
  ): Promise<number> {
    server = new CollectorServer(store, commands);
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

  it("replies with a failing commandResult when no command processor is wired", async () => {
    const store = new WorldStateStore("ethereum");
    const port = await start(store); // no processor
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

  it("dispatches a command to the processor and returns its result", async () => {
    const handled: Command[] = [];
    const processor: CommandProcessor = {
      handle: vi.fn(async (command: Command) => {
        handled.push(command);
        return { ok: true };
      }),
    };
    const store = new WorldStateStore("ethereum");
    const port = await start(store, processor);
    const client = await connect(port);
    clients.push(client);
    await client.next(); // snapshot

    const replyPromise = client.next();
    client.ws.send(
      JSON.stringify({
        type: "command",
        commandId: "cmd-9",
        command: { action: "addNode", chainProfile: "ethereum" },
      }),
    );

    const message = await replyPromise;
    expect(message.type).toBe("commandResult");
    if (message.type === "commandResult") {
      expect(message.commandId).toBe("cmd-9");
      expect(message.ok).toBe(true);
    }
    expect(handled).toEqual([
      { action: "addNode", chainProfile: "ethereum" },
    ]);
  });

  it("returns the processor's failure (ok:false) with an error message", async () => {
    const processor: CommandProcessor = {
      handle: async () => ({ ok: false, error: "node cannot be removed" }),
    };
    const store = new WorldStateStore("ethereum");
    const port = await start(store, processor);
    const client = await connect(port);
    clients.push(client);
    await client.next(); // snapshot

    const replyPromise = client.next();
    client.ws.send(
      JSON.stringify({
        type: "command",
        commandId: "cmd-10",
        command: { action: "removeNode", nodeId: "chainviz-ethereum/reth1" },
      }),
    );

    const message = await replyPromise;
    if (message.type === "commandResult") {
      expect(message.ok).toBe(false);
      expect(message.error).toBe("node cannot be removed");
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

  it("echoes back each commandId even when two commands reuse the same id", async () => {
    const processor: CommandProcessor = {
      handle: vi.fn(async () => ({ ok: true })),
    };
    const store = new WorldStateStore("ethereum");
    const port = await start(store, processor);
    const client = await connect(port);
    clients.push(client);
    await client.next(); // snapshot

    const first = client.next();
    client.ws.send(
      JSON.stringify({
        type: "command",
        commandId: "dup",
        command: { action: "addWorkbench", label: "A" },
      }),
    );
    const firstMsg = await first;

    const second = client.next();
    client.ws.send(
      JSON.stringify({
        type: "command",
        commandId: "dup",
        command: { action: "addWorkbench", label: "B" },
      }),
    );
    const secondMsg = await second;

    // No dedup: both commands are processed and both replies carry the id.
    for (const msg of [firstMsg, secondMsg]) {
      expect(msg.type).toBe("commandResult");
      if (msg.type === "commandResult") expect(msg.commandId).toBe("dup");
    }
    expect(processor.handle).toHaveBeenCalledTimes(2);
  });

  it("still replies (with the echoed id) to a command envelope missing its command field", async () => {
    const processor: CommandProcessor = {
      handle: vi.fn(async () => ({ ok: true })),
    };
    const store = new WorldStateStore("ethereum");
    const port = await start(store, processor);
    const client = await connect(port);
    clients.push(client);
    await client.next(); // snapshot

    // A "command" envelope whose command field is missing still reaches the
    // processor and gets a reply with the echoed id (no crash / no hang).
    const replyPromise = client.next();
    client.ws.send(JSON.stringify({ type: "command", commandId: "c-x" }));
    const message = await replyPromise;
    expect(message.type).toBe("commandResult");
    if (message.type === "commandResult") {
      expect(message.commandId).toBe("c-x");
    }
  });

  it("ignores an array payload sent by the client", async () => {
    const store = new WorldStateStore("ethereum");
    const port = await start(store);
    const client = await connect(port);
    clients.push(client);
    await client.next(); // snapshot

    let received = false;
    client.ws.on("message", () => {
      received = true;
    });
    client.ws.send(JSON.stringify([{ type: "command" }]));
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

  /** private な wss にテストからアクセスするためのヘルパー。 */
  function internalWss(s: CollectorServer): WebSocketServer {
    return (s as unknown as { wss: WebSocketServer }).wss;
  }

  async function startWithLog(
    store: WorldStateStore,
    log: (message: string, detail: unknown) => void,
  ): Promise<number> {
    server = new CollectorServer(store, undefined, log);
    await server.listen(0);
    const addr = server.address;
    if (!addr) throw new Error("server did not bind a port");
    return addr.port;
  }

  it("logs a per-connection socket error instead of throwing (crashing the process)", async () => {
    const logged: unknown[] = [];
    const store = new WorldStateStore("ethereum");
    const port = await startWithLog(store, (_m, detail) => logged.push(detail));

    const client = await connect(port);
    clients.push(client);
    await client.next(); // snapshot

    // サーバー側のソケットを取得し、突然切断で起きるような 'error' を発火させる。
    // error リスナーが張られていなければ EventEmitter 規約で throw される。
    const [serverSocket] = [...internalWss(server!).clients];
    expect(serverSocket).toBeDefined();
    const boom = new Error("ECONNRESET");
    expect(() => serverSocket.emit("error", boom)).not.toThrow();
    expect(logged).toContain(boom);

    // 他のクライアントの配信は生きたまま
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("does not let one connection's socket error tear down other connections", async () => {
    const store = new WorldStateStore("ethereum");
    const port = await startWithLog(store, () => {});

    const a = await connect(port);
    const b = await connect(port);
    clients.push(a, b);
    await a.next(); // snapshot
    await b.next(); // snapshot

    const [socketA] = [...internalWss(server!).clients];
    socketA.emit("error", new Error("ECONNRESET"));

    // b への配信は引き続き届く
    const bDiff = b.next();
    const events: DiffEvent[] = [{ type: "entityRemoved", id: "x" }];
    server!.broadcastDiff(events);
    const message = await bDiff;
    expect(message.type).toBe("diff");
  });

  it("logs a server-level error emitted after it starts listening", async () => {
    const logged: unknown[] = [];
    const store = new WorldStateStore("ethereum");
    await startWithLog(store, (_m, detail) => logged.push(detail));

    // listening 後のサーバーレベル error が未監視のまま throw されないこと、
    // かつログに残ること（reject 済み promise へ握り潰されないこと）。
    const boom = new Error("late server error");
    expect(() => internalWss(server!).emit("error", boom)).not.toThrow();
    expect(logged).toContain(boom);
  });
});
