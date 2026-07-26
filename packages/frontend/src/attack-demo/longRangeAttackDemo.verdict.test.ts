// 2つの fork choice ルール（Issue #415 UX設計 §5「本物の判定ロジック」）の
// テスト。演出の固定文言ではなく実際に計算していることを、境界値と
// 「将来ブロック数が変わっても壊れない」ことの両面から確認する。
// チェーンデータ自体・checkpoint state は別ファイルが扱う
// （CLAUDE.md の1ファイル1責務）。
import { describe, expect, it } from "vitest";
import {
  ATTACKER_CHAIN,
  CANONICAL_CHAIN,
  DIVERGE_AT,
  pickByFinalityAwareRule,
  pickByNaiveLongestChainRule,
} from "./longRangeAttackDemo.js";

describe("pickByNaiveLongestChainRule", () => {
  it("picks the attacker's history for this demo's actual chain lengths (5 > 4)", () => {
    expect(pickByNaiveLongestChainRule(CANONICAL_CHAIN.length, ATTACKER_CHAIN.length)).toBe(
      "attacker",
    );
  });

  it("is a real length comparison, not a hardcoded 'attacker' — picks canonical when it is longer", () => {
    expect(pickByNaiveLongestChainRule(10, 4)).toBe("canonical");
  });

  it("picks attacker on a tie (>= , matching 'longest OR equally recent wins')", () => {
    expect(pickByNaiveLongestChainRule(4, 4)).toBe("attacker");
  });
});

describe("pickByFinalityAwareRule: boundary around the divergence point", () => {
  it("stays vulnerable to the attack just before the divergence point (checkpoint = divergeAt - 1)", () => {
    expect(pickByFinalityAwareRule(DIVERGE_AT - 1, DIVERGE_AT)).toBe("attacker");
  });

  it("becomes protected exactly at the divergence point (checkpoint = divergeAt)", () => {
    expect(pickByFinalityAwareRule(DIVERGE_AT, DIVERGE_AT)).toBe("canonical");
  });

  it("stays protected once finality has progressed further than the divergence point", () => {
    expect(pickByFinalityAwareRule(DIVERGE_AT + 1, DIVERGE_AT)).toBe("canonical");
  });

  it("stays vulnerable at the very start (checkpoint = 0, divergeAt > 0)", () => {
    expect(pickByFinalityAwareRule(0, DIVERGE_AT)).toBe("attacker");
  });
});
