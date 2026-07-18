// SidePanel のリサイズハンドル（Issue #362）のテスト。シェルの他の挙動
// （Esc クローズ等）は SidePanel.test.tsx、幅の状態管理そのものは
// useSidePanelResize.test.ts / sidePanelWidth.test.ts に分ける
// （CLAUDE.md のテスト分割方針）。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import type { KeyValueStorage } from "../platform/storage.js";
import { SIDE_PANEL_DEFAULT_WIDTH, SIDE_PANEL_WIDTH_STORAGE_KEY } from "./sidePanelWidth.js";
import { SidePanel } from "./SidePanel.js";

afterEach(cleanup);

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

function wrap(storage: KeyValueStorage) {
  return render(
    <LanguageProvider initialLanguage="ja">
      <SidePanel ariaLabel="ソースコード" title="ソースコード" onClose={() => {}} storage={storage}>
        <p>body content</p>
      </SidePanel>
    </LanguageProvider>,
  );
}

describe("SidePanel resize handle", () => {
  it("renders a separator handle with a Japanese accessible name", () => {
    wrap(memoryStorage());
    const handle = screen.getByRole("separator", { name: "パネルの幅を変更" });
    expect(handle).toBeTruthy();
  });

  it("applies the loaded width as an inline style on the root element", () => {
    const storage = memoryStorage({ [SIDE_PANEL_WIDTH_STORAGE_KEY]: "600" });
    wrap(storage);
    const panel = screen.getByTestId("side-panel");
    expect(panel.style.width).toBe("600px");
  });

  it("defaults to the standard width when nothing is stored", () => {
    wrap(memoryStorage());
    const panel = screen.getByTestId("side-panel");
    expect(panel.style.width).toBe(`${SIDE_PANEL_DEFAULT_WIDTH}px`);
  });

  it("resizes and persists the width via pointer drag", () => {
    const storage = memoryStorage();
    wrap(storage);
    const handle = screen.getByTestId("side-panel-resize-handle");
    const panel = screen.getByTestId("side-panel");

    // jsdom は PointerEvent を実装していないため、`fireEvent.pointerDown`
    // 経由（内部で PointerEvent を構築しようとして失敗し無反応になる）ではなく
    // "pointerdown" 型の MouseEvent を `fireEvent` に渡して代用する
    // （実装側のフックが clientX しか見ないため代用できる。act() で包んで
    // 確実に再レンダーを待つため、素の `dispatchEvent` ではなく `fireEvent`
    // を使う）。
    fireEvent(handle, new MouseEvent("pointerdown", { clientX: 1000, bubbles: true }));
    fireEvent(window, new MouseEvent("pointermove", { clientX: 900 }));
    expect(panel.style.width).toBe(`${SIDE_PANEL_DEFAULT_WIDTH + 100}px`);

    fireEvent(window, new MouseEvent("pointerup", { clientX: 900 }));
    expect(storage.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY)).toBe(
      String(SIDE_PANEL_DEFAULT_WIDTH + 100),
    );
  });

  it("resizes via keyboard arrows on the handle", () => {
    const storage = memoryStorage();
    wrap(storage);
    const handle = screen.getByTestId("side-panel-resize-handle");
    const panel = screen.getByTestId("side-panel");

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(panel.style.width).toBe(`${SIDE_PANEL_DEFAULT_WIDTH + 24}px`);
    expect(storage.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY)).toBe(
      String(SIDE_PANEL_DEFAULT_WIDTH + 24),
    );
  });

  it("renders the handle's accessible label in English when the language is English", () => {
    render(
      <LanguageProvider initialLanguage="en">
        <SidePanel
          ariaLabel="Source code"
          title="Source code"
          onClose={() => {}}
          storage={memoryStorage()}
        >
          <p>body</p>
        </SidePanel>
      </LanguageProvider>,
    );
    expect(screen.getByRole("separator", { name: "Resize panel width" })).toBeTruthy();
  });
});
