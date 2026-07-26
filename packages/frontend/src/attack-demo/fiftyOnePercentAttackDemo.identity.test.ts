// 「51%攻撃のしくみ」デモの純粋ロジックのうち、
//   - バリデーターの個体の同一性（UX設計 §3・§6。誰が寝返ったかが保たれる）
//   - 操作順序に依存しないこと（同じ集合になれば同じ結果）
//   - 状態の不変性（既存 state・返り値の配列を書き換えないこと）
//   - 想定外の id（小数・NaN・Infinity・範囲外）に対する防御
// に絞ったテスト（Issue #414 のテスト強化）。重み計算・fork choice の
// 不変条件は fiftyOnePercentAttackDemo.invariants.test.ts、代表値は
// fiftyOnePercentAttackDemo.test.ts が扱う（CLAUDE.md の1ファイル1責務）。
import { describe, expect, it } from "vitest";
import {
  VALIDATOR_IDS,
  branchValidatorIds,
  createInitialFiftyOnePercentAttackDemoState,
  toggleValidator,
  weightOfBranchA,
  weightOfBranchB,
  type FiftyOnePercentAttackDemoState,
} from "./fiftyOnePercentAttackDemo.js";

function withAttackers(ids: readonly number[]): FiftyOnePercentAttackDemoState {
  return ids.reduce(
    (state, id) => toggleValidator(state, id),
    createInitialFiftyOnePercentAttackDemoState(),
  );
}

describe("toggleValidator: individual identity of each validator", () => {
  it("moves only the clicked validator, leaving the others where they were", () => {
    const before = withAttackers([2, 5]);
    const after = toggleValidator(before, 6);
    expect(branchValidatorIds(after, "b")).toEqual([2, 5, 6]);
    expect(branchValidatorIds(after, "a")).toEqual([1, 3, 4, 7]);
  });

  it("brings back the same validator (not just some validator) when it is clicked again", () => {
    // 他のバリデーターが動いた後でも、同じ id を再クリックすればその id が
    // 枝Aへ戻る（人数だけを持つ設計では表現できない要件。UX設計 §6）。
    let state = toggleValidator(createInitialFiftyOnePercentAttackDemoState(), 3);
    state = toggleValidator(state, 5);
    state = toggleValidator(state, 7);
    state = toggleValidator(state, 5);
    expect(branchValidatorIds(state, "b")).toEqual([3, 7]);
    expect(branchValidatorIds(state, "a")).toEqual([1, 2, 4, 5, 6]);
  });

  it("returns to the exact previous state when a toggle is undone mid-sequence", () => {
    const base = withAttackers([1, 4]);
    const detoured = toggleValidator(toggleValidator(base, 6), 6);
    expect(detoured).toEqual(base);
  });
});

describe("toggleValidator: order independence", () => {
  it("produces an equal state regardless of the order the same validators were toggled in", () => {
    const orders = [
      [1, 2, 3, 4],
      [4, 3, 2, 1],
      [2, 4, 1, 3],
      [7, 7, 1, 2, 3, 4], // 途中で往復しても最終集合が同じなら同じ結果
    ];
    const expected = withAttackers([1, 2, 3, 4]);
    for (const order of orders) {
      const state = withAttackers(order);
      expect(state.attackerValidatorIds).toEqual(expected.attackerValidatorIds);
      expect(branchValidatorIds(state, "b")).toEqual([1, 2, 3, 4]);
      expect(branchValidatorIds(state, "a")).toEqual([5, 6, 7]);
    }
  });

  it("keeps the display order ascending even when validators defect in reverse order", () => {
    const state = withAttackers([7, 6, 5]);
    expect(branchValidatorIds(state, "b")).toEqual([5, 6, 7]);
    expect(branchValidatorIds(state, "a")).toEqual([1, 2, 3, 4]);
  });
});

describe("toggleValidator: immutability of the previous state", () => {
  it("does not mutate the state (or its Set) that was passed in", () => {
    const before = withAttackers([2]);
    const beforeSet = before.attackerValidatorIds;
    const after = toggleValidator(before, 4);
    // 呼び出し前の state は書き換わらない（React の state 更新で
    // 前回値と新しい値を比較できる前提）。
    expect([...beforeSet]).toEqual([2]);
    expect(before.attackerValidatorIds).toBe(beforeSet);
    expect(weightOfBranchB(before)).toBe(1);
    // 新しい state は別オブジェクト・別 Set（参照の使い回しをしない）。
    expect(after).not.toBe(before);
    expect(after.attackerValidatorIds).not.toBe(beforeSet);
    expect(weightOfBranchB(after)).toBe(2);
  });

  it("returns a fresh array from branchValidatorIds so callers cannot corrupt the roster", () => {
    const state = withAttackers([3]);
    const first = branchValidatorIds(state, "a");
    first.push(999);
    first.sort((x, y) => y - x);
    // 呼び出し側が配列を書き換えても、次の呼び出し・固定の名簿には響かない。
    expect(branchValidatorIds(state, "a")).toEqual([1, 2, 4, 5, 6, 7]);
    expect([...VALIDATOR_IDS]).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("toggleValidator: defensive handling of unexpected ids", () => {
  it("ignores non-integer, NaN and infinite ids without changing the state", () => {
    const state = withAttackers([2]);
    for (const id of [1.5, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(toggleValidator(state, id)).toBe(state);
    }
    expect(weightOfBranchB(state)).toBe(1);
  });

  it("ignores ids just outside both ends of the roster", () => {
    const state = createInitialFiftyOnePercentAttackDemoState();
    for (const id of [0, 8, -1, Number.MAX_SAFE_INTEGER]) {
      expect(toggleValidator(state, id)).toBe(state);
    }
    expect(weightOfBranchA(state)).toBe(7);
    expect(weightOfBranchB(state)).toBe(0);
  });

  it("accepts every id in the roster (the boundary ids 1 and 7 included)", () => {
    const state = createInitialFiftyOnePercentAttackDemoState();
    for (const id of VALIDATOR_IDS) {
      expect(toggleValidator(state, id)).not.toBe(state);
    }
    expect(branchValidatorIds(toggleValidator(state, 1), "b")).toEqual([1]);
    expect(branchValidatorIds(toggleValidator(state, 7), "b")).toEqual([7]);
  });

  it("never lists an id outside the fixed roster, even for a hand-made state carrying a stray id", () => {
    // 公開APIでは作れない state（範囲外 id を含む Set）を捏造しても、
    // 表示に使う `branchValidatorIds` は固定名簿の範囲だけを返す
    // = 存在しないバリデーターのボタンが描かれることはない。
    const strayState: FiftyOnePercentAttackDemoState = {
      attackerValidatorIds: new Set([3, 99]),
    };
    expect(branchValidatorIds(strayState, "b")).toEqual([3]);
    expect(branchValidatorIds(strayState, "a")).toEqual([1, 2, 4, 5, 6, 7]);
  });
});
