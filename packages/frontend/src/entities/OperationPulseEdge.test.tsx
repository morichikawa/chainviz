import { Position, ReactFlowProvider } from "@xyflow/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { OperationEdgeData } from "./operationEdge.js";
import { OperationPulseEdge } from "./OperationPulseEdge.js";

afterEach(cleanup);

/**
 * OperationPulseEdge をカスタムエッジコンポーネント単体として描画する
 * （React Flow が算出して渡す座標プロパティを手で与える）。
 *
 * PeerPropagationEdge.test.tsx と同様、Issue #125 で SVG animateMotion から
 * CSS offset-path へ移行したことを固定する回帰テスト。
 */
function renderEdge(data: Partial<OperationEdgeData> | undefined) {
  const props = {
    id: "op1",
    sourceX: 0,
    sourceY: 0,
    targetX: 200,
    targetY: 0,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    style: { stroke: "var(--op-edge)", strokeWidth: 1.6 },
    data,
  } as unknown as Parameters<typeof OperationPulseEdge>[0];
  return render(
    <ReactFlowProvider>
      <svg>
        <OperationPulseEdge {...props} />
      </svg>
    </ReactFlowProvider>,
  );
}

/**
 * 座標を差し替えて再レンダーできる形の描画ヘルパー（ノードがドラッグされて
 * エッジ形状が変わる場面の再現用。Issue #125 の offset-path 追従の検証に使う）。
 */
function edgeTree(
  data: Partial<OperationEdgeData> | undefined,
  coords: { targetX: number; targetY: number },
) {
  const props = {
    id: "op1",
    sourceX: 0,
    sourceY: 0,
    targetX: coords.targetX,
    targetY: coords.targetY,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    style: { stroke: "var(--op-edge)", strokeWidth: 1.6 },
    data,
  } as unknown as Parameters<typeof OperationPulseEdge>[0];
  return (
    <ReactFlowProvider>
      <svg>
        <OperationPulseEdge {...props} />
      </svg>
    </ReactFlowProvider>
  );
}

/** 描画された operation-pulse の circle 群を文書順（= map の描画順）で返す。 */
function pulseCircles(container: HTMLElement): SVGCircleElement[] {
  return Array.from(
    container.querySelectorAll<SVGCircleElement>("circle.operation-pulse"),
  );
}

describe("OperationPulseEdge pulses", () => {
  it("renders no pulse circles when there are no pulses", () => {
    const { container } = renderEdge({ operation: "eth_call", pulses: [] });
    expect(container.querySelectorAll("circle.operation-pulse")).toHaveLength(0);
  });

  it("renders one circle per pulse", () => {
    const { container } = renderEdge({
      operation: "eth_call",
      pulses: [
        { key: "p1", durationMs: 900 },
        { key: "p2", durationMs: 900 },
      ],
    });
    expect(container.querySelectorAll("circle.operation-pulse")).toHaveLength(2);
  });

  it("does not use SVG animateMotion (Issue #125: replaced by CSS offset-path)", () => {
    // SMILのanimateMotionはbegin未指定だと文書タイムライン0秒起点で解決され、
    // 動的挿入時には再生済み扱いとなりfill=freezeで即終端固定される
    // （一度も動かない）。CSSアニメーションへ移行したことを固定する。
    const { container } = renderEdge({
      operation: "eth_call",
      pulses: [{ key: "p1", durationMs: 900 }],
    });
    expect(container.querySelector("animateMotion")).toBeNull();
  });

  it("reflects pulse duration via CSS animation properties", () => {
    const { container } = renderEdge({
      operation: "eth_call",
      pulses: [{ key: "p1", durationMs: 900 }],
    });
    const pulse = container.querySelector<SVGCircleElement>(
      "circle.operation-pulse",
    );
    expect(pulse).not.toBeNull();
    expect(pulse?.style.animationDuration).toBe("900ms");
    expect(pulse?.style.offsetPath).toContain("path(");
  });
});

describe("OperationPulseEdge multiple pulses stay independent (Issue #125)", () => {
  it("gives each pulse its own duration without cross-contamination", () => {
    // 同一操作エッジ上で複数の呼び出しが並行して光る場面（addOperationPulse が
    // 同じエッジへパルスを積む）。各パルスが自分の durationMs を持ち、隣の値が
    // 混ざらないことを文書順で固定する。
    const pulses = [
      { key: "p1", durationMs: 300 },
      { key: "p2", durationMs: 900 },
      { key: "p3", durationMs: 1500 },
    ];
    const { container } = renderEdge({ operation: "eth_call", pulses });
    const circles = pulseCircles(container);
    expect(circles).toHaveLength(3);
    circles.forEach((circle, i) => {
      expect(circle.style.animationDuration).toBe(`${pulses[i].durationMs}ms`);
    });
  });

  it("never sets animation-direction (operation pulses are always source→target)", () => {
    // 操作パルスは常に source→target なので reverse を扱わない。コンポーネントは
    // animationDirection を設定しないため、空文字（未設定）であることを固定する。
    const { container } = renderEdge({
      operation: "eth_call",
      pulses: [{ key: "p1", durationMs: 900 }],
    });
    const pulse = container.querySelector<SVGCircleElement>(
      "circle.operation-pulse",
    );
    expect(pulse?.style.animationDirection).toBe("");
  });

  it("points every pulse on one edge at the same offset-path", () => {
    const { container } = renderEdge({
      operation: "eth_call",
      pulses: [
        { key: "p1", durationMs: 900 },
        { key: "p2", durationMs: 900 },
      ],
    });
    const [a, b] = pulseCircles(container);
    expect(a.style.offsetPath).toContain("path(");
    expect(a.style.offsetPath).toBe(b.style.offsetPath);
  });
});

describe("OperationPulseEdge offset-path follows the edge on re-render (Issue #125)", () => {
  it("updates a running pulse's offset-path when the edge geometry changes", () => {
    const data = {
      operation: "eth_call",
      pulses: [{ key: "p1", durationMs: 900 }],
    };
    const { container, rerender } = render(
      edgeTree(data, { targetX: 200, targetY: 0 }),
    );
    const before = pulseCircles(container)[0].style.offsetPath;
    expect(before).toContain("path(");

    rerender(edgeTree(data, { targetX: 480, targetY: 120 }));
    const after = pulseCircles(container)[0].style.offsetPath;
    expect(after).toContain("path(");
    expect(after).not.toBe(before);
  });
});

describe("OperationPulseEdge duration string is generated verbatim (Issue #125)", () => {
  it.each([
    { durationMs: 0, expected: "0ms" },
    { durationMs: 1, expected: "1ms" },
    { durationMs: 123.5, expected: "123.5ms" },
    { durationMs: 10_000_000, expected: "10000000ms" },
  ])(
    "renders animation-duration $expected for durationMs=$durationMs",
    ({ durationMs, expected }) => {
      const { container } = renderEdge({
        operation: "eth_call",
        pulses: [{ key: "p1", durationMs }],
      });
      const pulse = container.querySelector<SVGCircleElement>(
        "circle.operation-pulse",
      );
      expect(pulse?.style.animationDuration).toBe(expected);
    },
  );
});

describe("OperationPulseEdge defensive defaults", () => {
  it("renders a plain edge without throwing when data is undefined", () => {
    const { container } = renderEdge(undefined);
    expect(container.querySelectorAll("circle.operation-pulse")).toHaveLength(0);
    expect(
      container.querySelector<SVGPathElement>(".react-flow__edge-path"),
    ).not.toBeNull();
  });
});
