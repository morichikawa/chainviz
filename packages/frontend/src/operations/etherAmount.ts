const WEI_PER_ETHER = 1_000_000_000_000_000_000n;

/**
 * 送金・コントラクト呼び出しの金額欄は ETH 単位の 10 進入力で受け付け、
 * `WorkbenchOperation` へ渡す直前にここで wei（最小単位）の 10 進文字列へ
 * 変換する（ARCHITECTURE.md §6.5/§6.10 決定事項3。プロトコルの `amount` は
 * 常にチェーンの最小単位）。
 *
 * 無効な入力（空文字・符号付き・指数表記・非数値・wei未満の精度を要求する
 * 桁数超過など）は undefined を返す。呼び出し側はこれをバリデーションエラー
 * として扱う（フォームは undefined の間は送信できない状態にする）。
 */
export function parseEtherToWei(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed === "") return undefined;
  // 先頭ゼロ許容・符号なし・指数表記なしの単純な10進数（整数 or 小数）のみ許可する。
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return undefined;

  const [wholePart, fracPart = ""] = trimmed.split(".");
  // wei は ETH の 10^-18 が最小単位。それより細かい小数は表現できない。
  if (fracPart.length > 18) return undefined;

  const whole = BigInt(wholePart);
  const fracPadded = fracPart.padEnd(18, "0");
  const frac = fracPadded === "" ? 0n : BigInt(fracPadded);
  return (whole * WEI_PER_ETHER + frac).toString();
}
