/**
 * wei（最小単位）の10進文字列を、ユーザー向けエラーメッセージに載せる
 * ETH 単位の小数表記へ変換するユーティリティ（Issue #295）。
 *
 * `operation-error-summary.ts` の `insufficientFunds` パターンからのみ
 * 使う想定の軽量実装。`packages/frontend/src/entities/tokenAmount.ts` の
 * `formatUnits`（decimals 可変・fractionDigits 可変の汎用版）と似た
 * アルゴリズムだが、ここでは decimals=18（ETH固定）専用に単純化し、
 * 末尾ゼロを削る仕上げを加えている。frontend 側の残高表示は桁が揃う
 * 固定桁のままが適切なため、あちらとは意図的に共通化しない
 * （`docs/worklog/issue-295.md` 決定事項1参照）。
 */

/** ETH の小数部（decimals）。 */
const ETH_DECIMALS = 18;

/**
 * 表示する小数部の最大桁数。ガス代（21000 gas × 〜1 gwei ≈ 0.000021 ETH、
 * 1e-5 オーダー）の差が消えないよう 1e-6 まで表示する
 * （`docs/worklog/issue-295.md` 「6桁の根拠」参照。ガス価格がさらに
 * 下がった場合は have/need が同一表示になりうるが、生の wei 値は
 * 呼び出し元が console.error に残すため許容する）。
 */
const MAX_FRACTION_DIGITS = 6;

/**
 * wei 単位の10進文字列 `wei` を ETH 単位の小数表記へ変換する。
 *
 * - BigInt で計算するため精度落ちしない（Number 変換はしない）。
 * - 小数部は最大 {@link MAX_FRACTION_DIGITS} 桁で切り捨てる（丸めない）。
 * - 末尾ゼロは削るが、小数部は最低1桁残す（`"1"` ではなく `"1.0"`。
 *   整数表記と紛れないようにする）。
 * - 単位（" ETH"）は付与しない。呼び出し側のテンプレートで付ける。
 * - `wei` が `BigInt()` で解釈できない場合は、入力をそのまま返す
 *   （エラーメッセージ生成の途中で throw しない。呼び出し元が
 *   フォールバックを検知したい場合は戻り値と入力の一致で判別できる）。
 */
export function formatWeiAsEther(wei: string): string {
  let raw: bigint;
  try {
    raw = BigInt(wei);
  } catch {
    return wei;
  }

  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const sign = negative ? "-" : "";

  const unit = 10n ** BigInt(ETH_DECIMALS);
  const whole = abs / unit;
  const frac = abs % unit;

  const fracFull = frac.toString().padStart(ETH_DECIMALS, "0");
  const truncated = fracFull.slice(0, MAX_FRACTION_DIGITS);
  const trimmed = truncated.replace(/0+$/, "");
  const shown = trimmed.length > 0 ? trimmed : "0";

  return `${sign}${whole.toString()}.${shown}`;
}
