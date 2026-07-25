// FiftyOnePercentAttackDemoView の文言・i18n観点(ja/en 両方で主要な文言
// キーが表示されること)。操作フロー自体は
// FiftyOnePercentAttackDemoView.test.tsx が扱う(CLAUDE.md の1ファイル1責務)。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
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
