import { afterEach, describe, expect, it, vi } from "vitest";
import type { RethMetricsClient } from "./reth-metrics-client.js";
import { RethMetricsTracker } from "./reth-metrics-tracker.js";
import { pollRethNodeInternals } from "./reth-node-internals.js";

function clientReturning(text: string): RethMetricsClient {
  return { getText: vi.fn(async () => text) };
}

function clientRejecting(err: unknown): RethMetricsClient {
  return {
    getText: vi.fn(async () => {
      throw err;
    }),
  };
}

const target = {
  stableId: "chainviz-ethereum/reth1",
  metricsUrl: "http://172.28.1.1:9001/metrics",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pollRethNodeInternals", () => {
  it("returns syncStages and mempool on a full, well-formed metrics response", async () => {
    const client = clientReturning(
      [
        'reth_sync_checkpoint{stage="Headers"} 21',
        'reth_sync_checkpoint{stage="Bodies"} 21',
        "reth_transaction_pool_pending_pool_transactions 2",
        "reth_transaction_pool_queued_pool_transactions 0",
      ].join("\n"),
    );
    const tracker = new RethMetricsTracker();
    const result = await pollRethNodeInternals(client, target, tracker);
    expect(result).toEqual({
      internals: {
        syncStages: [
          { stage: "Headers", checkpoint: 21 },
          { stage: "Bodies", checkpoint: 21 },
        ],
        mempool: { pending: 2, queued: 0 },
      },
      calls: [],
    });
  });

  it("omits internals entirely when neither syncStages nor mempool are present", async () => {
    const client = clientReturning("reth_process_threads 10");
    const tracker = new RethMetricsTracker();
    const result = await pollRethNodeInternals(client, target, tracker);
    expect(result).toEqual({ internals: undefined, calls: [] });
  });

  it("reports engine API call deltas via the tracker across two polls", async () => {
    const engineMetrics = (count: number) =>
      [
        "# HELP reth_engine_rpc_new_payload_v4 Latency for `engine_newPayloadV4`",
        "# TYPE reth_engine_rpc_new_payload_v4 summary",
        `reth_engine_rpc_new_payload_v4_count ${count}`,
      ].join("\n");
    const tracker = new RethMetricsTracker();

    const first = await pollRethNodeInternals(
      clientReturning(engineMetrics(21)),
      target,
      tracker,
    );
    expect(first?.calls).toEqual([]); // 初回はベースラインのみ。

    const second = await pollRethNodeInternals(
      clientReturning(engineMetrics(23)),
      target,
      tracker,
    );
    expect(second?.calls).toEqual([
      { method: "engine_newPayloadV4", count: 2 },
    ]);
  });

  it("returns undefined and logs when the HTTP fetch fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = clientRejecting(new Error("connect ECONNREFUSED"));
    const tracker = new RethMetricsTracker();
    const result = await pollRethNodeInternals(client, target, tracker);
    expect(result).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(target.stableId),
      expect.any(Error),
    );
  });

  it("keeps syncStages when mempool metrics are absent (partial degradation)", async () => {
    // 一部のメトリクスが欠けても、読めたフィールドは反映する。ここでは
    // syncStages だけ観測でき mempool は欠落しているケース。
    const client = clientReturning(
      'reth_sync_checkpoint{stage="Headers"} 42',
    );
    const tracker = new RethMetricsTracker();
    const result = await pollRethNodeInternals(client, target, tracker);
    expect(result).toEqual({
      internals: { syncStages: [{ stage: "Headers", checkpoint: 42 }] },
      calls: [],
    });
  });

  it("keeps mempool when syncStages metrics are absent (partial degradation)", async () => {
    const client = clientReturning(
      [
        "reth_transaction_pool_pending_pool_transactions 4",
        "reth_transaction_pool_queued_pool_transactions 1",
      ].join("\n"),
    );
    const tracker = new RethMetricsTracker();
    const result = await pollRethNodeInternals(client, target, tracker);
    expect(result).toEqual({
      internals: { mempool: { pending: 4, queued: 1 } },
      calls: [],
    });
  });

  it("omits mempool but keeps syncStages when mempool data is half-present", async () => {
    // pending だけあり queued が欠ける中途半端な mempool は丸ごと省き、
    // 正常に読めた syncStages は残す(片方の乱れが他方を巻き込まない)。
    const client = clientReturning(
      [
        'reth_sync_checkpoint{stage="Headers"} 42',
        "reth_transaction_pool_pending_pool_transactions 4",
      ].join("\n"),
    );
    const tracker = new RethMetricsTracker();
    const result = await pollRethNodeInternals(client, target, tracker);
    expect(result).toEqual({
      internals: { syncStages: [{ stage: "Headers", checkpoint: 42 }] },
      calls: [],
    });
  });

  it("still returns internals even when engine call parsing yields nothing", async () => {
    // syncStages/mempool は読めるが Engine API メソッドが 1 つも抽出できない
    // (HELP にメソッド名が無い等)場合でも、internals は正常に返る。
    const client = clientReturning(
      [
        'reth_sync_checkpoint{stage="Headers"} 7',
        "reth_transaction_pool_pending_pool_transactions 0",
        "reth_transaction_pool_queued_pool_transactions 0",
        "# HELP reth_engine_rpc_unknown A summary without a method name.",
        "# TYPE reth_engine_rpc_unknown summary",
        "reth_engine_rpc_unknown_count 3",
      ].join("\n"),
    );
    const tracker = new RethMetricsTracker();
    const result = await pollRethNodeInternals(client, target, tracker);
    expect(result).toEqual({
      internals: {
        syncStages: [{ stage: "Headers", checkpoint: 7 }],
        mempool: { pending: 0, queued: 0 },
      },
      calls: [],
    });
  });

  it("returns undefined and logs when the response has no parsable samples", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = clientReturning("");
    const tracker = new RethMetricsTracker();
    const result = await pollRethNodeInternals(client, target, tracker);
    expect(result).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(target.stableId),
    );
  });
});
