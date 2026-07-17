import type { BlockEntity, TransactionEntity } from "@chainviz/shared";
import type { WorldState } from "../world-state/store.js";
import { describe, expect, it } from "vitest";
import { deriveCommsLogEntries } from "./deriveCommsLogEntries.js";
import { testBlock, testTransaction } from "./testFixtures.js";

function stateWith(...entities: Array<BlockEntity | TransactionEntity>): WorldState {
  const map: WorldState["entities"] = {};
  for (const entity of entities) {
    map[entity.hash] = entity;
  }
  return { entities: map, edges: [] };
}

describe("deriveCommsLogEntries: tx category (entityAdded)", () => {
  it("records a pending tx as 'submitted to mempool' (no block number)", () => {
    const tx = testTransaction({ hash: "0xa11c", status: "pending" });
    const entries = deriveCommsLogEntries({ entities: {}, edges: [] }, [{ type: "entityAdded", entity: tx }], 1_000);

    expect(entries).toEqual([
      {
        id: expect.any(String),
        category: "tx",
        timestamp: 1_000,
        actorIds: [],
        hash: "0xa11c",
        status: "pending",
        blockNumber: undefined,
      },
    ]);
  });

  it("resolves the block number for a tx observed already included", () => {
    const block = testBlock({ hash: "0xblock1", number: 130 });
    const tx = testTransaction({ hash: "0xa11c", status: "included", blockHash: "0xblock1" });
    const prevState = stateWith(block);

    const entries = deriveCommsLogEntries(prevState, [{ type: "entityAdded", entity: tx }], 2_000);

    expect(entries[0]).toMatchObject({ status: "included", blockNumber: 130 });
  });
});

describe("deriveCommsLogEntries: tx category (entityUpdated, status transitions)", () => {
  it("records the transition to included with its block number", () => {
    const block = testBlock({ hash: "0xblock1", number: 130 });
    const pendingTx = testTransaction({ hash: "0xa11c", status: "pending" });
    const prevState = stateWith(block, pendingTx);

    const entries = deriveCommsLogEntries(
      prevState,
      [
        {
          type: "entityUpdated",
          id: "0xa11c",
          patch: { status: "included", blockHash: "0xblock1" },
        },
      ],
      3_000,
    );

    expect(entries).toEqual([
      {
        id: expect.any(String),
        category: "tx",
        timestamp: 3_000,
        actorIds: [],
        hash: "0xa11c",
        status: "included",
        blockNumber: 130,
      },
    ]);
  });

  it("records the transition to failed", () => {
    const pendingTx = testTransaction({ hash: "0xa11c", status: "pending" });
    const prevState = stateWith(pendingTx);

    const entries = deriveCommsLogEntries(
      prevState,
      [{ type: "entityUpdated", id: "0xa11c", patch: { status: "failed", blockHash: "0xblock2" } }],
      3_000,
    );

    expect(entries[0]).toMatchObject({ status: "failed" });
  });

  it("emits nothing when the patch does not touch status (e.g. nonce-only patch)", () => {
    const pendingTx = testTransaction({ hash: "0xa11c", status: "pending", nonce: 1 });
    const prevState = stateWith(pendingTx);

    const entries = deriveCommsLogEntries(
      prevState,
      [{ type: "entityUpdated", id: "0xa11c", patch: { nonce: 2 } }],
      3_000,
    );

    expect(entries).toEqual([]);
  });
});
