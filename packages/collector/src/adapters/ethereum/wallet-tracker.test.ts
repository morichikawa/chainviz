import { describe, expect, it, vi } from "vitest";
import { DockerPoller } from "../../docker/poller.js";
import type {
  DockerClient,
  DockerContainerSummary,
  DockerStatsResult,
  DockerTopResult,
} from "../../docker/types.js";
import type { EthRpcClient } from "./eth-rpc-client.js";
import { WalletTracker } from "./wallet-tracker.js";
import { WALLET_INDEX_LABEL } from "./wallet-derivation.js";

const zeroStats: DockerStatsResult = {
  cpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
  precpu_stats: { cpu_usage: { total_usage: 0 } },
  memory_stats: {},
};

interface Fixture {
  summary: DockerContainerSummary;
  top: DockerTopResult;
}

function clientFrom(fixtures: Fixture[]): DockerClient {
  const byId = new Map(fixtures.map((f) => [f.summary.Id, f]));
  return {
    listContainers: async () => fixtures.map((f) => f.summary),
    getContainer: (id: string) => ({
      top: async () => byId.get(id)?.top ?? { Titles: ["CMD"], Processes: [] },
      stats: async () => zeroStats,
    }),
  };
}

function rethFixture(ip = "172.28.1.1"): Fixture {
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

function workbenchFixture(
  service: string,
  walletIndex?: number,
  ip = "172.28.3.1",
): Fixture {
  const labels: Record<string, string> = {
    "com.docker.compose.project": "chainviz-ethereum",
    "com.docker.compose.service": service,
  };
  if (walletIndex !== undefined) {
    labels[WALLET_INDEX_LABEL] = String(walletIndex);
  }
  return {
    summary: {
      Id: `id-${service}`,
      Names: [`/chainviz-ethereum-${service}-1`],
      Image: "ghcr.io/foundry-rs/foundry:latest",
      State: "running",
      Labels: labels,
      NetworkSettings: { Networks: { chain: { IPAddress: ip } } },
    },
    top: { Titles: ["CMD"], Processes: [["sh -c sleep infinity"]] },
  };
}

/** index を "0xindex" のような決定的なアドレスへ写す導出スタブ。 */
const deriveAddress = (_mnemonic: string, index: number): string =>
  `0xindex${index}`;

/** address ごとに balance/nonce を返す RPC スタブ。失敗させたい URL も指定可能。 */
function stubRpc(
  byAddress: Record<string, { balance: string; nonce: number }>,
  failingUrls: Set<string> = new Set(),
): EthRpcClient {
  return {
    async call<T>(url: string, method: string, params: unknown[]): Promise<T> {
      if (failingUrls.has(url)) throw new Error(`unreachable ${url}`);
      const address = params[0] as string;
      const entry = byAddress[address];
      if (!entry) throw new Error(`unknown address ${address}`);
      if (method === "eth_getBalance") {
        return `0x${BigInt(entry.balance).toString(16)}` as T;
      }
      if (method === "eth_getTransactionCount") {
        return `0x${entry.nonce.toString(16)}` as T;
      }
      throw new Error(`unexpected method ${method}`);
    },
  };
}

describe("WalletTracker.pollOnce", () => {
  it("returns a wallet observation for a running workbench", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture(), workbenchFixture("workbench")]),
    );
    const rpc = stubRpc({ "0xindex0": { balance: "5", nonce: 3 } });
    const tracker = new WalletTracker(poller, "test mnemonic", {
      rpc,
      deriveAddress,
    });

    const wallets = await tracker.pollOnce();
    expect(wallets).toEqual([
      {
        address: "0xindex0",
        ownerWorkbenchId: "chainviz-ethereum/workbench",
        balance: "5",
        nonce: 3,
      },
    ]);
  });

  it("uses the per-workbench derivation index from the label", async () => {
    const poller = new DockerPoller(
      clientFrom([
        rethFixture(),
        workbenchFixture("alice", 1, "172.28.3.1"),
        workbenchFixture("bob", 2, "172.28.3.2"),
      ]),
    );
    const rpc = stubRpc({
      "0xindex1": { balance: "1", nonce: 0 },
      "0xindex2": { balance: "2", nonce: 0 },
    });
    const tracker = new WalletTracker(poller, "m", { rpc, deriveAddress });

    const wallets = await tracker.pollOnce();
    expect(wallets.map((w) => w.address)).toEqual(["0xindex1", "0xindex2"]);
    expect(wallets.map((w) => w.ownerWorkbenchId)).toEqual([
      "chainviz-ethereum/alice",
      "chainviz-ethereum/bob",
    ]);
  });

  it("returns an empty list when no mnemonic is configured", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture(), workbenchFixture("workbench")]),
    );
    const tracker = new WalletTracker(poller, undefined, {
      rpc: stubRpc({}),
      deriveAddress,
    });
    expect(await tracker.pollOnce()).toEqual([]);
  });

  it("returns an empty list when no workbench is running", async () => {
    const poller = new DockerPoller(clientFrom([rethFixture()]));
    const tracker = new WalletTracker(poller, "m", {
      rpc: stubRpc({}),
      deriveAddress,
    });
    expect(await tracker.pollOnce()).toEqual([]);
  });

  it("leaves balance/nonce undefined when no execution node is reachable", async () => {
    // 実行ノードが観測に無い → RPC URL が無い → 残高・nonce は取れない。
    const poller = new DockerPoller(
      clientFrom([workbenchFixture("workbench")]),
    );
    const tracker = new WalletTracker(poller, "m", {
      rpc: stubRpc({ "0xindex0": { balance: "5", nonce: 3 } }),
      deriveAddress,
    });
    const wallets = await tracker.pollOnce();
    expect(wallets).toEqual([
      {
        address: "0xindex0",
        ownerWorkbenchId: "chainviz-ethereum/workbench",
        balance: undefined,
        nonce: undefined,
      },
    ]);
  });

  it("falls through to the next execution node when the first fails", async () => {
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("172.28.1.1"),
        rethFixture("172.28.1.2"),
        workbenchFixture("workbench"),
      ]),
    );
    const rpc = stubRpc(
      { "0xindex0": { balance: "7", nonce: 1 } },
      new Set(["http://172.28.1.1:8545"]),
    );
    const tracker = new WalletTracker(poller, "m", { rpc, deriveAddress });
    const wallets = await tracker.pollOnce();
    expect(wallets[0]).toMatchObject({ balance: "7", nonce: 1 });
  });

  it("leaves balance/nonce undefined when all execution nodes fail", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("172.28.1.1"), workbenchFixture("workbench")]),
    );
    const rpc = stubRpc(
      { "0xindex0": { balance: "7", nonce: 1 } },
      new Set(["http://172.28.1.1:8545"]),
    );
    const tracker = new WalletTracker(poller, "m", { rpc, deriveAddress });
    const wallets = await tracker.pollOnce();
    expect(wallets[0]?.balance).toBeUndefined();
    expect(wallets[0]?.nonce).toBeUndefined();
  });
});

describe("WalletTracker.subscribe", () => {
  it("delivers observations to the callback and stops on dispose", async () => {
    vi.useFakeTimers();
    try {
      const poller = new DockerPoller(
        clientFrom([rethFixture(), workbenchFixture("workbench")]),
      );
      const rpc = stubRpc({ "0xindex0": { balance: "5", nonce: 3 } });
      const tracker = new WalletTracker(poller, "m", {
        rpc,
        deriveAddress,
        pollIntervalMs: 1000,
      });
      const seen: unknown[] = [];
      tracker.subscribe((w) => seen.push(w));

      // 最初の tick を流す。
      await vi.advanceTimersByTimeAsync(0);
      await vi.runOnlyPendingTimersAsync();
      expect(seen.length).toBeGreaterThanOrEqual(1);
      expect((seen[0] as { address: string }[])[0].address).toBe("0xindex0");

      tracker.dispose();
      const countAfterDispose = seen.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(seen.length).toBe(countAfterDispose);
    } finally {
      vi.useRealTimers();
    }
  });
});
