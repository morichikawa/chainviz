// Issue #229: resolveCatchUpTarget / waitForMinBlockProgress の異常系・境界値・
// 退化ケースに関心を絞ったテスト。
//
// catch-up-min-progress.unit.test.ts が正常系（head が遠い/近い、ちょうど
// 境界、停止で失敗）を扱うのに対し、こちらは「実装が暗黙に仮定している前提が
// 崩れたときにどうなるか」を特性化する（CLAUDE.md: テストファイルも関心事
// ごとに分割する）。具体的には:
//   - resolveCatchUpTarget の退化入力（minProgressBlocks が 0/負、headHeight が
//     startHeight 以下など、target が startHeight 以下になるケース）
//   - waitForMinBlockProgress で target <= startHeight になると初回観測で即時
//     成功し、停止検出（回帰検出）が働かなくなること（前提が崩れた際の挙動）
//   - 停止検出（#44/#46 相当の回帰）の検出力を、高さ 0 固定以外の現実的な
//     停止パターン（非ゼロ高さで固定、途中まで進んでから凍結、head
//     フォールバック時）でも確認する
//   - RPC が最後まで到達不能な場合にハングせずタイムアウトで失敗すること

import { describe, expect, it } from "vitest";
import { resolveCatchUpTarget, waitForMinBlockProgress } from "./catch-up.js";

/** 合成クロック。catch-up.unit.test.ts と同じパターン。 */
function fakeClock(startMs = 0) {
  let t = startMs;
  return {
    now: () => t,
    sleepFn: async (ms: number) => {
      t += ms;
    },
  };
}

describe("resolveCatchUpTarget（退化・異常入力）", () => {
  it("headHeight が startHeight より小さい（異常観測）なら target は headHeight に丸められる", () => {
    // 追加ノードの開始高さより head の観測値が小さい（測定タイミングのずれ等）
    // 場合、min により target = headHeight（< startHeight）になる。この場合
    // 待機側では初回観測で即座に到達扱いになる（下の waitForMinBlockProgress
    // のテストで確認）。
    expect(
      resolveCatchUpTarget({
        startHeight: 500,
        headHeight: 300,
        minProgressBlocks: 300,
      }),
    ).toBe(300);
  });

  it("headHeight が startHeight と等しいなら target は startHeight（進行量ゼロ）", () => {
    expect(
      resolveCatchUpTarget({
        startHeight: 400,
        headHeight: 400,
        minProgressBlocks: 300,
      }),
    ).toBe(400);
  });

  it("minProgressBlocks=0 なら target は min(headHeight, startHeight)（進行を全く要求しない）", () => {
    // 退化: startHeight <= headHeight のとき target = startHeight となり、
    // 「1 ブロックも進まなくても合格」になる。回帰検出力を失う設定であることの
    // 特性化。
    expect(
      resolveCatchUpTarget({
        startHeight: 100,
        headHeight: 9285,
        minProgressBlocks: 0,
      }),
    ).toBe(100);
  });

  it("minProgressBlocks が負なら target は startHeight を下回る", () => {
    expect(
      resolveCatchUpTarget({
        startHeight: 100,
        headHeight: 9285,
        minProgressBlocks: -50,
      }),
    ).toBe(50);
  });

  it("minProgressBlocks が巨大でも target は headHeight で頭打ち", () => {
    expect(
      resolveCatchUpTarget({
        startHeight: 0,
        headHeight: 9285,
        minProgressBlocks: 1_000_000,
      }),
    ).toBe(9285);
  });

  it("startHeight+minProgressBlocks がちょうど headHeight に一致するとその値を返す", () => {
    // min の両辺が等しい境界。startHeight!=0 でも成立する。
    expect(
      resolveCatchUpTarget({
        startHeight: 95,
        headHeight: 395,
        minProgressBlocks: 300,
      }),
    ).toBe(395);
  });
});

describe("waitForMinBlockProgress（target <= startHeight の退化ケース）", () => {
  // これらは「退化した設定では停止検出が働かず即時成功してしまう」ことを
  // 明文化するための特性化テスト。実運用の MIN_PROGRESS_BLOCKS=300 では
  // 起きないが、0/負や headHeight <= startHeight を渡すと回帰検出力を失う
  // という前提の可視化。

  it("minProgressBlocks=0 だと、高さが完全停止していても停止検出されず即座に成功する", async () => {
    const clock = fakeClock();
    // 高さは 100 で完全に固定（本来なら #44/#46 の回帰として検出したい状態）。
    const result = await waitForMinBlockProgress(async () => 100, {
      minProgressBlocks: 0,
      headHeight: 9285,
      intervalMs: 1_000,
      stallTimeoutMs: 45_000,
      now: clock.now,
      sleepFn: clock.sleepFn,
    });
    // target = min(9285, 100) = 100。初回観測 100 >= 100 で到達扱い。
    expect(result).toBe(100);
    // 停止検出（45 秒）を待たずに即時成功してしまう（＝検出力を失っている）。
    expect(clock.now()).toBeLessThan(45_000);
  });

  it("minProgressBlocks が負だと、進行なしでも現在高さで即時成功する", async () => {
    const clock = fakeClock();
    const result = await waitForMinBlockProgress(async () => 100, {
      minProgressBlocks: -50,
      headHeight: 9285,
      intervalMs: 1_000,
      stallTimeoutMs: 45_000,
      now: clock.now,
      sleepFn: clock.sleepFn,
    });
    // target = 50 だが観測高さ 100 >= 50 で即時到達。
    expect(result).toBe(100);
    expect(clock.now()).toBeLessThan(45_000);
  });

  it("headHeight が startHeight より小さい異常観測でも即時成功する（target が headHeight に丸められるため）", async () => {
    const clock = fakeClock();
    const result = await waitForMinBlockProgress(async () => 500, {
      minProgressBlocks: 300,
      headHeight: 300, // 開始高さ 500 より低い head。
      intervalMs: 1_000,
      stallTimeoutMs: 45_000,
      now: clock.now,
      sleepFn: clock.sleepFn,
    });
    expect(result).toBe(500);
    expect(clock.now()).toBeLessThan(45_000);
  });
});

describe("waitForMinBlockProgress（停止検出の回帰検出力）", () => {
  it("非ゼロの高さで完全固定（head をオプティミスティックに渡されるが履歴を埋められない状態）でも停止検出で失敗する", async () => {
    const clock = fakeClock();
    // EL 間 P2P 回帰の現実的な現れ方: 追加ノードが head を渡されて低い高さで
    // 止まる。高さ 0 固定（既存テスト）だけでなく非ゼロ固定でも捕まえられる
    // ことを確認する。
    await expect(
      waitForMinBlockProgress(async () => 95, {
        minProgressBlocks: 300,
        headHeight: 9285,
        intervalMs: 1_000,
        stallTimeoutMs: 45_000,
        now: clock.now,
        sleepFn: clock.sleepFn,
      }),
    ).rejects.toThrow(/停止/);
    // target(=395) や head までの動的タイムアウトを待たず停止検出で失敗する。
    expect(clock.now()).toBeLessThan(60_000);
  });

  it("途中まで進んでから凍結する（部分バックフィル後に停止）場合も停止検出で失敗する", async () => {
    const clock = fakeClock();
    // 0 → 50 → 100 と進んだ後、100 のまま凍結。停止判定は「これまでの最大
    // 高さが更新されない時間」で行うため、進行後の凍結も捕捉できる。
    let step = 0;
    const heights = [0, 50, 100];
    await expect(
      waitForMinBlockProgress(
        async () => (step < heights.length ? heights[step++] : 100),
        {
          minProgressBlocks: 300,
          headHeight: 9285,
          intervalMs: 1_000,
          stallTimeoutMs: 45_000,
          now: clock.now,
          sleepFn: clock.sleepFn,
        },
      ),
    ).rejects.toThrow(/停止/);
    expect(clock.now()).toBeLessThan(60_000);
  });

  it("head フォールバック時（head が近い）でも、高さ 0 固定なら停止検出で失敗する", async () => {
    const clock = fakeClock();
    // head までの距離が minProgressBlocks 未満なので target は head(=40) に
    // フォールバックするが、高さ 0 のまま完全停止なら停止検出は働く。
    await expect(
      waitForMinBlockProgress(async () => 0, {
        minProgressBlocks: 300,
        headHeight: 40,
        intervalMs: 1_000,
        stallTimeoutMs: 45_000,
        now: clock.now,
        sleepFn: clock.sleepFn,
      }),
    ).rejects.toThrow(/停止/);
    expect(clock.now()).toBeLessThan(60_000);
  });
});

describe("waitForMinBlockProgress（RPC 到達不能）", () => {
  it("getHeight が最後まで例外を投げ続けると、ハングせず全体タイムアウトで失敗する", async () => {
    const clock = fakeClock();
    // startHeight 測定も含め getHeight が常に失敗する。startHeight は 0 に
    // フォールバックし、target = min(9285, 300) = 300。以降も観測できないため
    // 停止判定には数えず、全体タイムアウト（gap 300 → 下限 120 秒）で失敗する。
    await expect(
      waitForMinBlockProgress(
        async () => {
          throw new Error("RPC not ready");
        },
        {
          minProgressBlocks: 300,
          headHeight: 9285,
          intervalMs: 1_000,
          now: clock.now,
          sleepFn: clock.sleepFn,
        },
      ),
    ).rejects.toThrow(/RPC 到達不能/);
    // 無限ループにならず、有限時間（全体タイムアウト 120 秒前後）で終わる。
    expect(clock.now()).toBeGreaterThanOrEqual(120_000);
  });
});
