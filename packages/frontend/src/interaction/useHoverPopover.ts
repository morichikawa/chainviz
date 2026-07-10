import { useCallback, useEffect, useRef, useState } from "react";

/**
 * ホバー/フォーカスで開くポップオーバーを閉じるまでの猶予時間（Issue #221）。
 * カードとポップオーバーの間には見た目の余白（`styles.css` の
 * `top: calc(100% + Npx)` 等）が意図的に空けられており、その隙間はカード・
 * ポップオーバーどちらの描画範囲にも属さない。カーソルがこの隙間を通過する
 * だけの間、`mouseleave` が発火してポップオーバーが消えてしまわないよう、
 * 閉じる操作は即座に反映せずこの時間だけ待ってから閉じる。値はドロップダウン/
 * ツールチップ類で一般的に使われる遅延の慣習値であり、実行環境の状態から
 * 動的に導出すべき量ではない（隙間は数px〜十数px 程度で、通過にかかる時間は
 * 遅延よりずっと短い前提）。
 */
export const HOVER_POPOVER_CLOSE_DELAY_MS = 200;

export interface UseHoverPopoverResult {
  /** ポップオーバーを表示すべきか。 */
  isOpen: boolean;
  /** マウスが対象要素に入った時に呼ぶ。保留中のクローズタイマーがあれば破棄し、即座に開く。 */
  onMouseEnter: () => void;
  /** マウスが対象要素から出た時に呼ぶ。即座には閉じず、closeDelayMs 後に閉じる。 */
  onMouseLeave: () => void;
  /** キーボードフォーカスが入った時に呼ぶ。カーソルが隙間を通過するわけではないため即座に開く。 */
  onFocus: () => void;
  /** キーボードフォーカスが外れた時に呼ぶ。連続的な移動を経ないため即座に閉じる。 */
  onBlur: () => void;
}

/**
 * ホバー（またはフォーカス）で開閉するポップオーバーの開閉状態を管理する
 * 共通フック（Issue #221）。`InfraNodeCard`/`ContractCard`/`WalletCard`/
 * `GlossaryTerm`/`ActionHint`/tx チップ類など、「対象要素にホバーすると
 * 隙間を挟んだ位置にポップオーバーを出す」という同型の実装が複数箇所に
 * あったため、開閉のタイミング制御だけをここに切り出す（CSS/DOM構造は
 * 各コンポーネント側のまま変更しない）。
 */
export function useHoverPopover(
  closeDelayMs: number = HOVER_POPOVER_CLOSE_DELAY_MS,
): UseHoverPopoverResult {
  const [isOpen, setIsOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const clearPendingClose = useCallback(() => {
    if (closeTimerRef.current !== undefined) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
  }, []);

  const openNow = useCallback(() => {
    clearPendingClose();
    setIsOpen(true);
  }, [clearPendingClose]);

  const closeNow = useCallback(() => {
    clearPendingClose();
    setIsOpen(false);
  }, [clearPendingClose]);

  const closeAfterDelay = useCallback(() => {
    clearPendingClose();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = undefined;
      setIsOpen(false);
    }, closeDelayMs);
  }, [clearPendingClose, closeDelayMs]);

  // アンマウント時に保留中のタイマーを掃除する（unmount 後の setState を防ぐ）。
  useEffect(() => clearPendingClose, [clearPendingClose]);

  return {
    isOpen,
    onMouseEnter: openNow,
    onMouseLeave: closeAfterDelay,
    onFocus: openNow,
    onBlur: closeNow,
  };
}
