import type { WorldState } from "../world-state/store.js";
import { describe, expect, it } from "vitest";
import { deriveCommsLogEntries } from "./deriveCommsLogEntries.js";
import { testNode, testWorkbench } from "./testFixtures.js";

function stateWith(...entities: Array<ReturnType<typeof testNode> | ReturnType<typeof testWorkbench>>): WorldState {
  const map: WorldState["entities"] = {};
  for (const entity of entities) {
    map[entity.id] = entity;
  }
  return { entities: map, edges: [] };
}

describe("deriveCommsLogEntries: operation category (operationObserved)", () => {
  it("builds an operation entry with resolved workbench/node labels", () => {
    const prevState = stateWith(
      testWorkbench({ id: "wb-1", label: "Alice" }),
      testNode({ id: "reth-1", containerName: "chainviz-reth-1" }),
    );

    const entries = deriveCommsLogEntries(
      prevState,
      [
        {
          type: "operationObserved",
          edge: {
            kind: "operation",
            fromWorkbenchId: "wb-1",
            toNodeId: "reth-1",
            operation: "eth_sendRawTransaction",
            observedAt: 5_000,
          },
        },
      ],
      6_000,
    );

    expect(entries).toEqual([
      {
        id: expect.any(String),
        category: "operation",
        timestamp: 5_000,
        actorIds: ["wb-1", "reth-1"],
        workbenchId: "wb-1",
        workbenchLabel: "Alice",
        nodeId: "reth-1",
        nodeLabel: "chainviz-reth-1",
        method: "eth_sendRawTransaction",
      },
    ]);
  });

  it("carries outcome/durationMs through from OperationEdge when observed (Issue #352)", () => {
    const entries = deriveCommsLogEntries(
      { entities: {}, edges: [] },
      [
        {
          type: "operationObserved",
          edge: {
            kind: "operation",
            fromWorkbenchId: "wb-1",
            toNodeId: "reth-1",
            operation: "eth_call",
            observedAt: 1_000,
            outcome: "ok",
            durationMs: 7,
          },
        },
      ],
      1_000,
    );

    expect(entries[0]).toMatchObject({ outcome: "ok", durationMs: 7 });
  });

  it("leaves outcome/durationMs undefined when the edge does not carry them (judgement-impossible case)", () => {
    const entries = deriveCommsLogEntries(
      { entities: {}, edges: [] },
      [
        {
          type: "operationObserved",
          edge: {
            kind: "operation",
            fromWorkbenchId: "wb-1",
            toNodeId: "reth-1",
            operation: "eth_call",
            observedAt: 1_000,
          },
        },
      ],
      1_000,
    );

    expect(entries[0]).toMatchObject({ outcome: undefined, durationMs: undefined });
  });

  it("falls back to raw ids when the workbench/node are unknown", () => {
    const entries = deriveCommsLogEntries(
      { entities: {}, edges: [] },
      [
        {
          type: "operationObserved",
          edge: {
            kind: "operation",
            fromWorkbenchId: "wb-gone",
            toNodeId: "node-gone",
            operation: "eth_call",
            observedAt: 1_000,
          },
        },
      ],
      1_000,
    );

    expect(entries[0]).toMatchObject({ workbenchLabel: "wb-gone", nodeLabel: "node-gone" });
  });
});

describe("deriveCommsLogEntries: internal category (nodeLinkActivity)", () => {
  it("builds an internal entry carrying the calls list", () => {
    const prevState = stateWith(
      testNode({ id: "beacon-1", containerName: "chainviz-lighthouse-1" }),
      testNode({ id: "reth-1", containerName: "chainviz-reth-1" }),
    );

    const entries = deriveCommsLogEntries(
      prevState,
      [
        {
          type: "nodeLinkActivity",
          activity: {
            fromNodeId: "beacon-1",
            toNodeId: "reth-1",
            calls: [{ method: "engine_newPayloadV4", count: 1, latencyMs: 12 }],
            observedAt: 2_000,
          },
        },
      ],
      3_000,
    );

    expect(entries).toEqual([
      {
        id: expect.any(String),
        category: "internal",
        timestamp: 2_000,
        actorIds: ["beacon-1", "reth-1"],
        fromNodeId: "beacon-1",
        fromLabel: "chainviz-lighthouse-1",
        toNodeId: "reth-1",
        toLabel: "chainviz-reth-1",
        calls: [{ method: "engine_newPayloadV4", count: 1, latencyMs: 12 }],
      },
    ]);
  });

  it("does not record an entry when the calls list is empty", () => {
    const entries = deriveCommsLogEntries(
      { entities: {}, edges: [] },
      [
        {
          type: "nodeLinkActivity",
          activity: { fromNodeId: "a", toNodeId: "b", calls: [], observedAt: 1_000 },
        },
      ],
      1_000,
    );
    expect(entries).toEqual([]);
  });
});
