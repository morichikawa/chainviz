// LongRangeAttackDemoView の文言・i18n観点(ja/en 両方で主要な文言キーが
// 表示されること)。操作フローは LongRangeAttackDemoView.test.tsx が扱う
// (CLAUDE.md の1ファイル1責務)。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider, useLanguage } from "../i18n/LanguageProvider.js";
import type { Language } from "../i18n/messages.js";
import { LongRangeAttackDemoView } from "./LongRangeAttackDemoView.js";
import { CANONICAL_CHAIN, DIVERGE_AT } from "./longRangeAttackDemo.js";

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

describe("LongRangeAttackDemoView: dynamic wording (Issue #415 テスト強化)", () => {
  // 判定バナー・checkpoint チップは format() でブロック番号を差し込むため、
  // 綴り違い等でプレースホルダが残ると生の "{...}" が画面に出る。両言語 ×
  // 全 checkpoint で「未解決のプレースホルダが無い」ことを確認する。
  it.each(["ja", "en"] as const)("substitutes every placeholder at all checkpoints (%s)", (lang) => {
    const { container } = renderView(lang);
    for (const block of CANONICAL_CHAIN) {
      fireEvent.click(screen.getByTestId(`long-range-demo-checkpoint-${block.number}`));
      expect(container.textContent ?? "").not.toMatch(/\{[^}]*\}/);
    }
  });

  it("switches the English finality verdict wording at the divergence point", () => {
    renderView("en");
    const verdict = screen.getByTestId("long-range-demo-verdict-finality");
    expect(verdict.textContent).toContain("isn't finalized yet");
    fireEvent.click(screen.getByTestId(`long-range-demo-checkpoint-${DIVERGE_AT}`));
    expect(verdict.textContent).toContain("The canonical chain holds");
    // 分岐点の番号が文言に差し込まれていること。
    expect(verdict.textContent).toContain(`#${DIVERGE_AT}`);
  });

  it("keeps the in-progress checkpoint when the UI language is switched", () => {
    // 言語切り替えは LanguageProvider の context 値だけを差し替えるため、
    // デモ側の useState は維持されるはず（アンマウントされない）。
    function LanguageToggleProbe() {
      const { toggle } = useLanguage();
      return (
        <button type="button" data-testid="toggle-language" onClick={toggle}>
          toggle
        </button>
      );
    }
    render(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <LongRangeAttackDemoView />
          <LanguageToggleProbe />
        </GlossaryProvider>
      </LanguageProvider>,
    );
    fireEvent.click(screen.getByTestId(`long-range-demo-checkpoint-${DIVERGE_AT}`));
    fireEvent.click(screen.getByTestId("toggle-language"));

    expect(
      screen.getByTestId(`long-range-demo-checkpoint-${DIVERGE_AT}`).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByTestId("long-range-demo-verdict-finality").textContent).toContain(
      "The canonical chain holds",
    );
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
