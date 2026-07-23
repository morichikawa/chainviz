// ブロック詳細パネル（Issue #409）の純粋なデータ変換群のテスト。表示側
// （BlockDetailView.tsx / SidePanelHost.tsx）は別ファイルで扱う（CLAUDE.md の
// テスト分割方針）。
import type { BlockEntity, TransactionEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  BLOCK_DETAIL_TX_DISPLAY_LIMIT,
  buildBlocksByHash,
  findChildBlock,
  findParentBlock,
  limitBlockTransactions,
  resolveBlockNavigation,
  selectBlockTransactions,
} from "./blockDetail.js";

function block(overrides: Partial<BlockEntity> & { hash: string }): BlockEntity {
  return {
    kind: "block",
    number: 10,
    // このファイルのテストは "0xparent" / "0xchild" 等のわかりやすい hash 名を
    // よく使うため、デフォルトの parentHash がそれらと衝突すると「自分自身が
    // 自分の親」という意図しない自己参照になりうる（実際に一度これで
    // findChildBlock のテストが誤った結果を返した）。衝突しない専用の
    // プレースホルダにしておく。
    parentHash: "0xdefault-parent-placeholder",
    timestamp: 1_700_000_000,
    receivedAt: {},
    ...overrides,
  };
}

function tx(overrides: Partial<TransactionEntity> & { hash: string }): TransactionEntity {
  return {
    kind: "transaction",
    from: "0xfrom",
    to: "0xto",
    status: "included",
    ...overrides,
  };
}

describe("buildBlocksByHash", () => {
  it("indexes blocks by hash", () => {
    const a = block({ hash: "0xa" });
    const b = block({ hash: "0xb" });
    const map = buildBlocksByHash([a, b]);
    expect(map.get("0xa")).toBe(a);
    expect(map.get("0xb")).toBe(b);
    expect(map.size).toBe(2);
  });

  it("returns an empty map for an empty input", () => {
    expect(buildBlocksByHash([]).size).toBe(0);
  });
});

describe("findParentBlock", () => {
  it("returns the parent when it is within the retained window", () => {
    const parent = block({ hash: "0xparent", number: 9 });
    const child = block({ hash: "0xchild", number: 10, parentHash: "0xparent" });
    const map = buildBlocksByHash([parent, child]);
    expect(findParentBlock(child, map)).toBe(parent);
  });

  it("returns undefined when the parent is outside the retained window", () => {
    const child = block({ hash: "0xchild", number: 10, parentHash: "0xoutside" });
    const map = buildBlocksByHash([child]);
    expect(findParentBlock(child, map)).toBeUndefined();
  });
});

describe("findChildBlock", () => {
  it("returns the single child block", () => {
    const parent = block({ hash: "0xparent", number: 9 });
    const child = block({ hash: "0xchild", number: 10, parentHash: "0xparent" });
    const map = buildBlocksByHash([parent, child]);
    expect(findChildBlock(parent, map)).toBe(child);
  });

  it("returns undefined when no block observes this one as its parent", () => {
    // parentHash をデフォルトのまま(=own hashと不一致な"0xparent"固定値)にせず、
    // 明示的に別の値にしておく(hash と parentHash が偶然一致すると
    // 「自分自身が自分の子」という無意味な自己参照になってしまうため)。
    const parent = block({ hash: "0xgrandparent", number: 9, parentHash: "0xoutside" });
    const map = buildBlocksByHash([parent]);
    expect(findChildBlock(parent, map)).toBeUndefined();
  });

  it("breaks a fork tie by the latest receipt time (later wins)", () => {
    const parent = block({ hash: "0xparent", number: 9 });
    const forkA = block({
      hash: "0xforka",
      number: 10,
      parentHash: "0xparent",
      receivedAt: { node1: 100 },
    });
    const forkB = block({
      hash: "0xforkb",
      number: 10,
      parentHash: "0xparent",
      receivedAt: { node1: 200 },
    });
    const map = buildBlocksByHash([parent, forkA, forkB]);
    expect(findChildBlock(parent, map)).toBe(forkB);
  });

  it("breaks a fork tie by hash lexical order when receipt times are equal", () => {
    const parent = block({ hash: "0xparent", number: 9 });
    const forkHigh = block({
      hash: "0xffff",
      number: 10,
      parentHash: "0xparent",
      receivedAt: { node1: 100 },
    });
    const forkLow = block({
      hash: "0x0001",
      number: 10,
      parentHash: "0xparent",
      receivedAt: { node1: 100 },
    });
    const map = buildBlocksByHash([parent, forkHigh, forkLow]);
    expect(findChildBlock(parent, map)).toBe(forkLow);
  });

  it("treats unobserved receipt times as the oldest possible (negative infinity)", () => {
    const parent = block({ hash: "0xparent", number: 9 });
    const unreceived = block({
      hash: "0xunreceived",
      number: 10,
      parentHash: "0xparent",
      receivedAt: {},
    });
    const received = block({
      hash: "0xreceived",
      number: 10,
      parentHash: "0xparent",
      receivedAt: { node1: 1 },
    });
    const map = buildBlocksByHash([parent, unreceived, received]);
    expect(findChildBlock(parent, map)).toBe(received);
  });
});

describe("resolveBlockNavigation", () => {
  it("resolves parent, child, and isLatest=false when the block is not the latest", () => {
    const parent = block({ hash: "0xparent", number: 9 });
    const target = block({ hash: "0xtarget", number: 10, parentHash: "0xparent" });
    const child = block({ hash: "0xchild", number: 11, parentHash: "0xtarget" });
    const map = buildBlocksByHash([parent, target, child]);
    const nav = resolveBlockNavigation(target, map, "0xchild");
    expect(nav.parent).toBe(parent);
    expect(nav.child).toBe(child);
    expect(nav.isLatest).toBe(false);
  });

  it("sets isLatest=true when the block's hash matches latestBlockHash", () => {
    const target = block({ hash: "0xtarget", number: 10 });
    const map = buildBlocksByHash([target]);
    const nav = resolveBlockNavigation(target, map, "0xtarget");
    expect(nav.isLatest).toBe(true);
    expect(nav.child).toBeUndefined();
  });

  it("sets isLatest=false when latestBlockHash is undefined (no ribbon tiles observed yet)", () => {
    const target = block({ hash: "0xtarget", number: 10 });
    const map = buildBlocksByHash([target]);
    const nav = resolveBlockNavigation(target, map, undefined);
    expect(nav.isLatest).toBe(false);
  });
});

describe("selectBlockTransactions", () => {
  it("includes only transactions belonging to the target block, excluding pending", () => {
    const txs: TransactionEntity[] = [
      tx({ hash: "0x1", blockHash: "0xblock", status: "included", nonce: 0 }),
      tx({ hash: "0x2", blockHash: "0xblock", status: "failed", nonce: 1 }),
      tx({ hash: "0x3", blockHash: "0xother", status: "included", nonce: 0 }),
      tx({ hash: "0x4", blockHash: "0xblock", status: "pending", nonce: 2 }),
    ];
    const result = selectBlockTransactions("0xblock", txs);
    expect(result.map((t) => t.hash)).toEqual(["0x1", "0x2"]);
  });

  it("sorts by nonce ascending", () => {
    const txs: TransactionEntity[] = [
      tx({ hash: "0x1", blockHash: "0xblock", nonce: 3 }),
      tx({ hash: "0x2", blockHash: "0xblock", nonce: 1 }),
      tx({ hash: "0x3", blockHash: "0xblock", nonce: 2 }),
    ];
    const result = selectBlockTransactions("0xblock", txs);
    expect(result.map((t) => t.hash)).toEqual(["0x2", "0x3", "0x1"]);
  });

  it("places transactions without an observed nonce after those with one, sorted by hash", () => {
    const txs: TransactionEntity[] = [
      tx({ hash: "0xbbb", blockHash: "0xblock" }), // no nonce
      tx({ hash: "0x1", blockHash: "0xblock", nonce: 0 }),
      tx({ hash: "0xaaa", blockHash: "0xblock" }), // no nonce
    ];
    const result = selectBlockTransactions("0xblock", txs);
    expect(result.map((t) => t.hash)).toEqual(["0x1", "0xaaa", "0xbbb"]);
  });

  it("returns an empty array for a block with no included transactions", () => {
    expect(selectBlockTransactions("0xblock", [])).toEqual([]);
  });
});

describe("limitBlockTransactions", () => {
  it("returns all entries with zero overflow when under the limit", () => {
    const txs = [tx({ hash: "0x1" }), tx({ hash: "0x2" })];
    const result = limitBlockTransactions(txs, 5);
    expect(result.visible).toHaveLength(2);
    expect(result.overflowCount).toBe(0);
  });

  it("truncates to the limit and reports the overflow count", () => {
    const txs = [tx({ hash: "0x1" }), tx({ hash: "0x2" }), tx({ hash: "0x3" })];
    const result = limitBlockTransactions(txs, 2);
    expect(result.visible.map((t) => t.hash)).toEqual(["0x1", "0x2"]);
    expect(result.overflowCount).toBe(1);
  });

  it("uses BLOCK_DETAIL_TX_DISPLAY_LIMIT as the default limit", () => {
    const txs = Array.from({ length: BLOCK_DETAIL_TX_DISPLAY_LIMIT + 1 }, (_, i) =>
      tx({ hash: `0x${i}` }),
    );
    const result = limitBlockTransactions(txs);
    expect(result.visible).toHaveLength(BLOCK_DETAIL_TX_DISPLAY_LIMIT);
    expect(result.overflowCount).toBe(1);
  });
});
