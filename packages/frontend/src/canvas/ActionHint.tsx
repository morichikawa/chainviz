import { type ReactNode, useId, useRef } from "react";
import { useHoverPopover } from "../interaction/useHoverPopover.js";
import { PopoverPortal } from "../interaction/PopoverPortal.js";

export interface ActionHintProps {
  /** ホバー/フォーカス対象になる要素（ボタンなど）。 */
  children: ReactNode;
  /**
   * ポップオーバーに表示する説明文。単純な文字列に加えて、`GlossaryTerm` を
   * 埋め込んだ複数行構成（Issue #251: ノード追加ボタンの「なぜペアか」の
   * 2段目）も渡せるよう ReactNode を受け付ける。
   */
  hint: ReactNode;
  /**
   * true の間はホバー/フォーカス状態に関わらずポップオーバーを表示しない
   * （Issue #410）。ボタンをクリックして別のパネル（操作パネル等）が開いた
   * 直後は、カーソルがまだボタン上に残っていて内部のホバー状態は開いた
   * ままだが、予告の役目は終わっているため呼び出し側から強制的に隠す
   * ための出口。`useHoverPopover` 自体のホバー追跡ロジックは変更しない
   * （呼び出し側は再度ホバーし直せば通常どおり表示が戻る）。
   */
  suppressed?: boolean;
}

/**
 * ボタン類にホバー/フォーカスで表示される予告ツールチップ（Issue #123 UX設計
 * §4-1）。ネイティブの `title` 属性は改行・スタイリングができずキーボード
 * フォーカスでも出ないため使わず、`glossary/GlossaryTerm.tsx` と同じ
 * 「`aria-describedby` で参照する自前ポップオーバー」の見た目・実装方針に揃える。
 */
export function ActionHint({ children, hint, suppressed = false }: ActionHintProps) {
  // Issue #221: 隙間を通過する一瞬の mouseleave で消えないよう遅延クローズ。
  const { isOpen: open, onMouseEnter, onMouseLeave, onFocus, onBlur } =
    useHoverPopover();
  const popoverId = useId();
  // Issue #245: React Flow のノードはそれぞれ独立したスタッキングコンテキスト
  // を持つため、隣接カードの下に隠れないよう body 直下へ portal 描画する。
  const anchorRef = useRef<HTMLSpanElement>(null);
  // Issue #410: 内部のホバー状態(open)はそのままに、表示だけを外部から
  // 抑制する。ボタンクリックで別パネルが開いた瞬間に呼び出し側が
  // suppressed=true を渡すことで、カーソルがまだボタン上にあっても
  // ポップオーバーを消せる。
  const visible = open && !suppressed;

  return (
    <span
      ref={anchorRef}
      className="action-hint"
      aria-describedby={visible ? popoverId : undefined}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {children}
      {visible && (
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
