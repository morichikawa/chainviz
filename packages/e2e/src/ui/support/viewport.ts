// キャンバス(React Flow)のビューポート操作に関する共通ヘルパー。
// Issue #373: 初期フィット(ARCHITECTURE.md §14)は「ページロード時点の
// スナップショットに含まれるカード」までしか視野内を保証しない。ページ
// ロード後に diff で追加されたカード(他クライアントの操作による追加等)は
// 初期フィットの対象外で、キャンバスがスクロールコンテナではなく CSS
// transform でパンする性質上(Playwright の自動スクロールでは救済できない)、
// 実座標クリックが「ビューポート外へ永久リトライ」する構造的な脆さを持つ
// (docs/worklog/issue-373.md §1〜§3の調査記録参照)。
//
// 対象へのクリック前にこのヘルパーで React Flow Controls のフィットボタン
// (ユーザーが実際に押せる操作と同じ)を押しておくことで、その時点の全カード
// を視野に収めてから安全にクリックできるようにする。
//
// Issue #373 差し戻し対応(QA回帰): 「ページロード後に diff で追加された
// カード」を対象にフィットボタンを1回だけ押す方式には、別の競合状態が
// あった。React Flow の内部計測(ResizeObserver によるノードの
// 幅・高さ確定)は非同期のため、対象カードが DOM 上に出現した直後は
// 「DOM には存在するが、React Flow の内部ストアにはまだ未計測」という
// 窓がある。その窓でフィットボタンを押すと、フィットが対象カードを含めずに
// 他のノードだけへ確定してしまい、以後は再フィットが起きないため対象が
// ビューポート外に固定されてしまう(docs/worklog/issue-373.md
// 「差し戻し対応」節参照)。これを避けるため、フィット後に対象が実際に
// 視野内へ入ったことを確認し、入っていなければ計測が追いつくまで小休止して
// フィットを再試行する。

import type { Locator, Page } from "@playwright/test";

/**
 * フィット後、対象が視野内へ入るまで再試行する際の既定の合計上限時間。
 *
 * この値が保証したいのは「React Flow が新規ノードを内部計測し終える
 * (ResizeObserver のコールバックが発火し、fitView の対象に含まれるように
 * なる)まで待つ」という、ブラウザの描画パイプライン由来の遅延であり、
 * ブロック生成間隔のような環境の稼働状況に依存する値ではない
 * (CLAUDE.md「今この瞬間に観測できる状態に依存した固定値をロジックに
 * 埋め込まない」の対象外)。実測では計測完了は概ね1フレーム
 * (十数ms)以内に収まるため、5秒は通常時に使い切ることのない十分な
 * 余裕を持たせた上限。
 */
const DEFAULT_SETTLE_TIMEOUT_MS = 5_000;

/** リトライ間隔(フィット再試行の間に置く小休止)。 */
const DEFAULT_POLL_INTERVAL_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * `target` の全体が現在のビューポート内に収まっているかを判定する。
 *
 * `boundingBox()` はページのビューポートを基準にした座標を返す
 * (要素が非表示なら `null`)。`viewportSize()` が `null` の場合
 * (通常は起こらないが型上ありうる)は安全側に倒して「視野内ではない」
 * と判定する。
 */
async function isFullyInViewport(page: Page, target: Locator): Promise<boolean> {
  const box = await target.boundingBox();
  if (!box) return false;
  const viewport = page.viewportSize();
  if (!viewport) return false;
  return (
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= viewport.width &&
    box.y + box.height <= viewport.height
  );
}

/**
 * React Flow の Controls にあるフィットボタン（`.react-flow__controls-fitview`。
 * React Flow が付与する安定クラス名で、フロント側にテスト専用フックを
 * 追加しない）をクリックし、`target` が実際に視野内へ入るまで
 * (計測の追いつきを待ちながら)再試行する。
 *
 * `target` に対象カード自身ではなく「次にクリックしたい要素」
 * (例: 削除ボタン)を渡すことを想定する。`timeoutMs` の上限まで一度も
 * 視野内へ入らなかった場合は、握りつぶさずに例外を投げる
 * (CLAUDE.md「エラーを握りつぶすコードを見逃さない」)。
 *
 * 適用箇所は「クリック対象がページロード後に diff で追加されたカード」の
 * シナリオに限定する(初期スナップショットに含まれるカードは Issue #373 の
 * 本質修正で既に視野内が保証されるため不要。docs/worklog/issue-373.md
 * 実装メモ参照)。
 */
export async function fitCanvasView(
  page: Page,
  target: Locator,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const fitViewButton = page.locator(".react-flow__controls-fitview");
  const startedAt = Date.now();

  for (;;) {
    await fitViewButton.click();
    if (await isFullyInViewport(page, target)) return;
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(
        `fitCanvasView: target did not enter the viewport within ${timeoutMs}ms ` +
          "even after repeatedly retrying the React Flow fit-view button. " +
          "This likely means the target node is not part of the current " +
          "world state (see docs/worklog/issue-373.md).",
      );
    }
    await sleep(pollIntervalMs);
  }
}
