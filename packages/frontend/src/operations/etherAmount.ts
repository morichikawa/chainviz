import { parseUnits } from "./tokenAmount.js";

/**
 * 送金・コントラクト呼び出しの金額欄は ETH 単位の 10 進入力で受け付け、
 * `WorkbenchOperation` へ渡す直前にここで wei（最小単位）の 10 進文字列へ
 * 変換する（ARCHITECTURE.md §6.5/§6.10 決定事項3。プロトコルの `amount` は
 * 常にチェーンの最小単位）。
 *
 * ETH は decimals=18 固定の特殊ケースであり、実体は decimals 可変の
 * `tokenAmount.ts` の `parseUnits` を呼ぶ薄いラッパー（Issue #219:
 * トークン量の単位換算方式をETH以外のトークンにも一般化した際、表示側の
 * `entities/tokenAmount.ts` の `formatEther`/`formatUnits` と対称の構成に
 * した）。
 *
 * 無効な入力（空文字・符号付き・指数表記・非数値・wei未満の精度を要求する
 * 桁数超過など）は undefined を返す。呼び出し側はこれをバリデーションエラー
 * として扱う（フォームは undefined の間は送信できない状態にする）。
 */
export function parseEtherToWei(input: string): string | undefined {
  return parseUnits(input, 18);
}
