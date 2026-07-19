// SignatureDemoView 末尾の「ほかの検証」説明が attestation / engine-api の
// 用語集アンカーを持つことの確認(Issue #402。Issue #124「アンカーの無い
// 用語を作らない」教訓)。操作フロー・文言・a11yは他のテストファイルが
// 扱う(CLAUDE.md の1ファイル1責務)。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { SignatureDemoView } from "./SignatureDemoView.js";

afterEach(cleanup);

function renderWithGlossary() {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider
        glossary={{
          attestation: {
            key: "attestation",
            name: { ja: "Attestation（証明）", en: "Attestation" },
            definition: { ja: "投票の証明", en: "a vote proof" },
            layer: "a-infra",
            relatedTerms: ["validator", "beacon-api"],
          },
          "engine-api": {
            key: "engine-api",
            name: { ja: "Engine API", en: "Engine API" },
            definition: { ja: "CL/EL間API", en: "CL/EL internal API" },
            layer: "d-internal",
            relatedTerms: [],
          },
        }}
      >
        <SignatureDemoView />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("SignatureDemoView: glossary anchors in the closing 'other verifications' note", () => {
  it("anchors a label to the attestation term", () => {
    renderWithGlossary();
    expect(screen.getByTestId("glossary-term-attestation")).toBeTruthy();
  });

  it("anchors a label to the engine-api term", () => {
    renderWithGlossary();
    expect(screen.getByTestId("glossary-term-engine-api")).toBeTruthy();
  });
});
