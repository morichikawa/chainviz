import type { WorkbenchEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { operationTargetEdgesToFlowEdges } from "./operationTargetEdge.js";

function workbench(overrides: Partial<WorkbenchEntity> = {}): WorkbenchEntity {
  return {
    kind: "workbench",
    id: "wb-1",
    containerName: "chainviz-wb-1",
    ip: "172.20.0.9",
    ports: [],
    resources: { cpuPercent: 0, memMB: 10 },
    process: { name: "foundry" },
    label: "Alice",
    walletIds: [],
    ...overrides,
  };
}

describe("operationTargetEdgesToFlowEdges", () => {
  it("draws a permanent edge from a workbench to its resolved RPC target", () => {
    const wb = workbench({ rpcTargetNodeId: "reth-1" });
    const edges = operationTargetEdgesToFlowEdges([wb], ["wb-1", "reth-1"]);
    expect(edges).toEqual([
      {
        id: "optarget-wb-1",
        type: "operationTarget",
        source: "wb-1",
        target: "reth-1",
        className: "operation-target-edge",
      },
    ]);
  });

  it("skips a workbench with no resolved rpcTargetNodeId (Issue #123 §4-5 fallback)", () => {
    const wb = workbench({});
    expect(operationTargetEdgesToFlowEdges([wb], ["wb-1"])).toEqual([]);
  });

  it("does not draw a dangling edge when the workbench itself is not present", () => {
    const wb = workbench({ rpcTargetNodeId: "reth-1" });
    expect(operationTargetEdgesToFlowEdges([wb], ["reth-1"])).toEqual([]);
  });

  it("does not draw a dangling edge when the target node is not present (e.g. removed)", () => {
    const wb = workbench({ rpcTargetNodeId: "reth-1" });
    expect(operationTargetEdgesToFlowEdges([wb], ["wb-1"])).toEqual([]);
  });

  it("draws one edge per workbench when several resolve targets", () => {
    const wb1 = workbench({ id: "wb-1", rpcTargetNodeId: "reth-1" });
    const wb2 = workbench({ id: "wb-2", rpcTargetNodeId: "reth-1" });
    const edges = operationTargetEdgesToFlowEdges(
      [wb1, wb2],
      ["wb-1", "wb-2", "reth-1"],
    );
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => e.source).sort()).toEqual(["wb-1", "wb-2"]);
  });

  it("keeps the surviving workbench's edge when another workbench's target node was removed", () => {
    // 2つのワークベンチが別々のノードを操作先にしている状況で、一方の対象
    // ノードだけがキャンバスから消えた場合、消えた側のエッジは描かず、生きて
    // いる側のエッジはそのまま残す(片方の後始末が他方を巻き込まない)。
    const wbLive = workbench({ id: "wb-1", rpcTargetNodeId: "reth-1" });
    const wbDangling = workbench({ id: "wb-2", rpcTargetNodeId: "reth-2" });
    const edges = operationTargetEdgesToFlowEdges(
      [wbLive, wbDangling],
      // reth-2 は present に含めない(削除済み)。
      ["wb-1", "wb-2", "reth-1"],
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: "wb-1", target: "reth-1" });
  });

  it("returns an empty array for no workbenches", () => {
    expect(operationTargetEdgesToFlowEdges([], [])).toEqual([]);
  });

  it("accepts a plain array (not only a Set) for presentInfraIds", () => {
    const wb = workbench({ rpcTargetNodeId: "reth-1" });
    const edges = operationTargetEdgesToFlowEdges(
      [wb],
      new Set(["wb-1", "reth-1"]),
    );
    expect(edges).toHaveLength(1);
  });
});
