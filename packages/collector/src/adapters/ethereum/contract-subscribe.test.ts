import type { ContractEntity } from "@chainviz/shared";
import { describe, expect, it, vi } from "vitest";
import { DockerPoller } from "../../docker/poller.js";
import type { ContractCatalog } from "./catalog.js";
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

describe("EthereumAdapter.subscribeContracts (Issue #161)", () => {
  it("emits an unknown-contract entity when a deployment is detected with no catalog registration", async () => {
    // subscribeContracts は専用の購読を張らず、subscribeTransactions が既に
    // 張っている newHeads 購読（handleBlockInclusion）を共有する
    // （docs/ARCHITECTURE.md §4）。
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      txs: { "0xdeploy": { hash: "0xdeploy", from: "0xdeployer", to: null, input: "0x" } },
      blocks: {
        "0xblock1": [
          {
            transactionHash: "0xdeploy",
            from: "0xdeployer",
            to: null,
            status: "0x1",
            contractAddress: "0xnewcontract",
          },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const contracts: ContractEntity[] = [];

    await adapter.subscribeTransactions(() => {});
    await adapter.subscribeContracts((c) => contracts.push(c));
    ws.emitPending("ws://172.28.1.1:8546", "0xdeploy");
    await flushAsync();
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    expect(contracts).toEqual<ContractEntity[]>([
      {
        kind: "contract",
        address: "0xnewcontract",
        chainType: "ethereum",
        deployerAddress: "0xdeployer",
        createdByTxHash: "0xdeploy",
      },
    ]);
  });

  it("fills in name/catalogKey/token when the deployed address was pre-registered via registerContractDeployment", async () => {
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
            contractAddress: "0xnewcontract",
          },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
      catalog: testCatalog,
    });
    const contracts: ContractEntity[] = [];

    await adapter.subscribeTransactions(() => {});
    await adapter.subscribeContracts((c) => contracts.push(c));
    // runWorkbenchOperation(deployContract) 経由でデプロイ先アドレスが判明した
    // 直後にコマンド処理側が呼ぶ想定（Issue #163）。
    adapter.registerContractDeployment("0xnewcontract", "ChainvizToken");

    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    expect(contracts).toEqual<ContractEntity[]>([
      {
        kind: "contract",
        address: "0xnewcontract",
        chainType: "ethereum",
        deployerAddress: "0xdeployer",
        createdByTxHash: "0xdeploy",
        name: "ChainvizToken",
        catalogKey: "ChainvizToken",
        token: { symbol: "CVZ", decimals: 18 },
      },
    ]);
  });

  it("emits an entityUpdated-style refresh when registerContractDeployment is called after detection", async () => {
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
            contractAddress: "0xnewcontract",
          },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
      catalog: testCatalog,
    });
    const contracts: ContractEntity[] = [];

    await adapter.subscribeTransactions(() => {});
    await adapter.subscribeContracts((c) => contracts.push(c));

    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();
    expect(contracts).toHaveLength(1);
    expect(contracts[0].name).toBeUndefined();

    // カタログキーの登録がブロック検知より後になるケース（手動デプロイ後に
    // 追って照合するような運用も含めて許容する）。
    adapter.registerContractDeployment("0xnewcontract", "ChainvizToken");
    expect(contracts).toHaveLength(2);
    expect(contracts[1]).toEqual<ContractEntity>({
      kind: "contract",
      address: "0xnewcontract",
      chainType: "ethereum",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xdeploy",
      name: "ChainvizToken",
      catalogKey: "ChainvizToken",
      token: { symbol: "CVZ", decimals: 18 },
    });
  });

  it("does not emit a contract for an ordinary tx (no contractAddress in the receipt)", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      blocks: {
        "0xblock1": [
          { transactionHash: "0xt1", from: "0xa", to: "0xb", status: "0x1" },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const contracts: ContractEntity[] = [];

    await adapter.subscribeTransactions(() => {});
    await adapter.subscribeContracts((c) => contracts.push(c));
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    expect(contracts).toEqual([]);
  });

  it("emits a deployment only once even when several nodes announce the same block", async () => {
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
      ]),
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
            contractAddress: "0xnewcontract",
          },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const contracts: ContractEntity[] = [];

    await adapter.subscribeTransactions(() => {});
    await adapter.subscribeContracts((c) => contracts.push(c));
    ws.emit("ws://172.28.1.1:8546", header());
    ws.emit("ws://172.28.1.2:8546", header());
    await flushAsync();

    expect(contracts).toHaveLength(1);
  });

  it("does not throw and simply does not emit when subscribeContracts was never called", async () => {
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
            contractAddress: "0xnewcontract",
          },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });

    await adapter.subscribeTransactions(() => {});
    // subscribeContracts を呼ばないまま block inclusion が走っても例外は
    // 起きない（registerContractDeployment を後から呼んでも onContract が
    // 無いので何も配信されない）。
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();
    expect(() =>
      adapter.registerContractDeployment("0xnewcontract", "ChainvizToken"),
    ).not.toThrow();
  });

  it("emits a separate contract for each deployment tx in a single block", async () => {
    // 1 ブロックに複数のコントラクト作成 tx が含まれるケース。receipts を
    // 走査してそれぞれ別の ContractEntity として配信する（1 件だけ・
    // 取り違えが起きない）。
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      blocks: {
        "0xblock1": [
          {
            transactionHash: "0xdeployA",
            from: "0xdeployerA",
            to: null,
            status: "0x1",
            contractAddress: "0xcontractA",
          },
          {
            transactionHash: "0xordinary",
            from: "0xa",
            to: "0xb",
            status: "0x1",
          },
          {
            transactionHash: "0xdeployB",
            from: "0xdeployerB",
            to: null,
            status: "0x1",
            contractAddress: "0xcontractB",
          },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const contracts: ContractEntity[] = [];

    await adapter.subscribeTransactions(() => {});
    await adapter.subscribeContracts((c) => contracts.push(c));
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    // ContractTracker はアドレスを小文字に正規化する（Issue #161 レビュー
    // 差し戻し: reth の receipt が小文字、forge の "Deployed to:" がチェックサム
    // 表記であるための合流対応）ため、入力が大小混在でも小文字で配信される。
    expect(contracts.map((c) => c.address)).toEqual([
      "0xcontracta",
      "0xcontractb",
    ]);
    expect(contracts.map((c) => c.deployerAddress)).toEqual([
      "0xdeployerA",
      "0xdeployerB",
    ]);
  });

  it("does not emit or throw when registerContractDeployment is called with an unknown catalog key", async () => {
    // アダプタ層の registerContractDeployment に、カタログに無いキーが渡って
    // きても（コマンド処理側のバグ・カタログ更新漏れなど）、tracker が null を
    // 返し onContract は呼ばれない（黙って握りつぶすのではなく tracker 側で
    // 警告ログを出す。ここでは配信が起きないことと例外が起きないことを固定）。
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({ blocks: {} });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
      catalog: testCatalog,
    });
    const contracts: ContractEntity[] = [];

    await adapter.subscribeTransactions(() => {});
    await adapter.subscribeContracts((c) => contracts.push(c));

    expect(() =>
      adapter.registerContractDeployment("0xnewcontract", "NoSuchKey"),
    ).not.toThrow();
    expect(contracts).toEqual([]);
    warnSpy.mockRestore();
  });
});

describe("EthereumAdapter.trackedTokenContractAddresses (Issue #164)", () => {
  it("returns an empty array when no contract has been deployed", () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const adapter = new EthereumAdapter(poller, { catalog: testCatalog });
    expect(adapter.trackedTokenContractAddresses()).toEqual([]);
  });

  it("includes a deployed token contract's address once detected via block inclusion", async () => {
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

    expect(adapter.trackedTokenContractAddresses()).toEqual(["0xnewtoken"]);
  });

  it("excludes a deployed contract that is not cataloged as a token", async () => {
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
            contractAddress: "0xunknowncontract",
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
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    // カタログ未照合（未知のコントラクト）は token を持たないので対象外。
    expect(adapter.trackedTokenContractAddresses()).toEqual([]);
  });
});
