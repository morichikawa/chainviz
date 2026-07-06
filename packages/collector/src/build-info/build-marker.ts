// ビルド時点の git commit hash（と、その時点で未コミットの変更があったか）を
// マーカーファイルへ書き出す/読み取るための純粋なロジック。
//
// 背景（Issue #121）: scripts/dev-up.sh は packages/collector/dist/index.js の
// 有無だけでビルド要否を判断しており、dist/ が古いまま残っていても検知でき
// なかった（例: reth 同士の P2P エッジ描画の修正（Issue #106）をマージした後
// pnpm build を忘れて pnpm dev:up した結果、古い dist/ で起動し続けた）。
//
// mtime（ファイル更新時刻）比較は clone/checkout でタイムスタンプが更新される
// 等、環境に左右される「今この瞬間に観測できる状態」に依存するため
// （CLAUDE.md の運用ルール参照）採用せず、git commit hash をビルド時に
// マーカーファイルへ書き込み、起動時の HEAD と比較する方式を採る。
//
// ファイル形式はシンプルな2行のテキスト（bash 側（scripts/dev-up.sh）が
// jq 等の追加依存なしで sed/read だけで読めるようにするため）:
//   1行目: commit hash（`git rev-parse HEAD` の出力）
//   2行目: "dirty"（ビルド時に未コミットの変更があった） or "clean"

export interface BuildMarkerInfo {
  /** ビルド時点の `git rev-parse HEAD` の出力（改行なし）。 */
  commitHash: string;
  /** ビルド時点で `git status --porcelain` が何か出力していたら true。 */
  dirty: boolean;
}

export const BUILD_MARKER_FILENAME = ".build-commit";

const DIRTY_TOKEN = "dirty";
const CLEAN_TOKEN = "clean";

/** BuildMarkerInfo をマーカーファイルの中身（2行のテキスト）に変換する。 */
export function formatBuildMarker(info: BuildMarkerInfo): string {
  return `${info.commitHash}\n${info.dirty ? DIRTY_TOKEN : CLEAN_TOKEN}\n`;
}

/**
 * マーカーファイルの中身を BuildMarkerInfo に変換する。1行目が空、または
 * ファイル自体が空文字列など、壊れた/想定外の内容なら null を返す
 * （呼び出し側は「ビルド情報が見つからない」扱いにできる）。
 */
export function parseBuildMarker(content: string): BuildMarkerInfo | null {
  const lines = content.split("\n").map((line) => line.trim());
  const commitHash = lines[0];
  if (!commitHash) return null;
  const dirtyToken = lines[1];
  return { commitHash, dirty: dirtyToken === DIRTY_TOKEN };
}
