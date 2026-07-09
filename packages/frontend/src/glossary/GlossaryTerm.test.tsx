import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { GlossaryProvider } from "./GlossaryProvider.js";
import { GlossaryTerm } from "./GlossaryTerm.js";
import type { Glossary } from "./types.js";

afterEach(cleanup);

const glossary: Glossary = {
  container: {
    key: "container",
    name: { ja: "コンテナ", en: "Container" },
    definition: { ja: "隔離された実行単位", en: "An isolated runtime unit" },
    layer: "a-infra",
    relatedTerms: ["port-mapping"],
  },
};

function wrap(node: ReactNode, initialLanguage: "ja" | "en" = "ja") {
  return render(
    <LanguageProvider initialLanguage={initialLanguage}>
      <GlossaryProvider glossary={glossary}>{node}</GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("GlossaryTerm", () => {
  it("renders the provided label with an underlined term", () => {
    wrap(<GlossaryTerm termKey="container">コンテナ</GlossaryTerm>);
    const term = screen.getByRole("button");
    expect(term.querySelector(".glossary-term__label")?.textContent).toBe(
      "コンテナ",
    );
    // 初期状態ではポップオーバーは出ていない。
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows and hides the definition popover on hover", () => {
    wrap(<GlossaryTerm termKey="container">コンテナ</GlossaryTerm>);
    const term = screen.getByRole("button");

    fireEvent.mouseEnter(term);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain("隔離された実行単位");
    expect(tooltip.textContent).toContain("port-mapping");

    fireEvent.mouseLeave(term);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows the definition in the selected language", () => {
    wrap(<GlossaryTerm termKey="container">Container</GlossaryTerm>, "en");
    fireEvent.mouseEnter(screen.getByRole("button"));
    expect(screen.getByRole("tooltip").textContent).toContain(
      "An isolated runtime unit",
    );
  });

  it("renders unknown terms as plain text without a popover", () => {
    wrap(<GlossaryTerm termKey="does-not-exist">謎の用語</GlossaryTerm>);
    expect(screen.queryByRole("button")).toBeNull();
    const span = screen.getByText("謎の用語");
    fireEvent.mouseEnter(span);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("defaults the label to the localized term name", () => {
    wrap(<GlossaryTerm termKey="container" />, "en");
    expect(
      screen.getByRole("button").querySelector(".glossary-term__label")
        ?.textContent,
    ).toBe("Container");
  });

  it("exposes the anchor and its popover via data-testid (Issue #198, ARCHITECTURE.md §8.5)", () => {
    wrap(<GlossaryTerm termKey="container">コンテナ</GlossaryTerm>);
    const term = screen.getByTestId("glossary-term-container");
    expect(term).toBe(screen.getByRole("button"));

    fireEvent.mouseEnter(term);
    expect(screen.getByTestId("glossary-popover-container")).toBe(
      screen.getByRole("tooltip"),
    );
  });
});
