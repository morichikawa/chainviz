import { Position, ReactFlowProvider } from "@xyflow/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import type { PeerEdgeData } from "./peerEdge.js";
import { PeerPropagationEdge } from "./PeerPropagationEdge.js";

afterEach(cleanup);

/**
 * PeerPropagationEdge をカスタムエッジコンポーネント単体として描画する
 * （React Flow が算出して渡す座標プロパティを手で与える）。ホバー強調と
 * パルス走行が互いに壊れないこと・防御的な既定値の検証に使う。
 *
 * ホバーポップオーバー本体は `EdgeLabelRenderer`（React Flow 全体が用意する
 * ポータル先を要する）で描かれるため、この単体描画では出ない。ポップオーバーの
 * 中身は `PeerEdgePopover.test.tsx` が担当する。
 */
function renderEdge(data: Partial<PeerEdgeData> | undefined) {
  const props = {
    id: "e1",
    sourceX: 0,
    sourceY: 0,
    targetX: 200,
    targetY: 0,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    style: { stroke: "#7db8ff", strokeWidth: 2 },
    data,
  } as unknown as Parameters<typeof PeerPropagationEdge>[0];
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <ReactFlowProvider>
          <svg>
            <PeerPropagationEdge {...props} />
          </svg>
        </ReactFlowProvider>
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

/** BaseEdge が描く本体パス（interaction 用の透明パスを除く）。 */
function edgePath(container: HTMLElement): SVGPathElement {
  const path = container.querySelector<SVGPathElement>(".react-flow__edge-path");
  if (!path) throw new Error("edge path not found");
  return path;
}

/**
 * ノードがドラッグされて座標が変わる場面を再現するため、座標を差し替えて
 * 再レンダーできる形の描画ヘルパー。`renderEdge` は座標を固定しているので、
 * offset-path の追従（Issue #125）を検証する用途にはこちらを使う。
 */
function edgeTree(
  data: Partial<PeerEdgeData> | undefined,
  coords: { targetX: number; targetY: number },
) {
  const props = {
    id: "e1",
    sourceX: 0,
    sourceY: 0,
    targetX: coords.targetX,
    targetY: coords.targetY,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    style: { stroke: "#7db8ff", strokeWidth: 2 },
    data,
  } as unknown as Parameters<typeof PeerPropagationEdge>[0];
  return (
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <ReactFlowProvider>
          <svg>
            <PeerPropagationEdge {...props} />
          </svg>
        </ReactFlowProvider>
      </GlossaryProvider>
    </LanguageProvider>
  );
}

/** 描画された peer-pulse の circle 群を文書順（= map の描画順）で返す。 */
function pulseCircles(container: HTMLElement): SVGCircleElement[] {
  return Array.from(
    container.querySelectorAll<SVGCircleElement>("circle.peer-pulse"),
  );
}

describe("PeerPropagationEdge hover emphasis (Issue #124 B)", () => {
  it("keeps the base strokeWidth when not hovered", () => {
    const { container } = renderEdge({ networkId: "x-execution", hovered: false });
    expect(edgePath(container).style.strokeWidth).toBe("2");
    expect(container.querySelector(".peer-edge--hovered")).toBeNull();
  });

  it("thickens the stroke and adds the hovered class when hovered", () => {
    const { container } = renderEdge({ networkId: "x-execution", hovered: true });
    expect(edgePath(container).style.strokeWidth).toBe("3.5");
    expect(container.querySelector(".peer-edge--hovered")).not.toBeNull();
  });

  it("defaults to not-hovered when hovered is omitted", () => {
    const { container } = renderEdge({ networkId: "x-execution" });
    expect(edgePath(container).style.strokeWidth).toBe("2");
    expect(container.querySelector(".peer-edge--hovered")).toBeNull();
  });
});

describe("PeerPropagationEdge pulses", () => {
  it("renders no pulse circles when there are no pulses", () => {
    const { container } = renderEdge({ networkId: "x-execution", pulses: [] });
    expect(container.querySelectorAll("circle.peer-pulse")).toHaveLength(0);
  });

  it("renders one circle per pulse", () => {
    const { container } = renderEdge({
      networkId: "x-execution",
      pulses: [
        { key: "p1", reverse: false, durationMs: 100 },
        { key: "p2", reverse: true, durationMs: 250 },
      ],
    });
    expect(container.querySelectorAll("circle.peer-pulse")).toHaveLength(2);
  });

  it("does not use SVG animateMotion (Issue #125: replaced by CSS offset-path)", () => {
    // SMILのanimateMotionはbegin未指定だと文書タイムライン0秒起点で解決され、
    // 動的挿入時には再生済み扱いとなりfill=freezeで即終端固定される
    // （一度も動かない）。CSSアニメーションへ移行したことを固定する。
    const { container } = renderEdge({
      networkId: "x-execution",
      pulses: [{ key: "p1", reverse: false, durationMs: 300 }],
    });
    expect(container.querySelector("animateMotion")).toBeNull();
  });

  it("reflects pulse direction and duration via CSS animation properties", () => {
    const { container } = renderEdge({
      networkId: "x-execution",
      pulses: [{ key: "p1", reverse: true, durationMs: 300 }],
    });
    const pulse = container.querySelector<SVGCircleElement>("circle.peer-pulse");
    expect(pulse).not.toBeNull();
    expect(pulse?.style.animationDuration).toBe("300ms");
    expect(pulse?.style.animationDirection).toBe("reverse");
    expect(pulse?.style.offsetPath).toContain("path(");
  });

  it("defaults animation-direction to normal for forward pulses", () => {
    const { container } = renderEdge({
      networkId: "x-execution",
      pulses: [{ key: "p1", reverse: false, durationMs: 150 }],
    });
    const pulse = container.querySelector<SVGCircleElement>("circle.peer-pulse");
    expect(pulse?.style.animationDuration).toBe("150ms");
    expect(pulse?.style.animationDirection).toBe("normal");
  });
});

describe("PeerPropagationEdge multiple pulses stay independent (Issue #125)", () => {
  it("gives each pulse its own duration and direction without cross-contamination", () => {
    // 同一エッジ上に向き・所要時間の異なるパルスが複数同時に走る場面。
    // map で個別の pulse オブジェクトから style を組むため、隣のパルスの値が
    // 混ざってはならない。文書順（描画順）でパルスと1対1に対応することを固定する。
    const pulses = [
      { key: "p1", reverse: false, durationMs: 100 },
      { key: "p2", reverse: true, durationMs: 250 },
      { key: "p3", reverse: false, durationMs: 999 },
    ];
    const { container } = renderEdge({ networkId: "x-execution", pulses });
    const circles = pulseCircles(container);
    expect(circles).toHaveLength(3);
    circles.forEach((circle, i) => {
      expect(circle.style.animationDuration).toBe(`${pulses[i].durationMs}ms`);
      expect(circle.style.animationDirection).toBe(
        pulses[i].reverse ? "reverse" : "normal",
      );
    });
  });

  it("points every pulse on one edge at the same offset-path", () => {
    // 同じエッジ上のパルスは同一パスを走る。パスは共通の edgePath から作られる
    // ため、全パルスの offsetPath が一致していることを確認する。
    const { container } = renderEdge({
      networkId: "x-execution",
      pulses: [
        { key: "p1", reverse: false, durationMs: 100 },
        { key: "p2", reverse: true, durationMs: 250 },
      ],
    });
    const [a, b] = pulseCircles(container);
    expect(a.style.offsetPath).toContain("path(");
    expect(a.style.offsetPath).toBe(b.style.offsetPath);
  });
});

describe("PeerPropagationEdge offset-path follows the edge on re-render (Issue #125)", () => {
  it("updates a running pulse's offset-path when the edge geometry changes (node dragged)", () => {
    // ノードがドラッグされて targetX/Y が変わると edgePath が変わる。同じ
    // pulse.key を保つ再レンダーでは React は同じ circle 要素を使い回すため、
    // offset-path が古いパスのまま取り残されないこと（追従すること）を固定する。
    const data = {
      networkId: "x-execution",
      pulses: [{ key: "p1", reverse: false, durationMs: 300 }],
    };
    const { container, rerender } = render(
      edgeTree(data, { targetX: 200, targetY: 0 }),
    );
    const before = pulseCircles(container)[0].style.offsetPath;
    expect(before).toContain("path(");

    rerender(edgeTree(data, { targetX: 480, targetY: 120 }));
    const after = pulseCircles(container)[0].style.offsetPath;
    expect(after).toContain("path(");
    // 座標が変わった以上、パス文字列も変わっていなければ「古いパスのまま」の兆候。
    expect(after).not.toBe(before);
  });
});

describe("PeerPropagationEdge duration string is generated verbatim (Issue #125)", () => {
  it.each([
    { durationMs: 0, expected: "0ms" },
    { durationMs: 1, expected: "1ms" },
    { durationMs: 123.5, expected: "123.5ms" },
    { durationMs: 10_000_000, expected: "10000000ms" },
  ])(
    "renders animation-duration $expected for durationMs=$durationMs",
    ({ durationMs, expected }) => {
      const { container } = renderEdge({
        networkId: "x-execution",
        pulses: [{ key: "p1", reverse: false, durationMs }],
      });
      const pulse = container.querySelector<SVGCircleElement>("circle.peer-pulse");
      expect(pulse?.style.animationDuration).toBe(expected);
    },
  );
});

describe("PeerPropagationEdge reverse flag boundary (Issue #125)", () => {
  it("treats a missing reverse flag as forward (normal)", () => {
    // 型上は reverse: boolean だが、防御的にフラグ欠落（undefined）を渡された
    // 場合も falsy として normal に落ちることを固定する。
    const { container } = renderEdge({
      networkId: "x-execution",
      pulses: [{ key: "p1", durationMs: 150 } as unknown as {
        key: string;
        reverse: boolean;
        durationMs: number;
      }],
    });
    const pulse = container.querySelector<SVGCircleElement>("circle.peer-pulse");
    expect(pulse?.style.animationDirection).toBe("normal");
  });
});

describe("PeerPropagationEdge hover and pulse coexistence (Issue #124 B)", () => {
  it("emphasizes the stroke while pulses are running at the same time", () => {
    // ホバー強調とブロック伝播パルスは別々のレイヤ。同時に成立し、互いに
    // 打ち消さないことを固定する（設計コメントの「パルス走行中でも壊れない」）。
    const { container } = renderEdge({
      networkId: "x-execution",
      hovered: true,
      pulses: [
        { key: "p1", reverse: false, durationMs: 120 },
        { key: "p2", reverse: true, durationMs: 120 },
      ],
    });
    expect(edgePath(container).style.strokeWidth).toBe("3.5");
    expect(container.querySelector(".peer-edge--hovered")).not.toBeNull();
    expect(container.querySelectorAll("circle.peer-pulse")).toHaveLength(2);
  });
});

describe("PeerPropagationEdge defensive defaults", () => {
  it("renders a plain edge without throwing when data is undefined", () => {
    const { container } = renderEdge(undefined);
    expect(edgePath(container).style.strokeWidth).toBe("2");
    expect(container.querySelectorAll("circle.peer-pulse")).toHaveLength(0);
    expect(container.querySelector(".peer-edge--hovered")).toBeNull();
  });
});
