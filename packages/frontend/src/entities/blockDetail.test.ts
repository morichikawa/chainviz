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
import { deriveRibbonTiles } from "./chainRibbon.js";

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

  it("selects the same fork winner that the chain ribbon's canonical selection would", () => {
    // findChildBlock は chainRibbon.ts の pickCanonicalPerNumber と同じ規則を
    // 独立実装している（docs/worklog/issue-409.md の申し送り: 規則を変える
    // 場合は両方の更新が必要）。両者を同じフォーク集合に突き合わせ、片方だけ
    // 規則が変わったときに検知できるようにするための cross-check。
    const parent = block({ hash: "0xparent", number: 9 });
    const forkEarly = block({
      hash: "0xaaaa",
      number: 10,
      parentHash: "0xparent",
      receivedAt: { node1: 100 },
    });
    const forkLate = block({
      hash: "0xbbbb",
      number: 10,
      parentHash: "0xparent",
      receivedAt: { node1: 250 },
    });
    const blocks = [parent, forkEarly, forkLate];
    const child = findChildBlock(parent, buildBlocksByHash(blocks));
    // deriveRibbonTiles は番号昇順で、末尾（=最新番号 10）のタイルが
    // リボンの正史選択（pickCanonicalPerNumber）の結果。findChildBlock の
    // 結果と一致するはず。
    const tiles = deriveRibbonTiles(blocks);
    const canonicalNumber10 = tiles[tiles.length - 1].block;
    expect(child).toBe(canonicalNumber10);
    expect(child).toBe(forkLate);
  });

  it("is deterministic regardless of block insertion order when a tie is broken by hash", () => {
    // 受信時刻が同一のとき tie-break は hash 辞書順で決まる。Map の反復順
    // （= 挿入順）に依存せず、どちらの順で観測しても同じ勝者になることを固定。
    const parent = block({ hash: "0xparent", number: 9 });
    const forkLow = block({
      hash: "0x0001",
      number: 10,
      parentHash: "0xparent",
      receivedAt: { node1: 100 },
    });
    const forkHigh = block({
      hash: "0x0002",
      number: 10,
      parentHash: "0xparent",
      receivedAt: { node1: 100 },
    });
    const forward = findChildBlock(parent, buildBlocksByHash([parent, forkLow, forkHigh]));
    const reversed = findChildBlock(parent, buildBlocksByHash([parent, forkHigh, forkLow]));
    expect(forward?.hash).toBe("0x0001");
    expect(reversed?.hash).toBe("0x0001");
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

  it("resolves a defined child and isLatest=true together (child presence and isLatest are independent)", () => {
    // isLatest（latestBlockHash 一致）と child（parentHash 逆引き）は独立に
    // 導出される。最新タイルに選ばれたブロックの子が別途観測されている
    // （リボンにまだ反映されていないフォーク等）状況では両方が同時に立ちうる。
    // View 側の「次へ」可否は child の有無で決まる（isLatest は理由文言の
    // 出し分け専用）ため、両者が両立しうることをこの層で固定する。
    const target = block({ hash: "0xtarget", number: 10 });
    const child = block({ hash: "0xchild", number: 11, parentHash: "0xtarget" });
    const map = buildBlocksByHash([target, child]);
    const nav = resolveBlockNavigation(target, map, "0xtarget");
    expect(nav.isLatest).toBe(true);
    expect(nav.child).toBe(child);
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

  it("excludes transactions whose blockHash is undefined even though they are not pending", () => {
    // countTransactionsByBlockHash と同じ絞り込み条件（blockHash undefined は
    // 対象外）。`tx.blockHash === hash` の hash は必ず具体的な文字列なので、
    // blockHash 未観測の tx が誤って混ざらないことを固定する。
    const txs: TransactionEntity[] = [
      tx({ hash: "0x1", blockHash: "0xblock", nonce: 0 }),
      tx({ hash: "0x2", status: "included", nonce: 1 }), // blockHash undefined
    ];
    expect(selectBlockTransactions("0xblock", txs).map((t) => t.hash)).toEqual(["0x1"]);
  });

  it("does not mutate the input array (sorting happens on a filtered copy)", () => {
    const txs: TransactionEntity[] = [
      tx({ hash: "0x2", blockHash: "0xblock", nonce: 3 }),
      tx({ hash: "0x1", blockHash: "0xblock", nonce: 1 }),
    ];
    const before = txs.map((t) => t.hash);
    selectBlockTransactions("0xblock", txs);
    expect(txs.map((t) => t.hash)).toEqual(before);
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

  it("keeps every entry with zero overflow when the count is exactly the limit (boundary)", () => {
    const txs = [tx({ hash: "0x1" }), tx({ hash: "0x2" }), tx({ hash: "0x3" })];
    const result = limitBlockTransactions(txs, 3);
    expect(result.visible).toHaveLength(3);
    expect(result.overflowCount).toBe(0);
  });

  it("truncates everything and reports the full count as overflow when the limit is zero", () => {
    const txs = [tx({ hash: "0x1" }), tx({ hash: "0x2" })];
    const result = limitBlockTransactions(txs, 0);
    expect(result.visible).toHaveLength(0);
    expect(result.overflowCount).toBe(2);
  });

  it("returns an empty visible list and zero overflow for no transactions", () => {
    const result = limitBlockTransactions([], 5);
    expect(result.visible).toEqual([]);
    expect(result.overflowCount).toBe(0);
  });

  it("returns a fresh array rather than the caller's input reference", () => {
    // visible は呼び出し側が保持している元配列とは別インスタンス（`[...]` /
    // `slice`）で返す。上限未満の分岐でも参照を使い回さないことを固定する。
    const txs = [tx({ hash: "0x1" })];
    const result = limitBlockTransactions(txs, 5);
    expect(result.visible).not.toBe(txs);
    expect(result.visible).toEqual(txs);
  });
});
