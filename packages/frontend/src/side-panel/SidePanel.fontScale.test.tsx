// SidePanel の文字サイズステッパー（Issue #377）のテスト。シェルの他の
// 挙動（Esc クローズ等）は SidePanel.test.tsx、リサイズは
// SidePanel.resize.test.tsx、倍率の状態管理そのものは
// useSidePanelFontScale.test.ts / sidePanelFontScale.test.ts に分ける
// （CLAUDE.md のテスト分割方針）。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import type { KeyValueStorage } from "../platform/storage.js";
import { SIDE_PANEL_FONT_SCALE_STORAGE_KEY } from "./sidePanelFontScale.js";
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

function wrap(storage: KeyValueStorage, lang: "ja" | "en" = "ja") {
  return render(
    <LanguageProvider initialLanguage={lang}>
      <SidePanel ariaLabel="ソースコード" title="ソースコード" onClose={() => {}} storage={storage}>
        <p>body content</p>
      </SidePanel>
    </LanguageProvider>,
  );
}

describe("SidePanel font scale controls", () => {
  it("renders the A-/reset/A+ controls in the header", () => {
    wrap(memoryStorage());
    expect(screen.getByTestId("side-panel-font-smaller")).toBeTruthy();
    expect(screen.getByTestId("side-panel-font-reset")).toBeTruthy();
    expect(screen.getByTestId("side-panel-font-larger")).toBeTruthy();
  });

  it("shows 100% and applies scale 1 as the root custom property by default", () => {
    wrap(memoryStorage());
    expect(screen.getByTestId("side-panel-font-reset").textContent).toBe("100%");
    const panel = screen.getByTestId("side-panel");
    expect(panel.style.getPropertyValue("--side-panel-font-scale")).toBe("1");
  });

  it("increases the scale, updates the display and the custom property, and persists it", () => {
    const storage = memoryStorage();
    wrap(storage);
    fireEvent.click(screen.getByTestId("side-panel-font-larger"));

    expect(screen.getByTestId("side-panel-font-reset").textContent).toBe("115%");
    const panel = screen.getByTestId("side-panel");
    expect(panel.style.getPropertyValue("--side-panel-font-scale")).toBe("1.15");
    expect(storage.getItem(SIDE_PANEL_FONT_SCALE_STORAGE_KEY)).toBe("1.15");
  });

  it("decreases the scale and persists it", () => {
    const storage = memoryStorage();
    wrap(storage);
    fireEvent.click(screen.getByTestId("side-panel-font-smaller"));

    expect(screen.getByTestId("side-panel-font-reset").textContent).toBe("85%");
    expect(storage.getItem(SIDE_PANEL_FONT_SCALE_STORAGE_KEY)).toBe("0.85");
  });

  it("resets to 100% when the current-value button is clicked", () => {
    const storage = memoryStorage({ [SIDE_PANEL_FONT_SCALE_STORAGE_KEY]: "1.5" });
    wrap(storage);
    expect(screen.getByTestId("side-panel-font-reset").textContent).toBe("150%");

    fireEvent.click(screen.getByTestId("side-panel-font-reset"));

    expect(screen.getByTestId("side-panel-font-reset").textContent).toBe("100%");
    expect(storage.getItem(SIDE_PANEL_FONT_SCALE_STORAGE_KEY)).toBe("1");
  });

  it("disables the larger button at the maximum step", () => {
    const storage = memoryStorage({ [SIDE_PANEL_FONT_SCALE_STORAGE_KEY]: "1.5" });
    wrap(storage);
    expect(screen.getByTestId("side-panel-font-larger").hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("side-panel-font-smaller").hasAttribute("disabled")).toBe(false);
  });

  it("disables the smaller button at the minimum step", () => {
    const storage = memoryStorage({ [SIDE_PANEL_FONT_SCALE_STORAGE_KEY]: "0.85" });
    wrap(storage);
    expect(screen.getByTestId("side-panel-font-smaller").hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("side-panel-font-larger").hasAttribute("disabled")).toBe(false);
  });

  it("loads a stored scale on mount and reflects it in the custom property", () => {
    const storage = memoryStorage({ [SIDE_PANEL_FONT_SCALE_STORAGE_KEY]: "1.3" });
    wrap(storage);
    const panel = screen.getByTestId("side-panel");
    expect(panel.style.getPropertyValue("--side-panel-font-scale")).toBe("1.3");
  });

  it("renders the button accessible labels in English when the language is English", () => {
    wrap(memoryStorage(), "en");
    expect(screen.getByLabelText("Decrease text size")).toBeTruthy();
    expect(screen.getByLabelText("Increase text size")).toBeTruthy();
    expect(screen.getByLabelText("Reset text size (current 100%)")).toBeTruthy();
  });

  it("keeps the width inline style alongside the font-scale custom property", () => {
    wrap(memoryStorage());
    const panel = screen.getByTestId("side-panel");
    expect(panel.style.width).not.toBe("");
    expect(panel.style.getPropertyValue("--side-panel-font-scale")).toBe("1");
  });
});
