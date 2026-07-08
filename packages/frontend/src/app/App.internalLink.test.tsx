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

// App.workbenchOperations.test.tsx と同じ理由（実際の <Canvas> を丸ごと
// マウントするテストのため、jsdom に無い ResizeObserver を補う）。ただし
// このファイルはエッジ（内部リンクエッジ）の描画有無まで検証するため、
// observe() が何もしない no-op スタブでは足りない。@xyflow/react は
// ResizeObserver のコールバックが発火して初めて各ノードの
// `measured`/`handleBounds` を確定させ、それが無い間はエッジの端点座標が
// 常に null になりエッジ自体を描画しない（`EdgeWrapper` 内
// `sourceX === null` ガード、`NodeWrapper` 内 `visibility: hidden` ガード）。
// さらに @xyflow/system の `updateNodeInternals` は
// `node.offsetWidth`/`offsetHeight`（= 0 in jsdom。jsdom はレイアウト計算を
// 行わないため）の両方が真値でない限り測定結果を確定させない
// （`dimensions.width && dimensions.height` のガード）。そのため
// `HTMLElement.prototype.offsetWidth/offsetHeight` も固定値でスタブし、
// ResizeObserver のコールバックを1回疑似的に発火させることで、ハンドル位置を
// 確定させる。
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

  // jsdom には `DOMMatrixReadOnly` も無く、@xyflow/react はハンドル位置更新
  // （上記 ResizeObserver コールバック経由）のたびにビューポートの CSS
  // `transform` を解析して現在のズーム倍率を読む（`new
  // window.DOMMatrixReadOnly(style.transform).m22`）。このテストはズーム
  // 操作を行わないため、常に等倍（m22 = 1）を返す最小限のスタブで足りる。
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
 * D層の内部リンクエッジ（ARCHITECTURE.md §7.6.3。Issue #188）が、モック
 * クライアント経由で実際に `App` へ配線されていることを end-to-end に近い
 * 形で確認する。個々のロジック（エッジ導出・パルス・ポップオーバーの中身）は
 * 専用のユニットテストで検証済みなので、ここでは「lighthouse-1 の
 * drivesNodeId から常設の内部リンクエッジがキャンバスに現れ、CL 側カードの
 * 詳細に駆動先が表示される」という配線が壊れていないことだけを確認する。
 */
describe("App: internal link edge wiring (ARCHITECTURE.md §7.6.3)", () => {
  it("renders a permanent internal link edge from lighthouse-1 to reth-node-1", async () => {
    const { container } = render(<App clientFactory={mockClientFactory()} />);

    // 初期スナップショット受信後、両方のカードが現れるまで待つ。
    await screen.findByTestId("infra-card-lighthouse-1");
    await screen.findByTestId("infra-card-reth-node-1");

    // ノードのハンドル位置確定（上記 ResizeObserver スタブの疑似発火）を
    // 待ってからエッジの描画を確認する。`internal-link-edge` は
    // `internalLinkEdgesToFlowEdges` が付与するエッジ自体の className
    // （React Flow がエッジのラッパー `<g>` に `react-flow__edge-internalLink`
    // と合わせて反映する）。
    await waitFor(() => {
      expect(container.querySelector(".internal-link-edge")).not.toBeNull();
    });
  });

  it("shows the driven execution node in lighthouse-1's detail popover", async () => {
    render(<App clientFactory={mockClientFactory()} />);
    const card = await screen.findByTestId("infra-card-lighthouse-1");

    fireEvent.mouseEnter(card);

    // "chainviz-reth-1" は reth-node-1 カード自身の見出し（infra-card__name）
    // にも常に表示されているため、lighthouse-1 カードの範囲（ポップオーバー
    // を含む）に絞って検証する（`within` を使わないと同じテキストが2箇所に
    // マッチし getByText が失敗する）。
    const scope = within(card);
    expect(scope.getByText("駆動する実行ノード")).toBeTruthy();
    expect(scope.getByText("chainviz-reth-1")).toBeTruthy();
  });
});
