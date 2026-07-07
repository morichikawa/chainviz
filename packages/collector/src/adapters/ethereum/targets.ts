// Docker の観測値から「どのコンテナに」「どの手段で」到達してピア情報や
// ブロック受信タイミングを集めるかを決める。ポート番号・クライアント種別・
// consensus/execution の区別といった Ethereum 固有の知識はこのファイル
// （ChainAdapter 実装の内側）に閉じ込める。

import type { ContainerObservation } from "../../docker/types.js";
import { BEACON_API_PORT } from "./beacon-api.js";
import { classifyContainer } from "./classify.js";

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
 * Execution コンテナと同じ論理ノードを構成する beacon コンテナの stableId を
 * 導く。compose サービス名から役割プレフィックスを剥がしたノード群キー
 * （"reth1" と "beacon1" はどちらも "1"）が一致し、かつ beacon サービスで
 * あるコンテナを探す。対応が取れなければ undefined（呼び出し側でフォール
 * バックする）。reth/beacon の対応付けは Ethereum 固有の知識なのでこの
 * アダプタ内に閉じ込める。
 */
export function beaconStableIdForExecution(
  execution: ContainerObservation,
  observations: ContainerObservation[],
): string | undefined {
  const execService = execution.labels[COMPOSE_SERVICE_LABEL] ?? "";
  const key = serviceNodeKey(execService);
  if (key === undefined) return undefined;
  for (const obs of observations) {
    if (!isBeaconService(obs)) continue;
    const service = obs.labels[COMPOSE_SERVICE_LABEL] ?? "";
    if (serviceNodeKey(service) === key) return obs.stableId;
  }
  return undefined;
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
