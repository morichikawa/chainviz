/**
 * キャンバスの初期フィット（起動時に一度だけ全ノードが視野に収まるよう
 * カメラを合わせる操作）を「今このタイミングで行ってよいか」を判定する
 * 純粋関数。React / React Flow に依存しないため単体でテストできる
 * （ARCHITECTURE.md §14、docs/worklog/issue-373.md 設計メモ参照）。
 *
 * React Flow 組み込みの `fitView` prop をそのまま使わない理由:
 * チェーンリボンはワールドステート到着前から唯一のノードとして
 * nodes 配列に存在するため、組み込みの初期フィットは高確率で
 * 「タイルが空のリボン1枚」に対して発火し、ズームが最大値に張り付いた
 * まま、直後に届くスナップショットのカード群がビューポート外に置かれる
 * 競合があった（E2E flaky の根本原因）。この関数は「最初のスナップショット
 * の内容がキャンバスに反映され、全ノードの計測が済んだ後」まで判定を
 * 遅らせるために使う。
 */
export interface ShouldPerformInitialFitInput {
  /** 初期フィットを既に実行済みか（実行後は再フィットしない）。 */
  alreadyFitted: boolean;
  /** 最初のワールドステートスナップショットを受信済みか。 */
  hasReceivedSnapshot: boolean;
  /** React Flow の `useNodesInitialized()` の戻り値（全ノードの計測完了）。 */
  nodesInitialized: boolean;
  /** 親（App.tsx）から渡された最新の `nodes` prop の全 id。 */
  expectedNodeIds: readonly string[];
  /** React Flow 内部ストア（`getNodes()`）が現在保持している全 id。 */
  storeNodeIds: readonly string[];
}

/**
 * 初期フィットのズーム上限。スナップショット到着前はチェーンリボン1枚
 * だけの実質空の世界のため、組み込みの `fitView` 相当の動作でも過剰に
 * ズームインしてしまう（既定の最大ズーム＝2）。1（等倍）を上限にして
 * 中立な見え方に留める。ユーザー操作時のズーム上限（maxZoom=2）は
 * 変えない。
 *
 * この値は環境の実測値ではなく「初期表示の中立な上限」という UX 判断の
 * 固定値（docs/worklog/issue-373.md 設計メモ §6 参照）であり、稼働状況
 * （ノード数・稼働時間等）が変わっても成立し続ける前提で決めている。
 */
export const INITIAL_FIT_MAX_ZOOM = 1;

/**
 * 初期フィットを実行してよいかを判定する。
 *
 * `hasReceivedSnapshot && nodesInitialized` だけでは不十分な点に注意:
 * スナップショット到着直後のコミットでは `nodes` prop は最新の全件に
 * 再計算されるが、React Flow 内部ストアはまだ直前の状態（チェーンリボン
 * 1枚だけ等）のままのことがあり、`nodesInitialized` はその「古いが計測
 * 済みの状態」に対して true を返す窓がある。そのため「`expectedNodeIds`
 * の全 id が `storeNodeIds` に存在する」ことも必須条件に加える。
 */
export function shouldPerformInitialFit({
  alreadyFitted,
  hasReceivedSnapshot,
  nodesInitialized,
  expectedNodeIds,
  storeNodeIds,
}: ShouldPerformInitialFitInput): boolean {
  if (alreadyFitted) return false;
  if (!hasReceivedSnapshot) return false;
  if (!nodesInitialized) return false;

  const storeIds = new Set(storeNodeIds);
  return expectedNodeIds.every((id) => storeIds.has(id));
}
