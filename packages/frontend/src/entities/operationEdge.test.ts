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
