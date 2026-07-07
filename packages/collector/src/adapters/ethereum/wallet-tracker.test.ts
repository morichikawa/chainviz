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

/**
 * balance/nonce（eth_getBalance / eth_getTransactionCount）に加え、
 * eth_call（balanceOf 相当）も扱う RPC スタブ。tokenBalances は
 * トークンコントラクトアドレス（小文字表記）→ 残高（bigint）のマップで指定し、
 * どのウォレットへの balanceOf 呼び出しでも同じ値を返す（1 ウォレットしか
 * 登場しないテストで十分なため）。`url|tokenAddress` の組が failingTokenCalls
 * に含まれる場合はその呼び出しだけ失敗させる。
 */
function stubRpcWithTokens(
  byAddress: Record<string, { balance: string; nonce: number }>,
  tokenBalances: Record<string, bigint> = {},
  failingTokenCalls: Set<string> = new Set(),
): { rpc: EthRpcClient; ethCallLog: { url: string; to: string; data: string }[] } {
  const ethCallLog: { url: string; to: string; data: string }[] = [];
  const rpc: EthRpcClient = {
    async call<T>(url: string, method: string, params: unknown[]): Promise<T> {
      if (method === "eth_getBalance" || method === "eth_getTransactionCount") {
        const address = params[0] as string;
        const entry = byAddress[address];
        if (!entry) throw new Error(`unknown address ${address}`);
        if (method === "eth_getBalance") {
          return `0x${BigInt(entry.balance).toString(16)}` as T;
        }
        return `0x${entry.nonce.toString(16)}` as T;
      }
      if (method === "eth_call") {
        const [{ to, data }] = params as [{ to: string; data: string }, string];
        ethCallLog.push({ url, to, data });
        const key = `${url}|${to}`;
        if (failingTokenCalls.has(key)) {
          throw new Error(`unreachable for token call ${key}`);
        }
        const amount = tokenBalances[to];
        if (amount === undefined) {
          throw new Error(`no stubbed token balance for ${to}`);
        }
        return `0x${amount.toString(16).padStart(64, "0")}` as T;
      }
      throw new Error(`unexpected method ${method}`);
    },
  };
  return { rpc, ethCallLog };
}

/**
 * index を有効な（viem の encodeFunctionData が balanceOf の引数として受け付
 * けられる）16 進アドレスへ写す導出スタブ。トークン残高取得は viem で
 * balanceOf(address) をエンコードするため、"0xindex0" のような非16進文字列
 * だとエンコード自体が例外になり、balance/nonce 用の deriveAddress スタブを
 * そのまま使い回せない（数字のみのアドレスは EIP-55 チェックサム検証の対象に
 * ならず常に有効と判定される）。
 */
const deriveHexAddress = (_mnemonic: string, index: number): string =>
  `0x${index.toString(16).padStart(40, "0")}`;

describe("WalletTracker.pollOnce token balances (Issue #164)", () => {
  it("omits tokenBalances and makes no eth_call when no token contracts are tracked", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture(), workbenchFixture("workbench")]),
    );
    const { rpc, ethCallLog } = stubRpcWithTokens({
      [deriveHexAddress("", 0)]: { balance: "5", nonce: 3 },
    });
    const tracker = new WalletTracker(poller, "m", {
      rpc,
      deriveAddress: deriveHexAddress,
      getTokenContractAddresses: () => [],
    });

    const wallets = await tracker.pollOnce();
    expect(wallets[0].tokenBalances).toBeUndefined();
    expect(ethCallLog).toHaveLength(0);
    // トークン追跡なしでも ETH 残高・nonce のポーリングには一切影響しない。
    expect(wallets[0]).toMatchObject({ balance: "5", nonce: 3 });
  });

  it("includes a zero token balance as amount '0' rather than dropping it (0 vs no-info)", async () => {
    // balanceOf が 0 を返すこと（トークン残高 0）と、そもそも取得できなかった
    // こと（undefined で除外）は区別する。0 は正当な観測値として載せる。
    const poller = new DockerPoller(
      clientFrom([rethFixture(), workbenchFixture("workbench")]),
    );
    const { rpc } = stubRpcWithTokens(
      { [deriveHexAddress("", 0)]: { balance: "5", nonce: 3 } },
      { "0xtoken": 0n },
    );
    const tracker = new WalletTracker(poller, "m", {
      rpc,
      deriveAddress: deriveHexAddress,
      getTokenContractAddresses: () => ["0xtoken"],
    });

    const wallets = await tracker.pollOnce();
    expect(wallets[0].tokenBalances).toEqual([
      { contractAddress: "0xtoken", amount: "0" },
    ]);
  });

  it("returns an empty tokenBalances array when tokens are tracked but no execution node is reachable", async () => {
    // 実行ノードが観測に無い → RPC URL が 1 つも無い → 各トークンの取得は
    // undefined になり、全件が配列から外れる（空配列）。ETH 残高・nonce も
    // 同じ理由で undefined になる。
    const poller = new DockerPoller(
      clientFrom([workbenchFixture("workbench")]),
    );
    const { rpc, ethCallLog } = stubRpcWithTokens(
      { [deriveHexAddress("", 0)]: { balance: "5", nonce: 3 } },
      { "0xtoken": 10n },
    );
    const tracker = new WalletTracker(poller, "m", {
      rpc,
      deriveAddress: deriveHexAddress,
      getTokenContractAddresses: () => ["0xtoken"],
    });

    const wallets = await tracker.pollOnce();
    expect(wallets[0].tokenBalances).toEqual([]);
    expect(wallets[0].balance).toBeUndefined();
    expect(wallets[0].nonce).toBeUndefined();
    // 到達可能な URL が無いので eth_call は 1 度も発行されない。
    expect(ethCallLog).toHaveLength(0);
  });

  it("attaches tokenBalances for a wallet when a single token contract is tracked", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture(), workbenchFixture("workbench")]),
    );
    const { rpc } = stubRpcWithTokens(
      { [deriveHexAddress("", 0)]: { balance: "5", nonce: 3 } },
      { "0xtoken": 1000n },
    );
    const tracker = new WalletTracker(poller, "m", {
      rpc,
      deriveAddress: deriveHexAddress,
      getTokenContractAddresses: () => ["0xtoken"],
    });

    const wallets = await tracker.pollOnce();
    expect(wallets[0].tokenBalances).toEqual([
      { contractAddress: "0xtoken", amount: "1000" },
    ]);
  });

  it("fetches token balances for every tracked token contract, per wallet", async () => {
    const poller = new DockerPoller(
      clientFrom([
        rethFixture(),
        workbenchFixture("alice", 1, "172.28.3.1"),
        workbenchFixture("bob", 2, "172.28.3.2"),
      ]),
    );
    const { rpc, ethCallLog } = stubRpcWithTokens(
      {
        [deriveHexAddress("", 1)]: { balance: "1", nonce: 0 },
        [deriveHexAddress("", 2)]: { balance: "2", nonce: 0 },
      },
      { "0xtokena": 10n, "0xtokenb": 20n },
    );
    const tracker = new WalletTracker(poller, "m", {
      rpc,
      deriveAddress: deriveHexAddress,
      getTokenContractAddresses: () => ["0xtokena", "0xtokenb"],
    });

    const wallets = await tracker.pollOnce();
    expect(wallets[0].tokenBalances).toEqual([
      { contractAddress: "0xtokena", amount: "10" },
      { contractAddress: "0xtokenb", amount: "20" },
    ]);
    expect(wallets[1].tokenBalances).toEqual([
      { contractAddress: "0xtokena", amount: "10" },
      { contractAddress: "0xtokenb", amount: "20" },
    ]);
    // 2 ウォレット × 2 トークン = 4 回の eth_call。
    expect(ethCallLog).toHaveLength(4);
  });

  it("excludes only the token whose balanceOf call fails, keeping the others", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture(), workbenchFixture("workbench")]),
    );
    const { rpc } = stubRpcWithTokens(
      { [deriveHexAddress("", 0)]: { balance: "5", nonce: 3 } },
      { "0xtokena": 10n, "0xtokenb": 20n },
      new Set(["http://172.28.1.1:8545|0xtokenb"]),
    );
    const tracker = new WalletTracker(poller, "m", {
      rpc,
      deriveAddress: deriveHexAddress,
      getTokenContractAddresses: () => ["0xtokena", "0xtokenb"],
    });

    const wallets = await tracker.pollOnce();
    expect(wallets[0].tokenBalances).toEqual([
      { contractAddress: "0xtokena", amount: "10" },
    ]);
  });

  it("returns an empty tokenBalances array (not undefined) when every token call fails", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture(), workbenchFixture("workbench")]),
    );
    const { rpc } = stubRpcWithTokens(
      { [deriveHexAddress("", 0)]: { balance: "5", nonce: 3 } },
      { "0xtoken": 10n },
      new Set(["http://172.28.1.1:8545|0xtoken"]),
    );
    const tracker = new WalletTracker(poller, "m", {
      rpc,
      deriveAddress: deriveHexAddress,
      getTokenContractAddresses: () => ["0xtoken"],
    });

    const wallets = await tracker.pollOnce();
    expect(wallets[0].tokenBalances).toEqual([]);
  });

  it("logs the actual last error (not a fixed 'unreachable' message) when every token call fails", async () => {
    // balanceOf の revert やデコード失敗など、到達不能以外の理由で失敗する
    // ケースを再現する。ログには固定文言ではなく、実際に捕捉した最後の
    // エラー内容が含まれなければならない（差し戻しの再発防止）。
    const poller = new DockerPoller(
      clientFrom([rethFixture(), workbenchFixture("workbench")]),
    );
    const revertError = new Error("execution reverted: transfer amount exceeds balance");
    const rpc: EthRpcClient = {
      async call() {
        throw revertError;
      },
    };
    const tracker = new WalletTracker(poller, "m", {
      rpc,
      deriveAddress: deriveHexAddress,
      getTokenContractAddresses: () => ["0xtoken"],
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await tracker.pollOnce();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("token balance poll failed"),
        revertError,
      );
      // 固定文言の "all execution RPC endpoints unreachable" にすり替えて
      // いないこと（実際には revert であり、到達不能とは限らないため）。
      const loggedMessage = errorSpy.mock.calls[0]?.[0] as string;
      expect(loggedMessage).not.toContain("unreachable");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("falls through to the next execution node for a token balance when the first fails", async () => {
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("172.28.1.1"),
        rethFixture("172.28.1.2"),
        workbenchFixture("workbench"),
      ]),
    );
    const { rpc } = stubRpcWithTokens(
      { [deriveHexAddress("", 0)]: { balance: "5", nonce: 3 } },
      { "0xtoken": 42n },
      new Set(["http://172.28.1.1:8545|0xtoken"]),
    );
    const tracker = new WalletTracker(poller, "m", {
      rpc,
      deriveAddress: deriveHexAddress,
      getTokenContractAddresses: () => ["0xtoken"],
    });

    const wallets = await tracker.pollOnce();
    expect(wallets[0].tokenBalances).toEqual([
      { contractAddress: "0xtoken", amount: "42" },
    ]);
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
