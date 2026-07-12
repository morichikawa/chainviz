// Issue #287（ログ間引き: CONSENSUS_PEER_POLL_FAILURE_LOG_INTERVAL 回に 1 回）と
// Issue #288（観測ヒステリシス: CONSENSUS_PEER_OBSERVATION_GRACE_TICKS 回まで
// エッジ維持）は、いずれも同じ「連続失敗回数」カウンタ（PeerObservationCache が
// 一元管理）から、周期の異なる 2 つの独立した閾値で判定される。この 2 つが
// 互いに干渉しないこと（例: 猶予超過でエッジが消えてもログ間引きの周期が
// リセット・停止しない、逆にログを出す tick で猶予判定が乱れない）を、
// エッジ表示とログ出力の両方を同時に観測して確認する。
//
// ログ間引き単体の回帰は consensus-peer-poll-failure-log.test.ts、
// ヒステリシス単体の回帰は consensus-peer-hysteresis.test.ts を参照
// （CLAUDE.md「テストは関心事ごとの分割を都度検討する」）。この 2 つの
// 交差（共有カウンタの独立性）に関心を絞るため別ファイルとする。

import { describe, expect, it, vi } from "vitest";
import { DockerPoller } from "../../docker/poller.js";
import type {
  DockerClient,
  DockerContainerSummary,
  DockerStatsResult,
  DockerTopResult,
} from "../../docker/types.js";
import type { HttpClient } from "./http-client.js";
import {
  CONSENSUS_PEER_OBSERVATION_GRACE_TICKS,
  CONSENSUS_PEER_POLL_FAILURE_LOG_INTERVAL,
  EthereumAdapter,
} from "./index.js";

const zeroStats: DockerStatsResult = {
  cpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
  precpu_stats: { cpu_usage: { total_usage: 0 } },
  memory_stats: {},
};

function beaconSummary(service: string, ip: string): DockerContainerSummary {
  return {
    Id: `id-${service}`,
    Names: [`/chainviz-ethereum-${service}-1`],
    Image: "sigp/lighthouse:latest",
    State: "running",
    Labels: {
      "com.docker.compose.project": "chainviz-ethereum",
      "com.docker.compose.service": service,
    },
    NetworkSettings: { Networks: { chain: { IPAddress: ip } } },
  };
}

function multiBeaconClient(
  nodes: ReadonlyArray<{ service: string; ip: string }>,
): DockerClient {
  const summaries = nodes.map((n) => beaconSummary(n.service, n.ip));
  const top: DockerTopResult = { Titles: ["CMD"], Processes: [["lighthouse bn"]] };
  return {
    listContainers: async () => summaries,
    getContainer: () => ({ top: async () => top, stats: async () => zeroStats }),
  };
}

function beaconHttp(
  peers: Record<string, { peerId: string; connected: string[] }>,
  failingIps: () => ReadonlySet<string>,
): HttpClient {
  return {
    getJson: (async (url: string) => {
      const ip = new URL(url).hostname;
      if (failingIps().has(ip)) throw new Error(`beacon ${ip} unreachable`);
      const data = peers[ip];
      if (!data) throw new Error(`unexpected ip ${ip}`);
      if (url.endsWith("/eth/v1/node/identity")) {
        return { data: { peer_id: data.peerId } };
      }
      if (url.endsWith("/eth/v1/node/peers?state=connected")) {
        return {
          data: data.connected.map((id) => ({ peer_id: id, state: "connected" })),
        };
      }
      if (url.endsWith("/eth/v1/node/syncing")) {
        return {
          data: {
            is_syncing: false,
            is_optimistic: false,
            el_offline: false,
            head_slot: "0",
          },
        };
      }
      throw new Error(`unexpected url ${url}`);
    }) as HttpClient["getJson"],
  };
}

const beacon1Edge = {
  kind: "peer",
  fromNodeId: "chainviz-ethereum/beacon1",
  toNodeId: "chainviz-ethereum/beacon2",
  networkId: "chainviz-ethereum-consensus",
};

describe("EthereumAdapter consensus peer counter interaction (#287 log vs #288 grace)", () => {
  it("drops the edge at the grace boundary but still throttles logs on the separate log cycle", async () => {
    // 前提: このテストは GRACE(3) < LOG_INTERVAL(20) で意味を持つ。両者が同じ
    // 値だと「独立していること」を区別できないため、まず不変条件を明示する。
    expect(CONSENSUS_PEER_OBSERVATION_GRACE_TICKS).toBeLessThan(
      CONSENSUS_PEER_POLL_FAILURE_LOG_INTERVAL,
    );

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const nodes = [
      { service: "beacon1", ip: "172.28.9.1" },
      { service: "beacon2", ip: "172.28.9.2" },
    ];
    const poller = new DockerPoller(multiBeaconClient(nodes));
    let failingIps = new Set<string>();
    const adapter = new EthereumAdapter(poller, {
      httpClient: beaconHttp(
        {
          "172.28.9.1": { peerId: "peer-1", connected: ["peer-2"] },
          "172.28.9.2": { peerId: "peer-2", connected: ["peer-1"] },
        },
        () => failingIps,
      ),
    });

    // tick 0: 両方成功。beacon2 の lastGood が記録され、失敗カウントは 0。
    await adapter.pollPeersOnce();

    // 以降 beacon2 を LOG_INTERVAL 回連続で失敗させ、各 tick のエッジ有無と
    // ログ発火を記録する。
    failingIps = new Set(["172.28.9.2"]);
    const interval = CONSENSUS_PEER_POLL_FAILURE_LOG_INTERVAL;
    const edgePresentAt: number[] = [];
    const loggedAt: number[] = [];
    for (let i = 1; i <= interval; i++) {
      errSpy.mockClear();
      const edges = await adapter.pollPeersOnce();
      if (edges.length > 0) edgePresentAt.push(i);
      if (errSpy.mock.calls.length > 0) loggedAt.push(i);
    }

    // 猶予（3）: エッジは連続失敗 1〜3 回目まで維持され、4 回目以降は消える。
    const grace = CONSENSUS_PEER_OBSERVATION_GRACE_TICKS;
    expect(edgePresentAt).toEqual(
      Array.from({ length: grace }, (_, k) => k + 1),
    );

    // ログ間引き（20）: エッジが 4 回目で消えても、ログ周期は別カウンタとして
    // 継続し、1 回目と 20 回目にだけ発火する（猶予超過でリセットされない）。
    expect(loggedAt).toEqual([1, interval]);

    vi.restoreAllMocks();
  });

  it("resets both the grace window and the log cycle together on a success", async () => {
    // 成功は共有カウンタを 0 に戻すので、猶予窓とログ周期が「同時に」
    // 初期化されること（片方だけ残る取り違えが無いこと）を確認する。
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const nodes = [
      { service: "beacon1", ip: "172.28.9.1" },
      { service: "beacon2", ip: "172.28.9.2" },
    ];
    const poller = new DockerPoller(multiBeaconClient(nodes));
    let failingIps = new Set<string>();
    const adapter = new EthereumAdapter(poller, {
      httpClient: beaconHttp(
        {
          "172.28.9.1": { peerId: "peer-1", connected: ["peer-2"] },
          "172.28.9.2": { peerId: "peer-2", connected: ["peer-1"] },
        },
        () => failingIps,
      ),
    });

    await adapter.pollPeersOnce();

    // 猶予を超えるまで失敗させる（エッジは消え、1 回目のログが出ている）。
    failingIps = new Set(["172.28.9.2"]);
    for (let i = 1; i <= CONSENSUS_PEER_OBSERVATION_GRACE_TICKS + 1; i++) {
      await adapter.pollPeersOnce();
    }
    expect(await adapter.pollPeersOnce()).toEqual([]);

    // 成功でカウントリセット。エッジが戻る。
    failingIps = new Set();
    expect(await adapter.pollPeersOnce()).toEqual([beacon1Edge]);

    // リセット後の最初の失敗は、ログ周期でも「1 回目」として必ず発火し
    // （間引かれない）、かつ猶予でエッジは維持される。
    failingIps = new Set(["172.28.9.2"]);
    errSpy.mockClear();
    expect(await adapter.pollPeersOnce()).toEqual([beacon1Edge]);
    expect(errSpy).toHaveBeenCalledTimes(1);
    const [message] = errSpy.mock.calls[0] ?? [];
    expect(message).not.toContain("consecutive failures");

    vi.restoreAllMocks();
  });
});
