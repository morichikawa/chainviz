import type { Localized } from "../../i18n/messages.js";

/**
 * Ethereum チェーンプロファイルのフロント表現セット（D層。ARCHITECTURE.md
 * §7.6.7「ステージ表示名マッピング」）。`SyncStageProgress.stage` は
 * クライアント依存の生のステージ識別子（例: reth の "Headers" / "Bodies"）を
 * そのまま持つため、その和訳・表示はここが担う（`nodeInternals.ts` の
 * Engine API メソッド分類ラベルと同じ「チェーン固有語彙の解釈はフロント表現
 * セットが担う」流儀。CLAUDE.md の ChainAdapter 境界どおり、ワールドステート・
 * glossary にはこのマッピングを持ち込まない）。
 *
 * Engine API メソッド分類（`ENGINE_API_METHOD_LABELS`）とは違い、ステージ名は
 * 前方一致ではなく完全一致で引く（reth のステージ名にバージョン接尾辞のような
 * ゆらぎが無いため）。別ファイルに分けているのは、突き合わせ方（前方一致 vs
 * 完全一致）が異なる2つの表を1ファイルに混在させないため（1ファイル1責務）。
 */
export const SYNC_STAGE_LABELS: Readonly<Record<string, Localized>> = {
  Headers: { ja: "ヘッダ取得", en: "Fetch headers" },
  Bodies: { ja: "ボディ取得", en: "Fetch bodies" },
  SenderRecovery: { ja: "送信者復元", en: "Recover senders" },
  Execution: { ja: "実行", en: "Execute" },
  AccountHashing: { ja: "アカウントのハッシュ化", en: "Hash accounts" },
  StorageHashing: { ja: "ストレージのハッシュ化", en: "Hash storage" },
  MerkleExecute: { ja: "状態ルート検証", en: "Verify state root" },
  TransactionLookup: { ja: "tx索引作成", en: "Index transactions" },
  IndexAccountHistory: {
    ja: "アカウント履歴の索引",
    en: "Index account history",
  },
  IndexStorageHistory: {
    ja: "ストレージ履歴の索引",
    en: "Index storage history",
  },
  Finish: { ja: "仕上げ", en: "Finish" },
};

/**
 * 生のステージ名から表示名を引く。マッピングに無い名前（例: MerkleUnwind、
 * Prune系、Era）は undefined を返し、呼び出し側は生名のまま表示するフォール
 * バックに倒す（ARCHITECTURE.md §7.6.7「マッピングに無いステージは生の名前の
 * まま表示する」。reth のステージ構成が変わっても行が欠けない縮退動作）。
 */
export function describeSyncStage(stage: string): Localized | undefined {
  return SYNC_STAGE_LABELS[stage];
}
