import type { BlockEntity } from "@chainviz/shared";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBlockCadence } from "./useBlockCadence.js";

/** timestamp（秒）とnumberだけを指定してブロックを作る最小限のヘルパー。 */
function block(number: number, timestampSec: number): BlockEntity {
  return {
    kind: "block",
    hash: `0x${number}`,
    number,
    parentHash: `0x${number - 1}`,
    timestamp: timestampSec,
    receivedAt: {},
  };
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useBlockCadence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("returns null when derivation is not possible (fewer than 2 blocks)", () => {
    const { result } = renderHook(() => useBlockCadence([block(1, Math.floor(Date.now() / 1000))]));
    expect(result.current).toBeNull();
  });

  it("returns a non-null progress once the block set derives a valid cadence", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const blocks = [block(1, nowSec - 24), block(2, nowSec - 12), block(3, nowSec)];
    const { result } = renderHook(() => useBlockCadence(blocks));
    expect(result.current).not.toBeNull();
    expect(result.current?.remainingMs).toBeGreaterThan(0);
    expect(result.current?.remainingMs).toBeLessThanOrEqual(12_000);
  });

  it("counts down as time advances via the tick timer", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const blocks = [block(1, nowSec - 12), block(2, nowSec)];
    const { result } = renderHook(() => useBlockCadence(blocks));
    const initialRemaining = result.current?.remainingMs ?? 0;

    advance(2_000);
    expect(result.current?.remainingMs).toBeLessThan(initialRemaining);
  });

  it("recomputes derivation when the block set changes and reflects the new anchor", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const initialBlocks = [block(1, nowSec - 12), block(2, nowSec)];
    const { result, rerender } = renderHook(
      ({ blocks }: { blocks: BlockEntity[] }) => useBlockCadence(blocks),
      { initialProps: { blocks: initialBlocks } },
    );
    advance(6_000); // 周期の半分程度が経過。
    const midProgress = result.current?.progress ?? 0;
    expect(midProgress).toBeGreaterThan(0.2);

    // 新しいブロックが「今」到着した体（anchor が現在時刻へ更新される）。
    const nextNowSec = Math.floor(Date.now() / 1000);
    const updatedBlocks = [...initialBlocks, block(3, nextNowSec)];
    rerender({ blocks: updatedBlocks });

    // 新しい anchor 直後（今まさに届いたばかり）なので経過率はほぼ0に戻る
    // （中断せずカウントダウンが回り続けるのではなく、新着で位相がリセット
    // される。ARCHITECTURE.md §10.5 のカウントダウン仕様どおり。derived
    // interval の具体的な値には依存しない、progress の相対比較にする）。
    expect(result.current?.progress ?? 1).toBeLessThan(midProgress);
  });

  it("enters the stalled state after 3x the interval with no new block, then recovers when a fresh block arrives", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const initialBlocks = [block(1, nowSec - 12), block(2, nowSec)];
    const { result, rerender } = renderHook(
      ({ blocks }: { blocks: BlockEntity[] }) => useBlockCadence(blocks),
      { initialProps: { blocks: initialBlocks } },
    );
    expect(result.current?.stalled).toBe(false);

    // interval(12s) の3倍を少し超えて新ブロックが来ないと停滞状態に入る。
    advance(12_000 * 3 + 1_000);
    expect(result.current?.stalled).toBe(true);

    // 新しいブロックが「今」到着すると、cadence 変化直後の即時 setNow により
    // tick を待たずに停滞が解消され、カウントダウンが再開する。
    const freshBlocks = [...initialBlocks, block(3, Math.floor(Date.now() / 1000))];
    rerender({ blocks: freshBlocks });
    expect(result.current?.stalled).toBe(false);
    expect(result.current?.remainingMs).toBeGreaterThan(0);
  });

  it("immediately syncs `now` to the fresh anchor when cadence first becomes derivable (no tick was running while null)", () => {
    // 導出不成立（1件）の間は tick タイマーが起動しないため、内部の `now` は
    // マウント時刻のまま据え置かれる。時間が経ってから有効なブロック集合が
    // 届いたとき、即時 setNow が無いと `now`（マウント時刻）が新 anchor
    // （現在時刻）を大きく下回り、剰余正規化で progress が周期の末尾へ飛ぶ。
    // 即時 setNow により now が anchor へ揃い progress はほぼ 0 に戻る。
    const nowSec = Math.floor(Date.now() / 1000);
    const { result, rerender } = renderHook(
      ({ blocks }: { blocks: BlockEntity[] }) => useBlockCadence(blocks),
      { initialProps: { blocks: [block(1, nowSec)] as BlockEntity[] } },
    );
    expect(result.current).toBeNull();

    // cadence が null の間はタイマーが無いので、この 5 秒の間 `now` は進まない。
    advance(5_000);

    const freshSec = Math.floor(Date.now() / 1000);
    rerender({ blocks: [block(1, freshSec - 12), block(2, freshSec)] });
    expect(result.current).not.toBeNull();
    expect(result.current?.progress ?? 1).toBeLessThan(0.1);
    expect(result.current?.remainingMs).toBeGreaterThan(11_000);
  });

  it("stops updating (no throw) once unmounted mid-countdown", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const blocks = [block(1, nowSec - 12), block(2, nowSec)];
    const { unmount } = renderHook(() => useBlockCadence(blocks));
    expect(() => {
      unmount();
      advance(5_000);
    }).not.toThrow();
  });
});
