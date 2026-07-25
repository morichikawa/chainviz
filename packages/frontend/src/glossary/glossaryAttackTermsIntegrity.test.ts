// 攻撃手法解説の土台（ARCHITECTURE.md §17.3。Issue #413）で新設した6語
// (fiftyOnePercentAttack/longRangeAttack/eclipseAttack/reorg/doubleSpend/
// frontRunning) 専用のスキーマ・relatedTerms整合性テスト。既存の
// glossaryRelatedTermsIntegrity.test.ts（Issue #406のkeccak256向け）から
// 関心を分けて新規ファイルにする（CLAUDE.md「1ファイル1責務」をテスト
// ファイルにも適用）。dangling参照ゼロ・自己参照ゼロという全体不変条件は
// 既存ファイルが引き続き検証するため、ここでは新設6語固有のスキーマと
// 双方向リンクだけを見る。
import { describe, expect, it } from "vitest";
import {
  ATTACK_TERM_KEYS,
  EXPECTED_ATTACK_TERM_PLACEMENT,
} from "./attackTermsFixture.js";
import { loadRealGlossary } from "./realGlossaryFixture.js";

// 用語 YAML の読み込みと対象キーの一覧は、同じ6語を見る他のテストファイル
// （glossaryAttackTermsLocalization / Placement / Search / UiConsistency）と
// 共有する（realGlossaryFixture.ts / attackTermsFixture.ts）。
const glossary = loadRealGlossary();

const NEW_KEYS = ATTACK_TERM_KEYS;

const EXPECTED_LAYER: Record<(typeof NEW_KEYS)[number], string> = {
  fiftyOnePercentAttack: EXPECTED_ATTACK_TERM_PLACEMENT.fiftyOnePercentAttack.layer,
  longRangeAttack: EXPECTED_ATTACK_TERM_PLACEMENT.longRangeAttack.layer,
  eclipseAttack: EXPECTED_ATTACK_TERM_PLACEMENT.eclipseAttack.layer,
  reorg: EXPECTED_ATTACK_TERM_PLACEMENT.reorg.layer,
  doubleSpend: EXPECTED_ATTACK_TERM_PLACEMENT.doubleSpend.layer,
  frontRunning: EXPECTED_ATTACK_TERM_PLACEMENT.frontRunning.layer,
};

describe("attack term entries (Issue #413)", () => {
  it.each(NEW_KEYS)("%s exists and matches the expected schema (layer + non-empty {ja,en})", (key) => {
    const entry = glossary[key];
    expect(entry).toBeTruthy();
    expect(entry.layer).toBe(EXPECTED_LAYER[key]);
    expect(entry.name.ja.length).toBeGreaterThan(0);
    expect(entry.name.en.length).toBeGreaterThan(0);
    expect(entry.definition.ja.length).toBeGreaterThan(0);
    expect(entry.definition.en.length).toBeGreaterThan(0);
    // ja と en が同一（訳し忘れ）でないこと。
    expect(entry.definition.ja).not.toBe(entry.definition.en);
  });
});

describe("attack term relatedTerms (Issue #413 ARCHITECTURE.md §17.3)", () => {
  it("fiftyOnePercentAttack <-> fork <-> reorg are mutually linked", () => {
    expect(glossary.fork.relatedTerms).toContain("fiftyOnePercentAttack");
    expect(glossary.fiftyOnePercentAttack.relatedTerms).toContain("fork");
    expect(glossary.fork.relatedTerms).toContain("reorg");
    expect(glossary.reorg.relatedTerms).toContain("fork");
    expect(glossary.fiftyOnePercentAttack.relatedTerms).toContain("reorg");
    expect(glossary.reorg.relatedTerms).toContain("fiftyOnePercentAttack");
  });

  it("eclipseAttack links to peer/p2p/discovery, and each links back", () => {
    expect(glossary.eclipseAttack.relatedTerms).toEqual(
      expect.arrayContaining(["peer", "p2p", "discovery"]),
    );
    expect(glossary.peer.relatedTerms).toContain("eclipseAttack");
    expect(glossary.p2p.relatedTerms).toContain("eclipseAttack");
    expect(glossary.discovery.relatedTerms).toContain("eclipseAttack");
  });

  it("doubleSpend links to transaction/nonce, and each links back", () => {
    expect(glossary.doubleSpend.relatedTerms).toEqual(
      expect.arrayContaining(["transaction", "nonce"]),
    );
    expect(glossary.transaction.relatedTerms).toContain("doubleSpend");
    expect(glossary.nonce.relatedTerms).toContain("doubleSpend");
  });

  it("frontRunning links to mempool/transaction/gas, and each links back", () => {
    expect(glossary.frontRunning.relatedTerms).toEqual(
      expect.arrayContaining(["mempool", "transaction", "gas"]),
    );
    expect(glossary.mempool.relatedTerms).toContain("frontRunning");
    expect(glossary.transaction.relatedTerms).toContain("frontRunning");
    expect(glossary.gas.relatedTerms).toContain("frontRunning");
  });

  it("longRangeAttack references existing keys (block/fiftyOnePercentAttack/reorg)", () => {
    // longRangeAttack自体は設計(ARCHITECTURE.md §17.3)がblock以外との
    // 双方向リンクを指定していないため、参照先が存在することのみ検証する
    // （dangling参照ゼロは glossaryRelatedTermsIntegrity.test.ts が別途保証）。
    expect(glossary.longRangeAttack.relatedTerms).toEqual(
      expect.arrayContaining(["block", "fiftyOnePercentAttack", "reorg"]),
    );
    expect(glossary.block.relatedTerms).toContain("longRangeAttack");
  });
});
