// Issue #288: `fetchConsensusPeerNodes`（CL/Beacon API 側のピアポーリング）が
// 1 回の問い合わせ失敗だけで PeerEdge を消していた不具合の回帰テスト。
// `pollPeersOnce` を経由した結合的なヒステリシス挙動（猶予内は維持・
// 猶予超過で消える・成功でカウントリセット・観測対象から外れたら即破棄）に
// 関心を絞る。`PeerObservationCache` 単体のロジックは
// peer-observation-cache.test.ts を、#287 のログ間引き自体の回帰は
// consensus-peer-poll-failure-log.test.ts を参照（CLAUDE.md「テストは
// 関心事ごとの分割を都度検討する」）。

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

/** 複数の beacon ノードを observe する DockerClient（observed で動的に増減可能）。 */
function multiBeaconClient(
  nodes: () => ReadonlyArray<{ service: string; ip: string }>,
): DockerClient {
  const top: DockerTopResult = { Titles: ["CMD"], Processes: [["lighthouse bn"]] };
  return {
    listContainers: async () => nodes().map((n) => beaconSummary(n.service, n.ip)),
    getContainer: () => ({ top: async () => top, stats: async () => zeroStats }),
  };
}

/**
 * baseUrl（IP）単位に identity/peers を差し込める HttpClient。`failing` の
 * IP は identity/peers いずれも例外を投げる。
 */
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

describe("EthereumAdapter consensus peer observation hysteresis (Issue #288)", () => {
  it("keeps the edge unchanged after a single failed poll (grace absorbs a lone timeout)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const nodes = [
      { service: "beacon1", ip: "172.28.9.1" },
      { service: "beacon2", ip: "172.28.9.2" },
    ];
    const poller = new DockerPoller(multiBeaconClient(() => nodes));
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

    // tick 1: 両方成功。エッジが張られ、両ノードの lastGood が記録される。
    expect(await adapter.pollPeersOnce()).toEqual([beacon1Edge]);

    // tick 2: beacon2 だけタイムアウト。猶予内なので lastGood を代用し、
    // エッジは消えない（フラッピングしない）。
    failingIps = new Set(["172.28.9.2"]);
    expect(await adapter.pollPeersOnce()).toEqual([beacon1Edge]);

    vi.restoreAllMocks();
  });

  it("keeps the edge through graceTicks consecutive failures and drops it on the next one (boundary)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const nodes = [
      { service: "beacon1", ip: "172.28.9.1" },
      { service: "beacon2", ip: "172.28.9.2" },
    ];
    const poller = new DockerPoller(multiBeaconClient(() => nodes));
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

    failingIps = new Set(["172.28.9.2"]);
    for (let i = 1; i <= CONSENSUS_PEER_OBSERVATION_GRACE_TICKS; i++) {
      expect(await adapter.pollPeersOnce()).toEqual([beacon1Edge]);
    }

    // graceTicks + 1 回目の連続失敗でようやくエッジが消える。
    expect(await adapter.pollPeersOnce()).toEqual([]);

    vi.restoreAllMocks();
  });

  it("re-arms the grace window after an intervening success", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const nodes = [
      { service: "beacon1", ip: "172.28.9.1" },
      { service: "beacon2", ip: "172.28.9.2" },
    ];
    const poller = new DockerPoller(multiBeaconClient(() => nodes));
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

    // graceTicks 回連続失敗（まだ消えない境界）。
    failingIps = new Set(["172.28.9.2"]);
    for (let i = 1; i <= CONSENSUS_PEER_OBSERVATION_GRACE_TICKS; i++) {
      await adapter.pollPeersOnce();
    }

    // 成功を 1 回挟む → カウントリセット。
    failingIps = new Set();
    expect(await adapter.pollPeersOnce()).toEqual([beacon1Edge]);

    // 再び graceTicks 回まではエッジが維持される。
    failingIps = new Set(["172.28.9.2"]);
    for (let i = 1; i <= CONSENSUS_PEER_OBSERVATION_GRACE_TICKS; i++) {
      expect(await adapter.pollPeersOnce()).toEqual([beacon1Edge]);
    }
    // 再度超過すれば消える。
    expect(await adapter.pollPeersOnce()).toEqual([]);

    vi.restoreAllMocks();
  });

  it("drops immediately when a node has never had a successful observation (no lastGood to fall back on)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const nodes = [{ service: "beacon1", ip: "172.28.9.1" }];
    const poller = new DockerPoller(multiBeaconClient(() => nodes));
    const adapter = new EthereumAdapter(poller, {
      httpClient: beaconHttp({}, () => new Set(["172.28.9.1"])),
    });

    // 初回から失敗し続けるノードは lastGood が無いため即座に観測から落ちる
    // （猶予の有無に関わらず従来どおり）。
    expect(await adapter.pollPeersOnce()).toEqual([]);
    expect(await adapter.pollPeersOnce()).toEqual([]);

    vi.restoreAllMocks();
  });

  it("discards the cached observation once a node leaves the target set (no zombie edge on re-add)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let nodes = [
      { service: "beacon1", ip: "172.28.9.1" },
      { service: "beacon2", ip: "172.28.9.2" },
    ];
    const poller = new DockerPoller(multiBeaconClient(() => nodes));
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

    // beacon2 が観測対象から消える（removeNode 相当）。
    nodes = [{ service: "beacon1", ip: "172.28.9.1" }];
    expect(await adapter.pollPeersOnce()).toEqual([]);

    // beacon2 が戻ってくるが、今回はタイムアウトする。キャッシュが prune で
    // 破棄されていれば lastGood が無いため即座に観測から落ちる
    // （破棄されていなければ古い lastGood がゾンビエッジとして復活する）。
    nodes = [
      { service: "beacon1", ip: "172.28.9.1" },
      { service: "beacon2", ip: "172.28.9.2" },
    ];
    failingIps = new Set(["172.28.9.2"]);
    expect(await adapter.pollPeersOnce()).toEqual([]);

    vi.restoreAllMocks();
  });
});
