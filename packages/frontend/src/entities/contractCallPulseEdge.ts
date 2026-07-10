import type { Edge } from "@xyflow/react";
import { resolvePresentId } from "./addressCasing.js";
import { OPERATION_PULSE_DURATION_MS } from "./operationEdge.js";

/**
 * tx確定時にウォレット→コントラクトへ一度だけ流す揮発性パルスエッジ
 * （ARCHITECTURE.md §6.6「確定時のコントラクトへのパルス」: `useOperationPulses`
 * と同型の一時エッジ）。対象がワークベンチ→ノードの操作エッジとは意味が
 * 異なる（呼び出し元ウォレット→呼び出し先/デプロイ先コントラクト）ため
 * 別ファイルに分離する。色はコントラクト識別色（--contract-edge）にし、
 * 操作エッジのマゼンタ・所有エッジの琥珀と混同しない。
 */

export const CONTRACT_CALL_PULSE_EDGE_TYPE = "contractCallPulse";

/**
 * パルスがエッジを渡り切る時間（ms）。ARCHITECTURE.md §6.6「表示時間は操作
 * パルスと同程度」の指示に従い、操作パルスと同じ値を使う（値そのものの
 * 意味は operationEdge.ts の docstring参照）。
 */
export const CONTRACT_CALL_PULSE_DURATION_MS = OPERATION_PULSE_DURATION_MS;

/** コントラクト識別色（styles.css の --contract-edge と一致させること）。 */
export const CONTRACT_CALL_EDGE_COLOR = "var(--contract-edge)";

export interface ContractCallPulse extends Record<string, unknown> {
  /** この描画インスタンスを一意に識別するキー。 */
  key: string;
  durationMs: number;
}

export interface ContractCallPulseEdgeData extends Record<string, unknown> {
  /** このエッジ上で現在走らせているパルス（1本以上ある間だけエッジが存在する）。 */
  pulses: ContractCallPulse[];
}

export type ContractCallPulseFlowEdge = Edge<ContractCallPulseEdgeData>;

/** ウォレット → コントラクトのペアから、パルスエッジの安定 ID を作る。 */
export function contractCallPulseEdgeId(
  fromWalletAddress: string,
  contractAddress: string,
): string {
  return `contract-call-${fromWalletAddress}=>${contractAddress}`;
}

/**
 * ウォレット → コントラクトのパルスエッジ（パルスなしの土台）を作る。
 * 端点（ウォレット・コントラクト）の両方がキャンバス上に存在しないと null
 * を返す（宙ぶらりんのエッジを描かない。ダングリング参照ガード）。
 *
 * 端点の一致判定は大文字小文字を無視する。`fromWalletAddress`
 * （`TransactionEntity.from`由来）はチェーン側の生の表記（Ethereumアダプタ
 * では全小文字）になる一方、`presentWalletIds`（`WalletEntity.address`）は
 * mnemonicからviemで導出したEIP-55チェックサム表記になりうる
 * （`wallet-derivation.ts`参照）。単純な文字列一致では常に不一致となり、
 * 実際にはウォレットが存在するのにパルスエッジが一切描画されない不具合を
 * 実機で確認したため（Issue #232。deployEdge.tsのIssue #201修正と同型）、
 * `resolvePresentId`で大文字小文字を無視して照合したうえで、実際に
 * キャンバス上に存在する側（present側）の表記をエッジの端点として使う
 * （表記がずれたままだとReact Flowがノードを解決できずエッジを描画
 * できないため）。
 */
export function buildContractCallPulseEdge(
  fromWalletAddress: string,
  contractAddress: string,
  presentWalletIds: ReadonlySet<string>,
  presentContractIds: ReadonlySet<string>,
): ContractCallPulseFlowEdge | null {
  const resolvedWalletId = resolvePresentId(fromWalletAddress, presentWalletIds);
  if (!resolvedWalletId) return null;
  const resolvedContractId = resolvePresentId(contractAddress, presentContractIds);
  if (!resolvedContractId) return null;
  if (resolvedWalletId.toLowerCase() === resolvedContractId.toLowerCase()) return null;

  return {
    id: contractCallPulseEdgeId(resolvedWalletId, resolvedContractId),
    type: CONTRACT_CALL_PULSE_EDGE_TYPE,
    source: resolvedWalletId,
    target: resolvedContractId,
    data: { pulses: [] },
    className: "contract-call-pulse-edge",
    style: { stroke: CONTRACT_CALL_EDGE_COLOR, strokeWidth: 1.6 },
  };
}

/**
 * パルスエッジ配列に1つのパルスを追加した新しい配列を返す（純粋関数。
 * operationEdge.ts の addOperationPulse と同じ狙い）。
 */
export function addContractCallPulse(
  edges: ContractCallPulseFlowEdge[],
  base: ContractCallPulseFlowEdge,
  pulse: ContractCallPulse,
): ContractCallPulseFlowEdge[] {
  const existing = edges.find((e) => e.id === base.id);
  if (existing) {
    const pulses = [...(existing.data?.pulses ?? []), pulse];
    return edges.map((e) => (e.id === base.id ? { ...e, data: { pulses } } : e));
  }
  return [...edges, { ...base, data: { pulses: [pulse] } }];
}

/**
 * パルスエッジ配列から1つのパルスを取り除いた新しい配列を返す（純粋関数）。
 * そのエッジのパルスが0本になったらエッジ自体を配列から落とす。
 */
export function removeContractCallPulse(
  edges: ContractCallPulseFlowEdge[],
  edgeId: string,
  pulseKey: string,
): ContractCallPulseFlowEdge[] {
  const result: ContractCallPulseFlowEdge[] = [];
  for (const edge of edges) {
    if (edge.id !== edgeId) {
      result.push(edge);
      continue;
    }
    const pulses = (edge.data?.pulses ?? []).filter((p) => p.key !== pulseKey);
    if (pulses.length === 0) continue;
    result.push({ ...edge, data: { pulses } });
  }
  return result;
}
