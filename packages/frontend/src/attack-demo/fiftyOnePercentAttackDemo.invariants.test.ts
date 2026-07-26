// 「51%攻撃のしくみ」デモの純粋ロジックについて、代表値ではなく
// **到達可能な全状態（2^7 = 128 通りの攻撃者集合）** に対して成り立つべき
// 不変条件を網羅的に確認するテスト（Issue #414 のテスト強化）。
//
// fiftyOnePercentAttackDemo.test.ts が代表的なハッピーパス・境界値
// （0人/3人/4人/7人）を扱うのに対し、こちらは
//   - 重みの保存則・枝の分割（partition）が全状態で崩れないこと
//   - canonical 判定が「重みが大きい枝」と常に一致すること
//   - 同数（引き分け）が到達可能な状態には存在しないこと（総数が奇数だから）
//   - `marginToFlip` の count が 0 や負にならず、実際にその人数で逆転すること
//     （count-1 人では逆転しないこと）
// という性質側の確認に絞る（CLAUDE.md の1ファイル1責務）。
import { describe, expect, it } from "vitest";
import {
  TOTAL_VALIDATORS,
  VALIDATOR_IDS,
  branchValidatorIds,
  canonicalBranch,
  createInitialFiftyOnePercentAttackDemoState,
  marginToFlip,
  toggleValidator,
  weightOfBranch,
  weightOfBranchA,
  weightOfBranchB,
  type FiftyOnePercentAttackDemoState,
} from "./fiftyOnePercentAttackDemo.js";

/** 公開APIだけを使って、指定 id 群が攻撃者側に居る状態を組み立てる。 */
function withAttackers(ids: readonly number[]): FiftyOnePercentAttackDemoState {
  return ids.reduce(
    (state, id) => toggleValidator(state, id),
    createInitialFiftyOnePercentAttackDemoState(),
  );
}

/** 攻撃者集合として到達可能な全パターン（空集合〜全員の 2^7 通り）。 */
function allAttackerSubsets(): number[][] {
  const subsets: number[][] = [];
  for (let mask = 0; mask < 1 << TOTAL_VALIDATORS; mask++) {
    subsets.push(VALIDATOR_IDS.filter((_, index) => (mask & (1 << index)) !== 0));
  }
  return subsets;
}

const SUBSETS = allAttackerSubsets();

describe("fiftyOnePercentAttackDemo invariants over every reachable state", () => {
  it("enumerates all 2^7 attacker subsets (guard for the exhaustive cases below)", () => {
    expect(SUBSETS.length).toBe(128);
  });

  it("conserves the total weight: branch A + branch B always equals the validator count", () => {
    for (const ids of SUBSETS) {
      const state = withAttackers(ids);
      expect(weightOfBranchA(state) + weightOfBranchB(state)).toBe(TOTAL_VALIDATORS);
    }
  });

  it("partitions the fixed validator roster between the two branches (disjoint, ascending, complete)", () => {
    for (const ids of SUBSETS) {
      const state = withAttackers(ids);
      const onA = branchValidatorIds(state, "a");
      const onB = branchValidatorIds(state, "b");
      // 昇順（表示順の安定性。クリック順に依存しないこと）。
      expect(onA).toEqual([...onA].sort((x, y) => x - y));
      expect(onB).toEqual([...onB].sort((x, y) => x - y));
      // 排他かつ全員をカバーする。
      expect(onA.filter((id) => onB.includes(id))).toEqual([]);
      expect([...onA, ...onB].sort((x, y) => x - y)).toEqual([...VALIDATOR_IDS]);
      // 枝Bに居るのはクリックした id そのもの（個体の同一性）。
      expect(onB).toEqual([...ids].sort((x, y) => x - y));
    }
  });

  it("keeps weightOfBranch consistent with the per-branch roster length (AttackBranchBox's weight prop contract)", () => {
    for (const ids of SUBSETS) {
      const state = withAttackers(ids);
      for (const branch of ["a", "b"] as const) {
        expect(weightOfBranch(state, branch)).toBe(branchValidatorIds(state, branch).length);
      }
      expect(weightOfBranch(state, "a")).toBe(weightOfBranchA(state));
      expect(weightOfBranch(state, "b")).toBe(weightOfBranchB(state));
    }
  });

  it("never reaches a tie, so canonical is always the strictly heavier branch", () => {
    // 総数が奇数（7）である限り引き分けは起こらない。`canonicalBranch` の
    // 「同数なら枝A」規則は到達不能な防御的分岐であることをここで固定する
    // （TOTAL_VALIDATORS を偶数に変える改修が入ったらこのテストが落ちて、
    // 同数時の扱いを設計し直す必要があることに気付ける）。
    expect(TOTAL_VALIDATORS % 2).toBe(1);
    for (const ids of SUBSETS) {
      const state = withAttackers(ids);
      const a = weightOfBranchA(state);
      const b = weightOfBranchB(state);
      expect(a).not.toBe(b);
      expect(canonicalBranch(state)).toBe(a > b ? "a" : "b");
    }
  });

  it("reports a margin that is always at least 1 and at most the majority threshold", () => {
    for (const ids of SUBSETS) {
      const margin = marginToFlip(withAttackers(ids));
      if (margin.flipped) continue;
      // 0人・負値を返さないこと（UX設計 §6 の要件）。
      expect(margin.count).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(margin.count)).toBe(true);
      // 全員誠実（攻撃者0人）のときが最大で4人。それを超えることはない。
      expect(margin.count).toBeLessThanOrEqual(4);
    }
  });

  it("flips exactly at the reported margin: count more defections flip it, count - 1 do not", () => {
    for (const ids of SUBSETS) {
      const state = withAttackers(ids);
      const margin = marginToFlip(state);
      if (margin.flipped) {
        expect(canonicalBranch(state)).toBe("b");
        continue;
      }
      const honest = branchValidatorIds(state, "a");
      expect(honest.length).toBeGreaterThanOrEqual(margin.count);
      const oneShort = honest
        .slice(0, margin.count - 1)
        .reduce((acc, id) => toggleValidator(acc, id), state);
      expect(canonicalBranch(oneShort)).toBe("a");
      const justEnough = honest
        .slice(0, margin.count)
        .reduce((acc, id) => toggleValidator(acc, id), state);
      expect(canonicalBranch(justEnough)).toBe("b");
      expect(marginToFlip(justEnough)).toEqual({ flipped: true });
    }
  });

  it("omits the count field entirely once branch B is already canonical (discriminated union)", () => {
    const flipped = marginToFlip(withAttackers([1, 2, 3, 4]));
    expect(flipped).toEqual({ flipped: true });
    expect("count" in flipped).toBe(false);
  });
});

describe("fiftyOnePercentAttackDemo tie rule (defensive branch, unreachable via the public API)", () => {
  // 上のテストのとおり 7人固定では同数が起こらないため、`canonicalBranch` の
  // 「同数なら枝Aを優先する」という決定的規則（実装の docstring 明記）は
  // 通常のテストでは一度も踏まれない。`>` を `>=` に書き換えるような改変を
  // 検出できるよう、同数になる state を型キャストで捏造して規則を固定する。
  const tie: FiftyOnePercentAttackDemoState = {
    attackerValidatorIds: {
      size: TOTAL_VALIDATORS / 2,
      has: () => false,
    } as unknown as ReadonlySet<number>,
  };

  it("prefers branch A when both branches carry the same weight", () => {
    expect(weightOfBranchA(tie)).toBe(weightOfBranchB(tie));
    expect(canonicalBranch(tie)).toBe("a");
  });

  it("still reports a positive margin (never 0) at the tie boundary", () => {
    const margin = marginToFlip(tie);
    expect(margin.flipped).toBe(false);
    if (!margin.flipped) expect(margin.count).toBe(1);
  });
});
