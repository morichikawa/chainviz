// デプロイ tx の再復号(Issue #244)の異常系・境界値の回帰テスト。
//
// deploy-event-redecode.test.ts が「順序 A/B のハッピーパス + 基本的な
// バッファ evict(上限+1)」を検証済み。このファイルはその周辺の見落とし
// がちなケースに特化する:
//   - 同一ブロック内で複数のデプロイ tx が同時に未照合になり、後からまとめて
//     登録される場合の独立性・登録順非依存
//   - カタログ登録が二重に届いた場合の冪等性(再配信が重複しない)
//   - カタログ登録が永久に来ないコントラクトの扱い(生値のまま・他への非干渉)
//   - バッファ上限ちょうど(200)では evict が起きない境界
//   - 再復号が追加の RPC 呼び出しを増やさないこと(Issue #86 方針の維持)

import type { TransactionEntity } from "@chainviz/shared";
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

/**
 * eth_getBlockReceipts だけに応答するスタブ。呼び出しごとにメソッド名を
 * records に記録するので、再復号が追加の RPC を発生させていないことを
 * 呼び出し回数で検証できる。想定外のメソッドは例外にする。
 */
function countingRpcClient(
  blocks: Record<string, unknown>,
  calls: string[],
): EthRpcClient {
  return {
    async call<T>(_url: string, method: string, params: unknown[]): Promise<T> {
      calls.push(method);
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

const deployer = getAddress(`0x${"00".repeat(18)}bbbb`);
const zeroAddress = getAddress(`0x${"00".repeat(20)}`);

/** index を安定なチェックサム済みアドレスに写像する（衝突しない連番）。 */
function addressForIndex(i: number): string {
  return getAddress(`0x${(1000 + i).toString(16).padStart(40, "0")}`);
}

/** 発行元(log.address)が自分自身のデプロイ先である Transfer ログ(自己 mint)。 */
function mintTransferLog(emittingAddress: string): {
  address: string;
  topics: string[];
  data: string;
} {
  const topics = encodeEventTopics({
    abi: tokenAbi,
    eventName: "Transfer",
    args: { from: zeroAddress, to: deployer },
  }) as string[];
  const data = encodeAbiParameters([{ type: "uint256" }], [1000n]);
  return { address: emittingAddress, topics, data };
}

function decodedEventFor(address: string): {
  contractAddress: string;
  eventName: string;
  args: { name: string; value: string }[];
} {
  return {
    contractAddress: address,
    eventName: "Transfer",
    args: [
      { name: "from", value: zeroAddress },
      { name: "to", value: deployer },
      { name: "value", value: "1000" },
    ],
  };
}

function rawEventFor(address: string): { contractAddress: string; rawEventId: string } {
  return { contractAddress: address, rawEventId: mintTransferLog(address).topics[0] };
}

function deployReceipt(index: number): Record<string, unknown> {
  const address = addressForIndex(index);
  return {
    transactionHash: `0xdeploytx${index}`,
    from: deployer,
    to: null,
    status: "0x1",
    contractAddress: address,
    logs: [mintTransferLog(address)],
  };
}

function latestTx(txs: TransactionEntity[], hash: string): TransactionEntity | undefined {
  return txs.filter((t) => t.hash === hash).at(-1);
}

describe("EthereumAdapter deploy-tx event redecode edge cases (Issue #244)", () => {
  it("heals each of several deploy txs from the same block independently, regardless of registration order", async () => {
    // 同一ブロックで2件のデプロイ tx が同時にカタログ未照合として確定配信
    // される。後からカタログ登録が「デプロイ順とは逆」に届いても、それぞれの
    // tx が自分のログだけを再復号して自己修復する（アドレスをキーに独立して
    // 保持されているため取り違えない）。
    const ws = controllableWsClient();
    const blocks: Record<string, unknown> = {};
    const adapter = new EthereumAdapter(pollerWithOneReth(), {
      ethWsClient: ws.client,
      ethRpcClient: countingRpcClient(blocks, []),
      catalog,
    });
    const txs: TransactionEntity[] = [];
    await adapter.subscribeTransactions((t) => txs.push(t));
    await adapter.subscribeContracts(() => {});

    blocks["0xmultiblock"] = [deployReceipt(1), deployReceipt(2)];
    ws.emitHead("ws://172.28.1.1:8546", header({ hash: "0xmultiblock" }));
    await flushAsync();

    // 両方とも raw フォールバックで確定配信される。
    expect(latestTx(txs, "0xdeploytx1")?.contractEvents).toEqual([
      rawEventFor(addressForIndex(1)),
    ]);
    expect(latestTx(txs, "0xdeploytx2")?.contractEvents).toEqual([
      rawEventFor(addressForIndex(2)),
    ]);

    // 登録はデプロイ順の逆(2 → 1)で届く。
    adapter.registerContractDeployment(addressForIndex(2), "ChainvizToken");
    expect(latestTx(txs, "0xdeploytx2")?.contractEvents).toEqual([
      decodedEventFor(addressForIndex(2)),
    ]);
    // まだ登録していない tx1 は raw のまま(巻き添えで書き換わらない)。
    expect(latestTx(txs, "0xdeploytx1")?.contractEvents).toEqual([
      rawEventFor(addressForIndex(1)),
    ]);

    adapter.registerContractDeployment(addressForIndex(1), "ChainvizToken");
    expect(latestTx(txs, "0xdeploytx1")?.contractEvents).toEqual([
      decodedEventFor(addressForIndex(1)),
    ]);
  });

  it("re-decodes only once when the same catalog registration arrives twice (idempotent, no duplicate re-emit)", async () => {
    // 登録経路(deployContract の完了コールバック)が二重に発火しても、最初の
    // 呼び出しでバッファのエントリを消費するため、二度目は再配信しない。
    const ws = controllableWsClient();
    const blocks: Record<string, unknown> = {};
    const adapter = new EthereumAdapter(pollerWithOneReth(), {
      ethWsClient: ws.client,
      ethRpcClient: countingRpcClient(blocks, []),
      catalog,
    });
    const txs: TransactionEntity[] = [];
    await adapter.subscribeTransactions((t) => txs.push(t));
    await adapter.subscribeContracts(() => {});

    blocks["0xblockA"] = [deployReceipt(3)];
    ws.emitHead("ws://172.28.1.1:8546", header({ hash: "0xblockA" }));
    await flushAsync();

    adapter.registerContractDeployment(addressForIndex(3), "ChainvizToken");
    const emitsAfterFirst = txs.filter((t) => t.hash === "0xdeploytx3").length;
    expect(latestTx(txs, "0xdeploytx3")?.contractEvents).toEqual([
      decodedEventFor(addressForIndex(3)),
    ]);

    // 二度目の登録: registerDeployment は既に既知なので昇格を検知せず、
    // かつバッファも空。tx の再配信は起きない。
    adapter.registerContractDeployment(addressForIndex(3), "ChainvizToken");
    const emitsAfterSecond = txs.filter((t) => t.hash === "0xdeploytx3").length;
    expect(emitsAfterSecond).toBe(emitsAfterFirst);
  });

  it("leaves a never-registered deploy tx raw and does not touch it when a different address registers", async () => {
    // カタログに実際に存在しない(=永久に登録が来ない)コントラクトのデプロイ
    // tx は生値のまま残る。別アドレスの登録が届いても影響しない。バッファに
    // エントリが残り続けるが、上限200で自然に解消される(別テストで境界確認)。
    const ws = controllableWsClient();
    const blocks: Record<string, unknown> = {};
    const adapter = new EthereumAdapter(pollerWithOneReth(), {
      ethWsClient: ws.client,
      ethRpcClient: countingRpcClient(blocks, []),
      catalog,
    });
    const txs: TransactionEntity[] = [];
    await adapter.subscribeTransactions((t) => txs.push(t));
    await adapter.subscribeContracts(() => {});

    blocks["0xblockB"] = [deployReceipt(4)];
    ws.emitHead("ws://172.28.1.1:8546", header({ hash: "0xblockB" }));
    await flushAsync();
    expect(latestTx(txs, "0xdeploytx4")?.contractEvents).toEqual([
      rawEventFor(addressForIndex(4)),
    ]);

    const emitsBefore = txs.filter((t) => t.hash === "0xdeploytx4").length;
    // 全く別のアドレス(バッファに存在しない)の登録。
    adapter.registerContractDeployment(addressForIndex(999), "ChainvizToken");
    // 元の未登録 tx は raw のまま・再配信されない。
    expect(latestTx(txs, "0xdeploytx4")?.contractEvents).toEqual([
      rawEventFor(addressForIndex(4)),
    ]);
    expect(txs.filter((t) => t.hash === "0xdeploytx4")).toHaveLength(emitsBefore);
  });

  it("does not evict at exactly the buffer cap (200): the oldest buffered entry is still re-decodable", async () => {
    // 上限+1 で最古が落ちることは deploy-event-redecode.test.ts が確認済み。
    // ここは境界の反対側: ちょうど上限(200)ではまだ evict が起きず、最古
    // (index 0)のエントリも再復号できることを確認する。
    const ws = controllableWsClient();
    const blocks: Record<string, unknown> = {};
    const adapter = new EthereumAdapter(pollerWithOneReth(), {
      ethWsClient: ws.client,
      ethRpcClient: countingRpcClient(blocks, []),
      catalog,
    });
    const txs: TransactionEntity[] = [];
    await adapter.subscribeTransactions((t) => txs.push(t));
    await adapter.subscribeContracts(() => {});

    const bufferCap = 200;
    for (let i = 0; i < bufferCap; i++) {
      const blockHash = `0xcapblock${i}`;
      blocks[blockHash] = [deployReceipt(i)];
      ws.emitHead("ws://172.28.1.1:8546", header({ hash: blockHash }));
      await flushAsync();
    }

    // ちょうど上限なので最古(index 0)はまだバッファに残っている。
    adapter.registerContractDeployment(addressForIndex(0), "ChainvizToken");
    expect(latestTx(txs, "0xdeploytx0")?.contractEvents).toEqual([
      decodedEventFor(addressForIndex(0)),
    ]);
  });

  it("adds no RPC calls beyond one eth_getBlockReceipts per block when self-healing", async () => {
    // Issue #86 の方針(ブロックあたり eth_getBlockReceipts 1回に集約し、
    // 再復号のために追加の RPC を発生させない)が維持されていることを、
    // 実際の呼び出し回数で検証する。
    const ws = controllableWsClient();
    const blocks: Record<string, unknown> = {};
    const calls: string[] = [];
    const adapter = new EthereumAdapter(pollerWithOneReth(), {
      ethWsClient: ws.client,
      ethRpcClient: countingRpcClient(blocks, calls),
      catalog,
    });
    const txs: TransactionEntity[] = [];
    await adapter.subscribeTransactions((t) => txs.push(t));
    await adapter.subscribeContracts(() => {});

    blocks["0xrpcblock"] = [deployReceipt(5)];
    ws.emitHead("ws://172.28.1.1:8546", header({ hash: "0xrpcblock" }));
    await flushAsync();
    // ブロック取り込みで1回だけ。
    expect(calls).toEqual(["eth_getBlockReceipts"]);

    // 登録による再復号は手元の生ログを使うので RPC を増やさない。
    adapter.registerContractDeployment(addressForIndex(5), "ChainvizToken");
    expect(latestTx(txs, "0xdeploytx5")?.contractEvents).toEqual([
      decodedEventFor(addressForIndex(5)),
    ]);
    expect(calls).toEqual(["eth_getBlockReceipts"]);
  });
});
