import type { BlockEntity, TransactionEntity } from "@chainviz/shared";
import { latestReceiptTime, waveOriginTime } from "./blockPulse.js";

/**
 * チェーンリボン（Issue #298。ARCHITECTURE.md §9）のタイル列導出・付随データの
 * 純粋関数群。リボンはワールドステートのエンティティではなく、フロントが
 * 既存の `BlockEntity` / `TransactionEntity` から導出する表示物であり、
 * ここではその「エンティティ → 表示用データ」の変換だけを持つ（テスト容易性の
 * ため。React / タイマー側の責務は `useRibbonLanding.ts` に分離する）。
 */

/**
 * リボンに表示するタイル数の既定値（直近8件）。UX 上の初期値
 * （docs/worklog/issue-298.md §4.2）: ブロック産生間隔（slot 1〜2秒）×8件で
 * 10秒強の履歴が残り、「伝播パルスを見逃しても遡れる」体験に足りる最小限、
 * という前提に基づく固定値。この前提（slot間隔が1〜2秒程度のネット構成）が
 * 崩れる場合はこの値を見直すこと。
 */
export const RIBBON_TILE_COUNT = 8;

export interface ChainRibbonTile {
  block: BlockEntity;
  /**
   * 直前（1つ左）のタイルとの間に連結線を描くか。`parentHash` が直前タイルの
   * `hash` と一致する時だけ true（ARCHITECTURE.md §9.3）。先頭タイルは
   * 比較対象が無いため常に false。
   */
  connectedToPrevious: boolean;
}

/**
 * 同一 `number` に複数ハッシュ（フォーク）が観測された場合、1タイルに使う
 * 1件へ絞り込む。選択規則（ARCHITECTURE.md §9.3）: 最新受信時刻
 * （`latestReceiptTime`）が最も遅いもの、同時刻なら hash の辞書順。
 *
 * 今回のスコープは単一連鎖前提の暫定ルールで、#296 がフォーク検知（正史判定）
 * を実装したらそちらの成果物に置き換える想定（このリボンはそれまでの
 * 決定的なフォールバック）。
 */
function pickCanonicalPerNumber(
  blocks: readonly BlockEntity[],
): BlockEntity[] {
  const byNumber = new Map<number, BlockEntity>();
  for (const block of blocks) {
    const current = byNumber.get(block.number);
    if (!current) {
      byNumber.set(block.number, block);
      continue;
    }
    const currentLatest = latestReceiptTime(current) ?? Number.NEGATIVE_INFINITY;
    const nextLatest = latestReceiptTime(block) ?? Number.NEGATIVE_INFINITY;
    const prefersNext =
      nextLatest > currentLatest ||
      (nextLatest === currentLatest && block.hash < current.hash);
    if (prefersNext) byNumber.set(block.number, block);
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

/**
 * `BlockEntity` 群からリボンのタイル列（番号昇順・末尾＝右端が最新）を導出する
 * （ARCHITECTURE.md §9.3）。観測済みブロックのみを使い、欠けている過去の
 * ブロックを埋める追加 RPC はしない。番号が飛んだ区間（観測の取りこぼし）は
 * `connectedToPrevious` が false になり、連結線ではなく切れ目として表現される。
 */
export function deriveRibbonTiles(
  blocks: readonly BlockEntity[],
  tileCount: number = RIBBON_TILE_COUNT,
): ChainRibbonTile[] {
  const canonical = pickCanonicalPerNumber(blocks);
  const shown = canonical.slice(Math.max(0, canonical.length - tileCount));
  return shown.map((block, index) => {
    if (index === 0) return { block, connectedToPrevious: false };
    const previous = shown[index - 1];
    return {
      block,
      connectedToPrevious: block.parentHash === previous.hash,
    };
  });
}

/**
 * ブロックごとの取り込み tx 件数（ARCHITECTURE.md §9.1）。`BlockEntity` に
 * `txCount` を足さず、`TransactionEntity.blockHash` から数えて導出する。
 * status は included / failed の両方を数える（failed もブロックには
 * 取り込まれている。pending は未確定のため対象外）。0 件のブロックは Map に
 * 含めない（呼び出し側は `get` の `undefined` を「バッジ非表示」として扱う。
 * 「省略 = 情報なし」の既存の流儀）。
 */
export function countTransactionsByBlockHash(
  transactions: readonly TransactionEntity[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.status === "pending") continue;
    if (tx.blockHash === undefined) continue;
    counts.set(tx.blockHash, (counts.get(tx.blockHash) ?? 0) + 1);
  }
  return counts;
}

export interface ReceivedOrderEntry {
  nodeId: string;
  /** 表示名（NodeEntity.containerName）。 */
  label: string;
  /** 波の起点（最速受信ノード）からの相対時間（ms、0 以上）。 */
  offsetMs: number;
}

/**
 * ブロックの `receivedAt` を受信順（波の起点 = 0ms 起点の相対時間）に並べる
 * （ARCHITECTURE.md §9.3「受信したノード」）。表示名を解決できない id
 * （`nodeLabelById` に無い。カード削除等で失効した node）は表示側に含めない
 * （省略 = 情報なしの既存の流儀）。
 */
export function deriveReceivedOrder(
  block: BlockEntity,
  nodeLabelById: ReadonlyMap<string, string>,
): ReceivedOrderEntry[] {
  const t0 = waveOriginTime(block);
  if (t0 === null) return [];

  const entries: ReceivedOrderEntry[] = [];
  for (const [nodeId, time] of Object.entries(block.receivedAt)) {
    if (!Number.isFinite(time)) continue;
    const label = nodeLabelById.get(nodeId);
    if (label === undefined) continue;
    entries.push({ nodeId, label, offsetMs: time - t0 });
  }

  entries.sort((a, b) => a.offsetMs - b.offsetMs || a.label.localeCompare(b.label));
  return entries;
}

/**
 * `BlockEntity.timestamp`（Ethereum のブロックヘッダの慣習どおり epoch 秒。
 * collector 側 `blocks.ts` の `parseHexNumber(header.timestamp)` 参照）を
 * ポップオーバー表示用の文字列にする。`toLocaleString` はホストの
 * ロケール/タイムゾーンに依存し表示・テストの両方が不安定になるため、
 * 常に UTC の固定書式（`YYYY-MM-DD HH:MM:SS UTC`）に整形する。
 */
export function formatBlockTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, " UTC");
}
