import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createMockClient } from "../websocket/mockData.js";
import type { ClientFactory } from "../world-state/useWorldState.js";
import { App } from "./App.js";

// App.workbenchOperations.test.tsx と同じ理由（<Canvas> を丸ごとマウントする
// ため jsdom に無い ResizeObserver を補う）。
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

afterEach(cleanup);

function mockClientFactory(): ClientFactory {
  return (handlers) => createMockClient(handlers, { intervalMs: 0 });
}

/**
 * 接続ステータスバッジ（Issue #198: ARCHITECTURE.md §8.5 の追加計装対象）が
 * `data-testid="connection-status-badge"` で実際に取得でき、接続状態・
 * モック接続かどうかの出し分けを反映することを確認する（UI-CONN-01）。
 */
describe("App: connection status badge instrumentation (Issue #198)", () => {
  it("exposes the badge via data-testid and reflects the connected state with the mock label", async () => {
    render(<App clientFactory={mockClientFactory()} />);

    const badge = await screen.findByTestId("connection-status-badge");
    await waitFor(() => {
      expect(badge.textContent).toContain("接続済み");
    });
    // 既定（clientFactory を渡すが isMock は省略）は isMock === (clientFactory === undefined)
    // なので false になり、「モックデータ」の表記は出ない。
    expect(badge.textContent).not.toContain("モックデータ");
  });

  it("shows the mock label when isMock is explicitly true", async () => {
    render(<App clientFactory={mockClientFactory()} isMock />);

    const badge = await screen.findByTestId("connection-status-badge");
    await waitFor(() => {
      expect(badge.textContent).toContain("接続済み");
    });
    expect(badge.textContent).toContain("モックデータ");
  });
});
