import type { NodeEntity, WorldStateSnapshot } from "@chainviz/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EthereumAdapter } from "./adapters/ethereum/index.js";
import type { CollectorServer } from "./server/websocket-server.js";
import {
  DEFAULT_PORT,
  DEFAULT_PROXY_PORT,
  DEFAULT_PROXY_TARGET,
  installProcessSafetyNet,
  resolvePort,
  resolveProxyPort,
  resolveProxyTarget,
  startLoggingProxy,
  startPollingLoop,
} from "./index.js";
import { WorldStateStore } from "./world-state/store.js";

function node(overrides: Partial<NodeEntity> = {}): NodeEntity {
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
    ...overrides,
  };
}

function partialWith(entities: NodeEntity[]): Partial<WorldStateSnapshot> {
  return { chainType: "ethereum", entities };
}

/** pollInfra だけを持つ最小のアダプタスタブ。 */
function fakeAdapter(
  pollInfra: () => Promise<Partial<WorldStateSnapshot>>,
): EthereumAdapter {
  return { pollInfra: vi.fn(pollInfra) } as unknown as EthereumAdapter;
}

/** broadcastDiff だけを記録する最小のサーバースタブ。 */
function fakeServer(): {
  server: CollectorServer;
  broadcastDiff: ReturnType<typeof vi.fn>;
} {
  const broadcastDiff = vi.fn();
  return {
    server: { broadcastDiff } as unknown as CollectorServer,
    broadcastDiff,
  };
}

describe("startPollingLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the first poll immediately and broadcasts the resulting diff", async () => {
    const adapter = fakeAdapter(async () => partialWith([node()]));
    const { server, broadcastDiff } = fakeServer();
    const store = new WorldStateStore("ethereum");

    const loop = startPollingLoop(adapter, store, server, 3000);
    await vi.advanceTimersByTimeAsync(0);

    expect(adapter.pollInfra).toHaveBeenCalledTimes(1);
    expect(broadcastDiff).toHaveBeenCalledTimes(1);
    expect(broadcastDiff.mock.calls[0][0]).toEqual([
      { type: "entityAdded", entity: node() },
    ]);
    loop.stop();
  });

  it("schedules subsequent polls at the configured interval", async () => {
    const adapter = fakeAdapter(async () => partialWith([node()]));
    const { server } = fakeServer();
    const store = new WorldStateStore("ethereum");

    const loop = startPollingLoop(adapter, store, server, 3000);
    await vi.advanceTimersByTimeAsync(0);
    expect(adapter.pollInfra).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(adapter.pollInfra).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(3000);
    expect(adapter.pollInfra).toHaveBeenCalledTimes(3);
    loop.stop();
  });

  it("stops polling after stop() is called", async () => {
    const adapter = fakeAdapter(async () => partialWith([node()]));
    const { server } = fakeServer();
    const store = new WorldStateStore("ethereum");

    const loop = startPollingLoop(adapter, store, server, 3000);
    await vi.advanceTimersByTimeAsync(0);
    expect(adapter.pollInfra).toHaveBeenCalledTimes(1);

    loop.stop();
    await vi.advanceTimersByTimeAsync(30000);
    expect(adapter.pollInfra).toHaveBeenCalledTimes(1);
  });

  it("keeps polling after a poll fails, reporting via onError", async () => {
    const adapter = fakeAdapter(async () => {
      throw new Error("docker unreachable");
    });
    const { server, broadcastDiff } = fakeServer();
    const store = new WorldStateStore("ethereum");
    const onError = vi.fn();

    const loop = startPollingLoop(adapter, store, server, 3000, onError);
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    // 失敗時は配信しない
    expect(broadcastDiff).not.toHaveBeenCalled();

    // 失敗してもループは止まらず次の周期が走る
    await vi.advanceTimersByTimeAsync(3000);
    expect(adapter.pollInfra).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(2);
    loop.stop();
  });

  it("does not start a new poll while the previous one is still in flight", async () => {
    // 解決しない poll。前回が完了しないと次回はスケジュールされないため、
    // いくら時間を進めても pollInfra は 1 回しか呼ばれない。
    const adapter = fakeAdapter(() => new Promise<never>(() => {}));
    const { server } = fakeServer();
    const store = new WorldStateStore("ethereum");

    const loop = startPollingLoop(adapter, store, server, 3000);
    await vi.advanceTimersByTimeAsync(0);
    expect(adapter.pollInfra).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30000);
    expect(adapter.pollInfra).toHaveBeenCalledTimes(1);
    loop.stop();
  });

  it("forwards an empty diff when a poll brings no changes", async () => {
    const adapter = fakeAdapter(async () => partialWith([node()]));
    const { server, broadcastDiff } = fakeServer();
    const store = new WorldStateStore("ethereum");

    const loop = startPollingLoop(adapter, store, server, 3000);
    await vi.advanceTimersByTimeAsync(0); // 1 回目: add
    await vi.advanceTimersByTimeAsync(3000); // 2 回目: 変化なし

    expect(broadcastDiff).toHaveBeenCalledTimes(2);
    expect(broadcastDiff.mock.calls[1][0]).toEqual([]);
    loop.stop();
  });

  it("treats a poll result without entities as an empty observation", async () => {
    const adapter = fakeAdapter(async () => ({ chainType: "ethereum" }));
    const { server, broadcastDiff } = fakeServer();
    const store = new WorldStateStore("ethereum");

    const loop = startPollingLoop(adapter, store, server, 3000);
    await vi.advanceTimersByTimeAsync(0);

    expect(broadcastDiff).toHaveBeenCalledTimes(1);
    expect(broadcastDiff.mock.calls[0][0]).toEqual([]);
    expect(store.getSnapshot().entities).toEqual([]);
    loop.stop();
  });
});

describe("resolvePort", () => {
  it("returns DEFAULT_PORT when the env var is unset", () => {
    expect(resolvePort({})).toBe(DEFAULT_PORT);
  });

  it("returns DEFAULT_PORT when the env var is empty or whitespace", () => {
    expect(resolvePort({ CHAINVIZ_COLLECTOR_PORT: "" })).toBe(DEFAULT_PORT);
    expect(resolvePort({ CHAINVIZ_COLLECTOR_PORT: "   " })).toBe(DEFAULT_PORT);
  });

  it("parses a valid non-negative integer port", () => {
    expect(resolvePort({ CHAINVIZ_COLLECTOR_PORT: "4123" })).toBe(4123);
    expect(resolvePort({ CHAINVIZ_COLLECTOR_PORT: "0" })).toBe(0);
  });

  it("falls back to DEFAULT_PORT for non-numeric or negative values", () => {
    expect(resolvePort({ CHAINVIZ_COLLECTOR_PORT: "abc" })).toBe(DEFAULT_PORT);
    expect(resolvePort({ CHAINVIZ_COLLECTOR_PORT: "-5" })).toBe(DEFAULT_PORT);
  });
});

describe("resolveProxyPort", () => {
  it("returns DEFAULT_PROXY_PORT when the env var is unset or blank", () => {
    expect(resolveProxyPort({})).toBe(DEFAULT_PROXY_PORT);
    expect(resolveProxyPort({ CHAINVIZ_PROXY_PORT: "  " })).toBe(
      DEFAULT_PROXY_PORT,
    );
  });

  it("parses a valid non-negative integer port", () => {
    expect(resolveProxyPort({ CHAINVIZ_PROXY_PORT: "4321" })).toBe(4321);
    expect(resolveProxyPort({ CHAINVIZ_PROXY_PORT: "0" })).toBe(0);
  });

  it("falls back to DEFAULT_PROXY_PORT for non-numeric or negative values", () => {
    expect(resolveProxyPort({ CHAINVIZ_PROXY_PORT: "abc" })).toBe(
      DEFAULT_PROXY_PORT,
    );
    expect(resolveProxyPort({ CHAINVIZ_PROXY_PORT: "-1" })).toBe(
      DEFAULT_PROXY_PORT,
    );
  });

  it("defaults to 4001 to avoid colliding with the WebSocket port 4000", () => {
    expect(DEFAULT_PROXY_PORT).toBe(4001);
    expect(DEFAULT_PORT).toBe(4000);
  });
});

describe("resolveProxyTarget", () => {
  it("returns DEFAULT_PROXY_TARGET when the env var is unset or blank", () => {
    expect(resolveProxyTarget({})).toBe(DEFAULT_PROXY_TARGET);
    expect(resolveProxyTarget({ CHAINVIZ_PROXY_TARGET: "   " })).toBe(
      DEFAULT_PROXY_TARGET,
    );
  });

  it("returns the trimmed override URL when set", () => {
    expect(
      resolveProxyTarget({ CHAINVIZ_PROXY_TARGET: " http://reth1:8545 " }),
    ).toBe("http://reth1:8545");
  });
});

describe("startLoggingProxy", () => {
  it("listens on the given port and transparently forwards observed calls", async () => {
    // 転送先の実ノード役をローカルの HTTP サーバーで代用する。
    const { createServer } = await import("node:http");
    const received: string[] = [];
    const upstream = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push(body);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x539" }));
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, resolve));
    const upstreamPort = (upstream.address() as { port: number }).port;

    const observed: string[] = [];
    const proxy = await startLoggingProxy(
      0,
      `http://127.0.0.1:${upstreamPort}`,
      (o) => observed.push(o.method),
    );
    const proxyPort = proxy.address?.port;
    expect(proxyPort).toBeGreaterThan(0);
    try {
      const requestBody = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      });
      const res = await fetch(`http://127.0.0.1:${proxyPort}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: "0x539",
      });
      // 転送先はリクエストボディを改変なしで受け取る。
      expect(received).toEqual([requestBody]);
      // 観測データが onObserve に渡る。
      expect(observed).toEqual(["eth_chainId"]);
    } finally {
      await proxy.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});

describe("installProcessSafetyNet", () => {
  // 実プロセスにハンドラを登録するが、追加したものだけを退避・除去してテスト間で
  // 汚染しないようにする（vitest 自身のハンドラは触らない）。
  type Ev = "unhandledRejection" | "uncaughtException";

  /**
   * installProcessSafetyNet が新しく追加したハンドラだけを取り出す。
   * 呼び出し後に自動で除去できるよう cleanup も返す。
   */
  type Listener = (arg: unknown) => void;
  const listenersOf = (ev: Ev): Listener[] =>
    (process.listeners as (event: string) => unknown[])(ev) as Listener[];

  function captureInstalledHandlers(
    log: (m: string, d: unknown) => void,
    exit: (code: number) => void = () => {},
  ): {
    handlers: Record<Ev, Listener>;
    cleanup: () => void;
  } {
    const events: Ev[] = ["unhandledRejection", "uncaughtException"];
    const before: Record<Ev, Listener[]> = {
      unhandledRejection: listenersOf("unhandledRejection"),
      uncaughtException: listenersOf("uncaughtException"),
    };

    installProcessSafetyNet(log, exit);

    const handlers = {} as Record<Ev, Listener>;
    const added: Array<[Ev, Listener]> = [];
    for (const ev of events) {
      const fresh = listenersOf(ev).filter((l) => !before[ev].includes(l));
      expect(fresh).toHaveLength(1);
      handlers[ev] = fresh[0];
      added.push([ev, fresh[0]]);
    }
    return {
      handlers,
      cleanup: () => {
        const remove = process.removeListener.bind(process) as (
          event: string,
          listener: (...a: unknown[]) => void,
        ) => void;
        for (const [ev, l] of added) remove(ev, l);
      },
    };
  }

  it("registers one unhandledRejection and one uncaughtException handler", () => {
    const { cleanup } = captureInstalledHandlers(() => {});
    cleanup();
  });

  it("logs an unhandled rejection instead of letting it crash the process", () => {
    const log = vi.fn();
    const { handlers, cleanup } = captureInstalledHandlers(log);
    try {
      const reason = new Error("stray background rejection");
      // ハンドラ呼び出し自体が例外を投げず（=プロセスを落とさず）、内容をログに残す。
      expect(() => handlers.unhandledRejection(reason)).not.toThrow();
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        expect.stringMatching(/unhandled/i),
        reason,
      );
    } finally {
      cleanup();
    }
  });

  it("logs an uncaught exception and exits the process", () => {
    const log = vi.fn();
    const exit = vi.fn();
    const { handlers, cleanup } = captureInstalledHandlers(log, exit);
    try {
      const err = new Error("stray uncaught error");
      expect(() => handlers.uncaughtException(err)).not.toThrow();
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/uncaught/i), err);
      // 孤児化の心配は recoverManagedContainers が解消したため、プロセスの
      // 状態が不定な uncaughtException では継続せず終了する（Issue #65）。
      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      cleanup();
    }
  });

  it("does not exit on an unhandled rejection", () => {
    const log = vi.fn();
    const exit = vi.fn();
    const { handlers, cleanup } = captureInstalledHandlers(log, exit);
    try {
      handlers.unhandledRejection(new Error("stray background rejection"));
      expect(exit).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });
});
