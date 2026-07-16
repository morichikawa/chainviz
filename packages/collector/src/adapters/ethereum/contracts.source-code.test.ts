// ContractTracker がカタログ照合時に CatalogEntry.source を
// ContractEntity.sourceCode へ転記する挙動（Issue #321）のテスト。
// name/catalogKey/token の転記と同じ経路（applyCatalog）に相乗りしている
// ため、contracts.test.ts の既存テストと同じ構図（recordDeployment /
// registerDeployment の順序違い）を踏襲するが、既存ファイルの肥大化を
// 避けるためソースコード転記の観点だけをここに分離する。

import { describe, expect, it } from "vitest";
import type { ContractCatalog } from "./catalog.js";
import { ContractTracker } from "./contracts.js";

const catalogWithSource: ContractCatalog = {
  ChainvizToken: {
    name: "ChainvizToken",
    abi: [],
    token: { symbol: "CVZ", decimals: 18 },
    source: {
      fileName: "ChainvizToken.sol",
      language: "solidity",
      code: "contract ChainvizToken {}",
    },
  },
  // ソース未同梱のカタログエントリ（例: build-catalog.sh 生成前の旧
  // catalog.json、または将来カタログに追加されたが src が無いエントリ）。
  Counter: { name: "Counter", abi: [] },
};

describe("ContractTracker sourceCode transcription (Issue #321)", () => {
  it("copies source into sourceCode when a pending catalog key is applied on detection", () => {
    const tracker = new ContractTracker("ethereum", catalogWithSource);
    tracker.registerDeployment("0xnew", "ChainvizToken");
    const entity = tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(entity?.sourceCode).toEqual({
      fileName: "ChainvizToken.sol",
      language: "solidity",
      code: "contract ChainvizToken {}",
    });
  });

  it("copies source into sourceCode when registerDeployment applies to an already-detected contract", () => {
    // 未知→既知昇格（Issue #244 の自己修復）と同じ経路。entityUpdated 相当。
    const tracker = new ContractTracker("ethereum", catalogWithSource);
    tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    const updated = tracker.registerDeployment("0xnew", "ChainvizToken");
    expect(updated?.sourceCode).toEqual({
      fileName: "ChainvizToken.sol",
      language: "solidity",
      code: "contract ChainvizToken {}",
    });
  });

  it("omits sourceCode for a cataloged contract whose catalog entry has no source", () => {
    const tracker = new ContractTracker("ethereum", catalogWithSource);
    tracker.registerDeployment("0xctr", "Counter");
    const entity = tracker.recordDeployment({
      address: "0xctr",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx2",
    });
    expect(entity?.name).toBe("Counter");
    expect(entity?.sourceCode).toBeUndefined();
  });

  it("omits sourceCode for an unknown (uncataloged) contract", () => {
    const tracker = new ContractTracker("ethereum", catalogWithSource);
    const entity = tracker.recordDeployment({
      address: "0xunknown",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx3",
    });
    expect(entity?.sourceCode).toBeUndefined();
  });

  it("does not mutate the shared CatalogEntry.source object (defensive copy)", () => {
    // applyCatalog はフィールドごとに新しいオブジェクトを組み立てる。将来の
    // 変更でカタログ側のオブジェクト参照をそのまま渡してしまう回帰を防ぐ。
    const tracker = new ContractTracker("ethereum", catalogWithSource);
    tracker.registerDeployment("0xnew", "ChainvizToken");
    const entity = tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(entity?.sourceCode).not.toBe(catalogWithSource.ChainvizToken.source);
  });
});
