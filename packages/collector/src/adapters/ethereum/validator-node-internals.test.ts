import type { NodeInternalsHandlers } from "@chainviz/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DockerPoller } from "../../docker/poller.js";
import { EthereumAdapter } from "./index.js";
import type { VcMetricsClient } from "./vc-metrics-client.js";
import { defaultBeaconSyncHttp } from "./test-helpers/beacon-http-fixtures.js";
import {
  beaconFixture,
  clientFrom,
  mutableClientFrom,
  rethFixture,
  validatorFixture,
} from "./test-helpers/docker-fixtures.js";
import {
  queuedVcMetricsClient,
  vcMetricsText,
} from "./test-helpers/vc-metrics-fixtures.js";

/**
 * Issue #420: subscribeNodeInternals（既存の D層周期ループ）に相乗りする
 * validator（VC）の職務メトリクス観測を検証する。reth 側の配線は
 * node-internals.test.ts が固定しているため、ここでは validator→beacon 方向
 * の onLinkActivity 配信・forgetNode の後始末に絞る（1ファイル1責務）。
 */
describe("EthereumAdapter.subscribeNodeInternals: validator (VC) duty activity (Issue #420)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("polls immediately; the first tick has no call delta yet (baseline only)", async () => {
    const poller = new DockerPoller(
      clientFrom([
        beaconFixture("beacon1", "172.28.2.1"),
        validatorFixture("validator1", "172.28.0.3"),
      ]),
    );
    const vcMetricsClient = queuedVcMetricsClient({
      "http://172.28.0.3:5064/metrics": [
        vcMetricsText({ blockProposalCount: 1, attestationCount: 4 }),
      ],
    });
    const adapter = new EthereumAdapter(poller, {
      vcMetricsClient,
      httpClient: defaultBeaconSyncHttp("172.28.2.1"),
      nodeInternalsPollIntervalMs: 3000,
    });
    const onInternals = vi.fn<NodeInternalsHandlers["onInternals"]>();
    const onLinkActivity = vi.fn<NodeInternalsHandlers["onLinkActivity"]>();

    await adapter.subscribeNodeInternals({ onInternals, onLinkActivity });
    await vi.advanceTimersByTimeAsync(0);

    // VC は internals（同期状態・mempool 相当）を持たないため onInternals は
    // 呼ばれない。
    expect(onInternals).not.toHaveBeenCalled();
    expect(onLinkActivity).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it("emits onLinkActivity on the second tick with the validator as fromNodeId and its beacon as toNodeId", async () => {
    const poller = new DockerPoller(
      clientFrom([
        beaconFixture("beacon1", "172.28.2.1"),
        validatorFixture("validator1", "172.28.0.3"),
      ]),
    );
    const vcMetricsClient = queuedVcMetricsClient({
      "http://172.28.0.3:5064/metrics": [
        vcMetricsText({
          blockProposalCount: 1,
          attestationCount: 4,
          blockSigningSumSeconds: 0.03,
        }),
        vcMetricsText({
          blockProposalCount: 2,
          attestationCount: 6,
          blockSigningSumSeconds: 0.09,
        }),
      ],
    });
    const adapter = new EthereumAdapter(poller, {
      vcMetricsClient,
      httpClient: defaultBeaconSyncHttp("172.28.2.1"),
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

    expect(onLinkActivity).toHaveBeenCalledWith({
      fromNodeId: "chainviz-ethereum/validator1",
      toNodeId: "chainviz-ethereum/beacon1",
      calls: expect.arrayContaining([
        {
          method: "vc_signed_beacon_blocks_total:success",
          count: 1,
          latencyMs: 60,
        },
        { method: "vc_signed_attestations_total:success", count: 2 },
      ]),
      observedAt: 999,
    });
    adapter.dispose();
  });

  it("drops call stats and logs when no beacon node can be paired with the observed validator", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // beacon が存在しない構成（対応する beacon の無い validator のみ）。
    const poller = new DockerPoller(
      clientFrom([validatorFixture("validator1", "172.28.0.3")]),
    );
    const vcMetricsClient = queuedVcMetricsClient({
      "http://172.28.0.3:5064/metrics": [
        vcMetricsText({ blockProposalCount: 1, attestationCount: 4 }),
        vcMetricsText({ blockProposalCount: 2, attestationCount: 6 }),
      ],
    });
    const adapter = new EthereumAdapter(poller, {
      vcMetricsClient,
      nodeInternalsPollIntervalMs: 3000,
    });
    const onLinkActivity = vi.fn<NodeInternalsHandlers["onLinkActivity"]>();

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity,
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);

    expect(onLinkActivity).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("chainviz-ethereum/validator1"),
    );
    adapter.dispose();
  });

  it("does not confuse the reth (execution) call activity with the validator call activity in the same tick", async () => {
    // 同じ D層 tick で reth 側（execution→beacon）と VC 側（validator→beacon）
    // の呼び出し活動が両方観測される環境で、互いを取り違えないことを確認する。
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        beaconFixture("beacon1", "172.28.2.1"),
        validatorFixture("validator1", "172.28.0.3"),
      ]),
    );
    const vcMetricsClient = queuedVcMetricsClient({
      "http://172.28.0.3:5064/metrics": [
        vcMetricsText({ blockProposalCount: 1, attestationCount: 4 }),
        vcMetricsText({ blockProposalCount: 2, attestationCount: 6 }),
      ],
    });
    // reth1 側は実ネットワークへフォールバックしないよう、空レスポンス
    // （「サンプルが1件も無い」縮退動作。呼び出し失敗としてログされるだけで
    // validator1 側の活動配信には影響しない）を返すモックにする。
    const rethMetricsClient = { getText: vi.fn().mockResolvedValue("") };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter = new EthereumAdapter(poller, {
      vcMetricsClient,
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
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);

    // reth1 側の /metrics はサンプルが読めず取得失敗としてログされるだけで、
    // validator1 側の活動配信には影響しない（Promise.all の並行処理が互いを
    // 巻き込まない）。
    expect(onLinkActivity).toHaveBeenCalledWith({
      fromNodeId: "chainviz-ethereum/validator1",
      toNodeId: "chainviz-ethereum/beacon1",
      calls: expect.arrayContaining([
        { method: "vc_signed_beacon_blocks_total:success", count: 1 },
        { method: "vc_signed_attestations_total:success", count: 2 },
      ]),
      observedAt: 999,
    });
    adapter.dispose();
  });

  it("resets the call baseline (via forgetNode) when a validator disappears and reappears", async () => {
    const validator1 = validatorFixture("validator1", "172.28.0.3");
    const beacon1 = beaconFixture("beacon1", "172.28.2.1");
    const fixtures = [validator1, beacon1];
    const client = mutableClientFrom(fixtures);
    const vcMetricsClient: VcMetricsClient = {
      getText: vi
        .fn()
        .mockResolvedValueOnce(
          vcMetricsText({ blockProposalCount: 100, attestationCount: 100 }),
        )
        .mockResolvedValueOnce(
          vcMetricsText({ blockProposalCount: 105, attestationCount: 108 }),
        )
        .mockResolvedValueOnce(
          vcMetricsText({ blockProposalCount: 3, attestationCount: 3 }),
        ),
    };
    const adapter = new EthereumAdapter(new DockerPoller(client), {
      vcMetricsClient,
      httpClient: defaultBeaconSyncHttp("172.28.2.1"),
      nodeInternalsPollIntervalMs: 3000,
      now: () => 999,
    });
    const onLinkActivity = vi.fn<NodeInternalsHandlers["onLinkActivity"]>();

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity,
    });
    // tick1: count=100/100 → ベースラインのみ(配信なし)。
    await vi.advanceTimersByTimeAsync(0);
    // tick2: count=105/108 → 増分を配信。
    await vi.advanceTimersByTimeAsync(3000);
    expect(onLinkActivity).toHaveBeenCalledTimes(1);

    // validator1 を観測から外す(tick3 で forgetNode が呼ばれ、getText は
    // 呼ばれない)。
    fixtures.length = 0;
    fixtures.push(beacon1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(onLinkActivity).toHaveBeenCalledTimes(1);

    // validator1 を再登場させる。tick4: count=3/3。forgetNode でベースラインが
    // 破棄されているため、これは再び初回観測となり、105→3 の巻き戻りを増分
    // として誤配信しない(配信なしのまま)。
    fixtures.push(validator1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(onLinkActivity).toHaveBeenCalledTimes(1);
    adapter.dispose();
  });
});
