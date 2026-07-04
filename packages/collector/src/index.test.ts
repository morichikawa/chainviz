import type { NodeEntity, WorldStateSnapshot } from "@chainviz/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EthereumAdapter } from "./adapters/ethereum/index.js";
import type { CollectorServer } from "./server/websocket-server.js";
import { DEFAULT_PORT, resolvePort, startPollingLoop } from "./index.js";
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
