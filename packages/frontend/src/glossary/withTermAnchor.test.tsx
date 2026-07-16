import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { GlossaryProvider } from "./GlossaryProvider.js";
import type { Glossary } from "./types.js";
import { withTermAnchor } from "./withTermAnchor.js";

afterEach(cleanup);

// GlossaryTerm は用語が glossary に登録されていない場合 data-testid を
// 付けない（未登録用語のフォールバック描画。GlossaryTerm.tsx docstring
// 参照）。withTermAnchor が実際にアンカーを付けたことをテストできるよう、
// 最小限の "abi" 用語データを与える。
const glossaryWithAbi: Glossary = {
  abi: {
    key: "abi",
    name: { ja: "ABI", en: "ABI" },
    definition: { ja: "説明", en: "Definition" },
    layer: "c",
    relatedTerms: [],
  },
};

function wrap(node: ReturnType<typeof withTermAnchor>, glossary: Glossary = glossaryWithAbi) {
  return render(
    <LanguageProvider>
      <GlossaryProvider glossary={glossary}>{node}</GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("withTermAnchor", () => {
  it("wraps the first occurrence of the term in a GlossaryTerm anchor", () => {
    wrap(withTermAnchor("It cannot decode the ABI here.", "ABI", "abi"));
    expect(screen.getByTestId("glossary-term-abi")).toBeTruthy();
    expect(screen.getByText("ABI")).toBeTruthy();
    // 前後のテキストも失われていないこと。
    expect(screen.getByText(/It cannot decode the/)).toBeTruthy();
    expect(screen.getByText(/here\.$/)).toBeTruthy();
  });

  it("returns the plain text unchanged when the term is absent (defensive fallback)", () => {
    const { container } = wrap(
      withTermAnchor("No anchor word in this sentence.", "ABI", "abi"),
    );
    expect(container.textContent).toBe("No anchor word in this sentence.");
    expect(screen.queryByTestId("glossary-term-abi")).toBeNull();
  });

  it("anchors only the first occurrence when the term appears multiple times", () => {
    wrap(withTermAnchor("ABI then ABI again", "ABI", "abi"));
    expect(screen.getAllByTestId("glossary-term-abi")).toHaveLength(1);
  });

  it("still wraps the term in a glossary-term span even when the term key is not registered", () => {
    // termKey が glossary に無い場合でも(未登録用語のフォールバック表示)、
    // withTermAnchor 自体は迷わずアンカー相当の span を差し込む。
    // data-testid は付かないため class で存在を確認する。
    const { container } = wrap(
      withTermAnchor("uses the XYZ standard", "XYZ", "unregistered-term"),
      {},
    );
    expect(container.querySelector(".glossary-term")).not.toBeNull();
    expect(container.querySelector(".glossary-term--unknown")).not.toBeNull();
  });
});
