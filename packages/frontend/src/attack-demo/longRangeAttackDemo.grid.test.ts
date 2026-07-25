// 共有グリッドの列計算（Issue #415 UX設計 §3「3段は同じ列位置に揃える」）の
// テスト。正規/checkpoint/攻撃者の3段が同じブロック番号で同じ列に並ぶ、
// という不変条件を直接固定する。
import { describe, expect, it } from "vitest";
import { connectorGridColumnAfter, tileGridColumn } from "./longRangeAttackDemo.js";

describe("tileGridColumn", () => {
  it("reserves column 1 for the row label (block #0 starts at column 2)", () => {
    expect(tileGridColumn(0)).toBe(2);
  });

  it("advances by 2 columns per block number (tile + connector)", () => {
    expect(tileGridColumn(1)).toBe(4);
    expect(tileGridColumn(2)).toBe(6);
    expect(tileGridColumn(3)).toBe(8);
    expect(tileGridColumn(4)).toBe(10);
  });

  it("places the same block number at the same column regardless of which row calls it (the core alignment invariant)", () => {
    const canonicalNumberTwoColumn = tileGridColumn(2);
    const attackerNumberTwoColumn = tileGridColumn(2);
    expect(canonicalNumberTwoColumn).toBe(attackerNumberTwoColumn);
  });
});

describe("connectorGridColumnAfter", () => {
  it("sits immediately after the tile column of the given block number", () => {
    expect(connectorGridColumnAfter(0)).toBe(tileGridColumn(0) + 1);
    expect(connectorGridColumnAfter(0)).toBe(3);
  });

  it("never collides with any tile column", () => {
    for (let number = 0; number <= 4; number++) {
      expect(connectorGridColumnAfter(number)).not.toBe(tileGridColumn(number));
      expect(connectorGridColumnAfter(number)).not.toBe(tileGridColumn(number + 1));
    }
  });
});
