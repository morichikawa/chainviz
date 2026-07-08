import { Position, ReactFlowProvider } from "@xyflow/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { DeployEdge } from "./DeployEdge.js";
import type { DeployEdgeData } from "./deployEdge.js";

afterEach(cleanup);

/**
 * DeployEdge をカスタムエッジコンポーネント単体として描画する（React Flow が
 * 算出して渡す座標プロパティを手で与える。PeerPropagationEdge.test.tsx と
 * 同じ狙い）。
 *
 * ホバーポップオーバー本体は `EdgeLabelRenderer`（React Flow 全体が用意する
 * ポータル先を要する）で描かれるため、`ReactFlowProvider` だけを与えた単体
 * 描画では出ない（PeerPropagationEdge.test.tsx と同じ制約）。ポップオーバーの
 * 中身自体は `DeployEdgePopover.test.tsx` が担当する。
 */
function renderEdge(data: Partial<DeployEdgeData> | undefined) {
  const props = {
    id: "e1",
    sourceX: 0,
    sourceY: 0,
    targetX: 200,
    targetY: 0,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    style: { stroke: "#6f7dea" },
    data,
  } as unknown as Parameters<typeof DeployEdge>[0];
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <ReactFlowProvider>
          <svg>
            <DeployEdge {...props} />
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

describe("DeployEdge hover emphasis", () => {
  it("keeps the base stroke style when not hovered", () => {
    const { container } = renderEdge({
      deployerAddress: "0xabc",
      hovered: false,
    });
    expect(edgePath(container).style.strokeWidth).toBe("");
    expect(container.querySelector(".deploy-edge--hovered")).toBeNull();
  });

  it("thickens the stroke and adds the hovered class when hovered", () => {
    const { container } = renderEdge({
      deployerAddress: "0xabc",
      hovered: true,
    });
    expect(edgePath(container).style.strokeWidth).toBe("2.6");
    expect(container.querySelector(".deploy-edge--hovered")).not.toBeNull();
  });

  it("defaults to not-hovered when hovered is omitted", () => {
    const { container } = renderEdge({ deployerAddress: "0xabc" });
    expect(container.querySelector(".deploy-edge--hovered")).toBeNull();
  });
});

describe("DeployEdge defensive defaults", () => {
  it("renders a plain edge without throwing when data is undefined", () => {
    const { container } = renderEdge(undefined);
    expect(edgePath(container)).toBeTruthy();
    expect(container.querySelector(".deploy-edge--hovered")).toBeNull();
  });

  it("does not throw when hovered but the deployer address is missing (defensive)", () => {
    expect(() => renderEdge({ hovered: true })).not.toThrow();
  });
});
