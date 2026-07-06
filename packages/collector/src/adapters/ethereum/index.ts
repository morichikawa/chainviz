// Ethereum プロファイルの ChainAdapter 実装。
// - A 層（インフラ）: Docker の観測値を NodeEntity / WorkbenchEntity へ正規化
// - B 層（P2P）: lighthouse の Beacon API をポーリングして PeerEdge を、
//   reth の eth_subscribe(newHeads) を購読してブロック受信時刻を集める
// reth / lighthouse / Beacon API / eth_subscribe といった Ethereum 固有の
// 語彙はこのアダプタ配下に閉じ込め、ワールドステートには漏らさない。

import type {
  BlockEntity,
  ChainAdapter,
  InfraEntity,
  NodeEntity,
  PeerEdge,
  TransactionEntity,
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
  fetchConnectedExecutionPeerIdentities,
  fetchExecutionPeerIdentity,
} from "./el-peers.js";
import {
  createFetchEthRpcClient,
  getBlockByHash,
  getTransactionByHash,
  type EthRpcClient,
} from "./eth-rpc-client.js";
import {
  createWsEthClient,
  type EthWsClient,
  type NewHeadsSubscription,
  type Subscription,
} from "./eth-ws-client.js";
import { createFetchHttpClient, type HttpClient } from "./http-client.js";
import { toPeerEdges, type NodePeers } from "./peers.js";
import {
  beaconTargets,
  executionPeerTargets,
  executionTargets,
  type BeaconTarget,
  type ExecutionPeerTarget,
} from "./targets.js";
import { TransactionLifecycleTracker } from "./transactions.js";
import {
  deriveWalletAddress,
  workbenchWalletIndex,
} from "./wallet-derivation.js";

/** ピアポーリングの既定間隔。 */
export const PEER_POLL_INTERVAL_MS = 3000;

/** EthereumAdapter に差し込める依存（テストでモックへ差し替えるため）。 */
export interface EthereumAdapterDeps {
  httpClient?: HttpClient;
  ethWsClient?: EthWsClient;
  /** tx 詳細・ブロック内 tx 一覧を取得する HTTP JSON-RPC クライアント。 */
  ethRpcClient?: EthRpcClient;
  peerPollIntervalMs?: number;
  /** テスト用の時刻ソース。既定は Date.now。 */
  now?: () => number;
  /**
   * ワークベンチのウォレットアドレス導出に使う mnemonic（values.env 由来）。
   * 与えられた場合、A 層で WorkbenchEntity.walletIds に主たるウォレットの
   * アドレスを載せる。未指定なら walletIds は空のまま。
   */
  mnemonic?: string;
  /** mnemonic + index からアドレスを導出する関数（テスト差し替え用）。 */
  deriveAddress?: (mnemonic: string, index: number) => string;
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
  private readonly ethRpc: EthRpcClient;
  private readonly peerPollIntervalMs: number;
  private readonly now: () => number;
  private readonly mnemonic?: string;
  private readonly deriveAddress: (mnemonic: string, index: number) => string;
  private readonly blockTracker = new BlockPropagationTracker();
  private readonly txTracker = new TransactionLifecycleTracker();

  private peerTimer?: ReturnType<typeof setTimeout>;
  private peerLoopRunning = false;
  private blockSubscriptions: NewHeadsSubscription[] = [];
  private txSubscriptions: Subscription[] = [];
  // 同一ブロックを複数ノードが newHeads で通知するため、included 判定用の
  // ブロック取得を 1 ブロックにつき 1 回だけに絞る（重複した RPC を避ける）。
  private readonly processedBlocks = new Set<string>();
  private readonly maxProcessedBlocks = 500;

  constructor(
    private readonly poller: DockerPoller,
    deps: EthereumAdapterDeps = {},
  ) {
    this.http = deps.httpClient ?? createFetchHttpClient();
    this.ethWs = deps.ethWsClient ?? createWsEthClient();
    this.ethRpc = deps.ethRpcClient ?? createFetchEthRpcClient();
    this.peerPollIntervalMs = deps.peerPollIntervalMs ?? PEER_POLL_INTERVAL_MS;
    this.now = deps.now ?? (() => Date.now());
    this.mnemonic = deps.mnemonic;
    this.deriveAddress = deps.deriveAddress ?? deriveWalletAddress;
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
        walletIds: this.workbenchWalletIds(obs),
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

  /**
   * ワークベンチが主に使うウォレットのアドレスを walletIds として返す。導出
   * インデックスはコンテナのラベル（無ければ既定 0）から決め、mnemonic と
   * 合わせて WalletTracker と同じアドレスを再現する。これにより A 層のポーリング
   * ごとに walletIds が安定し（毎回同じアドレス）、C 層の WalletEntity と
   * 突き合わせられる。mnemonic 未設定なら空配列。
   */
  private workbenchWalletIds(obs: ContainerObservation): string[] {
    if (!this.mnemonic) return [];
    const index = workbenchWalletIndex(obs.labels);
    return [this.deriveAddress(this.mnemonic, index)];
  }

  // --- B 層: ピア接続 ---

  /**
   * ビーコン（CL）と reth（EL）の両方の P2P 接続を 1 巡ポーリングし、
   * PeerEdge[] へ正規化して返す。到達対象は Docker の観測値から決める。
   * CL（libp2p peer_id）と EL（enode 公開鍵）は識別子の名前空間が異なるため、
   * peers.ts の toPeerEdges にはそれぞれ別々の NodePeers[] として渡し、
   * 結果を連結する（混ぜて渡すと識別子の衝突判定が意味を持たなくなる）。
   * CL・EL・個々のノードいずれの問い合わせが失敗しても、そのノードだけ
   * 落として全体は継続する。
   */
  async pollPeersOnce(): Promise<PeerEdge[]> {
    const observations = await this.poller.pollOnce();
    const [consensusNodes, executionNodes] = await Promise.all([
      this.fetchConsensusPeerNodes(beaconTargets(observations)),
      this.fetchExecutionPeerNodes(executionPeerTargets(observations)),
    ]);
    return [...toPeerEdges(consensusNodes), ...toPeerEdges(executionNodes)];
  }

  /**
   * CL 側（Beacon API）のピア情報を対象ノードぶん並行に取得する。個々の
   * ノードへの問い合わせが失敗してもそのノードだけ落として継続する。
   */
  private async fetchConsensusPeerNodes(
    targets: BeaconTarget[],
  ): Promise<NodePeers[]> {
    const results = await Promise.all(
      targets.map(async (target): Promise<NodePeers | null> => {
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
    return results.filter((n): n is NodePeers => n !== null);
  }

  /**
   * EL 側（admin_nodeInfo / admin_peers）のピア情報を対象ノードぶん並行に
   * 取得する。個々のノードへの問い合わせが失敗してもそのノードだけ落として
   * 継続する（`admin` API が無効なノードなどを想定。ログを残して CL 側と
   * 挙動を揃えつつ原因を追えるようにする）。
   */
  private async fetchExecutionPeerNodes(
    targets: ExecutionPeerTarget[],
  ): Promise<NodePeers[]> {
    const results = await Promise.all(
      targets.map(async (target): Promise<NodePeers | null> => {
        try {
          const [peerId, connectedPeerIds] = await Promise.all([
            fetchExecutionPeerIdentity(this.ethRpc, target.rpcUrl),
            fetchConnectedExecutionPeerIdentities(this.ethRpc, target.rpcUrl),
          ]);
          return {
            stableId: target.stableId,
            peerId,
            networkId: target.networkId,
            connectedPeerIds,
          };
        } catch (err) {
          console.error(
            `[ethereum] execution peer poll failed for ${target.stableId}:`,
            err,
          );
          return null;
        }
      }),
    );
    return results.filter((n): n is NodePeers => n !== null);
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

  // --- C 層: tx ライフサイクル（pending → included） ---

  /**
   * C 層: tx のライフサイクルを購読する。各 Execution ノードに対し
   * newPendingTransactions（mempool 投入の検知）と newHeads（ブロック取り込みの
   * 検知）を購読し、状態が変化した TransactionEntity を onTx へ渡す。
   *
   * newHeads は B 層の subscribeBlocks でも購読しているが、あちらはブロック
   * 受信時刻（伝播アニメーション）専用で tx を扱わない。層ごとに関心を分離する
   * ため C 層は独自に newHeads を購読し、ここではブロック内 tx 一覧の突き合わせ
   * だけを行う。同一ブロックは複数ノードから通知されるので、included 判定用の
   * ブロック取得は processedBlocks で 1 回に絞る。
   */
  async subscribeTransactions(
    onTx: (tx: TransactionEntity) => void,
  ): Promise<void> {
    const observations = await this.poller.pollOnce();
    const targets = executionTargets(observations);

    for (const target of targets) {
      const pendingSub = this.ethWs.subscribePendingTransactions(
        target.wsUrl,
        (hash) => void this.handlePendingTx(target.rpcUrl, hash, onTx),
        (err) =>
          console.error(
            `[ethereum] pending tx subscription failed for ${target.stableId}:`,
            err,
          ),
      );
      this.txSubscriptions.push(pendingSub);

      const inclusionSub = this.ethWs.subscribeNewHeads(
        target.wsUrl,
        (header) =>
          void this.handleBlockInclusion(target.rpcUrl, header.hash, onTx),
        (err) =>
          console.error(
            `[ethereum] tx inclusion subscription failed for ${target.stableId}:`,
            err,
          ),
      );
      this.txSubscriptions.push(inclusionSub);
    }
  }

  /**
   * newPendingTransactions で得た tx ハッシュの詳細（from/to）を HTTP JSON-RPC で
   * 取得し、pending として記録する。まだ伝播していない等で詳細が取れない場合は
   * 何もしない。取得失敗はログして握り、購読自体は継続させる。
   */
  private async handlePendingTx(
    rpcUrl: string,
    hash: string,
    onTx: (tx: TransactionEntity) => void,
  ): Promise<void> {
    try {
      const detail = await getTransactionByHash(this.ethRpc, rpcUrl, hash);
      if (!detail) return;
      const entity = this.txTracker.recordPending(detail);
      if (entity) onTx(entity);
    } catch (err) {
      console.error(`[ethereum] failed to fetch pending tx ${hash}:`, err);
    }
  }

  /**
   * newHeads で得たブロックハッシュから、ブロックに含まれる tx 一覧を HTTP
   * JSON-RPC で取得し、pending だった tx を included へ遷移させる（未追跡の tx は
   * included として新規追加）。取得失敗はログして握り、購読自体は継続させる。
   */
  private async handleBlockInclusion(
    rpcUrl: string,
    blockHash: string,
    onTx: (tx: TransactionEntity) => void,
  ): Promise<void> {
    if (!this.markBlockProcessed(blockHash)) return;
    try {
      const block = await getBlockByHash(this.ethRpc, rpcUrl, blockHash);
      if (!block) {
        // ブロックがまだ取得できない（伝播遅延など）。処理済みマークを外し、
        // 同一ブロックを通知する後続ノードからの newHeads で再試行できるように
        // する。複数ノードが同一ブロックを通知する性質がそのまま再試行機構になる。
        this.processedBlocks.delete(blockHash);
        return;
      }
      const changed = this.txTracker.recordInclusion(
        block.hash,
        block.transactions,
      );
      for (const entity of changed) onTx(entity);
    } catch (err) {
      // 取得に失敗した場合も処理済みマークを外し、後続ノードからの通知で
      // 再試行できるようにする（さもないと当該ブロックの tx が pending のまま固まる）。
      this.processedBlocks.delete(blockHash);
      console.error(
        `[ethereum] failed to fetch block ${blockHash} for tx inclusion:`,
        err,
      );
    }
  }

  /**
   * ブロックハッシュを「処理中/処理済み」として記録し、初回なら true を返す。
   * 既に記録済みなら false（別ノードからの重複通知）。RPC 取得に失敗した場合は
   * 呼び出し側が processedBlocks から当該ハッシュを削除し、後続ノードからの通知で
   * 再試行できるようにする。保持数の上限を超えたら古いものから捨てる
   * （メモリ無制限化の防止）。
   */
  private markBlockProcessed(blockHash: string): boolean {
    if (this.processedBlocks.has(blockHash)) return false;
    this.processedBlocks.add(blockHash);
    while (this.processedBlocks.size > this.maxProcessedBlocks) {
      const oldest = this.processedBlocks.values().next().value;
      if (oldest === undefined) break;
      this.processedBlocks.delete(oldest);
    }
    return true;
  }

  /** ピアポーリング・ブロック購読・tx 購読を停止する（テスト・シャットダウン用）。 */
  dispose(): void {
    this.peerLoopRunning = false;
    if (this.peerTimer) {
      clearTimeout(this.peerTimer);
      this.peerTimer = undefined;
    }
    for (const sub of this.blockSubscriptions) sub.close();
    this.blockSubscriptions = [];
    for (const sub of this.txSubscriptions) sub.close();
    this.txSubscriptions = [];
  }
}
