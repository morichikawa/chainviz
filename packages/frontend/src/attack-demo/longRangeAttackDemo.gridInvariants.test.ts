// 共有グリッドの列計算の不変条件を、実データのブロック番号と広い範囲
// （0〜20）の両方で固定する補強テスト（Issue #415 テスト強化）。基本ケース
// （具体値）は longRangeAttackDemo.grid.test.ts が扱う。
//
// 既存テストの「同じブロック番号なら同じ列」の確認は
// `tileGridColumn(2) === tileGridColumn(2)` という同一呼び出しの比較で
// トートロジーになっていたため、ここでは実際の2本のチェーンのブロックから
// 列を引いて突き合わせる形で言い直す（CLAUDE.md の1ファイル1責務）。
import { describe, expect, it } from "vitest";
import {
  ATTACKER_CHAIN,
  CANONICAL_CHAIN,
  connectorGridColumnAfter,
  tileGridColumn,
} from "./longRangeAttackDemo.js";

/** ブロック数の前提が将来変わっても効くよう、実データより広い範囲で検査する。 */
const WIDE_RANGE = Array.from({ length: 21 }, (_, number) => number);

/** ラベル列（`grid-column: 1`）は行見出しに予約されている。 */
const LABEL_COLUMN = 1;

describe("tileGridColumn: invariants over a wide range", () => {
  it("never collides with the reserved label column", () => {
    for (const number of WIDE_RANGE) {
      expect(tileGridColumn(number)).toBeGreaterThan(LABEL_COLUMN);
    }
  });

  it("advances strictly by 2 per block number (exactly one connector column in between)", () => {
    for (const number of WIDE_RANGE.slice(1)) {
      expect(tileGridColumn(number) - tileGridColumn(number - 1)).toBe(2);
    }
  });

  it("keeps tile columns even and connector columns odd (collision-free by parity)", () => {
    for (const number of WIDE_RANGE) {
      expect(tileGridColumn(number) % 2).toBe(0);
      expect(connectorGridColumnAfter(number) % 2).toBe(1);
    }
  });
});

describe("connectorGridColumnAfter: invariants over a wide range", () => {
  it("sits strictly between the tile columns it connects", () => {
    for (const number of WIDE_RANGE.slice(0, -1)) {
      expect(connectorGridColumnAfter(number)).toBeGreaterThan(tileGridColumn(number));
      expect(connectorGridColumnAfter(number)).toBeLessThan(tileGridColumn(number + 1));
    }
  });

  it("shares no column with any tile and never takes the label column", () => {
    const tileColumns = new Set(WIDE_RANGE.map(tileGridColumn));
    for (const number of WIDE_RANGE) {
      expect(tileColumns.has(connectorGridColumnAfter(number))).toBe(false);
      expect(connectorGridColumnAfter(number)).not.toBe(LABEL_COLUMN);
    }
  });
});

describe("the three-row alignment invariant, expressed with the real chain data", () => {
  it("puts a canonical block and the attacker's block of the same number in the same column", () => {
    const attackerColumnByNumber = new Map(
      ATTACKER_CHAIN.map((block) => [block.number, tileGridColumn(block.number)]),
    );
    for (const block of CANONICAL_CHAIN) {
      expect(attackerColumnByNumber.get(block.number)).toBe(tileGridColumn(block.number));
    }
  });

  it("assigns a distinct column to every block number of the longer chain", () => {
    const columns = ATTACKER_CHAIN.map((block) => tileGridColumn(block.number));
    expect(new Set(columns).size).toBe(ATTACKER_CHAIN.length);
  });

  it("places the attacker's extra tip block beyond the canonical tip's column", () => {
    const canonicalTip = CANONICAL_CHAIN[CANONICAL_CHAIN.length - 1]!;
    const attackerTip = ATTACKER_CHAIN[ATTACKER_CHAIN.length - 1]!;
    expect(tileGridColumn(attackerTip.number)).toBe(tileGridColumn(canonicalTip.number) + 2);
  });
});
