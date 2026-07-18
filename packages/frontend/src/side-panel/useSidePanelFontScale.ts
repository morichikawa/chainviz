/**
 * サイドパネル本文の文字サイズ倍率の状態管理（Issue #377、
 * docs/worklog/issue-377.md）。`useSidePanelResize` と対になるフックで、
 * こちらはドラッグではなく離散ステップ（A−/A+/リセット）だけを扱う。
 */
import { useCallback, useState } from "react";
import type { KeyValueStorage } from "../platform/storage.js";
import {
  SIDE_PANEL_DEFAULT_FONT_SCALE,
  SIDE_PANEL_FONT_SCALE_STEPS,
  loadSidePanelFontScale,
  saveSidePanelFontScale,
  stepSidePanelFontScale,
} from "./sidePanelFontScale.js";

const MIN_STEP = SIDE_PANEL_FONT_SCALE_STEPS[0];
const MAX_STEP = SIDE_PANEL_FONT_SCALE_STEPS[SIDE_PANEL_FONT_SCALE_STEPS.length - 1];

export interface UseSidePanelFontScaleResult {
  /** 現在の倍率（5段階のいずれか）。 */
  scale: number;
  /** 1段階拡大する（既に最大なら変化しない）。 */
  increase: () => void;
  /** 1段階縮小する（既に最小なら変化しない）。 */
  decrease: () => void;
  /** 既定倍率（1.0）へ戻す。 */
  reset: () => void;
  /** これ以上拡大できるか（ボタンの disabled 判定用）。 */
  canIncrease: boolean;
  /** これ以上縮小できるか（ボタンの disabled 判定用）。 */
  canDecrease: boolean;
}

/**
 * `storage` は呼び出し側（`SidePanel.tsx`）が `useSidePanelResize` と
 * 同じ解決済みストレージを一度だけ渡す想定（このフック自体は既定値
 * 解決を持たない）。
 */
export function useSidePanelFontScale(storage: KeyValueStorage): UseSidePanelFontScaleResult {
  const [scale, setScale] = useState<number>(() => loadSidePanelFontScale(storage));

  const increase = useCallback(() => {
    setScale((current) => {
      const next = stepSidePanelFontScale(current, 1);
      saveSidePanelFontScale(storage, next);
      return next;
    });
  }, [storage]);

  const decrease = useCallback(() => {
    setScale((current) => {
      const next = stepSidePanelFontScale(current, -1);
      saveSidePanelFontScale(storage, next);
      return next;
    });
  }, [storage]);

  const reset = useCallback(() => {
    saveSidePanelFontScale(storage, SIDE_PANEL_DEFAULT_FONT_SCALE);
    setScale(SIDE_PANEL_DEFAULT_FONT_SCALE);
  }, [storage]);

  return {
    scale,
    increase,
    decrease,
    reset,
    canIncrease: scale < MAX_STEP,
    canDecrease: scale > MIN_STEP,
  };
}
