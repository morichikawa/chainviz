// eclipseAttackDemo.ts の異常系・境界値・決定性の補強テスト（Issue #416
// テスト強化）。ハッピーパス中心の基本ケースは eclipseAttackDemo.test.ts が
// 扱う。ここは以下に絞る（CLAUDE.md の1ファイル1責務）:
//   - 満杯（8/8）到達後に何度追加を呼んでも冪等であること（9回目以降）
//   - 攻撃者数 0〜8 の全段階での isFullyEclipsed / visibleChainBlockKeys の境界
//   - 固定順（時計回り）が決定的であること（同じ操作列は毎回同じスロット構成）
//   - リセット後に再度満杯まで進められること（状態が完全に初期化されること）
//   - 公開 API では作れない想定外の state（凍結された slots・穴あき・
//     未知のスロット値・スロット数が8以外）に対する防御的な振る舞い
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
  type PeerSlotState,
} from "./eclipseAttackDemo.js";

/** 初期状態から `times` 回「攻撃者ピアを追加」を適用した state。 */
function afterAdds(times: number): EclipseAttackDemoState {
  let state = createInitialEclipseAttackDemoState();
  for (let i = 0; i < times; i += 1) state = addAttackerPeer(state);
  return state;
}

/** 任意のスロット列から state を組み立てる（公開 API を経由しない防御的ケース用）。 */
function stateOf(slots: readonly PeerSlotState[]): EclipseAttackDemoState {
  return { slots };
}

describe("addAttackerPeer past the saturated 8/8 state", () => {
  it("is a no-op for the 9th through 20th call (identical reference, count never exceeds 8)", () => {
    const saturated = afterAdds(ECLIPSE_DEMO_SLOT_COUNT);
    let state = saturated;
    for (let call = ECLIPSE_DEMO_SLOT_COUNT + 1; call <= 20; call += 1) {
      state = addAttackerPeer(state);
      // 同一参照を返す = 新しいオブジェクトも作らない完全な no-op。
      expect(state).toBe(saturated);
      expect(attackerCount(state)).toBe(ECLIPSE_DEMO_SLOT_COUNT);
      // 占有率は 1 を超えない（8/8 より先へ進まない）。
      expect(occupancyRatio(state)).toBe(1);
      expect(isFullyEclipsed(state)).toBe(true);
      expect(visibleChainBlockKeys(state)).toBe(FAKE_CHAIN_BLOCK_KEYS);
      expect(state.slots.length).toBe(ECLIPSE_DEMO_SLOT_COUNT);
      expect(state.slots.every((slot) => slot === "attacker")).toBe(true);
    }
  });

  it("never throws when called on the saturated state", () => {
    const saturated = afterAdds(ECLIPSE_DEMO_SLOT_COUNT);
    expect(() => addAttackerPeer(saturated)).not.toThrow();
    expect(() => addAttackerPeer(addAttackerPeer(saturated))).not.toThrow();
  });
});

describe("boundary: the visible chain flips exactly once, at 8/8", () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 7])(
    "keeps the real chain and a below-1 occupancy ratio at %i/8",
    (attackers) => {
      const state = afterAdds(attackers);
      expect(attackerCount(state)).toBe(attackers);
      expect(occupancyRatio(state)).toBe(attackers / ECLIPSE_DEMO_SLOT_COUNT);
      expect(occupancyRatio(state)).toBeLessThan(1);
      expect(isFullyEclipsed(state)).toBe(false);
      expect(visibleChainBlockKeys(state)).toBe(REAL_CHAIN_BLOCK_KEYS);
    },
  );

  it("switches to the fake chain at 8/8 and stays there for further calls", () => {
    for (const attackers of [ECLIPSE_DEMO_SLOT_COUNT, ECLIPSE_DEMO_SLOT_COUNT + 3]) {
      const state = afterAdds(attackers);
      expect(attackerCount(state)).toBe(ECLIPSE_DEMO_SLOT_COUNT);
      expect(isFullyEclipsed(state)).toBe(true);
      expect(visibleChainBlockKeys(state)).toBe(FAKE_CHAIN_BLOCK_KEYS);
    }
  });

  it("flips the visible chain exactly once across the whole 0..8 progression", () => {
    const perStep = Array.from({ length: ECLIPSE_DEMO_SLOT_COUNT + 1 }, (_, attackers) =>
      visibleChainBlockKeys(afterAdds(attackers)),
    );
    const flips = perStep.filter((keys, index) => index > 0 && keys !== perStep[index - 1]).length;
    expect(flips).toBe(1);
    expect(perStep[ECLIPSE_DEMO_SLOT_COUNT - 1]).toBe(REAL_CHAIN_BLOCK_KEYS);
    expect(perStep[ECLIPSE_DEMO_SLOT_COUNT]).toBe(FAKE_CHAIN_BLOCK_KEYS);
  });

  it("makes the flip observable: the real and fake key lists are disjoint and equally long", () => {
    expect(REAL_CHAIN_BLOCK_KEYS.length).toBe(FAKE_CHAIN_BLOCK_KEYS.length);
    expect(new Set(REAL_CHAIN_BLOCK_KEYS).size).toBe(REAL_CHAIN_BLOCK_KEYS.length);
    expect(new Set(FAKE_CHAIN_BLOCK_KEYS).size).toBe(FAKE_CHAIN_BLOCK_KEYS.length);
    const shared = REAL_CHAIN_BLOCK_KEYS.filter((key) => FAKE_CHAIN_BLOCK_KEYS.includes(key));
    expect(shared).toEqual([]);
  });
});

describe("determinism of the fixed clock order", () => {
  it("produces identical slot arrays for two independent runs of the same click sequence", () => {
    for (let clicks = 0; clicks <= ECLIPSE_DEMO_SLOT_COUNT + 2; clicks += 1) {
      const first = afterAdds(clicks);
      const second = afterAdds(clicks);
      expect(first).not.toBe(second); // 別インスタンスであること（参照の使い回しではない）
      expect(second.slots).toEqual(first.slots);
    }
  });

  it("always targets slots strictly in index order 0..7 and then null", () => {
    function targetSequence(): (number | null)[] {
      let state = createInitialEclipseAttackDemoState();
      const targets: (number | null)[] = [];
      for (let i = 0; i < ECLIPSE_DEMO_SLOT_COUNT + 1; i += 1) {
        targets.push(nextHonestSlotIndex(state));
        state = addAttackerPeer(state);
      }
      return targets;
    }
    const expected = [...Array.from({ length: ECLIPSE_DEMO_SLOT_COUNT }, (_, i) => i), null];
    expect(targetSequence()).toEqual(expected);
    // 2度目・3度目の実行でも同じ順序（乱数・時刻に依存していないこと）。
    expect(targetSequence()).toEqual(expected);
    expect(targetSequence()).toEqual(expected);
  });

  it("keeps every not-yet-taken slot honest at each step (no out-of-order replacement)", () => {
    for (let clicks = 0; clicks <= ECLIPSE_DEMO_SLOT_COUNT; clicks += 1) {
      const state = afterAdds(clicks);
      state.slots.forEach((slot, index) => {
        expect(slot).toBe(index < clicks ? "attacker" : "honest");
      });
    }
  });
});

describe("resetEclipseAttackDemoState: complete re-initialization", () => {
  it("can be driven to a full eclipse again after a reset, twice in a row", () => {
    for (let round = 0; round < 2; round += 1) {
      let state = resetEclipseAttackDemoState();
      expect(attackerCount(state)).toBe(0);
      expect(isFullyEclipsed(state)).toBe(false);
      expect(nextHonestSlotIndex(state)).toBe(0); // 置換順も先頭から再開する
      expect(visibleChainBlockKeys(state)).toBe(REAL_CHAIN_BLOCK_KEYS);

      for (let i = 0; i < ECLIPSE_DEMO_SLOT_COUNT; i += 1) state = addAttackerPeer(state);
      expect(isFullyEclipsed(state)).toBe(true);
      expect(visibleChainBlockKeys(state)).toBe(FAKE_CHAIN_BLOCK_KEYS);
    }
  });

  it("resets from a partially occupied state as well (not only from 8/8)", () => {
    const partial = afterAdds(3);
    expect(attackerCount(partial)).toBe(3);
    const reset = resetEclipseAttackDemoState();
    expect(reset.slots.every((slot) => slot === "honest")).toBe(true);
    // 元の state は共有されず、リセットの影響を受けない（別インスタンス）。
    expect(attackerCount(partial)).toBe(3);
  });

  it("returns a fresh object and a fresh slots array on every call (no shared mutable state)", () => {
    const a = resetEclipseAttackDemoState();
    const b = resetEclipseAttackDemoState();
    expect(a).not.toBe(b);
    expect(a.slots).not.toBe(b.slots);
    expect(a.slots).toEqual(b.slots);
  });
});

describe("defensive behaviour for states the public API cannot produce", () => {
  it("does not mutate a frozen slots array (works on a copy)", () => {
    const frozen = stateOf(
      Object.freeze(Array.from({ length: ECLIPSE_DEMO_SLOT_COUNT }, () => "honest" as const)),
    );
    expect(() => addAttackerPeer(frozen)).not.toThrow();
    const next = addAttackerPeer(frozen);
    expect(next.slots).not.toBe(frozen.slots);
    expect(frozen.slots[0]).toBe("honest");
    expect(next.slots[0]).toBe("attacker");
  });

  it("fills the first honest hole, wherever it is, and leaves later honest slots alone", () => {
    // 「最後の攻撃者スロットの次」ではなく「先頭から見て最初の honest」を
    // 埋めるという契約を、穴あきの state で固定する。
    const holed = stateOf([
      "attacker",
      "honest",
      "attacker",
      "honest",
      "attacker",
      "attacker",
      "attacker",
      "attacker",
    ]);
    expect(nextHonestSlotIndex(holed)).toBe(1);
    const next = addAttackerPeer(holed);
    expect(next.slots[1]).toBe("attacker");
    expect(next.slots[3]).toBe("honest"); // 残る穴は手つかず
    expect(attackerCount(next)).toBe(7);
    expect(isFullyEclipsed(next)).toBe(false);
    expect(visibleChainBlockKeys(next)).toBe(REAL_CHAIN_BLOCK_KEYS);

    const full = addAttackerPeer(next);
    expect(isFullyEclipsed(full)).toBe(true);
  });

  it("treats a single surviving honest slot at the very end as not fully eclipsed", () => {
    const lastHonest = stateOf([
      ...Array.from({ length: ECLIPSE_DEMO_SLOT_COUNT - 1 }, () => "attacker" as const),
      "honest",
    ]);
    expect(attackerCount(lastHonest)).toBe(ECLIPSE_DEMO_SLOT_COUNT - 1);
    expect(isFullyEclipsed(lastHonest)).toBe(false);
    expect(visibleChainBlockKeys(lastHonest)).toBe(REAL_CHAIN_BLOCK_KEYS);
    expect(nextHonestSlotIndex(lastHonest)).toBe(ECLIPSE_DEMO_SLOT_COUNT - 1);
  });

  it("counts only the literal \"attacker\" value and never falsely reports a full eclipse", () => {
    // 型では起こらないが、想定外の値が混ざっても「包囲された」と誤判定
    // しないこと（安全側に倒れること）を固定する。
    const unknownValues = stateOf(
      Array.from({ length: ECLIPSE_DEMO_SLOT_COUNT }, () => "???" as unknown as PeerSlotState),
    );
    expect(attackerCount(unknownValues)).toBe(0);
    expect(occupancyRatio(unknownValues)).toBe(0);
    expect(isFullyEclipsed(unknownValues)).toBe(false);
    expect(visibleChainBlockKeys(unknownValues)).toBe(REAL_CHAIN_BLOCK_KEYS);
    // honest が無いので追加操作は no-op（偽データへは決して切り替わらない）。
    expect(nextHonestSlotIndex(unknownValues)).toBeNull();
    expect(addAttackerPeer(unknownValues)).toBe(unknownValues);
  });

  it("does not report a full eclipse for a degenerate empty-slot state", () => {
    const empty = stateOf([]);
    expect(attackerCount(empty)).toBe(0);
    // 0/0 は NaN。ここで固定したい契約は「NaN であること」自体ではなく、
    // 完全包囲と誤判定せず正規チェーンを見せ続けること（安全側）。
    expect(Number.isNaN(occupancyRatio(empty))).toBe(true);
    expect(isFullyEclipsed(empty)).toBe(false);
    expect(visibleChainBlockKeys(empty)).toBe(REAL_CHAIN_BLOCK_KEYS);
    expect(nextHonestSlotIndex(empty)).toBeNull();
    expect(addAttackerPeer(empty)).toBe(empty);
  });

  it("derives the ratio from the state's own slot count, not from the 8-slot constant", () => {
    // スロット数が将来変わっても導出式が壊れないこと（定数の焼き付けが
    // occupancyRatio に混入していないことの回帰ガード）。
    const tenSlots = stateOf([
      ...Array.from({ length: ECLIPSE_DEMO_SLOT_COUNT }, () => "attacker" as const),
      "honest",
      "honest",
    ]);
    expect(attackerCount(tenSlots)).toBe(ECLIPSE_DEMO_SLOT_COUNT);
    expect(occupancyRatio(tenSlots)).toBe(ECLIPSE_DEMO_SLOT_COUNT / 10);
    expect(isFullyEclipsed(tenSlots)).toBe(false);

    const twoSlots = stateOf(["attacker", "attacker"]);
    expect(occupancyRatio(twoSlots)).toBe(1);
    expect(isFullyEclipsed(twoSlots)).toBe(true);
    expect(visibleChainBlockKeys(twoSlots)).toBe(FAKE_CHAIN_BLOCK_KEYS);
  });
});
