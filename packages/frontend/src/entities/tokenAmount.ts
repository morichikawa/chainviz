/**
 * 最小単位の10進文字列を人が読める小数表記へ変換するユーティリティ。
 * `operations/etherAmount.ts`（ETH の10進入力 → wei への変換。定型操作
 * フォームの入力用）とは逆方向の変換を担う対（ARCHITECTURE.md §6.7）。
 *
 * ETH 残高の表示（`walletNode.ts` の `formatEther`）は decimals=18 固定の
 * 特殊ケースであり、`formatEther` はここの `formatUnits` を呼ぶ薄い
 * ラッパーとして実装する（ARCHITECTURE.md「formatEther は decimals 可変の
 * formatUnits へ一般化して共用する」）。
 */

/**
 * 最小単位（wei 相当）の10進文字列 `amount` を、`decimals` 桁を踏まえた
 * 小数表記へ変換する。BigInt で計算するため大きな値でも精度落ちしない。
 *
 * - `fractionDigits` は表示する小数桁数の上限。実際のトークン精度
 *   （`decimals`）がそれより小さい場合は精度の分しか出さない（存在しない
 *   精度をゼロ埋めして見せかけない）。
 * - `decimals` が 0 の場合は小数点自体を出さない。表示する小数桁数が
 *   0 になる場合（`fractionDigits` が 0 以下）も同様に小数点を出さない
 *   （末尾に「.」だけが残る表記を作らない。負値は 0 に切り上げて扱う）。
 * - `amount` が数値として解釈できない、または `decimals` が非負整数でない
 *   （壊れたメタデータ）場合は `amount` をそのまま返す（呼び出し側が
 *   「変換できなかった」ことを検知できるようにする。`formatEther` の
 *   既存の振る舞いと同じフォールバック）。
 */
export function formatUnits(
  amount: string,
  decimals: number,
  fractionDigits = 4,
): string {
  if (!Number.isInteger(decimals) || decimals < 0) return amount;

  let raw: bigint;
  try {
    raw = BigInt(amount);
  } catch {
    return amount;
  }

  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const sign = negative ? "-" : "";

  if (decimals === 0) return `${sign}${abs.toString()}`;

  const unit = 10n ** BigInt(decimals);
  const whole = abs / unit;
  const frac = abs % unit;
  // decimals 桁でゼロ埋めした小数部の先頭 min(fractionDigits, decimals) 桁を
  // 取る。fractionDigits が 0 以下なら小数部ごと（小数点も）出さない（負値を
  // そのまま slice に渡すと末尾からの切り出しになり、意図しない桁数の小数部が
  // 漏れるため 0 に切り上げる）。
  const shownDigits = Math.max(0, Math.min(fractionDigits, decimals));
  if (shownDigits === 0) return `${sign}${whole.toString()}`;
  const fracFull = frac.toString().padStart(decimals, "0");
  return `${sign}${whole.toString()}.${fracFull.slice(0, shownDigits)}`;
}
