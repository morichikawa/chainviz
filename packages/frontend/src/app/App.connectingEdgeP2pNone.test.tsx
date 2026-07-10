import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createMockClient } from "../websocket/mockData.js";
import type { ClientFactory } from "../world-state/useWorldState.js";
import { App } from "./App.js";

// App.internalLink.test.tsx と同じ理由（実際の <Canvas> を丸ごとマウントする
// テストのため、jsdom に無い ResizeObserver/DOMMatrixReadOnly を補う。エッジの
// 描画有無を見るテストなので、no-op スタブでは足りずハンドル位置を確定させる
// 必要がある）。
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
 * Issue #214: P2P に参加しない validator client(VC) 相当のノード
 * （`p2pRole: "none"`。モックの validator-1/validator-2）に対して、
 * 「P2P接続を確立中…」エッジ（connecting-edge）が描かれないことを、
 * `App` を実際にマウントした状態（モッククライアント経由）で確認する。
 * 個々の除外ロジックは connectingEdge.test.ts で検証済みなので、ここでは
 * 「配線されたキャンバス上で実際に描かれないこと」だけを end-to-end に
 * 近い形で確認する。
 */
describe("App: p2pRole 'none' ノードは接続確立中エッジの対象外 (Issue #214)", () => {
  it("does not render a connecting edge for validator-1/validator-2", async () => {
    const { container } = render(<App clientFactory={mockClientFactory()} />);

    // 初期スナップショット受信後、validator カードが現れるまで待つ。
    await screen.findByTestId("infra-card-validator-1");
    await screen.findByTestId("infra-card-validator-2");
    // ハンドル位置確定を待つため、通常のPeerを持つ他ノードの実エッジが
    // 描画されるまで待機する（これが出れば描画パイプライン全体が
    // 一巡している）。
    await waitFor(() => {
      expect(container.querySelector(".react-flow__edge")).not.toBeNull();
    });

    // 「接続確立中」ラベルを持つエッジが1本も無いこと（validator の分も
    // 含め、他ノードにも固着していないこと）を確認する。
    expect(container.querySelector(".connecting-edge")).toBeNull();
    expect(screen.queryByText("P2P接続を確立中…")).toBeNull();
  });
});
