/**
 * 定型操作フォームのトークン量入力（10進のトークン単位。例: `1.5`）を、
 * `decimals` 桁を踏まえた最小単位（wei相当）の10進文字列へ変換する
 * ユーティリティ（Issue #219: トークン量の単位換算方式）。
 *
 * `entities/tokenAmount.ts` の `formatUnits`（最小単位 → 表示用の小数表記。
 * 逆方向）と対称の変換を担う。`operations/etherAmount.ts` の
 * `parseEtherToWei`（decimals=18 固定の ETH 特殊ケース）は、ここの
 * `parseUnits` を呼ぶ薄いラッパーとして実装する。
 */

/**
 * 10進の量文字列 `input` を、`decimals` 桁の最小単位の10進文字列へ変換する。
 * BigInt で計算するため大きな値でも精度落ちしない。
 *
 * 無効な入力は `undefined` を返す。呼び出し側はこれをバリデーションエラー
 * として扱う（フォームは `undefined` の間は送信できない状態にする）。
 * 無効とみなすケース:
 * - 空文字・空白のみ
 * - 符号付き（`+`/`-`）・指数表記・カンマ区切り・16進表記などの非単純10進数
 * - 小数部の桁数が `decimals` を超える（最小単位より細かい精度を要求する）
 * - `decimals` が非負整数でない（呼び出し側のデータ不整合。値を返さず
 *   検知できるようにする）
 */
export function parseUnits(input: string, decimals: number): string | undefined {
  if (!Number.isInteger(decimals) || decimals < 0) return undefined;

  const trimmed = input.trim();
  if (trimmed === "") return undefined;
  // 先頭ゼロ許容・符号なし・指数表記なしの単純な10進数（整数 or 小数）のみ許可する。
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return undefined;

  const [wholePart, fracPart = ""] = trimmed.split(".");
  // decimals より細かい小数は最小単位で表現できない。
  if (fracPart.length > decimals) return undefined;

  const whole = BigInt(wholePart);
  const unit = 10n ** BigInt(decimals);
  const fracPadded = fracPart.padEnd(decimals, "0");
  const frac = fracPadded === "" ? 0n : BigInt(fracPadded);
  return (whole * unit + frac).toString();
}
