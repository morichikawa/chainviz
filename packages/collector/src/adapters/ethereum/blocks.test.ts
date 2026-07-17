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
    const block = tracker.record(["p/reth1"], header(), 1000);
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
    tracker.record(["p/reth1"], header(), 1000);
    const block = tracker.record(["p/reth2"], header(), 1200);
    expect(block.receivedAt).toEqual({ "p/reth1": 1000, "p/reth2": 1200 });
  });

  it("keeps the earliest timestamp when the same node reports twice", () => {
    const tracker = new BlockPropagationTracker();
    tracker.record(["p/reth1"], header(), 1000);
    const block = tracker.record(["p/reth1"], header(), 5000);
    expect(block.receivedAt).toEqual({ "p/reth1": 1000 });
  });

  it("tracks distinct blocks independently", () => {
    const tracker = new BlockPropagationTracker();
    tracker.record(["p/reth1"], header({ hash: "0xa", number: "0x1" }), 1000);
    const b = tracker.record(
      ["p/reth1"],
      header({ hash: "0xb", number: "0x2" }),
      2000,
    );
    expect(b.hash).toBe("0xb");
    expect(b.number).toBe(2);
    expect(b.receivedAt).toEqual({ "p/reth1": 2000 });
  });

  it("evicts the oldest block once the capacity is exceeded", () => {
    const tracker = new BlockPropagationTracker(2);
    tracker.record(["p/reth1"], header({ hash: "0xa" }), 1000);
    tracker.record(["p/reth1"], header({ hash: "0xb" }), 2000);
    tracker.record(["p/reth1"], header({ hash: "0xc" }), 3000);
    // 0xa は追い出されたので、再受信すると receivedAt がリセットされる
    // （マージ対象として残っていない）。
    const reAdded = tracker.record(["p/reth2"], header({ hash: "0xa" }), 4000);
    expect(reAdded.receivedAt).toEqual({ "p/reth2": 4000 });
    // 一方でまだ保持されている 0xc はマージされ続ける。
    const stillTracked = tracker.record(["p/reth2"], header({ hash: "0xc" }), 5000);
    expect(stillTracked.receivedAt).toEqual({
      "p/reth1": 3000,
      "p/reth2": 5000,
    });
  });

  it("does not evict while the count is exactly at capacity", () => {
    const tracker = new BlockPropagationTracker(2);
    tracker.record(["p/reth1"], header({ hash: "0xa" }), 1000);
    tracker.record(["p/reth1"], header({ hash: "0xb" }), 2000);
    // ちょうど上限（2 件）。まだ追い出しは起きないので 0xa はマージされ続ける。
    const a = tracker.record(["p/reth2"], header({ hash: "0xa" }), 3000);
    expect(a.receivedAt).toEqual({ "p/reth1": 1000, "p/reth2": 3000 });
  });

  it("evicts on every new block when capacity is 1", () => {
    const tracker = new BlockPropagationTracker(1);
    tracker.record(["p/reth1"], header({ hash: "0xa" }), 1000);
    tracker.record(["p/reth1"], header({ hash: "0xb" }), 2000);
    // 直前の 0xa は追い出されているので、再受信は新規扱い。
    const a = tracker.record(["p/reth2"], header({ hash: "0xa" }), 3000);
    expect(a.receivedAt).toEqual({ "p/reth2": 3000 });
  });

  it("does not evict up to the default capacity of 200", () => {
    const tracker = new BlockPropagationTracker();
    for (let i = 0; i < 200; i++) {
      tracker.record(["p/reth1"], header({ hash: `0x${i}` }), i);
    }
    // 200 件目までは最初の 0x0 も保持されているのでマージされる。
    const first = tracker.record(["p/reth2"], header({ hash: "0x0" }), 9999);
    expect(first.receivedAt).toEqual({ "p/reth1": 0, "p/reth2": 9999 });
  });

  it("keeps each node's earliest time when nodes report out of order", () => {
    // 後から届いたノードの時刻が既存より小さくても、ノードごとに最初の受信時刻を保つ。
    const tracker = new BlockPropagationTracker();
    tracker.record(["p/reth1"], header(), 5000);
    const merged = tracker.record(["p/reth2"], header(), 1000);
    expect(merged.receivedAt).toEqual({ "p/reth1": 5000, "p/reth2": 1000 });
  });

  it("refreshes recency on re-receipt so an active block is not evicted", () => {
    const tracker = new BlockPropagationTracker(2);
    tracker.record(["p/reth1"], header({ hash: "0xa" }), 1000);
    tracker.record(["p/reth1"], header({ hash: "0xb" }), 2000);
    // 0xa を再受信して最新扱いに引き上げる。
    tracker.record(["p/reth2"], header({ hash: "0xa" }), 2500);
    // 新しい 0xc を入れると、いちばん古い 0xb が追い出される。
    tracker.record(["p/reth1"], header({ hash: "0xc" }), 3000);
    const a = tracker.record(["p/reth3"], header({ hash: "0xa" }), 3500);
    // 0xa は保持され続けているのでマージされる。
    expect(a.receivedAt).toEqual({
      "p/reth1": 1000,
      "p/reth2": 2500,
      "p/reth3": 3500,
    });
  });

  it("records the same receipt under multiple keys in a single call (Issue #141)", () => {
    // 同じ newHeads 受信 1 回を beacon キーと EL 自身のキーの両方へ、
    // 同一時刻で記録する（CL/EL 両エッジにパルスを乗せるための仕様）。
    const tracker = new BlockPropagationTracker();
    const block = tracker.record(["p/beacon1", "p/reth1"], header(), 1000);
    expect(block.receivedAt).toEqual({ "p/beacon1": 1000, "p/reth1": 1000 });
  });

  it("keeps each of the multiple keys' earliest time independently across calls", () => {
    const tracker = new BlockPropagationTracker();
    tracker.record(["p/beacon1", "p/reth1"], header(), 1000);
    // 2 回目の受信でも、複数キー記録・初回優先の意味論はキーごとに保たれる。
    const block = tracker.record(["p/beacon2", "p/reth2"], header(), 1500);
    expect(block.receivedAt).toEqual({
      "p/beacon1": 1000,
      "p/reth1": 1000,
      "p/beacon2": 1500,
      "p/reth2": 1500,
    });
  });

  it("treats an empty nodeIds array as a no-op merge", () => {
    // キーが 0 件でも既存の receivedAt はそのまま返る（実運用では起きない想定
    // だが、境界値として空配列でも壊れないことを固定する）。
    const tracker = new BlockPropagationTracker();
    tracker.record(["p/reth1"], header(), 1000);
    const block = tracker.record([], header(), 2000);
    expect(block.receivedAt).toEqual({ "p/reth1": 1000 });
  });

  it("creates a tracked block with empty receivedAt for a brand-new hash keyed by nothing", () => {
    // 空配列を新規ハッシュに渡すと、受信時刻が空でも BlockEntity 自体は
    // 生成・追跡される。後続のキー付き受信は同じブロックにマージされる
    // （空配列が「エンティティを作らない」に化けないことを固定する境界値）。
    const tracker = new BlockPropagationTracker();
    const empty = tracker.record([], header(), 1000);
    expect(empty).toEqual({
      kind: "block",
      hash: "0xblock1",
      number: 16,
      parentHash: "0xparent",
      timestamp: 100,
      receivedAt: {},
    });
    const merged = tracker.record(["p/reth1"], header(), 2000);
    expect(merged.receivedAt).toEqual({ "p/reth1": 2000 });
  });

  it("preserves first-wins per key when a multi-key call mixes already-recorded and new keys (Issue #141)", () => {
    // 本 Issue の核心的な境界: 1 回の record 呼び出しに、すでに他の受信で
    // 記録済みのキー（共有 beacon）と未記録のキーが混在するケース。共有キーは
    // 初回時刻を保ち、未記録キーだけが今回の時刻を得る。
    const tracker = new BlockPropagationTracker();
    // 1 回目: beacon1(共有) と reth1 を 1000 で記録。
    tracker.record(["p/beacon1", "p/reth1"], header(), 1000);
    // 2 回目: 同じ beacon1(記録済み) と別ノード reth2(未記録) を 2000 で。
    const merged = tracker.record(["p/beacon1", "p/reth2"], header(), 2000);
    expect(merged.receivedAt).toEqual({
      // 共有 beacon キーは初回優先で 1000 のまま。
      "p/beacon1": 1000,
      // reth1 は前回の 1000 を保持。
      "p/reth1": 1000,
      // reth2 だけが今回の 2000 を得る。
      "p/reth2": 2000,
    });
  });

  it("records a repeated key within a single call only once (defensive on duplicate keys)", () => {
    // 理論上は起きないが、同一キーが 1 回の呼び出しの配列に重複して現れても、
    // 初回優先の判定により最初の 1 回だけ記録され、値は同一時刻のまま安定する。
    const tracker = new BlockPropagationTracker();
    const block = tracker.record(["p/reth1", "p/reth1"], header(), 1000);
    expect(block.receivedAt).toEqual({ "p/reth1": 1000 });
  });

  it("keeps a duplicated key at the earliest time even if the array repeats it (defensive)", () => {
    // 重複キーの配列でも「同一キーは初回優先」の意味論が崩れない。1 回目 1000、
    // 2 回目に同じキーを重複させて 5000 で来ても 1000 のまま。
    const tracker = new BlockPropagationTracker();
    tracker.record(["p/reth1"], header(), 1000);
    const block = tracker.record(["p/reth1", "p/reth1"], header(), 5000);
    expect(block.receivedAt).toEqual({ "p/reth1": 1000 });
  });

  it("does not mutate the merged block's receivedAt on a later record of the same block", () => {
    // ある受信で返した BlockEntity のスナップショットが、後続の受信によって
    // 別キーが増えても後から書き換わらないこと（呼び出し側が emit した値の
    // 一貫性を守るため、record は既存 receivedAt をコピーしてから足す）。
    const tracker = new BlockPropagationTracker();
    const first = tracker.record(["p/reth1"], header(), 1000);
    tracker.record(["p/reth2"], header(), 2000);
    // 最初に受け取ったスナップショットに reth2 が後から混入していない。
    expect(first.receivedAt).toEqual({ "p/reth1": 1000 });
  });
});

describe("BlockPropagationTracker.reset (Issue #357)", () => {
  it("forgets previously recorded blocks so a later record for the same hash starts fresh (no stale merge)", () => {
    const tracker = new BlockPropagationTracker();
    tracker.record(["p/reth1"], header(), 1000);

    tracker.reset();

    const block = tracker.record(["p/reth2"], header(), 5000);
    // reset していなければ同一 hash の再受信として p/reth1: 1000 も
    // マージされて残るはず（通常仕様）。reset 後は真っさらな状態から
    // 始まることを確認する。
    expect(block.receivedAt).toEqual({ "p/reth2": 5000 });
  });
});
