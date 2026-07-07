// EthereumAdapter が「カタログ ABI による関数呼び出し・イベントログの復号」
// (Issue #162)を実際の購読経路(subscribeTransactions の pending/inclusion
// ハンドラ)に正しく配線していることを確認する統合テスト。
//
// decode.ts 単体の復号ロジックの正しさ（引数の並び・raw フォールバック等）は
// decode.test.ts、ContractTracker.getCatalogEntry の照合ロジック単体は
// contracts.test.ts、TransactionLifecycleTracker への反映（contractCall の
// 引き継ぎ・contractEvents の上書き）は transactions.test.ts でそれぞれ
// カバー済み。このファイルは、それらが EthereumAdapter を通じて実際に
// つながっていることのみを確認する。

import type { ContractEntity, TransactionEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  getAddress,
} from "viem";
import { DockerPoller } from "../../docker/poller.js";
import type {
  DockerClient,
  DockerContainerSummary,
  DockerStatsResult,
  DockerTopResult,
} from "../../docker/types.js";
import type { ContractCatalog } from "./catalog.js";
import type { EthRpcClient } from "./eth-rpc-client.js";
import type { EthWsClient, NewHeadHeader, Subscription } from "./eth-ws-client.js";
import { EthereumAdapter } from "./index.js";

const zeroStats: DockerStatsResult = {
  cpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
  precpu_stats: { cpu_usage: { total_usage: 0 } },
  memory_stats: {},
};

function pollerWithOneReth(): DockerPoller {
  const summary: DockerContainerSummary = {
    Id: "id-reth1",
    Names: ["/chainviz-ethereum-reth1-1"],
    Image: "ghcr.io/paradigmxyz/reth:latest",
    State: "running",
    Labels: {
      "com.docker.compose.project": "chainviz-ethereum",
      "com.docker.compose.service": "reth1",
    },
    NetworkSettings: { Networks: { chain: { IPAddress: "172.28.1.1" } } },
  };
  const top: DockerTopResult = { Titles: ["CMD"], Processes: [["reth node"]] };
  const client: DockerClient = {
    listContainers: async () => [summary],
    getContainer: () => ({
      top: async () => top,
      stats: async () => zeroStats,
    }),
  };
  return new DockerPoller(client);
}

function controllableWsClient(): {
  client: EthWsClient;
  emitHead: (wsUrl: string, header: NewHeadHeader) => void;
  emitPending: (wsUrl: string, hash: string) => void;
} {
  const headHandlers = new Map<string, ((h: NewHeadHeader) => void)[]>();
  const pendingHandlers = new Map<string, (hash: string) => void>();
  const client: EthWsClient = {
    subscribeNewHeads(wsUrl, onHeader): Subscription {
      const list = headHandlers.get(wsUrl) ?? [];
      list.push(onHeader);
      headHandlers.set(wsUrl, list);
      return { close(): void {} };
    },
    subscribePendingTransactions(wsUrl, onTxHash): Subscription {
      pendingHandlers.set(wsUrl, onTxHash);
      return { close(): void {} };
    },
  };
  return {
    client,
    emitHead: (wsUrl, header) => {
      for (const handler of headHandlers.get(wsUrl) ?? []) handler(header);
    },
    emitPending: (wsUrl, hash) => pendingHandlers.get(wsUrl)?.(hash),
  };
}

/** eth_getTransactionByHash / eth_getBlockReceipts だけに応答するスタブ。想定外のメソッドは例外にする（RPC 呼び出し回数が無闇に増えていないことのガード）。 */
function stubRpcClient(data: {
  txs?: Record<string, unknown>;
  blocks?: Record<string, unknown>;
}): EthRpcClient {
  return {
    async call<T>(_url: string, method: string, params: unknown[]): Promise<T> {
      if (method === "eth_getTransactionByHash") {
        return (data.txs?.[params[0] as string] ?? null) as T;
      }
      if (method === "eth_getBlockReceipts") {
        return (data.blocks?.[params[0] as string] ?? null) as T;
      }
      throw new Error(`unexpected RPC method ${method} (contract decode must not add RPC calls)`);
    },
  };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function header(overrides: Partial<NewHeadHeader> = {}): NewHeadHeader {
  return {
    hash: "0xblock1",
    number: "0x10",
    parentHash: "0xparent",
    timestamp: "0x64",
    ...overrides,
  };
}

// ChainvizToken の一部だけを模した ABI（catalog.json 実物のサブセット）。
const tokenAbi = [
  {
    inputs: [
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "from", type: "address" },
      { indexed: true, internalType: "address", name: "to", type: "address" },
      { indexed: false, internalType: "uint256", name: "value", type: "uint256" },
    ],
    name: "Transfer",
    type: "event",
  },
];

const catalog: ContractCatalog = {
  ChainvizToken: { name: "ChainvizToken", abi: tokenAbi },
};

const tokenAddress = getAddress(`0x${"00".repeat(18)}aaaa`);
const holderA = getAddress(`0x${"00".repeat(18)}bbbb`);
const holderB = getAddress(`0x${"00".repeat(18)}cccc`);

/** tokenAddress をカタログ照合済みとして追跡させる（deploy 検知 + registerContractDeployment）。 */
async function catalogTheTokenContract(
  adapter: EthereumAdapter,
  ws: ReturnType<typeof controllableWsClient>,
  rpc: { blocks: Record<string, unknown> },
): Promise<void> {
  rpc.blocks["0xdeployblock"] = [
    {
      transactionHash: "0xdeploytx",
      from: "0xdeployer",
      to: null,
      status: "0x1",
      contractAddress: tokenAddress,
    },
  ];
  ws.emitHead("ws://172.28.1.1:8546", header({ hash: "0xdeployblock" }));
  await flushAsync();
  adapter.registerContractDeployment(tokenAddress, "ChainvizToken");
}

describe("EthereumAdapter contract call/event decoding (Issue #162)", () => {
  it("decodes a pending tx's function call when its destination is a cataloged contract", async () => {
    const ws = controllableWsClient();
    const rpc: { txs: Record<string, unknown>; blocks: Record<string, unknown> } = {
      txs: {},
      blocks: {},
    };
    const adapter = new EthereumAdapter(pollerWithOneReth(), {
      ethWsClient: ws.client,
      ethRpcClient: stubRpcClient(rpc),
      catalog,
    });
    const txs: TransactionEntity[] = [];
    await adapter.subscribeTransactions((t) => txs.push(t));
    await catalogTheTokenContract(adapter, ws, rpc);

    const input = encodeFunctionData({
      abi: tokenAbi,
      functionName: "transfer",
      args: [holderA, 1000n],
    });
    rpc.txs["0xcalltx"] = {
      hash: "0xcalltx",
      from: holderB,
      to: tokenAddress,
      input,
    };
    ws.emitPending("ws://172.28.1.1:8546", "0xcalltx");
    await flushAsync();

    // txs には catalogTheTokenContract 自身が起こしたデプロイ tx（"0xdeploytx"）
    // も含まれるため、検証対象の tx をハッシュで絞り込む。
    const callTx = txs.find((t) => t.hash === "0xcalltx");
    expect(callTx?.contractCall).toEqual({
      contractAddress: tokenAddress,
      functionName: "transfer",
      args: [
        { name: "to", value: holderA },
        { name: "amount", value: "1000" },
      ],
    });
  });

  it("omits contractCall for a pending tx addressed to an untracked destination (plain EOA)", async () => {
    const ws = controllableWsClient();
    const rpc: { txs: Record<string, unknown>; blocks: Record<string, unknown> } = {
      txs: {},
      blocks: {},
    };
    const adapter = new EthereumAdapter(pollerWithOneReth(), {
      ethWsClient: ws.client,
      ethRpcClient: stubRpcClient(rpc),
      catalog,
    });
    const txs: TransactionEntity[] = [];
    await adapter.subscribeTransactions((t) => txs.push(t));

    // どのコントラクトデプロイも観測していない（追跡すらされていない）宛先
    // への、任意の EOA 宛て tx を pending 検知する。
    rpc.txs["0xplaintx"] = {
      hash: "0xplaintx",
      from: holderB,
      to: holderA,
      input: "0x",
    };
    ws.emitPending("ws://172.28.1.1:8546", "0xplaintx");
    await flushAsync();

    expect(txs).toHaveLength(1);
    expect(txs[0]).not.toHaveProperty("contractCall");
  });

  it("attaches rawFunctionId for a pending tx to a tracked but non-cataloged (unknown) contract", async () => {
    // レビュー差し戻し(2026-07-07): デプロイは検知済み(追跡中)だが、
    // registerContractDeployment 等でカタログ照合されていない「未知のコントラクト」
    // 宛ての呼び出しは、これまで contractCall 自体が丸ごと省略され rawFunctionId
    // すら載らなかった。イベント側(decodeContractEvent)は catalogEntry が
    // undefined でも rawEventId を載せる設計になっており非対称だった
    // (docs/ARCHITECTURE.md §6.4「未知のコントラクトカード」の前提が崩れる)。
    const ws = controllableWsClient();
    const rpc: { txs: Record<string, unknown>; blocks: Record<string, unknown> } = {
      txs: {},
      blocks: {},
    };
    const adapter = new EthereumAdapter(pollerWithOneReth(), {
      ethWsClient: ws.client,
      ethRpcClient: stubRpcClient(rpc),
      catalog,
    });
    const txs: TransactionEntity[] = [];
    await adapter.subscribeTransactions((t) => txs.push(t));

    const unknownContractAddress = getAddress(`0x${"00".repeat(18)}eeee`);
    // デプロイは検知させるが、registerContractDeployment は一切呼ばない
    // （手動 forge create 等、カタログ未登録のまま追跡だけされている状態）。
    rpc.blocks["0xdeployblock2"] = [
      {
        transactionHash: "0xdeploytx2",
        from: "0xdeployer",
        to: null,
        status: "0x1",
        contractAddress: unknownContractAddress,
      },
    ];
    ws.emitHead("ws://172.28.1.1:8546", header({ hash: "0xdeployblock2" }));
    await flushAsync();

    const input = encodeFunctionData({
      abi: tokenAbi,
      functionName: "transfer",
      args: [holderA, 1000n],
    });
    rpc.txs["0xcalltx2"] = {
      hash: "0xcalltx2",
      from: holderB,
      to: unknownContractAddress,
      input,
    };
    ws.emitPending("ws://172.28.1.1:8546", "0xcalltx2");
    await flushAsync();

    const callTx = txs.find((t) => t.hash === "0xcalltx2");
    expect(callTx?.contractCall).toEqual({
      contractAddress: unknownContractAddress,
      rawFunctionId: input.slice(0, 10),
    });
  });

  it("decodes receipt logs into contractEvents when the emitting contract is cataloged", async () => {
    const ws = controllableWsClient();
    const rpc: { txs: Record<string, unknown>; blocks: Record<string, unknown> } = {
      txs: {},
      blocks: {},
    };
    const adapter = new EthereumAdapter(pollerWithOneReth(), {
      ethWsClient: ws.client,
      ethRpcClient: stubRpcClient(rpc),
      catalog,
    });
    const txs: TransactionEntity[] = [];
    await adapter.subscribeTransactions((t) => txs.push(t));
    await catalogTheTokenContract(adapter, ws, rpc);

    const topics = encodeEventTopics({
      abi: tokenAbi,
      eventName: "Transfer",
      args: { from: holderB, to: holderA },
    });
    const data = encodeAbiParameters([{ type: "uint256" }], [1000n]);
    rpc.blocks["0xincludeblock"] = [
      {
        transactionHash: "0xcalltx",
        from: holderB,
        to: tokenAddress,
        status: "0x1",
        logs: [{ address: tokenAddress, topics, data }],
      },
    ];
    ws.emitHead("ws://172.28.1.1:8546", header({ hash: "0xincludeblock" }));
    await flushAsync();

    const included = txs.find((t) => t.hash === "0xcalltx");
    expect(included?.status).toBe("included");
    expect(included?.contractEvents).toEqual([
      {
        contractAddress: tokenAddress,
        eventName: "Transfer",
        args: [
          { name: "from", value: holderB },
          { name: "to", value: holderA },
          { name: "value", value: "1000" },
        ],
      },
    ]);
  });

  it("falls back to rawEventId for a log emitted by a non-cataloged contract", async () => {
    const ws = controllableWsClient();
    const rpc: { txs: Record<string, unknown>; blocks: Record<string, unknown> } = {
      txs: {},
      blocks: {},
    };
    const adapter = new EthereumAdapter(pollerWithOneReth(), {
      ethWsClient: ws.client,
      ethRpcClient: stubRpcClient(rpc),
      catalog,
    });
    const txs: TransactionEntity[] = [];
    await adapter.subscribeTransactions((t) => txs.push(t));
    // カタログ照合を一切行わない（未知のコントラクトからのログ）。

    rpc.blocks["0xincludeblock"] = [
      {
        transactionHash: "0xt1",
        from: "0xa",
        to: "0xunknowncontract",
        status: "0x1",
        logs: [
          {
            address: "0xunknowncontract",
            topics: ["0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"],
            data: "0x",
          },
        ],
      },
    ];
    ws.emitHead("ws://172.28.1.1:8546", header({ hash: "0xincludeblock" }));
    await flushAsync();

    expect(txs[0].contractEvents).toEqual([
      {
        contractAddress: "0xunknowncontract",
        rawEventId:
          "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      },
    ]);
  });

  it("decodes each log by its own emitting contract when one receipt mixes a cataloged and an uncataloged contract", async () => {
    // 同一 tx の receipt に、カタログ照合済みのトークンが発した Transfer と、
    // 未知のコントラクトが発したログが混在するケース。decodeReceiptLogs は
    // tx.to ではなく各 log.address ごとにカタログを引くため、片方は復号され、
    // もう片方は rawEventId へフォールバックする（発行元ごとの正しい ABI 選択）。
    const ws = controllableWsClient();
    const rpc: { txs: Record<string, unknown>; blocks: Record<string, unknown> } = {
      txs: {},
      blocks: {},
    };
    const adapter = new EthereumAdapter(pollerWithOneReth(), {
      ethWsClient: ws.client,
      ethRpcClient: stubRpcClient(rpc),
      catalog,
    });
    const txs: TransactionEntity[] = [];
    await adapter.subscribeTransactions((t) => txs.push(t));
    await catalogTheTokenContract(adapter, ws, rpc);

    const topics = encodeEventTopics({
      abi: tokenAbi,
      eventName: "Transfer",
      args: { from: holderB, to: holderA },
    });
    const data = encodeAbiParameters([{ type: "uint256" }], [1000n]);
    const unknownAddress = getAddress(`0x${"00".repeat(18)}dddd`);
    const unknownTopic =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    rpc.blocks["0xmixedblock"] = [
      {
        transactionHash: "0xcalltx",
        from: holderB,
        to: tokenAddress,
        status: "0x1",
        logs: [
          { address: tokenAddress, topics, data },
          { address: unknownAddress, topics: [unknownTopic], data: "0x" },
        ],
      },
    ];
    ws.emitHead("ws://172.28.1.1:8546", header({ hash: "0xmixedblock" }));
    await flushAsync();

    const included = txs.find((t) => t.hash === "0xcalltx");
    expect(included?.contractEvents).toEqual([
      {
        contractAddress: tokenAddress,
        eventName: "Transfer",
        args: [
          { name: "from", value: holderB },
          { name: "to", value: holderA },
          { name: "value", value: "1000" },
        ],
      },
      { contractAddress: unknownAddress, rawEventId: unknownTopic },
    ]);
  });

  it("decodes contractEvents but attaches no contractCall for a tx observed only via block inclusion (no pending)", async () => {
    // pending を経ずに取り込みだけを観測した tx は input を取得しないため
    // contractCall（関数名）が付かない（docs/ARCHITECTURE.md §4 の制約）。
    // ただし receipt.logs からのイベント復号は inclusion 経路で行われるため、
    // contractEvents は付く。
    const ws = controllableWsClient();
    const rpc: { txs: Record<string, unknown>; blocks: Record<string, unknown> } = {
      txs: {},
      blocks: {},
    };
    const adapter = new EthereumAdapter(pollerWithOneReth(), {
      ethWsClient: ws.client,
      ethRpcClient: stubRpcClient(rpc),
      catalog,
    });
    const txs: TransactionEntity[] = [];
    await adapter.subscribeTransactions((t) => txs.push(t));
    await catalogTheTokenContract(adapter, ws, rpc);

    const topics = encodeEventTopics({
      abi: tokenAbi,
      eventName: "Transfer",
      args: { from: holderB, to: holderA },
    });
    const data = encodeAbiParameters([{ type: "uint256" }], [1000n]);
    // pending は一切発火させず、いきなりブロック取り込みだけを観測する。
    rpc.blocks["0xincludeonly"] = [
      {
        transactionHash: "0xinclusiononly",
        from: holderB,
        to: tokenAddress,
        status: "0x1",
        logs: [{ address: tokenAddress, topics, data }],
      },
    ];
    ws.emitHead("ws://172.28.1.1:8546", header({ hash: "0xincludeonly" }));
    await flushAsync();

    const included = txs.find((t) => t.hash === "0xinclusiononly");
    expect(included?.status).toBe("included");
    expect(included).not.toHaveProperty("contractCall");
    expect(included?.contractEvents).toEqual([
      {
        contractAddress: tokenAddress,
        eventName: "Transfer",
        args: [
          { name: "from", value: holderB },
          { name: "to", value: holderA },
          { name: "value", value: "1000" },
        ],
      },
    ]);
  });

  it("does not attach contractCall/contractEvents at all when no catalog was loaded (degraded startup)", async () => {
    const ws = controllableWsClient();
    const rpc: { txs: Record<string, unknown>; blocks: Record<string, unknown> } = {
      txs: {},
      blocks: {},
    };
    const adapter = new EthereumAdapter(pollerWithOneReth(), {
      ethWsClient: ws.client,
      ethRpcClient: stubRpcClient(rpc),
      // catalog: undefined (読み込み失敗時の縮退動作を模す)
    });
    const txs: TransactionEntity[] = [];
    await adapter.subscribeTransactions((t) => txs.push(t));

    const input = encodeFunctionData({
      abi: tokenAbi,
      functionName: "transfer",
      args: [holderA, 1000n],
    });
    rpc.txs["0xcalltx"] = { hash: "0xcalltx", from: holderB, to: tokenAddress, input };
    ws.emitPending("ws://172.28.1.1:8546", "0xcalltx");
    await flushAsync();
    expect(txs[0]).not.toHaveProperty("contractCall");

    rpc.blocks["0xincludeblock"] = [
      {
        transactionHash: "0xcalltx",
        from: holderB,
        to: tokenAddress,
        status: "0x1",
        logs: [{ address: tokenAddress, topics: ["0xtopic0"], data: "0x" }],
      },
    ];
    ws.emitHead("ws://172.28.1.1:8546", header({ hash: "0xincludeblock" }));
    await flushAsync();
    const included = txs.find((t) => t.hash === "0xcalltx" && t.status === "included");
    expect(included?.contractEvents).toEqual([
      { contractAddress: tokenAddress, rawEventId: "0xtopic0" },
    ]);
  });
});

describe("EthereumAdapter.subscribeContracts also still detects deployments unaffected by decoding (regression guard)", () => {
  it("still emits the ContractEntity for a deployment even once contract call/event decoding is wired in", async () => {
    const ws = controllableWsClient();
    const rpc: { txs: Record<string, unknown>; blocks: Record<string, unknown> } = {
      txs: {},
      blocks: {},
    };
    const adapter = new EthereumAdapter(pollerWithOneReth(), {
      ethWsClient: ws.client,
      ethRpcClient: stubRpcClient(rpc),
      catalog,
    });
    const contracts: ContractEntity[] = [];
    await adapter.subscribeTransactions(() => {});
    await adapter.subscribeContracts((c) => contracts.push(c));
    await catalogTheTokenContract(adapter, ws, rpc);

    // catalogTheTokenContract は「ブロック取り込みでの検知（未知として1件）」
    // →「registerContractDeployment によるカタログ照合（entityUpdated 相当で
    // もう1件）」の順で2件配信する（contract-deploy-wiring.test.ts と同じ
    // 経路）。最後の1件がカタログ照合済みの状態であることを確認する。
    expect(contracts).toHaveLength(2);
    expect(contracts[contracts.length - 1]).toMatchObject({
      kind: "contract",
      address: tokenAddress.toLowerCase(),
      catalogKey: "ChainvizToken",
      name: "ChainvizToken",
    });
  });
});
