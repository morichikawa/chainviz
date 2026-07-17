/**
 * エントリの時刻表示（設計メモ §5.1「時刻（ローカル HH:MM:SS）」）。
 *
 * `chainRibbon.ts` の `formatBlockTimestamp` はブロックタイムスタンプ
 * （チェーン上の絶対時刻・全員が同じ値を見るべき情報）を UTC 固定で表示するが、
 * こちらは「自分がいつ見たか」というログの読み手のローカル時計に合わせる
 * ことに意味があるため、意図的にホストのタイムゾーンに従う（Intl 等を経由
 * せず `Date` のローカル系アクセサを直接使う、依存最小の実装）。
 */
export function formatLocalTime(timestampMs: number): string {
  const date = new Date(timestampMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
