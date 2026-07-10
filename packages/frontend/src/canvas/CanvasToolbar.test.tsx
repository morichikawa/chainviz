import type { NodeEntity } from "@chainviz/shared";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandActionsProvider } from "../commands/CommandActionsContext.js";
import type { CommandActions } from "../commands/useCommands.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { HOVER_POPOVER_CLOSE_DELAY_MS } from "../interaction/useHoverPopover.js";
import { CanvasToolbar, type CanvasToolbarProps } from "./CanvasToolbar.js";

function node(overrides: Partial<NodeEntity> = {}): NodeEntity {
  return {
    kind: "node",
    id: "reth-1",
    containerName: "chainviz-reth-1",
    ip: "172.20.0.2",
    ports: [8545],
    resources: { cpuPercent: 1, memMB: 100 },
    process: { name: "reth node" },
    chainType: "ethereum",
    clientType: "reth",
    syncStatus: "synced",
    blockHeight: 1,
    headBlockHash: "0x0",
    ...overrides,
  };
}

afterEach(cleanup);

function renderToolbar(
  actions: Partial<CommandActions> = {},
  props: CanvasToolbarProps = {},
) {
  const full: CommandActions = {
    addNode: vi.fn(),
    addWorkbench: vi.fn(),
    removeNode: vi.fn(),
    removeWorkbench: vi.fn(),
    runWorkbenchOperation: vi.fn(),
    ...actions,
  };
  render(
    <LanguageProvider initialLanguage="ja">
      <CommandActionsProvider actions={full}>
        <CanvasToolbar {...props} />
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

  it("dispatches addNode once per click while not pending", () => {
    // pending でない間は、押した回数だけそのまま addNode を発行する
    // （多重送信の抑止は pendingAddNode による disabled 化で行う。Issue #220）。
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

  describe("data-testid instrumentation (Issue #198, ARCHITECTURE.md §8.5)", () => {
    it("exposes the add-node button, workbench label input, and add-workbench button via data-testid", () => {
      renderToolbar();
      expect(screen.getByTestId("canvas-toolbar-add-node")).toBe(
        screen.getByRole("button", { name: /ノードを追加/ }),
      );
      expect(screen.getByTestId("canvas-toolbar-workbench-label")).toBe(
        screen.getByPlaceholderText("ワークベンチ名"),
      );
      expect(screen.getByTestId("canvas-toolbar-add-workbench")).toBe(
        screen.getByRole("button", { name: /ワークベンチを追加/ }),
      );
    });
  });

  describe("pending feedback (Issue #102)", () => {
    it("shows no pending indication by default", () => {
      renderToolbar();
      const addNodeButton = screen.getByRole("button", { name: /ノードを追加/ });
      expect(addNodeButton.className).not.toContain("--pending");
      expect(addNodeButton.getAttribute("aria-busy")).toBe("false");
    });

    it("marks the add-node button as pending/busy while pendingAddNode is true", () => {
      renderToolbar({}, { pendingAddNode: true });
      const addNodeButton = screen.getByRole("button", { name: /ノードを追加/ });
      expect(addNodeButton.className).toContain("canvas-toolbar__button--pending");
      expect(addNodeButton.getAttribute("aria-busy")).toBe("true");
    });

    it("marks the add-workbench button as pending/busy while pendingAddWorkbench is true", () => {
      renderToolbar({}, { pendingAddWorkbench: true });
      const addWorkbenchButton = screen.getByRole("button", {
        name: /ワークベンチを追加/,
      });
      expect(addWorkbenchButton.className).toContain(
        "canvas-toolbar__button--pending",
      );
      expect(addWorkbenchButton.getAttribute("aria-busy")).toBe("true");
    });

    it("keeps the two buttons' pending state independent of each other", () => {
      renderToolbar({}, { pendingAddNode: true, pendingAddWorkbench: false });
      const addNodeButton = screen.getByRole("button", { name: /ノードを追加/ });
      const addWorkbenchButton = screen.getByRole("button", {
        name: /ワークベンチを追加/,
      });
      expect(addNodeButton.className).toContain("--pending");
      expect(addWorkbenchButton.className).not.toContain("--pending");
    });

    it("disables the add-node button while pending, blocking double-clicks (Issue #220)", () => {
      const actions = renderToolbar({}, { pendingAddNode: true });
      const addNodeButton = screen.getByRole(
        "button",
        { name: /ノードを追加/ },
      ) as HTMLButtonElement;
      expect(addNodeButton.disabled).toBe(true);
      fireEvent.click(addNodeButton);
      fireEvent.click(addNodeButton);
      // disabled なボタンはブラウザがそもそも click イベントを発火させない。
      expect(actions.addNode).not.toHaveBeenCalled();
    });

    it("disables the add-workbench button while pending, blocking double-submits (Issue #220)", () => {
      const actions = renderToolbar({}, { pendingAddWorkbench: true });
      const addWorkbenchButton = screen.getByRole("button", {
        name: /ワークベンチを追加/,
      }) as HTMLButtonElement;
      expect(addWorkbenchButton.disabled).toBe(true);
      fireEvent.click(addWorkbenchButton);
      fireEvent.click(addWorkbenchButton);
      expect(actions.addWorkbench).not.toHaveBeenCalled();
    });

    it("re-enables the add-node button once pending resolves (ghost cleared)", () => {
      const actions = renderToolbar({}, { pendingAddNode: false });
      const addNodeButton = screen.getByRole(
        "button",
        { name: /ノードを追加/ },
      ) as HTMLButtonElement;
      expect(addNodeButton.disabled).toBe(false);
      fireEvent.click(addNodeButton);
      expect(actions.addNode).toHaveBeenCalledTimes(1);
    });
  });

  describe("pre-click hint tooltips (Issue #123 §4-1)", () => {
    it("shows no tooltip before hovering/focusing either button", () => {
      renderToolbar();
      expect(screen.queryByRole("tooltip")).toBeNull();
    });

    it("shows the generic add-node hint on hover when no bootnode is resolvable", () => {
      renderToolbar();
      const addNodeButton = screen.getByRole("button", { name: /ノードを追加/ });
      fireEvent.mouseEnter(addNodeButton.parentElement as HTMLElement);
      expect(screen.getByRole("tooltip").textContent).toBe(
        "フォロワーノード(reth + beacon のペア、カード2枚)を起動し、既存ネットワークのブートノードを入口に参加させます",
      );
    });

    it("shows the specific add-node hint (with bootnode container names) when resolvable", () => {
      const elBoot = node({ id: "reth-1", containerName: "chainviz-reth-1", p2pRole: "bootnode" });
      const clBoot = node({
        id: "lh-1",
        containerName: "chainviz-lighthouse-1",
        clientType: "lighthouse",
        p2pRole: "bootnode",
      });
      renderToolbar({}, { entities: [elBoot, clBoot] });
      const addNodeButton = screen.getByRole("button", { name: /ノードを追加/ });
      fireEvent.mouseEnter(addNodeButton.parentElement as HTMLElement);
      const tooltip = screen.getByRole("tooltip");
      expect(tooltip.textContent).toContain("chainviz-reth-1");
      expect(tooltip.textContent).toContain("chainviz-lighthouse-1");
    });

    it("shows the generic add-workbench hint on focus when no RPC target is resolvable", () => {
      renderToolbar();
      const addWorkbenchButton = screen.getByRole("button", {
        name: /ワークベンチを追加/,
      });
      fireEvent.focus(addWorkbenchButton);
      expect(screen.getByRole("tooltip").textContent).toBe(
        "Foundry(cast / forge)入りの操作用マシンを起動します。専用のウォレット(鍵)が1つ割り当てられます",
      );
    });

    it(
      "hides the tooltip again on mouse leave / blur, after the close delay " +
        "(Issue #221: not immediately, so the cursor can still reach the popover " +
        "across the gap)",
      () => {
        vi.useFakeTimers();
        try {
          renderToolbar();
          const addNodeButton = screen.getByRole("button", { name: /ノードを追加/ });
          const wrapper = addNodeButton.parentElement as HTMLElement;
          fireEvent.mouseEnter(wrapper);
          expect(screen.getByRole("tooltip")).toBeTruthy();
          fireEvent.mouseLeave(wrapper);
          // 即座には消えない（隙間通過中の可能性があるため）。
          expect(screen.getByRole("tooltip")).toBeTruthy();
          act(() => {
            vi.advanceTimersByTime(HOVER_POPOVER_CLOSE_DELAY_MS);
          });
          expect(screen.queryByRole("tooltip")).toBeNull();
        } finally {
          vi.useRealTimers();
        }
      },
    );

    it("defaults to an empty entity list (generic hints) when entities is omitted", () => {
      renderToolbar();
      const addWorkbenchButton = screen.getByRole("button", {
        name: /ワークベンチを追加/,
      });
      fireEvent.mouseEnter(addWorkbenchButton.parentElement as HTMLElement);
      expect(screen.getByRole("tooltip").textContent).toContain(
        "専用のウォレット(鍵)が1つ割り当てられます",
      );
    });
  });
});
