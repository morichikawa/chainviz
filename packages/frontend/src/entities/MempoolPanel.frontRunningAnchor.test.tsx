// 攻撃手法解説の土台（ARCHITECTURE.md §17.4、Issue #413）: ヘッダー直下に
// 添えた frontRunning 用語アンカーの表示確認。パネルの他の挙動（tx行・
// ノード別txpool行のクリック等）は MempoolPanel.test.tsx が別途扱う
// （CLAUDE.md「1ファイル1責務」をテストファイルにも適用）。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import type { Glossary } from "../glossary/types.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { MempoolPanel } from "./MempoolPanel.js";

afterEach(cleanup);

const glossary: Glossary = {
  mempool: {
    key: "mempool",
    name: { ja: "mempool", en: "Mempool" },
    definition: { ja: "定義", en: "definition" },
    layer: "c-transaction",
    relatedTerms: [],
  },
  frontRunning: {
    key: "frontRunning",
    name: { ja: "フロントランニング", en: "Front-running" },
    definition: { ja: "定義", en: "definition" },
    layer: "c-transaction",
    relatedTerms: [],
  },
};

function wrap(lang: "ja" | "en" = "ja") {
  return render(
    <LanguageProvider initialLanguage={lang}>
      <GlossaryProvider glossary={glossary}>
        <MempoolPanel
          txEntries={[]}
          overflowCount={0}
          totalPendingCount={0}
          nodeEntries={[]}
          onSelectTx={() => {}}
          onSelectNode={() => {}}
        />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("MempoolPanel front-running anchor (Issue #413)", () => {
  it("shows a frontRunning anchor even when there are 0 pending tx (panel always renders, §11.3)", () => {
    wrap();
    expect(screen.getByTestId("mempool-panel-front-running-hint")).toBeTruthy();
    expect(screen.getByTestId("glossary-term-frontRunning")).toBeTruthy();
  });

  it("localizes the hint to English without leaking Japanese characters", () => {
    const { container } = wrap("en");
    const hint = container.querySelector('[data-testid="mempool-panel-front-running-hint"]');
    expect(hint).not.toBeNull();
    expect(hint?.textContent ?? "").toContain("front-running");
    // ひらがな(3040-309f)・カタカナ(30a0-30ff)・CJK統合漢字(4e00-9fff)。
    expect(hint?.textContent ?? "").not.toMatch(/[぀-ヿ一-鿿]/);
  });
});
