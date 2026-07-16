import type { BlockEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  type BlockCadence,
  computeBlockCadenceProgress,
  deriveBlockCadence,
} from "./blockCadence.js";

/** timestamp（秒）とnumberだけを指定してブロックを作る最小限のヘルパー。 */
function block(number: number, timestampSec: number, hash = `0x${number}`): BlockEntity {
  return {
    kind: "block",
    hash,
    number,
    parentHash: `0x${number - 1}`,
    timestamp: timestampSec,
    receivedAt: {},
  };
}

describe("deriveBlockCadence", () => {
  it("derives interval/anchor from evenly-spaced timestamps", () => {
    const blocks = [block(1, 1_000), block(2, 1_012), block(3, 1_024)];
    const now = 1_024_000 + 1_000; // anchor(1_024_000ms) より少し先の現在時刻
    const cadence = deriveBlockCadence(blocks, now);
    expect(cadence).toEqual({ intervalMs: 12_000, anchorMs: 1_024_000 });
  });

  it("derives the true interval via GCD when an empty slot is mixed in", () => {
    // 1000 -> 1012 (1 slot) -> 1036 (2 slot 分の空き) -> 1048 (1 slot)。
    // 差分 [12, 24, 12] の GCD は 12。
    const blocks = [block(1, 1_000), block(2, 1_012), block(3, 1_036), block(4, 1_048)];
    const now = 1_048_000 + 1_000;
    const cadence = deriveBlockCadence(blocks, now);
    expect(cadence?.intervalMs).toBe(12_000);
    expect(cadence?.anchorMs).toBe(1_048_000);
  });

  it("dedupes duplicate timestamps from same-number fork blocks before diffing", () => {
    // number=2 のフォーク（同一 timestamp、別 hash）が混じっても GCD が崩れない。
    const blocks = [
      block(1, 1_000),
      block(2, 1_012, "0x2a"),
      block(2, 1_012, "0x2b"), // フォーク（同一 number・同一 timestamp・別 hash）
      block(3, 1_024),
    ];
    const now = 1_024_000 + 1_000;
    const cadence = deriveBlockCadence(blocks, now);
    expect(cadence).toEqual({ intervalMs: 12_000, anchorMs: 1_024_000 });
  });

  it("returns null when there are 0 blocks", () => {
    expect(deriveBlockCadence([], 0)).toBeNull();
  });

  it("returns null when there is only 1 block (no diff to derive from)", () => {
    const blocks = [block(1, 1_000)];
    expect(deriveBlockCadence(blocks, 1_000_000)).toBeNull();
  });

  it("returns null when only duplicate-timestamp blocks are observed (0 diffs after dedup)", () => {
    // number は違うが timestamp が同一（フォークの片方だけ違う number を持つ
    // ような、あり得ないはずのデータでも安全側に倒す）。
    const blocks = [block(1, 1_000, "0x1a"), block(2, 1_000, "0x1b")];
    expect(deriveBlockCadence(blocks, 1_000_000)).toBeNull();
  });

  it("returns null for an irregular gap whose derived interval exceeds the 600s ceiling", () => {
    // 唯一の差分が 900 秒（15分）。妥当な slot 間隔として信頼できないため null。
    const blocks = [block(1, 0), block(2, 900)];
    const now = 900_000 + 1_000;
    expect(deriveBlockCadence(blocks, now)).toBeNull();
  });

  it("returns null when the clock-skew guard trips (anchor further in the future than now + interval)", () => {
    const blocks = [block(1, 1_000), block(2, 1_012), block(3, 1_024)];
    // anchorMs(1_024_000) > now(1_000_000) + intervalMs(12_000) となる、
    // ホストの時計がチェーンより大きく遅れているケース。
    const now = 1_000_000;
    expect(deriveBlockCadence(blocks, now)).toBeNull();
  });

  it("does not trip the clock-skew guard when anchor is exactly now + interval", () => {
    const blocks = [block(1, 1_000), block(2, 1_012), block(3, 1_024)];
    // anchorMs(1_024_000) === now + intervalMs(12_000) の境界。ガードは
    // `anchorMs > now + intervalMs` の厳密不等号なので許容される。
    const now = 1_012_000;
    const cadence = deriveBlockCadence(blocks, now);
    expect(cadence).toEqual({ intervalMs: 12_000, anchorMs: 1_024_000 });
  });
});

describe("computeBlockCadenceProgress", () => {
  const cadence: BlockCadence = { intervalMs: 12_000, anchorMs: 100_000 };

  it("returns remainingMs exactly equal to intervalMs when now === anchorMs (elapsed boundary = 0)", () => {
    const progress = computeBlockCadenceProgress(cadence, 100_000);
    expect(progress.remainingMs).toBe(12_000);
    expect(progress.progress).toBe(0);
    expect(progress.stalled).toBe(false);
  });

  it("computes remaining/progress partway through a cycle", () => {
    const progress = computeBlockCadenceProgress(cadence, 100_000 + 5_000);
    expect(progress.remainingMs).toBe(7_000);
    expect(progress.progress).toBeCloseTo(5_000 / 12_000);
  });

  it("wraps into the next cycle via modulo once a full interval has elapsed", () => {
    // 2周期 + 3秒経過 -> elapsed=3000ms、remaining=9000ms（周回しても剰余で
    // 同じ位相に戻る＝カウントダウンが止まらず回り続ける）。
    const progress = computeBlockCadenceProgress(cadence, 100_000 + 12_000 * 2 + 3_000);
    expect(progress.remainingMs).toBe(9_000);
  });

  it("is not stalled exactly at the 3x-interval boundary (strict > only)", () => {
    const progress = computeBlockCadenceProgress(cadence, 100_000 + 12_000 * 3);
    expect(progress.stalled).toBe(false);
  });

  it("is stalled just past the 3x-interval boundary", () => {
    const progress = computeBlockCadenceProgress(cadence, 100_000 + 12_000 * 3 + 1);
    expect(progress.stalled).toBe(true);
  });
});
