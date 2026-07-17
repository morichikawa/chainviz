import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createMockClient } from "../websocket/mockData.js";
import type { ClientFactory } from "../world-state/useWorldState.js";
import { App } from "./App.js";

// App.connectionStatusBadge.test.tsx と同じ理由（<Canvas> を丸ごとマウント
// するため jsdom に無い ResizeObserver を補う）。
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    class StubResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
      StubResizeObserver;
  }
});

afterEach(cleanup);

function mockClientFactory(): ClientFactory {
  return (handlers) => createMockClient(handlers, { intervalMs: 0 });
}

/**
 * 用語集パネル（Issue #313）が実際に App 経由で配線されていることを
 * end-to-end に近い形で確認する。パネル自体の詳細な挙動（検索・グループ化・
 * アコーディオン等）は side-panel/GlossaryPanelView.test.tsx で検証済みなので、
 * ここでは「ヘッダーボタン/インライン用語クリックの2つの開閉トリガーが
 * 実際にパネルを出す」「パネル内のレイヤーチップが App のレイヤーレンズ状態
 * まで届く」という配線だけを見る（App.layerFilter.test.tsx と同じ狙い）。
 */
describe("App: glossary panel wiring (Issue #313)", () => {
  it("opens the glossary panel with the search box focused via the header button", async () => {
    render(<App clientFactory={mockClientFactory()} />);
    await screen.findByTestId("infra-card-reth-node-1");

    expect(screen.queryByTestId("glossary-panel")).toBeNull();
    fireEvent.click(screen.getByTestId("glossary-open-button"));

    expect(screen.getByTestId("glossary-panel")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByTestId("glossary-panel-search"));
    expect(screen.getByTestId("glossary-open-button").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("closes the glossary panel on a second click of the header button", async () => {
    render(<App clientFactory={mockClientFactory()} />);
    await screen.findByTestId("infra-card-reth-node-1");

    const button = screen.getByTestId("glossary-open-button");
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.queryByTestId("glossary-panel")).toBeNull();
  });

  it(
    "opens the glossary panel with that term expanded when an inline GlossaryTerm is clicked " +
      "(e.g. the 'visualization-layers' term in the layer lens label)",
    async () => {
      render(<App clientFactory={mockClientFactory()} />);
      await screen.findByTestId("infra-card-reth-node-1");

      fireEvent.click(screen.getByTestId("glossary-term-visualization-layers"));

      expect(screen.getByTestId("glossary-panel")).toBeTruthy();
      const header = screen
        .getByTestId("glossary-panel-term-visualization-layers")
        .querySelector(".glossary-panel__row-header");
      expect(header?.getAttribute("aria-expanded")).toBe("true");
      // termKey 付きで開いた場合は検索欄にフォーカスしない（スクロール位置を
      // 奪わない。UX設計 §3.3）。
      expect(document.activeElement).not.toBe(
        screen.getByTestId("glossary-panel-search"),
      );
    },
  );

  it("wires the panel's layer chip to the real layer lens state (LayerFilterBar reflects the change)", async () => {
    render(<App clientFactory={mockClientFactory()} />);
    await screen.findByTestId("infra-card-reth-node-1");

    fireEvent.click(screen.getByTestId("glossary-term-visualization-layers"));
    fireEvent.click(screen.getByTestId("glossary-panel-layer-chip"));

    // visualization-layers の layer は a-infra なので A層チップが選択状態になる。
    expect(screen.getByTestId("layer-filter-chip-a").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });
});
