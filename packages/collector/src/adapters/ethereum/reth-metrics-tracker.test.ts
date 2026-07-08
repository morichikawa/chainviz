import { describe, expect, it } from "vitest";
import { RethMetricsTracker } from "./reth-metrics-tracker.js";

describe("RethMetricsTracker", () => {
  it("does not emit anything on the first observation (baseline only)", () => {
    // collector 起動時点でノードが既に稼働していた場合、累積値をそのまま
    // 「この1回の増分」として誤配信しないための挙動。
    const tracker = new RethMetricsTracker();
    const result = tracker.observe("node-a", [
      { method: "engine_newPayloadV4", count: 21, sumSeconds: 0.05 },
    ]);
    expect(result).toEqual([]);
  });

  it("emits the delta count on the second observation", () => {
    const tracker = new RethMetricsTracker();
    tracker.observe("node-a", [{ method: "engine_newPayloadV4", count: 21 }]);
    const result = tracker.observe("node-a", [
      { method: "engine_newPayloadV4", count: 23 },
    ]);
    expect(result).toEqual([{ method: "engine_newPayloadV4", count: 2 }]);
  });

  it("computes latencyMs from the delta of sumSeconds over the delta count", () => {
    const tracker = new RethMetricsTracker();
    tracker.observe("node-a", [
      { method: "engine_newPayloadV4", count: 21, sumSeconds: 0.02 },
    ]);
    const result = tracker.observe("node-a", [
      { method: "engine_newPayloadV4", count: 23, sumSeconds: 0.024 },
    ]);
    // delta sum = 0.004s over 2 calls => 0.002s/call => 2ms
    expect(result).toEqual([
      { method: "engine_newPayloadV4", count: 2, latencyMs: 2 },
    ]);
  });

  it("omits latencyMs when sumSeconds was absent on either observation", () => {
    const tracker = new RethMetricsTracker();
    tracker.observe("node-a", [{ method: "engine_newPayloadV4", count: 21 }]);
    const result = tracker.observe("node-a", [
      { method: "engine_newPayloadV4", count: 23, sumSeconds: 0.02 },
    ]);
    expect(result).toEqual([{ method: "engine_newPayloadV4", count: 2 }]);
  });

  it("does not emit a method whose count is unchanged", () => {
    const tracker = new RethMetricsTracker();
    tracker.observe("node-a", [{ method: "engine_newPayloadV4", count: 21 }]);
    const result = tracker.observe("node-a", [
      { method: "engine_newPayloadV4", count: 21 },
    ]);
    expect(result).toEqual([]);
  });

  it("treats a counter reset (current < previous) as the increment being the current value", () => {
    const tracker = new RethMetricsTracker();
    tracker.observe("node-a", [{ method: "engine_newPayloadV4", count: 100 }]);
    // ノード再起動でカウンタが 0 に戻った直後、5 回呼ばれた状態で観測。
    const result = tracker.observe("node-a", [
      { method: "engine_newPayloadV4", count: 5 },
    ]);
    expect(result).toEqual([{ method: "engine_newPayloadV4", count: 5 }]);
  });

  it("treats a counter reset's sumSeconds as the current value too (no negative latency)", () => {
    const tracker = new RethMetricsTracker();
    tracker.observe("node-a", [
      { method: "engine_newPayloadV4", count: 100, sumSeconds: 5 },
    ]);
    const result = tracker.observe("node-a", [
      { method: "engine_newPayloadV4", count: 5, sumSeconds: 0.01 },
    ]);
    expect(result).toEqual([
      { method: "engine_newPayloadV4", count: 5, latencyMs: 2 },
    ]);
  });

  it("tracks multiple nodes independently", () => {
    const tracker = new RethMetricsTracker();
    tracker.observe("node-a", [{ method: "engine_newPayloadV4", count: 10 }]);
    tracker.observe("node-b", [{ method: "engine_newPayloadV4", count: 100 }]);
    const resultA = tracker.observe("node-a", [
      { method: "engine_newPayloadV4", count: 12 },
    ]);
    const resultB = tracker.observe("node-b", [
      { method: "engine_newPayloadV4", count: 101 },
    ]);
    expect(resultA).toEqual([{ method: "engine_newPayloadV4", count: 2 }]);
    expect(resultB).toEqual([{ method: "engine_newPayloadV4", count: 1 }]);
  });

  it("tracks multiple methods independently for the same node", () => {
    const tracker = new RethMetricsTracker();
    tracker.observe("node-a", [
      { method: "engine_newPayloadV4", count: 10 },
      { method: "engine_forkchoiceUpdatedV3", count: 20 },
    ]);
    const result = tracker.observe("node-a", [
      { method: "engine_newPayloadV4", count: 11 },
      { method: "engine_forkchoiceUpdatedV3", count: 25 },
    ]);
    expect(result).toEqual(
      expect.arrayContaining([
        { method: "engine_newPayloadV4", count: 1 },
        { method: "engine_forkchoiceUpdatedV3", count: 5 },
      ]),
    );
  });

  it("forgetNode makes the next observation for that node a fresh baseline", () => {
    const tracker = new RethMetricsTracker();
    tracker.observe("node-a", [{ method: "engine_newPayloadV4", count: 10 }]);
    tracker.forgetNode("node-a");
    const result = tracker.observe("node-a", [
      { method: "engine_newPayloadV4", count: 999 },
    ]);
    expect(result).toEqual([]);
  });

  it("returns an empty array when there are no counters to observe", () => {
    const tracker = new RethMetricsTracker();
    expect(tracker.observe("node-a", [])).toEqual([]);
  });

  it("treats a method first seen on a later poll as its own baseline", () => {
    // 2 回目のポーリングで初めて現れたメソッド(例: そのバージョンの Engine API が
    // 初めて呼ばれた)は、そのメソッドにとっての初回観測なので出力しない。
    const tracker = new RethMetricsTracker();
    tracker.observe("node-a", [{ method: "engine_newPayloadV4", count: 10 }]);
    const result = tracker.observe("node-a", [
      { method: "engine_newPayloadV4", count: 12 },
      { method: "engine_forkchoiceUpdatedV3", count: 8 },
    ]);
    expect(result).toEqual([{ method: "engine_newPayloadV4", count: 2 }]);
  });

  it("retains a method's baseline across a poll in which it is absent", () => {
    // あるスクレイプでメソッドのサンプルが一時的に欠けても、前回値は破棄せず
    // 保持する。再び現れたときは保持したベースラインからの差分を出す
    // (欠測を新規ベースラインと誤認して増分を取りこぼさない)。
    const tracker = new RethMetricsTracker();
    tracker.observe("node-a", [{ method: "engine_newPayloadV4", count: 10 }]);
    tracker.observe("node-a", []); // このスクレイプではメソッドが欠測。
    const result = tracker.observe("node-a", [
      { method: "engine_newPayloadV4", count: 15 },
    ]);
    expect(result).toEqual([{ method: "engine_newPayloadV4", count: 5 }]);
  });

  it("emits nothing when a reset lands exactly on zero", () => {
    // 再起動直後にまだ 1 度も呼ばれていない(count=0)場合、増分ゼロなので出さない。
    const tracker = new RethMetricsTracker();
    tracker.observe("node-a", [{ method: "engine_newPayloadV4", count: 100 }]);
    const result = tracker.observe("node-a", [
      { method: "engine_newPayloadV4", count: 0 },
    ]);
    expect(result).toEqual([]);
  });

  it("omits latencyMs when sumSeconds decreased while the count increased", () => {
    // カウンタは増えたのに sumSeconds が減る(負の区間所要時間)矛盾した観測では、
    // 負のレイテンシを配信せず latencyMs を省く。
    const tracker = new RethMetricsTracker();
    tracker.observe("node-a", [
      { method: "engine_newPayloadV4", count: 10, sumSeconds: 5 },
    ]);
    const result = tracker.observe("node-a", [
      { method: "engine_newPayloadV4", count: 12, sumSeconds: 4 },
    ]);
    expect(result).toEqual([{ method: "engine_newPayloadV4", count: 2 }]);
  });

  it("omits latencyMs when sumSeconds was present before but absent now", () => {
    // 既存テストの逆向き(前回あり・今回なし)。どちらか欠ければ区間平均は出せない。
    const tracker = new RethMetricsTracker();
    tracker.observe("node-a", [
      { method: "engine_newPayloadV4", count: 10, sumSeconds: 5 },
    ]);
    const result = tracker.observe("node-a", [
      { method: "engine_newPayloadV4", count: 12 },
    ]);
    expect(result).toEqual([{ method: "engine_newPayloadV4", count: 2 }]);
  });

  it("accumulates deltas correctly across three consecutive polls", () => {
    const tracker = new RethMetricsTracker();
    tracker.observe("node-a", [{ method: "engine_newPayloadV4", count: 10 }]);
    const second = tracker.observe("node-a", [
      { method: "engine_newPayloadV4", count: 13 },
    ]);
    const third = tracker.observe("node-a", [
      { method: "engine_newPayloadV4", count: 20 },
    ]);
    expect(second).toEqual([{ method: "engine_newPayloadV4", count: 3 }]);
    expect(third).toEqual([{ method: "engine_newPayloadV4", count: 7 }]);
  });
});
