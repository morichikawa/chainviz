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

  it("reflects pulse direction and duration on the animateMotion", () => {
    const { container } = renderEdge({
      networkId: "x-execution",
      pulses: [{ key: "p1", reverse: true, durationMs: 300 }],
    });
    const motion = container.querySelector("animateMotion");
    expect(motion?.getAttribute("keyPoints")).toBe("1;0");
    expect(motion?.getAttribute("dur")).toBe("300ms");
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
