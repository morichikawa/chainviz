import { describe, expect, it } from "vitest";
import { deriveCommsLogEntries } from "./deriveCommsLogEntries.js";

describe("deriveCommsLogEntries: cross-cutting behavior", () => {
  it("returns an empty array for an empty events list", () => {
    expect(deriveCommsLogEntries({ entities: {}, edges: [] }, [], 1_000)).toEqual([]);
  });

  it("sorts the entries produced from a single batch newest-first", () => {
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
        {
          type: "operationObserved",
          edge: {
            kind: "operation",
            fromWorkbenchId: "wb-1",
            toNodeId: "reth-1",
            operation: "eth_getBalance",
            observedAt: 3_000,
          },
        },
        {
          type: "operationObserved",
          edge: {
            kind: "operation",
            fromWorkbenchId: "wb-1",
            toNodeId: "reth-1",
            operation: "eth_blockNumber",
            observedAt: 2_000,
          },
        },
      ],
      3_500,
    );

    expect(entries.map((entry) => entry.timestamp)).toEqual([3_000, 2_000, 1_000]);
  });

  it("ignores unknown/future event types without throwing (forward compatibility)", () => {
    const entries = deriveCommsLogEntries(
      { entities: {}, edges: [] },
      // @ts-expect-error 未知の将来のイベント型を模す
      [{ type: "somethingFromTheFuture" }],
      1_000,
    );
    expect(entries).toEqual([]);
  });

  it("produces unique ids across every entry in a batch", () => {
    const entries = deriveCommsLogEntries(
      { entities: {}, edges: [] },
      [
        {
          type: "edgeAdded",
          edge: { kind: "peer", fromNodeId: "a", toNodeId: "b", networkId: "1337" },
        },
        {
          type: "edgeAdded",
          edge: { kind: "peer", fromNodeId: "c", toNodeId: "d", networkId: "1337" },
        },
      ],
      1_000,
    );
    const ids = new Set(entries.map((entry) => entry.id));
    expect(ids.size).toBe(entries.length);
  });
});
