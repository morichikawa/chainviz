import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import type { Glossary } from "../glossary/types.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { LayerBadge } from "./LayerBadge.js";

const glossary: Glossary = {
  "visualization-layers": {
    key: "visualization-layers",
    name: { ja: "可視化レイヤー（A層〜D層）", en: "Visualization layers (A–D)" },
    definition: { ja: "画面を整理するための4つの視点", en: "Four viewpoints for organizing the screen" },
    layer: "a-infra",
    relatedTerms: [],
  },
};

function wrap(layer: "a" | "b" | "c" | "d", lang: "ja" | "en" = "ja") {
  return render(
    <LanguageProvider initialLanguage={lang}>
      <GlossaryProvider glossary={glossary}>
        <LayerBadge layer={layer} />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

afterEach(cleanup);

describe("LayerBadge", () => {
  it.each([
    ["a", "A層"],
    ["b", "B層"],
    ["c", "C層"],
    ["d", "D層"],
  ] as const)("shows the short Japanese label for layer %s", (layer, label) => {
    wrap(layer);
    expect(screen.getByTestId(`layer-badge-${layer}`).textContent).toBe(label);
  });

  it("shows the English label when the language is English", () => {
    wrap("b", "en");
    expect(screen.getByTestId("layer-badge-b").textContent).toBe("Layer B");
  });

  it("anchors the visualization-layers glossary term", () => {
    wrap("d");
    expect(screen.getByTestId("glossary-term-visualization-layers")).toBeTruthy();
  });
});
