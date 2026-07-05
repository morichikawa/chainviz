import type { OperationEdge } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  OPERATION_EDGE_TYPE,
  type OperationFlowEdge,
  type OperationPulse,
  addOperationPulse,
  buildOperationFlowEdge,
  operationEdgeId,
  removeOperationPulse,
} from "./operationEdge.js";

function op(
  overrides: Partial<OperationEdge> = {},
): OperationEdge {
  return {
    kind: "operation",
    fromWorkbenchId: "workbench-alice",
    toNodeId: "reth-node-1",
    operation: "eth_sendRawTransaction",
    observedAt: 1_000,
    ...overrides,
  };
}

function pulse(key: string): OperationPulse {
  return { key, durationMs: 900 };
}

describe("operationEdgeId", () => {
  it("is stable for the same workbench/node pair", () => {
    expect(operationEdgeId("wb", "node")).toBe(operationEdgeId("wb", "node"));
  });

  it("differs by endpoint (direction matters)", () => {
    expect(operationEdgeId("wb", "node")).not.toBe(
      operationEdgeId("node", "wb"),
    );
  });
});

describe("buildOperationFlowEdge", () => {
  it("builds a workbench -> node edge when both endpoints are present", () => {
    const edge = buildOperationFlowEdge(op(), [
      "workbench-alice",
      "reth-node-1",
    ]);
    expect(edge).not.toBeNull();
    expect(edge).toMatchObject({
      id: operationEdgeId("workbench-alice", "reth-node-1"),
      type: OPERATION_EDGE_TYPE,
      source: "workbench-alice",
      target: "reth-node-1",
      data: { operation: "eth_sendRawTransaction", pulses: [] },
    });
  });

  it("returns null when the workbench is missing", () => {
    expect(buildOperationFlowEdge(op(), ["reth-node-1"])).toBeNull();
  });

  it("returns null when the node is missing", () => {
    expect(buildOperationFlowEdge(op(), ["workbench-alice"])).toBeNull();
  });

  it("returns null for a self-loop (from === to)", () => {
    const edge = buildOperationFlowEdge(
      op({ fromWorkbenchId: "x", toNodeId: "x" }),
      ["x"],
    );
    expect(edge).toBeNull();
  });

  it("accepts a Set of present ids", () => {
    const edge = buildOperationFlowEdge(
      op(),
      new Set(["workbench-alice", "reth-node-1"]),
    );
    expect(edge).not.toBeNull();
  });
});

describe("addOperationPulse", () => {
  it("adds a new edge carrying one pulse", () => {
    const base = buildOperationFlowEdge(op(), [
      "workbench-alice",
      "reth-node-1",
    ]) as OperationFlowEdge;
    const next = addOperationPulse([], base, pulse("p1"));
    expect(next).toHaveLength(1);
    expect(next[0].data?.pulses).toEqual([pulse("p1")]);
  });

  it("appends a pulse to an existing edge with the same id", () => {
    const base = buildOperationFlowEdge(op(), [
      "workbench-alice",
      "reth-node-1",
    ]) as OperationFlowEdge;
    const once = addOperationPulse([], base, pulse("p1"));
    const twice = addOperationPulse(once, base, pulse("p2"));
    expect(twice).toHaveLength(1);
    expect(twice[0].data?.pulses).toEqual([pulse("p1"), pulse("p2")]);
  });

  it("updates operation to the latest observation on an existing edge", () => {
    const first = buildOperationFlowEdge(op({ operation: "eth_call" }), [
      "workbench-alice",
      "reth-node-1",
    ]) as OperationFlowEdge;
    const second = buildOperationFlowEdge(
      op({ operation: "eth_sendRawTransaction" }),
      ["workbench-alice", "reth-node-1"],
    ) as OperationFlowEdge;
    const once = addOperationPulse([], first, pulse("p1"));
    const twice = addOperationPulse(once, second, pulse("p2"));
    expect(twice[0].data?.operation).toBe("eth_sendRawTransaction");
  });

  it("keeps distinct edges for distinct pairs", () => {
    const a = buildOperationFlowEdge(op(), [
      "workbench-alice",
      "reth-node-1",
    ]) as OperationFlowEdge;
    const b = buildOperationFlowEdge(op({ toNodeId: "reth-node-2" }), [
      "workbench-alice",
      "reth-node-2",
    ]) as OperationFlowEdge;
    const next = addOperationPulse(addOperationPulse([], a, pulse("p1")), b, pulse("p2"));
    expect(next).toHaveLength(2);
  });
});

describe("removeOperationPulse", () => {
  it("drops the edge when its last pulse is removed", () => {
    const base = buildOperationFlowEdge(op(), [
      "workbench-alice",
      "reth-node-1",
    ]) as OperationFlowEdge;
    const withPulse = addOperationPulse([], base, pulse("p1"));
    const next = removeOperationPulse(withPulse, base.id, "p1");
    expect(next).toEqual([]);
  });

  it("keeps the edge when other pulses remain", () => {
    const base = buildOperationFlowEdge(op(), [
      "workbench-alice",
      "reth-node-1",
    ]) as OperationFlowEdge;
    const withTwo = addOperationPulse(
      addOperationPulse([], base, pulse("p1")),
      base,
      pulse("p2"),
    );
    const next = removeOperationPulse(withTwo, base.id, "p1");
    expect(next).toHaveLength(1);
    expect(next[0].data?.pulses).toEqual([pulse("p2")]);
  });

  it("is a no-op for an unknown pulse key", () => {
    const base = buildOperationFlowEdge(op(), [
      "workbench-alice",
      "reth-node-1",
    ]) as OperationFlowEdge;
    const withPulse = addOperationPulse([], base, pulse("p1"));
    const next = removeOperationPulse(withPulse, base.id, "ghost");
    expect(next).toEqual(withPulse);
  });
});

// --- 異常系・境界値の追加テスト（テスト強化） ---

describe("buildOperationFlowEdge (edge cases)", () => {
  it("returns null when both endpoints are missing", () => {
    expect(buildOperationFlowEdge(op(), [])).toBeNull();
  });

  it("returns null for an empty present-id iterable", () => {
    expect(buildOperationFlowEdge(op(), new Set<string>())).toBeNull();
  });

  it("returns null for a self-loop even when that id is present", () => {
    expect(
      buildOperationFlowEdge(op({ fromWorkbenchId: "x", toNodeId: "x" }), ["x"]),
    ).toBeNull();
  });

  it("returns null for a self-loop when the id is also absent", () => {
    // 自己ループ判定は端点存在判定より前に行われる（存在しても不在でも null）。
    expect(
      buildOperationFlowEdge(op({ fromWorkbenchId: "x", toNodeId: "x" }), []),
    ).toBeNull();
  });

  it("accepts a lazy generator as the present-id iterable", () => {
    function* present(): Generator<string> {
      yield "workbench-alice";
      yield "reth-node-1";
    }
    expect(buildOperationFlowEdge(op(), present())).not.toBeNull();
  });

  it("carries the render metadata (type, className, stroke)", () => {
    const edge = buildOperationFlowEdge(op(), [
      "workbench-alice",
      "reth-node-1",
    ]) as OperationFlowEdge;
    expect(edge.type).toBe(OPERATION_EDGE_TYPE);
    expect(edge.className).toBe("operation-edge");
    expect(edge.style?.stroke).toBeDefined();
    // 土台のエッジはパルスを持たない（useOperationPulses が付与する）。
    expect(edge.data?.pulses).toEqual([]);
  });

  it("preserves an empty operation string without substituting a default", () => {
    const edge = buildOperationFlowEdge(op({ operation: "" }), [
      "workbench-alice",
      "reth-node-1",
    ]) as OperationFlowEdge;
    expect(edge.data?.operation).toBe("");
  });
});

describe("addOperationPulse (edge cases)", () => {
  it("does not mutate the input edges array", () => {
    const base = buildOperationFlowEdge(op(), [
      "workbench-alice",
      "reth-node-1",
    ]) as OperationFlowEdge;
    const input: OperationFlowEdge[] = [];
    const next = addOperationPulse(input, base, pulse("p1"));
    expect(input).toEqual([]);
    expect(next).not.toBe(input);
  });

  it("does not mutate an existing edge's pulses array when appending", () => {
    const base = buildOperationFlowEdge(op(), [
      "workbench-alice",
      "reth-node-1",
    ]) as OperationFlowEdge;
    const once = addOperationPulse([], base, pulse("p1"));
    const firstPulses = once[0].data?.pulses;
    const twice = addOperationPulse(once, base, pulse("p2"));
    // 元の配列・要素は変更されない（イミュータブル）。
    expect(firstPulses).toEqual([pulse("p1")]);
    expect(once[0].data?.pulses).toEqual([pulse("p1")]);
    expect(twice[0]).not.toBe(once[0]);
    expect(twice[0].data?.pulses).not.toBe(firstPulses);
  });

  it("appends without deduplicating a repeated pulse key (upstream must keep keys unique)", () => {
    const base = buildOperationFlowEdge(op(), [
      "workbench-alice",
      "reth-node-1",
    ]) as OperationFlowEdge;
    const once = addOperationPulse([], base, pulse("dup"));
    const twice = addOperationPulse(once, base, pulse("dup"));
    expect(twice[0].data?.pulses).toEqual([pulse("dup"), pulse("dup")]);
  });

  it("accumulates many pulses on the same edge", () => {
    const base = buildOperationFlowEdge(op(), [
      "workbench-alice",
      "reth-node-1",
    ]) as OperationFlowEdge;
    let edges: OperationFlowEdge[] = [];
    for (let i = 0; i < 100; i++) {
      edges = addOperationPulse(edges, base, pulse(`p${i}`));
    }
    expect(edges).toHaveLength(1);
    expect(edges[0].data?.pulses).toHaveLength(100);
  });
});

describe("removeOperationPulse (edge cases)", () => {
  it("returns an empty array for an empty input", () => {
    expect(removeOperationPulse([], "op-any", "p1")).toEqual([]);
  });

  it("is a no-op for an unknown edge id", () => {
    const base = buildOperationFlowEdge(op(), [
      "workbench-alice",
      "reth-node-1",
    ]) as OperationFlowEdge;
    const withPulse = addOperationPulse([], base, pulse("p1"));
    const next = removeOperationPulse(withPulse, "op-nonexistent", "p1");
    expect(next).toEqual(withPulse);
  });

  it("removes the correct pulse among several and preserves order", () => {
    const base = buildOperationFlowEdge(op(), [
      "workbench-alice",
      "reth-node-1",
    ]) as OperationFlowEdge;
    const withThree = addOperationPulse(
      addOperationPulse(
        addOperationPulse([], base, pulse("p1")),
        base,
        pulse("p2"),
      ),
      base,
      pulse("p3"),
    );
    const next = removeOperationPulse(withThree, base.id, "p2");
    expect(next[0].data?.pulses).toEqual([pulse("p1"), pulse("p3")]);
  });

  it("only removes from the matching edge, leaving other edges intact", () => {
    const a = buildOperationFlowEdge(op(), [
      "workbench-alice",
      "reth-node-1",
    ]) as OperationFlowEdge;
    const b = buildOperationFlowEdge(op({ toNodeId: "reth-node-2" }), [
      "workbench-alice",
      "reth-node-2",
    ]) as OperationFlowEdge;
    const edges = addOperationPulse(
      addOperationPulse([], a, pulse("p1")),
      b,
      pulse("p2"),
    );
    const next = removeOperationPulse(edges, a.id, "p1");
    // a はパルスが尽きて消え、b は残る。
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe(b.id);
    expect(next[0].data?.pulses).toEqual([pulse("p2")]);
  });

  it("does not mutate the input edges when removing a pulse", () => {
    const base = buildOperationFlowEdge(op(), [
      "workbench-alice",
      "reth-node-1",
    ]) as OperationFlowEdge;
    const withTwo = addOperationPulse(
      addOperationPulse([], base, pulse("p1")),
      base,
      pulse("p2"),
    );
    const snapshot = withTwo[0].data?.pulses;
    removeOperationPulse(withTwo, base.id, "p1");
    expect(snapshot).toEqual([pulse("p1"), pulse("p2")]);
    expect(withTwo[0].data?.pulses).toEqual([pulse("p1"), pulse("p2")]);
  });
});
