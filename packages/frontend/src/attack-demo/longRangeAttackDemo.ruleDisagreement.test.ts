// 2つの fork choice ルールの異常値・全組み合わせ、および「2つのルールが
// どこで食い違うか」という砂場の教育上の核心を固定する補強テスト
// （Issue #415 テスト強化）。境界値の基本ケースは
// longRangeAttackDemo.verdict.test.ts が扱う（CLAUDE.md の1ファイル1責務）。
import { describe, expect, it } from "vitest";
import {
  ATTACKER_CHAIN,
  CANONICAL_CHAIN,
  DIVERGE_AT,
  pickByFinalityAwareRule,
  pickByNaiveLongestChainRule,
} from "./longRangeAttackDemo.js";

/** UI（checkpoint チップ）が実際に提示する値の全域。 */
const SELECTABLE_CHECKPOINTS = CANONICAL_CHAIN.map((block) => block.number);

describe("pickByNaiveLongestChainRule: exhaustive", () => {
  it("matches attackerLength >= canonicalLength for every pair in 0..6", () => {
    for (let canonicalLength = 0; canonicalLength <= 6; canonicalLength++) {
      for (let attackerLength = 0; attackerLength <= 6; attackerLength++) {
        expect(pickByNaiveLongestChainRule(canonicalLength, attackerLength)).toBe(
          attackerLength >= canonicalLength ? "attacker" : "canonical",
        );
      }
    }
  });

  it("picks the attacker even for two empty chains (degenerate tie)", () => {
    expect(pickByNaiveLongestChainRule(0, 0)).toBe("attacker");
  });

  it("picks canonical when this demo's actual lengths are swapped", () => {
    // 「常に attacker を返す決め打ち」ではないことを、実データの長さを
    // 入れ替えるという形で確認する（片方だけ書き換えると落ちる）。
    expect(pickByNaiveLongestChainRule(ATTACKER_CHAIN.length, CANONICAL_CHAIN.length)).toBe(
      "canonical",
    );
  });

  it("ignores the checkpoint entirely: the same lengths always give the same answer", () => {
    const answers = new Set(
      SELECTABLE_CHECKPOINTS.map(() =>
        pickByNaiveLongestChainRule(CANONICAL_CHAIN.length, ATTACKER_CHAIN.length),
      ),
    );
    expect([...answers]).toEqual(["attacker"]);
  });
});

describe("pickByFinalityAwareRule: exhaustive", () => {
  it("matches checkpointIndex >= divergeAtIndex for every pair in -1..5", () => {
    for (let checkpointIndex = -1; checkpointIndex <= 5; checkpointIndex++) {
      for (let divergeAtIndex = 0; divergeAtIndex <= 5; divergeAtIndex++) {
        expect(pickByFinalityAwareRule(checkpointIndex, divergeAtIndex)).toBe(
          checkpointIndex >= divergeAtIndex ? "canonical" : "attacker",
        );
      }
    }
  });

  it("protects the canonical chain at checkpoint 0 when the attacker rewrites genesis itself", () => {
    // divergeAt = 0（genesis から作り直す）という極端なケースでは、
    // 初期状態（checkpoint = 0）の時点ですでに防御されている。
    expect(pickByFinalityAwareRule(0, 0)).toBe("canonical");
    expect(pickByFinalityAwareRule(-1, 0)).toBe("attacker");
  });

  it("never protects the canonical chain when the divergence point is past the last checkpoint", () => {
    // 分岐点が「まだ確定させられない先」にある場合は、UI で選べるどの
    // checkpoint でも防げない。
    const unreachableDivergeAt = CANONICAL_CHAIN.length + 1;
    for (const checkpointIndex of SELECTABLE_CHECKPOINTS) {
      expect(pickByFinalityAwareRule(checkpointIndex, unreachableDivergeAt)).toBe("attacker");
    }
  });
});

describe("the two rules disagree exactly where the sandbox teaches", () => {
  it("differs only once, at DIVERGE_AT, across the full checkpoint sweep", () => {
    const verdicts = SELECTABLE_CHECKPOINTS.map((checkpointIndex) => ({
      checkpointIndex,
      naive: pickByNaiveLongestChainRule(CANONICAL_CHAIN.length, ATTACKER_CHAIN.length),
      finality: pickByFinalityAwareRule(checkpointIndex, DIVERGE_AT),
    }));

    // checkpoint < DIVERGE_AT では両ルールが一致（どちらも攻撃者の履歴）、
    // checkpoint >= DIVERGE_AT では食い違う（naive: attacker / finality: canonical）。
    for (const verdict of verdicts) {
      expect(verdict.naive === verdict.finality).toBe(verdict.checkpointIndex < DIVERGE_AT);
    }

    // finality 側の切り替わりは全域でちょうど1回だけ（行き過ぎ・戻りが無い）。
    const flips = verdicts.filter(
      (verdict, index) => index > 0 && verdict.finality !== verdicts[index - 1]!.finality,
    );
    expect(flips.map((verdict) => verdict.checkpointIndex)).toEqual([DIVERGE_AT]);
  });

  it("keeps at least one selectable checkpoint on each side of the boundary", () => {
    // 分岐点が端に寄りすぎていると「行き来して比べる」という操作フローが
    // 成立しない（UX設計 §2 が DIVERGE_AT を 0 ではなく 2 にした理由）。
    expect(SELECTABLE_CHECKPOINTS.filter((number) => number < DIVERGE_AT).length).toBeGreaterThan(0);
    expect(SELECTABLE_CHECKPOINTS.filter((number) => number >= DIVERGE_AT).length).toBeGreaterThan(
      0,
    );
  });
});
