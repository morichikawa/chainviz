import {
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type RefObject,
  useLayoutEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { computePopoverPosition, type PopoverPosition } from "./popoverPosition.js";

export interface PopoverPortalProps
  extends Omit<ComponentPropsWithoutRef<"div">, "style"> {
  /** ポップオーバーの位置合わせの基準にする要素への ref。 */
  anchorRef: RefObject<HTMLElement | null>;
  /** アンカー下端からの余白(px)。既存 CSS の `top: calc(100% + Npx)` に対応。 */
  gapPx?: number;
}

const DEFAULT_GAP_PX = 8;

function toFixedStyle(position: PopoverPosition): CSSProperties {
  return { position: "fixed", top: position.top, left: position.left };
}

/**
 * ホバーポップオーバーを `document.body` 直下へ portal 描画する共通コンポーネント
 * （Issue #245）。React Flow の各ノードは `position` + `zIndex` を持つ独立した
 * スタッキングコンテキストを作るため、カード内に `position: absolute` で描画する
 * ポップオーバーは、CSS の z-index をいくら上げても隣接ノード（別の
 * スタッキングコンテキスト）の裏に隠れることがある（詳細は
 * `docs/worklog/issue-245.md`）。portal で body 直下に出すことでノードの
 * スタッキングコンテキストから脱出させ、かつ表示中は毎フレーム `anchorRef` の
 * 画面上の位置を再計算して追従させる（キャンバスのパン/ズームは
 * `.react-flow__viewport` への CSS transform で行われ、scroll/resize
 * イベントが飛ばないため、個々のイベントではなく rAF ポーリングで追従する。
 * ノードのドラッグや、祖先要素のスクロールにも同じ仕組みで自動的に追従する）。
 *
 * このコンポーネントは呼び出し側の条件付きレンダリング（`{isOpen && <... />}`）
 * でマウント/アンマウントされる前提で、自身の表示可否は管理しない
 * （マウントされている間、常に portal 表示する）。
 */
export function PopoverPortal({
  anchorRef,
  gapPx = DEFAULT_GAP_PX,
  children,
  ...rest
}: PopoverPortalProps) {
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  useLayoutEffect(() => {
    let frameId: number;
    const track = () => {
      const anchor = anchorRef.current;
      if (anchor) {
        const next = computePopoverPosition(anchor.getBoundingClientRect(), gapPx);
        setPosition((prev) =>
          prev !== null && prev.top === next.top && prev.left === next.left
            ? prev
            : next,
        );
      }
      frameId = requestAnimationFrame(track);
    };
    track();
    return () => cancelAnimationFrame(frameId);
  }, [anchorRef, gapPx]);

  if (position === null) return null;

  return createPortal(
    <div {...rest} style={toFixedStyle(position)}>
      {children}
    </div>,
    document.body,
  );
}
