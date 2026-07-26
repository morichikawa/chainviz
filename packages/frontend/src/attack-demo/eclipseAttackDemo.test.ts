// eclipseAttackDemo.ts の純粋ロジックのユニットテスト（Issue #416）。
// コンポーネントの操作フロー・表示は EclipseAttackDemoView.test.tsx が扱う
// （CLAUDE.md の1ファイル1責務）。
import { describe, expect, it } from "vitest";
import {
  ECLIPSE_DEMO_SLOT_COUNT,
  FAKE_CHAIN_BLOCK_KEYS,
  REAL_CHAIN_BLOCK_KEYS,
  addAttackerPeer,
  attackerCount,
  createInitialEclipseAttackDemoState,
  isFullyEclipsed,
  nextHonestSlotIndex,
  occupancyRatio,
  resetEclipseAttackDemoState,
  visibleChainBlockKeys,
  type EclipseAttackDemoState,
} from "./eclipseAttackDemo.js";

describe("createInitialEclipseAttackDemoState", () => {
  it("starts with all 8 slots honest", () => {
    const state = createInitialEclipseAttackDemoState();
    expect(state.slots.length).toBe(ECLIPSE_DEMO_SLOT_COUNT);
    expect(state.slots.every((slot) => slot === "honest")).toBe(true);
    expect(attackerCount(state)).toBe(0);
    expect(occupancyRatio(state)).toBe(0);
    expect(isFullyEclipsed(state)).toBe(false);
  });
});

describe("addAttackerPeer: fixed-order replacement", () => {
  it("replaces the first honest slot (index 0) on the first call", () => {
    const state = addAttackerPeer(createInitialEclipseAttackDemoState());
    expect(state.slots[0]).toBe("attacker");
    expect(state.slots.slice(1).every((slot) => slot === "honest")).toBe(true);
    expect(attackerCount(state)).toBe(1);
  });

  it("replaces slots in fixed order (0, 1, 2, ...) across repeated calls", () => {
    let state = createInitialEclipseAttackDemoState();
    for (let i = 0; i < ECLIPSE_DEMO_SLOT_COUNT; i += 1) {
      expect(nextHonestSlotIndex(state)).toBe(i);
      state = addAttackerPeer(state);
      expect(state.slots[i]).toBe("attacker");
      expect(attackerCount(state)).toBe(i + 1);
      // まだ置き換わっていない先のスロットは正規のまま。
      for (let j = i + 1; j < ECLIPSE_DEMO_SLOT_COUNT; j += 1) {
        expect(state.slots[j]).toBe("honest");
      }
    }
  });

  it("does not mutate the input state (returns a new object)", () => {
    const before = createInitialEclipseAttackDemoState();
    const beforeSlots = before.slots;
    const after = addAttackerPeer(before);
    expect(before.slots).toBe(beforeSlots);
    expect(before.slots[0]).toBe("honest");
    expect(after).not.toBe(before);
  });

  it("is idempotent once all 8 slots are attacker: further calls return an equal, unchanged state", () => {
    let state = createInitialEclipseAttackDemoState();
    for (let i = 0; i < ECLIPSE_DEMO_SLOT_COUNT; i += 1) {
      state = addAttackerPeer(state);
    }
    expect(attackerCount(state)).toBe(ECLIPSE_DEMO_SLOT_COUNT);
    expect(nextHonestSlotIndex(state)).toBeNull();

    const fullyEclipsed = state;
    const again = addAttackerPeer(fullyEclipsed);
    expect(again).toBe(fullyEclipsed); // no-op: 同一参照を返す
    expect(again.slots.every((slot) => slot === "attacker")).toBe(true);
  });
});

describe("occupancyRatio / isFullyEclipsed: boundary at 8/8", () => {
  it("stays below 1 (not fully eclipsed) at 7/8", () => {
    let state = createInitialEclipseAttackDemoState();
    for (let i = 0; i < ECLIPSE_DEMO_SLOT_COUNT - 1; i += 1) {
      state = addAttackerPeer(state);
    }
    expect(attackerCount(state)).toBe(7);
    expect(occupancyRatio(state)).toBeCloseTo(7 / 8);
    expect(isFullyEclipsed(state)).toBe(false);
    expect(visibleChainBlockKeys(state)).toBe(REAL_CHAIN_BLOCK_KEYS);
  });

  it("becomes fully eclipsed exactly at 8/8, and only then", () => {
    let state = createInitialEclipseAttackDemoState();
    for (let i = 0; i < ECLIPSE_DEMO_SLOT_COUNT; i += 1) {
      expect(isFullyEclipsed(state)).toBe(false);
      state = addAttackerPeer(state);
    }
    expect(attackerCount(state)).toBe(ECLIPSE_DEMO_SLOT_COUNT);
    expect(occupancyRatio(state)).toBe(1);
    expect(isFullyEclipsed(state)).toBe(true);
    expect(visibleChainBlockKeys(state)).toBe(FAKE_CHAIN_BLOCK_KEYS);
  });
});

describe("resetEclipseAttackDemoState", () => {
  it("returns to the pristine 8/8-honest state regardless of prior progress", () => {
    let state: EclipseAttackDemoState = createInitialEclipseAttackDemoState();
    for (let i = 0; i < ECLIPSE_DEMO_SLOT_COUNT; i += 1) {
      state = addAttackerPeer(state);
    }
    expect(isFullyEclipsed(state)).toBe(true);

    const reset = resetEclipseAttackDemoState();
    expect(reset.slots.every((slot) => slot === "honest")).toBe(true);
    expect(isFullyEclipsed(reset)).toBe(false);
    expect(visibleChainBlockKeys(reset)).toBe(REAL_CHAIN_BLOCK_KEYS);
  });
});

describe("nextHonestSlotIndex", () => {
  it("returns null for a state with no honest slots (defensive: constructed directly, not via addAttackerPeer)", () => {
    const allAttacker: EclipseAttackDemoState = {
      slots: Array.from({ length: ECLIPSE_DEMO_SLOT_COUNT }, () => "attacker" as const),
    };
    expect(nextHonestSlotIndex(allAttacker)).toBeNull();
  });
});
