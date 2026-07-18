// EthereumNodeLifecycle（GUI の定型操作の実行）と EthereumAdapter（コントラクト
// カタログ照合)を、index.ts の main() と同じ「コールバック注入」で結合したときの
// 一連の流れ（deployContract 実行 → registerContractDeployment 呼び出し →
// ContractEntity への catalogKey 反映）を検証する統合テスト。
//
// node-lifecycle.test.ts は EthereumNodeLifecycle 単体でコールバックが正しい
// 引数で呼ばれることを、peer-block-adapter.test.ts は EthereumAdapter 単体で
// registerContractDeployment がカタログ照合を行うことを、それぞれ検証済み。
// このファイルはその2つを実際に配線したときに end-to-end で機能することを
// 確認する（Issue #161: node-lifecycle 側からの呼び出しが欠落していた問題の
// 回帰テスト）。

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ContractEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { DockerPoller } from "../../docker/poller.js";
import type {
  DockerClient,
  DockerContainerSummary,
  DockerStatsResult,
  DockerTopResult,
} from "../../docker/types.js";
import type {
  CreatedContainer,
  DockerOperations,
  ExecResult,
  LabeledContainer,
} from "../../docker/operations.js";
import type { ContractCatalog } from "./catalog.js";
import type { EthRpcClient } from "./eth-rpc-client.js";
import type { EthWsClient, NewHeadHeader, Subscription } from "./eth-ws-client.js";
import { EthereumAdapter } from "./index.js";
import { EthereumNodeLifecycle } from "./node-lifecycle.js";

const zeroStats: DockerStatsResult = {
  cpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
  precpu_stats: { cpu_usage: { total_usage: 0 } },
  memory_stats: {},
};

/** subscribeTransactions/subscribeContracts が必要とする最小限の DockerPoller。 */
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

/** newHeads/pending の購読を手動で発火できるフェイク EthWsClient。 */
function controllableWsClient(): {
  client: EthWsClient;
  emit: (wsUrl: string, header: NewHeadHeader) => void;
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
    emit: (wsUrl, header) => {
      for (const handler of headHandlers.get(wsUrl) ?? []) handler(header);
    },
  };
}

/** eth_getBlockReceipts を固定データで返すフェイク EthRpcClient。 */
function stubRpcClient(blocks: Record<string, unknown>): EthRpcClient {
  return {
    async call<T>(_url: string, method: string, params: unknown[]): Promise<T> {
      if (method === "eth_getBlockReceipts") {
        return (blocks[params[0] as string] ?? null) as T;
      }
      throw new Error(`unexpected RPC method ${method}`);
    },
  };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** exec が指定した stdout を返すフェイク DockerOperations（ワークベンチ1件を管理下に持つ）。 */
function fakeDockerOperations(stdout: string): DockerOperations {
  const workbench: LabeledContainer = {
    id: "wb-cid",
    labels: {
      "com.docker.compose.project": "chainviz-ethereum",
      "com.docker.compose.service": "Alice",
    },
  };
  return {
    createAndStart: async (): Promise<CreatedContainer> => ({
      id: "unused",
    }),
    stopAndRemove: async (): Promise<void> => {},
    usedNetworkIps: async (): Promise<string[]> => [],
    listContainersByLabels: async (): Promise<LabeledContainer[]> => [workbench],
    exec: async (): Promise<ExecResult> => ({
      exitCode: 0,
      stdout,
      stderr: "",
    }),
  };
}

const testCatalog: ContractCatalog = {
  ChainvizToken: {
    name: "ChainvizToken",
    abi: [],
    token: { symbol: "CVZDEMO", decimals: 18 },
  },
};

function header(overrides: Partial<NewHeadHeader> = {}): NewHeadHeader {
  return {
    hash: "0xblock1",
    number: "0x10",
    parentHash: "0xparent",
    timestamp: "0x64",
    ...overrides,
  };
}

describe("EthereumNodeLifecycle + EthereumAdapter contract deploy wiring (Issue #161)", () => {
  /** mnemonic 付きの一時 profileDir を用意する。 */
  function tmpProfileDir(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "chainviz-profile-"));
    writeFileSync(
      path.join(dir, "values.env"),
      'export EL_AND_CL_MNEMONIC="alpha bravo charlie"\n',
    );
    return dir;
  }

  it("propagates a deployContract's deployed address to the adapter's contract catalog, whichever order detection and the deploy command complete in", async () => {
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      "0xblock1": [
        {
          transactionHash: "0xdeploytx",
          from: "0xdeployer",
          to: null,
          status: "0x1",
          contractAddress: "0x2222222222222222222222222222222222222222",
        },
      ],
    });
    const adapter = new EthereumAdapter(pollerWithOneReth(), {
      ethWsClient: ws.client,
      ethRpcClient: rpc,
      catalog: testCatalog,
    });
    const contracts: ContractEntity[] = [];
    await adapter.subscribeTransactions(() => {});
    await adapter.subscribeContracts((c) => contracts.push(c));

    // index.ts の main() と同じ配線: lifecycle の onContractDeployed から
    // adapter.registerContractDeployment を呼ぶ。
    const lifecycle = new EthereumNodeLifecycle(
      fakeDockerOperations(
        [
          "Deployed to: 0x2222222222222222222222222222222222222222",
          "Transaction hash: 0xdeploytx",
        ].join("\n"),
      ),
      {
        profileDir: tmpProfileDir(),
        ethRpcUrl: "http://host.docker.internal:4001",
        onContractDeployed: (address, contractKey) =>
          adapter.registerContractDeployment(address, contractKey),
      },
    );

    // GUI の定型操作からデプロイを実行する（ブロックにまだ取り込まれていない
    // 段階なので、この時点ではカタログキーは pending として保留される）。
    const result = await lifecycle.runWorkbenchOperation(
      "chainviz-ethereum/Alice",
      { type: "deployContract", contractKey: "ChainvizToken" },
    );
    expect(result.deployedAddress).toBe("0x2222222222222222222222222222222222222222");
    expect(contracts).toEqual([]); // まだブロック取り込みを検知していない

    // ブロック取り込みが検知されると、保留されていたカタログキーが適用された
    // 状態で ContractEntity が配信される。
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    expect(contracts).toEqual<ContractEntity[]>([
      {
        kind: "contract",
        address: "0x2222222222222222222222222222222222222222",
        chainType: "ethereum",
        deployerAddress: "0xdeployer",
        createdByTxHash: "0xdeploytx",
        name: "ChainvizToken",
        catalogKey: "ChainvizToken",
        token: { symbol: "CVZDEMO", decimals: 18 },
      },
    ]);
  });

  it("also reflects the catalogKey when block inclusion is detected before the deploy command's callback fires", async () => {
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      "0xblock1": [
        {
          transactionHash: "0xdeploytx",
          from: "0xdeployer",
          to: null,
          status: "0x1",
          contractAddress: "0x2222222222222222222222222222222222222222",
        },
      ],
    });
    const adapter = new EthereumAdapter(pollerWithOneReth(), {
      ethWsClient: ws.client,
      ethRpcClient: rpc,
      catalog: testCatalog,
    });
    const contracts: ContractEntity[] = [];
    await adapter.subscribeTransactions(() => {});
    await adapter.subscribeContracts((c) => contracts.push(c));

    const lifecycle = new EthereumNodeLifecycle(
      fakeDockerOperations(
        [
          "Deployed to: 0x2222222222222222222222222222222222222222",
          "Transaction hash: 0xdeploytx",
        ].join("\n"),
      ),
      {
        profileDir: tmpProfileDir(),
        ethRpcUrl: "http://host.docker.internal:4001",
        onContractDeployed: (address, contractKey) =>
          adapter.registerContractDeployment(address, contractKey),
      },
    );

    // 先にブロック取り込みが検知される（「未知のコントラクト」として一度配信）。
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();
    expect(contracts).toHaveLength(1);
    expect(contracts[0].catalogKey).toBeUndefined();

    // その後 deployContract の完了コールバックが届き、entityUpdated 相当で
    // catalogKey が反映される。
    await lifecycle.runWorkbenchOperation("chainviz-ethereum/Alice", {
      type: "deployContract",
      contractKey: "ChainvizToken",
    });

    expect(contracts).toHaveLength(2);
    expect(contracts[1]).toEqual<ContractEntity>({
      kind: "contract",
      address: "0x2222222222222222222222222222222222222222",
      chainType: "ethereum",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xdeploytx",
      name: "ChainvizToken",
      catalogKey: "ChainvizToken",
      token: { symbol: "CVZDEMO", decimals: 18 },
    });
  });

  it("does not re-emit when the same address is deployed again after it is already cataloged", async () => {
    // 同じアドレスへ deployContract を繰り返した場合（学習用途で同一
    // コントラクトを再デプロイ、あるいは GUI の二度押しなど）に、既に
    // 同じ catalogKey で照合済みのコントラクトを重複配信しないこと（tracker の
    // 「変化なし → null」経路が end-to-end で効くこと）を確認する。
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      "0xblock1": [
        {
          transactionHash: "0xdeploytx",
          from: "0xdeployer",
          to: null,
          status: "0x1",
          contractAddress: "0x2222222222222222222222222222222222222222",
        },
      ],
    });
    const adapter = new EthereumAdapter(pollerWithOneReth(), {
      ethWsClient: ws.client,
      ethRpcClient: rpc,
      catalog: testCatalog,
    });
    const contracts: ContractEntity[] = [];
    await adapter.subscribeTransactions(() => {});
    await adapter.subscribeContracts((c) => contracts.push(c));

    const lifecycle = new EthereumNodeLifecycle(
      fakeDockerOperations(
        [
          "Deployed to: 0x2222222222222222222222222222222222222222",
          "Transaction hash: 0xdeploytx",
        ].join("\n"),
      ),
      {
        profileDir: tmpProfileDir(),
        ethRpcUrl: "http://host.docker.internal:4001",
        onContractDeployed: (address, contractKey) =>
          adapter.registerContractDeployment(address, contractKey),
      },
    );

    await lifecycle.runWorkbenchOperation("chainviz-ethereum/Alice", {
      type: "deployContract",
      contractKey: "ChainvizToken",
    });
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();
    expect(contracts).toHaveLength(1);
    expect(contracts[0].catalogKey).toBe("ChainvizToken");

    // 2 回目のデプロイ（同一アドレス・同一キー）。登録は変化を生まないので
    // 追加の配信は起きない。
    await lifecycle.runWorkbenchOperation("chainviz-ethereum/Alice", {
      type: "deployContract",
      contractKey: "ChainvizToken",
    });
    expect(contracts).toHaveLength(1);
  });

  it("reconciles a GUI deployContract with block-inclusion detection even when their address casing differs, as observed with reth + foundry (Issue #161 review follow-up)", async () => {
    // 実測（chainviz-reviewer, 2026-07-07）: `forge create` の "Deployed to:"
    // 行は EIP-55 チェックサム表記（大小混在）を出力するが、reth の
    // eth_getBlockReceipts の contractAddress は全小文字で返る。同一
    // コントラクトのはずのこの2つの表記が一致しないと、
    // registerContractDeployment（チェックサム表記）と
    // detectContractDeployments（小文字表記）が別アドレスとして扱われ、
    // catalogKey がカタログ照合済みコントラクトへ反映されない。
    const checksummed = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    const lowercased = "0x5fbdb2315678afecb367f032d93f642f64180aa3";

    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      "0xblock1": [
        {
          transactionHash: "0xdeploytx",
          from: "0xdeployer",
          to: null,
          status: "0x1",
          contractAddress: lowercased,
        },
      ],
    });
    const adapter = new EthereumAdapter(pollerWithOneReth(), {
      ethWsClient: ws.client,
      ethRpcClient: rpc,
      catalog: testCatalog,
    });
    const contracts: ContractEntity[] = [];
    await adapter.subscribeTransactions(() => {});
    await adapter.subscribeContracts((c) => contracts.push(c));

    const lifecycle = new EthereumNodeLifecycle(
      fakeDockerOperations(
        [
          `Deployed to: ${checksummed}`,
          "Transaction hash: 0xdeploytx",
        ].join("\n"),
      ),
      {
        profileDir: tmpProfileDir(),
        ethRpcUrl: "http://host.docker.internal:4001",
        onContractDeployed: (address, contractKey) =>
          adapter.registerContractDeployment(address, contractKey),
      },
    );

    await lifecycle.runWorkbenchOperation("chainviz-ethereum/Alice", {
      type: "deployContract",
      contractKey: "ChainvizToken",
    });
    // registerContractDeployment の時点ではまだブロック取り込みを検知して
    // いないので pending として保留されるだけで配信は起きない。
    expect(contracts).toEqual([]);

    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    // casing の違いにかかわらず同一コントラクトとして合流し、catalogKey が
    // 反映された1件だけが配信される（2件の別コントラクトとして扱われない）。
    expect(contracts).toHaveLength(1);
    expect(contracts[0].catalogKey).toBe("ChainvizToken");
    expect(contracts[0].name).toBe("ChainvizToken");
  });
});
