// SidePanel（Issue #321。汎用サイドパネル機構のシェル）のテスト。
// 状態管理は SidePanelContext.test.tsx、振り分けは SidePanelHost.test.tsx に
// 分ける（CLAUDE.md のテスト分割方針）。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { SidePanel } from "./SidePanel.js";

afterEach(cleanup);

function wrap(onClose: () => void, lang: "ja" | "en" = "ja") {
  return render(
    <LanguageProvider initialLanguage={lang}>
      <SidePanel ariaLabel="ソースコード" title="ソースコード" onClose={onClose}>
        <p>body content</p>
      </SidePanel>
    </LanguageProvider>,
  );
}

describe("SidePanel", () => {
  it("renders the title and children inside the body", () => {
    wrap(() => {});
    expect(screen.getByTestId("side-panel")).toBeTruthy();
    expect(screen.getByText("ソースコード")).toBeTruthy();
    expect(screen.getByText("body content")).toBeTruthy();
  });

  it("has a dialog role with the given accessible name", () => {
    wrap(() => {});
    expect(screen.getByRole("dialog", { name: "ソースコード" })).toBeTruthy();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    wrap(onClose);
    fireEvent.click(screen.getByTestId("side-panel-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    wrap(onClose);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose for other keys", () => {
    const onClose = vi.fn();
    wrap(onClose);
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders the close button's accessible label in English when the language is English", () => {
    wrap(() => {}, "en");
    expect(screen.getByLabelText("Close")).toBeTruthy();
  });
});
