import type { BlockEntity, NodeEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { detectForkGroups } from "../entities/forkState.js";
import { applyDiff, applySnapshot, listEntities } from "../world-state/store.js";
import { createForkMockSnapshot, mockForkConvergeDiffs } from "./mockData.js";

function isNode(entity: { kind: string }): entity is NodeEntity {
  return entity.kind === "node";
}
function isBlock(entity: { kind: string }): entity is BlockEntity {
  return entity.kind === "block";
}

describe("createForkMockSnapshot (Issue #296)", () => {
  it("includes branch A/B tip blocks and a shared ancestor with consistent parentHash links", () => {
    const snapshot = createForkMockSnapshot();
    const blocks = snapshot.entities.filter(isBlock);
    const byHash = new Map(blocks.map((b) => [b.hash, b]));

    const nodes = snapshot.entities.filter(isNode);
    const rethA = nodes.find((n) => n.id === "reth-node-1");
    const rethB = nodes.find((n) => n.id === "reth-node-2");
    expect(rethA?.headBlockHash).toBeTruthy();
    expect(rethB?.headBlockHash).toBeTruthy();
    expect(rethA?.headBlockHash).not.toBe(rethB?.headBlockHash);

    // 両方の tip が BlockEntity として引ける（forkState の前提条件）。
    expect(byHash.get(rethA!.headBlockHash)).toBeDefined();
    expect(byHash.get(rethB!.headBlockHash)).toBeDefined();

    // branch A の tip を1段辿ると、branch B の tip とは異なる高さ129の
    // ブロックに到達する（本物の分岐であり、単なる祖先関係ではない）。
    const branchATip = byHash.get(rethA!.headBlockHash)!;
    const branchAParent = byHash.get(branchATip.parentHash)!;
    const branchBTip = byHash.get(rethB!.headBlockHash)!;
    expect(branchAParent.number).toBe(branchBTip.number);
    expect(branchAParent.hash).not.toBe(branchBTip.hash);
  });

  it("gives validator nodes an empty headBlockHash (unobserved, excluded from fork detection)", () => {
    const snapshot = createForkMockSnapshot();
    const nodes = snapshot.entities.filter(isNode);
    const validator1 = nodes.find((n) => n.id === "validator-1");
    const validator2 = nodes.find((n) => n.id === "validator-2");
    expect(validator1?.headBlockHash).toBe("");
    expect(validator2?.headBlockHash).toBe("");
  });

  it("produces exactly two fork groups via entities/forkState.ts, split along EL/CL pairs (validators excluded)", () => {
    const snapshot = createForkMockSnapshot();
    const nodes = snapshot.entities.filter(isNode);
    const blocks = snapshot.entities.filter(isBlock);

    const groups = detectForkGroups(nodes, blocks);
    expect(groups).toHaveLength(2);

    const nodeIds = new Set(groups.flatMap((g) => g.nodeIds));
    expect(nodeIds.has("reth-node-1")).toBe(true);
    expect(nodeIds.has("lighthouse-1")).toBe(true);
    expect(nodeIds.has("reth-node-2")).toBe(true);
    expect(nodeIds.has("lighthouse-2")).toBe(true);
    expect(nodeIds.has("validator-1")).toBe(false);
    expect(nodeIds.has("validator-2")).toBe(false);

    const byNode = new Map(groups.flatMap((g) => g.nodeIds.map((id) => [id, g.groupKey])));
    expect(byNode.get("reth-node-1")).toBe(byNode.get("lighthouse-1"));
    expect(byNode.get("reth-node-2")).toBe(byNode.get("lighthouse-2"));
    expect(byNode.get("reth-node-1")).not.toBe(byNode.get("reth-node-2"));
  });

  it("resolves to no fork once mockForkConvergeDiffs is applied (convergence clears the color)", () => {
    const snapshot = createForkMockSnapshot();
    const initialState = applySnapshot(snapshot);
    const convergedState = applyDiff(initialState, mockForkConvergeDiffs());

    const entities = listEntities(convergedState);
    const nodes = entities.filter(isNode);
    const blocks = entities.filter(isBlock);

    const groups = detectForkGroups(nodes, blocks);
    expect(groups).toEqual([]);

    const rethB = nodes.find((n) => n.id === "reth-node-2");
    const rethA = nodes.find((n) => n.id === "reth-node-1");
    expect(rethB?.headBlockHash).toBe(rethA?.headBlockHash);
  });
});
