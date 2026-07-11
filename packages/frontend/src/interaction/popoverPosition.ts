/** アンカー要素の矩形（`getBoundingClientRect()` の一部）。 */
export interface AnchorRect {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
}

/** 画面上の絶対座標（`position: fixed` の `top`/`left` にそのまま使える）。 */
export interface PopoverPosition {
  readonly top: number;
  readonly left: number;
}

/**
 * アンカー要素の画面上の矩形から、ポップオーバーを置くべき絶対座標を求める
 * （Issue #245）。アンカーの下端から `gapPx` だけ離し、左端はアンカーの左端に
 * 揃える。これは `styles.css` で従来使っていた
 * `position: absolute; top: calc(100% + gapPx); left: 0;` と見た目上等価な
 * 配置を、`position: fixed` 用の絶対座標として計算し直したもの。
 *
 * React Flow の各ノードは独立したスタッキングコンテキストを作るため、
 * カード内に `position: absolute` で描画するポップオーバーは、CSS の
 * z-index をいくら上げても隣接ノードの裏に隠れることがある
 * （`docs/worklog/issue-245.md` 参照）。`PopoverPortal` がこの関数を使って
 * `document.body` 直下に座標指定で描画することで、その制約から逃れる。
 */
export function computePopoverPosition(
  anchorRect: AnchorRect,
  gapPx: number,
): PopoverPosition {
  return {
    top: anchorRect.bottom + gapPx,
    left: anchorRect.left,
  };
}
