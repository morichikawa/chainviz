import { describe, expect, it, vi } from "vitest";
import { DockerPoller } from "../../docker/poller.js";
import type {
  DockerClient,
  DockerContainerSummary,
  DockerStatsResult,
  DockerTopResult,
} from "../../docker/types.js";
import type { EthRpcClient } from "./eth-rpc-client.js";
import { NftTracker } from "./nft-tracker.js";

const zeroStats: DockerStatsResult = {
  cpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
  precpu_stats: { cpu_usage: { total_usage: 0 } },
  memory_stats: {},
};

function rethFixture(ip = "172.28.1.1"): {
  summary: DockerContainerSummary;
  top: DockerTopResult;
} {
  return {
    summary: {
      Id: `id-reth-${ip}`,
      Names: ["/chainviz-ethereum-reth1-1"],
      Image: "ghcr.io/paradigmxyz/reth:latest",
      State: "running",
      Labels: {
        "com.docker.compose.project": "chainviz-ethereum",
        "com.docker.compose.service": "reth1",
      },
      NetworkSettings: { Networks: { chain: { IPAddress: ip } } },
    },
    top: { Titles: ["CMD"], Processes: [["reth node"]] },
  };
}

function clientFrom(
  fixtures: { summary: DockerContainerSummary; top: DockerTopResult }[],
): DockerClient {
  const byId = new Map(fixtures.map((f) => [f.summary.Id, f]));
  return {
    listContainers: async () => fixtures.map((f) => f.summary),
    getContainer: (id: string) => ({
      top: async () => byId.get(id)?.top ?? { Titles: ["CMD"], Processes: [] },
      stats: async () => zeroStats,
    }),
  };
}

/** uint256 の値を viem が期待する 32 バイトの 16 進表現へ。 */
function encodeUint256(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function encodeAddress(address: string): string {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

/**
 * totalSupply()/ownerOf(uint256) をコントラクトアドレス単位でスタブする
 * eth_call ハンドラ。url ごとに失敗させることもできる（フェイルオーバー
 * テスト用）。
 */
function stubRpc(opts: {
  ledgers: Record<string, { totalSupply: bigint; owners: Record<string, string> }>;
  failingUrls?: Set<string>;
}): { rpc: EthRpcClient; calls: { url: string; to: string }[] } {
  const calls: { url: string; to: string }[] = [];
  const rpc: EthRpcClient = {
    async call<T>(url: string, method: string, params: unknown[]): Promise<T> {
      expect(method).toBe("eth_call");
      const [{ to, data }] = params as [{ to: string; data: string }, string];
      calls.push({ url, to });
      if (opts.failingUrls?.has(url)) {
        throw new Error(`unreachable ${url}`);
      }
      const ledger = opts.ledgers[to];
      if (!ledger) throw new Error(`no stubbed ledger for contract ${to}`);
      const selector = data.slice(0, 10);
      if (selector === "0x18160ddd") {
        return encodeUint256(ledger.totalSupply) as T;
      }
      if (selector === "0x6352211e") {
        const tokenId = BigInt(`0x${data.slice(10)}`).toString(10);
        const owner = ledger.owners[tokenId];
        if (!owner) throw new Error(`no stubbed owner for tokenId ${tokenId}`);
        return encodeAddress(owner) as T;
      }
      throw new Error(`unexpected calldata selector ${selector}`);
    },
  };
  return { rpc, calls };
}

describe("NftTracker.pollOnce", () => {
  it("returns an empty list and skips Docker polling when no nft contracts are tracked", async () => {
    let dockerPolled = false;
    const poller = new DockerPoller({
      listContainers: async () => {
        dockerPolled = true;
        return [];
      },
      getContainer: () => ({
        top: async () => ({ Titles: ["CMD"], Processes: [] }),
        stats: async () => zeroStats,
      }),
    });
    const tracker = new NftTracker(poller, {
      rpc: stubRpc({ ledgers: {} }).rpc,
      getNftContractAddresses: () => [],
    });

    expect(await tracker.pollOnce()).toEqual([]);
    expect(dockerPolled).toBe(false);
  });

  it("fetches the ledger for a single tracked nft contract", async () => {
    const poller = new DockerPoller(clientFrom([rethFixture()]));
    const owner1 = `0x${"1".padStart(40, "0")}`;
    const { rpc } = stubRpc({
      ledgers: { "0xnft": { totalSupply: 1n, owners: { "1": owner1 } } },
    });
    const tracker = new NftTracker(poller, {
      rpc,
      getNftContractAddresses: () => ["0xnft"],
    });

    const observations = await tracker.pollOnce();
    expect(observations).toEqual([
      {
        address: "0xnft",
        tokens: [{ tokenId: "1", ownerAddress: owner1.toLowerCase() }],
      },
    ]);
  });

  it("fetches ledgers for multiple tracked nft contracts independently", async () => {
    const poller = new DockerPoller(clientFrom([rethFixture()]));
    const ownerA = `0x${"a".padStart(40, "0")}`;
    const ownerB = `0x${"b".padStart(40, "0")}`;
    const { rpc } = stubRpc({
      ledgers: {
        "0xnfta": { totalSupply: 1n, owners: { "1": ownerA } },
        "0xnftb": { totalSupply: 1n, owners: { "1": ownerB } },
      },
    });
    const tracker = new NftTracker(poller, {
      rpc,
      getNftContractAddresses: () => ["0xnfta", "0xnftb"],
    });

    const observations = await tracker.pollOnce();
    expect(observations).toEqual([
      { address: "0xnfta", tokens: [{ tokenId: "1", ownerAddress: ownerA.toLowerCase() }] },
      { address: "0xnftb", tokens: [{ tokenId: "1", ownerAddress: ownerB.toLowerCase() }] },
    ]);
  });

  it("returns tokens: undefined when no execution node is reachable", async () => {
    // 実行ノードが観測に無い → RPC URL が 1 つも無い → 取得を試みたが失敗、
    // として tokens は undefined になる（前回値の維持を呼び出し側に促す）。
    const poller = new DockerPoller(clientFrom([]));
    const { rpc, calls } = stubRpc({ ledgers: {} });
    const tracker = new NftTracker(poller, {
      rpc,
      getNftContractAddresses: () => ["0xnft"],
    });

    const observations = await tracker.pollOnce();
    expect(observations).toEqual([{ address: "0xnft", tokens: undefined }]);
    expect(calls).toHaveLength(0);
  });

  it("falls through to the next execution node when the first fails", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("172.28.1.1"), rethFixture("172.28.1.2")]),
    );
    const owner1 = `0x${"1".padStart(40, "0")}`;
    const { rpc } = stubRpc({
      ledgers: { "0xnft": { totalSupply: 1n, owners: { "1": owner1 } } },
      failingUrls: new Set(["http://172.28.1.1:8545"]),
    });
    const tracker = new NftTracker(poller, {
      rpc,
      getNftContractAddresses: () => ["0xnft"],
    });

    const observations = await tracker.pollOnce();
    expect(observations[0].tokens).toEqual([
      { tokenId: "1", ownerAddress: owner1.toLowerCase() },
    ]);
  });

  it("returns tokens: undefined for a contract whose ledger fetch fails on every node, without affecting other contracts", async () => {
    const poller = new DockerPoller(clientFrom([rethFixture()]));
    const owner1 = `0x${"1".padStart(40, "0")}`;
    const { rpc } = stubRpc({
      ledgers: {
        "0xok": { totalSupply: 1n, owners: { "1": owner1 } },
        // "0xbroken" は ledgers に無いので eth_call は必ず失敗する。
      },
    });
    const tracker = new NftTracker(poller, {
      rpc,
      getNftContractAddresses: () => ["0xok", "0xbroken"],
    });

    const observations = await tracker.pollOnce();
    expect(observations).toEqual([
      { address: "0xok", tokens: [{ tokenId: "1", ownerAddress: owner1.toLowerCase() }] },
      { address: "0xbroken", tokens: undefined },
    ]);
  });

  it("logs the actual last error (not a fixed message) when every node fails for a contract", async () => {
    const poller = new DockerPoller(clientFrom([rethFixture()]));
    const revertError = new Error("execution reverted: no such tokenId");
    const rpc: EthRpcClient = {
      async call() {
        throw revertError;
      },
    };
    const tracker = new NftTracker(poller, {
      rpc,
      getNftContractAddresses: () => ["0xnft"],
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await tracker.pollOnce();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("nft ledger poll failed for contract 0xnft"),
        revertError,
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("NftTracker.subscribe", () => {
  it("delivers observations to the callback and stops on dispose", async () => {
    vi.useFakeTimers();
    try {
      const poller = new DockerPoller(clientFrom([rethFixture()]));
      const owner1 = `0x${"1".padStart(40, "0")}`;
      const { rpc } = stubRpc({
        ledgers: { "0xnft": { totalSupply: 1n, owners: { "1": owner1 } } },
      });
      const tracker = new NftTracker(poller, {
        rpc,
        getNftContractAddresses: () => ["0xnft"],
        pollIntervalMs: 1000,
      });
      const seen: unknown[] = [];
      tracker.subscribe((observations) => seen.push(observations));

      await vi.advanceTimersByTimeAsync(0);
      await vi.runOnlyPendingTimersAsync();
      expect(seen.length).toBeGreaterThanOrEqual(1);
      expect(
        (seen[0] as { address: string }[])[0].address,
      ).toBe("0xnft");

      tracker.dispose();
      const countAfterDispose = seen.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(seen.length).toBe(countAfterDispose);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not invoke the callback for a poll cycle with no tracked nft contracts", async () => {
    vi.useFakeTimers();
    try {
      const poller = new DockerPoller(clientFrom([rethFixture()]));
      const tracker = new NftTracker(poller, {
        rpc: stubRpc({ ledgers: {} }).rpc,
        getNftContractAddresses: () => [],
        pollIntervalMs: 1000,
      });
      const seen: unknown[] = [];
      tracker.subscribe((observations) => seen.push(observations));

      await vi.advanceTimersByTimeAsync(0);
      await vi.runOnlyPendingTimersAsync();
      expect(seen).toEqual([]);

      tracker.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
