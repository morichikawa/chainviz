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

  it("derives a sub-multiple interval via GCD when diffs are not simple multiples of the smallest", () => {
    // timestamps 0, 6, 15, 27 -> 差分 [6, 9, 12]。最小の 6 の倍数関係には
    // なっておらず、GCD(6, 9) = 3, GCD(3, 12) = 3。真の間隔 3 秒を導ける
    // （単純な倍数列でなくても互除法で正しく縮約できることの確認）。
    const blocks = [block(1, 0), block(2, 6), block(3, 15), block(4, 27)];
    const now = 27_000 + 1_000;
    const cadence = deriveBlockCadence(blocks, now);
    expect(cadence).toEqual({ intervalMs: 3_000, anchorMs: 27_000 });
  });

  it("ignores non-positive diffs from an out-of-order timestamp (number-ordered, reorg-like)", () => {
    // number 昇順（1,2,3）に並べると timestamp が 1000 -> 1024 -> 1012 と
    // 逆行する区間を含む。差分は [24, -12] となり、負の差分は捨てられて
    // [24] のみが GCD に使われる。anchor は timestamp 最大ではなく number
    // 最大（block 3 = 1012 秒）で決まる点もあわせて固定する。
    const blocks = [block(1, 1_000), block(2, 1_024), block(3, 1_012)];
    const now = 1_012_000 + 1_000;
    const cadence = deriveBlockCadence(blocks, now);
    expect(cadence).toEqual({ intervalMs: 24_000, anchorMs: 1_012_000 });
  });

  it("accepts an interval exactly at the 600s ceiling", () => {
    // 唯一の差分が 600 秒ちょうど。上限は `> MAX_INTERVAL_SEC` の厳密不等号
    // なので境界値は許容される。
    const blocks = [block(1, 0), block(2, 600)];
    const now = 600_000 + 1_000;
    expect(deriveBlockCadence(blocks, now)).toEqual({
      intervalMs: 600_000,
      anchorMs: 600_000,
    });
  });

  it("returns null just past the 600s ceiling (601s)", () => {
    const blocks = [block(1, 0), block(2, 601)];
    const now = 601_000 + 1_000;
    expect(deriveBlockCadence(blocks, now)).toBeNull();
  });

  it("returns null when many blocks all share a single timestamp (0 diffs after dedup)", () => {
    // 同一 timestamp のブロックが大量に存在しても、重複除去後に差分が1件も
    // 残らないため導出不成立（1件以下と同じ扱い）。
    const blocks = Array.from({ length: 20 }, (_, i) => block(i + 1, 5_000, `0x${i}`));
    expect(deriveBlockCadence(blocks, 5_000_000)).toBeNull();
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

  it("normalizes elapsed into [0, interval) when now is before anchor (clock rewound)", () => {
    // now が anchor より 3 秒過去（ホストの時計が巻き戻った/遅れている）。
    // 生の elapsed は -3000ms だが、剰余を [0, interval) に正規化するため
    // elapsed=9000ms, remaining=3000ms, progress=0.75 になる（負の remaining や
    // NaN を出さない）。停滞判定も負の経過では立たない。
    const progress = computeBlockCadenceProgress(cadence, 100_000 - 3_000);
    expect(progress.remainingMs).toBe(3_000);
    expect(progress.progress).toBeCloseTo(0.75);
    expect(progress.stalled).toBe(false);
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
