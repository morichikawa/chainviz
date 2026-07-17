// GlossaryTerm のクリック連携（Issue #313: クリック/Enter/Space で用語集
// パネルを開く、Provider 無しでの no-op フォールバック、ポップオーバーの
// フッター・関連用語名の解決）のテスト。ホバー開閉の基本挙動は
// GlossaryTerm.test.tsx、testid の出入りタイミングは GlossaryTerm.testid.test.tsx
// が担当するため、ここではクリック連携に関心を絞る（CLAUDE.md のテスト分割方針）。
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { HOVER_POPOVER_CLOSE_DELAY_MS } from "../interaction/useHoverPopover.js";
import { SidePanelProvider, useSidePanel } from "../side-panel/SidePanelContext.js";
import { GlossaryProvider } from "./GlossaryProvider.js";
import { GlossaryTerm } from "./GlossaryTerm.js";
import type { Glossary } from "./types.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const glossary: Glossary = {
  container: {
    key: "container",
    name: { ja: "コンテナ", en: "Container" },
    definition: { ja: "隔離された実行単位", en: "An isolated runtime unit" },
    layer: "a-infra",
    relatedTerms: ["bootnode", "does-not-exist"],
  },
  bootnode: {
    key: "bootnode",
    name: { ja: "ブートノード", en: "Bootnode" },
    definition: { ja: "参加の入口となるノード", en: "Entry point node" },
    layer: "b-network",
    relatedTerms: [],
  },
};

/** テストから現在の SidePanelView を覗き見るための薄いプローブ。 */
function ViewProbe() {
  const { view } = useSidePanel();
  return <span data-testid="view-probe">{view ? JSON.stringify(view) : "null"}</span>;
}

function wrapWithSidePanel(node: ReactNode, initialLanguage: "ja" | "en" = "ja") {
  return render(
    <LanguageProvider initialLanguage={initialLanguage}>
      <GlossaryProvider glossary={glossary}>
        <SidePanelProvider>
          <ViewProbe />
          {node}
        </SidePanelProvider>
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

function wrapWithoutSidePanel(node: ReactNode) {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={glossary}>{node}</GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("GlossaryTerm click integration with the glossary panel (Issue #313)", () => {
  it("opens the glossary panel selecting this term on click", () => {
    wrapWithSidePanel(<GlossaryTerm termKey="container">コンテナ</GlossaryTerm>);
    fireEvent.click(screen.getByTestId("glossary-term-container"));
    expect(screen.getByTestId("view-probe").textContent).toBe(
      JSON.stringify({ kind: "glossary", termKey: "container" }),
    );
  });

  it("opens the glossary panel on Enter", () => {
    wrapWithSidePanel(<GlossaryTerm termKey="container">コンテナ</GlossaryTerm>);
    fireEvent.keyDown(screen.getByTestId("glossary-term-container"), { key: "Enter" });
    expect(screen.getByTestId("view-probe").textContent).toBe(
      JSON.stringify({ kind: "glossary", termKey: "container" }),
    );
  });

  it("opens the glossary panel on Space", () => {
    wrapWithSidePanel(<GlossaryTerm termKey="container">コンテナ</GlossaryTerm>);
    fireEvent.keyDown(screen.getByTestId("glossary-term-container"), { key: " " });
    expect(screen.getByTestId("view-probe").textContent).toBe(
      JSON.stringify({ kind: "glossary", termKey: "container" }),
    );
  });

  it("ignores unrelated keys", () => {
    wrapWithSidePanel(<GlossaryTerm termKey="container">コンテナ</GlossaryTerm>);
    fireEvent.keyDown(screen.getByTestId("glossary-term-container"), { key: "Tab" });
    expect(screen.getByTestId("view-probe").textContent).toBe("null");
  });

  it("closes its own open hover popover on click (does not double-show with the panel)", () => {
    wrapWithSidePanel(<GlossaryTerm termKey="container">コンテナ</GlossaryTerm>);
    const anchor = screen.getByTestId("glossary-term-container");
    fireEvent.mouseEnter(anchor);
    expect(screen.getByRole("tooltip")).toBeTruthy();

    fireEvent.click(anchor);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("does not propagate the click to an ancestor (e.g. a React Flow card) that would otherwise handle it", () => {
    const onAncestorClick = vi.fn();
    wrapWithSidePanel(
      <div onClick={onAncestorClick}>
        <GlossaryTerm termKey="container">コンテナ</GlossaryTerm>
      </div>,
    );
    fireEvent.click(screen.getByTestId("glossary-term-container"));
    expect(onAncestorClick).not.toHaveBeenCalled();
  });

  it(
    "falls back to a no-op without throwing when rendered outside a SidePanelProvider " +
      "(Issue #313 design requirement: must not break standalone rendering)",
    () => {
      wrapWithoutSidePanel(<GlossaryTerm termKey="container">コンテナ</GlossaryTerm>);
      const anchor = screen.getByTestId("glossary-term-container");
      expect(() => fireEvent.click(anchor)).not.toThrow();
      expect(() =>
        fireEvent.keyDown(anchor, { key: "Enter" }),
      ).not.toThrow();
    },
  );
});

describe("GlossaryTerm popover content (Issue #313 UX changes)", () => {
  it("shows the fixed 'open panel' footer hint", () => {
    wrapWithoutSidePanel(<GlossaryTerm termKey="container">コンテナ</GlossaryTerm>);
    fireEvent.mouseEnter(screen.getByTestId("glossary-term-container"));
    expect(screen.getByRole("tooltip").textContent).toContain("クリックで用語集を開く");
  });

  it("resolves related term keys to their localized names instead of raw keys", () => {
    wrapWithoutSidePanel(<GlossaryTerm termKey="container">コンテナ</GlossaryTerm>);
    fireEvent.mouseEnter(screen.getByTestId("glossary-term-container"));
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain("ブートノード");
    expect(tooltip.textContent).not.toContain("bootnode");
  });

  it("falls back to the raw key for a related term that is not in the glossary (broken reference)", () => {
    wrapWithoutSidePanel(<GlossaryTerm termKey="container">コンテナ</GlossaryTerm>);
    fireEvent.mouseEnter(screen.getByTestId("glossary-term-container"));
    expect(screen.getByRole("tooltip").textContent).toContain("does-not-exist");
  });

  it("does not make related term text clickable/focusable inside the popover", () => {
    wrapWithoutSidePanel(<GlossaryTerm termKey="container">コンテナ</GlossaryTerm>);
    fireEvent.mouseEnter(screen.getByTestId("glossary-term-container"));
    const related = screen.getByRole("tooltip").querySelector(".glossary-popover__related");
    expect(related?.querySelector("button, [role='button'], a")).toBeNull();
  });

  it("still closes after the hover-close delay when never clicked", () => {
    wrapWithoutSidePanel(<GlossaryTerm termKey="container">コンテナ</GlossaryTerm>);
    const anchor = screen.getByTestId("glossary-term-container");
    fireEvent.mouseEnter(anchor);
    fireEvent.mouseLeave(anchor);
    act(() => {
      vi.advanceTimersByTime(HOVER_POPOVER_CLOSE_DELAY_MS);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
