import type { Localized } from "../../i18n/messages.js";

/**
 * Ethereum チェーンプロファイルのフロント表現セット（D層。ARCHITECTURE.md
 * §7.6.7「Engine API メソッド分類ラベル」）。`InternalCallStats.method` は
 * チェーン/クライアント依存の生の識別子（例: "engine_newPayloadV4"）を
 * そのまま持つため、その解釈・表示（役割の和訳）はここが担う
 * （`operationCatalog.ts` と同じ「チェーン固有語彙の解釈はフロント表現
 * セットが担う」流儀。CLAUDE.md の ChainAdapter 境界どおり、ワールド
 * ステート・glossary にはこの分類を持ち込まない）。
 */

export interface EngineApiMethodLabelEntry {
  /** この接頭辞に前方一致するメソッド名すべてに適用する。 */
  prefix: string;
  label: Localized;
}

/**
 * 前方一致の判定順がそのまま優先順位になる。現状は接頭辞同士が重ならない
 * ため実害は無いが、将来近い接頭辞を追加する場合はより具体的なものを先に
 * 置くこと。
 */
export const ENGINE_API_METHOD_LABELS: readonly EngineApiMethodLabelEntry[] = [
  {
    prefix: "engine_newPayload",
    label: { ja: "ブロックの実行依頼", en: "Execute new block" },
  },
  {
    prefix: "engine_forkchoiceUpdated",
    label: { ja: "チェーン先端の更新", en: "Update chain head" },
  },
  {
    prefix: "engine_getPayload",
    label: { ja: "ブロック構築の依頼", en: "Request block build" },
  },
];

/**
 * 生の Engine API メソッド名から役割ラベルを引く。前方一致するエントリが
 * 無ければ undefined（呼び出し側は生名のみで表示するフォールバックに倒す。
 * ARCHITECTURE.md §7.6.7「一致しないメソッドは生名のみで表示する」）。
 */
export function describeEngineApiMethod(
  method: string,
): Localized | undefined {
  const entry = ENGINE_API_METHOD_LABELS.find((candidate) =>
    method.startsWith(candidate.prefix),
  );
  return entry?.label;
}
