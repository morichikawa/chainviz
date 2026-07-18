/**
 * サイドパネル（Issue #321 の汎用サイドパネル機構、docs/ARCHITECTURE.md
 * §12.2）の幅の永続化・クランプ（Issue #362）。
 *
 * 幅は kind（contractSource / glossary / commsLog）によらず共通の1値で、
 * `layout/layoutStore.ts`（安定ID→座標のマップ）とはスキーマが異なる
 * スカラー設定値なので、独立したこのモジュールに置く。保存形式は
 * `i18n/i18n.ts` の `saveLanguage`（生の文字列を1件だけ保存）と同じ
 * スカラー方式にする。
 */
import type { KeyValueStorage } from "../platform/storage.js";

export const SIDE_PANEL_WIDTH_STORAGE_KEY = "chainviz.sidePanel.width.v1";

/** 既定幅（従来の CSS 固定幅 `420px` と同値。見た目の非互換を作らない）。 */
export const SIDE_PANEL_DEFAULT_WIDTH = 420;

/**
 * 最小幅。ヘッダー（タイトル・閉じるボタン）と commsLog のフィルタバーが
 * 操作可能なまま保てる下限として設定した設計定数（docs/worklog/issue-362.md）。
 */
export const SIDE_PANEL_MIN_WIDTH = 300;

/** 最大幅はビューポート幅に対する比率で決める（固定 px にしない）。 */
const SIDE_PANEL_MAX_WIDTH_RATIO = 0.9;

/**
 * 現在のビューポート幅から最大幅を導く。`viewportWidth * 0.9` が
 * `SIDE_PANEL_MIN_WIDTH` を下回るような極端に狭いビューポートでも、
 * 最大値が最小値を下回らないよう下限を保証する
 * （`clampSidePanelWidth` の `min`/`max` が矛盾したレンジにならないため）。
 */
export function sidePanelMaxWidth(viewportWidth: number): number {
  return Math.max(SIDE_PANEL_MIN_WIDTH, viewportWidth * SIDE_PANEL_MAX_WIDTH_RATIO);
}

/** 幅を [最小幅, 最大幅] の範囲に収める。 */
export function clampSidePanelWidth(width: number, viewportWidth: number): number {
  const max = sidePanelMaxWidth(viewportWidth);
  return Math.min(Math.max(width, SIDE_PANEL_MIN_WIDTH), max);
}

/**
 * 保存済みの幅を読み込む。未保存・非数値・想定外の値は既定幅にフォール
 * バックする。読み込んだ値・既定値のいずれも現在のビューポート幅で
 * クランプしてから返す（保存後にウィンドウが縮小された場合に対応する）。
 */
export function loadSidePanelWidth(
  storage: KeyValueStorage,
  viewportWidth: number,
): number {
  const raw = storage.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY);
  const parsed = raw === null ? Number.NaN : Number(raw);
  const width = Number.isFinite(parsed) ? parsed : SIDE_PANEL_DEFAULT_WIDTH;
  return clampSidePanelWidth(width, viewportWidth);
}

/**
 * 幅を保存する。書き込みに失敗した場合（localStorage の容量超過による
 * QuotaExceededError など）は例外を握りつぶし、ログに残すだけにする
 * （`layout/layoutStore.ts` の `saveLayout` と同じ防御的パターン。
 * ドラッグ完了時の保存失敗が操作そのものを壊さないようにするため）。
 */
export function saveSidePanelWidth(storage: KeyValueStorage, width: number): void {
  try {
    storage.setItem(SIDE_PANEL_WIDTH_STORAGE_KEY, String(width));
  } catch (error) {
    console.warn("chainviz: failed to persist side panel width", error);
  }
}
