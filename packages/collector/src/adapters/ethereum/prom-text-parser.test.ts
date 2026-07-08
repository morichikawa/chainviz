import { describe, expect, it } from "vitest";
import { firstValue, parsePrometheusText, samplesOf } from "./prom-text-parser.js";

describe("parsePrometheusText", () => {
  it("parses a gauge without labels", () => {
    const text = [
      "# HELP reth_process_threads Number of OS threads in the process.",
      "# TYPE reth_process_threads gauge",
      "reth_process_threads 229",
    ].join("\n");
    const parsed = parsePrometheusText(text);
    expect(firstValue(parsed, "reth_process_threads")).toBe(229);
    expect(parsed.type.get("reth_process_threads")).toBe("gauge");
    expect(parsed.help.get("reth_process_threads")).toBe(
      "Number of OS threads in the process.",
    );
  });

  it("parses multiple samples of the same metric with different labels", () => {
    const text = [
      "# HELP reth_sync_checkpoint The block number of the last commit for a stage.",
      "# TYPE reth_sync_checkpoint gauge",
      'reth_sync_checkpoint{stage="Headers"} 21',
      'reth_sync_checkpoint{stage="Bodies"} 21',
    ].join("\n");
    const parsed = parsePrometheusText(text);
    expect(samplesOf(parsed, "reth_sync_checkpoint")).toEqual([
      { labels: { stage: "Headers" }, value: 21 },
      { labels: { stage: "Bodies" }, value: 21 },
    ]);
  });

  it("parses multiple labels on a single sample", () => {
    const text = 'reth_rpc_server_calls_failed_total{method="eth_call",transport="ws"} 3';
    const parsed = parsePrometheusText(text);
    expect(samplesOf(parsed, "reth_rpc_server_calls_failed_total")).toEqual([
      { labels: { method: "eth_call", transport: "ws" }, value: 3 },
    ]);
  });

  it("parses summary _sum/_count as distinct metric names", () => {
    const text = [
      "# HELP reth_engine_rpc_new_payload_v4 Latency for `engine_newPayloadV4`",
      "# TYPE reth_engine_rpc_new_payload_v4 summary",
      'reth_engine_rpc_new_payload_v4{quantile="0.5"} 0.0012',
      "reth_engine_rpc_new_payload_v4_sum 0.0252",
      "reth_engine_rpc_new_payload_v4_count 21",
    ].join("\n");
    const parsed = parsePrometheusText(text);
    expect(firstValue(parsed, "reth_engine_rpc_new_payload_v4_count")).toBe(21);
    expect(firstValue(parsed, "reth_engine_rpc_new_payload_v4_sum")).toBeCloseTo(
      0.0252,
    );
    expect(parsed.type.get("reth_engine_rpc_new_payload_v4")).toBe("summary");
    expect(parsed.help.get("reth_engine_rpc_new_payload_v4")).toContain(
      "engine_newPayloadV4",
    );
  });

  it("handles +Inf / -Inf / NaN value tokens", () => {
    const text = [
      "metric_inf +Inf",
      "metric_neg_inf -Inf",
      "metric_nan NaN",
    ].join("\n");
    const parsed = parsePrometheusText(text);
    expect(firstValue(parsed, "metric_inf")).toBe(Infinity);
    expect(firstValue(parsed, "metric_neg_inf")).toBe(-Infinity);
    expect(firstValue(parsed, "metric_nan")).toBeNaN();
  });

  it("unescapes backslash and newline in HELP text", () => {
    // ワイヤ表現(実際にテキストへ書かれる文字列)を組み立てる: "\\" はエスケープ
    // された1個のバックスラッシュ、"\n" はエスケープされた改行(実際の改行
    // 文字ではない)、バックティックは Prometheus の HELP エスケープ対象外
    // なのでそのままの文字。
    const helpLine =
      "# HELP reth_chain_spec Some \\\\text with a\\nnewline and `backtick`";
    const text = [
      helpLine,
      "# TYPE reth_chain_spec gauge",
      'reth_chain_spec{name="dev"} 1',
    ].join("\n");
    const parsed = parsePrometheusText(text);
    expect(parsed.help.get("reth_chain_spec")).toBe(
      "Some \\text with a\nnewline and `backtick`",
    );
  });

  it("unescapes quoted label values (escaped quote and backslash)", () => {
    const text = String.raw`metric{name="a\"b",path="c:\\d"} 1`;
    const parsed = parsePrometheusText(text);
    expect(samplesOf(parsed, "metric")).toEqual([
      { labels: { name: 'a"b', path: "c:\\d" }, value: 1 },
    ]);
  });

  it("ignores blank lines and unrecognized comments", () => {
    const text = [
      "",
      "# some other comment style",
      "metric_a 1",
      "",
      "metric_b 2",
    ].join("\n");
    const parsed = parsePrometheusText(text);
    expect(firstValue(parsed, "metric_a")).toBe(1);
    expect(firstValue(parsed, "metric_b")).toBe(2);
  });

  it("skips a sample line with an unterminated label section", () => {
    const text = ['metric_bad{stage="Headers" 1', "metric_good 2"].join("\n");
    const parsed = parsePrometheusText(text);
    expect(samplesOf(parsed, "metric_bad")).toEqual([]);
    expect(firstValue(parsed, "metric_good")).toBe(2);
  });

  it("skips a sample line whose value token is not a number", () => {
    const text = ["metric_bad not-a-number", "metric_good 5"].join("\n");
    const parsed = parsePrometheusText(text);
    expect(samplesOf(parsed, "metric_bad")).toEqual([]);
    expect(firstValue(parsed, "metric_good")).toBe(5);
  });

  it("returns empty maps for an empty input", () => {
    const parsed = parsePrometheusText("");
    expect(parsed.samples.size).toBe(0);
    expect(parsed.help.size).toBe(0);
    expect(parsed.type.size).toBe(0);
  });

  it("firstValue/samplesOf return undefined/[] for an unknown metric", () => {
    const parsed = parsePrometheusText("metric_a 1");
    expect(firstValue(parsed, "unknown_metric")).toBeUndefined();
    expect(samplesOf(parsed, "unknown_metric")).toEqual([]);
  });

  it("keeps HELP/TYPE metadata but no samples for a comment-only response", () => {
    // HELP/TYPE 行だけで実サンプルが 1 件も無い出力（起動直後やメトリクスが
    // まだ立っていない状態で起こりうる）。メタデータは拾いつつ samples は空。
    const text = [
      "# HELP reth_sync_checkpoint The block number of the last commit for a stage.",
      "# TYPE reth_sync_checkpoint gauge",
    ].join("\n");
    const parsed = parsePrometheusText(text);
    expect(parsed.samples.size).toBe(0);
    expect(parsed.type.get("reth_sync_checkpoint")).toBe("gauge");
    expect(parsed.help.has("reth_sync_checkpoint")).toBe(true);
  });

  it("ignores an appended timestamp token and keeps only the value", () => {
    // Prometheus のサンプル行は "value" または "value timestamp"。collector は
    // 自前の時刻を使うので、付いていても先頭トークンだけを値として読む。
    const parsed = parsePrometheusText("metric_a 42 1699999999000");
    expect(firstValue(parsed, "metric_a")).toBe(42);
  });

  it("parses decimal, negative, and exponent numeric values", () => {
    const text = [
      "metric_dec 3.14",
      "metric_neg -5",
      "metric_exp 1.5e3",
      "metric_negexp 2E-2",
    ].join("\n");
    const parsed = parsePrometheusText(text);
    expect(firstValue(parsed, "metric_dec")).toBeCloseTo(3.14);
    expect(firstValue(parsed, "metric_neg")).toBe(-5);
    expect(firstValue(parsed, "metric_exp")).toBe(1500);
    expect(firstValue(parsed, "metric_negexp")).toBeCloseTo(0.02);
  });

  it("parses a sample with an empty label section", () => {
    const parsed = parsePrometheusText("metric_a{} 7");
    expect(samplesOf(parsed, "metric_a")).toEqual([{ labels: {}, value: 7 }]);
  });

  it("tolerates CRLF line endings", () => {
    // \r はトリムで落ちるので、Windows 由来の CRLF でも読める。
    const text = "metric_a 1\r\nmetric_b 2\r\n";
    const parsed = parsePrometheusText(text);
    expect(firstValue(parsed, "metric_a")).toBe(1);
    expect(firstValue(parsed, "metric_b")).toBe(2);
  });

  it("skips a bare metric name line with no value token", () => {
    const parsed = parsePrometheusText(["metric_bad", "metric_good 3"].join("\n"));
    expect(samplesOf(parsed, "metric_bad")).toEqual([]);
    expect(firstValue(parsed, "metric_good")).toBe(3);
  });

  it("keeps the last declaration when HELP/TYPE for the same family repeat", () => {
    const text = [
      "# HELP metric_a first help",
      "# HELP metric_a second help",
      "# TYPE metric_a counter",
      "# TYPE metric_a gauge",
    ].join("\n");
    const parsed = parsePrometheusText(text);
    expect(parsed.help.get("metric_a")).toBe("second help");
    expect(parsed.type.get("metric_a")).toBe("gauge");
  });

  it("continues past a line whose label value is not quoted", () => {
    // ラベル値がクォートで始まらない乱れた行はそこで打ち切って読み捨てるが、
    // 後続の正常な行は読み続ける（1 行の乱れで全体を諦めない）。
    const text = ["metric_bad{stage=Headers} 1", "metric_good 2"].join("\n");
    const parsed = parsePrometheusText(text);
    expect(firstValue(parsed, "metric_good")).toBe(2);
  });
});
