import type { WorldState } from "../world-state/store.js";
import { describe, expect, it } from "vitest";
import { deriveCommsLogEntries } from "./deriveCommsLogEntries.js";
import { testNode } from "./testFixtures.js";

function stateWith(...nodes: ReturnType<typeof testNode>[]): WorldState {
  const map: WorldState["entities"] = {};
  for (const node of nodes) map[node.id] = node;
  return { entities: map, edges: [] };
}

describe("deriveCommsLogEntries: peer category (edgeAdded/edgeRemoved)", () => {
  it("records a peer connection established (edgeAdded)", () => {
    const prevState = stateWith(
      testNode({ id: "reth-1", containerName: "chainviz-reth-1" }),
      testNode({ id: "reth-2", containerName: "chainviz-reth-2" }),
    );

    const entries = deriveCommsLogEntries(
      prevState,
      [
        {
          type: "edgeAdded",
          edge: { kind: "peer", fromNodeId: "reth-1", toNodeId: "reth-2", networkId: "1337" },
        },
      ],
      1_000,
    );

    expect(entries).toEqual([
      {
        id: expect.any(String),
        category: "peer",
        timestamp: 1_000,
        actorIds: ["reth-1", "reth-2"],
        fromNodeId: "reth-1",
        fromLabel: "chainviz-reth-1",
        toNodeId: "reth-2",
        toLabel: "chainviz-reth-2",
        networkId: "1337",
        change: "connected",
      },
    ]);
  });

  it("records a peer disconnection using prevState labels (node may already be gone)", () => {
    const prevState = stateWith(testNode({ id: "reth-1", containerName: "chainviz-reth-1" }));
    // reth-2 は既に entityRemoved 済みでこの diff には現れないケースを模す
    // (prevState にも存在しない = ラベル解決できずidへフォールバック)。

    const entries = deriveCommsLogEntries(
      prevState,
      [{ type: "edgeRemoved", fromNodeId: "reth-1", toNodeId: "reth-2", networkId: "1337" }],
      2_000,
    );

    expect(entries[0]).toMatchObject({
      category: "peer",
      change: "disconnected",
      fromLabel: "chainviz-reth-1",
      toLabel: "reth-2",
    });
  });
});
