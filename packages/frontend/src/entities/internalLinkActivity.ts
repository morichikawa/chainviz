import type { InternalCallStats } from "@chainviz/shared";
import { describeEngineApiMethod } from "../chain-profiles/ethereum/nodeInternals.js";
import { describeValidatorApiMethod } from "../chain-profiles/ethereum/validatorApiMethodLabels.js";
import { format, pickLocale } from "../i18n/i18n.js";
import type { Language, MessageKey } from "../i18n/messages.js";

/**
 * 内部リンクエッジのホバーポップオーバー（ARCHITECTURE.md §7.6.3）に出す
 * 「直近観測」の内訳（メソッド別の増分一覧）を組み立てる純粋関数。
 *
 * 生のメソッド名はそのまま見せつつ、`chain-profiles/ethereum/nodeInternals.ts`
 * の Engine API 分類ラベル（§7.6.7）と
 * `chain-profiles/ethereum/validatorApiMethodLabels.ts` の VC メトリクス
 * 分類ラベル（§7.6.12、Issue #420）を順に試し、引ければ役割の和訳を丸括弧で
 * 併記する。両テーブルの前方一致プレフィックス（`engine_*` / `vc_signed_*`）は
 * 名前空間が重ならないため、単純な2段フォールバックで誤マッチの心配はない
 * （ARCHITECTURE.md §7.6.12）。所要時間（`latencyMs`）が観測できていれば、
 * その平均値も丸括弧で続ける。
 *
 * ARCHITECTURE.md の和文例は全角括弧（例:「（ブロックの実行依頼）」）だが、
 * 日英共通の実装にするため半角括弧に統一する（構成・意味は変えない範囲の
 * 語調調整）。
 */
export function formatInternalCallEntry(
  call: InternalCallStats,
  lang: Language,
  t: (key: MessageKey) => string,
): string {
  const label = describeEngineApiMethod(call.method) ?? describeValidatorApiMethod(call.method);
  const labelSuffix = label ? ` (${pickLocale(label, lang)})` : "";
  const latencySuffix =
    call.latencyMs !== undefined
      ? ` (${format(t("internalEdge.latency"), { ms: Math.round(call.latencyMs).toString() })})`
      : "";
  return `${call.method} ×${call.count}${labelSuffix}${latencySuffix}`;
}

/** メソッド別の増分一覧を「 · 」区切りの1本の文字列にまとめる。 */
export function formatInternalCallList(
  calls: InternalCallStats[],
  lang: Language,
  t: (key: MessageKey) => string,
): string {
  return calls.map((call) => formatInternalCallEntry(call, lang, t)).join(" · ");
}
