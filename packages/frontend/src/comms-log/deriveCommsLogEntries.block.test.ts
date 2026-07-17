import type { BlockEntity, NodeEntity } from "@chainviz/shared";
import type { WorldState } from "../world-state/store.js";
import { describe, expect, it } from "vitest";
import { deriveCommsLogEntries } from "./deriveCommsLogEntries.js";
import { testBlock, testNode } from "./testFixtures.js";

function stateWith(...entities: Array<NodeEntity | BlockEntity>): WorldState {
  const map: WorldState["entities"] = {};
  for (const entity of entities) {
    map[entity.kind === "node" ? entity.id : entity.hash] = entity;
  }
  return { entities: map, edges: [] };
}

describe("deriveCommsLogEntries: block category (entityAdded)", () => {
  it("emits one entry per (deduped) receiving node when a block first appears", () => {
    const prevState = stateWith(testNode({ id: "reth-1", containerName: "chainviz-reth-1" }));
    const block: BlockEntity = testBlock({
      hash: "0xblock1",
      number: 129,
      receivedAt: { "reth-1": 1_000 },
    });

    const entries = deriveCommsLogEntries(prevState, [{ type: "entityAdded", entity: block }], 1_500);

    expect(entries).toEqual([
      {
        id: expect.any(String),
        category: "block",
        timestamp: 1_000,
        actorIds: ["reth-1"],
        nodeId: "reth-1",
        nodeLabel: "chainviz-reth-1",
        blockNumber: 129,
        relativeDelayMs: 0,
        isOrigin: true,
      },
    ]);
  });

  it("dedupes the beacon(CL) alias key and only reports the execution(EL) node", () => {
    const prevState = stateWith(
      testNode({ id: "beacon-1", containerName: "chainviz-lighthouse-1", drivesNodeId: "reth-1" }),
      testNode({ id: "reth-1", containerName: "chainviz-reth-1" }),
    );
    const block: BlockEntity = testBlock({
      hash: "0xblock1",
      number: 1,
      receivedAt: { "beacon-1": 1_000, "reth-1": 1_000 },
    });

    const entries = deriveCommsLogEntries(prevState, [{ type: "entityAdded", entity: block }], 1_000);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ nodeId: "reth-1", nodeLabel: "chainviz-reth-1" });
  });

  it("computes relativeDelayMs from the wave origin (earliest receiver) across multiple nodes", () => {
    const prevState = stateWith(
      testNode({ id: "reth-1", containerName: "reth-1" }),
      testNode({ id: "reth-2", containerName: "reth-2" }),
    );
    const block: BlockEntity = testBlock({
      hash: "0xblock1",
      number: 5,
      receivedAt: { "reth-1": 1_000, "reth-2": 1_420 },
    });

    const entries = deriveCommsLogEntries(prevState, [{ type: "entityAdded", entity: block }], 1_500);

    const byNode = Object.fromEntries(
      entries
        .filter((entry) => entry.category === "block")
        .map((entry) => [entry.nodeId, entry]),
    );
    expect(byNode["reth-1"]).toMatchObject({ relativeDelayMs: 0, isOrigin: true });
    expect(byNode["reth-2"]).toMatchObject({ relativeDelayMs: 420, isOrigin: false });
  });
});

describe("deriveCommsLogEntries: block category (entityUpdated, receivedAt increments)", () => {
  it("only reports newly-added/changed receivedAt keys, not ones already present before the diff", () => {
    const existingBlock: BlockEntity = testBlock({
      hash: "0xblock1",
      number: 10,
      receivedAt: { "reth-1": 1_000 },
    });
    const prevState = stateWith(
      testNode({ id: "reth-1", containerName: "reth-1" }),
      testNode({ id: "reth-2", containerName: "reth-2" }),
      existingBlock,
    );

    const entries = deriveCommsLogEntries(
      prevState,
      [
        {
          type: "entityUpdated",
          id: "0xblock1",
          patch: { receivedAt: { "reth-1": 1_000, "reth-2": 1_300 } },
        },
      ],
      1_400,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ nodeId: "reth-2", relativeDelayMs: 300 });
  });

  it("emits nothing when the patch does not touch receivedAt", () => {
    const existingBlock: BlockEntity = testBlock({
      hash: "0xblock1",
      number: 10,
      receivedAt: { "reth-1": 1_000 },
    });
    const prevState = stateWith(testNode({ id: "reth-1" }), existingBlock);

    const entries = deriveCommsLogEntries(
      prevState,
      [{ type: "entityUpdated", id: "0xblock1", patch: { number: 10 } }],
      1_400,
    );

    expect(entries).toEqual([]);
  });

  it("emits nothing when entityUpdated targets an unknown id (defensive)", () => {
    const entries = deriveCommsLogEntries(
      { entities: {}, edges: [] },
      [{ type: "entityUpdated", id: "0xghost", patch: { receivedAt: { "reth-1": 1_000 } } }],
      1_000,
    );
    expect(entries).toEqual([]);
  });
});
