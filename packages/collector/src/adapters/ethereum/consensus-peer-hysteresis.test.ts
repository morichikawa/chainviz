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

const beacon1To3Edge = {
  kind: "peer",
  fromNodeId: "chainviz-ethereum/beacon1",
  toNodeId: "chainviz-ethereum/beacon3",
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

  it("recovers the edge after it actually dropped, then re-absorbs a fresh lone failure", async () => {
    // これまでの再アーム系テストは「猶予境界までしか失敗させずに成功」だが、
    // ここでは一度エッジが実際に消えたあとに成功で復活し、その直後の単発失敗を
    // また猶予で吸収できることを確認する（実運用の「恒久不調 → 回復 → 一時揺らぎ」
    // の遷移）。lastGood の破棄/再構築が壊れていると復活後の吸収が効かない。
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

    // 猶予を超えるまで失敗させ、エッジを実際に消す。
    failingIps = new Set(["172.28.9.2"]);
    for (let i = 1; i <= CONSENSUS_PEER_OBSERVATION_GRACE_TICKS + 1; i++) {
      await adapter.pollPeersOnce();
    }
    expect(await adapter.pollPeersOnce()).toEqual([]);

    // 成功でエッジが復活し lastGood が作り直される。
    failingIps = new Set();
    expect(await adapter.pollPeersOnce()).toEqual([beacon1Edge]);

    // 復活直後の単発失敗は、再び新しい猶予窓で吸収される。
    failingIps = new Set(["172.28.9.2"]);
    expect(await adapter.pollPeersOnce()).toEqual([beacon1Edge]);

    vi.restoreAllMocks();
  });

  it("keeps independent grace windows per node (one edge drops while another survives)", async () => {
    // あるノードの猶予超過が他ノードの猶予窓に干渉しないことを確認する。
    // beacon1 は常に成功し beacon2・beacon3 の両方に接続を報告する。beacon2 は
    // 早くから失敗し続けて先に猶予超過（自分の peerId が解決不能になり
    // beacon1-beacon2 エッジが消える）、beacon3 は遅れて失敗し始めるため、
    // 同じ poll 時点でも beacon3 側はまだ猶予内でエッジが維持される。
    vi.spyOn(console, "error").mockImplementation(() => {});
    const nodes = [
      { service: "beacon1", ip: "172.28.9.1" },
      { service: "beacon2", ip: "172.28.9.2" },
      { service: "beacon3", ip: "172.28.9.3" },
    ];
    const poller = new DockerPoller(multiBeaconClient(() => nodes));
    let failingIps = new Set<string>();
    const adapter = new EthereumAdapter(poller, {
      httpClient: beaconHttp(
        {
          "172.28.9.1": { peerId: "peer-1", connected: ["peer-2", "peer-3"] },
          "172.28.9.2": { peerId: "peer-2", connected: ["peer-1"] },
          "172.28.9.3": { peerId: "peer-3", connected: ["peer-1"] },
        },
        () => failingIps,
      ),
    });

    // tick 1: 全員成功。両エッジが張られる。
    expect(await adapter.pollPeersOnce()).toEqual([beacon1Edge, beacon1To3Edge]);

    // beacon2 を先に失敗させ始める（tick 2〜）。
    failingIps = new Set(["172.28.9.2"]);
    for (let i = 1; i <= CONSENSUS_PEER_OBSERVATION_GRACE_TICKS; i++) {
      await adapter.pollPeersOnce();
    }

    // このあと beacon2 は 4 回目（超過）、beacon3 は 1 回目（猶予内）で失敗する。
    // beacon2-エッジは消え、beacon3-エッジは維持される。
    failingIps = new Set(["172.28.9.2", "172.28.9.3"]);
    expect(await adapter.pollPeersOnce()).toEqual([beacon1To3Edge]);

    // beacon3 も自分の猶予（この時点で残り 2 tick）を使い切ると消える。
    // = beacon3 の窓は beacon2 の失敗履歴に引きずられず、自分の初回失敗から
    //   数えられている。
    expect(await adapter.pollPeersOnce()).toEqual([beacon1To3Edge]);
    expect(await adapter.pollPeersOnce()).toEqual([beacon1To3Edge]);
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
