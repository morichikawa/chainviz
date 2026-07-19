// HashChainDemoView の文言・i18n観点(ja/en 両方で主要な文言キーが表示される
// こと)。操作フロー自体は HashChainDemoView.test.tsx が扱う(CLAUDE.md の
// 1ファイル1責務)。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { HashChainDemoView } from "./HashChainDemoView.js";

afterEach(cleanup);

describe("HashChainDemoView: ja", () => {
  it("renders the Japanese labels", () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <HashChainDemoView />
        </GlossaryProvider>
      </LanguageProvider>,
    );
    expect(screen.getByText("ここは学習用の砂場です。実際のチェーンには影響しません。下の3つのブロックは、キャンバスの「チェーン」カードと同じ仕組みでつながっています。どれかのブロックの「データ」を書き換えてみてください。")).toBeTruthy();
    expect(screen.getAllByText("ブロックに格納されている情報").length).toBe(3);
    // Issue #406: 「keccak256」に用語集アンカーが付き複数要素に分割される
    // ため、完全一致の textContent で判定する(ContractPopover.test.tsx と
    // 同じ流儀)。
    expect(
      screen.getAllByText((_, element) => element?.textContent === "keccak256 でハッシュ化")
        .length,
    ).toBe(3);
    // Issue #406: f(x) の入力 x を明示する行。
    expect(
      screen.getAllByText(
        "ブロック番号 | 親ブロックのハッシュ | データ（上の3項目をこの順につなげた文字列です）",
      ).length,
    ).toBe(3);
    expect(screen.getAllByText("このブロックのハッシュ").length).toBe(3);
    expect(screen.getByText("最初に戻す")).toBeTruthy();
    expect(screen.getByText("（この砂場の起点。親はいません）")).toBeTruthy();
  });
});

describe("HashChainDemoView: en", () => {
  it("renders the English labels", () => {
    render(
      <LanguageProvider initialLanguage="en">
        <GlossaryProvider glossary={{}}>
          <HashChainDemoView />
        </GlossaryProvider>
      </LanguageProvider>,
    );
    expect(
      screen.getByText(
        'This is a learning sandbox. It does not affect the real chain. The three blocks below are linked with the same mechanism as the "Chain" card on the canvas. Try editing the "data" of any block.',
      ),
    ).toBeTruthy();
    expect(screen.getAllByText("Information stored in the block").length).toBe(3);
    // Issue #406: 「keccak256」に用語集アンカーが付き複数要素に分割される
    // ため、完全一致の textContent で判定する。
    expect(
      screen.getAllByText((_, element) => element?.textContent === "Hashed with keccak256")
        .length,
    ).toBe(3);
    // Issue #406: f(x) の入力 x を明示する行。
    expect(
      screen.getAllByText(
        "block number | parent block's hash | data (the three fields above, joined in this order)",
      ).length,
    ).toBe(3);
    expect(screen.getAllByText("This block's hash").length).toBe(3);
    expect(screen.getByText("Reset")).toBeTruthy();
    expect(screen.getByText("(The start of this sandbox. It has no parent.)")).toBeTruthy();
  });
});
