import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandActionsProvider } from "../commands/CommandActionsContext.js";
import type { CommandActions } from "../commands/useCommands.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { CanvasToolbar } from "./CanvasToolbar.js";

afterEach(cleanup);

function renderToolbar(actions: Partial<CommandActions> = {}) {
  const full: CommandActions = {
    addNode: vi.fn(),
    addWorkbench: vi.fn(),
    removeNode: vi.fn(),
    removeWorkbench: vi.fn(),
    ...actions,
  };
  render(
    <LanguageProvider initialLanguage="ja">
      <CommandActionsProvider actions={full}>
        <CanvasToolbar />
      </CommandActionsProvider>
    </LanguageProvider>,
  );
  return full;
}

describe("CanvasToolbar", () => {
  it("calls addNode when the add-node button is clicked", () => {
    const actions = renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: /ノードを追加/ }));
    expect(actions.addNode).toHaveBeenCalledTimes(1);
  });

  it("submits the entered label to addWorkbench and clears the input", () => {
    const actions = renderToolbar();
    const input = screen.getByPlaceholderText("ワークベンチ名") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Carol" } });
    fireEvent.click(screen.getByRole("button", { name: /ワークベンチを追加/ }));

    expect(actions.addWorkbench).toHaveBeenCalledWith("Carol");
    expect(input.value).toBe("");
  });

  it("still calls addWorkbench when the label is left empty", () => {
    const actions = renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: /ワークベンチを追加/ }));
    expect(actions.addWorkbench).toHaveBeenCalledWith("");
  });

  it("passes a whitespace-only label through untrimmed (normalization is downstream)", () => {
    const actions = renderToolbar();
    const input = screen.getByPlaceholderText("ワークベンチ名") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /ワークベンチを追加/ }));
    expect(actions.addWorkbench).toHaveBeenCalledWith("   ");
    // 送信後は入力欄がクリアされる。
    expect(input.value).toBe("");
  });

  it("passes special characters and emoji in the label unchanged", () => {
    const actions = renderToolbar();
    const input = screen.getByPlaceholderText("ワークベンチ名") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "🚀 <b>Zoe</b>" } });
    fireEvent.click(screen.getByRole("button", { name: /ワークベンチを追加/ }));
    expect(actions.addWorkbench).toHaveBeenCalledWith("🚀 <b>Zoe</b>");
  });

  it("submits the workbench form on Enter (form submit) without a page reload", () => {
    const actions = renderToolbar();
    const input = screen.getByPlaceholderText("ワークベンチ名") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Dave" } });
    // フォーム submit（Enter 相当）でも onSubmit が発火する。
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(actions.addWorkbench).toHaveBeenCalledWith("Dave");
    expect(input.value).toBe("");
  });

  it("dispatches addNode once per click with no built-in double-submit guard", () => {
    // 追加ボタン連打の二重送信防止は UI 側では行わない（各クリックが1発行）。
    const actions = renderToolbar();
    const button = screen.getByRole("button", { name: /ノードを追加/ });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(actions.addNode).toHaveBeenCalledTimes(3);
  });

  it("does not invoke removeNode/removeWorkbench from the toolbar", () => {
    const actions = renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: /ノードを追加/ }));
    fireEvent.click(screen.getByRole("button", { name: /ワークベンチを追加/ }));
    expect(actions.removeNode).not.toHaveBeenCalled();
    expect(actions.removeWorkbench).not.toHaveBeenCalled();
  });
});
