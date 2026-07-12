import type { BlockEntity, TransactionEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  RIBBON_TILE_COUNT,
  countTransactionsByBlockHash,
  deriveReceivedOrder,
  deriveRibbonTiles,
  formatBlockTimestamp,
} from "./chainRibbon.js";

function block(overrides: Partial<BlockEntity> & { hash: string }): BlockEntity {
  return {
    kind: "block",
    number: 0,
    parentHash: "0x0",
    timestamp: 0,
    receivedAt: {},
    ...overrides,
  };
}

describe("deriveRibbonTiles", () => {
  it("returns tiles in ascending number order with the newest last", () => {
    const blocks = [
      block({ hash: "0xb", number: 2, parentHash: "0xa" }),
      block({ hash: "0xa", number: 1, parentHash: "0x0" }),
    ];
    const tiles = deriveRibbonTiles(blocks);
    expect(tiles.map((t) => t.block.number)).toEqual([1, 2]);
  });

  it("limits to the trailing tileCount entries", () => {
    const blocks = Array.from({ length: 12 }, (_, i) =>
      block({ hash: `0x${i}`, number: i, parentHash: `0x${i - 1}` }),
    );
    const tiles = deriveRibbonTiles(blocks, 8);
    expect(tiles).toHaveLength(8);
    expect(tiles[0].block.number).toBe(4);
    expect(tiles[tiles.length - 1].block.number).toBe(11);
  });

  it("uses the package default tile count when omitted", () => {
    const blocks = Array.from({ length: 20 }, (_, i) =>
      block({ hash: `0x${i}`, number: i, parentHash: `0x${i - 1}` }),
    );
    expect(deriveRibbonTiles(blocks)).toHaveLength(RIBBON_TILE_COUNT);
  });

  it("marks connectedToPrevious only when parentHash matches the previous tile's hash", () => {
    const blocks = [
      block({ hash: "0xa", number: 1, parentHash: "0x0" }),
      // number 2 is missing (observation gap) -> number 3 does not chain from 0xa.
      block({ hash: "0xc", number: 3, parentHash: "0xb-missing" }),
    ];
    const tiles = deriveRibbonTiles(blocks);
    expect(tiles[0].connectedToPrevious).toBe(false); // first tile: no comparison target
    expect(tiles[1].connectedToPrevious).toBe(false); // gap: parentHash does not match
  });

  it("marks connectedToPrevious true for a normal unbroken chain", () => {
    const blocks = [
      block({ hash: "0xa", number: 1, parentHash: "0x0" }),
      block({ hash: "0xb", number: 2, parentHash: "0xa" }),
    ];
    const tiles = deriveRibbonTiles(blocks);
    expect(tiles[1].connectedToPrevious).toBe(true);
  });

  it("picks one canonical block per number, preferring the latest receivedAt", () => {
    const blocks = [
      block({
        hash: "0xa-early",
        number: 5,
        parentHash: "0x4",
        receivedAt: { n1: 1000 },
      }),
      block({
        hash: "0xa-late",
        number: 5,
        parentHash: "0x4",
        receivedAt: { n1: 2000 },
      }),
    ];
    const tiles = deriveRibbonTiles(blocks);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].block.hash).toBe("0xa-late");
  });

  it("breaks receivedAt ties by hash ascending for determinism", () => {
    const blocks = [
      block({ hash: "0xb", number: 5, parentHash: "0x4", receivedAt: { n1: 1000 } }),
      block({ hash: "0xa", number: 5, parentHash: "0x4", receivedAt: { n1: 1000 } }),
    ];
    const tiles = deriveRibbonTiles(blocks);
    expect(tiles[0].block.hash).toBe("0xa");
  });

  it("returns an empty array for no observed blocks", () => {
    expect(deriveRibbonTiles([])).toEqual([]);
  });
});

function tx(overrides: Partial<TransactionEntity> & { hash: string }): TransactionEntity {
  return {
    kind: "transaction",
    from: "0xfrom",
    to: "0xto",
    status: "included",
    ...overrides,
  };
}

describe("countTransactionsByBlockHash", () => {
  it("counts included and failed tx per blockHash, excluding pending", () => {
    const txs = [
      tx({ hash: "0x1", blockHash: "0xb1", status: "included" }),
      tx({ hash: "0x2", blockHash: "0xb1", status: "failed" }),
      tx({ hash: "0x3", blockHash: "0xb1", status: "pending" }),
      tx({ hash: "0x4", blockHash: "0xb2", status: "included" }),
      tx({ hash: "0x5", status: "included" }), // no blockHash
    ];
    const counts = countTransactionsByBlockHash(txs);
    expect(counts.get("0xb1")).toBe(2);
    expect(counts.get("0xb2")).toBe(1);
    expect(counts.has("0xb3")).toBe(false);
  });

  it("omits blocks with zero counted tx from the map", () => {
    const counts = countTransactionsByBlockHash([
      tx({ hash: "0x1", blockHash: "0xb1", status: "pending" }),
    ]);
    expect(counts.has("0xb1")).toBe(false);
  });
});

describe("deriveReceivedOrder", () => {
  it("orders nodes by receivedAt relative to the wave origin, resolving labels", () => {
    const b = block({
      hash: "0xa",
      receivedAt: { "p/reth1": 1200, "p/reth2": 1000, "p/reth3": 1100 },
    });
    const labels = new Map([
      ["p/reth1", "chainviz-reth-1"],
      ["p/reth2", "chainviz-reth-2"],
      ["p/reth3", "chainviz-reth-3"],
    ]);
    const order = deriveReceivedOrder(b, labels);
    expect(order.map((e) => e.label)).toEqual([
      "chainviz-reth-2",
      "chainviz-reth-3",
      "chainviz-reth-1",
    ]);
    expect(order[0].offsetMs).toBe(0);
    expect(order[1].offsetMs).toBe(100);
    expect(order[2].offsetMs).toBe(200);
  });

  it("omits entries whose node id cannot be resolved to a label", () => {
    const b = block({ hash: "0xa", receivedAt: { known: 1000, unknown: 900 } });
    const order = deriveReceivedOrder(b, new Map([["known", "Known Node"]]));
    expect(order).toEqual([{ nodeId: "known", label: "Known Node", offsetMs: 100 }]);
  });

  it("returns an empty array when no receivedAt entries are finite", () => {
    const b = block({ hash: "0xa", receivedAt: {} });
    expect(deriveReceivedOrder(b, new Map())).toEqual([]);
  });

  it("breaks equal-offset ties by label ascending for determinism", () => {
    const b = block({ hash: "0xa", receivedAt: { z: 1000, a: 1000 } });
    const labels = new Map([
      ["z", "Zeta"],
      ["a", "Alpha"],
    ]);
    const order = deriveReceivedOrder(b, labels);
    expect(order.map((e) => e.label)).toEqual(["Alpha", "Zeta"]);
  });
});

describe("formatBlockTimestamp", () => {
  it("formats epoch seconds as a fixed UTC string, independent of host timezone", () => {
    expect(formatBlockTimestamp(1_784_798_132)).toBe("2026-07-23 09:15:32 UTC");
  });

  it("formats epoch zero", () => {
    expect(formatBlockTimestamp(0)).toBe("1970-01-01 00:00:00 UTC");
  });
});
