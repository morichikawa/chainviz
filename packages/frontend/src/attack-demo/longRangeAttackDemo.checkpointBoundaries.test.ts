// finality checkpoint の state と `isFinalized` の境界値・異常値の補強テスト
// （Issue #415 テスト強化）。基本ケース（初期値・移動・reset）は
// longRangeAttackDemo.state.test.ts が扱う。ここは以下を固定する:
//   - 生成関数が毎回新しいオブジェクトを返すこと（共有インスタンスの汚染防止）
//   - 同じ値へ動かしても新しいオブジェクトを返すこと（React の再描画契約）
//   - UI が提示しない範囲外の値（負値・先端超え）を渡したときの防御的挙動
//   - `isFinalized` の全組み合わせ（-1〜5 × -1〜5）が `<=` と一致すること
//   - 確定済みブロックの集合が常に先頭からの連続区間であること
// （CLAUDE.md の1ファイル1責務）。
import { describe, expect, it } from "vitest";
import {
  ATTACKER_CHAIN,
  CANONICAL_CHAIN,
  createInitialLongRangeAttackDemoState,
  isFinalized,
  resetLongRangeAttackDemoState,
  setCheckpoint,
} from "./longRangeAttackDemo.js";

const CANONICAL_TIP = CANONICAL_CHAIN[CANONICAL_CHAIN.length - 1]!.number;
/** UI（checkpoint チップ）が実際に提示する値の全域。 */
const SELECTABLE_CHECKPOINTS = CANONICAL_CHAIN.map((block) => block.number);

describe("state object identity", () => {
  it("returns a fresh object from createInitial... on every call (no shared singleton)", () => {
    const first = createInitialLongRangeAttackDemoState();
    const second = createInitialLongRangeAttackDemoState();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it("returns a fresh object from reset... on every call", () => {
    expect(resetLongRangeAttackDemoState()).not.toBe(resetLongRangeAttackDemoState());
    expect(resetLongRangeAttackDemoState()).toEqual(createInitialLongRangeAttackDemoState());
  });

  it("returns a new object even when the checkpoint does not actually move", () => {
    // 同じチップを連打しても新しいオブジェクトを返す（参照が変わらないと
    // React が state 更新を無視し得るため、同値でも別オブジェクトである
    // ことを契約として固定する）。
    const state = createInitialLongRangeAttackDemoState();
    const same = setCheckpoint(state, state.checkpointIndex);
    expect(same).toEqual(state);
    expect(same).not.toBe(state);
  });

  it("keeps the state shape to just checkpointIndex", () => {
    // setCheckpoint は前の state を読まずに新しいオブジェクトを組み立てる。
    // 将来 state にフィールドが増えたら prev を展開する必要があるため、
    // 「今は1フィールドだけ」という前提を明示的に固定する。
    expect(Object.keys(setCheckpoint(createInitialLongRangeAttackDemoState(), 2))).toEqual([
      "checkpointIndex",
    ]);
  });
});

describe("setCheckpoint with values the UI never offers", () => {
  it.each([-1, CANONICAL_CHAIN.length, ATTACKER_CHAIN.length, 99])(
    "passes %i through unchanged (no clamping)",
    (index) => {
      // クランプしない設計。チップは CANONICAL_CHAIN から生成されるため
      // 範囲外の値は UI からは発生しないが、呼び出し側が渡した値をそのまま
      // 保持することを（将来の呼び出し元のために）固定しておく。
      expect(setCheckpoint(createInitialLongRangeAttackDemoState(), index)).toEqual({
        checkpointIndex: index,
      });
    },
  );

  it("does not mutate the previous state for out-of-range values either", () => {
    const state = createInitialLongRangeAttackDemoState();
    setCheckpoint(state, -1);
    setCheckpoint(state, 99);
    expect(state).toEqual({ checkpointIndex: 0 });
  });
});

describe("isFinalized: exhaustive comparison", () => {
  it("matches blockNumber <= checkpointIndex for every combination in -1..5", () => {
    for (let blockNumber = -1; blockNumber <= 5; blockNumber++) {
      for (let checkpointIndex = -1; checkpointIndex <= 5; checkpointIndex++) {
        expect(isFinalized(blockNumber, checkpointIndex)).toBe(blockNumber <= checkpointIndex);
      }
    }
  });

  it("never un-finalizes a block as the checkpoint advances (monotonic in the checkpoint)", () => {
    for (const block of CANONICAL_CHAIN) {
      let seenFinalized = false;
      for (let checkpointIndex = -1; checkpointIndex <= 5; checkpointIndex++) {
        const finalized = isFinalized(block.number, checkpointIndex);
        if (seenFinalized) expect(finalized).toBe(true);
        seenFinalized = seenFinalized || finalized;
      }
    }
  });
});

describe("isFinalized: the finalized set stays a contiguous prefix", () => {
  it.each(SELECTABLE_CHECKPOINTS)(
    "finalizes exactly #0..#%i of the canonical chain",
    (checkpointIndex) => {
      const finalized = CANONICAL_CHAIN.filter((block) =>
        isFinalized(block.number, checkpointIndex),
      ).map((block) => block.number);
      expect(finalized).toEqual(
        SELECTABLE_CHECKPOINTS.filter((number) => number <= checkpointIndex),
      );
      expect(finalized.length).toBe(checkpointIndex + 1);
    },
  );

  it("finalizes nothing at all — not even genesis — for the out-of-range checkpoint -1", () => {
    expect(CANONICAL_CHAIN.some((block) => isFinalized(block.number, -1))).toBe(false);
  });

  it("finalizes the whole canonical chain when the checkpoint is pushed past the tip", () => {
    for (const block of CANONICAL_CHAIN) {
      expect(isFinalized(block.number, CANONICAL_TIP + 5)).toBe(true);
    }
  });

  it("does not finalize the attacker's extra tip block at the highest selectable checkpoint", () => {
    // checkpoint は正規チェーンの確定状況を表すもので、攻撃者側の先端
    // （正規に対応するブロックが無い番号）は確定扱いにならない。
    const attackerTip = ATTACKER_CHAIN[ATTACKER_CHAIN.length - 1]!.number;
    expect(isFinalized(attackerTip, CANONICAL_TIP)).toBe(false);
  });
});
