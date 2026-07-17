// GlossaryPanelView（Issue #313: 用語集パネルの中身。検索・層グループ・
// アコーディオン・関連用語ジャンプ・レイヤーレンズ連携）のテスト。
// 検索・グループ化そのものの純粋関数は glossary/glossarySearch.test.ts が
// 担うため、ここではコンポーネントとしての配線（状態・DOM・タイマー）に
// 関心を絞る（CLAUDE.md のテスト分割方針）。
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NEW_ARRIVAL_HIGHLIGHT_DURATION_MS } from "../entities/useNewArrivalHighlight.js";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import type { Glossary } from "../glossary/types.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { GlossaryPanelView, type GlossaryPanelViewProps } from "./GlossaryPanelView.js";
import { SidePanelProvider, useSidePanel } from "./SidePanelContext.js";
import type { SidePanelView } from "./sidePanelView.js";

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
  // 名前が2言語で同じ用語（副次表示を出さないケースの確認用）。
  rpc: {
    key: "rpc",
    name: { ja: "RPC", en: "RPC" },
    definition: { ja: "リモート手続き呼び出し", en: "Remote procedure call" },
    layer: "unknown-layer",
    relatedTerms: [],
  },
};

function resolvePanelProps(
  props: Partial<GlossaryPanelViewProps> = {},
): GlossaryPanelViewProps {
  return {
    termKey: props.termKey,
    layerFilter: props.layerFilter ?? "all",
    onLayerFilterChange: props.onLayerFilterChange ?? vi.fn(),
  };
}

function renderPanel(
  props: Partial<GlossaryPanelViewProps> = {},
  glossaryOverride: Glossary = glossary,
) {
  const resolved = resolvePanelProps(props);
  const utils = render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={glossaryOverride}>
        <SidePanelProvider>
          <GlossaryPanelView
            termKey={resolved.termKey}
            layerFilter={resolved.layerFilter}
            onLayerFilterChange={resolved.onLayerFilterChange}
          />
        </SidePanelProvider>
      </GlossaryProvider>
    </LanguageProvider>,
  );
  return { ...utils, props: resolved, onLayerFilterChange: resolved.onLayerFilterChange };
}

/** テストから現在の SidePanelView（`open()` の呼び出し結果）を覗き見るプローブ。 */
function ViewProbe({ onView }: { onView: (view: SidePanelView | null) => void }) {
  const { view } = useSidePanel();
  onView(view);
  return null;
}

/**
 * `GlossaryPanelView` は自身の `termKey` prop を書き換える手段を持たない
 * （実アプリでは呼び出し元の `SidePanelHost` が Context の `view.termKey` を
 * prop として渡し直す）。ここでは「関連用語チップのクリックが
 * `useSidePanel().open()` を正しい termKey で呼ぶこと」だけを、Context の
 * 現在値を読める `ViewProbe` 経由で確認する。
 */
function renderPanelWithViewProbe(props: Partial<GlossaryPanelViewProps> = {}) {
  const resolved = resolvePanelProps(props);
  let latestView: SidePanelView | null = null;
  render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={glossary}>
        <SidePanelProvider>
          <ViewProbe
            onView={(view) => {
              latestView = view;
            }}
          />
          <GlossaryPanelView
            termKey={resolved.termKey}
            layerFilter={resolved.layerFilter}
            onLayerFilterChange={resolved.onLayerFilterChange}
          />
        </SidePanelProvider>
      </GlossaryProvider>
    </LanguageProvider>,
  );
  return { probeView: () => latestView };
}

afterEach(cleanup);

describe("GlossaryPanelView: search (Issue #313 UX設計 §3.6)", () => {
  it("shows every term grouped by layer when the query is empty", () => {
    renderPanel();
    expect(screen.getByTestId("glossary-panel-term-container")).toBeTruthy();
    expect(screen.getByTestId("glossary-panel-term-bootnode")).toBeTruthy();
    expect(screen.getByTestId("glossary-panel-term-rpc")).toBeTruthy();
  });

  it("filters rows incrementally as the user types, hiding groups with no matches", () => {
    renderPanel();
    fireEvent.change(screen.getByTestId("glossary-panel-search"), {
      target: { value: "boot" },
    });
    expect(screen.getByTestId("glossary-panel-term-bootnode")).toBeTruthy();
    expect(screen.queryByTestId("glossary-panel-term-container")).toBeNull();
    expect(screen.queryByTestId("glossary-panel-group-a")).toBeNull();
    expect(screen.getByTestId("glossary-panel-group-b")).toBeTruthy();
  });

  it("shows the empty-state message when nothing matches", () => {
    renderPanel();
    fireEvent.change(screen.getByTestId("glossary-panel-search"), {
      target: { value: "no-such-term-anywhere" },
    });
    expect(screen.getByTestId("glossary-panel-empty").textContent).toBe(
      "一致する用語がありません",
    );
  });

  it("matches the key as well as the localized names", () => {
    renderPanel();
    fireEvent.change(screen.getByTestId("glossary-panel-search"), {
      target: { value: "container" }, // 英語UIでなくてもキー自体で引っかかる
    });
    expect(screen.getByTestId("glossary-panel-term-container")).toBeTruthy();
  });
});

describe("GlossaryPanelView: grouping (UX設計 §3.3)", () => {
  it("puts an unrecognized layer value into the 'other' group with its own heading", () => {
    renderPanel();
    const otherGroup = screen.getByTestId("glossary-panel-group-other");
    expect(otherGroup.textContent).toContain("その他");
    expect(screen.getByTestId("glossary-panel-term-rpc")).toBeTruthy();
  });

  it("renders group headings in a -> b -> other order", () => {
    renderPanel();
    const groupTestIds = screen
      .getAllByTestId(/^glossary-panel-group-/)
      .map((el) => el.getAttribute("data-testid"));
    expect(groupTestIds).toEqual([
      "glossary-panel-group-a",
      "glossary-panel-group-b",
      "glossary-panel-group-other",
    ]);
  });
});

describe("GlossaryPanelView: row display", () => {
  it("shows the current-language name plus the other language's name as a secondary label", () => {
    renderPanel();
    const row = screen.getByTestId("glossary-panel-term-container");
    expect(row.querySelector(".glossary-panel__row-name")?.textContent).toBe("コンテナ");
    expect(row.querySelector(".glossary-panel__row-secondary")?.textContent).toBe(
      "Container",
    );
  });

  it("omits the secondary label when both languages share the same name", () => {
    renderPanel();
    const row = screen.getByTestId("glossary-panel-term-rpc");
    expect(row.querySelector(".glossary-panel__row-secondary")).toBeNull();
  });
});

describe("GlossaryPanelView: single-expansion accordion", () => {
  it("expands a row on click and shows the full (unclamped) definition", () => {
    renderPanel();
    const header = screen
      .getByTestId("glossary-panel-term-container")
      .querySelector(".glossary-panel__row-header") as HTMLElement;
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen
        .getByTestId("glossary-panel-term-container")
        .querySelector(".glossary-panel__row-definition")?.textContent,
    ).toBe("隔離された実行単位");
  });

  it("collapses the row on a second click", () => {
    renderPanel();
    const header = screen
      .getByTestId("glossary-panel-term-container")
      .querySelector(".glossary-panel__row-header") as HTMLElement;
    fireEvent.click(header);
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
  });

  it("collapses the previously expanded row when a different row is expanded (only one open at a time)", () => {
    renderPanel();
    const containerHeader = screen
      .getByTestId("glossary-panel-term-container")
      .querySelector(".glossary-panel__row-header") as HTMLElement;
    const bootnodeHeader = screen
      .getByTestId("glossary-panel-term-bootnode")
      .querySelector(".glossary-panel__row-header") as HTMLElement;

    fireEvent.click(containerHeader);
    expect(containerHeader.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(bootnodeHeader);
    expect(bootnodeHeader.getAttribute("aria-expanded")).toBe("true");
    expect(containerHeader.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("GlossaryPanelView: related term chips (UX設計 §3.4)", () => {
  it("shows a resolvable related term as a clickable chip with its localized name", () => {
    renderPanel({ termKey: "container" });
    const chip = screen.getByTestId("glossary-panel-related-bootnode");
    expect(chip.tagName).toBe("BUTTON");
    expect(chip.textContent).toBe("ブートノード");
  });

  it("shows an unresolvable (broken-reference) related term as plain non-interactive text", () => {
    renderPanel({ termKey: "container" });
    const chip = screen.getByTestId("glossary-panel-related-does-not-exist");
    expect(chip.tagName).not.toBe("BUTTON");
    expect(chip.textContent).toBe("does-not-exist");
  });

  it(
    "clicking a related term chip re-opens the side panel view with the related term's key " +
      "(UX設計 §3.4: 'open() を呼び直すだけでよい'。実際に SidePanelHost 経由で新しい " +
      "termKey prop が渡された結果、対象行が展開されることは " +
      "'reacts to an externally-changed termKey prop' テストが確認する)",
    () => {
      const { probeView } = renderPanelWithViewProbe({ termKey: "container" });
      fireEvent.click(screen.getByTestId("glossary-panel-related-bootnode"));
      expect(probeView()).toEqual({ kind: "glossary", termKey: "bootnode" });
    },
  );
});

describe("GlossaryPanelView: reacts to an externally-changed termKey prop", () => {
  // `SidePanelHost` は SidePanelView（Context 上の状態）から `termKey` を
  // そのまま prop として渡すため、パネルが開いたまま termKey だけが変わる
  // （ヘッダーボタンからの再オープンではなく、関連用語チップのジャンプ・別の
  // GlossaryTerm クリックによる `open()` の呼び直し）という遷移が実際に
  // 起きる。ここでは props の変化そのものに対する反応を確認する。
  it("expands the new term, collapses the previous one, and clears any typed search query", () => {
    const { rerender, props } = renderPanel({ termKey: "container" });
    fireEvent.change(screen.getByTestId("glossary-panel-search"), {
      target: { value: "something the user was searching for" },
    });

    rerender(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={glossary}>
          <SidePanelProvider>
            <GlossaryPanelView
              termKey="bootnode"
              layerFilter={props.layerFilter}
              onLayerFilterChange={props.onLayerFilterChange}
            />
          </SidePanelProvider>
        </GlossaryProvider>
      </LanguageProvider>,
    );

    expect((screen.getByTestId("glossary-panel-search") as HTMLInputElement).value).toBe(
      "",
    );
    const bootnodeHeader = screen
      .getByTestId("glossary-panel-term-bootnode")
      .querySelector(".glossary-panel__row-header");
    expect(bootnodeHeader?.getAttribute("aria-expanded")).toBe("true");
    const containerHeader = screen
      .getByTestId("glossary-panel-term-container")
      .querySelector(".glossary-panel__row-header");
    expect(containerHeader?.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("GlossaryPanelView: opening focus behavior (UX設計 §3.3)", () => {
  it("focuses the search input when opened without a termKey (header button entry)", () => {
    renderPanel({ termKey: undefined });
    expect(document.activeElement).toBe(screen.getByTestId("glossary-panel-search"));
  });

  it("does not steal focus from the search input when opened with a termKey (inline term click entry)", () => {
    renderPanel({ termKey: "container" });
    expect(document.activeElement).not.toBe(screen.getByTestId("glossary-panel-search"));
  });
});

describe("GlossaryPanelView: jump scroll + temporary highlight (UX設計 §3.3)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("scrolls the target row into view when opened with a termKey", () => {
    // jsdom does not implement Element.prototype.scrollIntoView at all（実装は
    // `row?.scrollIntoView?.(...)` とオプショナルチェーンで無くても壊れない
    // ようにしている）。ここでは実際に呼ばれることを観測するため、テスト内
    // だけ一時的にスタブを生やす。
    const scrollIntoView = vi.fn();
    const patchedPrototype = HTMLElement.prototype as unknown as {
      scrollIntoView?: () => void;
    };
    patchedPrototype.scrollIntoView = scrollIntoView;
    try {
      renderPanel({ termKey: "container" });
      expect(scrollIntoView).toHaveBeenCalled();
    } finally {
      delete patchedPrototype.scrollIntoView;
    }
  });

  it("applies a temporary highlight class to the target row that clears after the highlight duration", () => {
    renderPanel({ termKey: "container" });
    const row = screen.getByTestId("glossary-panel-term-container");
    expect(row.className).toContain("glossary-panel__row--highlight");

    act(() => {
      vi.advanceTimersByTime(NEW_ARRIVAL_HIGHLIGHT_DURATION_MS);
    });
    expect(row.className).not.toContain("glossary-panel__row--highlight");
  });
});

describe("GlossaryPanelView: layer chip (UX設計 §3.5)", () => {
  it("calls onLayerFilterChange with the term's layer on click", () => {
    const onLayerFilterChange = vi.fn();
    renderPanel({ termKey: "container", layerFilter: "all", onLayerFilterChange });
    fireEvent.click(screen.getByTestId("glossary-panel-layer-chip"));
    expect(onLayerFilterChange).toHaveBeenCalledWith("a");
  });

  it("toggles back to 'all' when the chip's layer is already the active lens (same behavior as LayerFilterBar)", () => {
    const onLayerFilterChange = vi.fn();
    renderPanel({ termKey: "container", layerFilter: "a", onLayerFilterChange });
    fireEvent.click(screen.getByTestId("glossary-panel-layer-chip"));
    expect(onLayerFilterChange).toHaveBeenCalledWith("all");
  });

  it("shows the active state when the current layer lens matches the term's layer", () => {
    renderPanel({ termKey: "container", layerFilter: "a" });
    expect(screen.getByTestId("glossary-panel-layer-chip").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("does not render a layer chip for a term in the 'other' group (no layer to link to)", () => {
    renderPanel({ termKey: "rpc" });
    const row = screen.getByTestId("glossary-panel-term-rpc");
    expect(row.querySelector('[data-testid="glossary-panel-layer-chip"]')).toBeNull();
  });
});
