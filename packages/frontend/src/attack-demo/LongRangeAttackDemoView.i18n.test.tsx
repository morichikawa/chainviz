// LongRangeAttackDemoView の文言・i18n観点(ja/en 両方で主要な文言キーが
// 表示されること)。操作フローは LongRangeAttackDemoView.test.tsx が扱う
// (CLAUDE.md の1ファイル1責務)。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import type { Language } from "../i18n/messages.js";
import { LongRangeAttackDemoView } from "./LongRangeAttackDemoView.js";

afterEach(cleanup);

function renderView(lang: Language) {
  return render(
    <LanguageProvider initialLanguage={lang}>
      <GlossaryProvider glossary={{}}>
        <LongRangeAttackDemoView />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("LongRangeAttackDemoView: ja", () => {
  it("renders the Japanese labels", () => {
    renderView("ja");
    expect(screen.getByText("正規のチェーン")).toBeTruthy();
    expect(screen.getByText("攻撃者が作り直した履歴")).toBeTruthy();
    expect(
      screen.getByText(
        "同じ番号でも中身が違う、ライバルのブロックです",
      ),
    ).toBeTruthy();
    expect(
      screen.getAllByText((_, el) => el?.textContent === "確定(finality)はどこまで進んでいますか？")
        .length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("単純な『長い方を正しいとする』ルールなら")).toBeTruthy();
    expect(
      screen.getByText("攻撃者の履歴（#4まで）が採用されてしまいます"),
    ).toBeTruthy();
    expect(screen.getByText("確定(finality)を考慮すると")).toBeTruthy();
    expect(screen.getByText("最初に戻す")).toBeTruthy();
    expect(screen.getByText("#0まで確定")).toBeTruthy();
  });
});

describe("LongRangeAttackDemoView: en", () => {
  it("renders the English labels", () => {
    renderView("en");
    expect(screen.getByText("Canonical chain")).toBeTruthy();
    expect(screen.getByText("Attacker's rewritten history")).toBeTruthy();
    expect(
      screen.getByText("Same number, different contents — these blocks are rivals"),
    ).toBeTruthy();
    expect(
      screen.getAllByText((_, el) => el?.textContent === "How far has finality progressed?")
        .length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Under a naive 'longest chain wins' rule")).toBeTruthy();
    expect(
      screen.getByText("The attacker's history (through #4) would be accepted"),
    ).toBeTruthy();
    expect(screen.getByText("Once finality is taken into account")).toBeTruthy();
    expect(screen.getByText("Reset")).toBeTruthy();
    expect(screen.getByText("Finalized through #0")).toBeTruthy();
  });
});
