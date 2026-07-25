// FiftyOnePercentAttackDemoView の文言・i18n観点(ja/en 両方で主要な文言
// キーが表示されること)。操作フロー自体は
// FiftyOnePercentAttackDemoView.test.tsx が扱う(CLAUDE.md の1ファイル1責務)。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Language } from "../i18n/i18n.js";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider, useLanguage } from "../i18n/LanguageProvider.js";
import { FiftyOnePercentAttackDemoView } from "./FiftyOnePercentAttackDemoView.js";

afterEach(cleanup);

describe("FiftyOnePercentAttackDemoView: ja", () => {
  it("renders the Japanese labels", () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <FiftyOnePercentAttackDemoView />
        </GlossaryProvider>
      </LanguageProvider>,
    );
    expect(
      screen.getByText(
        "ここは学習用の砂場です。実際のチェーンには影響しません。7人の疑似バリデーターが、分岐した2つの候補（枝A・枝B）のどちらを正しいチェーンとして見ているかを表しています。バリデーターのボタンをクリックすると、そのバリデーターを攻撃者が支配している状態に切り替えられます。",
      ),
    ).toBeTruthy();
    expect(screen.getByText("共通の親ブロック")).toBeTruthy();
    expect(screen.getByText("枝A")).toBeTruthy();
    expect(screen.getByText("枝B")).toBeTruthy();
    expect(screen.getByText("最初に戻す")).toBeTruthy();
    expect(
      screen.getByText(
        "「51%攻撃」という名前ですが、実際に必要な割合はバリデーター総数によって変わります（この砂場では7人中4人、約57%で逆転します）。",
      ),
    ).toBeTruthy();
  });
});

describe("FiftyOnePercentAttackDemoView: en", () => {
  it("renders the English labels", () => {
    render(
      <LanguageProvider initialLanguage="en">
        <GlossaryProvider glossary={{}}>
          <FiftyOnePercentAttackDemoView />
        </GlossaryProvider>
      </LanguageProvider>,
    );
    expect(
      screen.getByText(
        "This is a learning sandbox. It doesn't affect the real chain. 7 pseudo-validators each regard one of two candidate branches (Branch A / Branch B) as the chain they follow. Click a validator's button to toggle whether the attacker controls it.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Common parent block")).toBeTruthy();
    expect(screen.getByText("Branch A")).toBeTruthy();
    expect(screen.getByText("Branch B")).toBeTruthy();
    expect(screen.getByText("Reset")).toBeTruthy();
    expect(
      screen.getByText(
        'Despite the name "51% attack," the share actually needed depends on the total validator count (in this sandbox, 4 of 7 — about 57% — flips the outcome).',
      ),
    ).toBeTruthy();
  });
});

// 動的な文言（`format()` で `{attacker}`/`{total}`/`{percent}`/`{count}`/`{n}`
// を埋める4キー）は、プレースホルダ名を片方の言語だけ書き換えると
// 「{count}」が画面にそのまま残る形で壊れる。静的な文言と違い getByText の
// 完全一致テストでは全状態を追い切れないため、埋め込み漏れが無いことを
// 状態を動かしながら両言語で確認する（Issue #414 のテスト強化）。
describe("FiftyOnePercentAttackDemoView: dynamic text has no unreplaced placeholders", () => {
  function renderIn(language: Language) {
    return render(
      <LanguageProvider initialLanguage={language}>
        <GlossaryProvider glossary={{}}>
          <FiftyOnePercentAttackDemoView />
        </GlossaryProvider>
      </LanguageProvider>,
    );
  }

  for (const language of ["ja", "en"] as const) {
    it(`substitutes every placeholder at all attacker counts (${language})`, () => {
      const { container } = renderIn(language);
      for (let attackerCount = 0; attackerCount <= 7; attackerCount++) {
        if (attackerCount > 0) {
          fireEvent.click(screen.getByTestId(`attack51-demo-validator-${attackerCount}`));
        }
        // 本文・バリデーターボタンの aria-label のどちらにも
        // 「{...}」が残っていないこと。
        expect(container.textContent).not.toMatch(/\{\w+\}/);
        for (const button of container.querySelectorAll("button[aria-label]")) {
          expect(button.getAttribute("aria-label")).not.toMatch(/\{\w+\}/);
        }
      }
      cleanup();
    });
  }

  it("keeps the in-progress sandbox state when the UI language is switched", () => {
    // 言語切り替えは LanguageProvider の context 値だけを差し替えるため、
    // デモのローカル state は保持されるべき（操作の途中で言語を変えると
    // 攻撃者の配置がリセットされる、という退行を防ぐ）。
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
          <FiftyOnePercentAttackDemoView />
          <LanguageToggleProbe />
        </GlossaryProvider>
      </LanguageProvider>,
    );
    for (const id of [2, 5]) {
      fireEvent.click(screen.getByTestId(`attack51-demo-validator-${id}`));
    }
    expect(screen.getByTestId("attack51-demo-summary-value").textContent).toBe("2 / 7人（29%）");

    fireEvent.click(screen.getByTestId("toggle-language"));
    expect(screen.getByTestId("attack51-demo-summary-value").textContent).toBe("2 / 7 (29%)");
    expect(screen.getByTestId("attack51-demo-branch-b-weight").textContent).toBe("2");
    expect(screen.getByTestId("attack51-demo-validator-2").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByTestId("attack51-demo-validator-5").getAttribute("aria-label")).toBe(
      "Validator 5: attacker-controlled (click to make honest)",
    );
    expect(screen.getByTestId("attack51-demo-branch-a-badge").textContent).toBe("Canonical");
  });

  it("renders the English summary and margin sentences with the substituted numbers", () => {
    renderIn("en");
    expect(screen.getByTestId("attack51-demo-summary-value").textContent).toBe("0 / 7 (0%)");
    expect(screen.getByTestId("attack51-demo-margin-hint").textContent).toBe(
      "4 more attacker-controlled validators would flip Branch B to canonical",
    );

    for (const id of [1, 2, 3, 4]) {
      fireEvent.click(screen.getByTestId(`attack51-demo-validator-${id}`));
    }
    expect(screen.getByTestId("attack51-demo-summary-value").textContent).toBe("4 / 7 (57%)");
    expect(screen.getByTestId("attack51-demo-margin-hint").textContent).toBe(
      "The attacker has already made Branch B canonical",
    );
    expect(screen.getByTestId("attack51-demo-validator-4").getAttribute("aria-label")).toBe(
      "Validator 4: attacker-controlled (click to make honest)",
    );
  });
});
