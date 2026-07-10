import { Position, ReactFlowProvider } from "@xyflow/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { OperationTargetEdge } from "./OperationTargetEdge.js";
import type { OperationTargetEdgeData } from "./operationTargetEdge.js";

afterEach(cleanup);

/**
 * OperationTargetEdge をカスタムエッジコンポーネント単体として描画する
 * （`DeployEdge.test.tsx` と同じ狙い）。ホバーポップオーバー本体は
 * `EdgeLabelRenderer`（React Flow 全体が用意するポータル先を要する）で
 * 描かれるため、`ReactFlowProvider` だけを与えた単体描画では出ない
 * （同ファイルと同じ制約）。ポップオーバーの中身自体は
 * `OperationTargetEdgePopover.test.tsx` が担当する。
 */
function renderEdge(data: Partial<OperationTargetEdgeData> | undefined) {
  const props = {
    id: "optarget-wb-1",
    sourceX: 0,
    sourceY: 0,
    targetX: 200,
    targetY: 0,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    style: { stroke: "var(--op-edge)" },
    data,
  } as unknown as Parameters<typeof OperationTargetEdge>[0];
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <ReactFlowProvider>
          <svg>
            <OperationTargetEdge {...props} />
          </svg>
        </ReactFlowProvider>
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

function edgePath(container: HTMLElement): SVGPathElement {
  const path = container.querySelector<SVGPathElement>(".react-flow__edge-path");
  if (!path) throw new Error("edge path not found");
  return path;
}

describe("OperationTargetEdge hover emphasis (Issue #215)", () => {
  it("keeps the base stroke style when not hovered", () => {
    const { container } = renderEdge({
      workbenchContainerName: "chainviz-wb-1",
      targetContainerName: "chainviz-reth-1",
      hovered: false,
    });
    expect(edgePath(container).style.strokeWidth).toBe("");
    expect(container.querySelector(".operation-target-edge--hovered")).toBeNull();
  });

  it("thickens the stroke and adds the hovered class when hovered", () => {
    const { container } = renderEdge({
      workbenchContainerName: "chainviz-wb-1",
      targetContainerName: "chainviz-reth-1",
      hovered: true,
    });
    expect(edgePath(container).style.strokeWidth).toBe("2");
    expect(
      container.querySelector(".operation-target-edge--hovered"),
    ).not.toBeNull();
  });

  it("defaults to not-hovered when hovered is omitted", () => {
    const { container } = renderEdge({
      workbenchContainerName: "chainviz-wb-1",
      targetContainerName: "chainviz-reth-1",
    });
    expect(container.querySelector(".operation-target-edge--hovered")).toBeNull();
  });
});

describe("OperationTargetEdge defensive defaults", () => {
  it("renders a plain edge without throwing when data is undefined", () => {
    const { container } = renderEdge(undefined);
    expect(edgePath(container)).toBeTruthy();
    expect(container.querySelector(".operation-target-edge--hovered")).toBeNull();
  });

  it("does not throw when hovered but the container names are missing (defensive)", () => {
    expect(() => renderEdge({ hovered: true })).not.toThrow();
  });
});
