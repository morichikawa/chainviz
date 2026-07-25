// EclipseAttackDemoView のフッター注記にある discovery/bootnode 用語が
// 用語集アンカーを持つことの確認（Issue #416 UX設計 §3レイアウト8。
// Issue #124「アンカーの無い用語を作らない」教訓）。操作フロー・文言・a11yは
// 他のテストファイルが扱う（CLAUDE.md の1ファイル1責務。
// HashChainDemoView.glossaryAnchor.test.tsx と同型）。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { EclipseAttackDemoView } from "./EclipseAttackDemoView.js";

afterEach(cleanup);

function renderWithGlossary() {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider
        glossary={{
          discovery: {
            key: "discovery",
            name: { ja: "ノード発見", en: "Node discovery" },
            definition: { ja: "発見の説明", en: "discovery definition" },
            layer: "b-network",
            relatedTerms: [],
          },
          bootnode: {
            key: "bootnode",
            name: { ja: "ブートノード", en: "Bootnode" },
            definition: { ja: "ブートノードの説明", en: "bootnode definition" },
            layer: "b-network",
            relatedTerms: [],
          },
        }}
      >
        <EclipseAttackDemoView />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("EclipseAttackDemoView: glossary anchors on the defense footer note", () => {
  it("anchors discovery and bootnode once each", () => {
    renderWithGlossary();
    expect(screen.getAllByTestId("glossary-term-discovery").length).toBe(1);
    expect(screen.getAllByTestId("glossary-term-bootnode").length).toBe(1);
  });
});
