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

  it("breaks a same-number tie by hash ascending when neither block has any receivedAt", () => {
    // 両方とも receivedAt 空 -> latestReceiptTime は null (NEGATIVE_INFINITY 同士)。
    // 時刻で決着がつかないため hash 辞書順にフォールバックする境界。
    const blocks = [
      block({ hash: "0xff", number: 7, parentHash: "0x6" }),
      block({ hash: "0x0a", number: 7, parentHash: "0x6" }),
    ];
    const tiles = deriveRibbonTiles(blocks);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].block.hash).toBe("0x0a");
  });

  it("prefers the block that has a receivedAt over one with none for the same number", () => {
    // 片方だけ receivedAt を持つ場合、時刻を持つ側 (有限値) が
    // 未受信側 (NEGATIVE_INFINITY) に勝つ。入力順に依存しないことも確認する。
    const withTime = block({ hash: "0xzz", number: 9, receivedAt: { n1: 500 } });
    const withoutTime = block({ hash: "0x00", number: 9, receivedAt: {} });
    expect(deriveRibbonTiles([withoutTime, withTime])[0].block.hash).toBe("0xzz");
    expect(deriveRibbonTiles([withTime, withoutTime])[0].block.hash).toBe("0xzz");
  });

  it("links the shown window independently of blocks truncated before it (32 stored -> 8 shown)", () => {
    // collector 側の保持窓 (32) と表示件数 (8) の差 (24) をまたぐ統合的な境界。
    // 直近8件だけを描くが、隠れた24件と連鎖していても表示は末尾8件で完結する。
    const blocks = Array.from({ length: 32 }, (_, i) =>
      block({ hash: `0x${i + 1}`, number: i + 1, parentHash: `0x${i}` }),
    );
    const tiles = deriveRibbonTiles(blocks, 8);
    expect(tiles).toHaveLength(8);
    expect(tiles[0].block.number).toBe(25);
    expect(tiles[tiles.length - 1].block.number).toBe(32);
    // 先頭 (番号25) は隠れた番号24と連鎖していても常に false
    // (先頭タイルの左には連結線を描かないため)。
    expect(tiles[0].connectedToPrevious).toBe(false);
    // 2件目以降は表示窓の中だけで前タイルと比較して連結する。
    expect(tiles.slice(1).every((t) => t.connectedToPrevious)).toBe(true);
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

  it("skips non-finite receivedAt values (NaN / Infinity) without polluting offsets", () => {
    const b = block({
      hash: "0xa",
      receivedAt: { good: 1000, broken: Number.NaN, inf: Number.POSITIVE_INFINITY },
    });
    const labels = new Map([
      ["good", "Good"],
      ["broken", "Broken"],
      ["inf", "Inf"],
    ]);
    const order = deriveReceivedOrder(b, labels);
    expect(order).toEqual([{ nodeId: "good", label: "Good", offsetMs: 0 }]);
  });
});

describe("formatBlockTimestamp", () => {
  it("formats epoch seconds as a fixed UTC string, independent of host timezone", () => {
    expect(formatBlockTimestamp(1_784_798_132)).toBe("2026-07-23 09:15:32 UTC");
  });

  it("formats epoch zero", () => {
    expect(formatBlockTimestamp(0)).toBe("1970-01-01 00:00:00 UTC");
  });

  it("stays on the UTC calendar day for an early-morning UTC time (would roll back a day in negative-offset TZ)", () => {
    // 00:30 UTC。UTC より西側 (負オフセット) のホストで toLocaleString を
    // 使うと前日にずれるが、UTC 固定書式なのでずれてはならない。
    expect(formatBlockTimestamp(1_784_766_600)).toBe("2026-07-23 00:30:00 UTC");
  });

  it("truncates sub-second drift, rendering only whole seconds", () => {
    // epoch 秒に小数が紛れ込んでも秒までで整形され、ミリ秒表記を残さない。
    expect(formatBlockTimestamp(1_784_798_132.987)).toBe("2026-07-23 09:15:32 UTC");
  });
});
