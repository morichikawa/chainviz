import { type ReactNode, useId, useRef } from "react";
import { useHoverPopover } from "../interaction/useHoverPopover.js";
import { PopoverPortal } from "../interaction/PopoverPortal.js";

export interface ActionHintProps {
  /** ホバー/フォーカス対象になる要素（ボタンなど）。 */
  children: ReactNode;
  /** ポップオーバーに表示する説明文。 */
  hint: string;
}

/**
 * ボタン類にホバー/フォーカスで表示される予告ツールチップ（Issue #123 UX設計
 * §4-1）。ネイティブの `title` 属性は改行・スタイリングができずキーボード
 * フォーカスでも出ないため使わず、`glossary/GlossaryTerm.tsx` と同じ
 * 「`aria-describedby` で参照する自前ポップオーバー」の見た目・実装方針に揃える。
 */
export function ActionHint({ children, hint }: ActionHintProps) {
  // Issue #221: 隙間を通過する一瞬の mouseleave で消えないよう遅延クローズ。
  const { isOpen: open, onMouseEnter, onMouseLeave, onFocus, onBlur } =
    useHoverPopover();
  const popoverId = useId();
  // Issue #245: React Flow のノードはそれぞれ独立したスタッキングコンテキスト
  // を持つため、隣接カードの下に隠れないよう body 直下へ portal 描画する。
  const anchorRef = useRef<HTMLSpanElement>(null);

  return (
    <span
      ref={anchorRef}
      className="action-hint"
      aria-describedby={open ? popoverId : undefined}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {children}
      {open && (
        <PopoverPortal
          anchorRef={anchorRef}
          gapPx={8}
          className="action-hint__popover glossary-popover"
          id={popoverId}
          role="tooltip"
        >
          {hint}
        </PopoverPortal>
      )}
    </span>
  );
}
