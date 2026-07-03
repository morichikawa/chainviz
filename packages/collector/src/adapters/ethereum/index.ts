// Ethereum プロファイルの ChainAdapter 実装。
// - A 層（インフラ）: Docker の観測値を NodeEntity / WorkbenchEntity へ正規化
// - B 層（P2P）: lighthouse の Beacon API をポーリングして PeerEdge を、
//   reth の eth_subscribe(newHeads) を購読してブロック受信時刻を集める
// reth / lighthouse / Beacon API / eth_subscribe といった Ethereum 固有の
// 語彙はこのアダプタ配下に閉じ込め、ワールドステートには漏らさない。

import type {
  BlockEntity,
  ChainAdapter,
  DiffEvent,
  InfraEntity,
  NodeEntity,
  PeerEdge,
  WorkbenchEntity,
  WorldStateSnapshot,
} from "@chainviz/shared";
import type { DockerPoller } from "../../docker/poller.js";
import type {
  ContainerObservation,
  ContainerProcess,
} from "../../docker/types.js";
import {
  fetchConnectedPeerIds,
  fetchNodePeerId,
} from "./beacon-api.js";
import { BlockPropagationTracker } from "./blocks.js";
import { classifyContainer } from "./classify.js";
import {
  createWsEthClient,
  type EthWsClient,
  type NewHeadsSubscription,
} from "./eth-ws-client.js";
import { createFetchHttpClient, type HttpClient } from "./http-client.js";
import { toPeerEdges, type BeaconNodePeers } from "./peers.js";
import { beaconTargets, executionTargets } from "./targets.js";

/** ピアポーリングの既定間隔。 */
export const PEER_POLL_INTERVAL_MS = 3000;

/** EthereumAdapter に差し込める依存（テストでモックへ差し替えるため）。 */
export interface EthereumAdapterDeps {
  httpClient?: HttpClient;
  ethWsClient?: EthWsClient;
  peerPollIntervalMs?: number;
  /** テスト用の時刻ソース。既定は Date.now。 */
  now?: () => number;
}

/**
 * InfraEntity.process は単一プロセスなので、コンテナ内の複数プロセスから
 * 「代表プロセス」を1つ選ぶ。優先名（クライアント種別など）に一致するものを
 * 優先し、無ければ先頭プロセス、それも無ければ "unknown" とする。
 */
function pickPrimaryProcess(
  processes: ContainerProcess[],
  preferred: string,
): { name: string; version?: string } {
  if (preferred) {
    const match = processes.find((p) => p.name === preferred);
    if (match) return { name: match.name };
  }
  const first = processes[0];
  if (first && first.name.length > 0) return { name: first.name };
  return { name: "unknown" };
}

export class EthereumAdapter implements ChainAdapter {
  readonly chainType = "ethereum" as const;

  private readonly http: HttpClient;
  private readonly ethWs: EthWsClient;
  private readonly peerPollIntervalMs: number;
  private readonly now: () => number;
  private readonly blockTracker = new BlockPropagationTracker();

  private peerTimer?: ReturnType<typeof setTimeout>;
  private peerLoopRunning = false;
  private blockSubscriptions: NewHeadsSubscription[] = [];

  constructor(
    private readonly poller: DockerPoller,
    deps: EthereumAdapterDeps = {},
  ) {
    this.http = deps.httpClient ?? createFetchHttpClient();
    this.ethWs = deps.ethWsClient ?? createWsEthClient();
    this.peerPollIntervalMs = deps.peerPollIntervalMs ?? PEER_POLL_INTERVAL_MS;
    this.now = deps.now ?? (() => Date.now());
  }

  /** A 層: Docker をポーリングし、コンテナを NodeEntity / WorkbenchEntity へ正規化する。 */
  async pollInfra(): Promise<Partial<WorldStateSnapshot>> {
    const observations = await this.poller.pollOnce();
    return {
      chainType: this.chainType,
      entities: observations.map((o) => this.toEntity(o)),
    };
  }

  private toEntity(obs: ContainerObservation): NodeEntity | WorkbenchEntity {
    const classification = classifyContainer(obs);
    const infra: InfraEntity = {
      id: obs.stableId,
      containerName: obs.name,
      ip: obs.ip,
      ports: obs.ports,
      resources: obs.resources,
      process: pickPrimaryProcess(obs.processes, classification.clientType),
    };

    if (classification.kind === "workbench") {
      return {
        ...infra,
        kind: "workbench",
        label: classification.label,
        walletIds: [],
      };
    }

    // A 層では同期状態・ブロック高は取得しない（B/C 層で埋める）。
    return {
      ...infra,
      kind: "node",
      chainType: this.chainType,
      clientType: classification.clientType,
      syncStatus: "syncing",
      blockHeight: 0,
      headBlockHash: "",
    };
  }

  // --- B 層: ピア接続 ---

  /**
   * ビーコンノードの Beacon API を 1 巡ポーリングし、接続関係を PeerEdge[] へ
   * 正規化して返す。到達対象は Docker の観測値から決める。個々のノードへの
   * 問い合わせが失敗しても、そのノードだけ落として全体は継続する。
   */
  async pollPeersOnce(): Promise<PeerEdge[]> {
    const observations = await this.poller.pollOnce();
    const targets = beaconTargets(observations);

    const results = await Promise.all(
      targets.map(async (target): Promise<BeaconNodePeers | null> => {
        try {
          const [peerId, connectedPeerIds] = await Promise.all([
            fetchNodePeerId(this.http, target.baseUrl),
            fetchConnectedPeerIds(this.http, target.baseUrl),
          ]);
          return {
            stableId: target.stableId,
            peerId,
            networkId: target.networkId,
            connectedPeerIds,
          };
        } catch {
          return null;
        }
      }),
    );

    const nodes = results.filter((n): n is BeaconNodePeers => n !== null);
    return toPeerEdges(nodes);
  }

  /**
   * B 層: ピア接続の購読。Beacon API を周期ポーリングし、毎回の PeerEdge[] を
   * onUpdate へ渡す。前回のポーリング完了後に次を予約する（重複実行を避ける）。
   */
  subscribePeers(onUpdate: (edges: PeerEdge[]) => void): void {
    if (this.peerLoopRunning) return;
    this.peerLoopRunning = true;

    const tick = async (): Promise<void> => {
      if (!this.peerLoopRunning) return;
      try {
        const edges = await this.pollPeersOnce();
        onUpdate(edges);
      } catch (err) {
        console.error("[ethereum] peer poll failed:", err);
      }
      if (this.peerLoopRunning) {
        this.peerTimer = setTimeout(() => void tick(), this.peerPollIntervalMs);
      }
    };

    void tick();
  }

  /**
   * B 層: 各 Execution ノードの eth_subscribe(newHeads) を購読し、Collector が
   * ブロックを受信した実時刻をブロック単位で束ねて onBlock へ渡す。到達対象は
   * Docker の観測値から一度だけ列挙し、各ノードへ永続 WebSocket を張る。
   */
  async subscribeBlocks(onBlock: (block: BlockEntity) => void): Promise<void> {
    const observations = await this.poller.pollOnce();
    const targets = executionTargets(observations);

    for (const target of targets) {
      const subscription = this.ethWs.subscribeNewHeads(
        target.wsUrl,
        (header) => {
          const block = this.blockTracker.record(
            target.receivedAtKey,
            header,
            this.now(),
          );
          onBlock(block);
        },
        (err) =>
          console.error(
            `[ethereum] newHeads subscription failed for ${target.stableId}:`,
            err,
          ),
      );
      this.blockSubscriptions.push(subscription);
    }
  }

  /** ピアポーリングとブロック購読を停止する（テスト・シャットダウン用）。 */
  dispose(): void {
    this.peerLoopRunning = false;
    if (this.peerTimer) {
      clearTimeout(this.peerTimer);
      this.peerTimer = undefined;
    }
    for (const sub of this.blockSubscriptions) sub.close();
    this.blockSubscriptions = [];
  }

  /** C 層: チェーンイベントの購読。Phase 3 で実装する。 */
  subscribeChainEvents(onEvent: (event: DiffEvent) => void): void {
    // 未実装（B 層の範囲外）。
    void onEvent;
  }
}
