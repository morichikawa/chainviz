// Ethereum プロファイルの ChainAdapter 実装。
// - A 層（インフラ）: Docker の観測値を NodeEntity / WorkbenchEntity へ正規化
// - B 層（P2P）: lighthouse の Beacon API をポーリングして PeerEdge を、
//   reth の eth_subscribe(newHeads) を購読してブロック受信時刻を集める
// reth / lighthouse / Beacon API / eth_subscribe といった Ethereum 固有の
// 語彙はこのアダプタ配下に閉じ込め、ワールドステートには漏らさない。

import type {
  BlockEntity,
  ChainAdapter,
  ContractCall,
  ContractEntity,
  ContractEvent,
  InfraEntity,
  NodeEntity,
  NodeInternalsHandlers,
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
  fetchBeaconSyncing,
  fetchConnectedPeerIds,
  fetchNodePeerId,
} from "./beacon-api.js";
import { BeaconSyncStatusCache, resolveBeaconSyncStatus } from "./beacon-sync-status.js";
import { BlockPropagationTracker } from "./blocks.js";
import type { ContractCatalog } from "./catalog.js";
import { classifyContainer } from "./classify.js";
import { ContractTracker, normalizeAddress } from "./contracts.js";
import { decodeContractCall, decodeContractEvent } from "./decode.js";
import { MANAGED_LABEL, P2P_ROLE_LABEL, ROLE_LABEL } from "./labels.js";
import {
  fetchConnectedExecutionPeerIdentities,
  fetchExecutionPeerIdentity,
} from "./el-peers.js";
import {
  createFetchEthRpcClient,
  getBlockReceipts,
  getTransactionByHash,
  type EthRpcClient,
  type RpcLog,
  type RpcTransactionReceipt,
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
  createFetchRethMetricsClient,
  type RethMetricsClient,
} from "./reth-metrics-client.js";
import {
  NODE_INTERNALS_POLL_INTERVAL_MS,
  RethMetricsTracker,
} from "./reth-metrics-tracker.js";
import { pollRethNodeInternals } from "./reth-node-internals.js";
import { NodeSyncStatusCache } from "./sync-status.js";
import {
  beaconStableIdForExecution,
  beaconTargets,
  executionMetricsTargets,
  executionPeerTargets,
  executionStableIdForBeacon,
  executionTargets,
  isValidatorService,
  type BeaconTarget,
  type ExecutionMetricsTarget,
  type ExecutionPeerTarget,
} from "./targets.js";
import { TransactionLifecycleTracker } from "./transactions.js";
import {
  deriveWalletAddress,
  workbenchWalletIndex,
} from "./wallet-derivation.js";

/** ピアポーリングの既定間隔。 */
export const PEER_POLL_INTERVAL_MS = 3000;

/**
 * CL（Beacon API）側ピアポーリングの失敗ログを間引く周期（連続失敗回数
 * ベース。Issue #287）。Beacon API がハングし続ける状況では
 * `fetchConsensusPeerNodes` が `subscribePeers` のループ間隔
 * （`peerPollIntervalMs`、既定は上記の 3000ms だがコンストラクタ引数で
 * 変更可能）ごとに同一ノードへ問い合わせては失敗する。これを毎回ログすると
 * 長時間のハング中に大量の同内容ログが出続けるため、1 回目の失敗は必ず
 * ログしつつ、以降はこの回数に 1 回だけ「まだ失敗し続けている」ことが
 * わかる頻度でログする。時間ベース（○○秒に1回）ではなく回数ベースなのは、
 * `peerPollIntervalMs` を変えても間引きの相対頻度（何 tick に 1 回か）が
 * 変わらないようにするため（CLAUDE.md「今この瞬間に観測できる状態に依存
 * した固定値をロジックに埋め込まない」）。
 */
export const CONSENSUS_PEER_POLL_FAILURE_LOG_INTERVAL = 20;

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
  /**
   * ロギングプロキシの転送先ホスト（IP）。`resolveProxyTarget()` の結果を
   * `parseProxyTargetHost()` で解決したものを collector 本体（index.ts）が
   * 渡す。全ワークベンチの実効的な RPC 到達先はこのホストであるため、
   * `pollInfra()` はここに一致する IP を持つノードを探して
   * `WorkbenchEntity.rpcTargetNodeId` を解決する（Issue #123）。
   * 未指定・解決不能な場合は rpcTargetNodeId を省略する。
   */
  rpcTargetHost?: string;
  /**
   * profiles/ethereum/contracts/catalog.json を読み込んだ結果（Issue #161）。
   * 未指定・読み込み失敗時は undefined とし、コントラクトのデプロイ検知自体は
   * 続けつつ、名前/token 等カタログ由来の情報を付与しない「未知のコントラクト」
   * 縮退動作にする（docs/ARCHITECTURE.md §4 参照。呼び出し側の main() が
   * readContractCatalog() の失敗をログしたうえで undefined を渡す）。
   */
  catalog?: ContractCatalog;
  /**
   * D層: ノード内部メトリクス（Prometheus、Issue #184/#185）を取得する HTTP
   * クライアント。未指定なら `createFetchRethMetricsClient()`（実 fetch）。
   */
  rethMetricsClient?: RethMetricsClient;
  /**
   * D層: ノード内部メトリクスのスクレイプ間隔。未指定なら
   * `NODE_INTERNALS_POLL_INTERVAL_MS`（3000ms。前提条件は
   * reth-metrics-tracker.ts のコメント参照）。
   */
  nodeInternalsPollIntervalMs?: number;
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
  private readonly rpcTargetHost?: string;
  private readonly blockTracker = new BlockPropagationTracker();
  private readonly txTracker = new TransactionLifecycleTracker();
  private readonly contractTracker: ContractTracker;
  private readonly rethMetricsClient: RethMetricsClient;
  private readonly rethMetricsTracker = new RethMetricsTracker();
  private readonly nodeInternalsPollIntervalMs: number;
  // D層観測（reth の Finish checkpoint）から NodeEntity.syncStatus/
  // blockHeight を解決するためのキャッシュ（Issue #187）。書き込みは
  // pollOneNodeInternals（D層）、読み出しは toEntity（A層。pollInfra）から
  // 行う（docs/ARCHITECTURE.md §7.3「情報源はアダプタ内のキャッシュとし、
  // pollInfra がキャッシュから値を埋める」）。
  private readonly syncStatusCache = new NodeSyncStatusCache();
  // D層観測（Beacon API の自己申告同期状態）から CL（beacon）ノードの
  // NodeEntity.syncStatus/blockHeight を解決するためのキャッシュ
  // （Issue #274）。syncStatusCache（EL 用）とは対象ノード集合が互いに素で
  // 判定ロジックも異なるため別のキャッシュに分ける。書き込み・読み出しの
  // タイミングは syncStatusCache と同じ。
  private readonly beaconSyncStatusCache = new BeaconSyncStatusCache();

  private peerTimer?: ReturnType<typeof setTimeout>;
  private peerLoopRunning = false;
  private blockSubscriptions: NewHeadsSubscription[] = [];
  private txSubscriptions: Subscription[] = [];
  // subscribeContracts で登録されたコールバック。未登録（subscribeContracts が
  // 呼ばれていない）場合は undefined で、ブロック取り込み処理内のコントラクト
  // デプロイ検知は追跡はするが配信はしない。
  private onContract?: (contract: ContractEntity) => void;
  // subscribeTransactions で登録されたコールバック。onContract と同様に
  // フィールドとして保持する（Issue #244）。handlePendingTx/
  // handleBlockInclusion は購読開始時のクロージャ引数としても onTx を持つが、
  // registerContractDeployment（購読とは別の呼び出し経路）からデプロイ tx の
  // 再復号結果を配信するにはこのフィールド経由が必要になる。onTx 未登録
  // （subscribeTransactions が呼ばれていない）場合でも txTracker の更新自体は
  // 行う（detectContractDeployments の「onContract 未登録でも追跡する」流儀と
  // 同じ）。
  private onTx?: (tx: TransactionEntity) => void;
  // 同一ブロックを複数ノードが newHeads で通知するため、included 判定用の
  // ブロック取得を 1 ブロックにつき 1 回だけに絞る（重複した RPC を避ける）。
  private readonly processedBlocks = new Set<string>();
  private readonly maxProcessedBlocks = 500;
  // デプロイ tx のうち、ブロック取り込み時点では発行元コントラクトがカタログ
  // 未照合だった（`decodeReceiptLogs` が raw フォールバックになった）ものの
  // 生ログを、カタログ登録の後着（Issue #244）に備えて一時保持する。キーは
  // `normalizeAddress` で正規化したコントラクトアドレス。
  // `registerContractDeployment` が「未知 → カタログ既知」への昇格を検知した
  // 時点でここから引いて再復号し、削除する（後始末は catalog 照合の適用時に
  // 行う。詳細は bufferUndecodedDeployLogs / redecodeBufferedDeployLogs の
  // コメント参照）。
  private readonly undecodedDeployLogs = new Map<
    string,
    { txHash: string; logs: RpcLog[] }
  >();
  // undecodedDeployLogs の上限（挿入順で古いものから evict）。前提: GUI の
  // deployContract 操作は逐次実行されるため、カタログ登録が未照合のまま
  // 同時に溜まるデプロイ tx は通常 1〜数件程度にとどまる。手動 forge create
  // 等、永遠に登録が来ないデプロイが積み重なってメモリを無制限に消費しない
  // ようにするための保険であり、実運用のワークベンチ数・操作頻度から見て
  // この上限に達することは通常想定されない（processedBlocks/txTracker の
  // maxTxs と同じ考え方）。
  private readonly maxUndecodedDeployLogs = 200;

  // subscribeNodeInternals（D層）の周期ループ用状態。subscribePeers と同型
  // （ノード横断で使い回す RethMetricsTracker とは別に、ループの生死管理だけ
  // ここに持つ）。
  private nodeInternalsTimer?: ReturnType<typeof setTimeout>;
  private nodeInternalsLoopRunning = false;
  // 前回 tick で観測できた execution ノードの stableId 集合。ノードが観測から
  // 消えた（removeNode 等）場合に RethMetricsTracker.forgetNode() で前回値を
  // 破棄するために保持する（Issue #185 の申し送り）。
  private trackedNodeInternalsIds = new Set<string>();
  // 前回 tick で観測できた beacon（CL）ノードの stableId 集合（Issue #274）。
  // trackedNodeInternalsIds（EL 用）とは対象が互いに素なので別集合で追跡
  // する（混ぜると forgetNode 先のキャッシュが曖昧になる）。
  private trackedBeaconSyncIds = new Set<string>();
  // CL（Beacon API）側ピアポーリングの連続失敗回数（stableId ごと。
  // Issue #287）。fetchConsensusPeerNodes の catch 節でのログ間引きに使う。
  // 成功したエントリは削除し（次に失敗したときまた「1 回目」として扱う）、
  // 対象ノード集合から外れた stableId は fetchConsensusPeerNodes の呼び出し
  // 冒頭で捨てる（Map が無制限に肥大化しないようにする。
  // trackedNodeInternalsIds と同じ「毎 tick 現在の対象集合と突き合わせる」
  // 方式）。
  private readonly consensusPeerFailureCounts = new Map<string, number>();

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
    this.rpcTargetHost = deps.rpcTargetHost;
    this.contractTracker = new ContractTracker(this.chainType, deps.catalog);
    this.rethMetricsClient =
      deps.rethMetricsClient ?? createFetchRethMetricsClient();
    this.nodeInternalsPollIntervalMs =
      deps.nodeInternalsPollIntervalMs ?? NODE_INTERNALS_POLL_INTERVAL_MS;
  }

  /**
   * A 層: Docker をポーリングし、コンテナを NodeEntity / WorkbenchEntity へ正規化する。
   *
   * `rpcTargetHost`（ロギングプロキシの転送先ホスト）が設定されている場合、
   * 同じポーリング観測から `ip === rpcTargetHost` のノードを探し、見つかれば
   * その `stableId` を全ワークベンチの `rpcTargetNodeId` に設定する。毎回の
   * ポーリングで解決し直すため、転送先ノードが再作成されて IP が変わらない
   * 限り（ブートノードの stableId 自体が変わっても）追従する。見つからない
   * 場合は省略する（旧スナップショット・解決不能との互換）。
   *
   * 補足（Issue #129で解消済み）: 動的追加ワークベンチ（addWorkbench）も
   * 静的ワークベンチと同じくロギングプロキシ経由になったため（node-lifecycle.ts
   * の resolveWorkbenchRpcUrl 参照）、rpcTargetNodeId の解決先と実際の
   * RPC呼び出し先は一致する。
   *
   * D層（Issue #186）: 同じポーリング観測から、beacon（CL）ノードが内部 API
   * （Engine API）で駆動する Execution（EL）ノードの stableId も毎回解決し、
   * `NodeEntity.drivesNodeId` に設定する（`rpcTargetNodeId` と同じ
   * 「独立した購読ではなく A 層のポーリングで毎回解決する」流儀。
   * docs/ARCHITECTURE.md §7.3）。
   *
   * D層（Issue #187 / #274）: `NodeEntity.syncStatus`/`blockHeight` も、
   * subscribeNodeInternals（D層の周期ポーリング）が別途更新している
   * `syncStatusCache`（EL、reth の Finish checkpoint 由来）/
   * `beaconSyncStatusCache`（CL、Beacon API の自己申告同期状態由来）から
   * `toEntity()` が毎回埋める。書き手は本メソッド（applyInfra 経由）1 本の
   * まま変わらない（docs/worklog/issue-187.md・issue-274.md 参照）。
   */
  async pollInfra(): Promise<Partial<WorldStateSnapshot>> {
    const observations = await this.poller.pollOnce();
    const entities = observations.map((o) => this.toEntity(o));
    const rpcTargetNodeId = this.resolveRpcTargetNodeId(entities);
    if (rpcTargetNodeId !== undefined) {
      for (const entity of entities) {
        if (entity.kind === "workbench") entity.rpcTargetNodeId = rpcTargetNodeId;
      }
    }
    this.resolveDrivesNodeId(entities, observations);
    return {
      chainType: this.chainType,
      entities,
    };
  }

  /**
   * 同じポーリング観測（entities）の中から `ip === rpcTargetHost` のノードを
   * 探し、その stableId（= entity.id）を返す。`rpcTargetHost` 未設定、または
   * 一致するノードが観測に無ければ undefined（呼び出し側は設定をスキップする）。
   */
  private resolveRpcTargetNodeId(
    entities: (NodeEntity | WorkbenchEntity)[],
  ): string | undefined {
    if (!this.rpcTargetHost) return undefined;
    const target = entities.find(
      (e): e is NodeEntity => e.kind === "node" && e.ip === this.rpcTargetHost,
    );
    return target?.id;
  }

  /**
   * 各 NodeEntity について、対応する ContainerObservation を
   * `executionStableIdForBeacon()` に渡し、解決できれば `drivesNodeId` を
   * その場でパッチする（beacon ではないノード・対応が取れないノードは
   * 何もしない。省略 = 無し/不明の流儀）。`executionStableIdForBeacon` は
   * beacon 役でないコンテナに対して呼んでも常に undefined を返すため、全
   * NodeEntity へ機械的に呼んで問題ない。
   */
  private resolveDrivesNodeId(
    entities: (NodeEntity | WorkbenchEntity)[],
    observations: ContainerObservation[],
  ): void {
    const obsById = new Map(observations.map((o) => [o.stableId, o]));
    for (const entity of entities) {
      if (entity.kind !== "node") continue;
      const obs = obsById.get(entity.id);
      if (!obs) continue;
      const drivesNodeId = executionStableIdForBeacon(obs, observations);
      if (drivesNodeId !== undefined) entity.drivesNodeId = drivesNodeId;
    }
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
      // collector が addNode/addWorkbench で作成したコンテナだけ削除操作を
      // 許可する（Issue #103）。判定は起動時に回収するレジストリではなく
      // Docker の managed ラベルそのものから行う（Issue #65 で確定した
      // 「ラベルを単一の真実の情報源とする」方針との整合を保つ）。
      removable: obs.labels[MANAGED_LABEL] === "true",
    };

    if (classification.kind === "workbench") {
      return {
        ...infra,
        kind: "workbench",
        label: classification.label,
        walletIds: this.workbenchWalletIds(obs),
      };
    }

    // 同期状態・ブロック高は D層観測のキャッシュから埋める。EL ノードは
    // reth の Finish checkpoint（syncStatusCache、Issue #187）、CL ノードは
    // Beacon API の自己申告同期状態（beaconSyncStatusCache、Issue #274）。
    // 両キャッシュの対象ノード集合は互いに素なので参照順に意味は無い。
    // どちらにも観測が無い（観測前・reth のバージョン差で Finish メトリクス
    // 自体が無い・lighthouse 以外の CL クライアントで is_syncing が読めない
    // 等）場合は既存のプレースホルダのまま（headBlockHash は本Issueのスコープ
    // 外で常に空文字列。docs/ARCHITECTURE.md §7.3、docs/worklog/issue-187.md・
    // issue-274.md 参照）。
    const resolvedSync =
      this.syncStatusCache.resolve(obs.stableId) ??
      this.beaconSyncStatusCache.resolve(obs.stableId);
    const roleLabel = obs.labels[ROLE_LABEL];
    return {
      ...infra,
      kind: "node",
      chainType: this.chainType,
      clientType: classification.clientType,
      syncStatus: resolvedSync?.syncStatus ?? "syncing",
      blockHeight: resolvedSync?.blockHeight ?? 0,
      headBlockHash: "",
      // ノードの役割（Issue #215）。ROLE_LABEL（com.chainviz.role）の生値を
      // そのまま転記する。値の妥当性検証・解釈（execution/consensus/
      // validator の意味づけ）はフロントのチェーンプロファイル表現セットの
      // 責務であり、collector 側では加工しない（p2pRole のような値の
      // 正規化はしない）。ラベルが無い・空文字列の場合は省略する
      // （省略 = 不明。旧スナップショット・ラベル未付与コンテナとの互換）。
      ...(roleLabel ? { nodeRole: roleLabel } : {}),
      // P2P 上の役割（Issue #124、#214、#246）。優先順位は以下のとおり:
      // 1. ラベルが厳密に "bootnode" -> "bootnode"（デプロイ構成の選択。
      //    ラベルが無い・想定外の値の場合はこの分岐に該当しない）
      // 2. VC（validator client、com.chainviz.role ラベルが厳密に
      //    "validator"） -> "none"。VC は libp2p の P2P ネットワークに参加
      //    せず（beacon へ HTTP の Beacon API で接続するのみ）、PeerEdge の
      //    端点になることが決してないため、P2P 接続を前提にした表示
      //    （フロントの「接続確立中」エッジ等）の対象から除外できるように
      //    する（判定は compose サービス名ではなくロールラベルに基づく。
      //    isValidatorService のコメント参照。Issue #246 でサービス名
      //    ベースの判定から変更した）
      // 3. それ以外 -> "peer"（addNode で追加されるノードを含む通常ピア）
      p2pRole:
        obs.labels[P2P_ROLE_LABEL] === "bootnode"
          ? "bootnode"
          : isValidatorService(obs)
            ? "none"
            : "peer",
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
   * ノードへの問い合わせが失敗してもそのノードだけ落として継続する
   * （`admin` API 相当が届かない/タイムアウトするノードを想定。EL 側の
   * `fetchExecutionPeerNodes` と対称に、失敗ノードの stableId と実際の
   * エラー内容をログして原因を追えるようにする。ただし同一ノードが
   * 連続して失敗し続ける状況ではログ間引きを行う。詳細は
   * `logConsensusPeerPollFailure` 参照。Issue #287）。
   */
  private async fetchConsensusPeerNodes(
    targets: BeaconTarget[],
  ): Promise<NodePeers[]> {
    this.pruneConsensusPeerFailureCounts(targets);
    const results = await Promise.all(
      targets.map(async (target): Promise<NodePeers | null> => {
        try {
          const [peerId, connectedPeerIds] = await Promise.all([
            fetchNodePeerId(this.http, target.baseUrl),
            fetchConnectedPeerIds(this.http, target.baseUrl),
          ]);
          this.consensusPeerFailureCounts.delete(target.stableId);
          return {
            stableId: target.stableId,
            peerId,
            networkId: target.networkId,
            connectedPeerIds,
          };
        } catch (err) {
          this.logConsensusPeerPollFailure(target.stableId, err);
          return null;
        }
      }),
    );
    return results.filter((n): n is NodePeers => n !== null);
  }

  /**
   * `consensusPeerFailureCounts` から、今回の `targets` に含まれなくなった
   * stableId のエントリを取り除く（ノード削除等で観測から消えたノードの
   * 連続失敗回数が Map に残り続けないようにする。Issue #287）。
   */
  private pruneConsensusPeerFailureCounts(targets: BeaconTarget[]): void {
    const currentIds = new Set(targets.map((t) => t.stableId));
    for (const id of this.consensusPeerFailureCounts.keys()) {
      if (!currentIds.has(id)) this.consensusPeerFailureCounts.delete(id);
    }
  }

  /**
   * CL 側ピアポーリングの失敗を、連続失敗回数に応じて間引いてログする
   * （Issue #287）。1 回目（直前は成功していた、または初回の失敗）は
   * 必ずログし、以降は `CONSENSUS_PEER_POLL_FAILURE_LOG_INTERVAL` 回に
   * 1 回だけ「まだ失敗し続けている」ことがわかる頻度でログする。
   */
  private logConsensusPeerPollFailure(stableId: string, err: unknown): void {
    const count = (this.consensusPeerFailureCounts.get(stableId) ?? 0) + 1;
    this.consensusPeerFailureCounts.set(stableId, count);
    if (
      count === 1 ||
      count % CONSENSUS_PEER_POLL_FAILURE_LOG_INTERVAL === 0
    ) {
      const suffix = count > 1 ? ` (${count} consecutive failures)` : "";
      console.error(
        `[ethereum] consensus peer poll failed for ${stableId}${suffix}:`,
        err,
      );
    }
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
   * 受信 1 回につき target.receivedAtKeys の全キー（beacon と Execution
   * 自身、または Execution 自身のみ）へ同一時刻で記録することで、CL エッジ・
   * EL エッジの両方にブロック伝播パルスが乗るようにする（Issue #141）。
   */
  async subscribeBlocks(onBlock: (block: BlockEntity) => void): Promise<void> {
    const observations = await this.poller.pollOnce();
    const targets = executionTargets(observations);

    for (const target of targets) {
      const subscription = this.ethWs.subscribeNewHeads(
        target.wsUrl,
        (header) => {
          const block = this.blockTracker.record(
            target.receivedAtKeys,
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
    // registerContractDeployment（購読とは別の呼び出し経路）からも tx の
    // entityUpdated を配信できるよう、フィールドとしても保持する（Issue #244。
    // onContract と同じ流儀）。
    this.onTx = onTx;
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
   * newPendingTransactions で得た tx ハッシュの詳細（from/to/input）を HTTP
   * JSON-RPC で取得し、pending として記録する。まだ伝播していない等で詳細が
   * 取れない場合は何もしない。取得失敗はログして握り、購読自体は継続させる。
   *
   * 宛先（to）が追跡中のコントラクトであれば、input をカタログ照合の有無に
   * 関わらず TransactionEntity.contractCall へ反映する（カタログ未照合なら
   * rawFunctionId のみを持つ ContractCall になる。詳細は resolveContractCall
   * 参照。Issue #162）。追加の RPC 呼び出しは発生しない（input は既に
   * 呼んでいる eth_getTransactionByHash のレスポンスに含まれる）。
   */
  private async handlePendingTx(
    rpcUrl: string,
    hash: string,
    onTx: (tx: TransactionEntity) => void,
  ): Promise<void> {
    try {
      const detail = await getTransactionByHash(this.ethRpc, rpcUrl, hash);
      if (!detail) return;
      const contractCall = this.resolveContractCall(detail.to, detail.input);
      const entity = this.txTracker.recordPending({
        hash: detail.hash,
        from: detail.from,
        to: detail.to,
        ...(contractCall ? { contractCall } : {}),
      });
      if (entity) onTx(entity);
    } catch (err) {
      console.error(`[ethereum] failed to fetch pending tx ${hash}:`, err);
    }
  }

  /**
   * 宛先アドレスが追跡中のコントラクト（ContractTracker が ContractEntity を
   * 保持している = デプロイ済みと確認できている）であれば、input をカタログ
   * 照合の有無に関わらず ContractCall へ変換して返す（Issue #162、レビュー
   * 差し戻し 2026-07-07）。
   *
   * 判定は「追跡中か」（`contractTracker.get(to)`）であり、「カタログ照合
   * 済みか」（`getCatalogEntry(to)`）ではない点に注意。カタログ未照合の
   * 「未知のコントラクト」（docs/ARCHITECTURE.md §6.4）宛てでも、追跡さえ
   * されていれば decodeContractCall が rawFunctionId のみの ContractCall を
   * 返す（decodeContractEvent と対称。以前は catalogEntry が無いことを理由に
   * ここで即座に undefined を返しており、追跡中だが未カタログの宛先に
   * rawFunctionId すら載らない非対称なバグがあった）。
   *
   * 宛先がコントラクト作成（null）・そもそも追跡すらされていない（通常の
   * EOA 宛てなど）場合は undefined（呼び出し側は TransactionEntity.
   * contractCall を省略する。フロントは to と ContractEntity.address の
   * 照合でコントラクト宛て表示にフォールバックできる）。
   */
  private resolveContractCall(
    to: string | null,
    input: string,
  ): ContractCall | undefined {
    if (!to) return undefined;
    if (!this.contractTracker.get(to)) return undefined;
    const catalogEntry = this.contractTracker.getCatalogEntry(to);
    return decodeContractCall(catalogEntry, to, input);
  }

  /**
   * newHeads で得たブロックハッシュから、ブロックに含まれる全 tx の receipt を
   * HTTP JSON-RPC(eth_getBlockReceipts)で取得し、pending だった tx を
   * included/failed へ遷移させる（未追跡の tx は included/failed として新規
   * 追加）。receipt の succeeded(false)を world-state の "failed" へ、それ以外を
   * "included" へマッピングする。取得失敗はログして握り、購読自体は継続させる。
   *
   * receipt の contractAddress（コントラクト作成 tx でのみ非 null）は
   * TransactionEntity.createdContractAddress へマッピングする（Issue #160）。
   * receipt.logs（未復号のイベントログ）は、発行元コントラクトがカタログ
   * 照合済みであればその ABI で復号し、TransactionEntity.contractEvents へ
   * 反映する（Issue #162）。追加の RPC 呼び出しは発生しない（logs は既に
   * 呼んでいる eth_getBlockReceipts のレスポンスに含まれる。Issue #86 の
   * 方針を維持）。
   *
   * デプロイ検知（`detectContractDeployments`）は receipt.logs の復号より
   * **先に**行う（Issue #244 原因1対策）。同一ブロック内でカタログキーの
   * 事前登録（`ContractTracker.pendingCatalogKeys`）が先着していたケースは、
   * この順序でなければ復号に間に合わない。それでもカタログ登録
   * （`registerContractDeployment`）自体がブロック取り込みより後着する
   * ケース（実測で支配的）は、`bufferUndecodedDeployLogs` が生ログを保持し、
   * 登録の後着時に `redecodeBufferedDeployLogs` が再復号・再配信する
   * （原因2対策）。
   */
  private async handleBlockInclusion(
    rpcUrl: string,
    blockHash: string,
    onTx: (tx: TransactionEntity) => void,
  ): Promise<void> {
    if (!this.markBlockProcessed(blockHash)) return;
    try {
      const receipts = await getBlockReceipts(this.ethRpc, rpcUrl, blockHash);
      if (!receipts) {
        // ブロックがまだ取得できない（伝播遅延など）。処理済みマークを外し、
        // 同一ブロックを通知する後続ノードからの newHeads で再試行できるように
        // する。複数ノードが同一ブロックを通知する性質がそのまま再試行機構になる。
        this.processedBlocks.delete(blockHash);
        return;
      }
      this.detectContractDeployments(receipts);
      const changed = this.txTracker.recordInclusion(
        blockHash,
        receipts.map((r) => ({
          hash: r.transactionHash,
          from: r.from,
          to: r.to,
          status: r.succeeded ? "included" : "failed",
          // コントラクト作成 tx でのみ非 null。TransactionEntity.
          // createdContractAddress へマッピングされる（Issue #160）。
          contractAddress: r.contractAddress,
          // 発行元（log.address）ごとにカタログ照合を試み、可能なら ABI で
          // 復号する（Issue #162）。デプロイ検知を先に済ませているため、
          // カタログキーが事前登録済み（pendingCatalogKeys 先着）だった
          // デプロイ tx はこの時点で復号できる（Issue #244 原因1対策）。
          contractEvents: this.decodeReceiptLogs(r.logs),
        })),
      );
      for (const entity of changed) onTx(entity);
      this.bufferUndecodedDeployLogs(receipts);
    } catch (err) {
      // 取得に失敗した場合も処理済みマークを外し、後続ノードからの通知で
      // 再試行できるようにする（さもないと当該ブロックの tx が pending のまま固まる）。
      this.processedBlocks.delete(blockHash);
      console.error(
        `[ethereum] failed to fetch receipts for block ${blockHash} for tx inclusion:`,
        err,
      );
    }
  }

  // --- C 層（新 Phase 4）: コントラクトのデプロイ検知 ---

  /**
   * C 層: コントラクトのデプロイ検知・内容更新を購読する。docs/ARCHITECTURE.md
   * §4 の設計どおり、専用の購読・ポーリングは追加しない。subscribeTransactions が
   * 既にブロックごとに 1 回呼んでいる eth_getBlockReceipts の結果
   * （handleBlockInclusion）をそのまま使い回すため、ここでは onContract の
   * コールバックを保持するだけでよい（Promise<void> を返すのは ChainAdapter
   * インターフェースの形に合わせるためで、非同期処理自体は発生しない）。
   *
   * 注意: subscribeTransactions が呼ばれて newHeads の購読が実際に張られていない
   * 限り、ここで登録したコールバックが呼ばれることはない（Ethereum プロファイル
   * ではブロック取り込みの検知経路を tx 層と共有する設計のため。collector 本体
   * の main() は両方を配線する）。
   */
  async subscribeContracts(
    onContract: (contract: ContractEntity) => void,
  ): Promise<void> {
    this.onContract = onContract;
  }

  /**
   * runWorkbenchOperation(deployContract) 経由のデプロイについて、デプロイ先
   * アドレスとカタログキーの対応を登録する（EthereumNodeLifecycle が
   * デプロイ成功時に呼び出す。両者を直接結合すると循環依存になるため、
   * index.ts の main() が組み立て時にコールバックとして注入している。
   * ChainAdapter インターフェースには含めず、EthereumAdapter 固有の
   * 拡張 API とする）。
   *
   * 登録の結果、追跡中のコントラクトが「未知」から「カタログ既知」へ更新
   * された場合は、購読済みの onContract コールバックへその場で
   * entityUpdated 相当の最新エンティティを渡す（world-state store 側が
   * 差分を計算して entityUpdated として配信する）。デプロイをまだ検知して
   * いない場合は登録だけを保留し、コールバックは呼ばない（後続の
   * handleBlockInclusion がデプロイを検知した時点で、保留されたカタログキーを
   * 適用した状態の entityAdded がそのまま配信される）。
   *
   * この「未知 → カタログ既知」への昇格が起きた場合、対応するデプロイ tx の
   * 生ログが `bufferUndecodedDeployLogs` で保持されていれば併せて再復号し、
   * tx の entityUpdated も再配信する（Issue #244 原因2対策。自己修復）。
   * 配信順序はコントラクトの entityUpdated → tx の entityUpdated の順を保つ。
   */
  registerContractDeployment(address: string, contractKey: string): void {
    const updated = this.contractTracker.registerDeployment(address, contractKey);
    if (!updated) return;
    this.onContract?.(updated);
    this.redecodeBufferedDeployLogs(updated.address);
  }

  /**
   * 現在追跡中かつカタログの token メタ情報を持つコントラクトのアドレス一覧を
   * 返す（ContractTracker.tokenContractAddresses への委譲）。collector 本体
   * （index.ts）が WalletTracker のトークン残高ポーリング対象を決めるために
   * 使う（Issue #164）。ChainAdapter インターフェースには含めず、
   * registerContractDeployment と同じく EthereumAdapter 固有の拡張 API とする。
   */
  trackedTokenContractAddresses(): string[] {
    return this.contractTracker.tokenContractAddresses();
  }

  /**
   * ブロック取り込みで得た receipts から、コントラクト作成（contractAddress が
   * 非 null）を検知し、追跡中の onContract コールバックへ ContractEntity を渡す。
   * onContract 未登録（subscribeContracts が呼ばれていない）場合でも追跡自体は
   * 行う（後から registerDeployment / subscribeContracts が呼ばれても一貫した
   * 状態を返せるようにするため）。同一アドレスの重複通知（複数ノードからの
   * 同一ブロック通知）は ContractTracker 側で無視される。
   */
  private detectContractDeployments(receipts: RpcTransactionReceipt[]): void {
    for (const r of receipts) {
      if (!r.contractAddress) continue;
      const entity = this.contractTracker.recordDeployment({
        address: r.contractAddress,
        deployerAddress: r.from,
        createdByTxHash: r.transactionHash,
      });
      if (entity) this.onContract?.(entity);
    }
  }

  /**
   * receipt.logs（未復号）を、発行元（log.address）ごとにカタログ照合を
   * 試みたうえで ContractEvent[] へ復号する（Issue #162）。ログ 1 件ごとに
   * 発行元が異なりうる（tx が呼び出した先のコントラクトが、別のコントラクト
   * を呼び出してイベントを発する場合がある）ため、tx.to ではなく各ログの
   * address で個別に照合する。
   */
  private decodeReceiptLogs(logs: RpcLog[]): ContractEvent[] {
    return logs.map((log) =>
      decodeContractEvent(this.contractTracker.getCatalogEntry(log.address), log),
    );
  }

  /**
   * デプロイ tx のうち、発行元コントラクト（receipt.contractAddress）が
   * ブロック取り込みの時点でカタログ未照合だったものの生ログを保持する
   * （Issue #244 原因2対策）。カタログ登録（`registerContractDeployment`）が
   * ブロック取り込みより後着した場合、`decodeReceiptLogs` は raw
   * フォールバックで確定配信されてしまう。ここで保持しておき、後着した登録が
   * 「未知 → カタログ既知」への昇格を起こした時点で `redecodeBufferedDeployLogs`
   * が再復号する。追加の RPC 呼び出しはしない（receipt.logs は既に手元に
   * ある。Issue #86 の方針を維持）。
   *
   * カタログ照合済み（初回から復号できた）デプロイ tx や、ログを持たない tx
   * は保持不要なので対象外（`getCatalogEntry` が値を返す = 既に復号済み）。
   * 本メソッドは `detectContractDeployments` の後（デプロイ検知が終わり
   * `pendingCatalogKeys` の先着適用が済んだ後）に呼ぶことを前提とする。
   */
  private bufferUndecodedDeployLogs(receipts: RpcTransactionReceipt[]): void {
    for (const r of receipts) {
      if (!r.contractAddress) continue;
      if (r.logs.length === 0) continue;
      if (this.contractTracker.getCatalogEntry(r.contractAddress)) continue;
      const address = normalizeAddress(r.contractAddress);
      this.undecodedDeployLogs.set(address, {
        txHash: r.transactionHash,
        logs: r.logs,
      });
      while (this.undecodedDeployLogs.size > this.maxUndecodedDeployLogs) {
        const oldest = this.undecodedDeployLogs.keys().next().value;
        if (oldest === undefined) break;
        this.undecodedDeployLogs.delete(oldest);
      }
    }
  }

  /**
   * `registerContractDeployment` で「未知 → カタログ既知」への昇格が起きた
   * 際に呼ばれる。`address`（正規化済み。`ContractTracker.registerDeployment`
   * が返す `ContractEntity.address`）に対応する生ログが
   * `bufferUndecodedDeployLogs` で保持されていれば再復号し、
   * `TransactionLifecycleTracker.updateContractEvents` で tx の
   * contractEvents を差し替えたうえで onTx へ渡す（Issue #244 原因2対策。
   * 自己修復）。保持していなければ何もしない。onTx 未登録
   * （subscribeTransactions が呼ばれていない）場合でも txTracker の更新自体は
   * 行う（detectContractDeployments の「onContract 未登録でも追跡する」流儀と
   * 同じ）。適用したエントリはバッファから削除する（後始末）。
   */
  private redecodeBufferedDeployLogs(address: string): void {
    const buffered = this.undecodedDeployLogs.get(address);
    if (!buffered) return;
    this.undecodedDeployLogs.delete(address);
    const events = this.decodeReceiptLogs(buffered.logs);
    const updatedTx = this.txTracker.updateContractEvents(buffered.txHash, events);
    if (updatedTx) this.onTx?.(updatedTx);
  }

  // --- D 層: ノード内部（Issue #185/#186） ---

  /**
   * D層: 各 Execution（reth）ノードのノード内部メトリクス（Prometheus、
   * Issue #184/#185）を周期ポーリングし、ノード内部状態の更新
   * （`handlers.onInternals`）と駆動リンク上の Engine API 呼び出し活動
   * （`handlers.onLinkActivity`）を購読する。`subscribePeers` と同型の
   * 独立した setTimeout ループとして実装する（毎 tick で Docker 観測を
   * 取り直すため、addNode/removeNode で execution ノードが増減しても
   * 追従する）。
   */
  async subscribeNodeInternals(handlers: NodeInternalsHandlers): Promise<void> {
    if (this.nodeInternalsLoopRunning) return;
    this.nodeInternalsLoopRunning = true;
    void this.nodeInternalsTick(handlers);
  }

  private async nodeInternalsTick(
    handlers: NodeInternalsHandlers,
  ): Promise<void> {
    if (!this.nodeInternalsLoopRunning) return;
    try {
      await this.pollNodeInternalsOnce(handlers);
    } catch (err) {
      console.error("[ethereum] node internals poll failed:", err);
    }
    if (this.nodeInternalsLoopRunning) {
      this.nodeInternalsTimer = setTimeout(
        () => void this.nodeInternalsTick(handlers),
        this.nodeInternalsPollIntervalMs,
      );
    }
  }

  /**
   * ノード内部メトリクスを 1 巡ポーリングする。対象の execution ノードごとに
   * `pollRethNodeInternals`（Issue #185）を並行に呼び、結果を
   * `handlers.onInternals` / `handlers.onLinkActivity` へ振り分ける。
   *
   * - `internals`（syncStages/mempool）は観測できればそのまま
   *   `onInternals(target.stableId, internals)` へ渡す（target.stableId は
   *   観測対象の execution ノード自身の id）。
   * - `calls`（Engine API 呼び出しの増分）が 1 件以上あれば、対応する
   *   beacon（CL）ノードの stableId を `beaconStableIdForExecution()` で
   *   解決し、`fromNodeId`（駆動する側 = beacon） / `toNodeId`（駆動される
   *   側 = execution 自身）として `onLinkActivity` へ渡す。beacon が解決
   *   できない場合は docs/ARCHITECTURE.md §7.3 の決定どおり配信せず、
   *   その旨をログに残す（黙って捨てない）。
   * - 前回 tick で観測できた stableId のうち今回観測できなくなったものは
   *   `RethMetricsTracker.forgetNode()` で前回値を破棄する（ノード削除の
   *   後始末。Issue #185 の申し送り）。`syncStatusCache` も同様に後始末する
   *   （Issue #187）。
   * - `internals` が観測できた場合、`syncStatusCache`（Issue #187。
   *   `NodeEntity.syncStatus`/`blockHeight` の情報源）も同時に更新する。
   *   読み出しは pollInfra（A層）が別途行う。
   *
   * Issue #274: 同じ tick で、対象の beacon（CL）ノードごとに
   * `pollOneBeaconSync` を並行に呼び、Beacon API の自己申告同期状態から
   * `beaconSyncStatusCache` を更新する（EL 用の対象集合・追跡集合とは
   * 独立。取得失敗はそのノードだけ落として前回値を保持する）。
   */
  private async pollNodeInternalsOnce(
    handlers: NodeInternalsHandlers,
  ): Promise<void> {
    const observations = await this.poller.pollOnce();
    const targets = executionMetricsTargets(observations);
    const obsByStableId = new Map(observations.map((o) => [o.stableId, o]));

    const currentIds = new Set(targets.map((t) => t.stableId));
    for (const id of this.trackedNodeInternalsIds) {
      if (!currentIds.has(id)) {
        this.rethMetricsTracker.forgetNode(id);
        // Issue #187: syncStatus 判定の基準（他ノードの最大 checkpoint との
        // 比較）に、削除済みノードの古い値が亡霊のように残らないようにする。
        this.syncStatusCache.forgetNode(id);
      }
    }
    this.trackedNodeInternalsIds = currentIds;

    // Issue #274: CL（beacon）側の同期観測も同じ D層ループに相乗りさせる
    // （EL 側と同じ「書き込みは D層ループ、読み出しは toEntity」構造。
    // beaconTargets は既存のピアポーリングでも使っている選別関数で、
    // validator は対象に含まれない）。
    const beaconSyncTargets = beaconTargets(observations);
    const currentBeaconSyncIds = new Set(
      beaconSyncTargets.map((t) => t.stableId),
    );
    for (const id of this.trackedBeaconSyncIds) {
      if (!currentBeaconSyncIds.has(id)) {
        this.beaconSyncStatusCache.forgetNode(id);
      }
    }
    this.trackedBeaconSyncIds = currentBeaconSyncIds;

    await Promise.all([
      ...targets.map((target) =>
        this.pollOneNodeInternals(target, observations, obsByStableId, handlers),
      ),
      ...beaconSyncTargets.map((target) => this.pollOneBeaconSync(target)),
    ]);
  }

  /** 1 execution ノード分のノード内部メトリクス観測を処理する。 */
  private async pollOneNodeInternals(
    target: ExecutionMetricsTarget,
    observations: ContainerObservation[],
    obsByStableId: Map<string, ContainerObservation>,
    handlers: NodeInternalsHandlers,
  ): Promise<void> {
    const result = await pollRethNodeInternals(
      this.rethMetricsClient,
      target,
      this.rethMetricsTracker,
    );
    // 取得・パース失敗（pollRethNodeInternals が既に stableId と実際の
    // エラー内容をログ済み）はここでは何もしない。
    if (!result) return;

    if (result.internals) {
      // Issue #187: syncStatus/blockHeight のキャッシュ更新は、world-state
      // への配信（handlers.onInternals）とは独立した副経路（読み出しは
      // pollInfra の toEntity から行う。store への書き込みは既存の applyInfra
      // 経路 1 本のまま）。
      this.syncStatusCache.update(target.stableId, result.internals);
      handlers.onInternals(target.stableId, result.internals);
    }

    if (result.calls.length === 0) return;
    const executionObs = obsByStableId.get(target.stableId);
    const fromNodeId = executionObs
      ? beaconStableIdForExecution(executionObs, observations)
      : undefined;
    if (fromNodeId === undefined) {
      console.error(
        `[ethereum] cannot resolve the driving beacon node for ${target.stableId}; ` +
          `dropping ${result.calls.length} internal call stat(s)`,
      );
      return;
    }
    handlers.onLinkActivity({
      fromNodeId,
      toNodeId: target.stableId,
      calls: result.calls,
      observedAt: this.now(),
    });
  }

  /**
   * 1 beacon（CL）ノード分の同期状態観測を処理する（Issue #274）。Beacon API
   * の `/eth/v1/node/syncing` を取得し、`resolveBeaconSyncStatus` で
   * `NodeEntity.syncStatus`/`blockHeight` へ変換して `beaconSyncStatusCache`
   * を更新する。取得・パース失敗はそのノードだけ落として stableId と実際の
   * エラー内容をログし、キャッシュは前回値を保持する（次周期で回復する
   * 一時的な縮退。`pollOneNodeInternals` と同じ方針。ピアループ（B層）とは
   * 独立しているため、同期観測の失敗がピア情報の取得を巻き込まない）。
   */
  private async pollOneBeaconSync(target: BeaconTarget): Promise<void> {
    let snapshot;
    try {
      snapshot = await fetchBeaconSyncing(this.http, target.baseUrl);
    } catch (err) {
      console.error(
        `[ethereum] beacon syncing poll failed for ${target.stableId}:`,
        err,
      );
      return;
    }
    this.beaconSyncStatusCache.set(
      target.stableId,
      resolveBeaconSyncStatus(snapshot),
    );
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

  /**
   * ピアポーリング・ブロック購読・tx 購読・ノード内部メトリクスポーリングを
   * 停止する（テスト・シャットダウン用）。
   */
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
    this.nodeInternalsLoopRunning = false;
    if (this.nodeInternalsTimer) {
      clearTimeout(this.nodeInternalsTimer);
      this.nodeInternalsTimer = undefined;
    }
  }
}
