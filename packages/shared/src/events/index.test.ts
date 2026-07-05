import { describe, expect, it } from "vitest";
import type { OperationEdge } from "../world-state/index.js";
import type { DiffEvent } from "./index.js";

describe("DiffEvent", () => {
  it("carries an OperationEdge in an operationObserved event", () => {
    const edge: OperationEdge = {
      kind: "operation",
      fromWorkbenchId: "workbench-alice",
      toNodeId: "node-1",
      operation: "sendRawTransaction",
      observedAt: 1_700_000_000_000,
    };
    const event: DiffEvent = { type: "operationObserved", edge };

    expect(event.type).toBe("operationObserved");
    expect(event.edge).toEqual(edge);
  });

  it("narrows operationObserved apart from edgeAdded by type", () => {
    const events: DiffEvent[] = [
      {
        type: "edgeAdded",
        edge: {
          kind: "peer",
          fromNodeId: "node-1",
          toNodeId: "node-2",
          networkId: "chainviz-net",
        },
      },
      {
        type: "operationObserved",
        edge: {
          kind: "operation",
          fromWorkbenchId: "workbench-alice",
          toNodeId: "node-1",
          operation: "call",
          observedAt: 1_700_000_000_000,
        },
      },
    ];

    // type による判別後、edge の型もそれぞれ PeerEdge / OperationEdge へ
    // 絞り込めること（コンパイル時の検証を兼ねる）。
    const summaries = events.map((event) => {
      switch (event.type) {
        case "edgeAdded":
          return `peer:${event.edge.networkId}`;
        case "operationObserved":
          return `operation:${event.edge.operation}@${event.edge.observedAt}`;
        default:
          return event.type;
      }
    });

    expect(summaries).toEqual([
      "peer:chainviz-net",
      "operation:call@1700000000000",
    ]);
  });
});
