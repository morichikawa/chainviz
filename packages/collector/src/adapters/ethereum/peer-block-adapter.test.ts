import type {
  BlockEntity,
  ContractEntity,
  NodeEntity,
  NodeInternalsHandlers,
  PeerEdge,
  TransactionEntity,
} from "@chainviz/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BEACON_API_PORT } from "./beacon-api.js";
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

/**
 * `fixtures` を毎回参照で読み直す DockerClient。配列の中身を呼び出し側が
 * 書き換える（push/splice/length=0）ことで、addNode/removeNode 相当のノード
 * 増減を後続の poll で反映できる（head-block-hash.test.ts の
 * mutableClientFrom と同じ発想。`clientFrom` は `getContainer` の解決に
 * 作成時点の `byId` スナップショットを使うため、生成後に追加された
 * コンテナの `top()` を正しく解決できない点が異なる）。
 */
function mutableClientFrom(fixtures: Fixture[]): DockerClient {
  return {
    listContainers: async () => fixtures.map((f) => f.summary),
    getContainer: (id: string) => ({
      top: async () =>
        fixtures.find((f) => f.summary.Id === id)?.top ?? {
          Titles: ["CMD"],
          Processes: [],
        },
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

/**
 * baseUrl 単位に identity / peers / syncing レスポンスを差し込める
 * HttpClient。`syncing` を省略したベースは `/eth/v1/node/syncing` に既定で
 * 健全な同期済みレスポンス（is_syncing/is_optimistic/el_offline すべて
 * false、head_slot 0）を返す（D層ループ（subscribeNodeInternals、
 * Issue #274）が beacon ノードの同期状態も毎 tick 取得するため、identity/
 * peers しか使わない既存のテストが実ネットワークへフォールバックしない
 * ようにする既定値）。特定の同期状態を検証したいテストは `syncing` で
 * 上書きする。
 */
function beaconHttp(
  byBase: Record<
    string,
    {
      peerId: string;
      connected: string[];
      syncing?: {
        isSyncing?: boolean;
        isOptimistic?: boolean;
        elOffline?: boolean;
        headSlot?: number | string;
      };
    }
  >,
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
        if (url === `${base}/eth/v1/node/syncing`) {
          const s = data.syncing ?? {};
          return {
            data: {
              is_syncing: s.isSyncing ?? false,
              is_optimistic: s.isOptimistic ?? false,
              el_offline: s.elOffline ?? false,
              head_slot: String(s.headSlot ?? 0),
            },
          };
        }
      }
      throw new Error(`unexpected url ${url}`);
    }) as unknown as HttpClient["getJson"],
  };
}

/**
 * subscribeNodeInternals（D層、Issue #186/#274）のテストで、beacon の同期
 * 状態取得（`/eth/v1/node/syncing`）を実ネットワークにフォールバックさせない
 * ための既定 HttpClient。identity/peers は使わない前提（peerId はダミー値）
 * で、同期状態は `beaconHttp` の既定（健全・synced/head_slot 0）を返す。
 */
function defaultBeaconSyncHttp(...ips: string[]): HttpClient {
  return beaconHttp(
    Object.fromEntries(
      ips.map((ip) => [`http://${ip}:${BEACON_API_PORT}`, { peerId: "peer", connected: [] }]),
    ),
  );
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

/**
 * `reth_sync_checkpoint{stage="Finish"}` を含む `/metrics` レスポンス
 * （Issue #187 の syncStatus/blockHeight テスト用）。
 */
function rethMetricsTextWithFinish(finishCheckpoint: number): string {
  return [
    `reth_sync_checkpoint{stage="Headers"} ${finishCheckpoint}`,
    `reth_sync_checkpoint{stage="Finish"} ${finishCheckpoint}`,
    "reth_transaction_pool_pending_pool_transactions 0",
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
          // 実際の WebSocket close と同様、close 済みのハンドラには以後の
          // emit を届けない（この特定のハンドラだけを取り除く。同じ wsUrl
          // への他の購読（B 層/C 層、または張り直し後の新しい購読）には
          // 影響しない。Issue #301: リコンサイルが signature 変化で
          // close→open する際、古いハンドラが emit で呼ばれ続けないことを
          // テストで確認できるようにするため）。
          const current = headHandlers.get(wsUrl);
          if (current) {
            const idx = current.indexOf(onHeader);
            if (idx !== -1) current.splice(idx, 1);
          }
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

  it("keeps other beacon nodes when one fails to respond, and logs the failure (Issue #287)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
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
    // Issue #287: 失敗ノード（stableId・実際のエラー）が EL 側
    // （fetchExecutionPeerNodes）と対称にログされる。以前は catch で
    // 無言除外していた。
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "[ethereum] consensus peer poll failed for chainviz-ethereum/beacon2",
      ),
      expect.any(Error),
    );
    vi.restoreAllMocks();
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
    vi.spyOn(console, "error").mockImplementation(() => {});
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
    vi.restoreAllMocks();
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
    adapter.dispose();
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
    adapter.dispose();
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
    adapter.dispose();
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
    adapter.dispose();
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
    adapter.dispose();
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
    adapter.dispose();
  });
});

describe("EthereumAdapter.subscribeBlocks dynamic node tracking (Issue #301)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("opens a newHeads subscription for an execution node that first appears on a later reconcile tick (addNode)", async () => {
    const containers: Fixture[] = [];
    const poller = new DockerPoller(mutableClientFrom(containers));
    const ws = controllableWsClient();
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      blockSubscriptionReconcileIntervalMs: 3000,
    });

    await adapter.subscribeBlocks(() => {});
    expect(ws.subscribedUrls).toEqual([]);

    // addNode 相当: reth1 が observation に現れる。
    containers.push(rethFixture("reth1", "172.28.1.1"));
    await vi.advanceTimersByTimeAsync(3000);

    expect(ws.subscribedUrls).toEqual(["ws://172.28.1.1:8546"]);
    adapter.dispose();
  });

  it("closes an execution node's subscription once it disappears from a later reconcile tick (removeNode) instead of leaving it open until dispose", async () => {
    const containers: Fixture[] = [rethFixture("reth1", "172.28.1.1")];
    const poller = new DockerPoller(mutableClientFrom(containers));
    const ws = controllableWsClient();
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      blockSubscriptionReconcileIntervalMs: 3000,
    });

    await adapter.subscribeBlocks(() => {});
    expect(ws.subscribedUrls).toEqual(["ws://172.28.1.1:8546"]);

    // removeNode 相当: observation から消える。
    containers.length = 0;
    await vi.advanceTimersByTimeAsync(3000);

    // dispose() を呼ぶ前の時点で、既に close されている（旧実装では
    // dispose() まで close されず、死んだコンテナへの再接続タイマーが
    // 無期限に残る潜在リークがあった。Issue #301 の副次的な解消点）。
    expect(ws.closed).toEqual(["ws://172.28.1.1:8546"]);
    adapter.dispose();
  });

  it("does not close and reopen the subscription across ticks when the target set is unchanged (idempotent reconcile)", async () => {
    const containers: Fixture[] = [rethFixture("reth1", "172.28.1.1")];
    const poller = new DockerPoller(mutableClientFrom(containers));
    const ws = controllableWsClient();
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      blockSubscriptionReconcileIntervalMs: 3000,
    });

    await adapter.subscribeBlocks(() => {});
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(3000);

    // signature（wsUrl + receivedAtKeys）が変わらない限り、同一ノードへの
    // 購読は最初の1回だけで維持される（毎 tick 張り直さない）。
    expect(ws.subscribedUrls).toEqual(["ws://172.28.1.1:8546"]);
    expect(ws.closed).toEqual([]);
    adapter.dispose();
  });

  it("closes and reopens the subscription when a paired beacon appears on a later tick and receivedAtKeys change (addNode: reth observed before its beacon)", async () => {
    // addNode は reth/beacon を同時作成するが、Docker 観測への反映タイミング
    // 次第で reth のみ先に観測されることがある（設計メモ参照）。
    const containers: Fixture[] = [rethFixture("reth1", "172.28.1.1")];
    const poller = new DockerPoller(mutableClientFrom(containers));
    const ws = controllableWsClient();
    let clock = 1000;
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      blockSubscriptionReconcileIntervalMs: 3000,
      now: () => clock,
    });
    const blocks: BlockEntity[] = [];

    await adapter.subscribeBlocks((b) => blocks.push(b));
    expect(ws.subscribedUrls).toEqual(["ws://172.28.1.1:8546"]);

    ws.emit("ws://172.28.1.1:8546", header());
    expect(blocks[0].receivedAt).toEqual({ "chainviz-ethereum/reth1": 1000 });

    // 次 tick で beacon1 が観測に現れ、reth1 の receivedAtKeys が
    // [self] -> [beacon1, self] へ変わる（signature 変化）。
    containers.push(beaconFixture("beacon1", "172.28.2.1"));
    await vi.advanceTimersByTimeAsync(3000);

    // 同じ wsUrl へ張り直す（close されてから再度 open される）。
    expect(ws.closed).toEqual(["ws://172.28.1.1:8546"]);
    expect(ws.subscribedUrls).toEqual([
      "ws://172.28.1.1:8546",
      "ws://172.28.1.1:8546",
    ]);

    clock = 2000;
    // 同じブロックハッシュ（header() の既定値）を再送する想定なので、
    // BlockPropagationTracker は既に記録済みの reth1（1000）はそのまま
    // 保持し、まだ記録の無い beacon1 だけを新しい時刻（2000）で追加する
    // （blocks.ts の「同一キーは初回の時刻を保持する」仕様どおり）。
    ws.emit("ws://172.28.1.1:8546", header());
    expect(blocks[1].receivedAt).toEqual({
      "chainviz-ethereum/beacon1": 2000,
      "chainviz-ethereum/reth1": 1000,
    });
    adapter.dispose();
  });

  it("is idempotent: a second subscribeBlocks call does not start a second reconcile loop", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const pollSpy = vi.spyOn(poller, "pollOnce");
    const ws = controllableWsClient();
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      blockSubscriptionReconcileIntervalMs: 3000,
    });

    await adapter.subscribeBlocks(vi.fn());
    await adapter.subscribeBlocks(vi.fn());
    await vi.advanceTimersByTimeAsync(0);

    // 二重に subscribeBlocks を呼んでも、1 巡分のポーリング（初回 tick）しか
    // 走っていない（2 回目の呼び出しは即座に return する）。
    expect(pollSpy).toHaveBeenCalledTimes(1);
    expect(ws.subscribedUrls).toEqual(["ws://172.28.1.1:8546"]);
    adapter.dispose();
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

describe("EthereumAdapter syncStatus/blockHeight from D層 (Issue #187)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** pollInfra の結果から指定 stableId の NodeEntity を取り出す。 */
  function nodeById(
    entities: (NodeEntity | { kind: string })[],
    id: string,
  ): NodeEntity {
    const found = entities.find(
      (e): e is NodeEntity => e.kind === "node" && (e as NodeEntity).id === id,
    );
    if (!found) throw new Error(`node ${id} not found`);
    return found;
  }

  it("fills syncStatus/blockHeight from the Finish checkpoint once D層観測が届く (single node, no peer to compare against)", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const rethMetricsClient = queuedRethMetricsClient({
      "http://172.28.1.1:9001/metrics": [rethMetricsTextWithFinish(42)],
    });
    const adapter = new EthereumAdapter(poller, {
      rethMetricsClient,
      nodeInternalsPollIntervalMs: 3000,
    });

    // pollInfra 単体では D層観測がまだ無いため既存のプレースホルダのまま。
    const before = await adapter.pollInfra();
    expect(nodeById(before.entities ?? [], "chainviz-ethereum/reth1")).toMatchObject(
      { syncStatus: "syncing", blockHeight: 0 },
    );

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    const after = await adapter.pollInfra();
    expect(nodeById(after.entities ?? [], "chainviz-ethereum/reth1")).toMatchObject(
      { syncStatus: "synced", blockHeight: 42 },
    );
    adapter.dispose();
  });

  it("marks the lagging node as syncing and the caught-up node as synced (two EL peers)", async () => {
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth3", "172.28.1.3"),
      ]),
    );
    const rethMetricsClient = queuedRethMetricsClient({
      "http://172.28.1.1:9001/metrics": [rethMetricsTextWithFinish(3372)],
      "http://172.28.1.3:9001/metrics": [rethMetricsTextWithFinish(191)],
    });
    const adapter = new EthereumAdapter(poller, {
      rethMetricsClient,
      nodeInternalsPollIntervalMs: 3000,
    });

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    const partial = await adapter.pollInfra();
    const entities = partial.entities ?? [];
    expect(nodeById(entities, "chainviz-ethereum/reth1")).toMatchObject({
      syncStatus: "synced",
      blockHeight: 3372,
    });
    expect(nodeById(entities, "chainviz-ethereum/reth3")).toMatchObject({
      syncStatus: "syncing",
      blockHeight: 191,
    });
    adapter.dispose();
  });

  it("keeps the syncing/0 placeholder when the metrics response has no Finish checkpoint", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const rethMetricsClient = queuedRethMetricsClient({
      // 既存の rethMetricsText は "Headers" のみで "Finish" を含まない。
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
    await vi.advanceTimersByTimeAsync(0);

    const partial = await adapter.pollInfra();
    expect(nodeById(partial.entities ?? [], "chainviz-ethereum/reth1")).toMatchObject(
      { syncStatus: "syncing", blockHeight: 0 },
    );
    adapter.dispose();
  });

  it("stops counting a removed node once its execution container disappears from observations", async () => {
    const reth1 = rethFixture("reth1", "172.28.1.1");
    const reth3 = rethFixture("reth3", "172.28.1.3");
    let fixtures: Fixture[] = [reth1, reth3];
    const byId = new Map([reth1, reth3].map((f) => [f.summary.Id, f] as const));
    const client: DockerClient = {
      listContainers: async () => fixtures.map((f) => f.summary),
      getContainer: (id: string) => ({
        top: async () => byId.get(id)?.top ?? { Titles: ["CMD"], Processes: [] },
        stats: async () => zeroStats,
      }),
    };
    const poller = new DockerPoller(client);

    const rethMetricsClient = queuedRethMetricsClient({
      "http://172.28.1.1:9001/metrics": [
        rethMetricsTextWithFinish(3372),
        rethMetricsTextWithFinish(3400),
      ],
      "http://172.28.1.3:9001/metrics": [rethMetricsTextWithFinish(191)],
    });
    const adapter = new EthereumAdapter(poller, {
      rethMetricsClient,
      nodeInternalsPollIntervalMs: 3000,
    });

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    let partial = await adapter.pollInfra();
    expect(nodeById(partial.entities ?? [], "chainviz-ethereum/reth3")).toMatchObject(
      { syncStatus: "syncing", blockHeight: 191 },
    );

    // reth3 が削除され観測から消える。
    fixtures = [rethFixture("reth1", "172.28.1.1")];
    await vi.advanceTimersByTimeAsync(3000);

    partial = await adapter.pollInfra();
    const entities = partial.entities ?? [];
    expect(entities.some((e) => (e as NodeEntity).id === "chainviz-ethereum/reth3")).toBe(
      false,
    );
    // reth1 は唯一の観測ノードになったため synced（比較基準が無い既定の倒し方）。
    expect(nodeById(entities, "chainviz-ethereum/reth1")).toMatchObject({
      syncStatus: "synced",
      blockHeight: 3400,
    });
    adapter.dispose();
  });

  it("keeps the CL(beacon) placeholder when the Beacon API syncing fetch fails (Issue #274)", async () => {
    // EL(reth)側は D層メトリクス（Finish checkpoint）で埋まる一方、CL(beacon)
    // 側は Beacon API の /eth/v1/node/syncing 取得が失敗した場合（ここでは
    // モック HttpClient が beacon1 のベース URL に応答を持たない）、
    // beaconSyncStatusCache が更新されず既存のプレースホルダ（syncing/0）の
    // まま残ることを固定する（成功時の値は下の describe ブロック（Issue #274）
    // で検証する）。
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        beaconFixture("beacon1", "172.28.2.1"),
      ]),
    );
    const rethMetricsClient = queuedRethMetricsClient({
      "http://172.28.1.1:9001/metrics": [rethMetricsTextWithFinish(1500)],
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter = new EthereumAdapter(poller, {
      rethMetricsClient,
      httpClient: beaconHttp({}),
      nodeInternalsPollIntervalMs: 3000,
    });

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    const partial = await adapter.pollInfra();
    const entities = partial.entities ?? [];
    // EL(reth1)は D層観測から埋まる。
    expect(nodeById(entities, "chainviz-ethereum/reth1")).toMatchObject({
      syncStatus: "synced",
      blockHeight: 1500,
    });
    // CL(beacon1)は同期状態の取得に失敗したためプレースホルダのまま。
    expect(nodeById(entities, "chainviz-ethereum/beacon1")).toMatchObject({
      syncStatus: "syncing",
      blockHeight: 0,
    });
    adapter.dispose();
  });
});

describe("EthereumAdapter syncStatus/blockHeight for CL (beacon) via Beacon API (Issue #274)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** pollInfra の結果から指定 stableId の NodeEntity を取り出す。 */
  function nodeById(
    entities: (NodeEntity | { kind: string })[],
    id: string,
  ): NodeEntity {
    const found = entities.find(
      (e): e is NodeEntity => e.kind === "node" && (e as NodeEntity).id === id,
    );
    if (!found) throw new Error(`node ${id} not found`);
    return found;
  }

  it("fills syncStatus/blockHeight from the Beacon API self-report once D層観測が届く", async () => {
    const poller = new DockerPoller(
      clientFrom([beaconFixture("beacon1", "172.28.2.1")]),
    );
    const adapter = new EthereumAdapter(poller, {
      httpClient: beaconHttp({
        "http://172.28.2.1:5052": {
          peerId: "peer-beacon1",
          connected: [],
          syncing: { headSlot: 16587 },
        },
      }),
      nodeInternalsPollIntervalMs: 3000,
    });

    // pollInfra 単体では D層観測がまだ無いため既存のプレースホルダのまま。
    const before = await adapter.pollInfra();
    expect(
      nodeById(before.entities ?? [], "chainviz-ethereum/beacon1"),
    ).toMatchObject({ syncStatus: "syncing", blockHeight: 0 });

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    const after = await adapter.pollInfra();
    expect(
      nodeById(after.entities ?? [], "chainviz-ethereum/beacon1"),
    ).toMatchObject({ syncStatus: "synced", blockHeight: 16587 });
    adapter.dispose();
  });

  it("uses head_slot as blockHeight, not the paired EL node's block number (units differ)", async () => {
    // 実測: head_slot 16587 に対し EL の eth_blockNumber は 16583（空スロット
    // の分だけスロットの方が大きい）。CL/EL で単位が異なる値をそのまま入れ、
    // 混同しないことを確認する。
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        beaconFixture("beacon1", "172.28.2.1"),
      ]),
    );
    const rethMetricsClient = queuedRethMetricsClient({
      "http://172.28.1.1:9001/metrics": [rethMetricsTextWithFinish(16583)],
    });
    const adapter = new EthereumAdapter(poller, {
      rethMetricsClient,
      httpClient: beaconHttp({
        "http://172.28.2.1:5052": {
          peerId: "peer-beacon1",
          connected: [],
          syncing: { headSlot: 16587 },
        },
      }),
      nodeInternalsPollIntervalMs: 3000,
    });

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    const partial = await adapter.pollInfra();
    const entities = partial.entities ?? [];
    expect(nodeById(entities, "chainviz-ethereum/reth1").blockHeight).toBe(
      16583,
    );
    expect(nodeById(entities, "chainviz-ethereum/beacon1").blockHeight).toBe(
      16587,
    );
    adapter.dispose();
  });

  it.each([
    ["is_syncing", { isSyncing: true }],
    ["el_offline", { elOffline: true }],
    ["is_optimistic", { isOptimistic: true }],
  ] as const)(
    "marks the beacon as syncing when %s is true even though the others are false",
    async (_label, flags) => {
      const poller = new DockerPoller(
        clientFrom([beaconFixture("beacon1", "172.28.2.1")]),
      );
      const adapter = new EthereumAdapter(poller, {
        httpClient: beaconHttp({
          "http://172.28.2.1:5052": {
            peerId: "peer-beacon1",
            connected: [],
            syncing: { headSlot: 100, ...flags },
          },
        }),
        nodeInternalsPollIntervalMs: 3000,
      });

      await adapter.subscribeNodeInternals({
        onInternals: vi.fn(),
        onLinkActivity: vi.fn(),
      });
      await vi.advanceTimersByTimeAsync(0);

      const partial = await adapter.pollInfra();
      expect(
        nodeById(partial.entities ?? [], "chainviz-ethereum/beacon1"),
      ).toMatchObject({ syncStatus: "syncing", blockHeight: 100 });
      adapter.dispose();
    },
  );

  it("does not compare beacon nodes against each other (unlike the EL max-checkpoint comparison)", async () => {
    // beacon はノード自身の自己申告で判定済みのため、他 beacon との
    // head_slot の差では判定しない。1台が大きく遅れていても、それ自体の
    // 自己申告が synced なら synced のままである。
    const poller = new DockerPoller(
      clientFrom([
        beaconFixture("beacon1", "172.28.2.1"),
        beaconFixture("beacon2", "172.28.2.2"),
      ]),
    );
    const adapter = new EthereumAdapter(poller, {
      httpClient: beaconHttp({
        "http://172.28.2.1:5052": {
          peerId: "peer-beacon1",
          connected: [],
          syncing: { headSlot: 9000 },
        },
        "http://172.28.2.2:5052": {
          peerId: "peer-beacon2",
          connected: [],
          syncing: { headSlot: 10 },
        },
      }),
      nodeInternalsPollIntervalMs: 3000,
    });

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    const partial = await adapter.pollInfra();
    const entities = partial.entities ?? [];
    expect(nodeById(entities, "chainviz-ethereum/beacon1")).toMatchObject({
      syncStatus: "synced",
      blockHeight: 9000,
    });
    expect(nodeById(entities, "chainviz-ethereum/beacon2")).toMatchObject({
      syncStatus: "synced",
      blockHeight: 10,
    });
    adapter.dispose();
  });

  it("resolves the beacon sync status even when the EL metrics fetch fails in the same tick (independent caches)", async () => {
    // Issue #274 item 4: pollOneBeaconSync（CL）と pollOneNodeInternals（EL）は
    // 同じ D層 tick で並行に走るが、対象集合・キャッシュが互いに素で独立して
    // いる。片方（EL の /metrics 取得）が失敗しても、もう片方（beacon の
    // /eth/v1/node/syncing）は影響を受けずに解決される。逆向き（beacon 失敗時に
    // EL が埋まる）は上の "keeps the CL(beacon) placeholder ..." が既にカバー。
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        beaconFixture("beacon1", "172.28.2.1"),
      ]),
    );
    // reth の /metrics キューを空にして getText を throw させる（EL 側失敗）。
    const rethMetricsClient = queuedRethMetricsClient({});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter = new EthereumAdapter(poller, {
      rethMetricsClient,
      httpClient: beaconHttp({
        "http://172.28.2.1:5052": {
          peerId: "peer-beacon1",
          connected: [],
          syncing: { headSlot: 4242 },
        },
      }),
      nodeInternalsPollIntervalMs: 3000,
    });

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    const partial = await adapter.pollInfra();
    const entities = partial.entities ?? [];
    // EL 側は取得に失敗したためプレースホルダのまま。
    expect(nodeById(entities, "chainviz-ethereum/reth1")).toMatchObject({
      syncStatus: "syncing",
      blockHeight: 0,
    });
    // CL 側は EL の失敗に巻き込まれず解決される。
    expect(nodeById(entities, "chainviz-ethereum/beacon1")).toMatchObject({
      syncStatus: "synced",
      blockHeight: 4242,
    });
    adapter.dispose();
  });

  it("keeps the CL placeholder for a beacon whose head_slot is non-conforming while still resolving a sibling beacon (Issue #282)", async () => {
    // Issue #282: 片方の beacon が非準拠な head_slot（ここでは 16進表記の
    // 文字列 "0x10"。旧実装は Number() で静かに 16 として受理していた）を
    // 返すと fetchBeaconSyncing が throw するが、pollOneBeaconSync がノード
    // 単位で握って（ログのみ）返すため、D層ループ全体はクラッシュしない。
    // もう一方の健全な beacon2 の解決には影響しない（他ノードのポーリングと
    // キャッシュ更新が巻き添えにならない）。
    const poller = new DockerPoller(
      clientFrom([
        beaconFixture("beacon1", "172.28.2.1"),
        beaconFixture("beacon2", "172.28.2.2"),
      ]),
    );
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const adapter = new EthereumAdapter(poller, {
      httpClient: beaconHttp({
        "http://172.28.2.1:5052": {
          peerId: "peer-beacon1",
          connected: [],
          syncing: { headSlot: "0x10" },
        },
        "http://172.28.2.2:5052": {
          peerId: "peer-beacon2",
          connected: [],
          syncing: { headSlot: 4242 },
        },
      }),
      nodeInternalsPollIntervalMs: 3000,
    });

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    const partial = await adapter.pollInfra();
    const entities = partial.entities ?? [];
    // 非準拠値を返した beacon1 は解決されずプレースホルダのまま。
    expect(nodeById(entities, "chainviz-ethereum/beacon1")).toMatchObject({
      syncStatus: "syncing",
      blockHeight: 0,
    });
    // 健全な beacon2 は巻き添えにならず解決される。
    expect(nodeById(entities, "chainviz-ethereum/beacon2")).toMatchObject({
      syncStatus: "synced",
      blockHeight: 4242,
    });
    // 失敗した beacon1 の stableId と head_slot がログに残る（握りつぶさない）。
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "beacon syncing poll failed for chainviz-ethereum/beacon1",
      ),
      expect.objectContaining({ message: expect.stringContaining("head_slot") }),
    );
    adapter.dispose();
  });

  it("recovers a beacon's sync status on a later tick once its head_slot becomes conforming again (Issue #282)", async () => {
    // 非準拠 head_slot は一時的な縮退として扱い、次周期で準拠値に戻れば
    // 回復する（transient。旧実装のように誤った値で埋めたまま固まらない）。
    const poller = new DockerPoller(
      clientFrom([beaconFixture("beacon1", "172.28.2.1")]),
    );
    const getJson = vi
      .fn()
      // 1 tick 目: 非準拠な head_slot（空文字列）→ fetchBeaconSyncing が throw。
      .mockResolvedValueOnce({
        data: {
          is_syncing: false,
          is_optimistic: false,
          el_offline: false,
          head_slot: "",
        },
      })
      // 2 tick 目: 準拠した 10進文字列に回復。
      .mockResolvedValueOnce({
        data: {
          is_syncing: false,
          is_optimistic: false,
          el_offline: false,
          head_slot: "512",
        },
      });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter = new EthereumAdapter(poller, {
      httpClient: { getJson } as unknown as HttpClient,
      nodeInternalsPollIntervalMs: 3000,
    });

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);
    let partial = await adapter.pollInfra();
    // 1 tick 目は非準拠値のためプレースホルダのまま。
    expect(
      nodeById(partial.entities ?? [], "chainviz-ethereum/beacon1"),
    ).toMatchObject({ syncStatus: "syncing", blockHeight: 0 });

    await vi.advanceTimersByTimeAsync(3000);
    partial = await adapter.pollInfra();
    // 2 tick 目で準拠値に戻り、解決される。
    expect(
      nodeById(partial.entities ?? [], "chainviz-ethereum/beacon1"),
    ).toMatchObject({ syncStatus: "synced", blockHeight: 512 });
    adapter.dispose();
  });

  it("keeps the previous value when a later syncing fetch fails (transient degradation)", async () => {
    const poller = new DockerPoller(
      clientFrom([beaconFixture("beacon1", "172.28.2.1")]),
    );
    const getJson = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          is_syncing: false,
          is_optimistic: false,
          el_offline: false,
          head_slot: "500",
        },
      })
      .mockRejectedValueOnce(new Error("beacon unreachable"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter = new EthereumAdapter(poller, {
      httpClient: { getJson } as unknown as HttpClient,
      nodeInternalsPollIntervalMs: 3000,
    });

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);
    let partial = await adapter.pollInfra();
    expect(
      nodeById(partial.entities ?? [], "chainviz-ethereum/beacon1"),
    ).toMatchObject({ syncStatus: "synced", blockHeight: 500 });

    // 次周期の取得が失敗しても、前回の観測値を保持する。
    await vi.advanceTimersByTimeAsync(3000);
    partial = await adapter.pollInfra();
    expect(
      nodeById(partial.entities ?? [], "chainviz-ethereum/beacon1"),
    ).toMatchObject({ syncStatus: "synced", blockHeight: 500 });
    adapter.dispose();
  });

  it("stops resolving a removed beacon once it disappears from observations (forgetNode)", async () => {
    const beacon1 = beaconFixture("beacon1", "172.28.2.1");
    let fixtures: Fixture[] = [beacon1];
    const byId = new Map([beacon1].map((f) => [f.summary.Id, f] as const));
    const client: DockerClient = {
      listContainers: async () => fixtures.map((f) => f.summary),
      getContainer: (id: string) => ({
        top: async () =>
          byId.get(id)?.top ?? { Titles: ["CMD"], Processes: [] },
        stats: async () => zeroStats,
      }),
    };
    const adapter = new EthereumAdapter(new DockerPoller(client), {
      httpClient: beaconHttp({
        "http://172.28.2.1:5052": {
          peerId: "peer-beacon1",
          connected: [],
          syncing: { headSlot: 42 },
        },
      }),
      nodeInternalsPollIntervalMs: 3000,
    });

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);
    let partial = await adapter.pollInfra();
    expect(
      nodeById(partial.entities ?? [], "chainviz-ethereum/beacon1"),
    ).toMatchObject({ syncStatus: "synced", blockHeight: 42 });

    // beacon1 が削除され観測から消える。
    fixtures = [];
    await vi.advanceTimersByTimeAsync(3000);
    partial = await adapter.pollInfra();
    expect(
      (partial.entities ?? []).some(
        (e) => (e as NodeEntity).id === "chainviz-ethereum/beacon1",
      ),
    ).toBe(false);
    adapter.dispose();
  });

  it("does not poll a validator's syncing endpoint (beaconTargets already excludes it)", async () => {
    // validator は lighthouse イメージだが compose サービス名に "beacon" を
    // 含まないため beaconTargets の対象外（既存の targets.ts の選別基準。
    // pollPeersOnce の「excludes the validator from Beacon API polling」と
    // 同じ前提）。pollOneBeaconSync が validator の Beacon API へ到達しようと
    // しないことを HttpClient への到達 URL から確認する。
    const poller = new DockerPoller(
      clientFrom([
        beaconFixture("beacon1", "172.28.2.1"),
        beaconFixture("validator1", "172.28.2.9", "lighthouse vc"),
      ]),
    );
    const getJson = vi.fn(async (url: string) => {
      if (url === "http://172.28.2.1:5052/eth/v1/node/syncing") {
        return {
          data: {
            is_syncing: false,
            is_optimistic: false,
            el_offline: false,
            head_slot: "1",
          },
        };
      }
      throw new Error(`unexpected url ${url}`);
    });
    const adapter = new EthereumAdapter(poller, {
      httpClient: { getJson } as unknown as HttpClient,
      nodeInternalsPollIntervalMs: 3000,
    });

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(getJson).not.toHaveBeenCalledWith(
      "http://172.28.2.9:5052/eth/v1/node/syncing",
    );
    adapter.dispose();
  });
});
