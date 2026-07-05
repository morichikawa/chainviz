import type { WalletEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  OWNERSHIP_EDGE_TYPE,
  ownershipEdgesToFlowEdges,
} from "./ownershipEdge.js";

function wallet(overrides: Partial<WalletEntity> = {}): WalletEntity {
  return {
    kind: "wallet",
    address: "0xabc",
    chainType: "ethereum",
    balance: "0",
    nonce: 0,
    isSmartAccount: false,
    ownerWorkbenchId: null,
    recentTxHashes: [],
    ...overrides,
  };
}

describe("ownershipEdgesToFlowEdges", () => {
  it("creates a workbench → wallet edge when the owner is present", () => {
    const edges = ownershipEdgesToFlowEdges(
      [wallet({ address: "0xa", ownerWorkbenchId: "wb-1" })],
      ["wb-1"],
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      type: OWNERSHIP_EDGE_TYPE,
      source: "wb-1",
      target: "0xa",
    });
  });

  it("skips wallets whose owner was deleted (ownerWorkbenchId null)", () => {
    const edges = ownershipEdgesToFlowEdges(
      [wallet({ address: "0xa", ownerWorkbenchId: null })],
      ["wb-1"],
    );
    expect(edges).toEqual([]);
  });

  it("skips edges to owners not currently on the canvas", () => {
    const edges = ownershipEdgesToFlowEdges(
      [wallet({ address: "0xa", ownerWorkbenchId: "wb-gone" })],
      ["wb-1"],
    );
    expect(edges).toEqual([]);
  });

  it("supports one workbench owning multiple wallets", () => {
    const edges = ownershipEdgesToFlowEdges(
      [
        wallet({ address: "0xa", ownerWorkbenchId: "wb-1" }),
        wallet({ address: "0xb", ownerWorkbenchId: "wb-1" }),
      ],
      ["wb-1"],
    );
    expect(edges.map((e) => e.target).sort()).toEqual(["0xa", "0xb"]);
    expect(edges.every((e) => e.source === "wb-1")).toBe(true);
  });

  it("gives each edge a stable unique id", () => {
    const edges = ownershipEdgesToFlowEdges(
      [wallet({ address: "0xa", ownerWorkbenchId: "wb-1" })],
      new Set(["wb-1"]),
    );
    expect(edges[0].id).toBe("own-wb-1-0xa");
  });
});
