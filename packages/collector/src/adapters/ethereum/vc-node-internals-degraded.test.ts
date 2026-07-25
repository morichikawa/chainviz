// Issue #420 テスト強化: pollVcNodeInternals（1 VC ノード分のオーケストレー
// ション）が、想定外のレスポンス・想定外の例外に出会ったときの縮退を固定する。
// 正常系と基本的な失敗（fetch 例外・空レスポンス）は vc-node-internals.test.ts
// が持つので、ここは「HTTP は成功したが本文が Prometheus 形式でない」
// 「Error 以外が throw される」「同じ tracker を複数ノードで共有する」といった
// 観点だけを扱う（1ファイル1責務）。

import { afterEach, describe, expect, it, vi } from "vitest";
import type { VcMetricsClient } from "./vc-metrics-client.js";
import { VcMetricsTracker } from "./vc-metrics-tracker.js";
import { pollVcNodeInternals } from "./vc-node-internals.js";

function clientReturning(text: string): VcMetricsClient {
  return { getText: vi.fn(async () => text) };
}

const target = {
  stableId: "chainviz-ethereum/validator1",
  metricsUrl: "http://172.28.0.3:5064/metrics",
};

const target2 = {
  stableId: "chainviz-ethereum/validator2",
  metricsUrl: "http://172.28.0.4:5064/metrics",
};

function dutyMetrics(proposals: number, attestations: number): string {
  return [
    `vc_signed_beacon_blocks_total{status="success"} ${proposals}`,
    `vc_signed_attestations_total{status="success"} ${attestations}`,
  ].join("\n");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pollVcNodeInternals: unparsable response bodies", () => {
  it("requests exactly the target metricsUrl", async () => {
    const client = clientReturning(dutyMetrics(1, 1));
    await pollVcNodeInternals(client, target, new VcMetricsTracker());
    expect(client.getText).toHaveBeenCalledWith(target.metricsUrl);
  });

  it("returns undefined and logs for an HTML error page served with 200", async () => {
    // 別のプロセス（プロキシ等）が同じポートを掴んでいた場合に起こりうる。
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = clientReturning(
      "<html><head><title>404 Not Found</title></head><body>nope</body></html>",
    );
    const result = await pollVcNodeInternals(client, target, new VcMetricsTracker());
    expect(result).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(target.stableId));
  });

  it("returns undefined and logs for a body that only contains comment lines", async () => {
    // `# HELP`/`# TYPE` だけでサンプル行が無い（メトリクスが1つも登録されて
    // いない状態のエクスポータ）。
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = clientReturning(
      [
        "# HELP vc_signed_beacon_blocks_total Signed blocks",
        "# TYPE vc_signed_beacon_blocks_total counter",
      ].join("\n"),
    );
    const result = await pollVcNodeInternals(client, target, new VcMetricsTracker());
    expect(result).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(target.stableId));
  });

  it("returns undefined and logs for a whitespace-only body", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await pollVcNodeInternals(
      clientReturning("\n \n\t\n"),
      target,
      new VcMetricsTracker(),
    );
    expect(result).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(target.stableId));
  });

  it("includes the metrics URL in the log so the unreachable endpoint is identifiable", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await pollVcNodeInternals(clientReturning(""), target, new VcMetricsTracker());
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(target.metricsUrl),
    );
  });

  it("does not poison the baseline: a failed poll between two good polls still yields the full delta", async () => {
    // 取得に失敗した tick は tracker に触れないため、次に成功した tick の
    // 増分は「失敗を挟んだ区間の合計」になる（パルスの取りこぼしはあっても
    // 回数の取りこぼしはない）。
    const tracker = new VcMetricsTracker();
    await pollVcNodeInternals(clientReturning(dutyMetrics(4, 7)), target, tracker);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await pollVcNodeInternals(clientReturning(""), target, tracker);
    const result = await pollVcNodeInternals(
      clientReturning(dutyMetrics(6, 11)),
      target,
      tracker,
    );
    expect(result).toEqual(
      expect.arrayContaining([
        { method: "vc_signed_beacon_blocks_total:success", count: 2 },
        { method: "vc_signed_attestations_total:success", count: 4 },
      ]),
    );
  });
});

describe("pollVcNodeInternals: non-Error rejections", () => {
  it("logs and returns undefined when the client throws a string", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client: VcMetricsClient = {
      getText: vi.fn(async () => {
        throw "boom";
      }),
    };
    const result = await pollVcNodeInternals(client, target, new VcMetricsTracker());
    expect(result).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(target.stableId),
      "boom",
    );
  });

  it("logs and returns undefined when the client throws undefined", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client: VcMetricsClient = {
      getText: vi.fn(async () => {
        throw undefined;
      }),
    };
    const result = await pollVcNodeInternals(client, target, new VcMetricsTracker());
    expect(result).toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("pollVcNodeInternals: multiple targets on one tracker", () => {
  it("keeps per-node baselines separate even for identical counter values", async () => {
    const tracker = new VcMetricsTracker();
    await pollVcNodeInternals(clientReturning(dutyMetrics(10, 10)), target, tracker);
    // validator2 は初回なので、validator1 のベースラインに影響されず何も出さない。
    const firstForSecondNode = await pollVcNodeInternals(
      clientReturning(dutyMetrics(90, 90)),
      target2,
      tracker,
    );
    expect(firstForSecondNode).toEqual([]);

    const secondForSecondNode = await pollVcNodeInternals(
      clientReturning(dutyMetrics(91, 92)),
      target2,
      tracker,
    );
    expect(secondForSecondNode).toEqual(
      expect.arrayContaining([
        { method: "vc_signed_beacon_blocks_total:success", count: 1 },
        { method: "vc_signed_attestations_total:success", count: 2 },
      ]),
    );
  });
});

describe("pollVcNodeInternals: unusual but parsable duty counters", () => {
  it("passes a non-success status through to the call stats", async () => {
    // 実機では success しか観測されていないが、slashable 等が来た場合も
    // 生の method 名として上位（onLinkActivity → フロント）へ渡す。
    const tracker = new VcMetricsTracker();
    const text = (slashable: number) =>
      `vc_signed_beacon_blocks_total{status="slashable"} ${slashable}`;
    await pollVcNodeInternals(clientReturning(text(1)), target, tracker);
    const result = await pollVcNodeInternals(
      clientReturning(text(2)),
      target,
      tracker,
    );
    expect(result).toEqual([
      { method: "vc_signed_beacon_blocks_total:slashable", count: 1 },
    ]);
  });

  it("emits nothing when the duty counters vanish from a later poll", async () => {
    // VC が再起動して /metrics が出るようになったがまだ職務を果たしていない
    // 状態（カウンタ行そのものが消える）。前回値は保持されるが増分は出ない。
    const tracker = new VcMetricsTracker();
    await pollVcNodeInternals(clientReturning(dutyMetrics(4, 7)), target, tracker);
    const result = await pollVcNodeInternals(
      clientReturning("vc_validators_enabled_count 32"),
      target,
      tracker,
    );
    expect(result).toEqual([]);
  });
});
