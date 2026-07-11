// デプロイ tx 自身が発したイベントログ（コンストラクタ内の mint が発する
// Transfer 等）が正しく復号されることの回帰テスト（Issue #244）。
//
// contract-decode.test.ts は「宛先/発行元がカタログ照合済みのケース」の
// 復号配線を、contract-deploy-wiring.test.ts は「デプロイ検知とカタログ登録の
// 到着順序に関わらずコントラクトカードにカタログ情報が反映されること」を
// それぞれ検証済み。このファイルは、その両者が絡み合う「デプロイ tx **自身**の
// receipt.logs の復号」に特化し、根本原因だった2つのタイミング問題
// （docs/worklog/issue-244.md 参照）それぞれに対する回帰を確認する。

import type { ContractEntity, TransactionEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, getAddress } from "viem";
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
} {
  const headHandlers = new Map<string, ((h: NewHeadHeader) => void)[]>();
  const client: EthWsClient = {
    subscribeNewHeads(wsUrl, onHeader): Subscription {
      const list = headHandlers.get(wsUrl) ?? [];
      list.push(onHeader);
      headHandlers.set(wsUrl, list);
      return { close(): void {} };
    },
    subscribePendingTransactions(): Subscription {
      return { close(): void {} };
    },
  };
  return {
    client,
    emitHead: (wsUrl, header) => {
      for (const handler of headHandlers.get(wsUrl) ?? []) handler(header);
    },
  };
}

/** eth_getBlockReceipts だけに応答するスタブ。想定外のメソッドは例外にする（RPC 呼び出し回数が無闇に増えていないことのガード）。 */
function stubRpcClient(blocks: Record<string, unknown>): EthRpcClient {
  return {
    async call<T>(_url: string, method: string, params: unknown[]): Promise<T> {
      if (method === "eth_getBlockReceipts") {
        return (blocks[params[0] as string] ?? null) as T;
      }
      throw new Error(`unexpected RPC method ${method} (redecode must not add RPC calls)`);
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

// ChainvizToken のコンストラクタ mint が発する Transfer を模した ABI サブセット。
const tokenAbi = [
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
const deployer = getAddress(`0x${"00".repeat(18)}bbbb`);
const zeroAddress = getAddress(`0x${"00".repeat(20)}`);

/**
 * コンストラクタ mint の Transfer(0x0 -> deployer, 1000) を模した
 * receipt.logs の1件。デプロイされたコントラクト自身がイベントを発する
 * （自己 mint）ケースを模すため、発行元アドレス（log.address）はデプロイ先
 * アドレスと一致させる（既定は tokenAddress）。
 */
function mintTransferLog(
  emittingAddress: string = tokenAddress,
): { address: string; topics: string[]; data: string } {
  const topics = encodeEventTopics({
    abi: tokenAbi,
    eventName: "Transfer",
    args: { from: zeroAddress, to: deployer },
  }) as string[];
  const data = encodeAbiParameters([{ type: "uint256" }], [1000n]);
  return { address: emittingAddress, topics, data };
}

const expectedDecodedEvent = {
  contractAddress: tokenAddress,
  eventName: "Transfer",
  args: [
    { name: "from", value: zeroAddress },
    { name: "to", value: deployer },
    { name: "value", value: "1000" },
  ],
};

describe("EthereumAdapter deploy-tx event redecode (Issue #244)", () => {
  it("decodes the deploy tx's own events immediately when the catalog key was registered before block inclusion (order A: registration first)", async () => {
    // 原因1対策: 同一ブロック処理内でデプロイ検知（pendingCatalogKeys の適用）
    // をログ復号より先に行うため、事前登録済みのカタログキーはブロック取り込み
    // 時点で即座に効く。再復号（バッファ経由）を経ずに最初から復号できることを
    // 確認する。
    const ws = controllableWsClient();
    const rpc: { blocks: Record<string, unknown> } = { blocks: {} };
    const adapter = new EthereumAdapter(pollerWithOneReth(), {
      ethWsClient: ws.client,
      ethRpcClient: stubRpcClient(rpc.blocks),
      catalog,
    });
    const txs: TransactionEntity[] = [];
    const contracts: ContractEntity[] = [];
    await adapter.subscribeTransactions((t) => txs.push(t));
    await adapter.subscribeContracts((c) => contracts.push(c));

    // ブロックがまだ届いていない段階でカタログキーを先に登録する
    // (pendingCatalogKeys へ保留される)。
    adapter.registerContractDeployment(tokenAddress, "ChainvizToken");
    expect(contracts).toEqual([]); // まだデプロイを検知していないので配信なし

    rpc.blocks["0xdeployblock"] = [
      {
        transactionHash: "0xdeploytx",
        from: deployer,
        to: null,
        status: "0x1",
        contractAddress: tokenAddress,
        logs: [mintTransferLog()],
      },
    ];
    ws.emitHead("ws://172.28.1.1:8546", header({ hash: "0xdeployblock" }));
    await flushAsync();

    const deployTx = txs.find((t) => t.hash === "0xdeploytx");
    expect(deployTx?.contractEvents).toEqual([expectedDecodedEvent]);
    // カタログ照合済みで検知される（entityAdded 1件のみ。再配信は不要）。
    expect(contracts).toHaveLength(1);
    expect(contracts[0].catalogKey).toBe("ChainvizToken");
  });

  it("self-heals the deploy tx's contractEvents via an entityUpdated once the catalog key registers after block inclusion (order B: the dominant real-world case)", async () => {
    // 原因2対策: forge create の出力解析後にカタログ登録が届く、ブロック
    // 取り込みより後着するケース（実測で支配的。docs/worklog/issue-244.md）。
    // 一度 raw フォールバックで確定配信された tx の contractEvents が、
    // 後着登録をきっかけに再復号・再配信されることを確認する。
    const ws = controllableWsClient();
    const rpc: { blocks: Record<string, unknown> } = { blocks: {} };
    const adapter = new EthereumAdapter(pollerWithOneReth(), {
      ethWsClient: ws.client,
      ethRpcClient: stubRpcClient(rpc.blocks),
      catalog,
    });
    const txs: TransactionEntity[] = [];
    const contracts: ContractEntity[] = [];
    await adapter.subscribeTransactions((t) => txs.push(t));
    await adapter.subscribeContracts((c) => contracts.push(c));

    rpc.blocks["0xdeployblock"] = [
      {
        transactionHash: "0xdeploytx",
        from: deployer,
        to: null,
        status: "0x1",
        contractAddress: tokenAddress,
        logs: [mintTransferLog()],
      },
    ];
    // 先にブロック取り込みを検知する。この時点ではカタログ未照合なので
    // raw フォールバックで確定配信される（Issue のバグそのものの状態）。
    ws.emitHead("ws://172.28.1.1:8546", header({ hash: "0xdeployblock" }));
    await flushAsync();

    const rawDeployTx = txs.find((t) => t.hash === "0xdeploytx");
    expect(rawDeployTx?.contractEvents).toEqual([
      {
        contractAddress: tokenAddress,
        rawEventId: mintTransferLog().topics[0],
      },
    ]);
    expect(contracts).toHaveLength(1);
    expect(contracts[0].catalogKey).toBeUndefined(); // 未知のコントラクトとして検知

    // その後カタログ登録が届く（deployContract の完了コールバック相当）。
    adapter.registerContractDeployment(tokenAddress, "ChainvizToken");

    // コントラクトの entityUpdated → tx の entityUpdated の順で配信される。
    expect(contracts).toHaveLength(2);
    expect(contracts[1].catalogKey).toBe("ChainvizToken");

    const healedDeployTx = txs.filter((t) => t.hash === "0xdeploytx").at(-1);
    expect(healedDeployTx?.contractEvents).toEqual([expectedDecodedEvent]);
    // 復号以外のフィールドは変わらない。
    expect(healedDeployTx?.status).toBe("included");
    expect(healedDeployTx?.createdContractAddress).toBe(tokenAddress);
  });

  it("does not re-decode (and does not throw) when the catalog key registers for an address with no buffered deploy logs", async () => {
    // カタログ未照合のまま放置されたデプロイ（バッファに何も無い）に対して
    // registerContractDeployment を呼んでも、tx の再配信は起きない（onTx が
    // 余計に呼ばれない）ことを確認する。
    const ws = controllableWsClient();
    const rpc: { blocks: Record<string, unknown> } = { blocks: {} };
    const adapter = new EthereumAdapter(pollerWithOneReth(), {
      ethWsClient: ws.client,
      ethRpcClient: stubRpcClient(rpc.blocks),
      catalog,
    });
    const txs: TransactionEntity[] = [];
    await adapter.subscribeTransactions((t) => txs.push(t));

    rpc.blocks["0xdeployblock"] = [
      {
        transactionHash: "0xdeploytx",
        from: deployer,
        to: null,
        status: "0x1",
        contractAddress: tokenAddress,
        logs: [], // イベントを発しないデプロイ (mint なし)
      },
    ];
    ws.emitHead("ws://172.28.1.1:8546", header({ hash: "0xdeployblock" }));
    await flushAsync();
    expect(txs.find((t) => t.hash === "0xdeploytx")).not.toHaveProperty(
      "contractEvents",
    );

    const txCountBefore = txs.length;
    expect(() =>
      adapter.registerContractDeployment(tokenAddress, "ChainvizToken"),
    ).not.toThrow();
    // logs が無かった（バッファ対象外だった）ので tx の再配信は起きない。
    expect(txs).toHaveLength(txCountBefore);
  });

  it("evicts the oldest buffered deploy log once the undecoded-deploy-log buffer's cap is exceeded (memory-bound guard)", async () => {
    // undecodedDeployLogs は挿入順で上限を超えたら最古から捨てる（実装コメント
    // に明記した前提: 上限は 200）。上限を超えて未照合デプロイが溜まった場合、
    // 最初に溜まった分のカタログ登録はもはや再復号できず（バッファ落ち）、
    // 直近の分は引き続き再復号できることを確認する。
    const ws = controllableWsClient();
    const rpc: { blocks: Record<string, unknown> } = { blocks: {} };
    const adapter = new EthereumAdapter(pollerWithOneReth(), {
      ethWsClient: ws.client,
      ethRpcClient: stubRpcClient(rpc.blocks),
      catalog,
    });
    const txs: TransactionEntity[] = [];
    await adapter.subscribeTransactions((t) => txs.push(t));

    const bufferCap = 200;
    const addressForIndex = (i: number): string =>
      getAddress(`0x${(1000 + i).toString(16).padStart(40, "0")}`);

    // 上限ちょうどより1件多く、カタログ未照合のデプロイ(ログ付き)を積む。
    for (let i = 0; i < bufferCap + 1; i++) {
      const address = addressForIndex(i);
      const blockHash = `0xblock${i}`;
      rpc.blocks[blockHash] = [
        {
          transactionHash: `0xdeploytx${i}`,
          from: deployer,
          to: null,
          status: "0x1",
          contractAddress: address,
          // 発行元アドレスをデプロイ先自身に合わせる（自己 mint。
          // getCatalogEntry の照合キーは receipt.contractAddress ではなく
          // 各ログの発行元アドレスなので、両者を一致させないと
          // registerContractDeployment 後も復号できない）。
          logs: [mintTransferLog(address)],
        },
      ];
      ws.emitHead("ws://172.28.1.1:8546", header({ hash: blockHash }));
      await flushAsync();
    }

    // 最初(index 0)のデプロイは、上限を超えた時点でバッファから追い出されて
    // いるため、この後カタログ登録が届いても再復号されない(raw のまま)。
    adapter.registerContractDeployment(addressForIndex(0), "ChainvizToken");
    const firstDeployTx = txs.filter((t) => t.hash === "0xdeploytx0").at(-1);
    expect(firstDeployTx?.contractEvents).toEqual([
      {
        contractAddress: addressForIndex(0),
        rawEventId: mintTransferLog().topics[0],
      },
    ]);

    // 直近(最後に積んだ index bufferCap)のデプロイはバッファに残っているため
    // 引き続き再復号される。
    adapter.registerContractDeployment(addressForIndex(bufferCap), "ChainvizToken");
    const lastDeployTx = txs
      .filter((t) => t.hash === `0xdeploytx${bufferCap}`)
      .at(-1);
    expect(lastDeployTx?.contractEvents).toEqual([
      { ...expectedDecodedEvent, contractAddress: addressForIndex(bufferCap) },
    ]);
  });
});
