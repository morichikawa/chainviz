// catch-up.ts の純粋ロジック（動的タイムアウト算出・進捗停止検出・待機
// オーケストレーション）のユニットテスト。docker には一切依存しないため
// vitest.unit.config.ts 側（pnpm test）で回る。

import { describe, expect, it } from "vitest";
import {
  CatchUpMonitor,
  catchUpTimeoutMs,
  waitForBlockCatchUp,
} from "./catch-up.js";

describe("catchUpTimeoutMs", () => {
  it("gap が小さくても下限（既定 120s）を下回らない", () => {
    expect(catchUpTimeoutMs({ gap: 0 })).toBe(120_000);
    expect(catchUpTimeoutMs({ gap: 10 })).toBe(120_000);
  });

  it("gap が大きいほど（保守的な速度に基づき）長くなる", () => {
    // gap 1900, 5 ブロック/秒 → 380_000ms のバックフィル + 30_000ms ベース。
    expect(catchUpTimeoutMs({ gap: 1900 })).toBe(410_000);
    // 単調増加。
    expect(catchUpTimeoutMs({ gap: 3000 })).toBeGreaterThan(
      catchUpTimeoutMs({ gap: 1900 }),
    );
  });

  it("負の gap は 0 として扱い下限を返す", () => {
    expect(catchUpTimeoutMs({ gap: -50 })).toBe(120_000);
  });

  it("速度・ベース・下限を指定できる", () => {
    // gap 100, 10 ブロック/秒 → 10_000ms + base 5_000ms = 15_000、下限 1_000。
    expect(
      catchUpTimeoutMs({ gap: 100, ratePerSec: 10, baseMs: 5_000, minMs: 1_000 }),
    ).toBe(15_000);
  });
});

describe("CatchUpMonitor", () => {
  const opts = { overallTimeoutMs: 100_000, stallTimeoutMs: 45_000 };

  it("高さがターゲットに到達したら reached を返す", () => {
    const m = new CatchUpMonitor(100, 0, opts);
    expect(m.observe(1_000, 50).done).toBe(false);
    const d = m.observe(2_000, 100);
    expect(d).toEqual({ done: true, outcome: { kind: "reached", height: 100 } });
  });

  it("ターゲットを超えても reached", () => {
    const m = new CatchUpMonitor(100, 0, opts);
    const d = m.observe(1_000, 130);
    expect(d.done).toBe(true);
    expect(d.done && d.outcome.kind).toBe("reached");
  });

  it("進捗が続く限り done にならない（停止と誤判定しない）", () => {
    const m = new CatchUpMonitor(1_000, 0, opts);
    // 毎回高さが増えているので、時間が経っても停止扱いにならない。
    for (let t = 10_000; t <= 90_000; t += 10_000) {
      const height = t / 100; // 100 → 900 と増加。
      expect(m.observe(t, height).done).toBe(false);
    }
  });

  it("高さが更新されないまま stallTimeoutMs 経つと stalled（#44/#46 の回帰）", () => {
    const m = new CatchUpMonitor(1_000, 0, opts);
    // t=1000 で高さ 0 を観測（初回なので進捗として記録される）。
    expect(m.observe(1_000, 0).done).toBe(false);
    // 以降ずっと 0 のまま。lastProgress=1000 なので 1000+45000=46000 で停止判定。
    expect(m.observe(45_000, 0).done).toBe(false);
    const d = m.observe(46_000, 0);
    expect(d.done).toBe(true);
    expect(d.done && d.outcome.kind).toBe("stalled");
  });

  it("初回観測が遅れても、その待ち時間は停止としてカウントしない", () => {
    const m = new CatchUpMonitor(1_000, 0, opts);
    // 初回観測が t=50_000（stallTimeout=45_000 を超える遅延）でも、初回は
    // 進捗として扱われ即座に停止判定されない。
    expect(m.observe(50_000, 10).done).toBe(false);
  });

  it("進捗はあるが遅すぎて overallTimeoutMs を超えると timeout", () => {
    const m = new CatchUpMonitor(1_000_000, 0, {
      overallTimeoutMs: 100_000,
      stallTimeoutMs: 45_000,
    });
    // 毎回わずかに進捗するので停止にはならないが、ターゲットに全く届かない。
    expect(m.observe(10_000, 1).done).toBe(false);
    expect(m.observe(20_000, 2).done).toBe(false);
    const d = m.observe(100_000, 9);
    expect(d.done).toBe(true);
    expect(d.done && d.outcome.kind).toBe("timeout");
  });
});

describe("waitForBlockCatchUp", () => {
  /** 合成クロック。now() 呼び出しごとに time が進む必要はなく、sleep で進める。 */
  function fakeClock(startMs = 0) {
    let t = startMs;
    return {
      now: () => t,
      sleepFn: async (ms: number) => {
        t += ms;
      },
    };
  }

  it("バックフィルが進んでターゲットに達したらその高さを返す", async () => {
    const clock = fakeClock();
    let height = 100;
    const target = 200;
    const result = await waitForBlockCatchUp(
      async () => {
        const current = height;
        height += 10; // 呼ぶたびに 10 進む。
        return current;
      },
      target,
      {
        intervalMs: 1_000,
        now: clock.now,
        sleepFn: clock.sleepFn,
      },
    );
    expect(result).toBeGreaterThanOrEqual(target);
  });

  it("高さが 0 のまま停止したら stalled として速やかに失敗する", async () => {
    const clock = fakeClock();
    await expect(
      waitForBlockCatchUp(async () => 0, 1_000, {
        intervalMs: 1_000,
        stallTimeoutMs: 45_000,
        now: clock.now,
        sleepFn: clock.sleepFn,
      }),
    ).rejects.toThrow(/停止/);
    // 全体タイムアウト（少なくとも 120s）を待たず、停止検出（45s 前後）で失敗する。
    expect(clock.now()).toBeLessThan(120_000);
  });

  it("開始時の gap から動的にタイムアウトを算出する（長い履歴でも待てる）", async () => {
    const clock = fakeClock();
    // 高さ 0 開始・ターゲット 2000 なら gap 2000 → 120s の下限を大きく超える
    // 全体タイムアウトが確保される。ここでは常に進捗させてターゲット到達を確認。
    let height = 0;
    const result = await waitForBlockCatchUp(
      async () => {
        const current = height;
        height += 5;
        return current;
      },
      2_000,
      {
        intervalMs: 1_000,
        stallTimeoutMs: 45_000,
        now: clock.now,
        sleepFn: clock.sleepFn,
      },
    );
    expect(result).toBeGreaterThanOrEqual(2_000);
    // 固定 120s では到底終わらない（400s 前後かかる）ことを確認。
    expect(clock.now()).toBeGreaterThan(120_000);
  });

  it("RPC が最初は到達不能でも、復帰して追従すれば成功する", async () => {
    const clock = fakeClock();
    let calls = 0;
    let height = 90;
    const result = await waitForBlockCatchUp(
      async () => {
        calls += 1;
        if (calls <= 3) throw new Error("RPC not ready");
        const current = height;
        height += 10;
        return current;
      },
      150,
      {
        intervalMs: 1_000,
        stallTimeoutMs: 45_000,
        now: clock.now,
        sleepFn: clock.sleepFn,
      },
    );
    expect(result).toBeGreaterThanOrEqual(150);
  });
});
