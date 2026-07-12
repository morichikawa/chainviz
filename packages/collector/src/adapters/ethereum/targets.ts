// Docker の観測値から「どのコンテナに」「どの手段で」到達してピア情報や
// ブロック受信タイミングを集めるかを決める。ポート番号・クライアント種別・
// consensus/execution の区別といった Ethereum 固有の知識はこのファイル
// （ChainAdapter 実装の内側）に閉じ込める。

import type { ContainerObservation } from "../../docker/types.js";
import { BEACON_API_PORT } from "./beacon-api.js";
import { classifyContainer } from "./classify.js";
import { ROLE_LABEL } from "./labels.js";
import { EXECUTION_METRICS_PORT } from "./reth-metrics-client.js";

const COMPOSE_SERVICE_LABEL = "com.docker.compose.service";

/** reth の WebSocket JSON-RPC のデフォルトポート（eth_subscribe 用）。 */
export const EXECUTION_WS_PORT = 8546;

/**
 * reth の HTTP JSON-RPC のデフォルトポート。ウォレット残高・nonce の単発
 * 問い合わせ（eth_getBalance / eth_getTransactionCount）や、
 * newPendingTransactions で得た tx ハッシュの詳細（from/to）・ブロックに
 * 含まれる tx 一覧（eth_getTransactionByHash / eth_getBlockByHash）を追加取得
 * するために使う。
 */
export const EXECUTION_RPC_PORT = 8545;

/** Consensus Layer（ビーコン）クライアントとして扱う識別子。 */
const CONSENSUS_CLIENTS = ["lighthouse", "prysm", "teku", "nimbus"];

/** Execution Layer クライアントとして扱う識別子。 */
const EXECUTION_CLIENTS = ["reth", "geth", "besu", "nethermind", "erigon"];

/** ピア接続をポーリングするビーコンノードの到達先。 */
export interface BeaconTarget {
  /** ノードの安定識別子（NodeEntity.id と一致）。 */
  stableId: string;
  /** Beacon API のベース URL。 */
  baseUrl: string;
  /** グルーピング用のネットワーク識別子。 */
  networkId: string;
}

/**
 * EL 間ピア接続（devp2p）をポーリングする Execution ノードの到達先。
 * admin_nodeInfo / admin_peers を HTTP JSON-RPC で叩く（Issue #106）。
 * エッジの端点は Execution コンテナ自身の stableId とする（EL 間の接続は
 * reth プロセス同士のものなので、キャンバス上も reth カード間に描くのが
 * 実態に即する。CL エッジの端点は beacon の stableId なので端点は重ならない）。
 */
export interface ExecutionPeerTarget {
  /** ノードの安定識別子（NodeEntity.id と一致。PeerEdge の端点になる）。 */
  stableId: string;
  /** admin_nodeInfo / admin_peers を叩く HTTP JSON-RPC URL。 */
  rpcUrl: string;
  /** グルーピング用のネットワーク識別子（`<project>-execution`）。 */
  networkId: string;
}

/**
 * D層: ノード内部メトリクス（Prometheus、Issue #184/#185）をポーリングする
 * Execution ノードの到達先。
 */
export interface ExecutionMetricsTarget {
  /** ノードの安定識別子（NodeEntity.id と一致）。 */
  stableId: string;
  /** `/metrics` の URL。 */
  metricsUrl: string;
}

/** ブロック受信時刻を購読する Execution ノードの到達先。 */
export interface ExecutionTarget {
  /** ノードの安定識別子（NodeEntity.id と一致）。 */
  stableId: string;
  /** eth_subscribe を張る WebSocket URL。 */
  wsUrl: string;
  /**
   * eth_getTransactionByHash / eth_getBlockByHash を叩く HTTP JSON-RPC URL。
   * newPendingTransactions で得た tx の詳細や、ブロックに含まれる tx 一覧を
   * 追加取得するために使う（C 層の tx ライフサイクル追跡用）。
   */
  rpcUrl: string;
  /**
   * BlockEntity.receivedAt に記録する際のキー群。同じ `newHeads` 受信 1 回を
   * 複数キー・同一時刻で記録することで、CL エッジ・EL エッジの両方に
   * ブロック伝播パルスが乗るようにする（Issue #141）。
   *
   * - 対応する beacon（consensus）コンテナが見つかる場合:
   *   `[beacon の stableId, Execution ノード自身の stableId]`。
   *   beacon キーは CL エッジ（PeerEdge の端点が beacon の stableId）用、
   *   自身のキーは EL エッジ（PeerEdge の端点が Execution 自身の stableId、
   *   Issue #106）用。beacon キーの時刻は「同じ論理ノードの Execution が
   *   受信した時刻」のエイリアスであり、CL の実受信時刻ではない。
   * - 対応する beacon が見つからない場合: `[Execution ノード自身の stableId]`
   *   のみ。
   *
   * beacon コンテナと Execution コンテナは stableId が構成上一致しないため、
   * 2 要素になっても重複排除は不要。
   */
  receivedAtKeys: string[];
}

/** ノード群キーの導出時に取り除く役割プレフィックス。 */
const ROLE_PREFIXES = [
  ...EXECUTION_CLIENTS,
  ...CONSENSUS_CLIENTS,
  "beacon",
  "validator",
];

/** 安定識別子（project/service 形式）からプロジェクト部を取り出す。 */
function projectOf(stableId: string): string {
  return stableId.includes("/") ? stableId.split("/")[0] : stableId;
}

/**
 * 安定識別子から CL 側（libp2p）P2P ネットワークの ID を導く。
 * EL 側（devp2p）とは物理的に別の P2P ネットワークなので、networkId も
 * `-consensus` / `-execution` で分ける（フロントはこの ID 単位で色分け・
 * グルーピングする。Issue #106）。
 */
function consensusNetworkId(stableId: string): string {
  return `${projectOf(stableId)}-consensus`;
}

/** 安定識別子から EL 側（devp2p）P2P ネットワークの ID を導く。 */
function executionNetworkId(stableId: string): string {
  return `${projectOf(stableId)}-execution`;
}

/** compose サービス名に "beacon" を含むか（validator を除外するため）。 */
function isBeaconService(obs: ContainerObservation): boolean {
  const service = obs.labels[COMPOSE_SERVICE_LABEL] ?? "";
  return /beacon/i.test(service);
}

/**
 * コンテナが VC（validator client）かどうかを、`com.chainviz.role`
 * ラベル（`ROLE_LABEL`）の値が厳密に `"validator"` と一致するかで判定する
 * （Issue #246。旧実装は compose サービス名への `/validator/i` 部分一致
 * だった＝Issue #214）。
 *
 * lighthouse の validator client（VC）は libp2p の P2P ネットワークに参加
 * しない（beacon へ HTTP の Beacon API で接続するだけ）ため、`toEntity` の
 * `p2pRole` 導出で「P2P 非参加」（`"none"`）を判定するのに使う。
 *
 * `ROLE_LABEL` は静的コンテナ（compose テンプレート、
 * `profiles/ethereum/docker-compose.yml` の validator1/validator2 に
 * `com.chainviz.role: "validator"` を明示的に設定済み）・動的コンテナ
 * （addNode/addWorkbench 時に `node-lifecycle.ts` が付与）の両方に必ず付く
 * ため、compose サービス名の命名規則に依存しない。名前だけ "validator" を
 * 含む（例: 将来の別チェーンプロファイルの `tx-validator` のような）P2P
 * 参加ノードを、compose 側が明示した役割と無関係に誤って VC と判定する
 * ことがない（Issue #246 で指摘された、旧実装の頑健性の課題を解消）。
 *
 * ラベルが無い・想定外の値の場合は false（他のラベル判定
 * `MANAGED_LABEL`・`P2P_ROLE_LABEL` と同じ「省略・想定外 = 安全側」の流儀）。
 * `ROLE_LABEL` の値は collector が生成するものではなく compose /
 * `node-lifecycle.ts` が付与する固定値のみを想定するため、大文字小文字の
 * ゆらぎは正規化しない（`nodeRole` への生値転記、Issue #215 と同じ方針）。
 */
export function isValidatorService(obs: ContainerObservation): boolean {
  return obs.labels[ROLE_LABEL] === "validator";
}

/**
 * ピア接続の取得対象になるビーコンノードを観測値から抽出する。
 * consensus クライアントであり、かつ compose サービス名が "beacon" を含む
 * （同じ lighthouse でも validator コンテナは Beacon API を持たないため除外）
 * コンテナだけを対象にする。IP が取れないものも除外する。
 */
export function beaconTargets(
  observations: ContainerObservation[],
): BeaconTarget[] {
  const targets: BeaconTarget[] = [];
  for (const obs of observations) {
    if (!obs.ip) continue;
    if (!isBeaconService(obs)) continue;
    const { kind, clientType } = classifyContainer(obs);
    if (kind !== "node") continue;
    if (!CONSENSUS_CLIENTS.includes(clientType)) continue;
    targets.push({
      stableId: obs.stableId,
      baseUrl: `http://${obs.ip}:${BEACON_API_PORT}`,
      networkId: consensusNetworkId(obs.stableId),
    });
  }
  return targets;
}

/**
 * compose サービス名から役割プレフィックス（reth/beacon/validator など）を
 * 取り除いた残り（例: "reth1" -> "1"、"beacon1" -> "1"）を返す。同じ論理
 * ノードを構成する execution/consensus コンテナはこの残りが一致する。
 * どの役割プレフィックスにも当てはまらない場合は undefined を返す。
 */
function serviceNodeKey(service: string): string | undefined {
  const lower = service.toLowerCase();
  let matched = "";
  for (const prefix of ROLE_PREFIXES) {
    if (lower.startsWith(prefix) && prefix.length > matched.length) {
      matched = prefix;
    }
  }
  if (!matched) return undefined;
  return lower.slice(matched.length);
}

/**
 * `source` と同じ論理ノードを構成する「相方」コンテナの stableId を導く
 * 共通ロジック。compose サービス名から役割プレフィックスを剥がしたノード群
 * キー（"reth1" と "beacon1" はどちらも "1"）が一致し、かつ同じ docker
 * compose プロジェクト（`projectOf()`）に属し、かつ `isCandidate` が true を
 * 返すコンテナを探す。対応が取れなければ undefined（呼び出し側で
 * フォールバックする）。プロジェクトでスコープするのは、1 つの collector
 * インスタンスが複数の compose プロジェクトを同時に観測する状況（通常運用
 * では起きないが QA 検証等で発生しうる）で、ノード群キーだけが一致する別
 * プロジェクトのコンテナを誤って対応付けないようにするため（Issue #153）。
 * `beaconStableIdForExecution`（execution→beacon）と
 * `executionStableIdForBeacon`（beacon→execution、Issue #186）は探す相手側
 * の役割だけが異なるので、このヘルパーへ共通化する（構造重複の解消。
 * docs/worklog/issue-185.md の軽微な申し送り参照）。
 */
function findPairedStableId(
  source: ContainerObservation,
  observations: ContainerObservation[],
  isCandidate: (obs: ContainerObservation) => boolean,
): string | undefined {
  const sourceService = source.labels[COMPOSE_SERVICE_LABEL] ?? "";
  const key = serviceNodeKey(sourceService);
  if (key === undefined) return undefined;
  const project = projectOf(source.stableId);
  for (const obs of observations) {
    if (!isCandidate(obs)) continue;
    if (projectOf(obs.stableId) !== project) continue;
    const service = obs.labels[COMPOSE_SERVICE_LABEL] ?? "";
    if (serviceNodeKey(service) === key) return obs.stableId;
  }
  return undefined;
}

/**
 * コンテナが Execution（EL）ノードか（node 種別かつ EXECUTION_CLIENTS に
 * 属するクライアント種別か）。
 */
function isExecutionNode(obs: ContainerObservation): boolean {
  const { kind, clientType } = classifyContainer(obs);
  return kind === "node" && EXECUTION_CLIENTS.includes(clientType);
}

/**
 * コンテナが Consensus（CL）の beacon ノードか（compose サービス名が
 * "beacon" を含み、かつ node 種別かつ CONSENSUS_CLIENTS に属するクライアント
 * 種別か）。同じ lighthouse イメージでも validator コンテナは除外する
 * （beaconTargets と同じ選別基準）。
 */
function isConsensusBeaconNode(obs: ContainerObservation): boolean {
  if (!isBeaconService(obs)) return false;
  const { kind, clientType } = classifyContainer(obs);
  return kind === "node" && CONSENSUS_CLIENTS.includes(clientType);
}

/**
 * Execution コンテナと同じ論理ノードを構成する beacon コンテナの stableId を
 * 導く。reth/beacon の対応付けは Ethereum 固有の知識なのでこのアダプタ内に
 * 閉じ込める。
 */
export function beaconStableIdForExecution(
  execution: ContainerObservation,
  observations: ContainerObservation[],
): string | undefined {
  return findPairedStableId(execution, observations, isBeaconService);
}

/**
 * beacon（CL）コンテナが内部 API（Engine API）で駆動する Execution（EL）
 * コンテナの stableId を導く。`NodeEntity.drivesNodeId` の解決に使う
 * （D層、Issue #186）。`beacon` がそもそも beacon 役のコンテナでなければ
 * （validator・execution・workbench 等）呼び出し元の判定に関わらず即
 * undefined を返す（`pollInfra` が全 NodeEntity に対して機械的に呼べる
 * ようにするための自己防衛。「beacon かどうかの判定」を呼び出し側と
 * 二重管理にしない）。
 */
export function executionStableIdForBeacon(
  beacon: ContainerObservation,
  observations: ContainerObservation[],
): string | undefined {
  if (!isConsensusBeaconNode(beacon)) return undefined;
  return findPairedStableId(beacon, observations, isExecutionNode);
}

/**
 * validator（VC）コンテナが Beacon API で接続する beacon（CL）コンテナの
 * stableId を導く。`NodeEntity.drivesNodeId` の解決に使う（D層、
 * Issue #285）。VC の実接続先（`--beacon-nodes`）を実測観測する経路は
 * 現状存在しない（lighthouse VC の HTTP API・メトリクスはノード環境
 * テンプレートで無効のまま、Beacon API 側にも接続元 VC を列挙する
 * エンドポイントが無い、Docker 観測はコンテナの環境変数を収集しない）ため、
 * `executionStableIdForBeacon`（beacon→execution）と同じ「compose サービス名
 * のノード群キーによる静的解決」にそろえる。`validator` がそもそも
 * validator 役のコンテナでなければ（beacon・execution・workbench 等）
 * 呼び出し元の判定に関わらず即 undefined を返す（`pollInfra` が全
 * NodeEntity に対して機械的に呼べるようにするための自己防衛。
 * `executionStableIdForBeacon` と同型）。
 */
export function beaconStableIdForValidator(
  validator: ContainerObservation,
  observations: ContainerObservation[],
): string | undefined {
  if (!isValidatorService(validator)) return undefined;
  return findPairedStableId(validator, observations, isConsensusBeaconNode);
}

/**
 * EL 間ピア接続の取得対象になる Execution ノードを観測値から抽出する。
 * execution クライアントであり IP が取れるコンテナだけを対象にする
 * （executionTargets と同じ選別基準。あちらはブロック購読用の WS URL と
 * receivedAtKeys を持つのに対し、こちらはピア取得用の HTTP RPC URL と
 * networkId を持つ）。
 */
export function executionPeerTargets(
  observations: ContainerObservation[],
): ExecutionPeerTarget[] {
  const targets: ExecutionPeerTarget[] = [];
  for (const obs of observations) {
    if (!obs.ip) continue;
    const { kind, clientType } = classifyContainer(obs);
    if (kind !== "node") continue;
    if (!EXECUTION_CLIENTS.includes(clientType)) continue;
    targets.push({
      stableId: obs.stableId,
      rpcUrl: `http://${obs.ip}:${EXECUTION_RPC_PORT}`,
      networkId: executionNetworkId(obs.stableId),
    });
  }
  return targets;
}

/**
 * ウォレットの残高・nonce を問い合わせるための Execution ノードの HTTP JSON-RPC
 * URL を観測値から列挙する。残高・nonce はチェーン全体の状態でありどの
 * Execution ノードに聞いても同じなので、呼び出し側は先頭から順に到達できた
 * ものを 1 つ使えばよい。execution クライアントであり IP が取れるコンテナだけを
 * 対象にする。
 */
export function executionRpcUrls(
  observations: ContainerObservation[],
): string[] {
  const urls: string[] = [];
  for (const obs of observations) {
    if (!obs.ip) continue;
    const { kind, clientType } = classifyContainer(obs);
    if (kind !== "node") continue;
    if (!EXECUTION_CLIENTS.includes(clientType)) continue;
    urls.push(`http://${obs.ip}:${EXECUTION_RPC_PORT}`);
  }
  return urls;
}

/**
 * D層のノード内部メトリクス（Prometheus）のポーリング対象になる Execution
 * ノードを観測値から抽出する。executionRpcUrls / executionPeerTargets と
 * 同じ選別基準（execution クライアントであり IP が取れるコンテナだけ）。
 */
export function executionMetricsTargets(
  observations: ContainerObservation[],
): ExecutionMetricsTarget[] {
  const targets: ExecutionMetricsTarget[] = [];
  for (const obs of observations) {
    if (!obs.ip) continue;
    const { kind, clientType } = classifyContainer(obs);
    if (kind !== "node") continue;
    if (!EXECUTION_CLIENTS.includes(clientType)) continue;
    targets.push({
      stableId: obs.stableId,
      metricsUrl: `http://${obs.ip}:${EXECUTION_METRICS_PORT}/metrics`,
    });
  }
  return targets;
}

/**
 * ブロック受信時刻の購読対象になる Execution ノードを観測値から抽出する。
 * execution クライアントであり IP が取れるコンテナだけを対象にする。
 * receivedAtKeys には、同じ論理ノードの beacon の stableId が見つかれば
 * `[beacon の stableId, 自身の stableId]`、見つからなければ
 * `[自身の stableId]` を割り当てる（Issue #141。CL/EL 両エッジへ
 * ブロック伝播パルスを乗せるため）。
 */
export function executionTargets(
  observations: ContainerObservation[],
): ExecutionTarget[] {
  const targets: ExecutionTarget[] = [];
  for (const obs of observations) {
    if (!obs.ip) continue;
    const { kind, clientType } = classifyContainer(obs);
    if (kind !== "node") continue;
    if (!EXECUTION_CLIENTS.includes(clientType)) continue;
    const beaconStableId = beaconStableIdForExecution(obs, observations);
    targets.push({
      stableId: obs.stableId,
      wsUrl: `ws://${obs.ip}:${EXECUTION_WS_PORT}`,
      rpcUrl: `http://${obs.ip}:${EXECUTION_RPC_PORT}`,
      receivedAtKeys:
        beaconStableId !== undefined
          ? [beaconStableId, obs.stableId]
          : [obs.stableId],
    });
  }
  return targets;
}
