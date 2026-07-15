import type { NodeEntity, TransactionEntity } from "@chainviz/shared";

/**
 * mempool パネル（Issue #330。`docs/ARCHITECTURE.md` §11、
 * `docs/worklog/issue-330.md` 参照）の純粋なデータ変換群。ワールドステートの
 * 既存の2つの観測（`TransactionEntity` の pending 集合、
 * `NodeEntity.internals.mempool`）を1パネル分の行データへ変換するだけで、
 * 新規の観測・スキーマは増やさない（§11.1）。
 */

/** mempool パネル上段（tx 一覧）の行1件分。 */
export interface MempoolTxEntry {
  hash: string;
  from: string;
  /** コントラクト作成 tx（デプロイ）は null。 */
  to: string | null;
  /** `contractCall` から復号できた関数名（無ければ未定義）。 */
  functionName?: string;
  /**
   * from が現在キャンバス上のウォレットカードとして存在するか
   * （`walletNode.ts` の id = address）。false の行はパン先が無いため
   * `MempoolPanel` 側でクリック不可として描画する。
   */
  fromIsWallet: boolean;
}

/**
 * `TransactionEntity` のうち `status === "pending"` のものだけを抽出し、
 * パネル行データへ変換する（§11.1 上段 = C層）。並び順はここでは決めない
 * （呼び出し側が `sortMempoolTxEntriesByAppearance` で並べ替える）。
 */
export function buildMempoolTxEntries(
  transactions: TransactionEntity[],
  walletIds: ReadonlySet<string>,
): MempoolTxEntry[] {
  return transactions
    .filter((tx) => tx.status === "pending")
    .map((tx) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      functionName: tx.contractCall?.functionName,
      fromIsWallet: walletIds.has(tx.from),
    }));
}

/**
 * 出現順（新しいものが上）に並べ替える。`contractList.ts` の
 * `sortEntriesByAppearance` と同じ狙いだが、id フィールドが `nodeId` では
 * なく `hash` のため別関数として持つ（1ファイル1責務）。
 */
export function sortMempoolTxEntriesByAppearance(
  entries: MempoolTxEntry[],
  order: ReadonlyMap<string, number>,
): MempoolTxEntry[] {
  return [...entries].sort((a, b) => {
    const orderA = order.get(a.hash) ?? Number.NEGATIVE_INFINITY;
    const orderB = order.get(b.hash) ?? Number.NEGATIVE_INFINITY;
    return orderB - orderA;
  });
}

/**
 * パネルに一度に並べる tx 行の上限（§11.3「表示件数には上限を設け」）。
 * 保持上限 256 件（`PENDING_TX_RETENTION`）をそのまま並べるとパネルが
 * 破綻するため切り出す。8 件はミニパネルの `max-height` に収まる目安として
 * 実装時に選んだ値（決め打ちではなく表示密度の調整値であり、データの
 * 動的な性質には依存しない。CLAUDE.md の「固定値」注意は保持上限256件の
 * ような観測依存の値についてのもので、UIの表示密度パラメータはこれに
 * 該当しない）。
 */
export const MEMPOOL_TX_DISPLAY_LIMIT = 8;

export interface MempoolTxVisibleEntries {
  visible: MempoolTxEntry[];
  /** 上限を超えて省略された件数（0 件なら省略なし）。 */
  overflowCount: number;
}

/** 出現順に並んだ行から先頭 `limit` 件だけを残し、超過分の件数を返す。 */
export function limitMempoolTxEntries(
  entries: MempoolTxEntry[],
  limit: number = MEMPOOL_TX_DISPLAY_LIMIT,
): MempoolTxVisibleEntries {
  if (entries.length <= limit) {
    return { visible: entries, overflowCount: 0 };
  }
  return { visible: entries.slice(0, limit), overflowCount: entries.length - limit };
}

/** mempool パネル下段（ノード別実数）の行1件分。 */
export interface MempoolNodeEntry {
  nodeId: string;
  /** カード見出しと同じ表示名（`containerName`）。 */
  label: string;
  pending: number;
  queued: number;
}

/** `internals.mempool` を持つノードだけを絞り込む型ガード。 */
function hasMempoolInternals(
  node: NodeEntity,
): node is NodeEntity & { internals: { mempool: { pending: number; queued: number } } } {
  return node.internals?.mempool !== undefined;
}

/**
 * `NodeEntity` 群から `internals.mempool` を持つものだけをノード別実数の
 * 行データへ変換する（§11.1 下段 = D層）。`internals.mempool` を持たない
 * ノード（beacon 等）は行に出さない。
 */
export function buildMempoolNodeEntries(nodeEntities: NodeEntity[]): MempoolNodeEntry[] {
  return nodeEntities.filter(hasMempoolInternals).map((node) => ({
    nodeId: node.id,
    label: node.containerName,
    pending: node.internals.mempool.pending,
    queued: node.internals.mempool.queued,
  }));
}
