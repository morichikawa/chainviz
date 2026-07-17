import type { WorldState } from "../world-state/store.js";
import { describe, expect, it } from "vitest";
import { deriveCommsLogEntries } from "./deriveCommsLogEntries.js";
import { testContract, testNode, testWorkbench } from "./testFixtures.js";

describe("deriveCommsLogEntries: environment category (node/workbench/contract add/remove)", () => {
  it("records a node addition", () => {
    const entries = deriveCommsLogEntries(
      { entities: {}, edges: [] },
      [{ type: "entityAdded", entity: testNode({ id: "reth-3", containerName: "chainviz-reth-3" }) }],
      1_000,
    );

    expect(entries).toEqual([
      {
        id: expect.any(String),
        category: "environment",
        timestamp: 1_000,
        actorIds: ["reth-3"],
        subjectId: "reth-3",
        subjectLabel: "chainviz-reth-3",
        change: "nodeAdded",
      },
    ]);
  });

  it("records a workbench addition using its human label", () => {
    const entries = deriveCommsLogEntries(
      { entities: {}, edges: [] },
      [{ type: "entityAdded", entity: testWorkbench({ id: "wb-1", label: "Alice" }) }],
      1_000,
    );

    expect(entries[0]).toMatchObject({ change: "workbenchAdded", subjectLabel: "Alice" });
  });

  it("records a contract deployment, keeping subjectLabel undefined for uncataloged contracts", () => {
    const entries = deriveCommsLogEntries(
      { entities: {}, edges: [] },
      [{ type: "entityAdded", entity: testContract({ address: "0xcontract1" }) }],
      1_000,
    );

    expect(entries[0]).toMatchObject({
      change: "contractDeployed",
      subjectId: "0xcontract1",
      subjectLabel: undefined,
    });
  });

  it("records a node removal using the label it had before removal", () => {
    const prevState: WorldState = {
      entities: { "reth-3": testNode({ id: "reth-3", containerName: "chainviz-reth-3" }) },
      edges: [],
    };

    const entries = deriveCommsLogEntries(
      prevState,
      [{ type: "entityRemoved", id: "reth-3" }],
      2_000,
    );

    expect(entries[0]).toMatchObject({ change: "nodeRemoved", subjectLabel: "chainviz-reth-3" });
  });

  it("records a workbench removal", () => {
    const prevState: WorldState = {
      entities: { "wb-1": testWorkbench({ id: "wb-1", label: "Alice" }) },
      edges: [],
    };

    const entries = deriveCommsLogEntries(
      prevState,
      [{ type: "entityRemoved", id: "wb-1" }],
      2_000,
    );

    expect(entries[0]).toMatchObject({ change: "workbenchRemoved", subjectLabel: "Alice" });
  });

  it("does not record wallet add/remove (out of scope per design)", () => {
    const entries = deriveCommsLogEntries(
      { entities: {}, edges: [] },
      [
        {
          type: "entityAdded",
          entity: {
            kind: "wallet",
            address: "0xwallet1",
            chainType: "ethereum",
            balance: "0",
            nonce: 0,
            isSmartAccount: false,
            ownerWorkbenchId: null,
            recentTxHashes: [],
          },
        },
      ],
      1_000,
    );

    expect(entries).toEqual([]);
  });
});
