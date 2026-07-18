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

import type { Page } from "@playwright/test";

/**
 * React Flow の Controls にあるフィットボタン（`.react-flow__controls-fitview`。
 * React Flow が付与する安定クラス名で、フロント側にテスト専用フックを
 * 追加しない）をクリックし、その時点の全ノードが視野に収まるようにする。
 *
 * 適用箇所は「クリック対象がページロード後に diff で追加されたカード」の
 * シナリオに限定する(初期スナップショットに含まれるカードは Issue #373 の
 * 本質修正で既に視野内が保証されるため不要。docs/worklog/issue-373.md
 * 実装メモ参照)。
 */
export async function fitCanvasView(page: Page): Promise<void> {
  await page.locator(".react-flow__controls-fitview").click();
}
