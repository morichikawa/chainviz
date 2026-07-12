import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createMockClient } from "../websocket/mockData.js";
import type { ClientFactory } from "../world-state/useWorldState.js";
import { App } from "./App.js";

// App.internalLink.test.tsx と同じ理由（実際の <Canvas> を丸ごとマウントする
// テストのため、jsdom に無い ResizeObserver/DOMMatrixReadOnly を補う。エッジの
// 描画有無・端点座標を見るテストなので、no-op スタブでは足りずハンドル位置を
// 確定させる必要がある）。
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    value: 200,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: 80,
  });

  class StubResizeObserver implements ResizeObserver {
    #callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.#callback = callback;
    }

    observe(target: Element) {
      this.#callback(
        [{ target } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }

    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
    StubResizeObserver;

  if (typeof globalThis.DOMMatrixReadOnly === "undefined") {
    class StubDOMMatrixReadOnly {
      m22 = 1;
    }
    (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly =
      StubDOMMatrixReadOnly;
  }
});

afterEach(cleanup);

function mockClientFactory(): ClientFactory {
  return (handlers) => createMockClient(handlers, { intervalMs: 0 });
}

/**
 * validator→beacon の内部リンクエッジ（ARCHITECTURE.md §7.6.11。Issue #285）が、
 * モッククライアント経由で実際に `App` へ配線されていることを end-to-end に
 * 近い形で確認する。個々のロジック（エッジ導出・文言切り替え・InfraPopover の
 * 行）は専用のユニットテストで検証済みなので、ここでは「validator-1 の
 * drivesNodeId から常設の内部リンクエッジがキャンバスに現れ、validator側の
 * カード詳細に接続先の beacon が表示される」という配線が壊れていないことだけを
 * 確認する（`mockData.ts` の `validatorNode` 参照）。
 */
describe("App: validator→beacon internal link edge wiring (ARCHITECTURE.md §7.6.11, Issue #285)", () => {
  it("renders a permanent internal link edge from validator-1 to lighthouse-1", async () => {
    const { container } = render(<App clientFactory={mockClientFactory()} />);

    await screen.findByTestId("infra-card-validator-1");
    await screen.findByTestId("infra-card-lighthouse-1");

    // consensus→execution（lighthouse-1→reth-node-1）と validator→consensus
    // （validator-1/2→lighthouse-1）の3本が現れる。
    await waitFor(() => {
      expect(
        container.querySelectorAll(".internal-link-edge").length,
      ).toBeGreaterThanOrEqual(3);
    });
  });

  it("shows the connected beacon node in validator-1's detail popover with the Beacon API label", async () => {
    render(<App clientFactory={mockClientFactory()} />);
    const card = await screen.findByTestId("infra-card-validator-1");

    fireEvent.mouseEnter(card);

    const popover = await screen.findByTestId("infra-popover-validator-1");
    const scope = within(popover);
    expect(scope.getByText("接続先の beacon ノード")).toBeTruthy();
    expect(scope.getByText("chainviz-lighthouse-1")).toBeTruthy();
    // consensus→execution 用のラベルは出ない（役割ペアで文言が切り替わっている）。
    expect(scope.queryByText("駆動する実行ノード")).toBeNull();
  });
});
