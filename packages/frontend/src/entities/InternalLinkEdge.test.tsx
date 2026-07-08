import { Position, ReactFlowProvider } from "@xyflow/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { InternalLinkEdge } from "./InternalLinkEdge.js";
import type { InternalLinkEdgeData } from "./internalLinkEdge.js";
import {
  INTERNAL_LINK_CORE_WIDTH,
  INTERNAL_LINK_CORE_WIDTH_HOVERED,
  INTERNAL_LINK_SHEATH_WIDTH_HOVERED,
} from "./internalLinkEdge.js";

afterEach(cleanup);

/**
 * InternalLinkEdge をカスタムエッジコンポーネント単体として描画する
 * （PeerPropagationEdge.test.tsx と同型）。ホバーポップオーバー本体は
 * `EdgeLabelRenderer` で描かれるため、hovered:true でも DOM に現れる
 * （React Flow 全体を要さず `ReactFlowProvider` だけで足りる。実際に
 * `PeerPropagationEdge` 系のテストでも同様に扱っている）。
 */
function renderEdge(data: Partial<InternalLinkEdgeData> | undefined) {
  const props = {
    id: "internal-link-beacon-1=>reth-1",
    sourceX: 0,
    sourceY: 0,
    targetX: 200,
    targetY: 0,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    style: { stroke: "var(--internal-edge)", strokeWidth: 6, strokeOpacity: 0.18 },
    data,
  } as unknown as Parameters<typeof InternalLinkEdge>[0];
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <ReactFlowProvider>
          <svg>
            <InternalLinkEdge {...props} />
          </svg>
        </ReactFlowProvider>
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

function sheathPath(container: HTMLElement): SVGPathElement {
  const path = container.querySelector<SVGPathElement>(".react-flow__edge-path");
  if (!path) throw new Error("sheath path not found");
  return path;
}

function corePath(container: HTMLElement): SVGPathElement {
  const path = container.querySelector<SVGPathElement>(".internal-link-edge__core");
  if (!path) throw new Error("core path not found");
  return path;
}

describe("InternalLinkEdge double-line rendering", () => {
  it("renders both a sheath (BaseEdge) path and a core overlay path", () => {
    const { container } = renderEdge({
      drivingContainerName: "chainviz-lighthouse-1",
      drivenContainerName: "chainviz-reth-1",
    });
    expect(sheathPath(container)).not.toBeNull();
    expect(corePath(container)).not.toBeNull();
  });

  it("draws the core thinner and more opaque than the sheath by default", () => {
    const { container } = renderEdge({
      drivingContainerName: "a",
      drivenContainerName: "b",
    });
    expect(sheathPath(container).style.strokeWidth).toBe("6");
    expect(corePath(container).getAttribute("stroke-width")).toBe(
      String(INTERNAL_LINK_CORE_WIDTH),
    );
  });

  it("does not render an arrow marker (no directional arrowhead on the permanent edge)", () => {
    const { container } = renderEdge({ drivingContainerName: "a", drivenContainerName: "b" });
    expect(container.querySelector("marker")).toBeNull();
  });
});

describe("InternalLinkEdge hover emphasis", () => {
  it("keeps the base widths when not hovered", () => {
    const { container } = renderEdge({
      drivingContainerName: "a",
      drivenContainerName: "b",
      hovered: false,
    });
    expect(sheathPath(container).style.strokeWidth).toBe("6");
    expect(corePath(container).getAttribute("stroke-width")).toBe(
      String(INTERNAL_LINK_CORE_WIDTH),
    );
    expect(container.querySelector(".internal-link-edge--hovered")).toBeNull();
  });

  it("thickens both sheath and core and adds the hovered class when hovered", () => {
    const { container } = renderEdge({
      drivingContainerName: "a",
      drivenContainerName: "b",
      hovered: true,
    });
    expect(sheathPath(container).style.strokeWidth).toBe(
      String(INTERNAL_LINK_SHEATH_WIDTH_HOVERED),
    );
    expect(corePath(container).getAttribute("stroke-width")).toBe(
      String(INTERNAL_LINK_CORE_WIDTH_HOVERED),
    );
    expect(container.querySelector(".internal-link-edge--hovered")).not.toBeNull();
  });

  // ホバーポップオーバー本体は EdgeLabelRenderer（React Flow 全体（<ReactFlow>
  // 本体）が用意するポータル先を要する）で描かれるため、ReactFlowProvider
  // だけのこの単体描画では出ない（PeerPropagationEdge.test.tsx と同じ制約）。
  // ポップオーバーの中身は InternalLinkEdgePopover.test.tsx が担当する。
});

describe("InternalLinkEdge activity pulses", () => {
  it("renders no pulse circles when there are no pulses", () => {
    const { container } = renderEdge({
      drivingContainerName: "a",
      drivenContainerName: "b",
      pulses: [],
    });
    expect(container.querySelectorAll("circle.internal-link-pulse")).toHaveLength(0);
  });

  it("renders one circle per pulse and never sets a reverse direction", () => {
    const { container } = renderEdge({
      drivingContainerName: "a",
      drivenContainerName: "b",
      pulses: [
        { key: "p1", durationMs: 900 },
        { key: "p2", durationMs: 900 },
      ],
    });
    const circles = container.querySelectorAll<SVGCircleElement>(
      "circle.internal-link-pulse",
    );
    expect(circles).toHaveLength(2);
    for (const circle of circles) {
      expect(circle.style.animationDirection).not.toBe("reverse");
    }
  });

  it("reflects pulse duration via CSS animation properties", () => {
    const { container } = renderEdge({
      drivingContainerName: "a",
      drivenContainerName: "b",
      pulses: [{ key: "p1", durationMs: 900 }],
    });
    const pulse = container.querySelector<SVGCircleElement>(
      "circle.internal-link-pulse",
    );
    expect(pulse?.style.animationDuration).toBe("900ms");
    expect(pulse?.style.offsetPath).toContain("path(");
  });

  it("does not use SVG animateMotion (matches Issue #125's offset-path approach)", () => {
    const { container } = renderEdge({
      drivingContainerName: "a",
      drivenContainerName: "b",
      pulses: [{ key: "p1", durationMs: 900 }],
    });
    expect(container.querySelector("animateMotion")).toBeNull();
  });
});

describe("InternalLinkEdge defensive defaults", () => {
  it("renders a plain double-line edge without throwing when data is undefined", () => {
    const { container } = renderEdge(undefined);
    expect(sheathPath(container)).not.toBeNull();
    expect(corePath(container)).not.toBeNull();
    expect(container.querySelectorAll("circle.internal-link-pulse")).toHaveLength(0);
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
  });
});
