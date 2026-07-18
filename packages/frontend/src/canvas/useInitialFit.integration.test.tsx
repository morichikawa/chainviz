import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "../app/App.js";
import type { ChainvizClient } from "../websocket/client.js";
import { createMockClient } from "../websocket/mockData.js";
import type { ClientFactory } from "../world-state/useWorldState.js";

/**
 * `useInitialFit`（Issue #373、ARCHITECTURE.md §14）の配線が壊れていない
 * ことを、実際に `<App>` をマウントして確認する統合テスト。
 *
 * `initialFit.test.ts` が純粋な判定ロジック（`shouldPerformInitialFit`）を
 * 網羅的に確認しているのに対し、こちらは「本物の React Flow・本物の
 * モッククライアントの組み合わせで、初期フィットが実際にワールドステート
 * 全体に対して行われ、以後の更新では再フィットしない」という配線そのものを
 * 確認する。
 *
 * App.internalLink.test.tsx と同じ理由（実際の `<Canvas>` を丸ごとマウント
 * するため、jsdom に無い ResizeObserver / DOMMatrixReadOnly を補い、
 * `offsetWidth`/`offsetHeight` を固定値でスタブしてノードの計測を確定させる
 * 必要がある）でスタブを用意する。1ファイル1責務の方針上、内容はほぼ
 * 同じでもこのファイル用に独立して用意する。
 */
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
 * collector に接続はできるが、スナップショットを一度も配信しないクライアント
 * (collector 未応答・未接続相当)。`hasReceivedSnapshot` が false のままに
 * なる状況を再現し、初期フィットが発火しないことを確認するために使う。
 */
function neverSnapshotClientFactory(): ClientFactory {
  return (handlers): ChainvizClient => ({
    connect() {
      handlers.onStatusChange?.("connecting");
      handlers.onStatusChange?.("connected");
      // onSnapshot は決して呼ばない。
    },
    disconnect() {
      handlers.onStatusChange?.("disconnected");
    },
    sendCommand: vi.fn(() => undefined),
    getStatus: () => "connected",
  });
}

/** React Flow のビューポート要素の transform 文字列。 */
function viewportTransform(container: HTMLElement): string | null {
  const viewport = container.querySelector<HTMLElement>(".react-flow__viewport");
  return viewport?.style.transform ?? null;
}

/** `translate(...) scale(N)` から N を取り出す。取り出せない場合は null。 */
function viewportScale(transform: string | null): number | null {
  if (!transform) return null;
  const match = /scale\(([\d.]+)\)/.exec(transform);
  return match ? Number(match[1]) : null;
}

/**
 * 「全ノードに対して正しくフィットした」と「チェーンリボン1枚だけに対して
 * 誤ってフィットした（Issue #373のバグ）」を区別するための閾値。
 *
 * このテストのスタブ環境では、ノード計測を `offsetWidth`/`offsetHeight` を
 * 固定値(200×80)にスタブしたうえで行っており、React Flow のコンテナ
 * サイズもこの固定値をそのまま使う（jsdom はレイアウト計算を行わないため）。
 * そのためリボン1枚だけにフィットした場合はほぼ等倍（実測 scale=0.91。
 * 修正前のコードで本ファイル執筆時に実測）に、実際のワールドステート
 * 全体（インフラ行・ウォレット行に広がるグリッド）にフィットした場合は
 * 大きく縮小（実測 scale=0.2。修正後のコードで実測）になる。この2値は
 * 一桁近く離れているため、0.5 を閾値にすれば十分な余裕を持って判別できる。
 */
const RIBBON_ONLY_FIT_SCALE_THRESHOLD = 0.5;

describe("useInitialFit wiring (App 統合)", () => {
  it(
    "最初のスナップショットの反映・計測完了後、キャンバスの初期フィットは" +
      "ワールドステート全体に対して行われる（チェーンリボン1枚だけに誤って" +
      "フィットしたまま固定されない。Issue #373 の回帰確認）",
    async () => {
      const { container } = render(<App clientFactory={mockClientFactory()} />);

      await screen.findByTestId("infra-card-lighthouse-1");
      await screen.findByTestId("infra-card-reth-node-1");

      await waitFor(() => {
        const scale = viewportScale(viewportTransform(container));
        expect(scale).not.toBeNull();
        expect(scale as number).toBeLessThan(RIBBON_ONLY_FIT_SCALE_THRESHOLD);
      });
    },
  );

  it(
    "初期フィットの後に届いた新規ワークベンチ（addWorkbench の diff）では" +
      "カメラが再び動かない（Miroの操作感の原則。§8参照）",
    async () => {
      const { container } = render(<App clientFactory={mockClientFactory()} />);

      await screen.findByTestId("infra-card-lighthouse-1");

      let fittedTransform: string | null = null;
      await waitFor(() => {
        fittedTransform = viewportTransform(container);
        const scale = viewportScale(fittedTransform);
        expect(scale).not.toBeNull();
        expect(scale as number).toBeLessThan(RIBBON_ONLY_FIT_SCALE_THRESHOLD);
      });

      fireEvent.change(screen.getByTestId("canvas-toolbar-workbench-label"), {
        target: { value: "e2e-initial-fit-regression" },
      });
      fireEvent.click(screen.getByTestId("canvas-toolbar-add-workbench"));

      // mockData.ts の createMockClient は addWorkbench のたびに
      // `workbench-<entitySeq>` を発番する（entitySeq は App ごとに 0
      // から始まる）。このテストの `<App>` インスタンスで最初に追加する
      // ワークベンチなので id は決定的に "workbench-1" になる。
      await screen.findByTestId("infra-card-workbench-1");

      expect(viewportTransform(container)).toBe(fittedTransform);
    },
  );

  it(
    "初期フィット後、複数回のワールドステート更新(ワークベンチ追加を2回)を経ても" +
      "再フィットは一度も起きない（1回きり ref ガードの確認。点検観点2）",
    async () => {
      const { container } = render(<App clientFactory={mockClientFactory()} />);

      await screen.findByTestId("infra-card-lighthouse-1");

      let fittedTransform: string | null = null;
      await waitFor(() => {
        fittedTransform = viewportTransform(container);
        const scale = viewportScale(fittedTransform);
        expect(scale).not.toBeNull();
        expect(scale as number).toBeLessThan(RIBBON_ONLY_FIT_SCALE_THRESHOLD);
      });

      const label = screen.getByTestId("canvas-toolbar-workbench-label");
      const addButton = screen.getByTestId("canvas-toolbar-add-workbench");

      // 1回目の追加。id は決定的に "workbench-1"。
      fireEvent.change(label, { target: { value: "wb-guard-1" } });
      fireEvent.click(addButton);
      await screen.findByTestId("infra-card-workbench-1");
      expect(viewportTransform(container)).toBe(fittedTransform);

      // 2回目の追加。id は "workbench-2"。新ノードの計測が再度回っても、
      // ref ガードにより二重フィットは起きずカメラは動かない。
      fireEvent.change(label, { target: { value: "wb-guard-2" } });
      fireEvent.click(addButton);
      await screen.findByTestId("infra-card-workbench-2");
      expect(viewportTransform(container)).toBe(fittedTransform);
    },
  );

  it(
    "collector 未接続（スナップショット未受信）の間はキャンバスをフィット" +
      "しない（hasReceivedSnapshot が false のまま。既定ビューポートで" +
      "チェーンリボンが見える。点検観点3）",
    async () => {
      const { container } = render(
        <App clientFactory={neverSnapshotClientFactory()} />,
      );

      // スナップショット到着前からチェーンリボンだけは常設（Issue #298）。
      // これが描画されればキャンバス自体はマウントされている。
      await screen.findByTestId("chain-ribbon-card");

      // スナップショットが来ないのでワールドステートのカードは現れない。
      expect(screen.queryByTestId("infra-card-lighthouse-1")).toBeNull();

      // リボン1枚が計測完了しても、hasReceivedSnapshot が false のため
      // 初期フィットは発火せず、既定ビューポート（等倍・原点）のまま。
      // 「リボンだけに誤ってフィットして zoom が張り付く」旧不具合が
      // 再発しないことの裏返しでもある（Issue #373）。
      //
      // 初期フィットはノード計測完了後の useEffect で走るため、リボンの
      // DOM 出現直後に測ると「まだ発火していないだけ」の等倍を誤って
      // 合格と読む恐れがある。gate を意図的に外すと本スタブ環境では
      // 100ms 以内にリボン1枚へのフィット（scale≒0.91）が走ることを実測
      // したうえで、それを確実に上回る待機を挟んでからビューポートを測る。
      await new Promise((resolve) => setTimeout(resolve, 300));
      const scale = viewportScale(viewportTransform(container));
      // 未フィット時の既定 zoom は等倍（React Flow の defaultViewport=
      // {x:0,y:0,zoom:1}）。仮に gate が壊れてリボン1枚にフィットして
      // しまうとこのスタブ環境では scale≒0.91 になる（本ファイル冒頭の
      // RIBBON_ONLY_FIT_SCALE_THRESHOLD の実測コメント参照）ため、等倍で
      // あることを厳密に確認すればフィット未発火を判別できる。
      expect(scale).toBe(1);
    },
  );
});
