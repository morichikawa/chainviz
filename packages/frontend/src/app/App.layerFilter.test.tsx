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

  // UX 設計 §3.1「状態は永続化しない。リロードで『すべて』に戻る」を守って
  // いることを確認する。共有ストレージを両マウントへ注入することで「リロードを
  // またいで復元されるか」を検出できる形にする(jsdom の getBrowserStorage は
  // マウントごとに別のインメモリ代替を返すため、注入しないと永続化退行を
  // 検出できない)。選択層をストレージへ書き込む実装(将来の退行)を入れると、
  // 2 度目のマウントで復元されてこのテストが落ちる。
  it("does not persist the selection: a fresh mount defaults back to 'all' even with shared storage", async () => {
    const map = new Map<string, string>();
    const sharedStorage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
    };

    const first = render(
      <App clientFactory={mockClientFactory()} storage={sharedStorage} />,
    );
    await screen.findByTestId("infra-card-lighthouse-1");
    fireEvent.click(screen.getByTestId("layer-filter-chip-b"));
    await waitFor(() =>
      expect(
        screen.getByTestId("layer-filter-chip-b").getAttribute("aria-pressed"),
      ).toBe("true"),
    );

    // リロード相当: 現在の DOM を破棄し、同じストレージで App を新規マウント。
    first.unmount();
    const { container } = render(
      <App clientFactory={mockClientFactory()} storage={sharedStorage} />,
    );
    await screen.findByTestId("infra-card-lighthouse-1");

    expect(screen.getByTestId("layer-filter-chip-all").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByTestId("layer-filter-chip-b").getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(
      container.querySelector(".react-flow__node.layer-lens-dim"),
    ).toBeNull();
  });
});
