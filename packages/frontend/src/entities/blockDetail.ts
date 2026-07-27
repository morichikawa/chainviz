import type { BlockEntity, TransactionEntity } from "@chainviz/shared";
import { latestReceiptTime } from "./blockPulse.js";

/**
 * ブロック詳細パネル（Issue #409。ARCHITECTURE.md §17「ブロック詳細パネル
 * （保持窓内を遡る）」）の純粋なデータ変換群。サイドパネルの
 * `kind: "blockDetail"` が表示する対象ブロック・親子ナビゲーション・
 * 取り込み済み tx 一覧を、既存の `BlockEntity` / `TransactionEntity`
 * （チェーンリボン・mempool パネルが既に使っているものと同じ）から導出する
 * だけで、新しい観測・新しい DiffEvent は一切伴わない（`packages/shared`・
 * collector の変更なし。docs/worklog/issue-409.md 参照）。
 */

/**
 * `hash` → `BlockEntity` の索引を作る。呼び出し側（`Canvas.tsx`）はチェーン
 * リボンノード（`type === CHAIN_RIBBON_NODE_TYPE`。チェーン全体で常に1つ）の
 * `data.blocks`（保持窓内の `BlockEntity` 全件）をここへ渡す。
 */
export function buildBlocksByHash(
  blocks: readonly BlockEntity[],
): ReadonlyMap<string, BlockEntity> {
  const map = new Map<string, BlockEntity>();
  for (const block of blocks) map.set(block.hash, block);
  return map;
}

/**
 * 対象ブロックの親ブロックを引く。親が保持窓の外（collector が既に忘れた
 * ブロック）にある場合や、起動直後で観測開始点に達した場合は undefined
 * （新規 RPC による遡及取得はしない。ARCHITECTURE.md §17.1）。
 */
export function findParentBlock(
  block: BlockEntity,
  blocksByHash: ReadonlyMap<string, BlockEntity>,
): BlockEntity | undefined {
  return blocksByHash.get(block.parentHash);
}

/**
 * 対象ブロックの子ブロックを引く。`parentHash === block.hash` の候補が
 * 複数観測されている場合（フォーク）は、チェーンリボン（`chainRibbon.ts` の
 * `pickCanonicalPerNumber`）と同じ tie-break 規則（最新受信時刻が遅い方、
 * 同時刻なら hash 辞書順）で1件に絞る（ARCHITECTURE.md §17.3）。表示の一貫性を
 * チェーンリボンと揃えるための意図的な重複（`chainRibbon.ts` 側の関数は
 * 「同一番号内の正史選択」で走査対象が異なるため、そのまま共有はしない）。
 */
export function findChildBlock(
  block: BlockEntity,
  blocksByHash: ReadonlyMap<string, BlockEntity>,
): BlockEntity | undefined {
  let best: BlockEntity | undefined;
  for (const candidate of blocksByHash.values()) {
    if (candidate.parentHash !== block.hash) continue;
    if (best === undefined) {
      best = candidate;
      continue;
    }
    const bestLatest = latestReceiptTime(best) ?? Number.NEGATIVE_INFINITY;
    const candidateLatest = latestReceiptTime(candidate) ?? Number.NEGATIVE_INFINITY;
    const prefersCandidate =
      candidateLatest > bestLatest ||
      (candidateLatest === bestLatest && candidate.hash < best.hash);
    if (prefersCandidate) best = candidate;
  }
  return best;
}

export interface BlockNavigation {
  parent: BlockEntity | undefined;
  child: BlockEntity | undefined;
  /**
   * 対象ブロックが現在の最新ブロック（チェーンリボンの最新タイルと同じ
   * hash）か。`child` が undefined のとき、「次のブロックが見つからない
   * 理由」を「最新に到達した」か「観測が追い付いていない等」かに出し分ける
   * ために使う（ARCHITECTURE.md §17.3）。
   */
  isLatest: boolean;
}

/** 前後ナビゲーションに必要な情報一式をまとめて導出する。 */
export function resolveBlockNavigation(
  block: BlockEntity,
  blocksByHash: ReadonlyMap<string, BlockEntity>,
  latestBlockHash: string | undefined,
): BlockNavigation {
  return {
    parent: findParentBlock(block, blocksByHash),
    child: findChildBlock(block, blocksByHash),
    isLatest: latestBlockHash !== undefined && block.hash === latestBlockHash,
  };
}

/**
 * 対象ブロックの取り込み済み tx 全件を、同一ブロック内の送信順序が意味を
 * 持つ nonce 昇順で返す（ARCHITECTURE.md §17.4）。絞り込み条件は
 * `chainRibbon.ts` の `countTransactionsByBlockHash` と同じ（pending 除外・
 * included/failed 両方を含む）。nonce を観測できなかった tx（`nonce` が
 * optional。省略されうる理由は `TransactionEntity.nonce` の JSDoc 参照）は
 * 昇順の末尾へ、tx hash の辞書順で決定的にまとめる。
 */
export function selectBlockTransactions(
  hash: string,
  transactions: readonly TransactionEntity[],
): TransactionEntity[] {
  return transactions
    .filter((tx) => tx.blockHash === hash && tx.status !== "pending")
    .sort((a, b) => {
      if (a.nonce !== undefined && b.nonce !== undefined) {
        return a.nonce - b.nonce || a.hash.localeCompare(b.hash);
      }
      if (a.nonce !== undefined) return -1;
      if (b.nonce !== undefined) return 1;
      return a.hash.localeCompare(b.hash);
    });
}

/**
 * パネルに一度に並べる tx 行の上限（ARCHITECTURE.md §17.4「1 ブロックあたりの
 * tx 表示件数に上限は設けない想定だが…安全のため」）。`mempoolList.ts` の
 * `MEMPOOL_TX_DISPLAY_LIMIT` と同じくデータの動的な性質には依存しない表示
 * 密度の調整値。ブロック詳細パネルはミニパネルより表示余地が大きいため、
 * 通常は発火しない安全弁として mempool より大きい値にしている。
 */
export const BLOCK_DETAIL_TX_DISPLAY_LIMIT = 100;

export interface BlockDetailTxVisibleEntries {
  visible: TransactionEntity[];
  /** 上限を超えて省略された件数（0 件なら省略なし）。 */
  overflowCount: number;
}

/**
 * ブロック番号ジャンプ欄（Issue #428。ARCHITECTURE.md §18.3.1）の入力文字列を
 * 検証する。trim 後に `^\d+$`（0以上の整数のみ。符号・小数点・指数表記・
 * 空白混じりは拒否）にマッチしない場合、またはマッチしても
 * `Number.isSafeInteger` を超える場合は undefined を返す。
 */
export function parseBlockNumberInput(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : undefined;
}

/**
 * 保持窓内（`blocksByHash`）から指定番号のブロックを探す。同一番号に複数
 * ブロックが観測されている場合（フォーク）は `findChildBlock` と同じ
 * tie-break（最新受信時刻が遅い方、同時刻なら hash 辞書順）で1件に絞る
 * （意図的な重複実装。ARCHITECTURE.md §18.3.1 参照）。
 */
export function findBlockByNumber(
  number: number,
  blocksByHash: ReadonlyMap<string, BlockEntity>,
): BlockEntity | undefined {
  let best: BlockEntity | undefined;
  for (const candidate of blocksByHash.values()) {
    if (candidate.number !== number) continue;
    if (best === undefined) {
      best = candidate;
      continue;
    }
    const bestLatest = latestReceiptTime(best) ?? Number.NEGATIVE_INFINITY;
    const candidateLatest = latestReceiptTime(candidate) ?? Number.NEGATIVE_INFINITY;
    const prefersCandidate =
      candidateLatest > bestLatest ||
      (candidateLatest === bestLatest && candidate.hash < best.hash);
    if (prefersCandidate) best = candidate;
  }
  return best;
}

export interface BlockNumberRange {
  min: number;
  max: number;
}

/**
 * 現在保持しているブロック番号の範囲（最小値・最大値）を求める。
 * `blocksByHash` が空の場合は undefined（呼び出し側はブロック詳細パネルが
 * 開いている間、対象ブロックが必ず1件は存在する前提で呼ぶため、通常は
 * undefined にならない。ARCHITECTURE.md §18.3.1）。
 */
export function blockNumberRange(
  blocksByHash: ReadonlyMap<string, BlockEntity>,
): BlockNumberRange | undefined {
  let min: number | undefined;
  let max: number | undefined;
  for (const candidate of blocksByHash.values()) {
    if (min === undefined || candidate.number < min) min = candidate.number;
    if (max === undefined || candidate.number > max) max = candidate.number;
  }
  return min === undefined || max === undefined ? undefined : { min, max };
}

export type BlockJumpResult =
  | { kind: "found"; block: BlockEntity }
  | { kind: "invalid" }
  | { kind: "notFound"; range: BlockNumberRange };

/**
 * ブロック番号ジャンプ欄の入力からナビゲーション結果を1回で導出する
 * （`parseBlockNumberInput` → `findBlockByNumber` → `blockNumberRange` を
 * 束ねる。UI 側はこの結果だけを見て表示を出し分ければよい。
 * ARCHITECTURE.md §18.3.1）。
 */
export function resolveBlockJump(
  raw: string,
  blocksByHash: ReadonlyMap<string, BlockEntity>,
): BlockJumpResult {
  const number = parseBlockNumberInput(raw);
  if (number === undefined) return { kind: "invalid" };

  const found = findBlockByNumber(number, blocksByHash);
  if (found !== undefined) return { kind: "found", block: found };

  const range = blockNumberRange(blocksByHash);
  if (range !== undefined) return { kind: "notFound", range };

  // 呼び出し側（BlockJumpForm）はブロック詳細パネルが開いている間、つまり
  // 対象ブロックが blocksByHash に必ず1件以上存在する状況でのみ使うため、
  // ここには到達しない想定（ARCHITECTURE.md §18.3.1「範囲は常に求まる」）。
  // それでも空の blocksByHash が渡された場合に例外を投げず落ち着いた結果を
  // 返せるよう、探索対象の番号そのものを範囲として代用する。
  return { kind: "notFound", range: { min: number, max: number } };
}

/** 並び済みの tx 配列から先頭 `limit` 件だけを残し、超過分の件数を返す。 */
export function limitBlockTransactions(
  transactions: readonly TransactionEntity[],
  limit: number = BLOCK_DETAIL_TX_DISPLAY_LIMIT,
): BlockDetailTxVisibleEntries {
  if (transactions.length <= limit) {
    return { visible: [...transactions], overflowCount: 0 };
  }
  return {
    visible: transactions.slice(0, limit),
    overflowCount: transactions.length - limit,
  };
}
