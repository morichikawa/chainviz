import { Position, ReactFlowProvider } from "@xyflow/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ContractCallPulseEdgeData } from "./contractCallPulseEdge.js";
import { ContractCallPulseEdge } from "./ContractCallPulseEdge.js";

afterEach(cleanup);

/**
 * ContractCallPulseEdge をカスタムエッジコンポーネント単体として描画する
 * （OperationPulseEdge.test.tsx と同型。React Flow が算出して渡す座標
 * プロパティを手で与える）。
 */
function renderEdge(data: Partial<ContractCallPulseEdgeData> | undefined) {
  const props = {
    id: "cc1",
    sourceX: 0,
    sourceY: 0,
    targetX: 200,
    targetY: 0,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    style: { stroke: "var(--contract-edge)", strokeWidth: 1.6 },
    data,
  } as unknown as Parameters<typeof ContractCallPulseEdge>[0];
  return render(
    <ReactFlowProvider>
      <svg>
        <ContractCallPulseEdge {...props} />
      </svg>
    </ReactFlowProvider>,
  );
}

describe("ContractCallPulseEdge pulses", () => {
  it("renders no pulse circles when there are no pulses", () => {
    const { container } = renderEdge({ pulses: [] });
    expect(container.querySelectorAll("circle.contract-call-pulse")).toHaveLength(0);
  });

  it("renders one circle per pulse", () => {
    const { container } = renderEdge({
      pulses: [
        { key: "p1", durationMs: 900 },
        { key: "p2", durationMs: 900 },
      ],
    });
    expect(container.querySelectorAll("circle.contract-call-pulse")).toHaveLength(2);
  });

  it("reflects pulse duration via CSS animation properties", () => {
    const { container } = renderEdge({ pulses: [{ key: "p1", durationMs: 900 }] });
    const pulse = container.querySelector<SVGCircleElement>(
      "circle.contract-call-pulse",
    );
    expect(pulse).not.toBeNull();
    expect(pulse?.style.animationDuration).toBe("900ms");
    expect(pulse?.style.offsetPath).toContain("path(");
  });

  it("does not use SVG animateMotion (matches Issue #125's offset-path approach)", () => {
    const { container } = renderEdge({ pulses: [{ key: "p1", durationMs: 900 }] });
    expect(container.querySelector("animateMotion")).toBeNull();
  });
});

describe("ContractCallPulseEdge defensive defaults", () => {
  it("renders a plain edge without throwing when data is undefined", () => {
    const { container } = renderEdge(undefined);
    expect(container.querySelectorAll("circle.contract-call-pulse")).toHaveLength(0);
    expect(
      container.querySelector<SVGPathElement>(".react-flow__edge-path"),
    ).not.toBeNull();
  });
});
