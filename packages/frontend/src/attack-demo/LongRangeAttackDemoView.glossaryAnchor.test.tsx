// LongRangeAttackDemoView 内の「確定(finality)」見出し・確定済みバッジが
// longRangeAttack 用語集アンカーを持ち、フッターの「バリデーターの投票
// (attestation)」説明が既存の attestation 用語へアンカーされていることの
// 確認(Issue #415。Issue #124「アンカーの無い用語を作らない」教訓・
// `docs/worklog/issue-415.md` UX設計 §7)。操作フロー・文言・a11yは
// 他のテストファイルが扱う(CLAUDE.md の1ファイル1責務)。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { LongRangeAttackDemoView } from "./LongRangeAttackDemoView.js";

afterEach(cleanup);

function renderWithGlossary() {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider
        glossary={{
          longRangeAttack: {
            key: "longRangeAttack",
            name: { ja: "ロングレンジ攻撃", en: "Long-range attack" },
            definition: { ja: "過去に遡って別の履歴を作り直す攻撃", en: "Rewriting past history" },
            layer: "b-network",
            relatedTerms: ["fork", "reorg"],
          },
          attestation: {
            key: "attestation",
            name: { ja: "Attestation（証明）", en: "Attestation" },
            definition: { ja: "投票の証明", en: "a vote proof" },
            layer: "a-infra",
            relatedTerms: ["validator", "beacon-api"],
          },
        }}
      >
        <LongRangeAttackDemoView />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("LongRangeAttackDemoView: glossary anchors (UX設計 §7 fallback)", () => {
  it("anchors the 'finality' phrase in the checkpoint heading to longRangeAttack", () => {
    renderWithGlossary();
    // フォールバック方針: finality の独立エントリを新設しない前提のため、
    // 見出し中の「確定(finality)」は longRangeAttack へアンカーする。
    expect(screen.getAllByTestId("glossary-term-longRangeAttack").length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("anchors the finalized badge label to longRangeAttack", () => {
    renderWithGlossary();
    // checkpoint を進めて確定済みバッジを出現させる。
    screen.getByTestId("long-range-demo-checkpoint-1").click();
    const badge = screen.getByTestId("long-range-demo-canonical-finalized-0");
    expect(badge.querySelector('[data-testid="glossary-term-longRangeAttack"]')).toBeTruthy();
  });

  it("anchors the 'attestation' mention in the footer to the existing attestation term", () => {
    renderWithGlossary();
    expect(screen.getByTestId("glossary-term-attestation")).toBeTruthy();
  });
});
