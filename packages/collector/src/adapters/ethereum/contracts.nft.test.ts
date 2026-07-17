// ContractTracker の NFT（ERC-721）関連の挙動（Issue #315）のテスト。
// - applyCatalog が CatalogEntry.nft を ContractEntity.nft へ転記すること
// - nftContractAddresses が nft メタ情報を持つ追跡中のコントラクトだけを
//   返すこと
// - applyNftObservation が所有台帳を反映する/しない各分岐
// name/catalogKey/token の転記と同じ経路（applyCatalog）に相乗りしている
// ため、contracts.test.ts の既存テストと同じ構図を踏襲するが、既存ファイルの
// 肥大化を避けるため NFT の観点だけをここに分離する
// （contracts.source-code.test.ts と同じ分割方針）。

import { describe, expect, it } from "vitest";
import type { ContractCatalog } from "./catalog.js";
import { ContractTracker } from "./contracts.js";

const catalog: ContractCatalog = {
  ChainvizNFT: {
    name: "ChainvizNFT",
    abi: [],
    nft: { symbol: "CVN" },
  },
  ChainvizToken: {
    name: "ChainvizToken",
    abi: [],
    token: { symbol: "CVZ", decimals: 18 },
  },
  Counter: { name: "Counter", abi: [] },
};

describe("ContractTracker nft metadata transcription (Issue #315)", () => {
  it("copies nft metadata into the entity when a pending catalog key is applied on detection", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.registerDeployment("0xnft", "ChainvizNFT");
    const entity = tracker.recordDeployment({
      address: "0xnft",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(entity?.nft).toEqual({ symbol: "CVN" });
    expect(entity?.token).toBeUndefined();
  });

  it("omits nft for a cataloged contract without nft metadata", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.registerDeployment("0xctr", "Counter");
    const entity = tracker.recordDeployment({
      address: "0xctr",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx2",
    });
    expect(entity?.nft).toBeUndefined();
  });

  it("copies nft metadata when registerDeployment is called after detection", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.recordDeployment({
      address: "0xnft",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    const updated = tracker.registerDeployment("0xnft", "ChainvizNFT");
    expect(updated?.nft).toEqual({ symbol: "CVN" });
  });
});

describe("ContractTracker.nftContractAddresses (Issue #315)", () => {
  it("returns an empty array when nothing has been deployed", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    expect(tracker.nftContractAddresses()).toEqual([]);
  });

  it("excludes tracked token contracts (token and nft are mutually exclusive axes)", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.registerDeployment("0xtok", "ChainvizToken");
    tracker.recordDeployment({
      address: "0xtok",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(tracker.nftContractAddresses()).toEqual([]);
  });

  it("excludes untracked / uncataloged (unknown) contracts", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.recordDeployment({
      address: "0xunknown",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(tracker.nftContractAddresses()).toEqual([]);
  });

  it("includes a deployed, cataloged nft contract's normalized address", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.registerDeployment("0xNFT", "ChainvizNFT");
    tracker.recordDeployment({
      address: "0xNFT",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(tracker.nftContractAddresses()).toEqual(["0xnft"]);
  });

  it("includes nft contracts alongside (and separately from) token contracts", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.registerDeployment("0xnft", "ChainvizNFT");
    tracker.recordDeployment({
      address: "0xnft",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    tracker.registerDeployment("0xtok", "ChainvizToken");
    tracker.recordDeployment({
      address: "0xtok",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx2",
    });
    expect(tracker.nftContractAddresses()).toEqual(["0xnft"]);
    expect(tracker.tokenContractAddresses()).toEqual(["0xtok"]);
  });
});

describe("ContractTracker.applyNftObservation (Issue #315)", () => {
  function trackedNftContract(tracker: ContractTracker, address: string): void {
    tracker.registerDeployment(address, "ChainvizNFT");
    tracker.recordDeployment({
      address,
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
  }

  it("sets nftTokens on a tracked nft contract that has no ledger yet", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    trackedNftContract(tracker, "0xnft");

    const updated = tracker.applyNftObservation("0xnft", [
      { tokenId: "1", ownerAddress: "0xowner1" },
    ]);
    expect(updated?.nftTokens).toEqual([
      { tokenId: "1", ownerAddress: "0xowner1" },
    ]);
    expect(tracker.get("0xnft")?.nftTokens).toEqual([
      { tokenId: "1", ownerAddress: "0xowner1" },
    ]);
  });

  it("replaces the ledger wholesale on a subsequent successful observation", () => {
    // ステートレスな全件洗い替え方式: 前回台帳の内容は考慮せず、今回の観測
    // 結果がそのまま新しい台帳になる（tokenId 単位でのマージはしない）。
    const tracker = new ContractTracker("ethereum", catalog);
    trackedNftContract(tracker, "0xnft");
    tracker.applyNftObservation("0xnft", [
      { tokenId: "1", ownerAddress: "0xowner1" },
    ]);

    const updated = tracker.applyNftObservation("0xnft", [
      { tokenId: "1", ownerAddress: "0xowner2" },
      { tokenId: "2", ownerAddress: "0xowner3" },
    ]);
    expect(updated?.nftTokens).toEqual([
      { tokenId: "1", ownerAddress: "0xowner2" },
      { tokenId: "2", ownerAddress: "0xowner3" },
    ]);
  });

  it("keeps the previous ledger untouched (returns null) when tokens is undefined (this cycle's fetch failed)", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    trackedNftContract(tracker, "0xnft");
    tracker.applyNftObservation("0xnft", [
      { tokenId: "1", ownerAddress: "0xowner1" },
    ]);

    const result = tracker.applyNftObservation("0xnft", undefined);
    expect(result).toBeNull();
    expect(tracker.get("0xnft")?.nftTokens).toEqual([
      { tokenId: "1", ownerAddress: "0xowner1" },
    ]);
  });

  it("records an empty ledger as [] (observed but nothing minted yet), distinct from undefined", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    trackedNftContract(tracker, "0xnft");

    const updated = tracker.applyNftObservation("0xnft", []);
    expect(updated?.nftTokens).toEqual([]);
  });

  it("returns null and does nothing for an untracked address", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    const result = tracker.applyNftObservation("0xabsent", [
      { tokenId: "1", ownerAddress: "0xowner1" },
    ]);
    expect(result).toBeNull();
  });

  it("returns null and does nothing for a tracked contract without nft metadata (e.g. a token contract)", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.registerDeployment("0xtok", "ChainvizToken");
    tracker.recordDeployment({
      address: "0xtok",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    const result = tracker.applyNftObservation("0xtok", [
      { tokenId: "1", ownerAddress: "0xowner1" },
    ]);
    expect(result).toBeNull();
    expect(tracker.get("0xtok")?.nftTokens).toBeUndefined();
  });

  it("returns null and does nothing for a tracked but uncataloged (unknown) contract", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.recordDeployment({
      address: "0xunknown",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    const result = tracker.applyNftObservation("0xunknown", [
      { tokenId: "1", ownerAddress: "0xowner1" },
    ]);
    expect(result).toBeNull();
  });

  it("normalizes address casing the same way as get()", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    trackedNftContract(tracker, "0xnft");
    const updated = tracker.applyNftObservation("0xNFT", [
      { tokenId: "1", ownerAddress: "0xowner1" },
    ]);
    expect(updated?.address).toBe("0xnft");
  });
});
