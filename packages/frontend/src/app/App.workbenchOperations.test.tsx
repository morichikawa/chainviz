import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createMockClient } from "../websocket/mockData.js";
import type { ClientFactory } from "../world-state/useWorldState.js";
import { App } from "./App.js";

// このファイルは（他の単体テストと違い）実際の <Canvas>（React Flow の
// ビューポート）を丸ごとマウントする唯一のテストのため、jsdom に無い
// ResizeObserver をここだけで最小限に補う（グローバルなテスト設定は変更
// しない。他の全テストは ReactFlowProvider だけを使いビューポートの実測を
// 経由しないため、この補いは不要だった）。
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

/**
 * `App` を実際のモッククライアント（`createMockData.ts` のシミュレーション）
 * と組み合わせた、定型操作パネルの end-to-end に近い配線確認（Issue #167）。
 * 個々のロジック（フォームの値変換・useCommands の保留追跡・mock の成否判定
 * 等）は専用のユニットテストで検証済みなので、ここでは「ワークベンチカードの
 * ボタンから開いたパネルで実際に送信すると、モック応答を経て新しい
 * コントラクトカードがキャンバス上に現れる」という一連の配線が壊れていない
 * ことだけを確認する。
 */

afterEach(cleanup);

function mockClientFactory(): ClientFactory {
  return (handlers) => createMockClient(handlers, { intervalMs: 0 });
}

describe("App: workbench operation panel wiring (ARCHITECTURE.md §6.5)", () => {
  it("deploys Counter from Alice's workbench card and the resulting contract card appears on canvas", async () => {
    render(<App clientFactory={mockClientFactory()} />);

    // 初期スナップショット受信後、ワークベンチカードの操作ボタンが出る。
    const operateButton = await screen.findByTestId(
      "infra-card-operate-workbench-alice",
    );
    fireEvent.click(operateButton);

    fireEvent.click(screen.getByTestId("operation-tab-deploy"));
    fireEvent.change(screen.getByTestId("operation-deploy-contract"), {
      target: { value: "Counter" },
    });
    fireEvent.click(screen.getByText("デプロイする"));

    // 送信直後: パネルは閉じ、コントラクト行に仮カード（デプロイ中…）が出る。
    expect(
      screen.queryByTestId("operation-panel-workbench-alice"),
    ).toBeNull();
    expect(screen.getByText(/デプロイ中…\s*Counter/)).toBeTruthy();

    // モックの commandResult(ok:true) + entityAdded(contract) はマイクロタスクで
    // 解決され、それを受けた state 更新の反映（再レンダー）は act() の外で
    // 非同期に走るため、固定回数の Promise.resolve() 待ちではなく waitFor で
    // ポーリングする。
    await waitFor(() => {
      expect(screen.queryByText(/デプロイ中…\s*Counter/)).toBeNull();
    });

    // 仮カードが消え、実カード（コントラクトカード）に置き換わる。
    const contractCards = screen.getAllByText("Counter");
    expect(contractCards.length).toBeGreaterThan(0);
  });
});
