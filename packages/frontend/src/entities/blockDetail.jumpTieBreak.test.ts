// 同一番号に複数ブロックが観測された場合（フォーク）の tie-break が、
// 意図的に重複実装されている3箇所で一致し続けることを担保する相互チェック。
//
// - `findBlockByNumber`（Issue #428。ブロック番号ジャンプ欄）
// - `findChildBlock`（Issue #409。前後ナビゲーションの「次のブロック」）
// - `chainRibbon.ts` の `pickCanonicalPerNumber`（Issue #298。リボンのタイル
//   選択。非公開関数のため `deriveRibbonTiles` 経由で観測する）
//
// この3箇所は「表示の一貫性を揃えるための意図的な重複」として実装されており
// （ARCHITECTURE.md §18.3.1 / docs/worklog/issue-428.md）、片方だけ規則が
// 変わると「リボンで見えているブロックと、番号ジャンプで着地するブロックが
// 違う」という分かりにくい不整合になる。個々の関数の単体テストとは別に、
// 「3者が同じ勝者を選ぶ」という不変条件そのものをここで固定する
// （CLAUDE.md のテスト分割方針: 関心事ごとにファイルを分ける）。
import type { BlockEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { buildBlocksByHash, findBlockByNumber, findChildBlock } from "./blockDetail.js";
import { deriveRibbonTiles } from "./chainRibbon.js";

function block(overrides: Partial<BlockEntity> & { hash: string }): BlockEntity {
  return {
    kind: "block",
    number: 10,
    parentHash: "0xparent",
    timestamp: 1_700_000_000,
    receivedAt: {},
    ...overrides,
  };
}

/**
 * リボン（`pickCanonicalPerNumber`）が同じ番号に対して選ぶブロック。タイル数
 * 上限で切り捨てられないよう、常にブロック件数より大きいタイル数を渡す。
 */
function ribbonWinner(
  blocks: readonly BlockEntity[],
  number: number,
): BlockEntity | undefined {
  return deriveRibbonTiles(blocks, blocks.length + 1).find(
    (tile) => tile.block.number === number,
  )?.block;
}

/** 3者（ジャンプ・リボン）が同じ勝者を選ぶことを確認する。 */
function expectJumpMatchesRibbon(blocks: readonly BlockEntity[], number: number): void {
  const jumped = findBlockByNumber(number, buildBlocksByHash(blocks));
  expect(jumped).toBe(ribbonWinner(blocks, number));
  // 走査順に依存しないこと（Map の挿入順は呼び出し元の配列順に等しいため、
  // 逆順で作った索引でも同じ勝者になる必要がある）。
  const reversed = [...blocks].reverse();
  expect(findBlockByNumber(number, buildBlocksByHash(reversed))).toBe(jumped);
  expect(ribbonWinner(reversed, number)).toBe(jumped);
}

describe("findBlockByNumber tie-break: consistency with the chain ribbon", () => {
  it("picks the block with the later latest-receipt time, same as the ribbon", () => {
    const early = block({ hash: "0xearly", number: 10, receivedAt: { node1: 100 } });
    const late = block({ hash: "0xlate", number: 10, receivedAt: { node1: 200 } });
    expectJumpMatchesRibbon([early, late], 10);
    expect(findBlockByNumber(10, buildBlocksByHash([early, late]))).toBe(late);
  });

  it("falls back to hash lexical order when the receipt times are equal, same as the ribbon", () => {
    const high = block({ hash: "0xffff", number: 10, receivedAt: { node1: 100 } });
    const low = block({ hash: "0x0001", number: 10, receivedAt: { node1: 100 } });
    expectJumpMatchesRibbon([high, low], 10);
    expect(findBlockByNumber(10, buildBlocksByHash([high, low]))).toBe(low);
  });

  it("prefers the later receipt time even when the losing hash sorts first (rules must not degrade into hash-only ordering)", () => {
    // hash 辞書順だけで決めると "0x0001" が勝つが、受信時刻が優先されるため
    // "0xffff" が勝つ組み合わせ。3者が同じ規則で動いているかを最も強く区別する。
    const earlyLowHash = block({
      hash: "0x0001",
      number: 10,
      receivedAt: { node1: 100 },
    });
    const lateHighHash = block({
      hash: "0xffff",
      number: 10,
      receivedAt: { node1: 200 },
    });
    expectJumpMatchesRibbon([earlyLowHash, lateHighHash], 10);
    expect(findBlockByNumber(10, buildBlocksByHash([earlyLowHash, lateHighHash]))).toBe(
      lateHighHash,
    );
  });

  it("uses the latest (not the earliest) receipt time across multiple nodes, same as the ribbon", () => {
    // fast は最速受信では勝つが、最遅受信では slow の方が遅い。
    const fast = block({
      hash: "0xfast",
      number: 10,
      receivedAt: { node1: 10, node2: 120 },
    });
    const slow = block({
      hash: "0xslow",
      number: 10,
      receivedAt: { node1: 100, node2: 300 },
    });
    expectJumpMatchesRibbon([fast, slow], 10);
    expect(findBlockByNumber(10, buildBlocksByHash([fast, slow]))).toBe(slow);
  });

  it("treats a block with no receivedAt entries as never received and lets any received block win", () => {
    const unreceived = block({ hash: "0x0000", number: 10, receivedAt: {} });
    const received = block({ hash: "0xffff", number: 10, receivedAt: { node1: 1 } });
    expectJumpMatchesRibbon([unreceived, received], 10);
    expect(findBlockByNumber(10, buildBlocksByHash([unreceived, received]))).toBe(
      received,
    );
  });

  it("falls back to hash lexical order when every candidate is unreceived", () => {
    const a = block({ hash: "0xbbbb", number: 10, receivedAt: {} });
    const b = block({ hash: "0xaaaa", number: 10, receivedAt: {} });
    expectJumpMatchesRibbon([a, b], 10);
    expect(findBlockByNumber(10, buildBlocksByHash([a, b]))).toBe(b);
  });

  it("ignores non-finite receipt times (NaN / Infinity) as unreceived, same as the ribbon", () => {
    // `latestReceiptTime` は有限数でない受信時刻を捨てる契約（blockPulse.ts）。
    // ここが揃っていないと、壊れた観測値を持つフォーク側が常に勝ってしまう。
    const broken = block({
      hash: "0x0001",
      number: 10,
      receivedAt: { node1: Number.NaN, node2: Number.POSITIVE_INFINITY },
    });
    const sane = block({ hash: "0xffff", number: 10, receivedAt: { node1: 1 } });
    expectJumpMatchesRibbon([broken, sane], 10);
    expect(findBlockByNumber(10, buildBlocksByHash([broken, sane]))).toBe(sane);
  });

  it("resolves a three-way fork to the same block as the ribbon", () => {
    const a = block({ hash: "0xaaaa", number: 10, receivedAt: { node1: 200 } });
    const b = block({ hash: "0xbbbb", number: 10, receivedAt: { node1: 200 } });
    const c = block({ hash: "0xcccc", number: 10, receivedAt: { node1: 100 } });
    expectJumpMatchesRibbon([c, b, a], 10);
    expect(findBlockByNumber(10, buildBlocksByHash([c, b, a]))).toBe(a);
  });

  it("resolves each number independently when several numbers are forked at once", () => {
    const blocks = [
      block({ hash: "0x10a", number: 10, receivedAt: { node1: 100 } }),
      block({ hash: "0x10b", number: 10, receivedAt: { node1: 200 } }),
      block({ hash: "0x11a", number: 11, receivedAt: { node1: 300 } }),
      block({ hash: "0x11b", number: 11, receivedAt: { node1: 300 } }),
      block({ hash: "0x12a", number: 12, receivedAt: { node1: 400 } }),
    ];
    expectJumpMatchesRibbon(blocks, 10);
    expectJumpMatchesRibbon(blocks, 11);
    expectJumpMatchesRibbon(blocks, 12);
  });
});

describe("findBlockByNumber tie-break: consistency with findChildBlock", () => {
  it("lands on the same fork branch as the 'next block' navigation", () => {
    const parent = block({ hash: "0xparent-block", number: 9, parentHash: "0xgrand" });
    const childEarly = block({
      hash: "0x0001",
      number: 10,
      parentHash: parent.hash,
      receivedAt: { node1: 100 },
    });
    const childLate = block({
      hash: "0xffff",
      number: 10,
      parentHash: parent.hash,
      receivedAt: { node1: 200 },
    });
    const map = buildBlocksByHash([parent, childEarly, childLate]);

    const viaNextButton = findChildBlock(parent, map);
    const viaNumberJump = findBlockByNumber(10, map);
    expect(viaNumberJump).toBe(viaNextButton);
    expect(viaNumberJump).toBe(childLate);
  });

  it("lands on the same fork branch when the tie is broken by hash order", () => {
    const parent = block({ hash: "0xparent-block", number: 9, parentHash: "0xgrand" });
    const childHigh = block({
      hash: "0xffff",
      number: 10,
      parentHash: parent.hash,
      receivedAt: { node1: 100 },
    });
    const childLow = block({
      hash: "0x0001",
      number: 10,
      parentHash: parent.hash,
      receivedAt: { node1: 100 },
    });
    const map = buildBlocksByHash([parent, childHigh, childLow]);

    expect(findBlockByNumber(10, map)).toBe(findChildBlock(parent, map));
    expect(findBlockByNumber(10, map)).toBe(childLow);
  });

  it("may differ from findChildBlock only when the fork branches carry different numbers (different questions, not different rules)", () => {
    // 「次のブロック」は parentHash 一致で探すため、番号が飛んだ子
    // （観測の取りこぼし）も拾う。番号ジャンプは番号一致で探すので、この
    // 場合は別のブロックを返すのが正しい。tie-break の不一致ではないことを
    // 明示しておく。
    const parent = block({ hash: "0xparent-block", number: 9, parentHash: "0xgrand" });
    const skippedChild = block({ hash: "0xchild", number: 12, parentHash: parent.hash });
    const unrelated = block({ hash: "0xother", number: 10, parentHash: "0xelsewhere" });
    const map = buildBlocksByHash([parent, skippedChild, unrelated]);

    expect(findChildBlock(parent, map)).toBe(skippedChild);
    expect(findBlockByNumber(10, map)).toBe(unrelated);
    expect(findBlockByNumber(12, map)).toBe(skippedChild);
  });
});
