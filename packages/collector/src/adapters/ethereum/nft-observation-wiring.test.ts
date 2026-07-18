// EthereumAdapter.trackedNftContractAddresses / applyNftObservation
// （Issue #315）が ContractTracker への委譲と onContract コールバックへの
// 中継を正しく行うことの単体テスト。ContractTracker 自体の詳細な分岐
// （マージの有無・casing 正規化等）は contracts.nft.test.ts で確認済み
// なので、ここでは EthereumAdapter が正しく配線されていることだけを見る
// （registerContractDeployment を検証する contract-subscribe.test.ts /
// contract-deploy-wiring.test.ts と同じ構図・同じ fixture ヘルパーを使う）。

import type { ContractEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { DockerPoller } from "../../docker/poller.js";
import type { ContractCatalog } from "./catalog.js";
import { EthereumAdapter } from "./index.js";
import { clientFrom, rethFixture } from "./test-helpers/docker-fixtures.js";
import { flushAsync, stubRpcClient } from "./test-helpers/tx-rpc-fixtures.js";
import { controllableWsClient, header } from "./test-helpers/ws-fixtures.js";

const testCatalog: ContractCatalog = {
  ChainvizNFT: {
    name: "ChainvizNFT",
    abi: [],
    nft: { symbol: "CVNDEMO" },
  },
  ChainvizToken: {
    name: "ChainvizToken",
    abi: [],
    token: { symbol: "CVZDEMO", decimals: 18 },
  },
};

/**
 * ブロック取り込み検知（handleBlockInclusion）経由で、指定アドレスを
 * catalogKey で照合済みの「追跡中コントラクト」にする。registerDeployment
 * だけでは検知前は pending のまま追跡マップに載らない（contracts.ts 参照）
 * ため、実際のブロック取り込み検知フローを通す。
 */
async function deployAndCatalog(
  adapter: EthereumAdapter,
  ws: ReturnType<typeof controllableWsClient>,
  address: string,
  catalogKey: string,
): Promise<void> {
  adapter.registerContractDeployment(address, catalogKey);
  ws.emit("ws://172.28.1.1:8546", header());
  await flushAsync();
}

async function newAdapter(): Promise<{
  adapter: EthereumAdapter;
  ws: ReturnType<typeof controllableWsClient>;
}> {
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
          contractAddress: "0xnft",
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
  return { adapter, ws };
}

describe("EthereumAdapter.trackedNftContractAddresses (Issue #315)", () => {
  it("returns the address of a deployed, cataloged nft contract", async () => {
    const { adapter, ws } = await newAdapter();
    await deployAndCatalog(adapter, ws, "0xnft", "ChainvizNFT");
    expect(adapter.trackedNftContractAddresses()).toEqual(["0xnft"]);
  });

  it("returns an empty array when nothing has been deployed", async () => {
    const { adapter } = await newAdapter();
    expect(adapter.trackedNftContractAddresses()).toEqual([]);
  });
});

describe("EthereumAdapter.applyNftObservation (Issue #315)", () => {
  it("forwards the merged entity to the onContract callback registered via subscribeContracts", async () => {
    const { adapter, ws } = await newAdapter();
    const contracts: ContractEntity[] = [];
    await adapter.subscribeContracts((c) => contracts.push(c));
    await deployAndCatalog(adapter, ws, "0xnft", "ChainvizNFT");
    contracts.length = 0; // デプロイ検知自体の entityAdded は対象外にする

    adapter.applyNftObservation("0xnft", [
      { tokenId: "1", ownerAddress: "0xowner1" },
    ]);

    expect(contracts).toHaveLength(1);
    expect(contracts[0].nftTokens).toEqual([
      { tokenId: "1", ownerAddress: "0xowner1" },
    ]);
  });

  it("does not invoke the onContract callback when tokens is undefined (this cycle's fetch failed)", async () => {
    const { adapter, ws } = await newAdapter();
    const contracts: ContractEntity[] = [];
    await adapter.subscribeContracts((c) => contracts.push(c));
    await deployAndCatalog(adapter, ws, "0xnft", "ChainvizNFT");
    contracts.length = 0;

    adapter.applyNftObservation("0xnft", undefined);
    expect(contracts).toEqual([]);
  });

  it("does not invoke the onContract callback for an untracked address", async () => {
    const { adapter } = await newAdapter();
    const contracts: ContractEntity[] = [];
    await adapter.subscribeContracts((c) => contracts.push(c));

    adapter.applyNftObservation("0xabsent", [
      { tokenId: "1", ownerAddress: "0xowner1" },
    ]);
    expect(contracts).toEqual([]);
  });

  it("is a no-op (does not throw) when subscribeContracts was never called", async () => {
    const { adapter, ws } = await newAdapter();
    await deployAndCatalog(adapter, ws, "0xnft", "ChainvizNFT");
    expect(() =>
      adapter.applyNftObservation("0xnft", [
        { tokenId: "1", ownerAddress: "0xowner1" },
      ]),
    ).not.toThrow();
  });
});
