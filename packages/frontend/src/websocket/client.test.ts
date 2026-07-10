import type { WorldStateSnapshot } from "@chainviz/shared";
import { describe, expect, it, vi } from "vitest";
import {
  type ChainvizClientOptions,
  type WebSocketLike,
  createChainvizClient,
} from "./client.js";

type Listener = (event: unknown) => void;

class FakeSocket implements WebSocketLike {
  sent: string[] = [];
  closed = false;
  private listeners: Record<string, Listener[]> = {};

  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.emit("close", {});
  }
  addEventListener(type: string, listener: Listener) {
    (this.listeners[type] ??= []).push(listener);
  }
  emit(type: string, event: unknown) {
    for (const l of this.listeners[type] ?? []) l(event);
  }
}

function setup(overrides: Partial<ChainvizClientOptions> = {}) {
  const socket = new FakeSocket();
  const handlers = {
    onSnapshot: vi.fn(),
    onDiff: vi.fn(),
    onCommandResult: vi.fn(),
    onStatusChange: vi.fn(),
  };
  const client = createChainvizClient({
    url: "ws://localhost:4000",
    createSocket: () => socket,
    ...handlers,
    ...overrides,
  });
  return { socket, handlers, client };
}

const snapshot: WorldStateSnapshot = {
  chainType: "ethereum",
  timestamp: 0,
  entities: [],
  edges: [],
};

describe("createChainvizClient", () => {
  it("transitions to connecting then connected", () => {
    const { socket, handlers, client } = setup();
    client.connect();
    expect(client.getStatus()).toBe("connecting");
    socket.emit("open", {});
    expect(client.getStatus()).toBe("connected");
    expect(handlers.onStatusChange).toHaveBeenCalledWith("connecting");
    expect(handlers.onStatusChange).toHaveBeenCalledWith("connected");
  });

  it("dispatches snapshot and diff messages to handlers", () => {
    const { socket, handlers, client } = setup();
    client.connect();
    socket.emit("message", { data: JSON.stringify({ type: "snapshot", payload: snapshot }) });
    socket.emit("message", {
      data: JSON.stringify({ type: "diff", payload: [{ type: "entityRemoved", id: "n1" }] }),
    });
    expect(handlers.onSnapshot).toHaveBeenCalledWith(snapshot);
    expect(handlers.onDiff).toHaveBeenCalledWith([{ type: "entityRemoved", id: "n1" }]);
  });

  it("routes commandResult with ok/error", () => {
    const { socket, handlers, client } = setup();
    client.connect();
    socket.emit("message", {
      data: JSON.stringify({ type: "commandResult", commandId: "cmd-1", ok: false, error: "boom" }),
    });
    expect(handlers.onCommandResult).toHaveBeenCalledWith("cmd-1", false, "boom");
  });

  it("ignores malformed and non-string messages without throwing", () => {
    const { socket, handlers, client } = setup();
    client.connect();
    expect(() => {
      socket.emit("message", { data: "{bad json" });
      socket.emit("message", { data: 123 });
      socket.emit("message", {});
    }).not.toThrow();
    expect(handlers.onSnapshot).not.toHaveBeenCalled();
  });

  it("sends commands with generated ids and returns the id", () => {
    const { socket, client } = setup();
    client.connect();
    const id1 = client.sendCommand({ action: "removeNode", nodeId: "n1" });
    const id2 = client.sendCommand({ action: "addWorkbench", label: "Bob" });
    expect(id1).toBe("cmd-1");
    expect(id2).toBe("cmd-2");
    expect(JSON.parse(socket.sent[0])).toEqual({
      type: "command",
      commandId: "cmd-1",
      command: { action: "removeNode", nodeId: "n1" },
    });
  });

  it("supports a custom command id generator", () => {
    const { client } = setup({ generateCommandId: () => "fixed" });
    client.connect();
    expect(client.sendCommand({ action: "addNode", chainProfile: "ethereum" })).toBe("fixed");
  });

  it("goes to disconnected on close and clears the socket", () => {
    const { socket, client } = setup();
    client.connect();
    socket.emit("open", {});
    socket.emit("close", {});
    expect(client.getStatus()).toBe("disconnected");
  });

  it("does not open a second socket while already connected", () => {
    const factory = vi.fn(() => new FakeSocket());
    const client = createChainvizClient({
      url: "ws://x",
      createSocket: factory,
    });
    client.connect();
    client.connect();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("goes to disconnected on a socket error event", () => {
    const { socket, handlers, client } = setup();
    client.connect();
    socket.emit("open", {});
    expect(client.getStatus()).toBe("connected");
    socket.emit("error", {});
    expect(client.getStatus()).toBe("disconnected");
    expect(handlers.onStatusChange).toHaveBeenLastCalledWith("disconnected");
  });

  it("opens a fresh socket when connecting again after disconnect", () => {
    const sockets: FakeSocket[] = [];
    const factory = vi.fn(() => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    });
    const client = createChainvizClient({ url: "ws://x", createSocket: factory });
    client.connect();
    client.disconnect();
    client.connect();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(sockets[0].closed).toBe(true);
  });

  it("reconnects after the socket closes on its own (server drop)", () => {
    const factory = vi.fn(() => new FakeSocket());
    const client = createChainvizClient({ url: "ws://x", createSocket: factory });
    client.connect();
    // サーバー主導のクローズで socket が解放され、再接続が可能になる。
    factory.mock.results[0].value.emit("close", {});
    expect(client.getStatus()).toBe("disconnected");
    client.connect();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("sendCommand before connect does not throw and returns undefined without sending (Issue #235)", () => {
    const { socket, client } = setup();
    let id: string | undefined = "unset";
    expect(() => {
      id = client.sendCommand({ action: "addNode", chainProfile: "ethereum" });
    }).not.toThrow();
    expect(id).toBeUndefined();
    expect(socket.sent).toHaveLength(0);
  });

  it("sendCommand after the socket closes (collector stopped) returns undefined without sending (Issue #235)", () => {
    const { socket, client } = setup();
    client.connect();
    socket.emit("open", {});
    socket.emit("close", {}); // collector 停止相当。close ハンドラが socket を null にする。
    expect(client.getStatus()).toBe("disconnected");

    const id = client.sendCommand({ action: "addNode", chainProfile: "ethereum" });
    expect(id).toBeUndefined();
    expect(socket.sent).toHaveLength(0);
  });

  it("sendCommand returns undefined after an explicit disconnect, then works again after reconnect (Issue #235)", () => {
    const sockets: FakeSocket[] = [];
    const client = createChainvizClient({
      url: "ws://x",
      createSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    });
    client.connect();
    sockets[0].emit("open", {});
    client.disconnect(); // ユーザー操作等での明示的な切断でも socket は手放される。
    expect(
      client.sendCommand({ action: "addNode", chainProfile: "ethereum" }),
    ).toBeUndefined();
    expect(sockets[0].sent).toHaveLength(0);

    // 再接続すれば新しい socket で通常どおり送信でき、id が返る。
    client.connect();
    sockets[1].emit("open", {});
    const id = client.sendCommand({ action: "addNode", chainProfile: "ethereum" });
    expect(id).toBe("cmd-1");
    expect(sockets[1].sent).toHaveLength(1);
  });

  it("disconnect is a no-op when never connected", () => {
    const { handlers, client } = setup();
    expect(() => client.disconnect()).not.toThrow();
    expect(client.getStatus()).toBe("disconnected");
    // 状態が変わらないので通知も飛ばない。
    expect(handlers.onStatusChange).not.toHaveBeenCalled();
  });

  it("routes a successful commandResult with an undefined error", () => {
    const { socket, handlers, client } = setup();
    client.connect();
    socket.emit("message", {
      data: JSON.stringify({ type: "commandResult", commandId: "cmd-7", ok: true }),
    });
    expect(handlers.onCommandResult).toHaveBeenCalledWith("cmd-7", true, undefined);
  });

  it("ignores messages that parse to a known-looking but invalid shape", () => {
    const { socket, handlers, client } = setup();
    client.connect();
    // diff の payload が配列でない → parseServerMessage が null を返し無視される。
    socket.emit("message", {
      data: JSON.stringify({ type: "diff", payload: { not: "array" } }),
    });
    expect(handlers.onDiff).not.toHaveBeenCalled();
  });
});
