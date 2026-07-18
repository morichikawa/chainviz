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
    token: { symbol: "CVZDEMO", decimals: 18 },
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

  it("gives each of two deployments of the same catalog key its own sourceCode", () => {
    // 同一カタログキー（同じ Solidity ソース）を別アドレスに 2 回デプロイした
    // 場合、それぞれ独立した ContractEntity として sourceCode を持つ。カタログ
    // 照合が複数回走ってもソースが片方に偏らず両方に転記されることを固定する。
    const tracker = new ContractTracker("ethereum", catalogWithSource);
    tracker.registerDeployment("0xaaa", "ChainvizToken");
    tracker.registerDeployment("0xbbb", "ChainvizToken");
    const first = tracker.recordDeployment({
      address: "0xaaa",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    const second = tracker.recordDeployment({
      address: "0xbbb",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx2",
    });
    const expected = {
      fileName: "ChainvizToken.sol",
      language: "solidity",
      code: "contract ChainvizToken {}",
    };
    expect(first?.sourceCode).toEqual(expected);
    expect(second?.sourceCode).toEqual(expected);
    // 2 つのエンティティが sourceCode オブジェクトを共有していないこと。
    expect(first?.sourceCode).not.toBe(second?.sourceCode);
  });

  it("keeps sourceCode intact when the same catalog key is re-registered (idempotent no-op)", () => {
    // 同じアドレス・同じカタログキーで registerDeployment が再度呼ばれた場合、
    // 2 回目は「変化なし」で null を返すが、追跡中のエンティティの sourceCode は
    // そのまま維持される（重複登録で消えたりしない）。
    const tracker = new ContractTracker("ethereum", catalogWithSource);
    tracker.registerDeployment("0xnew", "ChainvizToken");
    tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    const again = tracker.registerDeployment("0xnew", "ChainvizToken");
    expect(again).toBeNull();
    expect(tracker.get("0xnew")?.sourceCode).toEqual({
      fileName: "ChainvizToken.sol",
      language: "solidity",
      code: "contract ChainvizToken {}",
    });
  });

  it("keeps sourceCode intact when a duplicate deployment detection is ignored", () => {
    // 複数ノードが同一ブロックを重複通知するなどで recordDeployment が同じ
    // アドレスに 2 回来た場合、2 回目は null（変化なし）。1 回目で埋めた
    // sourceCode が保持される。
    const tracker = new ContractTracker("ethereum", catalogWithSource);
    tracker.registerDeployment("0xnew", "ChainvizToken");
    tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    const duplicate = tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(duplicate).toBeNull();
    expect(tracker.get("0xnew")?.sourceCode).toEqual({
      fileName: "ChainvizToken.sol",
      language: "solidity",
      code: "contract ChainvizToken {}",
    });
  });
});
