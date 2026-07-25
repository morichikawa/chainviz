// Issue #420 テスト強化: VcMetricsTracker の累積カウンタ差分計算の境界値・
// 異常系を固定する。基本動作（初回ベースライン・単純な増分・リセット・
// forgetNode）は vc-metrics-tracker.test.ts が持つので、ここは
// 「VC プロセス再起動でカウンタが 0 に戻った」「所要時間の累積だけが
// 巻き戻った」「あるスクレイプで method が消えた」といった、実装コメントが
// 想定していても既存テストが触れていない遷移だけを扱う（1ファイル1責務）。

import { describe, expect, it } from "vitest";
import { VcMetricsTracker } from "./vc-metrics-tracker.js";

const PROPOSAL = "vc_signed_beacon_blocks_total:success";
const ATTESTATION = "vc_signed_attestations_total:success";

describe("VcMetricsTracker: counter reset boundaries", () => {
  it("emits nothing when the counter resets exactly to 0 (restart before any duty)", () => {
    // リセット扱いの増分は「今回値そのもの」なので 0 になる。増分ゼロは
    // 配信しないため、再起動直後の空の観測でパルスを出してはいけない。
    const tracker = new VcMetricsTracker();
    tracker.observe("validator1", [{ method: ATTESTATION, count: 40 }]);
    expect(
      tracker.observe("validator1", [{ method: ATTESTATION, count: 0 }]),
    ).toEqual([]);
  });

  it("uses the current sum as the delta when the counter resets (not a negative sum delta)", () => {
    const tracker = new VcMetricsTracker();
    tracker.observe("validator1", [
      { method: PROPOSAL, count: 10, sumSeconds: 1 },
    ]);
    // 再起動後: count/sumSeconds ともに巻き戻る。0.4s / 2 回 = 200ms。
    expect(
      tracker.observe("validator1", [
        { method: PROPOSAL, count: 2, sumSeconds: 0.4 },
      ]),
    ).toEqual([{ method: PROPOSAL, count: 2, latencyMs: 200 }]);
  });

  it("recovers normal delta calculation on the poll after a reset", () => {
    const tracker = new VcMetricsTracker();
    tracker.observe("validator1", [{ method: ATTESTATION, count: 40 }]);
    tracker.observe("validator1", [{ method: ATTESTATION, count: 2 }]);
    expect(
      tracker.observe("validator1", [{ method: ATTESTATION, count: 5 }]),
    ).toEqual([{ method: ATTESTATION, count: 3 }]);
  });

  it("treats a single-step reset (previous 1 -> current 0) as no activity", () => {
    const tracker = new VcMetricsTracker();
    tracker.observe("validator1", [{ method: PROPOSAL, count: 1 }]);
    expect(
      tracker.observe("validator1", [{ method: PROPOSAL, count: 0 }]),
    ).toEqual([]);
  });

  it("never emits a negative count for any reset shape", () => {
    const tracker = new VcMetricsTracker();
    tracker.observe("validator1", [{ method: ATTESTATION, count: 1_000 }]);
    for (const count of [999, 500, 1, 0]) {
      const result = tracker.observe("validator1", [
        { method: ATTESTATION, count },
      ]);
      for (const stat of result) expect(stat.count).toBeGreaterThan(0);
    }
  });
});

describe("VcMetricsTracker: latency edge cases", () => {
  it("omits latencyMs when the sum decreased while the counter increased", () => {
    // カウンタは進んだが所要時間の累積だけが巻き戻る（メトリクス側の乱れ）。
    // 負の平均を配信しないこと。
    const tracker = new VcMetricsTracker();
    tracker.observe("validator1", [
      { method: PROPOSAL, count: 10, sumSeconds: 1 },
    ]);
    expect(
      tracker.observe("validator1", [
        { method: PROPOSAL, count: 12, sumSeconds: 0.5 },
      ]),
    ).toEqual([{ method: PROPOSAL, count: 2 }]);
  });

  it("emits latencyMs 0 when the sum did not move at all", () => {
    // 所要時間が測定できないほど短かった場合（sum が変わらない）。0 は
    // 「観測できなかった」ではなく「ほぼ0秒」であり、省略と区別する。
    const tracker = new VcMetricsTracker();
    tracker.observe("validator1", [
      { method: ATTESTATION, count: 1, sumSeconds: 0.5 },
    ]);
    expect(
      tracker.observe("validator1", [
        { method: ATTESTATION, count: 3, sumSeconds: 0.5 },
      ]),
    ).toEqual([{ method: ATTESTATION, count: 2, latencyMs: 0 }]);
  });

  it("omits latencyMs when the sum disappears after having been observed", () => {
    // 既存テストは「前回だけ欠けている」ケースを固定しているので、逆順
    // （前回はあったが今回欠けた）を固定する。
    const tracker = new VcMetricsTracker();
    tracker.observe("validator1", [
      { method: ATTESTATION, count: 1, sumSeconds: 0.5 },
    ]);
    expect(
      tracker.observe("validator1", [{ method: ATTESTATION, count: 3 }]),
    ).toEqual([{ method: ATTESTATION, count: 2 }]);
  });

  it("averages the sum delta over the count delta (not per poll)", () => {
    const tracker = new VcMetricsTracker();
    tracker.observe("validator1", [
      { method: ATTESTATION, count: 0, sumSeconds: 0 },
    ]);
    // 0.4s / 4 回 = 100ms。1 観測あたりではなく 1 呼び出しあたりの平均。
    expect(
      tracker.observe("validator1", [
        { method: ATTESTATION, count: 4, sumSeconds: 0.4 },
      ]),
    ).toEqual([{ method: ATTESTATION, count: 4, latencyMs: 100 }]);
  });
});

describe("VcMetricsTracker: methods appearing and disappearing", () => {
  it("keeps the baseline for a method that is absent from one poll", () => {
    // status 別カウンタは「まだ一度も起きていない status」の行がそもそも
    // 出力されない。ある method が一時的に消えても前回値は保持され、
    // 再登場時は保持済みのベースラインからの増分になる。
    const tracker = new VcMetricsTracker();
    tracker.observe("validator1", [{ method: PROPOSAL, count: 10 }]);
    expect(tracker.observe("validator1", [])).toEqual([]);
    expect(
      tracker.observe("validator1", [{ method: PROPOSAL, count: 12 }]),
    ).toEqual([{ method: PROPOSAL, count: 2 }]);
  });

  it("treats a newly appearing status as a fresh baseline (no burst on first sight)", () => {
    // 正常運用では success だけが出力される。異常時に slashable が初めて
    // 現れたとき、その累積値をそのまま増分として配信してはいけない。
    const tracker = new VcMetricsTracker();
    tracker.observe("validator1", [{ method: PROPOSAL, count: 10 }]);
    const result = tracker.observe("validator1", [
      { method: PROPOSAL, count: 11 },
      { method: "vc_signed_beacon_blocks_total:slashable", count: 3 },
    ]);
    expect(result).toEqual([{ method: PROPOSAL, count: 1 }]);
  });

  it("tracks the same metric family under different status labels independently", () => {
    const tracker = new VcMetricsTracker();
    tracker.observe("validator1", [
      { method: PROPOSAL, count: 10 },
      { method: "vc_signed_beacon_blocks_total:slashable", count: 1 },
    ]);
    expect(
      tracker.observe("validator1", [
        { method: PROPOSAL, count: 12 },
        { method: "vc_signed_beacon_blocks_total:slashable", count: 2 },
      ]),
    ).toEqual([
      { method: PROPOSAL, count: 2 },
      { method: "vc_signed_beacon_blocks_total:slashable", count: 1 },
    ]);
  });

  it("returns an empty array for an empty observation without creating spurious state", () => {
    const tracker = new VcMetricsTracker();
    expect(tracker.observe("validator1", [])).toEqual([]);
    // 空の観測はベースラインを作らないので、次の観測が初回扱いになる。
    expect(
      tracker.observe("validator1", [{ method: ATTESTATION, count: 5 }]),
    ).toEqual([]);
    expect(
      tracker.observe("validator1", [{ method: ATTESTATION, count: 6 }]),
    ).toEqual([{ method: ATTESTATION, count: 1 }]);
  });
});

describe("VcMetricsTracker: forgetNode", () => {
  it("is a no-op for a node that was never observed", () => {
    const tracker = new VcMetricsTracker();
    expect(() => tracker.forgetNode("chainviz-ethereum/validator9")).not.toThrow();
  });

  it("does not disturb the baselines of other nodes", () => {
    const tracker = new VcMetricsTracker();
    tracker.observe("validator1", [{ method: ATTESTATION, count: 10 }]);
    tracker.observe("validator2", [{ method: ATTESTATION, count: 20 }]);
    tracker.forgetNode("validator1");
    expect(
      tracker.observe("validator2", [{ method: ATTESTATION, count: 21 }]),
    ).toEqual([{ method: ATTESTATION, count: 1 }]);
    // validator1 側だけがベースラインを失っている。
    expect(
      tracker.observe("validator1", [{ method: ATTESTATION, count: 11 }]),
    ).toEqual([]);
  });

  it("can be called twice for the same node", () => {
    const tracker = new VcMetricsTracker();
    tracker.observe("validator1", [{ method: ATTESTATION, count: 10 }]);
    tracker.forgetNode("validator1");
    expect(() => tracker.forgetNode("validator1")).not.toThrow();
  });
});
