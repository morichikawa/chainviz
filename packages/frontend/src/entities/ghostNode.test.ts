import { describe, expect, it } from "vitest";
import {
  GHOST_NODE_TYPE,
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
});
