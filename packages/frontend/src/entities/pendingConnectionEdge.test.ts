import { describe, expect, it } from "vitest";
import { createGhostNode } from "./ghostNode.js";
import {
  PENDING_CONNECTION_EDGE_TYPE,
  ghostsToPendingConnectionEdges,
} from "./pendingConnectionEdge.js";

describe("ghostsToPendingConnectionEdges", () => {
  it("draws an edge from a node ghost to its resolved bootnode", () => {
    const ghost = createGhostNode({
      commandId: "cmd-1",
      kind: "node",
      label: "ethereum",
      index: 0,
      layer: "execution",
      targetContainerName: "chainviz-reth-1",
      targetNodeId: "reth-1",
    });
    const edges = ghostsToPendingConnectionEdges([ghost], ["reth-1"]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      id: `pending-${ghost.id}`,
      type: PENDING_CONNECTION_EDGE_TYPE,
      source: ghost.id,
      target: "reth-1",
    });
    expect(edges[0].className).toContain("pending-connection-edge--peer");
  });

  it("uses the operation-family variant for a workbench ghost", () => {
    const ghost = createGhostNode({
      commandId: "cmd-2",
      kind: "workbench",
      label: "Carol",
      index: 0,
      targetContainerName: "chainviz-reth-1",
      targetNodeId: "reth-1",
    });
    const edges = ghostsToPendingConnectionEdges([ghost], ["reth-1"]);
    expect(edges[0].className).toContain("pending-connection-edge--operation");
    expect(edges[0].className).not.toContain("peer");
  });

  it("skips a ghost with no resolved target (Issue #123 §4-5 fallback)", () => {
    const ghost = createGhostNode({
      commandId: "cmd-3",
      kind: "node",
      label: "ethereum",
      index: 0,
      layer: "consensus",
    });
    expect(ghostsToPendingConnectionEdges([ghost], [])).toEqual([]);
  });

  it("skips a ghost whose resolved target is not currently present on the canvas", () => {
    const ghost = createGhostNode({
      commandId: "cmd-4",
      kind: "node",
      label: "ethereum",
      index: 0,
      layer: "execution",
      targetContainerName: "chainviz-reth-1",
      targetNodeId: "reth-1",
    });
    expect(ghostsToPendingConnectionEdges([ghost], ["some-other-id"])).toEqual([]);
  });

  it("returns one edge per ghost when multiple ghosts resolve distinct targets", () => {
    const execution = createGhostNode({
      commandId: "cmd-5",
      kind: "node",
      label: "ethereum",
      index: 0,
      layer: "execution",
      targetContainerName: "chainviz-reth-1",
      targetNodeId: "reth-1",
    });
    const consensus = createGhostNode({
      commandId: "cmd-5",
      kind: "node",
      label: "ethereum",
      index: 1,
      layer: "consensus",
      targetContainerName: "chainviz-lighthouse-1",
      targetNodeId: "lighthouse-1",
    });
    const edges = ghostsToPendingConnectionEdges(
      [execution, consensus],
      ["reth-1", "lighthouse-1"],
    );
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => e.target).sort()).toEqual(["lighthouse-1", "reth-1"]);
  });

  it("draws edges only for ghosts whose target is present, skipping the rest (partial resolution)", () => {
    // reth ゴーストの接続先(reth-1)は到着済みだが、beacon ゴーストの接続先
    // (lighthouse-1)はまだ現れていない。ペアの片方だけ接続予定先が存在する
    // 状況でも、存在する方だけエッジを描き、他方は宙ぶらりんにしない。
    const present = createGhostNode({
      commandId: "cmd-a",
      kind: "node",
      label: "ethereum",
      index: 0,
      layer: "execution",
      targetContainerName: "chainviz-reth-1",
      targetNodeId: "reth-1",
    });
    const absent = createGhostNode({
      commandId: "cmd-a",
      kind: "node",
      label: "ethereum",
      index: 1,
      layer: "consensus",
      targetContainerName: "chainviz-lighthouse-1",
      targetNodeId: "lighthouse-1",
    });
    const edges = ghostsToPendingConnectionEdges([present, absent], ["reth-1"]);
    expect(edges).toHaveLength(1);
    expect(edges[0].target).toBe("reth-1");
  });

  it("returns an empty array for an empty ghost list", () => {
    expect(ghostsToPendingConnectionEdges([], ["reth-1"])).toEqual([]);
  });

  it("accepts a plain array (not only a Set) for presentInfraIds", () => {
    const ghost = createGhostNode({
      commandId: "cmd-6",
      kind: "node",
      label: "ethereum",
      index: 0,
      layer: "execution",
      targetContainerName: "chainviz-reth-1",
      targetNodeId: "reth-1",
    });
    const edges = ghostsToPendingConnectionEdges([ghost], new Set(["reth-1"]));
    expect(edges).toHaveLength(1);
  });
});
