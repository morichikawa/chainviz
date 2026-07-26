// FiftyOnePercentAttackDemoView の fork choice ルール説明文が用語集アンカー
// (`fiftyOnePercentAttack`)を持つことの確認(Issue #414。Issue #124
// 「アンカーの無い用語を作らない」教訓、ARCHITECTURE.md §17.4)。操作フロー・
// 文言・a11yは他のテストファイルが扱う(CLAUDE.md の1ファイル1責務)。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { FiftyOnePercentAttackDemoView } from "./FiftyOnePercentAttackDemoView.js";

afterEach(cleanup);

function renderWithGlossary() {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider
        glossary={{
          fiftyOnePercentAttack: {
            key: "fiftyOnePercentAttack",
            name: { ja: "51%攻撃", en: "51% attack" },
            definition: { ja: "多数決の力学", en: "majority-rule dynamics" },
            layer: "b-network",
            relatedTerms: ["fork", "reorg"],
          },
        }}
      >
        <FiftyOnePercentAttackDemoView />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("FiftyOnePercentAttackDemoView: glossary anchor on the fork-choice rule line", () => {
  it("anchors the fork-choice rule explanation to the fiftyOnePercentAttack term", () => {
    renderWithGlossary();
    expect(screen.getByTestId("glossary-term-fiftyOnePercentAttack")).toBeTruthy();
  });

  it("still renders (as plain, unanchored text) when the term is not yet in the glossary", () => {
    // Issue #413 が未マージの間の暫定挙動の確認(docs/worklog/issue-414.md
    // §8)。GlossaryTerm の既存の防御的フォールバックにより、未知語は
    // 下線無しでそのまま表示され例外にはならない。
    render(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <FiftyOnePercentAttackDemoView />
        </GlossaryProvider>
      </LanguageProvider>,
    );
    // GlossaryTerm.tsx の未知語フォールバックは data-testid を持たないため
    // （既知語のときだけ `glossary-term-${termKey}` を付与する）、クラスと
    // 本文で判定する（GlossaryTerm.tsx 参照）。
    const unknown = document.querySelector(".glossary-term--unknown");
    expect(unknown).toBeTruthy();
    expect(unknown?.textContent).toBe(
      "fork choiceルール（簡略化）: 重みの合計が大きい枝が正準になります。",
    );
  });
});
