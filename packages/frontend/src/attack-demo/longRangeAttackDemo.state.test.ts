// finality checkpoint の state 管理（create/reset/setCheckpoint/isFinalized）
// のテスト（Issue #415）。チェーンデータ自体・fork choice ルールは
// 別ファイルが扱う（CLAUDE.md の1ファイル1責務）。
import { describe, expect, it } from "vitest";
import {
  createInitialLongRangeAttackDemoState,
  isFinalized,
  resetLongRangeAttackDemoState,
  setCheckpoint,
} from "./longRangeAttackDemo.js";

describe("createInitialLongRangeAttackDemoState", () => {
  it("starts at checkpointIndex 0 (only genesis is finalized — UX設計 §4 操作フロー1)", () => {
    expect(createInitialLongRangeAttackDemoState()).toEqual({ checkpointIndex: 0 });
  });
});

describe("setCheckpoint", () => {
  it("moves the checkpoint to the given block number", () => {
    const state = createInitialLongRangeAttackDemoState();
    expect(setCheckpoint(state, 3)).toEqual({ checkpointIndex: 3 });
  });

  it("does not mutate the previous state object", () => {
    const state = createInitialLongRangeAttackDemoState();
    setCheckpoint(state, 3);
    expect(state).toEqual({ checkpointIndex: 0 });
  });
});

describe("resetLongRangeAttackDemoState", () => {
  it("returns to checkpointIndex 0 regardless of the current position", () => {
    const moved = setCheckpoint(createInitialLongRangeAttackDemoState(), 3);
    expect(resetLongRangeAttackDemoState()).toEqual({ checkpointIndex: 0 });
    // 呼び出し元の state を参照せず、常に初期値そのものを返す（引数を取らない）。
    expect(moved).toEqual({ checkpointIndex: 3 });
  });
});

describe("isFinalized", () => {
  it("treats block numbers at or before the checkpoint as finalized", () => {
    expect(isFinalized(0, 2)).toBe(true);
    expect(isFinalized(2, 2)).toBe(true);
  });

  it("treats block numbers after the checkpoint as not finalized", () => {
    expect(isFinalized(3, 2)).toBe(false);
  });

  it("treats genesis (#0) as finalized as soon as the checkpoint leaves the initial position", () => {
    expect(isFinalized(0, 0)).toBe(true);
  });
});
