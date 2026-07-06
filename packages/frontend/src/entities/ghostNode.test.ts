import { describe, expect, it } from "vitest";
import { DEFAULT_GRID, defaultGridPosition } from "./infraNode.js";
import {
  GHOST_NODE_TYPE,
  GHOST_TIMEOUT_MS,
  createGhostNode,
  removeGhostByCommandId,
  removeGhostForArrivedEntity,
  removeOldestGhostByKind,
} from "./ghostNode.js";

describe("createGhostNode", () => {
  it("builds a non-draggable, non-selectable ghost node keyed by commandId", () => {
    const ghost = createGhostNode({
      commandId: "cmd-1",
      kind: "node",
      label: "ethereum",
      index: 0,
    });

    expect(ghost.id).toBe("ghost-cmd-1");
    expect(ghost.type).toBe(GHOST_NODE_TYPE);
    expect(ghost.draggable).toBe(false);
    expect(ghost.selectable).toBe(false);
    expect(ghost.data).toEqual({
      commandId: "cmd-1",
      kind: "node",
      label: "ethereum",
    });
  });

  it("places successive ghosts at successive grid positions so they never overlap", () => {
    const first = createGhostNode({
      commandId: "cmd-1",
      kind: "node",
      label: "ethereum",
      index: 0,
    });
    const second = createGhostNode({
      commandId: "cmd-2",
      kind: "workbench",
      label: "Carol",
      index: 1,
    });

    expect(first.position).not.toEqual(second.position);
  });

  it("gives many consecutive indices pairwise-distinct positions (rapid burst)", () => {
    const positions = Array.from({ length: 10 }, (_, index) =>
      JSON.stringify(
        createGhostNode({
          commandId: `cmd-${index}`,
          kind: "node",
          label: "ethereum",
          index,
        }).position,
      ),
    );
    // 10連打相当でも 1 件も重ならない（全て一意）。
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("wraps to a new row past the grid width without colliding with the first row", () => {
    // index が columns を跨ぐと row が増え、列が一巡しても y がずれるので衝突しない。
    const topLeft = createGhostNode({
      commandId: "a",
      kind: "node",
      label: "x",
      index: 0,
    });
    const nextRowSameCol = createGhostNode({
      commandId: "b",
      kind: "node",
      label: "y",
      index: DEFAULT_GRID.columns,
    });
    expect(nextRowSameCol.position.x).toBe(topLeft.position.x);
    expect(nextRowSameCol.position.y).not.toBe(topLeft.position.y);
  });

  it("derives the position from the default grid for the given index", () => {
    const ghost = createGhostNode({
      commandId: "a",
      kind: "node",
      label: "x",
      index: 4,
    });
    expect(ghost.position).toEqual(defaultGridPosition(4, DEFAULT_GRID));
  });

  it("honors a custom grid when supplied", () => {
    const grid = { columns: 1, gapX: 10, gapY: 10, originX: 5, originY: 7 };
    const ghost = createGhostNode({
      commandId: "a",
      kind: "node",
      label: "x",
      index: 2,
      grid,
    });
    expect(ghost.position).toEqual(defaultGridPosition(2, grid));
  });

  it("preserves an empty / whitespace / special-character label verbatim in data", () => {
    for (const label of ["", "   ", "🚀 <b>Zoe</b>"]) {
      const ghost = createGhostNode({
        commandId: "a",
        kind: "workbench",
        label,
        index: 0,
      });
      expect(ghost.data.label).toBe(label);
    }
  });

  it("keeps the safety-net timeout a positive finite value", () => {
    // 「UI 上の仮カードをいつまでも出しっぱなしにしない」ための固定 UX 値。
    expect(Number.isFinite(GHOST_TIMEOUT_MS)).toBe(true);
    expect(GHOST_TIMEOUT_MS).toBeGreaterThan(0);
  });

  describe("layer / connection target (Issue #123)", () => {
    it("suffixes the id with the layer so an execution/consensus pair sharing a commandId don't collide", () => {
      const execution = createGhostNode({
        commandId: "cmd-1",
        kind: "node",
        label: "ethereum",
        index: 0,
        layer: "execution",
      });
      const consensus = createGhostNode({
        commandId: "cmd-1",
        kind: "node",
        label: "ethereum",
        index: 1,
        layer: "consensus",
      });
      expect(execution.id).toBe("ghost-cmd-1-execution");
      expect(consensus.id).toBe("ghost-cmd-1-consensus");
      expect(execution.id).not.toBe(consensus.id);
    });

    it("keeps the legacy unsuffixed id for a workbench ghost (no layer)", () => {
      const ghost = createGhostNode({
        commandId: "cmd-2",
        kind: "workbench",
        label: "Carol",
        index: 0,
      });
      expect(ghost.id).toBe("ghost-cmd-2");
      expect(ghost.data.layer).toBeUndefined();
    });

    it("carries the resolved connection target through to data", () => {
      const ghost = createGhostNode({
        commandId: "cmd-3",
        kind: "node",
        label: "ethereum",
        index: 0,
        layer: "execution",
        targetContainerName: "chainviz-ethereum-reth1",
        targetNodeId: "reth-1",
      });
      expect(ghost.data.targetContainerName).toBe("chainviz-ethereum-reth1");
      expect(ghost.data.targetNodeId).toBe("reth-1");
    });

    it("omits the connection target fields when unresolved (Issue #123 §4-5 fallback)", () => {
      const ghost = createGhostNode({
        commandId: "cmd-4",
        kind: "node",
        label: "ethereum",
        index: 0,
        layer: "consensus",
      });
      expect(ghost.data.targetContainerName).toBeUndefined();
      expect(ghost.data.targetNodeId).toBeUndefined();
    });
  });
});

describe("removeGhostByCommandId", () => {
  it("removes only the ghost matching the given commandId", () => {
    const a = createGhostNode({ commandId: "a", kind: "node", label: "x", index: 0 });
    const b = createGhostNode({ commandId: "b", kind: "node", label: "y", index: 1 });

    const result = removeGhostByCommandId([a, b], "a");
    expect(result).toEqual([b]);
  });

  it("returns the array unchanged (by value) when the commandId is not found", () => {
    const a = createGhostNode({ commandId: "a", kind: "node", label: "x", index: 0 });
    const result = removeGhostByCommandId([a], "not-there");
    expect(result).toEqual([a]);
  });

  it("returns an empty array when given an empty array", () => {
    expect(removeGhostByCommandId([], "a")).toEqual([]);
  });

  it("preserves the relative order of the remaining ghosts", () => {
    const a = createGhostNode({ commandId: "a", kind: "node", label: "x", index: 0 });
    const b = createGhostNode({ commandId: "b", kind: "node", label: "y", index: 1 });
    const c = createGhostNode({ commandId: "c", kind: "node", label: "z", index: 2 });
    expect(removeGhostByCommandId([a, b, c], "b")).toEqual([a, c]);
  });

  it("returns a new array (does not mutate the input) even on a no-op", () => {
    const a = createGhostNode({ commandId: "a", kind: "node", label: "x", index: 0 });
    const input = [a];
    const result = removeGhostByCommandId(input, "not-there");
    expect(result).not.toBe(input);
    expect(input).toEqual([a]);
  });
});

describe("removeOldestGhostByKind", () => {
  it("removes the first matching ghost (FIFO), leaving others untouched", () => {
    const first = createGhostNode({ commandId: "1", kind: "node", label: "a", index: 0 });
    const second = createGhostNode({ commandId: "2", kind: "node", label: "b", index: 1 });
    const workbench = createGhostNode({
      commandId: "3",
      kind: "workbench",
      label: "c",
      index: 2,
    });

    const result = removeOldestGhostByKind([first, second, workbench], "node");
    expect(result).toEqual([second, workbench]);
  });

  it("only removes ghosts of the matching kind", () => {
    const workbench = createGhostNode({
      commandId: "1",
      kind: "workbench",
      label: "a",
      index: 0,
    });
    const result = removeOldestGhostByKind([workbench], "node");
    expect(result).toEqual([workbench]);
  });

  it("returns the array unchanged when there are no ghosts to remove", () => {
    expect(removeOldestGhostByKind([], "node")).toEqual([]);
  });

  it("removes exactly one ghost even when several of the kind are present", () => {
    const a = createGhostNode({ commandId: "a", kind: "node", label: "x", index: 0 });
    const b = createGhostNode({ commandId: "b", kind: "node", label: "y", index: 1 });
    const c = createGhostNode({ commandId: "c", kind: "node", label: "z", index: 2 });
    const result = removeOldestGhostByKind([a, b, c], "node");
    expect(result).toEqual([b, c]);
    expect(result).toHaveLength(2);
  });

  it("removes the first matching kind when kinds are interleaved (skips other kinds)", () => {
    const wb1 = createGhostNode({ commandId: "1", kind: "workbench", label: "a", index: 0 });
    const node1 = createGhostNode({ commandId: "2", kind: "node", label: "b", index: 1 });
    const wb2 = createGhostNode({ commandId: "3", kind: "workbench", label: "c", index: 2 });
    const node2 = createGhostNode({ commandId: "4", kind: "node", label: "d", index: 3 });

    // 先頭は workbench だが node を消すよう指示したので node1 だけが消える。
    expect(removeOldestGhostByKind([wb1, node1, wb2, node2], "node")).toEqual([
      wb1,
      wb2,
      node2,
    ]);
  });

  it("returns a new array (does not mutate the input) when it removes a ghost", () => {
    const a = createGhostNode({ commandId: "a", kind: "node", label: "x", index: 0 });
    const input = [a];
    const result = removeOldestGhostByKind(input, "node");
    expect(result).not.toBe(input);
    expect(input).toEqual([a]);
  });
});

describe("removeGhostForArrivedEntity (Issue #123)", () => {
  it("removes the oldest execution-layer ghost when a reth entity arrives", () => {
    const execution = createGhostNode({
      commandId: "cmd-1",
      kind: "node",
      label: "ethereum",
      index: 0,
      layer: "execution",
    });
    const consensus = createGhostNode({
      commandId: "cmd-1",
      kind: "node",
      label: "ethereum",
      index: 1,
      layer: "consensus",
    });
    const result = removeGhostForArrivedEntity([execution, consensus], {
      kind: "node",
      clientType: "reth",
    });
    expect(result).toEqual([consensus]);
  });

  it("removes the oldest consensus-layer ghost when a lighthouse entity arrives", () => {
    const execution = createGhostNode({
      commandId: "cmd-1",
      kind: "node",
      label: "ethereum",
      index: 0,
      layer: "execution",
    });
    const consensus = createGhostNode({
      commandId: "cmd-1",
      kind: "node",
      label: "ethereum",
      index: 1,
      layer: "consensus",
    });
    const result = removeGhostForArrivedEntity([execution, consensus], {
      kind: "node",
      clientType: "lighthouse",
    });
    expect(result).toEqual([execution]);
  });

  it("removes the oldest workbench ghost when a workbench entity arrives (no layer)", () => {
    const wb1 = createGhostNode({ commandId: "1", kind: "workbench", label: "a", index: 0 });
    const wb2 = createGhostNode({ commandId: "2", kind: "workbench", label: "b", index: 1 });
    expect(
      removeGhostForArrivedEntity([wb1, wb2], { kind: "workbench" }),
    ).toEqual([wb2]);
  });

  it("falls back to kind-only FIFO when no ghost has a matching layer (legacy/generic ghosts)", () => {
    const legacyGhost = createGhostNode({
      commandId: "1",
      kind: "node",
      label: "ethereum",
      index: 0,
      // layer 省略: 旧スナップショット・層不明の生成物を模す。
    });
    const result = removeGhostForArrivedEntity([legacyGhost], {
      kind: "node",
      clientType: "reth",
    });
    expect(result).toEqual([]);
  });

  it("falls back to kind-only FIFO when clientType is missing", () => {
    const execution = createGhostNode({
      commandId: "1",
      kind: "node",
      label: "ethereum",
      index: 0,
      layer: "execution",
    });
    const result = removeGhostForArrivedEntity([execution], { kind: "node" });
    expect(result).toEqual([]);
  });

  it("does not touch ghosts of the other layer/kind when nothing matches", () => {
    const workbench = createGhostNode({
      commandId: "1",
      kind: "workbench",
      label: "a",
      index: 0,
    });
    const result = removeGhostForArrivedEntity([workbench], {
      kind: "node",
      clientType: "reth",
    });
    expect(result).toEqual([workbench]);
  });

  it("returns the array unchanged when there are no ghosts", () => {
    expect(removeGhostForArrivedEntity([], { kind: "node", clientType: "reth" })).toEqual(
      [],
    );
  });

  it("removes the oldest consensus ghost across two pending pairs without touching an earlier execution ghost (cross-pair interleave)", () => {
    // 2回の addNode で4枚のゴースト(exec-A, cons-A, exec-B, cons-B)が保留中。
    // ペアAの beacon が先に実体化した場合、配列上は exec-A の方が先にあるが、
    // 層一致で最も古い consensus ゴースト(cons-A)を消す。別ペアの execution を
    // 誤って巻き込まない(ペアの取り違え・交錯が起きないことの確認)。
    const execA = createGhostNode({ commandId: "A", kind: "node", label: "e", index: 0, layer: "execution" });
    const consA = createGhostNode({ commandId: "A", kind: "node", label: "e", index: 1, layer: "consensus" });
    const execB = createGhostNode({ commandId: "B", kind: "node", label: "e", index: 2, layer: "execution" });
    const consB = createGhostNode({ commandId: "B", kind: "node", label: "e", index: 3, layer: "consensus" });
    const result = removeGhostForArrivedEntity([execA, consA, execB, consB], {
      kind: "node",
      clientType: "lighthouse",
    });
    expect(result).toEqual([execA, execB, consB]);
  });

  it("matches by layer over array position when a consensus ghost precedes the execution ghost", () => {
    // 何らかの理由でゴーストの並びが consensus 先行になっていても、reth の到着は
    // (先頭の consensus ではなく)execution ゴーストを消す。純粋な先頭 FIFO では
    // なく「層一致を優先し、その中で最古」という順序であることの確認。
    const cons = createGhostNode({ commandId: "A", kind: "node", label: "e", index: 0, layer: "consensus" });
    const exec = createGhostNode({ commandId: "A", kind: "node", label: "e", index: 1, layer: "execution" });
    const result = removeGhostForArrivedEntity([cons, exec], {
      kind: "node",
      clientType: "reth",
    });
    expect(result).toEqual([cons]);
  });
});
