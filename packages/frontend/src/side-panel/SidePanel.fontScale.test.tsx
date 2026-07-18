// SidePanel の文字サイズステッパー（Issue #377）のテスト。シェルの他の
// 挙動（Esc クローズ等）は SidePanel.test.tsx、リサイズは
// SidePanel.resize.test.tsx、倍率の状態管理そのものは
// useSidePanelFontScale.test.ts / sidePanelFontScale.test.ts に分ける
// （CLAUDE.md のテスト分割方針）。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
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

function wrap(
  storage: KeyValueStorage,
  lang: "ja" | "en" = "ja",
  title: ReactNode = "ソースコード",
  children: ReactNode = <p>body content</p>,
) {
  return render(
    <LanguageProvider initialLanguage={lang}>
      <SidePanel ariaLabel="ソースコード" title={title} onClose={() => {}} storage={storage}>
        {children}
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

  it("does not change the scale when a disabled larger button is clicked at the maximum", () => {
    const storage = memoryStorage({ [SIDE_PANEL_FONT_SCALE_STORAGE_KEY]: "1.5" });
    wrap(storage);
    const larger = screen.getByTestId("side-panel-font-larger");
    expect(larger.hasAttribute("disabled")).toBe(true);

    fireEvent.click(larger);

    // native disabled のため onClick は発火せず、倍率も保存値も変わらない。
    expect(screen.getByTestId("side-panel-font-reset").textContent).toBe("150%");
    expect(screen.getByTestId("side-panel").style.getPropertyValue("--side-panel-font-scale")).toBe(
      "1.5",
    );
    expect(storage.getItem(SIDE_PANEL_FONT_SCALE_STORAGE_KEY)).toBe("1.5");
  });

  it("does not change the scale when a disabled smaller button is clicked at the minimum", () => {
    const storage = memoryStorage({ [SIDE_PANEL_FONT_SCALE_STORAGE_KEY]: "0.85" });
    wrap(storage);
    const smaller = screen.getByTestId("side-panel-font-smaller");
    expect(smaller.hasAttribute("disabled")).toBe(true);

    fireEvent.click(smaller);

    expect(screen.getByTestId("side-panel-font-reset").textContent).toBe("85%");
    expect(storage.getItem(SIDE_PANEL_FONT_SCALE_STORAGE_KEY)).toBe("0.85");
  });

  it("keeps an accessible label on a disabled button so screen readers still announce it", () => {
    // native `disabled` はフォーカス不可・SR は「無効」と読み上げる。
    // その際もボタンの意味(何のボタンか)が失われないよう aria-label を保持する。
    wrap(memoryStorage({ [SIDE_PANEL_FONT_SCALE_STORAGE_KEY]: "1.5" }), "en");
    const larger = screen.getByTestId("side-panel-font-larger");
    expect(larger.hasAttribute("disabled")).toBe(true);
    expect(larger.getAttribute("aria-label")).toBe("Increase text size");
  });

  it("never disables the reset button, even at the maximum or minimum step", () => {
    for (const raw of ["1.5", "0.85"]) {
      const { unmount } = wrap(memoryStorage({ [SIDE_PANEL_FONT_SCALE_STORAGE_KEY]: raw }));
      expect(screen.getByTestId("side-panel-font-reset").hasAttribute("disabled")).toBe(false);
      unmount();
    }
  });

  it("keeps the font-scale controls as real buttons that do not submit a form", () => {
    wrap(memoryStorage());
    for (const testId of [
      "side-panel-font-smaller",
      "side-panel-font-reset",
      "side-panel-font-larger",
    ]) {
      expect(screen.getByTestId(testId).getAttribute("type")).toBe("button");
    }
  });

  it("preserves the scale across a kind switch (unmount + remount) with the same storage", () => {
    // SidePanelHost は kind ごとに別の SidePanel をマウントし直すが、倍率は
    // kind 非依存の共通1値(同じ storage キー)。用語集で拡大した倍率が
    // 通信ログに切り替えても維持されることを、再マウントで再現する。
    const storage = memoryStorage();
    const first = wrap(storage, "ja", "用語集", <p>glossary body</p>);
    fireEvent.click(screen.getByTestId("side-panel-font-larger"));
    fireEvent.click(screen.getByTestId("side-panel-font-larger"));
    expect(screen.getByTestId("side-panel-font-reset").textContent).toBe("130%");
    first.unmount();

    // 別 kind 相当(タイトル・本文が違う新しい SidePanel)を同じ storage で開く。
    wrap(storage, "ja", "通信ログ", <p>comms body</p>);
    expect(screen.getByTestId("side-panel-font-reset").textContent).toBe("130%");
    expect(screen.getByTestId("side-panel").style.getPropertyValue("--side-panel-font-scale")).toBe(
      "1.3",
    );
  });
});
