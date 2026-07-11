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
//
// 背景（Issue #254）: collector（`packages/collector/src/index.ts` の
// `main()`）は WebSocket サーバーとロギングプロキシという、独立した 2 つの
// TCP listen を順番に行う（WS が先、ロギングプロキシが後）。従来の
// `detectLaunchStatus` は WS の listening ログだけを根拠に "listening" と
// 確定させていたため、WS の bind には成功したがその直後にロギングプロキシが
// （既定ポートの衝突などで）EADDRINUSE で失敗するケースを見逃していた
// （呼び出し側は WS の listening ログを見た時点でログ監視を止めてしまう
// ため、後発の EADDRINUSE ログが出ても気づけない）。両方の listening ログが
// 揃って初めて "listening" と判定するようにし、EADDRINUSE の検出を最優先に
// することで、どちらの listen が失敗しても即座に検知できるようにする。

/** 子プロセスの起動状況の判定結果。 */
export type CollectorLaunchStatus =
  | { kind: "pending" }
  | { kind: "listening" }
  | { kind: "portInUse" }
  | { kind: "crashed"; exitCode: number | null };

export interface DetectLaunchStatusInput {
  /** 子プロセスの標準出力・標準エラーを結合した蓄積ログ。 */
  logs: string;
  /** 子プロセスへ渡した WebSocket サーバーの待ち受けポート。 */
  port: number;
  /** 子プロセスへ渡したロギングプロキシの待ち受けポート。 */
  proxyPort: number;
  /** 子プロセスが既に終了しているか。 */
  exited: boolean;
  /** 子プロセスの終了コード（未終了なら null）。 */
  exitCode: number | null;
}

/**
 * 蓄積ログと終了状態から子プロセスの起動状況を判定する。
 *
 * 優先順位: EADDRINUSE の検出を最優先にする。WS・ロギングプロキシの
 * どちらの listen が先に失敗しても、その時点で "listening" と誤確定させ
 * ないようにするため（Issue #254）。次に「WS・ロギングプロキシ両方の
 * listening ログが揃っているか」を見る。片方だけならまだ起動完了して
 * いないので pending のまま待つ。
 */
export function detectLaunchStatus({
  logs,
  port,
  proxyPort,
  exited,
  exitCode,
}: DetectLaunchStatusInput): CollectorLaunchStatus {
  if (/EADDRINUSE/.test(logs)) {
    return { kind: "portInUse" };
  }
  const wsListening = logs.includes(
    `[collector] WebSocket server listening on port ${port}`,
  );
  const proxyListening = logs.includes(
    `[collector] logging proxy listening on port ${proxyPort}`,
  );
  if (wsListening && proxyListening) {
    return { kind: "listening" };
  }
  if (exited) {
    return { kind: "crashed", exitCode };
  }
  return { kind: "pending" };
}

/**
 * portInUse 判定時に表示する、原因の見当がつくエラーメッセージ。
 * WebSocket サーバー・ロギングプロキシのどちらの listen が失敗したかは
 * ログ本文（末尾に付与する logs）を見れば分かるため、メッセージ本文では
 * 両方のポートを衝突の候補として案内する（Issue #254）。
 */
export function portInUseMessage(
  port: number,
  proxyPort: number,
  logs: string,
): string {
  return (
    `collector がポート ${port}(WebSocket) または ${proxyPort}(ロギング` +
    `プロキシ) を確保できませんでした(EADDRINUSE)。既存の dev collector や、` +
    `別の pnpm test:e2e 実行（別ターミナル・別 worktree・別ブランチを含む）が` +
    `同じポートで動いている可能性があります。test:e2e は同時に複数実行` +
    `できません。先行実行の終了を待つか、CHAINVIZ_PROXY_PORT 等でポートを` +
    `変えてから再実行してください。logs:\n${logs}`
  );
}

/** crashed 判定時のエラーメッセージ。 */
export function crashedMessage(exitCode: number | null, logs: string): string {
  return `collector exited early (code ${exitCode}). logs:\n${logs}`;
}
