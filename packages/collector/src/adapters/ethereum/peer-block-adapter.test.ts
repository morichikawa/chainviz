import type {
  BlockEntity,
  ContractEntity,
  NodeInternalsHandlers,
  PeerEdge,
  TransactionEntity,
} from "@chainviz/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DockerPoller } from "../../docker/poller.js";
import type {
  DockerClient,
  DockerContainerSummary,
  DockerStatsResult,
  DockerTopResult,
} from "../../docker/types.js";
import type { ContractCatalog } from "./catalog.js";
import type { EthRpcClient, RpcTransaction } from "./eth-rpc-client.js";
import type {
  EthWsClient,
  NewHeadHeader,
  Subscription,
} from "./eth-ws-client.js";
import type { HttpClient } from "./http-client.js";
import { EthereumAdapter } from "./index.js";
import type { RethMetricsClient } from "./reth-metrics-client.js";

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

/**
 * rpcUrl 単位に admin_nodeInfo / admin_peers のレスポンス（または例外）を
 * 差し込める EthRpcClient。値は enode URL の生レスポンス形（`{ enode }`）や
 * ピア配列（`[{ enode }, ...]`）をそのまま渡す想定（正規化は el-peers.ts 側）。
 */
function elRpcClient(
  byUrl: Record<
    string,
    {
      nodeInfo?: unknown;
      nodeInfoError?: Error;
      peers?: unknown;
      peersError?: Error;
    }
  >,
): EthRpcClient {
  return {
    async call<T>(url: string, method: string): Promise<T> {
      const cfg = byUrl[url];
      if (!cfg) throw new Error(`unexpected url ${url}`);
      if (method === "admin_nodeInfo") {
        if (cfg.nodeInfoError) throw cfg.nodeInfoError;
        return cfg.nodeInfo as T;
      }
      if (method === "admin_peers") {
        if (cfg.peersError) throw cfg.peersError;
        return (cfg.peers ?? []) as T;
      }
      throw new Error(`unexpected method ${method}`);
    },
  };
}

/** enode URL を組み立てる（128 桁 16 進の公開鍵を 1 バイトで埋める）。 */
function enodeUrl(pubkeyByte: string, ip: string): string {
  return `enode://${pubkeyByte.repeat(64)}@${ip}:30303`;
}

/**
 * `getText(url)` 呼び出しごとに、URL 単位で用意したレスポンスを先頭から
 * 1 件ずつ消費して返す `RethMetricsClient`（Issue #186）。同一 URL への
 * 2 回目以降の呼び出し（周期ポーリングの複数 tick）で異なる累積値を返す
 * ことで、`RethMetricsTracker` の増分計算をテストする。キューが尽きた URL
 * への呼び出しは例外を投げる。
 */
function queuedRethMetricsClient(
  byUrl: Record<string, string[]>,
): RethMetricsClient {
  return {
    getText: vi.fn(async (url: string) => {
      const queue = byUrl[url];
      if (!queue || queue.length === 0) {
        throw new Error(`no more reth metrics responses queued for ${url}`);
      }
      return queue.shift() as string;
    }),
  };
}

/** reth の `/metrics` レスポンス（Prometheus テキスト形式）を組み立てる。 */
function rethMetricsText(engineCallCount: number): string {
  return [
    "# HELP reth_engine_rpc_new_payload_v4 Latency for `engine_newPayloadV4`",
    "# TYPE reth_engine_rpc_new_payload_v4 summary",
    `reth_engine_rpc_new_payload_v4_count ${engineCallCount}`,
    'reth_sync_checkpoint{stage="Headers"} 10',
    "reth_transaction_pool_pending_pool_transactions 1",
    "reth_transaction_pool_queued_pool_transactions 0",
  ].join("\n");
}

/** 手動でヘッダ・pending tx を発火できる制御可能な EthWsClient。 */
function controllableWsClient(): {
  client: EthWsClient;
  emit: (wsUrl: string, header: NewHeadHeader) => void;
  emitPending: (wsUrl: string, hash: string) => void;
  closed: string[];
  subscribedUrls: string[];
  pendingSubscribedUrls: string[];
} {
  // 同じ wsUrl に newHeads が複数回購読される（B 層と C 層）ので配列で保持する。
  const headHandlers = new Map<string, ((h: NewHeadHeader) => void)[]>();
  const pendingHandlers = new Map<string, (hash: string) => void>();
  const closed: string[] = [];
  const subscribedUrls: string[] = [];
  const pendingSubscribedUrls: string[] = [];
  const client: EthWsClient = {
    subscribeNewHeads(wsUrl, onHeader): Subscription {
      const list = headHandlers.get(wsUrl) ?? [];
      list.push(onHeader);
      headHandlers.set(wsUrl, list);
      subscribedUrls.push(wsUrl);
      return {
        close(): void {
          closed.push(wsUrl);
        },
      };
    },
    subscribePendingTransactions(wsUrl, onTxHash): Subscription {
      pendingHandlers.set(wsUrl, onTxHash);
      pendingSubscribedUrls.push(wsUrl);
      return {
        close(): void {
          closed.push(`pending:${wsUrl}`);
        },
      };
    },
  };
  return {
    client,
    emit: (wsUrl, header) => {
      for (const handler of headHandlers.get(wsUrl) ?? []) handler(header);
    },
    emitPending: (wsUrl, hash) => pendingHandlers.get(wsUrl)?.(hash),
    closed,
    subscribedUrls,
    pendingSubscribedUrls,
  };
}

/**
 * eth_getBlockReceipts の生の JSON-RPC レスポンス形状(正規化前)。stubRpcClient
 * は実際の HTTP レスポンス相当を返し、EthereumAdapter 経由で呼ばれる本物の
 * getBlockReceipts(normalizeReceipt を含む)がそれを正規化する。
 */
interface RawReceiptFixture {
  transactionHash: string;
  from: string;
  to: string | null;
  /** "0x1"(成功) / "0x0"(失敗)。省略時は成功扱い。 */
  status?: string;
  /** コントラクト作成 tx でのみ非 null（Issue #160）。 */
  contractAddress?: string | null;
  /** tx が発したイベントログ（未復号の生データ、Issue #160）。 */
  logs?: { address: string; topics: string[]; data: string }[];
}

/** eth_getTransactionByHash / eth_getBlockReceipts を固定データで返すスタブ。 */
function stubRpcClient(data: {
  txs?: Record<string, RpcTransaction | null>;
  blocks?: Record<string, RawReceiptFixture[] | null>;
}): {
  client: EthRpcClient;
  txCalls: string[];
  blockCalls: string[];
} {
  const txCalls: string[] = [];
  const blockCalls: string[] = [];
  const client: EthRpcClient = {
    async call<T>(_url: string, method: string, params: unknown[]): Promise<T> {
      if (method === "eth_getTransactionByHash") {
        const hash = params[0] as string;
        txCalls.push(hash);
        return (data.txs?.[hash] ?? null) as T;
      }
      if (method === "eth_getBlockReceipts") {
        const blockHash = params[0] as string;
        blockCalls.push(blockHash);
        return (data.blocks?.[blockHash] ?? null) as T;
      }
      throw new Error(`unexpected RPC method ${method}`);
    },
  };
  return { client, txCalls, blockCalls };
}

/** 非同期ハンドラ（handlePendingTx / handleBlockInclusion）の解決を待つ。 */
async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
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

  it("excludes the validator from Beacon API polling but still polls the execution node via admin_*", async () => {
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
    const rpc = elRpcClient({
      "http://172.28.1.1:8545": {
        nodeInfo: { enode: enodeUrl("11", "172.28.1.1") },
        peers: [],
      },
    });
    const adapter = new EthereumAdapter(poller, { httpClient: http, ethRpcClient: rpc });

    await adapter.pollPeersOnce();
    // Beacon API は beacon1 の identity / peers の 2 回だけ。validator は
    // Beacon API を持たないため対象外（reth は EL 側の admin_* で別途扱う）。
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

  it("returns no edges when there are no beacon nodes and the lone execution node has no peers", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const poller = new DockerPoller(clientFrom([rethFixture("reth1", "1.1.1.1")]));
    const adapter = new EthereumAdapter(poller, {
      httpClient: beaconHttp({}),
      // 単独ノードなので admin_peers は空でよい。identity は必要。
      ethRpcClient: elRpcClient({
        "http://1.1.1.1:8545": {
          nodeInfo: { enode: enodeUrl("11", "1.1.1.1") },
          peers: [],
        },
      }),
    });
    expect(await adapter.pollPeersOnce()).toEqual([]);
    vi.restoreAllMocks();
  });
});

describe("EthereumAdapter.pollPeersOnce (EL / reth admin_peers)", () => {
  it("polls execution nodes and normalizes their admin_peers connection into one edge", async () => {
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
      ]),
    );
    const rpc = elRpcClient({
      "http://172.28.1.1:8545": {
        nodeInfo: { enode: enodeUrl("11", "172.28.1.1") },
        peers: [{ enode: enodeUrl("22", "172.28.1.2") }],
      },
      "http://172.28.1.2:8545": {
        nodeInfo: { enode: enodeUrl("22", "172.28.1.2") },
        peers: [{ enode: enodeUrl("11", "172.28.1.1") }],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      httpClient: beaconHttp({}),
      ethRpcClient: rpc,
    });

    const edges = await adapter.pollPeersOnce();
    expect(edges).toEqual([
      {
        kind: "peer",
        fromNodeId: "chainviz-ethereum/reth1",
        toNodeId: "chainviz-ethereum/reth2",
        networkId: "chainviz-ethereum-execution",
      },
    ]);
  });

  it("keeps other execution nodes when one fails to respond", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
        rethFixture("reth3", "172.28.1.3"),
      ]),
    );
    const rpc = elRpcClient({
      "http://172.28.1.1:8545": {
        nodeInfo: { enode: enodeUrl("11", "172.28.1.1") },
        peers: [{ enode: enodeUrl("33", "172.28.1.3") }],
      },
      "http://172.28.1.3:8545": {
        nodeInfo: { enode: enodeUrl("33", "172.28.1.3") },
        peers: [{ enode: enodeUrl("11", "172.28.1.1") }],
      },
      // reth2 は admin API が無効化されているなどで失敗する想定。
      "http://172.28.1.2:8545": {
        nodeInfoError: new Error("admin API disabled"),
      },
    });
    const adapter = new EthereumAdapter(poller, {
      httpClient: beaconHttp({}),
      ethRpcClient: rpc,
    });

    const edges = await adapter.pollPeersOnce();
    expect(edges).toEqual([
      {
        kind: "peer",
        fromNodeId: "chainviz-ethereum/reth1",
        toNodeId: "chainviz-ethereum/reth3",
        networkId: "chainviz-ethereum-execution",
      },
    ]);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "[ethereum] execution peer poll failed for chainviz-ethereum/reth2",
      ),
      expect.any(Error),
    );
    vi.restoreAllMocks();
  });

  it("combines CL and EL edges from a mixed reth+beacon topology without mixing identifier namespaces", async () => {
    // reth1/reth2 と beacon1/beacon2 は同じ論理ノード群だが、CL(libp2p)と
    // EL(devp2p)は別の P2P ネットワークなので、それぞれ独立にエッジが立つ
    // （peers.ts の toPeerEdges を CL/EL で別々に呼んで連結する設計の確認）。
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
        beaconFixture("beacon1", "172.28.2.1"),
        beaconFixture("beacon2", "172.28.2.2"),
      ]),
    );
    const http = beaconHttp({
      "http://172.28.2.1:5052": { peerId: "peer-1", connected: ["peer-2"] },
      "http://172.28.2.2:5052": { peerId: "peer-2", connected: ["peer-1"] },
    });
    const rpc = elRpcClient({
      "http://172.28.1.1:8545": {
        nodeInfo: { enode: enodeUrl("11", "172.28.1.1") },
        peers: [{ enode: enodeUrl("22", "172.28.1.2") }],
      },
      "http://172.28.1.2:8545": {
        nodeInfo: { enode: enodeUrl("22", "172.28.1.2") },
        peers: [{ enode: enodeUrl("11", "172.28.1.1") }],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      httpClient: http,
      ethRpcClient: rpc,
    });

    const edges = await adapter.pollPeersOnce();
    expect(edges).toEqual([
      {
        kind: "peer",
        fromNodeId: "chainviz-ethereum/beacon1",
        toNodeId: "chainviz-ethereum/beacon2",
        networkId: "chainviz-ethereum-consensus",
      },
      {
        kind: "peer",
        fromNodeId: "chainviz-ethereum/reth1",
        toNodeId: "chainviz-ethereum/reth2",
        networkId: "chainviz-ethereum-execution",
      },
    ]);
  });

  it("still delivers CL edges when every EL admin_* call fails (layer isolation)", async () => {
    // EL 側が全ノード失敗（admin API 無効など）しても、CL 側の beacon エッジは
    // 影響を受けずに配信される（Promise.all の片方の失敗が全体を巻き込まない）。
    vi.spyOn(console, "error").mockImplementation(() => {});
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
        beaconFixture("beacon1", "172.28.2.1"),
        beaconFixture("beacon2", "172.28.2.2"),
      ]),
    );
    const http = beaconHttp({
      "http://172.28.2.1:5052": { peerId: "peer-1", connected: ["peer-2"] },
      "http://172.28.2.2:5052": { peerId: "peer-2", connected: ["peer-1"] },
    });
    const rpc = elRpcClient({
      "http://172.28.1.1:8545": { nodeInfoError: new Error("admin disabled") },
      "http://172.28.1.2:8545": { nodeInfoError: new Error("admin disabled") },
    });
    const adapter = new EthereumAdapter(poller, {
      httpClient: http,
      ethRpcClient: rpc,
    });

    const edges = await adapter.pollPeersOnce();
    // CL の 1 本だけが残り、EL エッジは 1 本も出ない。
    expect(edges).toEqual([
      {
        kind: "peer",
        fromNodeId: "chainviz-ethereum/beacon1",
        toNodeId: "chainviz-ethereum/beacon2",
        networkId: "chainviz-ethereum-consensus",
      },
    ]);
    vi.restoreAllMocks();
  });

  it("still delivers EL edges when every CL Beacon API call fails (layer isolation)", async () => {
    // 逆方向: CL 側が全滅しても EL 側の reth エッジは配信される。
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
        beaconFixture("beacon1", "172.28.2.1"),
        beaconFixture("beacon2", "172.28.2.2"),
      ]),
    );
    const http: HttpClient = {
      getJson: (async (url: string) => {
        // すべての Beacon API 呼び出しを失敗させる。
        throw new Error(`beacon down ${url}`);
      }) as HttpClient["getJson"],
    };
    const rpc = elRpcClient({
      "http://172.28.1.1:8545": {
        nodeInfo: { enode: enodeUrl("11", "172.28.1.1") },
        peers: [{ enode: enodeUrl("22", "172.28.1.2") }],
      },
      "http://172.28.1.2:8545": {
        nodeInfo: { enode: enodeUrl("22", "172.28.1.2") },
        peers: [{ enode: enodeUrl("11", "172.28.1.1") }],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      httpClient: http,
      ethRpcClient: rpc,
    });

    const edges = await adapter.pollPeersOnce();
    expect(edges).toEqual([
      {
        kind: "peer",
        fromNodeId: "chainviz-ethereum/reth1",
        toNodeId: "chainviz-ethereum/reth2",
        networkId: "chainviz-ethereum-execution",
      },
    ]);
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
  it("subscribes to every execution node and keys receivedAt by both the matching beacon and itself", async () => {
    // 実 profile と同じ構成: reth1/beacon1、reth2/beacon2 が同じ論理ノード。
    // 同じ受信 1 回を beacon の stableId（CL エッジ用）と reth 自身の
    // stableId（EL エッジ用）の両方に、同一時刻で記録する（Issue #141）。
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
    // 2 回目には両ノードの受信時刻が、対応する beacon のキーと自身の
    // stableId のキーの両方にマージされている。
    expect(blocks[1].receivedAt).toEqual({
      "chainviz-ethereum/beacon1": 1000,
      "chainviz-ethereum/reth1": 1000,
      "chainviz-ethereum/beacon2": 1200,
      "chainviz-ethereum/reth2": 1200,
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
    // receivedAt には reth1 分（beacon1 キーと reth1 自身のキー）と reth2
    // 自身のキーが混在する。
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
      "chainviz-ethereum/reth1": 1000,
      "chainviz-ethereum/reth2": 1400,
    });
  });

  it("shares a beacon key across execution nodes while still keying each node's own EL edge separately", async () => {
    // reth1 と geth1 はノード群キーがともに "1" なので、両方が beacon1 に
    // 対応付く。beacon1 キーは CL エッジ用の共有キーなので初回受信優先で
    // 1000 のまま畳まれる一方、reth1・geth1 自身のキー（EL エッジ用）は
    // それぞれ独立して実受信時刻を保持する（Issue #141 が解決した挙動）。
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

    // beacon1 は共有キーなので初回の 1000 のまま。reth1・geth1 は自身の
    // stableId キーにそれぞれの実受信時刻（1000 / 1500）を保持する。
    expect(blocks[1].receivedAt).toEqual({
      "chainviz-ethereum/beacon1": 1000,
      "chainviz-ethereum/reth1": 1000,
      "chainviz-ethereum/geth1": 1500,
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

describe("EthereumAdapter.subscribeTransactions", () => {
  it("subscribes to pending txs and newHeads on every execution node", async () => {
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
        beaconFixture("beacon1", "172.28.2.1"),
      ]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({});
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });

    await adapter.subscribeTransactions(() => {});
    expect(ws.pendingSubscribedUrls).toEqual([
      "ws://172.28.1.1:8546",
      "ws://172.28.1.2:8546",
    ]);
    // 各 execution ノードに inclusion 用の newHeads も張る（beacon は対象外）。
    expect(ws.subscribedUrls).toEqual([
      "ws://172.28.1.1:8546",
      "ws://172.28.1.2:8546",
    ]);
  });

  it("emits a pending tx after fetching its from/to via RPC", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      txs: { "0xt1": { hash: "0xt1", from: "0xa", to: "0xb", input: "0x" } },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emitPending("ws://172.28.1.1:8546", "0xt1");
    await flushAsync();

    expect(rpc.txCalls).toEqual(["0xt1"]);
    expect(txs).toEqual<TransactionEntity[]>([
      {
        kind: "transaction",
        hash: "0xt1",
        from: "0xa",
        to: "0xb",
        status: "pending",
      },
    ]);
  });

  it("does not emit when the pending tx detail is not yet available", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({ txs: { "0xt1": null } });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emitPending("ws://172.28.1.1:8546", "0xt1");
    await flushAsync();

    expect(txs).toEqual([]);
  });

  it("promotes a pending tx to included when a block containing it arrives", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      txs: { "0xt1": { hash: "0xt1", from: "0xa", to: "0xb", input: "0x" } },
      blocks: {
        "0xblock1": [
          {
            transactionHash: "0xt1",
            from: "0xa",
            to: "0xb",
            status: "0x1",
          },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emitPending("ws://172.28.1.1:8546", "0xt1");
    await flushAsync();
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    expect(txs).toHaveLength(2);
    expect(txs[0].status).toBe("pending");
    expect(txs[1]).toEqual<TransactionEntity>({
      kind: "transaction",
      hash: "0xt1",
      from: "0xa",
      to: "0xb",
      status: "included",
      blockHash: "0xblock1",
    });
  });

  it("promotes a pending tx to failed when its receipt reports status 0x0", async () => {
    // ブロックに取り込まれたが実行に失敗した tx(cast send --create 0xfe 等)。
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      txs: { "0xt1": { hash: "0xt1", from: "0xa", to: null, input: "0x" } },
      blocks: {
        "0xblock1": [
          {
            transactionHash: "0xt1",
            from: "0xa",
            to: null,
            status: "0x0",
          },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emitPending("ws://172.28.1.1:8546", "0xt1");
    await flushAsync();
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    expect(txs).toHaveLength(2);
    expect(txs[0].status).toBe("pending");
    expect(txs[1]).toEqual<TransactionEntity>({
      kind: "transaction",
      hash: "0xt1",
      from: "0xa",
      to: null,
      status: "failed",
      blockHash: "0xblock1",
    });
  });

  it("surfaces the receipt's contractAddress as createdContractAddress end-to-end (Issue #160)", async () => {
    // デプロイ tx（to: null）が取り込まれ、receipt.contractAddress が
    // TransactionEntity.createdContractAddress へマッピングされることを、
    // アダプタ経由（getBlockReceipts + recordInclusion）で確認する。
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      txs: { "0xdeploy": { hash: "0xdeploy", from: "0xdeployer", to: null, input: "0x" } },
      blocks: {
        "0xblock1": [
          {
            transactionHash: "0xdeploy",
            from: "0xdeployer",
            to: null,
            status: "0x1",
            contractAddress: "0xnewcontract",
          },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emitPending("ws://172.28.1.1:8546", "0xdeploy");
    await flushAsync();
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    expect(txs).toHaveLength(2);
    expect(txs[0].status).toBe("pending");
    expect(txs[0].createdContractAddress).toBeUndefined();
    expect(txs[1]).toEqual<TransactionEntity>({
      kind: "transaction",
      hash: "0xdeploy",
      from: "0xdeployer",
      to: null,
      status: "included",
      blockHash: "0xblock1",
      createdContractAddress: "0xnewcontract",
    });
  });

  it("omits createdContractAddress for an ordinary tx (contractAddress absent, Issue #160)", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      txs: { "0xt1": { hash: "0xt1", from: "0xa", to: "0xb", input: "0x" } },
      blocks: {
        "0xblock1": [
          { transactionHash: "0xt1", from: "0xa", to: "0xb", status: "0x1" },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emitPending("ws://172.28.1.1:8546", "0xt1");
    await flushAsync();
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    expect(txs[1].createdContractAddress).toBeUndefined();
    expect(txs[1]).not.toHaveProperty("createdContractAddress");
  });

  it("routes a mixed block end-to-end: success -> included, failed -> failed", async () => {
    // 同一ブロックに success と failed の tx が混在するときの振り分けを
    // アダプタ経由（getBlockReceipts + recordInclusion）で確認する。
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      blocks: {
        "0xblock1": [
          { transactionHash: "0xok", from: "0xa", to: "0xb", status: "0x1" },
          { transactionHash: "0xbad", from: "0xc", to: null, status: "0x0" },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    expect(txs).toEqual<TransactionEntity[]>([
      {
        kind: "transaction",
        hash: "0xok",
        from: "0xa",
        to: "0xb",
        status: "included",
        blockHash: "0xblock1",
      },
      {
        kind: "transaction",
        hash: "0xbad",
        from: "0xc",
        to: null,
        status: "failed",
        blockHash: "0xblock1",
      },
    ]);
  });

  it("drops a malformed receipt but still emits the valid txs in the same block", async () => {
    // ブロック内に transactionHash 欠落の receipt が混じっても、正常な
    // receipt だけが included/failed として通知される（不正 receipt は無視）。
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      blocks: {
        "0xblock1": [
          // transactionHash 欠落 → getBlockReceipts が捨てる。
          {
            transactionHash: undefined as unknown as string,
            from: "0xz",
            to: "0xy",
            status: "0x0",
          },
          { transactionHash: "0xok", from: "0xa", to: "0xb", status: "0x1" },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    expect(txs).toEqual<TransactionEntity[]>([
      {
        kind: "transaction",
        hash: "0xok",
        from: "0xa",
        to: "0xb",
        status: "included",
        blockHash: "0xblock1",
      },
    ]);
  });

  it("adds a tx seen only in a block (pending missed) directly as failed", async () => {
    // pending 通知を取りこぼした失敗 tx も、ブロックの receipt から直接
    // failed として可視化に載せる（未知ハッシュの failed 経路）。
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      blocks: {
        "0xblock1": [
          { transactionHash: "0xt9", from: "0xc", to: null, status: "0x0" },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    expect(txs).toEqual<TransactionEntity[]>([
      {
        kind: "transaction",
        hash: "0xt9",
        from: "0xc",
        to: null,
        status: "failed",
        blockHash: "0xblock1",
      },
    ]);
  });

  it("adds a tx seen only in a block (pending missed) directly as included", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      blocks: {
        "0xblock1": [
          { transactionHash: "0xt9", from: "0xc", to: null, status: "0x1" },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    expect(txs).toEqual<TransactionEntity[]>([
      {
        kind: "transaction",
        hash: "0xt9",
        from: "0xc",
        to: null,
        status: "included",
        blockHash: "0xblock1",
      },
    ]);
  });

  it("fetches each block's receipts only once even when several nodes announce it", async () => {
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
      ]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      blocks: {
        "0xblock1": [
          { transactionHash: "0xt1", from: "0xa", to: "0xb", status: "0x1" },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emit("ws://172.28.1.1:8546", header());
    ws.emit("ws://172.28.1.2:8546", header());
    await flushAsync();

    // 同一ブロックは 2 ノードから届くが eth_getBlockReceipts は 1 回だけ。
    expect(rpc.blockCalls).toEqual(["0xblock1"]);
    expect(txs).toHaveLength(1);
  });

  it("retries block inclusion on a later node's notification when the first fetch returns null", async () => {
    // 回帰テスト: 1 ノード目の eth_getBlockReceipts が null（伝播遅延）を返しても
    // processedBlocks に残らず、同一ブロックを通知する 2 ノード目の newHeads で
    // included へ回復できること。以前は初回で処理済みにしてしまい、後続通知が
    // 弾かれて tx が pending のまま固まる不具合があった。
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
      ]),
    );
    const ws = controllableWsClient();
    const receipts: RawReceiptFixture[] = [
      { transactionHash: "0xt1", from: "0xa", to: "0xb", status: "0x1" },
    ];
    let blockAttempts = 0;
    const rpc: EthRpcClient = {
      async call<T>(_url: string, method: string): Promise<T> {
        if (method === "eth_getTransactionByHash") return null as T;
        // 1 回目の取得は null（まだ伝播していない）、2 回目以降は成功。
        blockAttempts += 1;
        return (blockAttempts === 1 ? null : receipts) as T;
      },
    };
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    // reth1 が先に通知するが取得は null。ここで固まらないことを確認する。
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();
    expect(txs).toEqual([]);

    // reth2 が同一ブロックを通知すると再試行され、included になる。
    ws.emit("ws://172.28.1.2:8546", header());
    await flushAsync();

    expect(blockAttempts).toBe(2);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toEqual<TransactionEntity>({
      kind: "transaction",
      hash: "0xt1",
      from: "0xa",
      to: "0xb",
      status: "included",
      blockHash: "0xblock1",
    });
  });

  it("retries block inclusion on a later node's notification when the first fetch throws", async () => {
    // 回帰テスト（例外版）: 1 ノード目の eth_getBlockReceipts が例外を投げても
    // processedBlocks に残らず、後続ノードの通知で回復できること。
    vi.spyOn(console, "error").mockImplementation(() => {});
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
      ]),
    );
    const ws = controllableWsClient();
    const receipts: RawReceiptFixture[] = [
      { transactionHash: "0xt1", from: "0xa", to: "0xb", status: "0x1" },
    ];
    let blockAttempts = 0;
    const rpc: EthRpcClient = {
      async call<T>(_url: string, method: string): Promise<T> {
        if (method === "eth_getTransactionByHash") return null as T;
        blockAttempts += 1;
        if (blockAttempts === 1) throw new Error("rpc timeout");
        return receipts as T;
      },
    };
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();
    expect(txs).toEqual([]);

    ws.emit("ws://172.28.1.2:8546", header());
    await flushAsync();

    expect(blockAttempts).toBe(2);
    expect(txs).toHaveLength(1);
    expect(txs[0].status).toBe("included");
    vi.restoreAllMocks();
  });

  it("keeps looping after a failed RPC fetch (error is swallowed and logged)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc: EthRpcClient = {
      async call<T>(_url: string, method: string): Promise<T> {
        if (method === "eth_getTransactionByHash") {
          throw new Error("rpc down");
        }
        return null as T;
      },
    };
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emitPending("ws://172.28.1.1:8546", "0xt1");
    await flushAsync();

    // 失敗しても例外は外に漏れず、onTx も呼ばれない。
    expect(txs).toEqual([]);
    vi.restoreAllMocks();
  });

  it("closes pending and inclusion subscriptions on dispose", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({});
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });

    await adapter.subscribeTransactions(() => {});
    adapter.dispose();
    expect(ws.closed).toContain("pending:ws://172.28.1.1:8546");
    expect(ws.closed).toContain("ws://172.28.1.1:8546");
  });

  it("does not subscribe when there are no execution nodes", async () => {
    const poller = new DockerPoller(
      clientFrom([beaconFixture("beacon1", "172.28.2.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({});
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    await adapter.subscribeTransactions(() => {});
    expect(ws.pendingSubscribedUrls).toEqual([]);
    expect(ws.subscribedUrls).toEqual([]);
  });
});

const testCatalog: ContractCatalog = {
  ChainvizToken: {
    name: "ChainvizToken",
    abi: [],
    token: { symbol: "CVZ", decimals: 18 },
  },
};

describe("EthereumAdapter.subscribeContracts (Issue #161)", () => {
  it("emits an unknown-contract entity when a deployment is detected with no catalog registration", async () => {
    // subscribeContracts は専用の購読を張らず、subscribeTransactions が既に
    // 張っている newHeads 購読（handleBlockInclusion）を共有する
    // （docs/ARCHITECTURE.md §4）。
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      txs: { "0xdeploy": { hash: "0xdeploy", from: "0xdeployer", to: null, input: "0x" } },
      blocks: {
        "0xblock1": [
          {
            transactionHash: "0xdeploy",
            from: "0xdeployer",
            to: null,
            status: "0x1",
            contractAddress: "0xnewcontract",
          },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const contracts: ContractEntity[] = [];

    await adapter.subscribeTransactions(() => {});
    await adapter.subscribeContracts((c) => contracts.push(c));
    ws.emitPending("ws://172.28.1.1:8546", "0xdeploy");
    await flushAsync();
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    expect(contracts).toEqual<ContractEntity[]>([
      {
        kind: "contract",
        address: "0xnewcontract",
        chainType: "ethereum",
        deployerAddress: "0xdeployer",
        createdByTxHash: "0xdeploy",
      },
    ]);
  });

  it("fills in name/catalogKey/token when the deployed address was pre-registered via registerContractDeployment", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      blocks: {
        "0xblock1": [
          {
            transactionHash: "0xdeploy",
            from: "0xdeployer",
            to: null,
            status: "0x1",
            contractAddress: "0xnewcontract",
          },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
      catalog: testCatalog,
    });
    const contracts: ContractEntity[] = [];

    await adapter.subscribeTransactions(() => {});
    await adapter.subscribeContracts((c) => contracts.push(c));
    // runWorkbenchOperation(deployContract) 経由でデプロイ先アドレスが判明した
    // 直後にコマンド処理側が呼ぶ想定（Issue #163）。
    adapter.registerContractDeployment("0xnewcontract", "ChainvizToken");

    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    expect(contracts).toEqual<ContractEntity[]>([
      {
        kind: "contract",
        address: "0xnewcontract",
        chainType: "ethereum",
        deployerAddress: "0xdeployer",
        createdByTxHash: "0xdeploy",
        name: "ChainvizToken",
        catalogKey: "ChainvizToken",
        token: { symbol: "CVZ", decimals: 18 },
      },
    ]);
  });

  it("emits an entityUpdated-style refresh when registerContractDeployment is called after detection", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      blocks: {
        "0xblock1": [
          {
            transactionHash: "0xdeploy",
            from: "0xdeployer",
            to: null,
            status: "0x1",
            contractAddress: "0xnewcontract",
          },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
      catalog: testCatalog,
    });
    const contracts: ContractEntity[] = [];

    await adapter.subscribeTransactions(() => {});
    await adapter.subscribeContracts((c) => contracts.push(c));

    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();
    expect(contracts).toHaveLength(1);
    expect(contracts[0].name).toBeUndefined();

    // カタログキーの登録がブロック検知より後になるケース（手動デプロイ後に
    // 追って照合するような運用も含めて許容する）。
    adapter.registerContractDeployment("0xnewcontract", "ChainvizToken");
    expect(contracts).toHaveLength(2);
    expect(contracts[1]).toEqual<ContractEntity>({
      kind: "contract",
      address: "0xnewcontract",
      chainType: "ethereum",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xdeploy",
      name: "ChainvizToken",
      catalogKey: "ChainvizToken",
      token: { symbol: "CVZ", decimals: 18 },
    });
  });

  it("does not emit a contract for an ordinary tx (no contractAddress in the receipt)", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      blocks: {
        "0xblock1": [
          { transactionHash: "0xt1", from: "0xa", to: "0xb", status: "0x1" },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const contracts: ContractEntity[] = [];

    await adapter.subscribeTransactions(() => {});
    await adapter.subscribeContracts((c) => contracts.push(c));
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    expect(contracts).toEqual([]);
  });

  it("emits a deployment only once even when several nodes announce the same block", async () => {
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
      ]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      blocks: {
        "0xblock1": [
          {
            transactionHash: "0xdeploy",
            from: "0xdeployer",
            to: null,
            status: "0x1",
            contractAddress: "0xnewcontract",
          },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const contracts: ContractEntity[] = [];

    await adapter.subscribeTransactions(() => {});
    await adapter.subscribeContracts((c) => contracts.push(c));
    ws.emit("ws://172.28.1.1:8546", header());
    ws.emit("ws://172.28.1.2:8546", header());
    await flushAsync();

    expect(contracts).toHaveLength(1);
  });

  it("does not throw and simply does not emit when subscribeContracts was never called", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      blocks: {
        "0xblock1": [
          {
            transactionHash: "0xdeploy",
            from: "0xdeployer",
            to: null,
            status: "0x1",
            contractAddress: "0xnewcontract",
          },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });

    await adapter.subscribeTransactions(() => {});
    // subscribeContracts を呼ばないまま block inclusion が走っても例外は
    // 起きない（registerContractDeployment を後から呼んでも onContract が
    // 無いので何も配信されない）。
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();
    expect(() =>
      adapter.registerContractDeployment("0xnewcontract", "ChainvizToken"),
    ).not.toThrow();
  });

  it("emits a separate contract for each deployment tx in a single block", async () => {
    // 1 ブロックに複数のコントラクト作成 tx が含まれるケース。receipts を
    // 走査してそれぞれ別の ContractEntity として配信する（1 件だけ・
    // 取り違えが起きない）。
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      blocks: {
        "0xblock1": [
          {
            transactionHash: "0xdeployA",
            from: "0xdeployerA",
            to: null,
            status: "0x1",
            contractAddress: "0xcontractA",
          },
          {
            transactionHash: "0xordinary",
            from: "0xa",
            to: "0xb",
            status: "0x1",
          },
          {
            transactionHash: "0xdeployB",
            from: "0xdeployerB",
            to: null,
            status: "0x1",
            contractAddress: "0xcontractB",
          },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const contracts: ContractEntity[] = [];

    await adapter.subscribeTransactions(() => {});
    await adapter.subscribeContracts((c) => contracts.push(c));
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    // ContractTracker はアドレスを小文字に正規化する（Issue #161 レビュー
    // 差し戻し: reth の receipt が小文字、forge の "Deployed to:" がチェックサム
    // 表記であるための合流対応）ため、入力が大小混在でも小文字で配信される。
    expect(contracts.map((c) => c.address)).toEqual([
      "0xcontracta",
      "0xcontractb",
    ]);
    expect(contracts.map((c) => c.deployerAddress)).toEqual([
      "0xdeployerA",
      "0xdeployerB",
    ]);
  });

  it("does not emit or throw when registerContractDeployment is called with an unknown catalog key", async () => {
    // アダプタ層の registerContractDeployment に、カタログに無いキーが渡って
    // きても（コマンド処理側のバグ・カタログ更新漏れなど）、tracker が null を
    // 返し onContract は呼ばれない（黙って握りつぶすのではなく tracker 側で
    // 警告ログを出す。ここでは配信が起きないことと例外が起きないことを固定）。
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({ blocks: {} });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
      catalog: testCatalog,
    });
    const contracts: ContractEntity[] = [];

    await adapter.subscribeTransactions(() => {});
    await adapter.subscribeContracts((c) => contracts.push(c));

    expect(() =>
      adapter.registerContractDeployment("0xnewcontract", "NoSuchKey"),
    ).not.toThrow();
    expect(contracts).toEqual([]);
    warnSpy.mockRestore();
  });
});

describe("EthereumAdapter.trackedTokenContractAddresses (Issue #164)", () => {
  it("returns an empty array when no contract has been deployed", () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const adapter = new EthereumAdapter(poller, { catalog: testCatalog });
    expect(adapter.trackedTokenContractAddresses()).toEqual([]);
  });

  it("includes a deployed token contract's address once detected via block inclusion", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      blocks: {
        "0xblock1": [
          {
            transactionHash: "0xdeploy",
            from: "0xdeployer",
            to: null,
            status: "0x1",
            contractAddress: "0xnewtoken",
          },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
      catalog: testCatalog,
    });
    await adapter.subscribeTransactions(() => {});
    await adapter.subscribeContracts(() => {});
    adapter.registerContractDeployment("0xnewtoken", "ChainvizToken");
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    expect(adapter.trackedTokenContractAddresses()).toEqual(["0xnewtoken"]);
  });

  it("excludes a deployed contract that is not cataloged as a token", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      blocks: {
        "0xblock1": [
          {
            transactionHash: "0xdeploy",
            from: "0xdeployer",
            to: null,
            status: "0x1",
            contractAddress: "0xunknowncontract",
          },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
      catalog: testCatalog,
    });
    await adapter.subscribeTransactions(() => {});
    await adapter.subscribeContracts(() => {});
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    // カタログ未照合（未知のコントラクト）は token を持たないので対象外。
    expect(adapter.trackedTokenContractAddresses()).toEqual([]);
  });
});

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
