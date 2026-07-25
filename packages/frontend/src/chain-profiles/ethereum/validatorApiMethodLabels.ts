import type { Localized } from "../../i18n/messages.js";

/**
 * Ethereum チェーンプロファイルのフロント表現セット（D層。ARCHITECTURE.md
 * §7.6.12「validator 自身の活動パルス」、Issue #420）。VC
 * （validator client）自身の Prometheus メトリクスから組み立てられる
 * `InternalCallStats.method` は `<メトリクスファミリー名>:<status ラベル値>`
 * 形式の生の識別子（例: "vc_signed_beacon_blocks_total:success"）を
 * そのまま持つため、その解釈・表示（役割の和訳）はここが担う
 * （`nodeInternals.ts` の `ENGINE_API_METHOD_LABELS`/`describeEngineApiMethod`
 * と同型の「チェーン固有語彙の解釈はフロント表現セットが担う」流儀）。
 *
 * `status` ラベルの値（`success`/`slashable`/`same_data`/`unregistered`）に
 * 関わらずマッチするよう、接頭辞はメトリクスファミリー名までに留める
 * （ARCHITECTURE.md §7.6.12「フロント側の前方一致マッピングは status の値に
 * 関わらずマッチする設計にしておく」）。
 */

export interface ValidatorApiMethodLabelEntry {
  /** この接頭辞に前方一致するメソッド名すべてに適用する。 */
  prefix: string;
  label: Localized;
}

/**
 * 前方一致の判定順がそのまま優先順位になる。現状は接頭辞同士が重ならない
 * ため実害は無いが、将来近い接頭辞を追加する場合はより具体的なものを先に
 * 置くこと。
 */
export const VALIDATOR_API_METHOD_LABELS: readonly ValidatorApiMethodLabelEntry[] = [
  {
    prefix: "vc_signed_beacon_blocks_total",
    label: { ja: "ブロック提案の署名", en: "Sign proposed block" },
  },
  {
    prefix: "vc_signed_attestations_total",
    label: { ja: "証明（attestation）の署名", en: "Sign attestation" },
  },
];

/**
 * 生の VC メトリクス由来のメソッド名から役割ラベルを引く。前方一致する
 * エントリが無ければ undefined（呼び出し側は生名のみで表示するフォールバック
 * に倒す。`describeEngineApiMethod` と同じ流儀。ARCHITECTURE.md §7.6.12
 * 「一致しないメソッドは生名のみで表示する」）。
 */
export function describeValidatorApiMethod(
  method: string,
): Localized | undefined {
  const entry = VALIDATOR_API_METHOD_LABELS.find((candidate) =>
    method.startsWith(candidate.prefix),
  );
  return entry?.label;
}
