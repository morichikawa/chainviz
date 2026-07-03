/**
 * キャンバス上のカード位置を localStorage に永続化する。
 *
 * 重要: 永続化のキーには「安定識別子」を使う。Docker のコンテナ ID は
 * 再起動のたびに変わるため使わない（ARCHITECTURE.md §2 / CONCEPT.md の
 * 「配置の永続化」参照）。ここでは呼び出し側が渡す安定 ID（コンテナ名など）
 * をそのままキーにする。
 */

export interface Position {
  x: number;
  y: number;
}

export type LayoutMap = Record<string, Position>;

/** localStorage の互換 API（テストでは差し替え可能にするため型を切り出す）。 */
export interface LayoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const LAYOUT_STORAGE_KEY = "chainviz.layout.v1";

function isPosition(value: unknown): value is Position {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Position).x === "number" &&
    typeof (value as Position).y === "number" &&
    Number.isFinite((value as Position).x) &&
    Number.isFinite((value as Position).y)
  );
}

/**
 * 保存済みレイアウトを読み込む。未保存・壊れた JSON・想定外の形の場合は
 * 空のマップを返す（例外は投げない）。数値でない座標のエントリは捨てる。
 */
export function loadLayout(storage: LayoutStorage): LayoutMap {
  const raw = storage.getItem(LAYOUT_STORAGE_KEY);
  if (raw === null) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }

  const result: LayoutMap = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (isPosition(value)) {
      result[key] = { x: value.x, y: value.y };
    }
  }
  return result;
}

/**
 * レイアウト全体を保存する。書き込みに失敗した場合（localStorage の
 * 容量超過による QuotaExceededError など）は例外を握りつぶし、ログに
 * 残すだけにする。読み取り側（loadLayout）が壊れた状態でも例外を投げない
 * 防御的設計であるのと対称に、ドラッグ完了時などの保存で例外が呼び出し元へ
 * 伝播しないようにする。
 */
export function saveLayout(storage: LayoutStorage, layout: LayoutMap): void {
  try {
    storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch (error) {
    console.warn("chainviz: failed to persist layout", error);
  }
}

/**
 * 単一の安定 ID の位置を更新して保存する（read-modify-write）。
 * ドラッグ完了時などに呼ぶ。更新後のレイアウト全体を返す。
 */
export function saveNodePosition(
  storage: LayoutStorage,
  stableId: string,
  position: Position,
): LayoutMap {
  const layout = loadLayout(storage);
  layout[stableId] = { x: position.x, y: position.y };
  saveLayout(storage, layout);
  return layout;
}
