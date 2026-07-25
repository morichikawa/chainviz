// Issue #420 テスト強化: D層周期ループへの validator 観測の配線のうち、
// 「複数 VC が同時に居る」「一方の観測だけが失敗する」「そもそも観測対象に
// ならない VC が居る」という組み合わせを固定する。単一 VC の基本配線・
// beacon 解決失敗・forgetNode は validator-node-internals.test.ts が持つので、
// ここは複数ノード時の取り違え防止に絞る（1ファイル1責務）。

import type { NodeInternalsHandlers } from "@chainviz/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DockerPoller } from "../../docker/poller.js";
import { EthereumAdapter } from "./index.js";
import { defaultBeaconSyncHttp } from "./test-helpers/beacon-http-fixtures.js";
import {
  beaconFixture,
  clientFrom,
  validatorFixture,
} from "./test-helpers/docker-fixtures.js";
import {
  queuedVcMetricsClient,
  vcMetricsText,
} from "./test-helpers/vc-metrics-fixtures.js";
import type { VcMetricsClient } from "./vc-metrics-client.js";

const V1_URL = "http://172.28.0.3:5064/metrics";
const V2_URL = "http://172.28.0.4:5064/metrics";

function twoNodeFixtures() {
  return [
    beaconFixture("beacon1", "172.28.2.1"),
    beaconFixture("beacon2", "172.28.2.2"),
    validatorFixture("validator1", "172.28.0.3"),
    validatorFixture("validator2", "172.28.0.4"),
  ];
}

function twoBeaconHttp() {
  return defaultBeaconSyncHttp("172.28.2.1", "172.28.2.2");
}

describe("EthereumAdapter.subscribeNodeInternals: multiple validators (Issue #420)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("pairs each validator with the beacon of its own node group", async () => {
    const vcMetricsClient = queuedVcMetricsClient({
      [V1_URL]: [
        vcMetricsText({ blockProposalCount: 1, attestationCount: 4 }),
        vcMetricsText({ blockProposalCount: 2, attestationCount: 6 }),
      ],
      [V2_URL]: [
        vcMetricsText({ blockProposalCount: 50, attestationCount: 50 }),
        vcMetricsText({ blockProposalCount: 50, attestationCount: 53 }),
      ],
    });
    const adapter = new EthereumAdapter(new DockerPoller(clientFrom(twoNodeFixtures())), {
      vcMetricsClient,
      httpClient: twoBeaconHttp(),
      nodeInternalsPollIntervalMs: 3000,
      now: () => 4242,
    });
    const onLinkActivity = vi.fn<NodeInternalsHandlers["onLinkActivity"]>();

    await adapter.subscribeNodeInternals({ onInternals: vi.fn(), onLinkActivity });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);

    expect(onLinkActivity).toHaveBeenCalledTimes(2);
    // validator1 → beacon1（提案 +1 / 証明 +2）。
    expect(onLinkActivity).toHaveBeenCalledWith({
      fromNodeId: "chainviz-ethereum/validator1",
      toNodeId: "chainviz-ethereum/beacon1",
      calls: expect.arrayContaining([
        { method: "vc_signed_beacon_blocks_total:success", count: 1 },
        { method: "vc_signed_attestations_total:success", count: 2 },
      ]),
      observedAt: 4242,
    });
    // validator2 → beacon2（提案は増えず、証明 +3 だけ）。
    expect(onLinkActivity).toHaveBeenCalledWith({
      fromNodeId: "chainviz-ethereum/validator2",
      toNodeId: "chainviz-ethereum/beacon2",
      calls: [{ method: "vc_signed_attestations_total:success", count: 3 }],
      observedAt: 4242,
    });
    adapter.dispose();
  });

  it("keeps delivering one validator's activity when the other validator's scrape fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const vcMetricsClient: VcMetricsClient = {
      getText: vi.fn(async (url: string) => {
        if (url === V2_URL) throw new Error("connect ECONNREFUSED 172.28.0.4:5064");
        return vcMetricsText({ blockProposalCount: 1, attestationCount: 4 });
      }),
    };
    const adapter = new EthereumAdapter(new DockerPoller(clientFrom(twoNodeFixtures())), {
      vcMetricsClient,
      httpClient: twoBeaconHttp(),
      nodeInternalsPollIntervalMs: 3000,
      now: () => 4242,
    });
    const onLinkActivity = vi.fn<NodeInternalsHandlers["onLinkActivity"]>();

    await adapter.subscribeNodeInternals({ onInternals: vi.fn(), onLinkActivity });
    await vi.advanceTimersByTimeAsync(0);
    // validator1 は同じ累積値を返し続けるので増分ゼロ = 配信なし。
    await vi.advanceTimersByTimeAsync(3000);
    expect(onLinkActivity).not.toHaveBeenCalled();

    // validator1 側だけ進んだ状態にする（validator2 は引き続き失敗）。
    (vcMetricsClient.getText as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string) => {
        if (url === V2_URL) throw new Error("connect ECONNREFUSED 172.28.0.4:5064");
        return vcMetricsText({ blockProposalCount: 3, attestationCount: 9 });
      },
    );
    await vi.advanceTimersByTimeAsync(3000);

    expect(onLinkActivity).toHaveBeenCalledTimes(1);
    expect(onLinkActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        fromNodeId: "chainviz-ethereum/validator1",
        toNodeId: "chainviz-ethereum/beacon1",
      }),
    );
    adapter.dispose();
  });

  it("does not scrape a validator container without an IP address", async () => {
    const noIpValidator = validatorFixture("validator2", "172.28.0.4");
    noIpValidator.summary.NetworkSettings = { Networks: {} };
    const vcMetricsClient = queuedVcMetricsClient({
      [V1_URL]: [
        vcMetricsText({ blockProposalCount: 1, attestationCount: 4 }),
        vcMetricsText({ blockProposalCount: 2, attestationCount: 6 }),
      ],
    });
    const adapter = new EthereumAdapter(
      new DockerPoller(
        clientFrom([
          beaconFixture("beacon1", "172.28.2.1"),
          beaconFixture("beacon2", "172.28.2.2"),
          validatorFixture("validator1", "172.28.0.3"),
          noIpValidator,
        ]),
      ),
      {
        vcMetricsClient,
        httpClient: twoBeaconHttp(),
        nodeInternalsPollIntervalMs: 3000,
        now: () => 4242,
      },
    );
    const onLinkActivity = vi.fn<NodeInternalsHandlers["onLinkActivity"]>();

    await adapter.subscribeNodeInternals({ onInternals: vi.fn(), onLinkActivity });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);

    // IP が取れない VC はそもそも対象集合に入らないため、キューに用意して
    // いない URL への GET（= 例外）も起きない。
    const urls = (vcMetricsClient.getText as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[0],
    );
    expect(new Set(urls)).toEqual(new Set([V1_URL]));
    expect(onLinkActivity).toHaveBeenCalledTimes(1);
    adapter.dispose();
  });

  it("does not scrape beacon or execution containers as validator metrics targets", async () => {
    const vcMetricsClient: VcMetricsClient = { getText: vi.fn(async () => "") };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter = new EthereumAdapter(
      new DockerPoller(
        clientFrom([
          beaconFixture("beacon1", "172.28.2.1"),
          validatorFixture("validator1", "172.28.0.3"),
        ]),
      ),
      {
        vcMetricsClient,
        httpClient: defaultBeaconSyncHttp("172.28.2.1"),
        nodeInternalsPollIntervalMs: 3000,
      },
    );

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    const urls = (vcMetricsClient.getText as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[0],
    );
    expect(urls).toEqual([V1_URL]);
    adapter.dispose();
  });
});
