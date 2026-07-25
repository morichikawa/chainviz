// Issue #420 テスト強化: VC メトリクスの解釈（parseValidatorDutyCounters）が
// 「実機で観測された正常な /metrics 出力」から外れた入力に出会ったときの縮退を
// 固定する。正常系・基本的な縮退は vc-metrics.test.ts が持つので、ここは
// 想定外の入力（status ラベルの異常・値トークンの異常・所要時間メトリクスの
// 形の異常）だけを扱う（1ファイル1責務）。
//
// 背景: lighthouse のイメージ更新でメトリクスの形が変わる可能性があるため、
// パーサ・解釈は「1箇所の乱れで全体を諦めない」方針で書かれている
// （vc-metrics.ts のコメント）。その方針が実際に守られていることをここで
// 固定する。

import { describe, expect, it } from "vitest";
import { parsePrometheusText } from "./prom-text-parser.js";
import { parseValidatorDutyCounters } from "./vc-metrics.js";
import { VcMetricsTracker } from "./vc-metrics-tracker.js";

function counters(...lines: string[]) {
  return parseValidatorDutyCounters(parsePrometheusText(lines.join("\n")));
}

describe("parseValidatorDutyCounters: status label anomalies", () => {
  it("skips a sample whose status label is present but empty", () => {
    expect(
      counters(
        'vc_signed_beacon_blocks_total{status=""} 4',
        'vc_signed_attestations_total{status="success"} 7',
      ),
    ).toEqual([{ method: "vc_signed_attestations_total:success", count: 7 }]);
  });

  it("passes through every non-success status value defined by lighthouse", () => {
    // status の取りうる値は success/slashable/same_data/unregistered
    // （docs/ARCHITECTURE.md §7.6.12）。実機では success しか観測されていないが、
    // 他の値が来ても読み捨てず、生の識別子として上位へ渡す（分類・表示は
    // フロント表現セットの責務）。
    expect(
      counters(
        'vc_signed_beacon_blocks_total{status="slashable"} 1',
        'vc_signed_beacon_blocks_total{status="same_data"} 2',
        'vc_signed_beacon_blocks_total{status="unregistered"} 3',
        'vc_signed_attestations_total{status="slashable"} 4',
      ),
    ).toEqual([
      { method: "vc_signed_beacon_blocks_total:slashable", count: 1 },
      { method: "vc_signed_beacon_blocks_total:same_data", count: 2 },
      { method: "vc_signed_beacon_blocks_total:unregistered", count: 3 },
      { method: "vc_signed_attestations_total:slashable", count: 4 },
    ]);
  });

  it("passes through an unknown future status value without special-casing it", () => {
    // lighthouse 側に新しい status 値が増えた場合でも、読み捨てずに生名を
    // 渡す（フロントの前方一致テーブルはメトリクスファミリー名までしか見て
    // いないため、未知の status でも分類ラベルは付く）。
    expect(counters('vc_signed_attestations_total{status="future_value"} 5')).toEqual([
      { method: "vc_signed_attestations_total:future_value", count: 5 },
    ]);
  });

  it("reads the status label even when other labels are present", () => {
    expect(
      counters('vc_signed_beacon_blocks_total{status="success",graffiti="chainviz"} 4'),
    ).toEqual([{ method: "vc_signed_beacon_blocks_total:success", count: 4 }]);
  });
});

describe("parseValidatorDutyCounters: counter value anomalies", () => {
  it("skips a counter whose value is NaN", () => {
    expect(
      counters(
        "# TYPE vc_signed_beacon_blocks_total counter",
        'vc_signed_beacon_blocks_total{status="success"} NaN',
        'vc_signed_attestations_total{status="success"} 7',
      ),
    ).toEqual([{ method: "vc_signed_attestations_total:success", count: 7 }]);
  });

  it("skips a counter whose value is +Inf", () => {
    expect(
      counters(
        'vc_signed_beacon_blocks_total{status="success"} +Inf',
        'vc_signed_attestations_total{status="success"} 7',
      ),
    ).toEqual([{ method: "vc_signed_attestations_total:success", count: 7 }]);
  });

  it("skips a line whose value token is not a number at all", () => {
    expect(
      counters(
        'vc_signed_beacon_blocks_total{status="success"} not-a-number',
        'vc_signed_attestations_total{status="success"} 7',
      ),
    ).toEqual([{ method: "vc_signed_attestations_total:success", count: 7 }]);
  });

  it("reads a zero counter as a valid observation (VC that has not signed anything yet)", () => {
    // 0 は「まだ職務を果たしていない」正当な値。差分計算のベースラインとして
    // 記録される必要があるため、読み捨ててはいけない。
    expect(counters('vc_signed_beacon_blocks_total{status="success"} 0')).toEqual([
      { method: "vc_signed_beacon_blocks_total:success", count: 0 },
    ]);
  });

  it("keeps duplicated sample lines for the same status instead of crashing", () => {
    // 正常な Prometheus 出力では起こらない入力。読み捨てるより「そのまま渡す」
    // 方が実装が単純で、差分計算側も負の増分を出さない（下の tracker の
    // ケースで確認）。
    expect(
      counters(
        'vc_signed_beacon_blocks_total{status="success"} 4',
        'vc_signed_beacon_blocks_total{status="success"} 9',
      ),
    ).toEqual([
      { method: "vc_signed_beacon_blocks_total:success", count: 4 },
      { method: "vc_signed_beacon_blocks_total:success", count: 9 },
    ]);
  });

  it("does not mistake a metric whose name merely starts with the counter family name", () => {
    expect(
      counters(
        'vc_signed_beacon_blocks_total_extra{status="success"} 4',
        'vc_signed_attestations_total_v2{status="success"} 7',
      ),
    ).toEqual([]);
  });
});

describe("parseValidatorDutyCounters: timing metric anomalies", () => {
  it("does not treat histogram bucket lines as the sum", () => {
    const result = counters(
      "# TYPE vc_block_signing_times_seconds histogram",
      'vc_signed_beacon_blocks_total{status="success"} 4',
      'vc_block_signing_times_seconds_bucket{le="0.1"} 3',
      'vc_block_signing_times_seconds_bucket{le="+Inf"} 4',
    );
    expect(result).toEqual([
      { method: "vc_signed_beacon_blocks_total:success", count: 4 },
    ]);
  });

  it("accepts a _sum without a matching _count (only _sum is read)", () => {
    // _count は使っていない（増分はカウンタ側から取る）ため、_count が欠けても
    // 所要時間は使える。
    expect(
      counters(
        'vc_signed_beacon_blocks_total{status="success"} 4',
        "vc_block_signing_times_seconds_sum 0.4",
      ),
    ).toEqual([
      { method: "vc_signed_beacon_blocks_total:success", count: 4, sumSeconds: 0.4 },
    ]);
  });

  it("omits the timing sum when only _count is present", () => {
    expect(
      counters(
        'vc_signed_beacon_blocks_total{status="success"} 4',
        "vc_block_signing_times_seconds_count 4",
      ),
    ).toEqual([{ method: "vc_signed_beacon_blocks_total:success", count: 4 }]);
  });

  it("never reports a non-finite block signing sum as a usable duration", () => {
    // 実機の histogram は有限値だが、NaN/+Inf を含む出力に出会っても
    // 「使える所要時間」として扱わないこと（有限値でなければ latencyMs を
    // 組み立ててはいけない）を、値そのものではなく有限性で固定する。
    for (const token of ["NaN", "+Inf", "-Inf"]) {
      const result = counters(
        'vc_signed_beacon_blocks_total{status="success"} 4',
        `vc_block_signing_times_seconds_sum ${token}`,
      );
      expect(result).toHaveLength(1);
      expect(Number.isFinite(result[0].sumSeconds ?? NaN)).toBe(false);
    }
  });

  it("omits the attestation submit sum when its value is not finite", () => {
    expect(
      counters(
        'vc_signed_attestations_total{status="success"} 7',
        'vc_attestation_service_task_times_seconds_sum{task="attestations_http_post"} NaN',
      ),
    ).toEqual([{ method: "vc_signed_attestations_total:success", count: 7 }]);
  });

  it("picks the attestations_http_post task regardless of its position among other tasks", () => {
    expect(
      counters(
        'vc_signed_attestations_total{status="success"} 7',
        'vc_attestation_service_task_times_seconds_sum{task="attestations_service_signing"} 9',
        'vc_attestation_service_task_times_seconds_sum{task="attestations_http_post"} 0.05',
        'vc_attestation_service_task_times_seconds_sum{task="attestations_service_broadcast"} 1.5',
      ),
    ).toEqual([
      { method: "vc_signed_attestations_total:success", count: 7, sumSeconds: 0.05 },
    ]);
  });

  it("omits the attestation submit sum when the task label is missing entirely", () => {
    expect(
      counters(
        'vc_signed_attestations_total{status="success"} 7',
        "vc_attestation_service_task_times_seconds_sum 0.05",
      ),
    ).toEqual([{ method: "vc_signed_attestations_total:success", count: 7 }]);
  });

  it("attaches the block signing sum only to the block proposal counter, never to attestations", () => {
    // 2つの所要時間メトリクスの取り違えが起きていないこと（提案の署名時間が
    // 証明側に付く／その逆が起きない）。
    expect(
      counters(
        'vc_signed_beacon_blocks_total{status="success"} 4',
        'vc_signed_attestations_total{status="success"} 7',
        "vc_block_signing_times_seconds_sum 0.12",
      ),
    ).toEqual([
      { method: "vc_signed_beacon_blocks_total:success", count: 4, sumSeconds: 0.12 },
      { method: "vc_signed_attestations_total:success", count: 7 },
    ]);
  });

  it("does not confuse vc_signing_times_seconds (signer backend) with vc_block_signing_times_seconds", () => {
    // 前者は signer backend 別（local_keystore/web3signer）の集計で職務種別では
    // 分かれていないため、所要時間として使ってはいけない
    // （docs/worklog/issue-420.md の申し送り）。
    expect(
      counters(
        'vc_signed_beacon_blocks_total{status="success"} 4',
        'vc_signing_times_seconds_sum{type="local_keystore"} 0.9',
      ),
    ).toEqual([{ method: "vc_signed_beacon_blocks_total:success", count: 4 }]);
  });
});

describe("parseValidatorDutyCounters + VcMetricsTracker: degraded input reaches no bad output", () => {
  it("emits no latencyMs when the block signing sum is NaN in both polls", () => {
    const tracker = new VcMetricsTracker();
    const text = (proposals: number) =>
      [
        `vc_signed_beacon_blocks_total{status="success"} ${proposals}`,
        "vc_block_signing_times_seconds_sum NaN",
      ].join("\n");
    tracker.observe(
      "validator1",
      parseValidatorDutyCounters(parsePrometheusText(text(4))),
    );
    const result = tracker.observe(
      "validator1",
      parseValidatorDutyCounters(parsePrometheusText(text(6))),
    );
    expect(result).toEqual([
      { method: "vc_signed_beacon_blocks_total:success", count: 2 },
    ]);
  });

  it("never emits a non-positive count from duplicated sample lines", () => {
    // 同一 method が1回の観測に2件現れる異常入力でも、負・ゼロの増分を
    // 配信しないこと（フロントは count をそのまま「×N」と表示するため）。
    const tracker = new VcMetricsTracker();
    tracker.observe(
      "validator1",
      counters(
        'vc_signed_beacon_blocks_total{status="success"} 1',
        'vc_signed_beacon_blocks_total{status="success"} 2',
      ),
    );
    const result = tracker.observe(
      "validator1",
      counters(
        'vc_signed_beacon_blocks_total{status="success"} 4',
        'vc_signed_beacon_blocks_total{status="success"} 6',
      ),
    );
    for (const stat of result) {
      expect(stat.count).toBeGreaterThan(0);
    }
  });
});
