import type { BlockEntity, PeerEdge } from "@chainviz/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DockerPoller } from "../../docker/poller.js";
import type {
  DockerClient,
  DockerContainerSummary,
  DockerStatsResult,
  DockerTopResult,
} from "../../docker/types.js";
import type {
  EthWsClient,
  NewHeadHeader,
  NewHeadsSubscription,
} from "./eth-ws-client.js";
import type { HttpClient } from "./http-client.js";
import { EthereumAdapter } from "./index.js";

const zeroStats: DockerStatsResult = {
  cpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
  precpu_stats: { cpu_usage: { total_usage: 0 } },
  memory_stats: {},
};

interface Fixture {
  summary: DockerContainerSummary;
  top: DockerTopResult;
}

function clientFrom(fixtures: Fixture[]): DockerClient {
  const byId = new Map(fixtures.map((f) => [f.summary.Id, f]));
  return {
    listContainers: async () => fixtures.map((f) => f.summary),
    getContainer: (id: string) => ({
      top: async () => byId.get(id)?.top ?? { Titles: ["CMD"], Processes: [] },
      stats: async () => zeroStats,
    }),
  };
}

function beaconFixture(
  service: string,
  ip: string,
  processName = "lighthouse bn",
): Fixture {
  return {
    summary: {
      Id: `id-${service}`,
      Names: [`/chainviz-ethereum-${service}-1`],
      Image: "sigp/lighthouse:latest",
      State: "running",
      Labels: {
        "com.docker.compose.project": "chainviz-ethereum",
        "com.docker.compose.service": service,
      },
      NetworkSettings: { Networks: { chain: { IPAddress: ip } } },
    },
    top: { Titles: ["CMD"], Processes: [[processName]] },
  };
}

function rethFixture(service: string, ip: string): Fixture {
  return {
    summary: {
      Id: `id-${service}`,
      Names: [`/chainviz-ethereum-${service}-1`],
      Image: "ghcr.io/paradigmxyz/reth:latest",
      State: "running",
      Labels: {
        "com.docker.compose.project": "chainviz-ethereum",
        "com.docker.compose.service": service,
      },
      NetworkSettings: { Networks: { chain: { IPAddress: ip } } },
    },
    top: { Titles: ["CMD"], Processes: [["reth node"]] },
  };
}

function gethFixture(service: string, ip: string): Fixture {
  return {
    summary: {
      Id: `id-${service}`,
      Names: [`/chainviz-ethereum-${service}-1`],
      Image: "ethereum/client-go:latest",
      State: "running",
      Labels: {
        "com.docker.compose.project": "chainviz-ethereum",
        "com.docker.compose.service": service,
      },
      NetworkSettings: { Networks: { chain: { IPAddress: ip } } },
    },
    top: { Titles: ["CMD"], Processes: [["geth"]] },
  };
}

/** baseUrl 単位に identity / peers レスポンスを差し込める HttpClient。 */
function beaconHttp(
  byBase: Record<string, { peerId: string; connected: string[] }>,
): HttpClient {
  return {
    getJson: vi.fn(async (url: string) => {
      for (const [base, data] of Object.entries(byBase)) {
        if (url === `${base}/eth/v1/node/identity`) {
          return { data: { peer_id: data.peerId } };
        }
        if (url === `${base}/eth/v1/node/peers?state=connected`) {
          return {
            data: data.connected.map((id) => ({
              peer_id: id,
              state: "connected",
            })),
          };
        }
      }
      throw new Error(`unexpected url ${url}`);
    }) as unknown as HttpClient["getJson"],
  };
}

/** 手動でヘッダを発火できる制御可能な EthWsClient。 */
function controllableWsClient(): {
  client: EthWsClient;
  emit: (wsUrl: string, header: NewHeadHeader) => void;
  closed: string[];
  subscribedUrls: string[];
} {
  const handlers = new Map<string, (h: NewHeadHeader) => void>();
  const closed: string[] = [];
  const subscribedUrls: string[] = [];
  const client: EthWsClient = {
    subscribeNewHeads(wsUrl, onHeader): NewHeadsSubscription {
      handlers.set(wsUrl, onHeader);
      subscribedUrls.push(wsUrl);
      return {
        close(): void {
          closed.push(wsUrl);
        },
      };
    },
  };
  return {
    client,
    emit: (wsUrl, header) => handlers.get(wsUrl)?.(header),
    closed,
    subscribedUrls,
  };
}

function header(overrides: Partial<NewHeadHeader> = {}): NewHeadHeader {
  return {
    hash: "0xblock1",
    number: "0x10",
    parentHash: "0xparent",
    timestamp: "0x64",
    ...overrides,
  };
}

describe("EthereumAdapter.pollPeersOnce", () => {
  it("polls beacon nodes and normalizes their connection into one edge", async () => {
    const poller = new DockerPoller(
      clientFrom([
        beaconFixture("beacon1", "172.28.2.1"),
        beaconFixture("beacon2", "172.28.2.2"),
      ]),
    );
    const http = beaconHttp({
      "http://172.28.2.1:5052": { peerId: "peer-1", connected: ["peer-2"] },
      "http://172.28.2.2:5052": { peerId: "peer-2", connected: ["peer-1"] },
    });
    const adapter = new EthereumAdapter(poller, { httpClient: http });

    const edges = await adapter.pollPeersOnce();
    expect(edges).toEqual([
      {
        kind: "peer",
        fromNodeId: "chainviz-ethereum/beacon1",
        toNodeId: "chainviz-ethereum/beacon2",
        networkId: "chainviz-ethereum-consensus",
      },
    ]);
  });

  it("ignores validator and execution containers", async () => {
    const poller = new DockerPoller(
      clientFrom([
        beaconFixture("beacon1", "172.28.2.1"),
        beaconFixture("validator1", "172.28.0.3", "lighthouse vc"),
        rethFixture("reth1", "172.28.1.1"),
      ]),
    );
    const http = beaconHttp({
      "http://172.28.2.1:5052": { peerId: "peer-1", connected: [] },
    });
    const getJson = http.getJson as ReturnType<typeof vi.fn>;
    const adapter = new EthereumAdapter(poller, { httpClient: http });

    await adapter.pollPeersOnce();
    // beacon1 の identity / peers の 2 回だけ。validator/reth は問い合わせない。
    const urls = getJson.mock.calls.map((c) => c[0] as string);
    expect(urls).toEqual([
      "http://172.28.2.1:5052/eth/v1/node/identity",
      "http://172.28.2.1:5052/eth/v1/node/peers?state=connected",
    ]);
  });

  it("keeps other beacon nodes when one fails to respond", async () => {
    const poller = new DockerPoller(
      clientFrom([
        beaconFixture("beacon1", "172.28.2.1"),
        beaconFixture("beacon2", "172.28.2.2"),
        beaconFixture("beacon3", "172.28.2.3"),
      ]),
    );
    const http: HttpClient = {
      getJson: (async (url: string) => {
        if (url.startsWith("http://172.28.2.2:5052")) {
          throw new Error("beacon2 down");
        }
        if (url.startsWith("http://172.28.2.1:5052")) {
          return url.includes("identity")
            ? { data: { peer_id: "peer-1" } }
            : { data: [{ peer_id: "peer-3", state: "connected" }] };
        }
        if (url.startsWith("http://172.28.2.3:5052")) {
          return url.includes("identity")
            ? { data: { peer_id: "peer-3" } }
            : { data: [{ peer_id: "peer-1", state: "connected" }] };
        }
        throw new Error(`unexpected ${url}`);
      }) as HttpClient["getJson"],
    };
    const adapter = new EthereumAdapter(poller, { httpClient: http });

    const edges = await adapter.pollPeersOnce();
    // beacon2 が落ちても beacon1<->beacon3 のエッジは得られる。
    expect(edges).toEqual([
      {
        kind: "peer",
        fromNodeId: "chainviz-ethereum/beacon1",
        toNodeId: "chainviz-ethereum/beacon3",
        networkId: "chainviz-ethereum-consensus",
      },
    ]);
  });

  it("returns no edges when there are no beacon nodes", async () => {
    const poller = new DockerPoller(clientFrom([rethFixture("reth1", "1.1.1.1")]));
    const adapter = new EthereumAdapter(poller, {
      httpClient: beaconHttp({}),
    });
    expect(await adapter.pollPeersOnce()).toEqual([]);
  });
});

describe("EthereumAdapter.subscribePeers", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("polls immediately and then on the configured interval", async () => {
    const poller = new DockerPoller(
      clientFrom([beaconFixture("beacon1", "172.28.2.1")]),
    );
    const http = beaconHttp({
      "http://172.28.2.1:5052": { peerId: "peer-1", connected: [] },
    });
    const adapter = new EthereumAdapter(poller, {
      httpClient: http,
      peerPollIntervalMs: 3000,
    });
    const onUpdate = vi.fn<(edges: PeerEdge[]) => void>();

    adapter.subscribePeers(onUpdate);
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(onUpdate).toHaveBeenCalledTimes(2);

    adapter.dispose();
    await vi.advanceTimersByTimeAsync(9000);
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it("keeps looping after a failed poll", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const failingPoller = {
      pollOnce: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new Error("docker down");
        return [];
      }),
    } as unknown as DockerPoller;
    const adapter = new EthereumAdapter(failingPoller, {
      httpClient: beaconHttp({}),
      peerPollIntervalMs: 3000,
    });
    const onUpdate = vi.fn();

    adapter.subscribePeers(onUpdate);
    await vi.advanceTimersByTimeAsync(0);
    // 1 回目は失敗するので onUpdate は呼ばれない
    expect(onUpdate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3000);
    // 2 回目は成功して onUpdate が呼ばれる（ループは止まっていない）
    expect(onUpdate).toHaveBeenCalledTimes(1);
    adapter.dispose();
  });

  it("is idempotent: a second subscribe does not start a second loop", async () => {
    const poller = new DockerPoller(
      clientFrom([beaconFixture("beacon1", "172.28.2.1")]),
    );
    const pollSpy = vi.spyOn(poller, "pollOnce");
    const adapter = new EthereumAdapter(poller, {
      httpClient: beaconHttp({
        "http://172.28.2.1:5052": { peerId: "peer-1", connected: [] },
      }),
      peerPollIntervalMs: 3000,
    });

    adapter.subscribePeers(vi.fn());
    adapter.subscribePeers(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    // 二重購読でも 1 巡分のポーリングしか走らない
    expect(pollSpy).toHaveBeenCalledTimes(1);
    adapter.dispose();
  });
});

describe("EthereumAdapter.subscribeBlocks", () => {
  it("subscribes to every execution node and keys receivedAt by the matching beacon", async () => {
    // 実 profile と同じ構成: reth1/beacon1、reth2/beacon2 が同じ論理ノード。
    // PeerEdge の端点は beacon の stableId なので、receivedAt のキーも
    // reth 自身ではなく対応する beacon の stableId に揃うことを確認する。
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
        beaconFixture("beacon1", "172.28.2.1"),
        beaconFixture("beacon2", "172.28.2.2"),
      ]),
    );
    const ws = controllableWsClient();
    let clock = 1000;
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      now: () => clock,
    });
    const blocks: BlockEntity[] = [];

    await adapter.subscribeBlocks((b) => blocks.push(b));
    // reth1/reth2 だけ購読、beacon は対象外。
    expect(ws.subscribedUrls).toEqual([
      "ws://172.28.1.1:8546",
      "ws://172.28.1.2:8546",
    ]);

    ws.emit("ws://172.28.1.1:8546", header());
    clock = 1200;
    ws.emit("ws://172.28.1.2:8546", header());

    expect(blocks).toHaveLength(2);
    // 2 回目には両ノードの受信時刻が、対応する beacon のキーでマージされている。
    expect(blocks[1].receivedAt).toEqual({
      "chainviz-ethereum/beacon1": 1000,
      "chainviz-ethereum/beacon2": 1200,
    });
    expect(blocks[1].number).toBe(16);
    expect(blocks[1].hash).toBe("0xblock1");
  });

  it("falls back to the execution node's own stableId when it has no beacon", async () => {
    // beacon を持たない EL only 構成では reth 自身の stableId をキーにする。
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      now: () => 1000,
    });
    const blocks: BlockEntity[] = [];

    await adapter.subscribeBlocks((b) => blocks.push(b));
    ws.emit("ws://172.28.1.1:8546", header());

    expect(blocks[0].receivedAt).toEqual({
      "chainviz-ethereum/reth1": 1000,
    });
  });

  it("keys receivedAt by each execution node's own stableId when none have a beacon", async () => {
    // beacon が一切無い EL only 構成では、両ノードとも自身の stableId をキーに
    // する。同一ブロックを両ノードが受信すると 2 つの独立したキーで束ねられる。
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
      ]),
    );
    const ws = controllableWsClient();
    let clock = 1000;
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      now: () => clock,
    });
    const blocks: BlockEntity[] = [];

    await adapter.subscribeBlocks((b) => blocks.push(b));
    ws.emit("ws://172.28.1.1:8546", header());
    clock = 1300;
    ws.emit("ws://172.28.1.2:8546", header());

    expect(blocks[1].receivedAt).toEqual({
      "chainviz-ethereum/reth1": 1000,
      "chainviz-ethereum/reth2": 1300,
    });
  });

  it("mixes beacon-keyed and self-keyed receivedAt within one block", async () => {
    // reth1 は beacon1 に対応するが reth2 は対応 beacon が無い。同一ブロックの
    // receivedAt には beacon1 のキーと reth2 自身のキーが混在する。
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
        beaconFixture("beacon1", "172.28.2.1"),
      ]),
    );
    const ws = controllableWsClient();
    let clock = 1000;
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      now: () => clock,
    });
    const blocks: BlockEntity[] = [];

    await adapter.subscribeBlocks((b) => blocks.push(b));
    ws.emit("ws://172.28.1.1:8546", header());
    clock = 1400;
    ws.emit("ws://172.28.1.2:8546", header());

    expect(blocks[1].receivedAt).toEqual({
      "chainviz-ethereum/beacon1": 1000,
      "chainviz-ethereum/reth2": 1400,
    });
  });

  it("collapses receivedAt to one key when two execution nodes share a beacon (first receipt wins)", async () => {
    // reth1 と geth1 はノード群キーがともに "1" なので、両方が beacon1 に
    // 対応付く（receivedAtKey が同一）。同一ブロックを両ノードが受信しても
    // receivedAt は beacon1 の 1 キーに畳まれ、最初の受信時刻だけが残る。
    // 現状の BlockPropagationTracker（キーごとに初回優先）と受信キー設計の
    // 組み合わせで生じる挙動を固定する。
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        gethFixture("geth1", "172.28.1.9"),
        beaconFixture("beacon1", "172.28.2.1"),
      ]),
    );
    const ws = controllableWsClient();
    let clock = 1000;
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      now: () => clock,
    });
    const blocks: BlockEntity[] = [];

    await adapter.subscribeBlocks((b) => blocks.push(b));
    ws.emit("ws://172.28.1.1:8546", header());
    clock = 1500;
    ws.emit("ws://172.28.1.9:8546", header());

    // 2 回目の受信でもキーは beacon1 のみ、時刻は初回の 1000 のまま。
    expect(blocks[1].receivedAt).toEqual({
      "chainviz-ethereum/beacon1": 1000,
    });
  });

  it("closes all subscriptions on dispose", async () => {
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
      ]),
    );
    const ws = controllableWsClient();
    const adapter = new EthereumAdapter(poller, { ethWsClient: ws.client });

    await adapter.subscribeBlocks(() => {});
    adapter.dispose();
    expect(ws.closed).toEqual([
      "ws://172.28.1.1:8546",
      "ws://172.28.1.2:8546",
    ]);
  });

  it("does not subscribe when there are no execution nodes", async () => {
    const poller = new DockerPoller(
      clientFrom([beaconFixture("beacon1", "172.28.2.1")]),
    );
    const ws = controllableWsClient();
    const adapter = new EthereumAdapter(poller, { ethWsClient: ws.client });
    await adapter.subscribeBlocks(() => {});
    expect(ws.subscribedUrls).toEqual([]);
  });
});
