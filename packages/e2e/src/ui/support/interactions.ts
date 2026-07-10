// UI 層 E2E（Playwright）で複数スペックが再利用できる、要素操作まわりの
// 共有ヘルパー。node-internals.spec.ts（UI-D）の実装中に判明した Playwright
// 特有のハマりどころ2件の回避策を、他のシナリオでも同じ落とし穴を踏まない
// よう関数として切り出したもの（docs/worklog/issue-203.md 参照）。それぞれ
// 「なぜ素直な書き方だと失敗するのか」を doc コメントに残し、将来別のエッジ・
// ポップオーバー系シナリオを書く担当が回避策を再発見せずに済むようにする。

import type { Locator } from "@playwright/test";

/**
 * 要素へホバー相当のイベントを、座標ベースの当たり判定を経由せず直接発行する。
 *
 * 背景: React Flow ではノード（HTML 要素）がエッジ（SVG）より上位レイヤーに
 * 描画されるため、エッジの経路が隣接ノードカードと視覚的に重なると、
 * Playwright の `Locator.hover()`（実マウス座標のヒットテスト）が上のカードに
 * 吸われ `intercepts pointer events` で失敗することがある
 * （node-internals.spec.ts の内部リンクエッジで実機確認）。React Flow の
 * `onEdgeMouseEnter` は React の合成 `mouseover` で発火するため、対象要素へ
 * 直接 `mouseover` を dispatch すればヒットテストを経由せず確実に発火できる。
 *
 * エッジのように「見えているが座標的に他要素へ覆われうる」要素のホバーに使う。
 * 逆に、ノードカードのように単独で確実にヒットテストできる要素は素直に
 * `hover()` を使ってよい（実マウス操作に近いほうが本番に忠実なため）。
 */
export async function dispatchHover(target: Locator): Promise<void> {
  await target.dispatchEvent("mouseover");
}

/**
 * `scope` 配下から、指定した `data-testid` を子孫に持つ要素を、ブラウザ組み込み
 * の CSS `:has()` セレクタで絞り込む。
 *
 * 背景: 「特定の testid を内包する行」を選ぶ際に
 * `scope.locator(sel).filter({ has: scope.getByTestId(id) })` と書くと、要素が
 * 実在するにも関わらず解決に失敗する事象を実機確認した（同じ `scope` から
 * 独立に導出した2つの Locator を `filter({ has })` に渡す組み合わせで再現。
 * docs/worklog/issue-203.md）。ネイティブの `:has()` セレクタ文字列なら1つの
 * Locator に閉じるため確実に解決できる。data-testid は付いているが、その値を
 * 持つ要素そのものではなく「それを内包する親（行・フィールド）」を掴みたい
 * ときに使う。
 */
export function descendantContainingTestId(
  scope: Locator,
  selector: string,
  testId: string,
): Locator {
  return scope.locator(`${selector}:has([data-testid="${testId}"])`);
}
