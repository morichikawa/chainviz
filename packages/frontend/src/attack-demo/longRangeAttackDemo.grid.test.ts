// 共有グリッドの列計算（Issue #415 UX設計 §3「3段は同じ列位置に揃える」）の
// テスト。正規/checkpoint/攻撃者の3段が同じブロック番号で同じ列に並ぶ、
// という不変条件を直接固定する。
import { describe, expect, it } from "vitest";
import {
  ATTACKER_CHAIN,
  CANONICAL_CHAIN,
  connectorGridColumnAfter,
  tileGridColumn,
} from "./longRangeAttackDemo.js";

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

  // レビュー(Issue #415)での指摘: 以前はここが `tileGridColumn(2) ===
  // tileGridColumn(2)` という同一呼び出しの比較になっており、実質何も検証
  // していなかった。正規/攻撃者それぞれのチェーンが実際に持つ `#2` ブロック
  // から列を引いて突き合わせる形に直す(広い範囲での不変条件は
  // `longRangeAttackDemo.gridInvariants.test.ts` が別途担う)。
  it("places the canonical and attacker chain's own block #2 at the same column (the core alignment invariant)", () => {
    const canonicalBlock = CANONICAL_CHAIN.find((block) => block.number === 2)!;
    const attackerBlock = ATTACKER_CHAIN.find((block) => block.number === 2)!;
    expect(tileGridColumn(canonicalBlock.number)).toBe(tileGridColumn(attackerBlock.number));
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
