// HashChainDemoView の処理帯にある「keccak256」という語が用語集アンカーを
// 持つことの確認(Issue #406。Issue #124「アンカーの無い用語を作らない」
// 教訓)。操作フロー・文言・a11yは他のテストファイルが扱う(CLAUDE.md の
// 1ファイル1責務)。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { HashChainDemoView } from "./HashChainDemoView.js";

afterEach(cleanup);

function renderWithGlossary() {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider
        glossary={{
          keccak256: {
            key: "keccak256",
            name: { ja: "keccak256（ケチャック256）", en: "keccak256" },
            definition: { ja: "ハッシュ関数", en: "a hash function" },
            layer: "c-transaction",
            relatedTerms: ["hash", "signature", "block"],
          },
        }}
      >
        <HashChainDemoView />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("HashChainDemoView: glossary anchor on the algorithm-name line", () => {
  it("anchors the keccak256 mention in the compute band to the keccak256 term, once per block", () => {
    renderWithGlossary();
    // 3ブロックそれぞれの処理帯に1箇所ずつ、計3箇所。
    expect(screen.getAllByTestId("glossary-term-keccak256").length).toBe(3);
  });
});
