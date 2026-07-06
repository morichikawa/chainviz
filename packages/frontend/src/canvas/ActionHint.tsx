import { type ReactNode, useId, useState } from "react";

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
  const [open, setOpen] = useState(false);
  const popoverId = useId();

  return (
    <span
      className="action-hint"
      aria-describedby={open ? popoverId : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span className="action-hint__popover glossary-popover" id={popoverId} role="tooltip">
          {hint}
        </span>
      )}
    </span>
  );
}
