/**
 * 同期ステージのミニプログレスバー（ARCHITECTURE.md §7.6.5）。ポップオーバーの
 * ステージ一覧（1行につき1本）とカード面のバックフィル進行行（1本のみ）の
 * 両方から再利用する表示専用コンポーネント。ロジックは持たず、
 * `entities/syncProgress.ts` が算出した value/max をそのまま幅%へ変換するだけ。
 */
export function SyncProgressBar({
  value,
  max,
}: {
  value: number;
  max: number;
}) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="sync-progress-bar" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div
        className="sync-progress-bar__fill"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
