// EthereumAdapter のチェーンリセット配線（Issue #357）を検証する。
// chain-reset-watcher.test.ts が watcher 単体の判定を、
// store-chain-reset-purge.test.ts が store のパージを固定しているのに対し、
// こちらはアダプタ層の 2 つの接続部を固定する:
//   - resetChainDerivedState() が実際に内部トラッカーの状態を消すこと
//     （特に ContractTracker。残すと NftTracker/WalletTracker が旧チェーンの
//     アドレスをポーリングし続けエラーログが積み上がる＝Issue #357 の直接原因。
//     依頼観点3）
//   - subscribeChainResets(onReset) が genesis ハッシュ変化で onReset を呼び、
//     dispose() で監視が止まること（依頼観点3・配線が崩れていないか）
// トラッカーの reset() 単体は各 *.test.ts が固定済みなので、ここでは
// 「アダプタが確かにそれらを呼ぶ」配線に絞る。

import { describe, expect, it, vi } from "vitest";
import { DockerPoller } from "../../docker/poller.js";
import type { ContractCatalog } from "./catalog.js";
import type { EthRpcClient } from "./eth-rpc-client.js";
import { EthereumAdapter } from "./index.js";
import { clientFrom, rethFixture } from "./test-helpers/docker-fixtures.js";
import { flushAsync, stubRpcClient } from "./test-helpers/tx-rpc-fixtures.js";
import { controllableWsClient, header } from "./test-helpers/ws-fixtures.js";

const testCatalog: ContractCatalog = {
  ChainvizToken: {
    name: "ChainvizToken",
    abi: [],
    token: { symbol: "CVZ", decimals: 18 },
  },
};

describe("EthereumAdapter.resetChainDerivedState (Issue #357)", () => {
  it("clears the ContractTracker so a purged token contract is no longer polled (regression: NftTracker/WalletTracker error-log buildup)", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      blocks: {
        "0xblock1": [
          {
            transactionHash: "0xdeploy",
            from: "0xdeployer",
            to: null,
            status: "0x1",
            contractAddress: "0xnewtoken",
          },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
      catalog: testCatalog,
    });
    await adapter.subscribeTransactions(() => {});
    await adapter.subscribeContracts(() => {});
    adapter.registerContractDeployment("0xnewtoken", "ChainvizToken");
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    // リセット前: トークンコントラクトが追跡され、残高ポーリング対象に含まれる。
    expect(adapter.trackedTokenContractAddresses()).toEqual(["0xnewtoken"]);

    adapter.resetChainDerivedState();

    // リセット後: 追跡が消え、旧チェーンのアドレスを二度とポーリングしない。
    expect(adapter.trackedTokenContractAddresses()).toEqual([]);
    adapter.dispose();
  });

  it("lets a fresh chain re-detect a deployment at the same address as new after reset (no ghost from the old chain)", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      blocks: {
        "0xblock1": [
          {
            transactionHash: "0xdeploy",
            from: "0xdeployer",
            to: null,
            status: "0x1",
            contractAddress: "0xnewtoken",
          },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
      catalog: testCatalog,
    });
    const contracts: string[] = [];
    await adapter.subscribeTransactions(() => {});
    await adapter.subscribeContracts((c) => contracts.push(c.address));
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();
    expect(contracts).toEqual(["0xnewtoken"]);

    // リセットしないと ContractTracker が同一アドレスの再デプロイを「既に
    // 追跡済み」として無視する（recordDeployment の仕様）。リセット後は新規
    // デプロイとして再度配信されることを確認する。
    adapter.resetChainDerivedState();
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();
    expect(contracts).toEqual(["0xnewtoken", "0xnewtoken"]);
    adapter.dispose();
  });

  it("does not throw when called with nothing tracked (idempotent / safe on a cold adapter)", () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const adapter = new EthereumAdapter(poller, { catalog: testCatalog });
    expect(() => adapter.resetChainDerivedState()).not.toThrow();
    expect(() => adapter.resetChainDerivedState()).not.toThrow();
    adapter.dispose();
  });
});

describe("EthereumAdapter.subscribeChainResets wiring (Issue #357)", () => {
  /** tick ごとに現在の `hash` を返す adapter を用意する。 */
  function adapterWithMutableGenesis(): {
    adapter: EthereumAdapter;
    setHash: (h: string) => void;
    pollIntervalMs: number;
  } {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    let hash = "0xgenesis-a";
    const ethRpcClient: EthRpcClient = {
      async call<T>(): Promise<T> {
        return { hash } as T;
      },
    };
    const pollIntervalMs = 1000;
    const adapter = new EthereumAdapter(poller, {
      ethRpcClient,
      chainResetPollIntervalMs: pollIntervalMs,
    });
    return { adapter, setHash: (h) => (hash = h), pollIntervalMs };
  }

  it("invokes onReset when the observed genesis hash changes", async () => {
    vi.useFakeTimers();
    try {
      const { adapter, setHash, pollIntervalMs } = adapterWithMutableGenesis();
      const onReset = vi.fn();
      adapter.subscribeChainResets(onReset);

      await vi.advanceTimersByTimeAsync(0); // prime
      await vi.runOnlyPendingTimersAsync();
      expect(onReset).not.toHaveBeenCalled();

      setHash("0xgenesis-b"); // down -v -> up
      await vi.advanceTimersByTimeAsync(pollIntervalMs);
      await vi.runOnlyPendingTimersAsync();
      expect(onReset).toHaveBeenCalledTimes(1);
      adapter.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops watching after dispose (no onReset even if genesis later changes)", async () => {
    vi.useFakeTimers();
    try {
      const { adapter, setHash, pollIntervalMs } = adapterWithMutableGenesis();
      const onReset = vi.fn();
      adapter.subscribeChainResets(onReset);
      await vi.advanceTimersByTimeAsync(0); // prime
      await vi.runOnlyPendingTimersAsync();

      adapter.dispose();
      setHash("0xgenesis-b");
      await vi.advanceTimersByTimeAsync(pollIntervalMs * 5);
      await vi.runOnlyPendingTimersAsync();
      expect(onReset).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
