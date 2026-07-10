import type {
  TransactionEntity,
  WalletEntity,
  WorldStateEntity,
} from "@chainviz/shared";

/**
 * C層のトランザクション表示に使う純粋なデータ変換群。React / タイマー側の
 * 責務（実時間スケジューリング）は `useTxLifecycle.ts` に置き、ここは
 * 「ワールドステートのエンティティ → 表示用データ」の変換だけを持つ
 * （テスト容易性のため）。
 */

export type TxStatus = TransactionEntity["status"];

/** ウォレットカードに載せる直近 tx の既定表示件数。 */
export const DEFAULT_RECENT_TX_LIMIT = 6;

/**
 * ウォレット tx チップのラベル種別（ARCHITECTURE.md §6.6「意味」優先の
 * 表示）。`deploy` の場合は表示文言を i18n（`tx.chip.deploy`）から取るため、
 * `text` は空文字にしておき、呼び出し側（WalletCard）が置き換える。
 */
export type TxChipLabelKind = "function" | "deploy" | "raw" | "hash";

export interface TxChipLabel {
  kind: TxChipLabelKind;
  /** 表示テキスト。`kind === "deploy"` のときは呼び出し側が i18n 訳語に置き換える。 */
  text: string;
}

/**
 * ウォレットの tx チップに出すラベルを「意味」優先で導出する（ARCHITECTURE.md
 * §6.6）。優先順位: `contractCall.functionName` → デプロイ
 * （`createdContractAddress` があるか、`to === null`＝コントラクト作成 tx）
 * → `contractCall.rawFunctionId` の短縮表示 → 素の送金・情報なしの場合は
 * 従来どおり tx hash の短縮表示。
 *
 * `to === null` の判定は Issue #211 で追加した。`createdContractAddress` は
 * ブロック取り込み後（receipt 相当の観測）にしか入らないため、これだけでは
 * pending 中のデプロイ tx が「デプロイ」と分からず、確定するまで tx hash の
 * 短縮表示のまま明滅していた（「デプロイが進行中」だと伝わらない）。
 * `to === null` は tx 自体が届いた時点（pending 含む）で分かる情報のため、
 * pending 中から「デプロイ」ラベルを出せる。副次効果として、確定に失敗し
 * `createdContractAddress` が入らなかったデプロイ tx（failed）も「デプロイ」
 * ラベルになる（従来はここだけ tx hash 短縮表示に落ちる不整合があった）。
 */
export function txChipLabel(tx: TransactionEntity): TxChipLabel {
  if (tx.contractCall?.functionName !== undefined) {
    return { kind: "function", text: tx.contractCall.functionName };
  }
  if (tx.createdContractAddress !== undefined || tx.to === null) {
    return { kind: "deploy", text: "" };
  }
  if (tx.contractCall?.rawFunctionId !== undefined) {
    return { kind: "raw", text: shortHex(tx.contractCall.rawFunctionId, 4, 3) };
  }
  return { kind: "hash", text: shortHex(tx.hash, 4, 3) };
}

/** 16 進文字列（アドレス・ハッシュ）を先頭 + 末尾に短縮して表示する。 */
export function shortHex(hex: string, lead = 6, tail = 4): string {
  if (!hex.startsWith("0x")) return hex;
  // "0x" + lead 桁 + "…" + tail 桁 に収まらない短い値はそのまま返す。
  if (hex.length <= 2 + lead + tail + 1) return hex;
  return `${hex.slice(0, 2 + lead)}…${hex.slice(-tail)}`;
}

/** ワールドステートのエンティティ列から tx を hash キーの Map に索引する。 */
export function indexTransactions(
  entities: Iterable<WorldStateEntity>,
): Map<string, TransactionEntity> {
  const map = new Map<string, TransactionEntity>();
  for (const entity of entities) {
    if (entity.kind === "transaction") map.set(entity.hash, entity);
  }
  return map;
}

/**
 * ウォレットの `recentTxHashes` を実在する TransactionEntity へ解決する。
 * 索引に無いハッシュ（まだ届いていない / 既に掃除された tx）は除外し、
 * 先頭 `limit` 件だけ返す（新しい順で並んでいる前提）。
 */
export function resolveWalletTransactions(
  wallet: WalletEntity,
  txByHash: ReadonlyMap<string, TransactionEntity>,
  limit = DEFAULT_RECENT_TX_LIMIT,
): TransactionEntity[] {
  const result: TransactionEntity[] = [];
  for (const hash of wallet.recentTxHashes) {
    const tx = txByHash.get(hash);
    if (tx) result.push(tx);
    if (result.length >= limit) break;
  }
  return result;
}

/** tx 群を hash -> 現在の status の Map にする（遷移検知の入力）。 */
export function txStatusMap(
  txs: Iterable<TransactionEntity>,
): Map<string, TxStatus> {
  const map = new Map<string, TxStatus>();
  for (const tx of txs) map.set(tx.hash, tx.status);
  return map;
}

/**
 * 前回と今回の status Map を比べ、`pending` から確定（`included` / `failed`）へ
 * 遷移した tx の hash を返す。ここが「mempool 投入 → ブロック取り込み」の
 * 確定の瞬間で、確定フラッシュ演出のトリガーになる。新規に現れた tx や
 * status が変わらない tx は含めない。
 */
export function detectTxSettlements(
  prev: ReadonlyMap<string, TxStatus>,
  next: ReadonlyMap<string, TxStatus>,
): string[] {
  const settled: string[] = [];
  for (const [hash, status] of next) {
    if (prev.get(hash) !== "pending") continue;
    if (status === "included" || status === "failed") settled.push(hash);
  }
  return settled;
}
