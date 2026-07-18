/**
 * 通信ログ（Issue #317。docs/worklog/issue-317.md 設計メモ）のエントリ型。
 *
 * キャンバス上のパルス・波・リボンは「今」を見せることに最適化されており、
 * 一瞬で消える出来事を後から遡る手段が無かった。この型は既存の DiffEvent
 * （operationObserved / nodeLinkActivity / entityAdded / entityUpdated /
 * edgeAdded / edgeRemoved）から導出する、時系列に蓄積するログ1行分を表す。
 * ワールドステートのスキーマではなくフロント内部の表示用データのため
 * `packages/shared` には置かない（`SidePanelView` と同じ判断）。
 *
 * カテゴリ（`category`）で判別する共用体。各カテゴリの由来・観測できない
 * ことの正直な扱いは設計メモ §3 を参照。
 */

/** ログの6カテゴリ。フィルタチップの並び順もこの順を基準にする。 */
export type CommsLogCategory =
  | "operation"
  | "internal"
  | "block"
  | "tx"
  | "peer"
  | "environment";

interface CommsLogEntryBase {
  /** React key・ログ内での一意性に使う id（重複排除等の意味的な同一性には使わない）。 */
  id: string;
  category: CommsLogCategory;
  /** イベント自身が持つ時刻（observedAt/receivedAt）を優先し、無ければ受信時刻。epoch ms。 */
  timestamp: number;
  /**
   * ノードフィルタ（§5.4）が判定に使う、このエントリに関わる node/workbench
   * のエンティティ id 一覧。該当する actor を持たないエントリ（tx・
   * collector接続イベント）は空配列にし、ノード指定フィルタでは常に対象外
   * になる（「すべて」でのみ表示される）。
   */
  actorIds: string[];
}

/** 操作（RPC）: ワークベンチ → ノードの呼び出し観測（operationObserved）。 */
export interface CommsLogOperationEntry extends CommsLogEntryBase {
  category: "operation";
  workbenchId: string;
  workbenchLabel: string;
  nodeId: string;
  nodeLabel: string;
  /** JSON-RPC メソッド名等、プロトコル依存の生の文字列。 */
  method: string;
  /**
   * 呼び出しの成否（レスポンス観測。Issue #352）。`OperationEdge.outcome` を
   * そのまま写す。省略 = ロギングプロキシが判定できなかった（バッチ応答の
   * 対応欠落・非JSONボディ等）。`durationMs` とは独立に欠落しうる。
   */
  outcome?: "ok" | "error";
  /** 呼び出しの所要時間（ms）。`OperationEdge.durationMs` をそのまま写す。省略 = 観測できなかった。 */
  durationMs?: number;
}

/** 内部API呼び出し1種類ぶん（D層。InternalCallStats のフロント表現）。 */
export interface CommsLogInternalCall {
  method: string;
  count: number;
  latencyMs?: number;
}

/** 内部API: 駆動リンク上の呼び出し観測（nodeLinkActivity）。 */
export interface CommsLogInternalEntry extends CommsLogEntryBase {
  category: "internal";
  fromNodeId: string;
  fromLabel: string;
  toNodeId: string;
  toLabel: string;
  calls: CommsLogInternalCall[];
}

/** ブロック: 1ノードの受信1件（BlockEntity.receivedAt の増分。EL/CL重複は畳み済み）。 */
export interface CommsLogBlockEntry extends CommsLogEntryBase {
  category: "block";
  nodeId: string;
  nodeLabel: string;
  blockNumber: number;
  /** 波の起点（最速受信）からの相対遅延（ms、0以上）。 */
  relativeDelayMs: number;
  /** このエントリが波の起点（最初の受信）かどうか。 */
  isOrigin: boolean;
}

/** tx: mempool投入・ブロック取り込み・失敗の状態遷移。 */
export interface CommsLogTxEntry extends CommsLogEntryBase {
  category: "tx";
  hash: string;
  status: "pending" | "included" | "failed";
  /** included/failed のとき、解決できれば取り込み先ブロック番号。 */
  blockNumber?: number;
}

/** P2P接続: PeerEdge の確立・切断。送受方向は断定しない（設計メモ §3）。 */
export interface CommsLogPeerEntry extends CommsLogEntryBase {
  category: "peer";
  fromNodeId: string;
  fromLabel: string;
  toNodeId: string;
  toLabel: string;
  networkId: string;
  change: "connected" | "disconnected";
}

/** 環境: node/workbench/contract の追加・削除、collector との接続状態変化。 */
export type CommsLogEnvironmentChange =
  | "nodeAdded"
  | "nodeRemoved"
  | "workbenchAdded"
  | "workbenchRemoved"
  | "contractDeployed"
  | "contractRemoved"
  | "collectorDisconnected"
  | "collectorReconnected";

export interface CommsLogEnvironmentEntry extends CommsLogEntryBase {
  category: "environment";
  /** 対象の entity id（node/workbench/contract）。collector接続イベントには無い。 */
  subjectId?: string;
  /**
   * 表示名。コントラクトはカタログ外だと undefined になりうる
   * （表示側が `t("contract.unknown")` にフォールバックする。ContractSourceView
   * と同じ流儀）。collector接続イベントは表示側が専用の文言を使うため未使用。
   */
  subjectLabel?: string;
  change: CommsLogEnvironmentChange;
}

export type CommsLogEntry =
  | CommsLogOperationEntry
  | CommsLogInternalEntry
  | CommsLogBlockEntry
  | CommsLogTxEntry
  | CommsLogPeerEntry
  | CommsLogEnvironmentEntry;

/** カテゴリチップの既定の並び順（フィルタUI・凡例で共通使用）。 */
export const COMMS_LOG_CATEGORIES: readonly CommsLogCategory[] = [
  "operation",
  "internal",
  "block",
  "tx",
  "peer",
  "environment",
];
