/**
 * サイドパネル（`SidePanel.tsx`）本文の文字サイズ倍率の永続化・ステップ
 * 送り（Issue #377、docs/worklog/issue-377.md）。
 *
 * 幅（`sidePanelWidth.ts`）と同じ「kind（contractSource / glossary /
 * commsLog）によらず共通のスカラー1値」の UI 設定なので、`layout/
 * layoutStore.ts`（安定ID→座標のマップ）には載せず、独立したこの
 * モジュールに置く。保存パターンも `sidePanelWidth.ts` に揃える。
 */
import type { KeyValueStorage } from "../platform/storage.js";

export const SIDE_PANEL_FONT_SCALE_STORAGE_KEY = "chainviz.sidePanel.fontScale.v1";

/** 選べる倍率の5段階（表示は 85% / 100% / 115% / 130% / 150%）。 */
export const SIDE_PANEL_FONT_SCALE_STEPS = [0.85, 1, 1.15, 1.3, 1.5] as const;

export const SIDE_PANEL_DEFAULT_FONT_SCALE = 1;

/**
 * 与えられた値に最も近い刻みのインデックスを返す。厳密な同距離（タイ）の
 * 場合は strict `<` 比較のため、先に見つかった（配列の若い= より小さい）
 * 刻みを採用する。ただし十進の中点が IEEE754 で厳密なタイになるかは値に
 * よる（例: 1.075 は |1-1.075| === |1.15-1.075| で真のタイ、1.4 はタイに
 * ならず 1.3 が僅かに近い）。詳細は sidePanelFontScale.test.ts を参照。
 */
function nearestFontScaleStepIndex(value: number): number {
  let bestIndex = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  SIDE_PANEL_FONT_SCALE_STEPS.forEach((step, index) => {
    const diff = Math.abs(step - value);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = index;
    }
  });
  return bestIndex;
}

/**
 * 現在値に最も近い刻みから、`direction`（+1 で拡大・-1 で縮小）だけ
 * 隣の刻みへ動かした値を返す。配列の端では同じインデックスに留まり、
 * 現在値をそのまま返す（呼び出し側でボタンを disabled にする判定は
 * `canIncrease`/`canDecrease` 側で別途行う）。
 */
export function stepSidePanelFontScale(current: number, direction: 1 | -1): number {
  const currentIndex = nearestFontScaleStepIndex(current);
  const nextIndex = Math.min(
    SIDE_PANEL_FONT_SCALE_STEPS.length - 1,
    Math.max(0, currentIndex + direction),
  );
  return SIDE_PANEL_FONT_SCALE_STEPS[nextIndex];
}

/**
 * 保存済みの倍率を読み込む。未保存・非数値・非有限は既定倍率
 * （1.0）にフォールバックする。刻み以外の有限値（手動改変等）は
 * 最も近い刻みへスナップする（`loadSidePanelWidth` と同じ防御的パターン）。
 */
export function loadSidePanelFontScale(storage: KeyValueStorage): number {
  const raw = storage.getItem(SIDE_PANEL_FONT_SCALE_STORAGE_KEY);
  const parsed = raw === null ? Number.NaN : Number(raw);
  if (!Number.isFinite(parsed)) return SIDE_PANEL_DEFAULT_FONT_SCALE;
  return SIDE_PANEL_FONT_SCALE_STEPS[nearestFontScaleStepIndex(parsed)];
}

/**
 * 倍率を保存する。書き込みに失敗した場合（localStorage の容量超過による
 * QuotaExceededError など）は例外を握りつぶし、ログに残すだけにする
 * （`saveSidePanelWidth` と同じ防御的パターン。ボタン押下という操作
 * そのものが保存失敗で壊れないようにするため）。
 */
export function saveSidePanelFontScale(storage: KeyValueStorage, scale: number): void {
  try {
    storage.setItem(SIDE_PANEL_FONT_SCALE_STORAGE_KEY, String(scale));
  } catch (error) {
    console.warn("chainviz: failed to persist side panel font scale", error);
  }
}
