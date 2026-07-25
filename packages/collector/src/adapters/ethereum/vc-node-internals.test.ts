import { afterEach, describe, expect, it, vi } from "vitest";
import type { VcMetricsClient } from "./vc-metrics-client.js";
import { VcMetricsTracker } from "./vc-metrics-tracker.js";
import { pollVcNodeInternals } from "./vc-node-internals.js";

function clientReturning(text: string): VcMetricsClient {
  return { getText: vi.fn(async () => text) };
}

function clientRejecting(err: unknown): VcMetricsClient {
  return {
    getText: vi.fn(async () => {
      throw err;
    }),
  };
}

const target = {
  stableId: "chainviz-ethereum/validator1",
  metricsUrl: "http://172.28.1.3:5064/metrics",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pollVcNodeInternals", () => {
  it("returns an empty array on the first observation (baseline only, no calls yet)", async () => {
    const client = clientReturning(
      [
        'vc_signed_beacon_blocks_total{status="success"} 4',
        'vc_signed_attestations_total{status="success"} 7',
      ].join("\n"),
    );
    const tracker = new VcMetricsTracker();
    const result = await pollVcNodeInternals(client, target, tracker);
    expect(result).toEqual([]);
  });

  it("reports duty deltas via the tracker across two polls", async () => {
    const metrics = (proposals: number, attestations: number) =>
      [
        `vc_signed_beacon_blocks_total{status="success"} ${proposals}`,
        `vc_signed_attestations_total{status="success"} ${attestations}`,
      ].join("\n");
    const tracker = new VcMetricsTracker();

    const first = await pollVcNodeInternals(
      clientReturning(metrics(4, 7)),
      target,
      tracker,
    );
    expect(first).toEqual([]); // 初回はベースラインのみ。

    const second = await pollVcNodeInternals(
      clientReturning(metrics(5, 9)),
      target,
      tracker,
    );
    expect(second).toEqual(
      expect.arrayContaining([
        { method: "vc_signed_beacon_blocks_total:success", count: 1 },
        { method: "vc_signed_attestations_total:success", count: 2 },
      ]),
    );
  });

  it("returns undefined and logs when the HTTP fetch fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = clientRejecting(new Error("connect ECONNREFUSED"));
    const tracker = new VcMetricsTracker();
    const result = await pollVcNodeInternals(client, target, tracker);
    expect(result).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(target.stableId),
      expect.any(Error),
    );
  });

  it("returns undefined and logs when the response has no parsable samples", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = clientReturning("");
    const tracker = new VcMetricsTracker();
    const result = await pollVcNodeInternals(client, target, tracker);
    expect(result).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(target.stableId),
    );
  });

  it("returns an empty array (not an error) when the response has samples but no duty counters", async () => {
    // メトリクス自体は取得できるが、対象の職務カウンタが1件も無いケース
    // （例: --metrics は有効だが観測範囲でまだ提案/証明の記録が無い）。
    const client = clientReturning("vc_validators_enabled_count 64");
    const tracker = new VcMetricsTracker();
    const result = await pollVcNodeInternals(client, target, tracker);
    expect(result).toEqual([]);
  });

  it("keeps latencyMs when the timing metric is present alongside the counter", async () => {
    const tracker = new VcMetricsTracker();
    await pollVcNodeInternals(
      clientReturning(
        [
          'vc_signed_beacon_blocks_total{status="success"} 4',
          "vc_block_signing_times_seconds_sum 0.12",
        ].join("\n"),
      ),
      target,
      tracker,
    );
    const result = await pollVcNodeInternals(
      clientReturning(
        [
          'vc_signed_beacon_blocks_total{status="success"} 5',
          "vc_block_signing_times_seconds_sum 0.15",
        ].join("\n"),
      ),
      target,
      tracker,
    );
    // delta sum = 0.03s over 1 call => 30ms
    expect(result).toEqual([
      {
        method: "vc_signed_beacon_blocks_total:success",
        count: 1,
        latencyMs: 30,
      },
    ]);
  });
});
