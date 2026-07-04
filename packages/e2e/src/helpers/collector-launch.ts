// startCollector が「自分で起動した子プロセスが実際にポートを listen したか」を
// 判定するための純粋なロジック。子プロセスの標準出力・標準エラーの蓄積ログと
// 終了状態だけから状態を決めるので、実プロセスを spawn せずにユニットテストできる。
//
// 背景（Issue #64）: 従来は WebSocket 接続が張れるかどうかだけで判定していた。
// これだと「別プロセス（別 worktree の test:e2e など）が同じポートで既に
// listen している」場合に、自分の子プロセスが EADDRINUSE で即死していても
// 誤って「起動できた」と誤認し、実際には他人の collector に接続してしまう。
// 子プロセス自身のログ（`[collector] WebSocket server listening on port <port>`
// または `[collector] fatal:` + EADDRINUSE）だけを根拠にすることで、必ず
// 自分が起動したプロセスの状態を見るようにする。

/** 子プロセスの起動状況の判定結果。 */
export type CollectorLaunchStatus =
  | { kind: "pending" }
  | { kind: "listening" }
  | { kind: "portInUse" }
  | { kind: "crashed"; exitCode: number | null };

export interface DetectLaunchStatusInput {
  /** 子プロセスの標準出力・標準エラーを結合した蓄積ログ。 */
  logs: string;
  /** 子プロセスへ渡した待ち受けポート。 */
  port: number;
  /** 子プロセスが既に終了しているか。 */
  exited: boolean;
  /** 子プロセスの終了コード（未終了なら null）。 */
  exitCode: number | null;
}

/**
 * 蓄積ログと終了状態から子プロセスの起動状況を判定する。
 *
 * 優先順位: 「listening ログが出ている」を最優先で扱う。EADDRINUSE で
 * 落ちる場合でも listening ログが先に出ることはないため、両方のパターンを
 * 同時に満たすことはない。
 */
export function detectLaunchStatus({
  logs,
  port,
  exited,
  exitCode,
}: DetectLaunchStatusInput): CollectorLaunchStatus {
  if (logs.includes(`[collector] WebSocket server listening on port ${port}`)) {
    return { kind: "listening" };
  }
  if (/EADDRINUSE/.test(logs)) {
    return { kind: "portInUse" };
  }
  if (exited) {
    return { kind: "crashed", exitCode };
  }
  return { kind: "pending" };
}

/** portInUse 判定時に表示する、原因の見当がつくエラーメッセージ。 */
export function portInUseMessage(port: number, logs: string): string {
  return (
    `collector がポート ${port} を確保できませんでした(EADDRINUSE)。` +
    `別の pnpm test:e2e 実行（別ターミナル・別 worktree・別ブランチを含む）が` +
    `既に同じポートで動いている可能性があります。test:e2e は同時に複数実行` +
    `できません。先行実行の終了を待ってから再実行してください。logs:\n${logs}`
  );
}

/** crashed 判定時のエラーメッセージ。 */
export function crashedMessage(exitCode: number | null, logs: string): string {
  return `collector exited early (code ${exitCode}). logs:\n${logs}`;
}
