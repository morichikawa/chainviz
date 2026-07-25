import { describe, expect, it } from "vitest";
import { parsePrometheusText } from "./prom-text-parser.js";
import { parseValidatorDutyCounters } from "./vc-metrics.js";

describe("parseValidatorDutyCounters", () => {
  it("reads block proposal and attestation counters with the success status, attaching latency sums", () => {
    const parsed = parsePrometheusText(
      [
        'vc_signed_beacon_blocks_total{status="success"} 4',
        'vc_signed_attestations_total{status="success"} 7',
        "vc_block_signing_times_seconds_sum 0.1207",
        "vc_block_signing_times_seconds_count 4",
        'vc_attestation_service_task_times_seconds_sum{task="attestations_http_post"} 0.045',
        'vc_attestation_service_task_times_seconds_count{task="attestations_http_post"} 7',
      ].join("\n"),
    );
    expect(parseValidatorDutyCounters(parsed)).toEqual([
      {
        method: "vc_signed_beacon_blocks_total:success",
        count: 4,
        sumSeconds: 0.1207,
      },
      {
        method: "vc_signed_attestations_total:success",
        count: 7,
        sumSeconds: 0.045,
      },
    ]);
  });

  it("omits sumSeconds when the corresponding timing metric is absent (degraded VC without --metrics extras)", () => {
    const parsed = parsePrometheusText(
      [
        'vc_signed_beacon_blocks_total{status="success"} 2',
        'vc_signed_attestations_total{status="success"} 3',
      ].join("\n"),
    );
    expect(parseValidatorDutyCounters(parsed)).toEqual([
      { method: "vc_signed_beacon_blocks_total:success", count: 2 },
      { method: "vc_signed_attestations_total:success", count: 3 },
    ]);
  });

  it("reads multiple status values as separate raw counters, attaching latency only to success", () => {
    const parsed = parsePrometheusText(
      [
        'vc_signed_beacon_blocks_total{status="success"} 4',
        'vc_signed_beacon_blocks_total{status="slashable"} 1',
        "vc_block_signing_times_seconds_sum 0.1",
        "vc_block_signing_times_seconds_count 4",
      ].join("\n"),
    );
    expect(parseValidatorDutyCounters(parsed)).toEqual([
      {
        method: "vc_signed_beacon_blocks_total:success",
        count: 4,
        sumSeconds: 0.1,
      },
      { method: "vc_signed_beacon_blocks_total:slashable", count: 1 },
    ]);
  });

  it("ignores the attestation submit timing sample for a different task label", () => {
    const parsed = parsePrometheusText(
      [
        'vc_signed_attestations_total{status="success"} 3',
        'vc_attestation_service_task_times_seconds_sum{task="attestations_service_signing"} 0.9',
      ].join("\n"),
    );
    expect(parseValidatorDutyCounters(parsed)).toEqual([
      { method: "vc_signed_attestations_total:success", count: 3 },
    ]);
  });

  it("skips samples with a missing status label without dropping the rest", () => {
    const parsed = parsePrometheusText(
      [
        "vc_signed_beacon_blocks_total 4",
        'vc_signed_attestations_total{status="success"} 7',
      ].join("\n"),
    );
    expect(parseValidatorDutyCounters(parsed)).toEqual([
      { method: "vc_signed_attestations_total:success", count: 7 },
    ]);
  });

  it("returns an empty array when neither counter family is present", () => {
    const parsed = parsePrometheusText("vc_validators_enabled_count 64");
    expect(parseValidatorDutyCounters(parsed)).toEqual([]);
  });
});
