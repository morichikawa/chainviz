// 「51%攻撃のしくみ」デモの純粋ロジック（fork choice 判定・重み計算・
// トグル操作）のテスト。View 側の操作フロー・a11y・i18n は
// FiftyOnePercentAttackDemoView.*.test.tsx が扱う（CLAUDE.md の1ファイル1責務）。
import { describe, expect, it } from "vitest";
import {
  TOTAL_VALIDATORS,
  VALIDATOR_IDS,
  branchValidatorIds,
  canonicalBranch,
  createInitialFiftyOnePercentAttackDemoState,
  marginToFlip,
  resetFiftyOnePercentAttackDemoState,
  toggleValidator,
  weightOfBranchA,
  weightOfBranchB,
  type FiftyOnePercentAttackDemoState,
} from "./fiftyOnePercentAttackDemo.js";

function withAttackers(ids: number[]): FiftyOnePercentAttackDemoState {
  return ids.reduce(
    (state, id) => toggleValidator(state, id),
    createInitialFiftyOnePercentAttackDemoState(),
  );
}

describe("fiftyOnePercentAttackDemo: constants", () => {
  it("fixes the validator count at 7 (UX design §2)", () => {
    expect(TOTAL_VALIDATORS).toBe(7);
    expect(VALIDATOR_IDS).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("fiftyOnePercentAttackDemo: initial state", () => {
  it("starts with all 7 validators honest (branch A = 7, branch B = 0, canonical = a)", () => {
    const state = createInitialFiftyOnePercentAttackDemoState();
    expect(weightOfBranchA(state)).toBe(7);
    expect(weightOfBranchB(state)).toBe(0);
    expect(canonicalBranch(state)).toBe("a");
    expect(branchValidatorIds(state, "a")).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(branchValidatorIds(state, "b")).toEqual([]);
  });

  it("reset produces the same state as the initial constructor", () => {
    expect(resetFiftyOnePercentAttackDemoState()).toEqual(
      createInitialFiftyOnePercentAttackDemoState(),
    );
  });
});

describe("fiftyOnePercentAttackDemo: toggling validators", () => {
  it("moves a validator from branch A to branch B when toggled", () => {
    const state = toggleValidator(createInitialFiftyOnePercentAttackDemoState(), 3);
    expect(branchValidatorIds(state, "b")).toEqual([3]);
    expect(branchValidatorIds(state, "a")).toEqual([1, 2, 4, 5, 6, 7]);
  });

  it("toggling the same validator twice returns it to branch A (round trip)", () => {
    let state = createInitialFiftyOnePercentAttackDemoState();
    state = toggleValidator(state, 5);
    state = toggleValidator(state, 5);
    expect(state).toEqual(createInitialFiftyOnePercentAttackDemoState());
  });

  it("is a no-op for an out-of-range id (defensive boundary handling)", () => {
    const state = createInitialFiftyOnePercentAttackDemoState();
    expect(toggleValidator(state, 0)).toBe(state);
    expect(toggleValidator(state, 8)).toBe(state);
    expect(toggleValidator(state, -1)).toBe(state);
  });
});

describe("fiftyOnePercentAttackDemo: fork choice (simplified: larger total weight wins)", () => {
  it("keeps branch A canonical while attackers are a minority (3 of 7)", () => {
    const state = withAttackers([1, 2, 3]);
    expect(weightOfBranchA(state)).toBe(4);
    expect(weightOfBranchB(state)).toBe(3);
    expect(canonicalBranch(state)).toBe("a");
    expect(marginToFlip(state)).toEqual({ flipped: false, count: 1 });
  });

  it("flips canonical to branch B once attackers reach 4 of 7 (~57%)", () => {
    const state = withAttackers([1, 2, 3, 4]);
    expect(weightOfBranchA(state)).toBe(3);
    expect(weightOfBranchB(state)).toBe(4);
    expect(canonicalBranch(state)).toBe("b");
    expect(marginToFlip(state)).toEqual({ flipped: true });
  });

  it("reports the correct margin at every attacker count from 0 to 7", () => {
    // marginToFlip の count は「あと何人でBが逆転するか」。0人時点では
    // 4人（総数7の過半数を握るために必要な最小人数）が正しい。
    const expected: Array<{ flipped: boolean; count?: number }> = [
      { flipped: false, count: 4 }, // 0人
      { flipped: false, count: 3 }, // 1人
      { flipped: false, count: 2 }, // 2人
      { flipped: false, count: 1 }, // 3人
      { flipped: true }, // 4人
      { flipped: true }, // 5人
      { flipped: true }, // 6人
      { flipped: true }, // 7人
    ];
    for (let attackerCount = 0; attackerCount <= 7; attackerCount++) {
      const state = withAttackers(VALIDATOR_IDS.slice(0, attackerCount));
      const margin = marginToFlip(state);
      expect(margin.flipped).toBe(expected[attackerCount]!.flipped);
      if (!margin.flipped) {
        expect(margin.count).toBe(expected[attackerCount]!.count);
      }
    }
  });

  it("handles the extreme values: all honest and all attacker-controlled", () => {
    const allHonest = createInitialFiftyOnePercentAttackDemoState();
    expect(branchValidatorIds(allHonest, "b")).toEqual([]);

    const allAttacker = withAttackers([...VALIDATOR_IDS]);
    expect(branchValidatorIds(allAttacker, "a")).toEqual([]);
    expect(weightOfBranchB(allAttacker)).toBe(7);
    expect(canonicalBranch(allAttacker)).toBe("b");
  });
});
