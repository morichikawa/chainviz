import { describe, expect, it } from "vitest";
import { BlockPropagationTracker, parseHexNumber } from "./blocks.js";
import type { NewHeadHeader } from "./eth-ws-client.js";

function header(overrides: Partial<NewHeadHeader> = {}): NewHeadHeader {
  return {
    hash: "0xblock1",
    number: "0x10",
    parentHash: "0xparent",
    timestamp: "0x64",
    ...overrides,
  };
}

describe("parseHexNumber", () => {
  it("parses a hex string with 0x prefix", () => {
    expect(parseHexNumber("0x10")).toBe(16);
    expect(parseHexNumber("0x0")).toBe(0);
  });

  it("returns 0 for undefined or unparseable input", () => {
    expect(parseHexNumber(undefined)).toBe(0);
    expect(parseHexNumber("")).toBe(0);
    expect(parseHexNumber("nothex")).toBe(0);
  });

  it("parses uppercase hex digits", () => {
    expect(parseHexNumber("0xFF")).toBe(255);
    expect(parseHexNumber("0xdeadBEEF")).toBe(0xdeadbeef);
  });

  it("returns 0 for a bare 0x prefix with no digits", () => {
    expect(parseHexNumber("0x")).toBe(0);
  });
});

describe("BlockPropagationTracker", () => {
  it("records a single node's receipt as a BlockEntity", () => {
    const tracker = new BlockPropagationTracker();
    const block = tracker.record("p/reth1", header(), 1000);
    expect(block).toEqual({
      kind: "block",
      hash: "0xblock1",
      number: 16,
      parentHash: "0xparent",
      timestamp: 100,
      receivedAt: { "p/reth1": 1000 },
    });
  });

  it("merges receipts from multiple nodes for the same block", () => {
    const tracker = new BlockPropagationTracker();
    tracker.record("p/reth1", header(), 1000);
    const block = tracker.record("p/reth2", header(), 1200);
    expect(block.receivedAt).toEqual({ "p/reth1": 1000, "p/reth2": 1200 });
  });

  it("keeps the earliest timestamp when the same node reports twice", () => {
    const tracker = new BlockPropagationTracker();
    tracker.record("p/reth1", header(), 1000);
    const block = tracker.record("p/reth1", header(), 5000);
    expect(block.receivedAt).toEqual({ "p/reth1": 1000 });
  });

  it("tracks distinct blocks independently", () => {
    const tracker = new BlockPropagationTracker();
    tracker.record("p/reth1", header({ hash: "0xa", number: "0x1" }), 1000);
    const b = tracker.record(
      "p/reth1",
      header({ hash: "0xb", number: "0x2" }),
      2000,
    );
    expect(b.hash).toBe("0xb");
    expect(b.number).toBe(2);
    expect(b.receivedAt).toEqual({ "p/reth1": 2000 });
  });

  it("evicts the oldest block once the capacity is exceeded", () => {
    const tracker = new BlockPropagationTracker(2);
    tracker.record("p/reth1", header({ hash: "0xa" }), 1000);
    tracker.record("p/reth1", header({ hash: "0xb" }), 2000);
    tracker.record("p/reth1", header({ hash: "0xc" }), 3000);
    // 0xa は追い出されたので、再受信すると receivedAt がリセットされる
    // （マージ対象として残っていない）。
    const reAdded = tracker.record("p/reth2", header({ hash: "0xa" }), 4000);
    expect(reAdded.receivedAt).toEqual({ "p/reth2": 4000 });
    // 一方でまだ保持されている 0xc はマージされ続ける。
    const stillTracked = tracker.record("p/reth2", header({ hash: "0xc" }), 5000);
    expect(stillTracked.receivedAt).toEqual({
      "p/reth1": 3000,
      "p/reth2": 5000,
    });
  });

  it("does not evict while the count is exactly at capacity", () => {
    const tracker = new BlockPropagationTracker(2);
    tracker.record("p/reth1", header({ hash: "0xa" }), 1000);
    tracker.record("p/reth1", header({ hash: "0xb" }), 2000);
    // ちょうど上限（2 件）。まだ追い出しは起きないので 0xa はマージされ続ける。
    const a = tracker.record("p/reth2", header({ hash: "0xa" }), 3000);
    expect(a.receivedAt).toEqual({ "p/reth1": 1000, "p/reth2": 3000 });
  });

  it("evicts on every new block when capacity is 1", () => {
    const tracker = new BlockPropagationTracker(1);
    tracker.record("p/reth1", header({ hash: "0xa" }), 1000);
    tracker.record("p/reth1", header({ hash: "0xb" }), 2000);
    // 直前の 0xa は追い出されているので、再受信は新規扱い。
    const a = tracker.record("p/reth2", header({ hash: "0xa" }), 3000);
    expect(a.receivedAt).toEqual({ "p/reth2": 3000 });
  });

  it("does not evict up to the default capacity of 200", () => {
    const tracker = new BlockPropagationTracker();
    for (let i = 0; i < 200; i++) {
      tracker.record("p/reth1", header({ hash: `0x${i}` }), i);
    }
    // 200 件目までは最初の 0x0 も保持されているのでマージされる。
    const first = tracker.record("p/reth2", header({ hash: "0x0" }), 9999);
    expect(first.receivedAt).toEqual({ "p/reth1": 0, "p/reth2": 9999 });
  });

  it("keeps each node's earliest time when nodes report out of order", () => {
    // 後から届いたノードの時刻が既存より小さくても、ノードごとに最初の受信時刻を保つ。
    const tracker = new BlockPropagationTracker();
    tracker.record("p/reth1", header(), 5000);
    const merged = tracker.record("p/reth2", header(), 1000);
    expect(merged.receivedAt).toEqual({ "p/reth1": 5000, "p/reth2": 1000 });
  });

  it("refreshes recency on re-receipt so an active block is not evicted", () => {
    const tracker = new BlockPropagationTracker(2);
    tracker.record("p/reth1", header({ hash: "0xa" }), 1000);
    tracker.record("p/reth1", header({ hash: "0xb" }), 2000);
    // 0xa を再受信して最新扱いに引き上げる。
    tracker.record("p/reth2", header({ hash: "0xa" }), 2500);
    // 新しい 0xc を入れると、いちばん古い 0xb が追い出される。
    tracker.record("p/reth1", header({ hash: "0xc" }), 3000);
    const a = tracker.record("p/reth3", header({ hash: "0xa" }), 3500);
    // 0xa は保持され続けているのでマージされる。
    expect(a.receivedAt).toEqual({
      "p/reth1": 1000,
      "p/reth2": 2500,
      "p/reth3": 3500,
    });
  });
});
