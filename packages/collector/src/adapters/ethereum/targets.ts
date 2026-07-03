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

/** ブロック受信時刻を購読する Execution ノードの到達先。 */
export interface ExecutionTarget {
  /** ノードの安定識別子（NodeEntity.id と一致）。 */
  stableId: string;
  /** eth_subscribe を張る WebSocket URL。 */
  wsUrl: string;
}

/** 安定識別子（project/service 形式）から所属ネットワーク ID を導く。 */
function consensusNetworkId(stableId: string): string {
  const project = stableId.includes("/") ? stableId.split("/")[0] : stableId;
  return `${project}-consensus`;
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
 * ブロック受信時刻の購読対象になる Execution ノードを観測値から抽出する。
 * execution クライアントであり IP が取れるコンテナだけを対象にする。
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
    targets.push({
      stableId: obs.stableId,
      wsUrl: `ws://${obs.ip}:${EXECUTION_WS_PORT}`,
    });
  }
  return targets;
}
