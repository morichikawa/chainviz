import type { NodeInternalsHandlers } from "@chainviz/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DockerPoller } from "../../docker/poller.js";
import type { DockerClient } from "../../docker/types.js";
import { EthereumAdapter } from "./index.js";
import type { RethMetricsClient } from "./reth-metrics-client.js";
import { defaultBeaconSyncHttp } from "./test-helpers/beacon-http-fixtures.js";
import type { Fixture } from "./test-helpers/docker-fixtures.js";
import {
  beaconFixture,
  clientFrom,
  rethFixture,
  zeroStats,
} from "./test-helpers/docker-fixtures.js";
import {
  queuedRethMetricsClient,
  rethMetricsText,
} from "./test-helpers/reth-metrics-fixtures.js";

describe("EthereumAdapter.subscribeNodeInternals (Issue #186)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("polls immediately and emits onInternals; the first tick has no call delta yet", async () => {
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        beaconFixture("beacon1", "172.28.2.1"),
      ]),
    );
    const rethMetricsClient = queuedRethMetricsClient({
      "http://172.28.1.1:9001/metrics": [rethMetricsText(21)],
    });
    const adapter = new EthereumAdapter(poller, {
      rethMetricsClient,
      // Issue #274: 同じ D層 tick が beacon1 の同期状態も取得しにいくため、
      // 実ネットワークへフォールバックしないようモック HttpClient を渡す
      // （このテスト自体は同期状態の値を検証しないので既定の健全値でよい）。
      httpClient: defaultBeaconSyncHttp("172.28.2.1"),
      nodeInternalsPollIntervalMs: 3000,
    });
    const onInternals = vi.fn<NodeInternalsHandlers["onInternals"]>();
    const onLinkActivity = vi.fn<NodeInternalsHandlers["onLinkActivity"]>();

    await adapter.subscribeNodeInternals({ onInternals, onLinkActivity });
    await vi.advanceTimersByTimeAsync(0);

    expect(onInternals).toHaveBeenCalledWith("chainviz-ethereum/reth1", {
      syncStages: [{ stage: "Headers", checkpoint: 10 }],
      mempool: { pending: 1, queued: 0 },
    });
    // 初回はベースラインの記録のみ（Issue #185 の設計どおり）で、増分は
    // まだ計算できないため onLinkActivity は呼ばれない。
    expect(onLinkActivity).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it("emits onLinkActivity on the second tick with the resolved beacon as fromNodeId", async () => {
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        beaconFixture("beacon1", "172.28.2.1"),
      ]),
    );
    const rethMetricsClient = queuedRethMetricsClient({
      "http://172.28.1.1:9001/metrics": [
        rethMetricsText(21),
        rethMetricsText(23),
      ],
    });
    const adapter = new EthereumAdapter(poller, {
      rethMetricsClient,
      // Issue #274: 実ネットワークへフォールバックしないようモックする
      // （このテストは beacon の同期状態そのものは検証しない）。
      httpClient: defaultBeaconSyncHttp("172.28.2.1"),
      nodeInternalsPollIntervalMs: 3000,
      now: () => 999,
    });
    const onInternals = vi.fn<NodeInternalsHandlers["onInternals"]>();
    const onLinkActivity = vi.fn<NodeInternalsHandlers["onLinkActivity"]>();

    await adapter.subscribeNodeInternals({ onInternals, onLinkActivity });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);

    expect(onLinkActivity).toHaveBeenCalledWith({
      fromNodeId: "chainviz-ethereum/beacon1",
      toNodeId: "chainviz-ethereum/reth1",
      calls: [{ method: "engine_newPayloadV4", count: 2 }],
      observedAt: 999,
    });
    adapter.dispose();
  });

  it("drops call stats and logs when no beacon node can drive the observed execution node", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // beacon が存在しない構成（未対応の execution ノードのみ）。
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const rethMetricsClient = queuedRethMetricsClient({
      "http://172.28.1.1:9001/metrics": [
        rethMetricsText(21),
        rethMetricsText(23),
      ],
    });
    const adapter = new EthereumAdapter(poller, {
      rethMetricsClient,
      nodeInternalsPollIntervalMs: 3000,
    });
    const onInternals = vi.fn<NodeInternalsHandlers["onInternals"]>();
    const onLinkActivity = vi.fn<NodeInternalsHandlers["onLinkActivity"]>();

    await adapter.subscribeNodeInternals({ onInternals, onLinkActivity });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);

    // internals（syncStages/mempool）は beacon の有無に関わらず反映される。
    expect(onInternals).toHaveBeenCalledWith(
      "chainviz-ethereum/reth1",
      expect.objectContaining({ mempool: { pending: 1, queued: 0 } }),
    );
    // 駆動する beacon が解決できないので呼び出し活動は配信されない。
    expect(onLinkActivity).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("chainviz-ethereum/reth1"),
    );
    adapter.dispose();
  });

  it("stops polling after dispose()", async () => {
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        beaconFixture("beacon1", "172.28.2.1"),
      ]),
    );
    const rethMetricsClient = queuedRethMetricsClient({
      "http://172.28.1.1:9001/metrics": [
        rethMetricsText(21),
        rethMetricsText(23),
        rethMetricsText(25),
      ],
    });
    const adapter = new EthereumAdapter(poller, {
      rethMetricsClient,
      httpClient: defaultBeaconSyncHttp("172.28.2.1"),
      nodeInternalsPollIntervalMs: 3000,
    });
    const onInternals = vi.fn<NodeInternalsHandlers["onInternals"]>();

    await adapter.subscribeNodeInternals({
      onInternals,
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(onInternals).toHaveBeenCalledTimes(1);

    adapter.dispose();
    await vi.advanceTimersByTimeAsync(9000);
    // dispose 後はタイマーが解除され、追加の tick が走らない。
    expect(onInternals).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: a second subscribe does not start a second loop", async () => {
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        beaconFixture("beacon1", "172.28.2.1"),
      ]),
    );
    const pollSpy = vi.spyOn(poller, "pollOnce");
    const rethMetricsClient = queuedRethMetricsClient({
      "http://172.28.1.1:9001/metrics": [rethMetricsText(21)],
    });
    const adapter = new EthereumAdapter(poller, {
      rethMetricsClient,
      httpClient: defaultBeaconSyncHttp("172.28.2.1"),
      nodeInternalsPollIntervalMs: 3000,
    });

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    // 二重購読でも 1 巡分のポーリングしか走らない。
    expect(pollSpy).toHaveBeenCalledTimes(1);
    adapter.dispose();
  });

  it("keeps looping after a single node's metrics fetch fails", async () => {
    // pollRethNodeInternals 自身がエラーをログして undefined を返すため、
    // このノードの今回分の観測はスキップされるが、ループ自体は継続する。
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        beaconFixture("beacon1", "172.28.2.1"),
      ]),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rethMetricsClient: RethMetricsClient = {
      getText: vi
        .fn()
        .mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
        .mockResolvedValueOnce(rethMetricsText(21)),
    };
    const adapter = new EthereumAdapter(poller, {
      rethMetricsClient,
      httpClient: defaultBeaconSyncHttp("172.28.2.1"),
      nodeInternalsPollIntervalMs: 3000,
    });
    const onInternals = vi.fn<NodeInternalsHandlers["onInternals"]>();

    await adapter.subscribeNodeInternals({
      onInternals,
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(onInternals).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3000);
    expect(onInternals).toHaveBeenCalledTimes(1);
    adapter.dispose();
  });

  it("processes healthy nodes even when another node's fetch fails in the same tick", async () => {
    // 同一 tick 内で reth1 の取得が失敗しても、Promise.all で並行に処理される
    // reth2 の観測はそのまま反映される（部分的な失敗が他ノードを巻き込まない）。
    vi.spyOn(console, "error").mockImplementation(() => {});
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
      ]),
    );
    const rethMetricsClient: RethMetricsClient = {
      getText: vi.fn(async (url: string) => {
        if (url === "http://172.28.1.1:9001/metrics") {
          throw new Error("connect ECONNREFUSED");
        }
        if (url === "http://172.28.1.2:9001/metrics") {
          return rethMetricsText(21);
        }
        throw new Error(`unexpected url ${url}`);
      }),
    };
    const adapter = new EthereumAdapter(poller, {
      rethMetricsClient,
      nodeInternalsPollIntervalMs: 3000,
    });
    const onInternals = vi.fn<NodeInternalsHandlers["onInternals"]>();

    await adapter.subscribeNodeInternals({
      onInternals,
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    // reth2 だけが反映され、失敗した reth1 は今回分がスキップされる。
    expect(onInternals).toHaveBeenCalledTimes(1);
    expect(onInternals).toHaveBeenCalledWith(
      "chainviz-ethereum/reth2",
      expect.objectContaining({ mempool: { pending: 1, queued: 0 } }),
    );
    adapter.dispose();
  });

  it("emits onLinkActivity per node with each node's own beacon as fromNodeId", async () => {
    // 複数の EL/CL ペアが同居する環境で、各 execution ノードの呼び出し活動が
    // それぞれ自分の beacon を fromNodeId として配信され、ペアを取り違えない。
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        beaconFixture("beacon1", "172.28.2.1"),
        rethFixture("reth2", "172.28.1.2"),
        beaconFixture("beacon2", "172.28.2.2"),
      ]),
    );
    const rethMetricsClient = queuedRethMetricsClient({
      "http://172.28.1.1:9001/metrics": [
        rethMetricsText(21),
        rethMetricsText(23),
      ],
      "http://172.28.1.2:9001/metrics": [
        rethMetricsText(30),
        rethMetricsText(35),
      ],
    });
    const adapter = new EthereumAdapter(poller, {
      rethMetricsClient,
      httpClient: defaultBeaconSyncHttp("172.28.2.1", "172.28.2.2"),
      nodeInternalsPollIntervalMs: 3000,
      now: () => 999,
    });
    const onLinkActivity = vi.fn<NodeInternalsHandlers["onLinkActivity"]>();

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity,
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);

    expect(onLinkActivity).toHaveBeenCalledTimes(2);
    expect(onLinkActivity).toHaveBeenCalledWith({
      fromNodeId: "chainviz-ethereum/beacon1",
      toNodeId: "chainviz-ethereum/reth1",
      calls: [{ method: "engine_newPayloadV4", count: 2 }],
      observedAt: 999,
    });
    expect(onLinkActivity).toHaveBeenCalledWith({
      fromNodeId: "chainviz-ethereum/beacon2",
      toNodeId: "chainviz-ethereum/reth2",
      calls: [{ method: "engine_newPayloadV4", count: 5 }],
      observedAt: 999,
    });
    adapter.dispose();
  });

  it("resets the call baseline (via forgetNode) when a node disappears and reappears", async () => {
    // ノードが観測から消えると RethMetricsTracker.forgetNode() で前回値を破棄し、
    // 再登場時は再びベースラインからやり直す。これにより、再起動でカウンタが
    // 巻き戻った（3 < 105）ノードの再登場初回で誤った増分を配信しないことを
    // 固定する（forgetNode の配線確認）。
    const reth1 = rethFixture("reth1", "172.28.1.1");
    const beacon1 = beaconFixture("beacon1", "172.28.2.1");
    let fixtures: Fixture[] = [reth1, beacon1];
    const byId = new Map(
      [reth1, beacon1].map((f) => [f.summary.Id, f] as const),
    );
    const client: DockerClient = {
      listContainers: async () => fixtures.map((f) => f.summary),
      getContainer: (id: string) => ({
        top: async () =>
          byId.get(id)?.top ?? { Titles: ["CMD"], Processes: [] },
        stats: async () => zeroStats,
      }),
    };
    const rethMetricsClient = queuedRethMetricsClient({
      "http://172.28.1.1:9001/metrics": [
        rethMetricsText(100),
        rethMetricsText(105),
        rethMetricsText(3),
      ],
    });
    const adapter = new EthereumAdapter(new DockerPoller(client), {
      rethMetricsClient,
      httpClient: defaultBeaconSyncHttp("172.28.2.1"),
      nodeInternalsPollIntervalMs: 3000,
      now: () => 999,
    });
    const onLinkActivity = vi.fn<NodeInternalsHandlers["onLinkActivity"]>();

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity,
    });
    // tick1: count=100 → ベースラインのみ（配信なし）。
    await vi.advanceTimersByTimeAsync(0);
    // tick2: count=105 → 増分 5 を配信。
    await vi.advanceTimersByTimeAsync(3000);
    expect(onLinkActivity).toHaveBeenCalledTimes(1);

    // reth1 を観測から外す（tick3 で forgetNode が呼ばれ、getText は呼ばれない）。
    fixtures = [beacon1];
    await vi.advanceTimersByTimeAsync(3000);
    expect(onLinkActivity).toHaveBeenCalledTimes(1);

    // reth1 を再登場させる。tick4: count=3。forgetNode でベースラインが破棄
    // されているため、これは再び初回観測となり、105→3 の巻き戻りを増分として
    // 誤配信しない（配信なしのまま）。
    fixtures = [reth1, beacon1];
    await vi.advanceTimersByTimeAsync(3000);
    expect(onLinkActivity).toHaveBeenCalledTimes(1);
    adapter.dispose();
  });
});
