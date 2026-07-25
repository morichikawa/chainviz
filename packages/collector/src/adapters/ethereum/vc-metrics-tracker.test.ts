import { describe, expect, it } from "vitest";
import { VcMetricsTracker } from "./vc-metrics-tracker.js";

// アルゴリズム自体は reth-metrics-tracker.test.ts の RethMetricsTracker と
// 同一（Prometheus カウンタの差分計算という共通ロジック）なので、ここでは
// VC 固有の method 名（"vc_signed_..._total:status" 形式）を使った基本動作の
// 確認に絞る。網羅的な境界値ケースは reth 側で既に固定済み。

describe("VcMetricsTracker", () => {
  it("does not emit anything on the first observation (baseline only)", () => {
    const tracker = new VcMetricsTracker();
    const result = tracker.observe("validator1", [
      {
        method: "vc_signed_beacon_blocks_total:success",
        count: 4,
        sumSeconds: 0.12,
      },
    ]);
    expect(result).toEqual([]);
  });

  it("emits the delta count and latencyMs on the second observation", () => {
    const tracker = new VcMetricsTracker();
    tracker.observe("validator1", [
      {
        method: "vc_signed_beacon_blocks_total:success",
        count: 4,
        sumSeconds: 0.12,
      },
    ]);
    const result = tracker.observe("validator1", [
      {
        method: "vc_signed_beacon_blocks_total:success",
        count: 6,
        sumSeconds: 0.18,
      },
    ]);
    // delta sum = 0.06s over 2 calls => 0.03s/call => 30ms
    expect(result).toEqual([
      { method: "vc_signed_beacon_blocks_total:success", count: 2, latencyMs: 30 },
    ]);
  });

  it("tracks proposal and attestation methods independently for the same node", () => {
    const tracker = new VcMetricsTracker();
    tracker.observe("validator1", [
      { method: "vc_signed_beacon_blocks_total:success", count: 1 },
      { method: "vc_signed_attestations_total:success", count: 3 },
    ]);
    const result = tracker.observe("validator1", [
      { method: "vc_signed_beacon_blocks_total:success", count: 2 },
      { method: "vc_signed_attestations_total:success", count: 10 },
    ]);
    expect(result).toEqual(
      expect.arrayContaining([
        { method: "vc_signed_beacon_blocks_total:success", count: 1 },
        { method: "vc_signed_attestations_total:success", count: 7 },
      ]),
    );
  });

  it("does not emit a method whose count is unchanged", () => {
    const tracker = new VcMetricsTracker();
    tracker.observe("validator1", [
      { method: "vc_signed_attestations_total:success", count: 5 },
    ]);
    const result = tracker.observe("validator1", [
      { method: "vc_signed_attestations_total:success", count: 5 },
    ]);
    expect(result).toEqual([]);
  });

  it("treats a counter reset (current < previous) as the increment being the current value", () => {
    const tracker = new VcMetricsTracker();
    tracker.observe("validator1", [
      { method: "vc_signed_attestations_total:success", count: 40 },
    ]);
    // VC プロセス再起動でカウンタがリセットされた直後の観測。
    const result = tracker.observe("validator1", [
      { method: "vc_signed_attestations_total:success", count: 2 },
    ]);
    expect(result).toEqual([
      { method: "vc_signed_attestations_total:success", count: 2 },
    ]);
  });

  it("tracks multiple validator nodes independently", () => {
    const tracker = new VcMetricsTracker();
    tracker.observe("validator1", [
      { method: "vc_signed_attestations_total:success", count: 1 },
    ]);
    tracker.observe("validator2", [
      { method: "vc_signed_attestations_total:success", count: 100 },
    ]);
    const result1 = tracker.observe("validator1", [
      { method: "vc_signed_attestations_total:success", count: 3 },
    ]);
    const result2 = tracker.observe("validator2", [
      { method: "vc_signed_attestations_total:success", count: 101 },
    ]);
    expect(result1).toEqual([
      { method: "vc_signed_attestations_total:success", count: 2 },
    ]);
    expect(result2).toEqual([
      { method: "vc_signed_attestations_total:success", count: 1 },
    ]);
  });

  it("forgetNode makes the next observation for that node a fresh baseline", () => {
    const tracker = new VcMetricsTracker();
    tracker.observe("validator1", [
      { method: "vc_signed_attestations_total:success", count: 10 },
    ]);
    tracker.forgetNode("validator1");
    const result = tracker.observe("validator1", [
      { method: "vc_signed_attestations_total:success", count: 999 },
    ]);
    expect(result).toEqual([]);
  });

  it("omits latencyMs when sumSeconds is absent on either observation", () => {
    const tracker = new VcMetricsTracker();
    tracker.observe("validator1", [
      { method: "vc_signed_attestations_total:success", count: 1 },
    ]);
    const result = tracker.observe("validator1", [
      {
        method: "vc_signed_attestations_total:success",
        count: 2,
        sumSeconds: 0.05,
      },
    ]);
    expect(result).toEqual([
      { method: "vc_signed_attestations_total:success", count: 1 },
    ]);
  });
});
