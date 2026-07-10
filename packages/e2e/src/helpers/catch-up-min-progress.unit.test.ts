// Issue #229: PROTO-CMD-01 の新しい合格条件（「head への完全追従」ではなく
// 「開始高さから一定ブロック数以上、停滞なく進行すること」）を支える
// resolveCatchUpTarget / waitForMinBlockProgress のユニットテスト。
//
// catch-up.unit.test.ts が既存の catchUpTimeoutMs / CatchUpMonitor /
// waitForBlockCatchUp（「target への到達」という元々の合格条件）を扱うのに
// 対し、こちらは「head までの距離に応じて目標を決める」新しいロジックに関心を
// 絞っている（CLAUDE.md: テストファイルも関心事ごとに分割する）。

import { describe, expect, it } from "vitest";
import { resolveCatchUpTarget, waitForMinBlockProgress } from "./catch-up.js";

describe("resolveCatchUpTarget", () => {
  it("head までの距離が minProgressBlocks 以上なら、開始高さ+進行量を目標にする（head 到達は要求しない）", () => {
    // 長時間稼働スタックを想定: head が大きく先にあっても、目標は
    // startHeight + minProgressBlocks に留まる（Issue #229 の核心）。
    expect(
      resolveCatchUpTarget({
        startHeight: 0,
        headHeight: 9285,
        minProgressBlocks: 300,
      }),
    ).toBe(300);
  });

  it("head までの距離が minProgressBlocks 未満なら、目標は head そのものにフォールバックする", () => {
    // チェーンがまだ十分育っていない場合は従来どおり head 到達を目標にする
    // （この場合は EL 間 P2P の回帰を確実に検出できる保証はない。既存の
    // 前提であり本変更で新たに生じた制約ではない）。
    expect(
      resolveCatchUpTarget({
        startHeight: 0,
        headHeight: 50,
        minProgressBlocks: 300,
      }),
    ).toBe(50);
  });

  it("startHeight が既に head に近い場合も、目標が head を超えない", () => {
    expect(
      resolveCatchUpTarget({
        startHeight: 40,
        headHeight: 50,
        minProgressBlocks: 300,
      }),
    ).toBe(50);
  });

  it("startHeight が 0 でなくても境界どおりに動く（ちょうど minProgressBlocks 分の距離）", () => {
    expect(
      resolveCatchUpTarget({
        startHeight: 100,
        headHeight: 400,
        minProgressBlocks: 300,
      }),
    ).toBe(400);
    expect(
      resolveCatchUpTarget({
        startHeight: 100,
        headHeight: 401,
        minProgressBlocks: 300,
      }),
    ).toBe(400);
  });
});

describe("waitForMinBlockProgress", () => {
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

  it("長時間稼働スタック相当（head が遠い）でも、minProgressBlocks 分進めば成功する", async () => {
    const clock = fakeClock();
    // head は 9285 (実測データ相当) だが、目標は開始高さ 0 + 300 のはずなので
    // 300 に達した時点で完了する（head まで待たない）。
    let height = 0;
    const result = await waitForMinBlockProgress(
      async () => {
        const current = height;
        height += 10; // 実測に近い速度（10 ブロック/秒相当）で進む。
        return current;
      },
      {
        minProgressBlocks: 300,
        headHeight: 9285,
        intervalMs: 1_000,
        now: clock.now,
        sleepFn: clock.sleepFn,
      },
    );
    expect(result).toBeGreaterThanOrEqual(300);
    // head(9285) まで進んでいたら 900 秒超かかるはずなので、そこまで待たずに
    // 終わったことを確認する（固定進行量が効いていることの裏取り）。
    expect(clock.now()).toBeLessThan(60_000);
  });

  it("head までの距離が minProgressBlocks 未満なら head 到達で成功する", async () => {
    const clock = fakeClock();
    let height = 0;
    const result = await waitForMinBlockProgress(
      async () => {
        const current = height;
        height += 5;
        return current;
      },
      {
        minProgressBlocks: 300,
        headHeight: 40,
        intervalMs: 1_000,
        now: clock.now,
        sleepFn: clock.sleepFn,
      },
    );
    expect(result).toBeGreaterThanOrEqual(40);
  });

  it("高さが停止したままだと、目標に関わらず stall 検出で速やかに失敗する（#44/#46 の回帰検出力を維持）", async () => {
    const clock = fakeClock();
    await expect(
      waitForMinBlockProgress(async () => 0, {
        minProgressBlocks: 300,
        headHeight: 9285,
        intervalMs: 1_000,
        stallTimeoutMs: 45_000,
        now: clock.now,
        sleepFn: clock.sleepFn,
      }),
    ).rejects.toThrow(/停止/);
    // 300 ブロック分・あるいは head までの動的タイムアウトを待たず、
    // stall 検出（45 秒前後）で失敗すること。
    expect(clock.now()).toBeLessThan(60_000);
  });
});
