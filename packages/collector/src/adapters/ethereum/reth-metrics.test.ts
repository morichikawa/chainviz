import { describe, expect, it } from "vitest";
import { parsePrometheusText } from "./prom-text-parser.js";
import {
  parseEngineCallCounters,
  parseMempool,
  parseSyncStages,
} from "./reth-metrics.js";

/** 実機の /metrics 出力から抜粋した最小限のテキスト（docs/worklog/issue-185.md 参照)。 */
function metricsText(lines: string[]): string {
  return lines.join("\n");
}

describe("parseSyncStages", () => {
  it("reorders stages to the known pipeline order regardless of raw text order", () => {
    // 実機では reth_sync_checkpoint のラベル出現順序がスクレイプごとに変わる
    // ことを確認済み(docs/worklog/issue-185.md)。既知の順序へ強制的に
    // 並べ替えることを確認する。
    const parsed = parsePrometheusText(
      metricsText([
        'reth_sync_checkpoint{stage="Finish"} 27',
        'reth_sync_checkpoint{stage="Execution"} 27',
        'reth_sync_checkpoint{stage="Headers"} 27',
        'reth_sync_checkpoint{stage="Bodies"} 27',
      ]),
    );
    expect(parseSyncStages(parsed).map((s) => s.stage)).toEqual([
      "Headers",
      "Bodies",
      "Execution",
      "Finish",
    ]);
  });

  it("appends unknown stage names after the known ones, alphabetically", () => {
    const parsed = parsePrometheusText(
      metricsText([
        'reth_sync_checkpoint{stage="Era"} 5',
        'reth_sync_checkpoint{stage="Headers"} 5',
        'reth_sync_checkpoint{stage="PruneSenderRecovery"} 5',
        'reth_sync_checkpoint{stage="MerkleUnwind"} 5',
      ]),
    );
    expect(parseSyncStages(parsed).map((s) => s.stage)).toEqual([
      "Headers",
      "Era",
      "MerkleUnwind",
      "PruneSenderRecovery",
    ]);
  });

  it("keeps the checkpoint value for each stage", () => {
    const parsed = parsePrometheusText(
      'reth_sync_checkpoint{stage="Headers"} 161',
    );
    expect(parseSyncStages(parsed)).toEqual([
      { stage: "Headers", checkpoint: 161 },
    ]);
  });

  it("returns an empty array when the metric is entirely absent", () => {
    const parsed = parsePrometheusText("some_other_metric 1");
    expect(parseSyncStages(parsed)).toEqual([]);
  });

  it("drops a sample with a missing stage label", () => {
    const parsed = parsePrometheusText(
      metricsText([
        "reth_sync_checkpoint 5",
        'reth_sync_checkpoint{stage="Headers"} 5',
      ]),
    );
    expect(parseSyncStages(parsed)).toEqual([
      { stage: "Headers", checkpoint: 5 },
    ]);
  });

  it("drops a sample with an empty stage label", () => {
    const parsed = parsePrometheusText(
      metricsText([
        'reth_sync_checkpoint{stage=""} 5',
        'reth_sync_checkpoint{stage="Bodies"} 5',
      ]),
    );
    expect(parseSyncStages(parsed)).toEqual([
      { stage: "Bodies", checkpoint: 5 },
    ]);
  });

  it("drops a sample whose checkpoint value is not finite", () => {
    // checkpoint が +Inf / NaN のサンプルは読み捨て、有限値のものだけ残す。
    const parsed = parsePrometheusText(
      metricsText([
        'reth_sync_checkpoint{stage="Headers"} +Inf',
        'reth_sync_checkpoint{stage="Bodies"} NaN',
        'reth_sync_checkpoint{stage="Finish"} 9',
      ]),
    );
    expect(parseSyncStages(parsed)).toEqual([
      { stage: "Finish", checkpoint: 9 },
    ]);
  });

  it("produces an identical ordering regardless of the raw scrape order", () => {
    // 実機ではラベル出現順がスクレイプごとに変わる(docs/worklog/issue-185.md)。
    // 既知ステージ・未知ステージが混在した集合を 2 通りの順序でパースしても、
    // 並べ替え後の配列が完全に一致する(順序非依存の決定性)ことを固定する。
    const stagesInOrderA = [
      'reth_sync_checkpoint{stage="Finish"} 3',
      'reth_sync_checkpoint{stage="Era"} 3',
      'reth_sync_checkpoint{stage="Headers"} 3',
      'reth_sync_checkpoint{stage="MerkleUnwind"} 3',
      'reth_sync_checkpoint{stage="Execution"} 3',
    ];
    const stagesInOrderB = [
      'reth_sync_checkpoint{stage="Execution"} 3',
      'reth_sync_checkpoint{stage="MerkleUnwind"} 3',
      'reth_sync_checkpoint{stage="Headers"} 3',
      'reth_sync_checkpoint{stage="Era"} 3',
      'reth_sync_checkpoint{stage="Finish"} 3',
    ];
    const resultA = parseSyncStages(parsePrometheusText(metricsText(stagesInOrderA)));
    const resultB = parseSyncStages(parsePrometheusText(metricsText(stagesInOrderB)));
    expect(resultA).toEqual(resultB);
    expect(resultA.map((s) => s.stage)).toEqual([
      "Headers",
      "Execution",
      "Finish",
      "Era",
      "MerkleUnwind",
    ]);
  });

  it("sorts an all-unknown stage set alphabetically", () => {
    const parsed = parsePrometheusText(
      metricsText([
        'reth_sync_checkpoint{stage="Zeta"} 1',
        'reth_sync_checkpoint{stage="Alpha"} 1',
        'reth_sync_checkpoint{stage="Mu"} 1',
      ]),
    );
    expect(parseSyncStages(parsed).map((s) => s.stage)).toEqual([
      "Alpha",
      "Mu",
      "Zeta",
    ]);
  });
});

describe("parseMempool", () => {
  it("reads pending and queued counts", () => {
    const parsed = parsePrometheusText(
      metricsText([
        "reth_transaction_pool_pending_pool_transactions 3",
        "reth_transaction_pool_queued_pool_transactions 1",
      ]),
    );
    expect(parseMempool(parsed)).toEqual({ pending: 3, queued: 1 });
  });

  it("returns undefined when queued is missing (partial data is not reported)", () => {
    const parsed = parsePrometheusText(
      "reth_transaction_pool_pending_pool_transactions 3",
    );
    expect(parseMempool(parsed)).toBeUndefined();
  });

  it("returns undefined when pending is missing", () => {
    const parsed = parsePrometheusText(
      "reth_transaction_pool_queued_pool_transactions 1",
    );
    expect(parseMempool(parsed)).toBeUndefined();
  });

  it("returns undefined when both metrics are entirely absent", () => {
    const parsed = parsePrometheusText("some_other_metric 1");
    expect(parseMempool(parsed)).toBeUndefined();
  });

  it("returns undefined when a value is present but not finite", () => {
    // 片方が NaN の中途半端な出力は mempool を丸ごと省略する(壊れた値を載せない)。
    const parsed = parsePrometheusText(
      metricsText([
        "reth_transaction_pool_pending_pool_transactions NaN",
        "reth_transaction_pool_queued_pool_transactions 1",
      ]),
    );
    expect(parseMempool(parsed)).toBeUndefined();
  });

  it("reads zero pending/queued as a valid (not omitted) mempool", () => {
    // 0 は falsy だが「空の mempool」という有効な観測なので undefined にしない。
    const parsed = parsePrometheusText(
      metricsText([
        "reth_transaction_pool_pending_pool_transactions 0",
        "reth_transaction_pool_queued_pool_transactions 0",
      ]),
    );
    expect(parseMempool(parsed)).toEqual({ pending: 0, queued: 0 });
  });
});

describe("parseEngineCallCounters", () => {
  it("extracts the real method name from the HELP backtick text", () => {
    const parsed = parsePrometheusText(
      metricsText([
        "# HELP reth_engine_rpc_new_payload_v4 Latency for `engine_newPayloadV4`",
        "# TYPE reth_engine_rpc_new_payload_v4 summary",
        'reth_engine_rpc_new_payload_v4{quantile="0.5"} 0.001',
        "reth_engine_rpc_new_payload_v4_sum 0.0252",
        "reth_engine_rpc_new_payload_v4_count 21",
      ]),
    );
    expect(parseEngineCallCounters(parsed)).toEqual([
      { method: "engine_newPayloadV4", count: 21, sumSeconds: 0.0252 },
    ]);
  });

  it("extracts multiple engine RPC method families", () => {
    const parsed = parsePrometheusText(
      metricsText([
        "# HELP reth_engine_rpc_new_payload_v4 Latency for `engine_newPayloadV4`",
        "# TYPE reth_engine_rpc_new_payload_v4 summary",
        "reth_engine_rpc_new_payload_v4_sum 0.0252",
        "reth_engine_rpc_new_payload_v4_count 21",
        "# HELP reth_engine_rpc_fork_choice_updated_v3 Latency for `engine_forkchoiceUpdatedV3`",
        "# TYPE reth_engine_rpc_fork_choice_updated_v3 summary",
        "reth_engine_rpc_fork_choice_updated_v3_sum 0.005",
        "reth_engine_rpc_fork_choice_updated_v3_count 44",
      ]),
    );
    expect(parseEngineCallCounters(parsed)).toEqual(
      expect.arrayContaining([
        { method: "engine_newPayloadV4", count: 21, sumSeconds: 0.0252 },
        {
          method: "engine_forkchoiceUpdatedV3",
          count: 44,
          sumSeconds: 0.005,
        },
      ]),
    );
  });

  it("omits sumSeconds when the _sum sample is absent", () => {
    const parsed = parsePrometheusText(
      metricsText([
        "# HELP reth_engine_rpc_get_payload_v4 Latency for `engine_getPayloadV4`",
        "# TYPE reth_engine_rpc_get_payload_v4 summary",
        "reth_engine_rpc_get_payload_v4_count 12",
      ]),
    );
    expect(parseEngineCallCounters(parsed)).toEqual([
      { method: "engine_getPayloadV4", count: 12 },
    ]);
  });

  it("skips a family whose _count sample is missing", () => {
    const parsed = parsePrometheusText(
      metricsText([
        "# HELP reth_engine_rpc_new_payload_v1 Latency for `engine_newPayloadV1`",
        "# TYPE reth_engine_rpc_new_payload_v1 summary",
        'reth_engine_rpc_new_payload_v1{quantile="0.5"} 0',
        // _count サンプルが無い（reth のバージョンにより出力形が変わる想定）。
      ]),
    );
    expect(parseEngineCallCounters(parsed)).toEqual([]);
  });

  it("skips a reth_engine_rpc_ family that is not a summary", () => {
    const parsed = parsePrometheusText(
      metricsText([
        "# HELP reth_engine_rpc_blobs_blob_count Count of blobs successfully retrieved",
        "# TYPE reth_engine_rpc_blobs_blob_count counter",
        "reth_engine_rpc_blobs_blob_count 0",
      ]),
    );
    expect(parseEngineCallCounters(parsed)).toEqual([]);
  });

  it("skips a summary family whose HELP text has no backtick-quoted engine_ method", () => {
    const parsed = parsePrometheusText(
      metricsText([
        "# HELP reth_engine_rpc_something_unrelated A metric with no method name.",
        "# TYPE reth_engine_rpc_something_unrelated summary",
        "reth_engine_rpc_something_unrelated_count 1",
      ]),
    );
    expect(parseEngineCallCounters(parsed)).toEqual([]);
  });

  it("ignores metric families outside the reth_engine_rpc_ prefix", () => {
    const parsed = parsePrometheusText(
      metricsText([
        "# HELP reth_consensus_engine_beacon_new_payload_messages The total count of new payload messages received.",
        "# TYPE reth_consensus_engine_beacon_new_payload_messages counter",
        "reth_consensus_engine_beacon_new_payload_messages 21",
      ]),
    );
    expect(parseEngineCallCounters(parsed)).toEqual([]);
  });

  it("returns an empty array when no metrics are present", () => {
    const parsed = parsePrometheusText("");
    expect(parseEngineCallCounters(parsed)).toEqual([]);
  });

  it("skips a family whose _count value is not finite", () => {
    const parsed = parsePrometheusText(
      metricsText([
        "# HELP reth_engine_rpc_new_payload_v4 Latency for `engine_newPayloadV4`",
        "# TYPE reth_engine_rpc_new_payload_v4 summary",
        "reth_engine_rpc_new_payload_v4_count NaN",
      ]),
    );
    expect(parseEngineCallCounters(parsed)).toEqual([]);
  });

  it("omits sumSeconds when the _sum value is not finite (but keeps the counter)", () => {
    const parsed = parsePrometheusText(
      metricsText([
        "# HELP reth_engine_rpc_new_payload_v4 Latency for `engine_newPayloadV4`",
        "# TYPE reth_engine_rpc_new_payload_v4 summary",
        "reth_engine_rpc_new_payload_v4_sum +Inf",
        "reth_engine_rpc_new_payload_v4_count 5",
      ]),
    );
    expect(parseEngineCallCounters(parsed)).toEqual([
      { method: "engine_newPayloadV4", count: 5 },
    ]);
  });
});
