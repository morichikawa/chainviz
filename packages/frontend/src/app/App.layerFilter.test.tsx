import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createMockClient } from "../websocket/mockData.js";
import type { ClientFactory } from "../world-state/useWorldState.js";
import { App } from "./App.js";

// App.connectionStatusBadge.test.tsx と同じ理由（<Canvas> を丸ごとマウント
// するため jsdom に無い ResizeObserver を補う）。エッジ自体の描画確認は
// 行わないため、offsetWidth のスタブまでは不要。
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
 * レイヤーレンズ(Issue #299)が実際に App 経由で配線されていることを
 * end-to-end に近い形で確認する。判定ロジック自体は
 * entities/canvasLayers.test.ts で検証済みなので、ここでは
 * 「チップを押すと該当しないカードに dim クラスが付き、'すべて' に戻すと
 * 消える」という配線が壊れていないことだけを見る。
 *
 * mock スナップショット(websocket/mockData.ts)は reth-node-1 と
 * reth-node-2 が peer エッジ(B層)で結ばれている一方、lighthouse-1 は
 * このペアと繋がっていない(別ネットワークのブートノード)ため、B層選択時に
 * reth-node-1/2 は通常表示のまま、lighthouse-1・ウォレットカードは dim
 * される、という区別を確認できる。
 */
describe("App: layer lens wiring (Issue #299)", () => {
  it("defaults to 'all' with no card dimmed", async () => {
    const { container } = render(<App clientFactory={mockClientFactory()} />);
    await screen.findByTestId("infra-card-reth-node-1");

    expect(screen.getByTestId("layer-filter-chip-all").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      container.querySelector(".react-flow__node.layer-lens-dim"),
    ).toBeNull();
  });

  it("dims non-B-layer cards and keeps the peer-connected pair normal when the B chip is selected", async () => {
    const { container } = render(<App clientFactory={mockClientFactory()} />);
    const reth1 = await screen.findByTestId("infra-card-reth-node-1");
    await screen.findByTestId("infra-card-reth-node-2");
    const lighthouse1 = await screen.findByTestId("infra-card-lighthouse-1");
    const walletCard = await waitFor(() => {
      const el = container.querySelector('[data-testid^="wallet-card-"]');
      if (!el) throw new Error("wallet card not rendered yet");
      return el;
    });

    fireEvent.click(screen.getByTestId("layer-filter-chip-b"));

    await waitFor(() => {
      expect(lighthouse1.closest(".react-flow__node")?.className).toContain(
        "layer-lens-dim",
      );
    });
    // reth-node-1/reth-node-2 は peer エッジ(B層)の端点なので通常表示のまま。
    expect(reth1.closest(".react-flow__node")?.className).not.toContain(
      "layer-lens-dim",
    );
    // ウォレットカードはC層固定なのでB層選択時は dim される。
    expect(walletCard.closest(".react-flow__node")?.className).toContain(
      "layer-lens-dim",
    );
  });

  it("clears all dimming when switching back to 'all'", async () => {
    const { container } = render(<App clientFactory={mockClientFactory()} />);
    const lighthouse1 = await screen.findByTestId("infra-card-lighthouse-1");
    await screen.findByTestId("infra-card-reth-node-1");

    fireEvent.click(screen.getByTestId("layer-filter-chip-b"));
    await waitFor(() => {
      expect(lighthouse1.closest(".react-flow__node")?.className).toContain(
        "layer-lens-dim",
      );
    });

    fireEvent.click(screen.getByTestId("layer-filter-chip-all"));
    await waitFor(() => {
      expect(
        container.querySelector(".react-flow__node.layer-lens-dim"),
      ).toBeNull();
    });
  });

  it("toggles the same chip off (back to 'all') on a second click", async () => {
    const { container } = render(<App clientFactory={mockClientFactory()} />);
    await screen.findByTestId("infra-card-lighthouse-1");

    const chip = screen.getByTestId("layer-filter-chip-b");
    fireEvent.click(chip);
    await waitFor(() => expect(chip.getAttribute("aria-pressed")).toBe("true"));

    fireEvent.click(chip);
    await waitFor(() => expect(chip.getAttribute("aria-pressed")).toBe("false"));
    expect(screen.getByTestId("layer-filter-chip-all").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      container.querySelector(".react-flow__node.layer-lens-dim"),
    ).toBeNull();
  });
});
