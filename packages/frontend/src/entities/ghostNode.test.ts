import { describe, expect, it } from "vitest";
import { DEFAULT_GRID, defaultGridPosition } from "./infraNode.js";
import {
  GHOST_NODE_TYPE,
  GHOST_TIMEOUT_MS,
  createGhostNode,
  removeGhostByCommandId,
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
