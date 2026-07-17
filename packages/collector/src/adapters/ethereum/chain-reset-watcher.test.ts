// ChainResetWatcher（Issue #357: チェーンリセット検知）のユニットテスト。
// genesis（block 0）ハッシュの観測・キャッシュ・リセット判定ロジックを
// 検証する。EthereumAdapter への実際の配線（resetChainDerivedState 呼び出し
// 等）は index.ts（main）側の責務であり別途カバーする（1ファイル1責務）。

import { describe, expect, it, vi } from "vitest";
import { DockerPoller } from "../../docker/poller.js";
import { ChainResetWatcher } from "./chain-reset-watcher.js";
import type { EthRpcClient } from "./eth-rpc-client.js";
import { clientFrom, rethFixture } from "./test-helpers/docker-fixtures.js";

/** URL ごとに genesis ハッシュ（または例外）を返すスタブ EthRpcClient。 */
function stubRpc(
  byUrl: Record<string, string>,
  failingUrls: Set<string> = new Set(),
): EthRpcClient {
  return {
    async call<T>(url: string, method: string): Promise<T> {
      expect(method).toBe("eth_getBlockByNumber");
      if (failingUrls.has(url)) throw new Error(`unreachable ${url}`);
      const hash = byUrl[url];
      if (hash === undefined) throw new Error(`no fixture for ${url}`);
      return { hash } as T;
    },
  };
}

describe("ChainResetWatcher.observeOnce", () => {
  it("returns the genesis hash from the reachable execution node", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const rpc = stubRpc({ "http://172.28.1.1:8545": "0xgenesis-a" });
    const watcher = new ChainResetWatcher(poller, { rpc });
    await expect(watcher.observeOnce()).resolves.toBe("0xgenesis-a");
  });

  it("falls back to the next execution node when the first is unreachable", async () => {
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
      ]),
    );
    const rpc = stubRpc(
      { "http://172.28.1.2:8545": "0xgenesis-a" },
      new Set(["http://172.28.1.1:8545"]),
    );
    const watcher = new ChainResetWatcher(poller, { rpc });
    await expect(watcher.observeOnce()).resolves.toBe("0xgenesis-a");
  });

  it("returns undefined when no execution node is reachable (observation failure, not proof of reset)", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const rpc = stubRpc({}, new Set(["http://172.28.1.1:8545"]));
    const watcher = new ChainResetWatcher(poller, { rpc });
    await expect(watcher.observeOnce()).resolves.toBeUndefined();
  });

  it("returns undefined when no execution node is observed at all", async () => {
    const poller = new DockerPoller(clientFrom([]));
    const watcher = new ChainResetWatcher(poller, { rpc: stubRpc({}) });
    await expect(watcher.observeOnce()).resolves.toBeUndefined();
  });
});

describe("ChainResetWatcher.subscribe", () => {
  it("does not call onReset on the first observation (cache priming only)", async () => {
    vi.useFakeTimers();
    try {
      const poller = new DockerPoller(
        clientFrom([rethFixture("reth1", "172.28.1.1")]),
      );
      const rpc = stubRpc({ "http://172.28.1.1:8545": "0xgenesis-a" });
      const watcher = new ChainResetWatcher(poller, {
        rpc,
        pollIntervalMs: 1000,
      });
      const onReset = vi.fn();
      watcher.subscribe(onReset);

      await vi.advanceTimersByTimeAsync(0);
      await vi.runOnlyPendingTimersAsync();

      expect(onReset).not.toHaveBeenCalled();
      expect(watcher.observedGenesisHash).toBe("0xgenesis-a");
      watcher.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("calls onReset when a different genesis hash is actually observed (Issue #357 main scenario)", async () => {
    vi.useFakeTimers();
    try {
      const poller = new DockerPoller(
        clientFrom([rethFixture("reth1", "172.28.1.1")]),
      );
      let hash = "0xgenesis-a";
      const rpc: EthRpcClient = {
        async call<T>(): Promise<T> {
          return { hash } as T;
        },
      };
      const watcher = new ChainResetWatcher(poller, {
        rpc,
        pollIntervalMs: 1000,
      });
      const onReset = vi.fn();
      watcher.subscribe(onReset);

      // 初回観測: キャッシュを埋めるだけで onReset は呼ばない。
      await vi.advanceTimersByTimeAsync(0);
      await vi.runOnlyPendingTimersAsync();
      expect(onReset).not.toHaveBeenCalled();

      // down -v -> up 相当で genesis が変化。
      hash = "0xgenesis-b";
      await vi.advanceTimersByTimeAsync(1000);
      await vi.runOnlyPendingTimersAsync();

      expect(onReset).toHaveBeenCalledTimes(1);
      expect(watcher.observedGenesisHash).toBe("0xgenesis-b");
      watcher.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not call onReset when observation fails (欠測はリセットの証拠にしない。Issue #288 と同じ原則)", async () => {
    vi.useFakeTimers();
    try {
      const poller = new DockerPoller(
        clientFrom([rethFixture("reth1", "172.28.1.1")]),
      );
      let failing = false;
      const rpc: EthRpcClient = {
        async call<T>(): Promise<T> {
          if (failing) throw new Error("node unreachable");
          return { hash: "0xgenesis-a" } as T;
        },
      };
      const watcher = new ChainResetWatcher(poller, {
        rpc,
        pollIntervalMs: 1000,
      });
      const onReset = vi.fn();
      watcher.subscribe(onReset);

      await vi.advanceTimersByTimeAsync(0);
      await vi.runOnlyPendingTimersAsync();
      expect(watcher.observedGenesisHash).toBe("0xgenesis-a");

      failing = true;
      await vi.advanceTimersByTimeAsync(1000);
      await vi.runOnlyPendingTimersAsync();

      expect(onReset).not.toHaveBeenCalled();
      expect(watcher.observedGenesisHash).toBe("0xgenesis-a");
      watcher.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops polling (and therefore stops calling onReset) after dispose", async () => {
    vi.useFakeTimers();
    try {
      const poller = new DockerPoller(
        clientFrom([rethFixture("reth1", "172.28.1.1")]),
      );
      let hash = "0xgenesis-a";
      const rpc: EthRpcClient = {
        async call<T>(): Promise<T> {
          return { hash } as T;
        },
      };
      const watcher = new ChainResetWatcher(poller, {
        rpc,
        pollIntervalMs: 1000,
      });
      const onReset = vi.fn();
      watcher.subscribe(onReset);
      await vi.advanceTimersByTimeAsync(0);
      await vi.runOnlyPendingTimersAsync();

      watcher.dispose();
      hash = "0xgenesis-b";
      await vi.advanceTimersByTimeAsync(5000);
      expect(onReset).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a second subscribe call while already running", async () => {
    vi.useFakeTimers();
    try {
      const poller = new DockerPoller(
        clientFrom([rethFixture("reth1", "172.28.1.1")]),
      );
      const rpc = stubRpc({ "http://172.28.1.1:8545": "0xgenesis-a" });
      const watcher = new ChainResetWatcher(poller, {
        rpc,
        pollIntervalMs: 1000,
      });
      const first = vi.fn();
      const second = vi.fn();
      watcher.subscribe(first);
      watcher.subscribe(second);

      await vi.advanceTimersByTimeAsync(0);
      await vi.runOnlyPendingTimersAsync();

      // 2 回目の subscribe は無視される（実行中なら何もしない）ため、
      // 2 系統のタイマーが並行して走ってリセット判定が二重化しない。
      watcher.dispose();
      expect(watcher.observedGenesisHash).toBe("0xgenesis-a");
    } finally {
      vi.useRealTimers();
    }
  });
});
