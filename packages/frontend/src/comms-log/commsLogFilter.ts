import { COMMS_LOG_CATEGORIES, type CommsLogCategory, type CommsLogEntry } from "./commsLogEntry.js";

/**
 * 通信ログパネルの表示フィルタ（設計メモ §5.4）。表示だけを絞り、蓄積には
 * 影響しない（`useCommsLog` は常に全カテゴリを蓄積し、ここでの絞り込みは
 * 描画直前に適用する）。
 */
export interface CommsLogFilterState {
  /** カテゴリごとの表示可否。既定は全 on。 */
  categories: Readonly<Record<CommsLogCategory, boolean>>;
  /** 単一選択のノード絞り込み（entity id）。null = 「すべて」。 */
  nodeId: string | null;
}

/** 既定のフィルタ状態（全カテゴリ表示・ノード指定なし）。 */
export function defaultCommsLogFilterState(): CommsLogFilterState {
  const categories = {} as Record<CommsLogCategory, boolean>;
  for (const category of COMMS_LOG_CATEGORIES) categories[category] = true;
  return { categories, nodeId: null };
}

/** 指定カテゴリの表示可否をトグルした新しい状態を返す。 */
export function toggleCommsLogCategory(
  filters: CommsLogFilterState,
  category: CommsLogCategory,
): CommsLogFilterState {
  return {
    ...filters,
    categories: { ...filters.categories, [category]: !filters.categories[category] },
  };
}

/**
 * エントリ列にフィルタを適用する。カテゴリが off、またはノード指定があり
 * `entry.actorIds` にそのノードが含まれない場合は除外する。
 * `actorIds` を持たないカテゴリ（tx・collector接続イベント）は、
 * ノード指定時には常に対象外になる（設計メモ §5.4「from/toのどちらかに
 * 該当するエントリのみ表示」の自然な帰結）。
 */
export function applyCommsLogFilter(
  entries: readonly CommsLogEntry[],
  filters: CommsLogFilterState,
): CommsLogEntry[] {
  return entries.filter((entry) => {
    if (!filters.categories[entry.category]) return false;
    if (filters.nodeId !== null && !entry.actorIds.includes(filters.nodeId)) return false;
    return true;
  });
}
