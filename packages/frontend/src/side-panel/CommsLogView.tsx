import type { CommsLogCategory, CommsLogEntry } from "../comms-log/commsLogEntry.js";
import type { CommsLogFilterState } from "../comms-log/commsLogFilter.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { CommsLogEntryRow } from "./CommsLogEntryRow.js";
import { CommsLogFilterBar, type CommsLogNodeOption } from "./CommsLogFilterBar.js";

export interface CommsLogViewProps {
  /** フィルタ適用後（表示対象）のエントリ。新しい順。 */
  entries: CommsLogEntry[];
  filters: CommsLogFilterState;
  onToggleCategory: (category: CommsLogCategory) => void;
  onNodeFilterChange: (nodeId: string | null) => void;
  nodeOptions: CommsLogNodeOption[];
}

/**
 * サイドパネル（kind: "commsLog"）の中身（Issue #317設計メモ §5）。
 *
 * エントリの蓄積・保持窓管理・フィルタの状態は呼び出し側（`useCommsLog`）が
 * 持ち、ここでは渡された表示用データをそのまま並べるだけの表示コンポーネント
 * （`ContractSourceView` と同じ責務分担）。新しいものが上（降順）で並んでいる
 * 前提とし、自動スクロールは行わない（設計メモ §4「先頭 = 最新なので不要」）。
 */
export function CommsLogView({
  entries,
  filters,
  onToggleCategory,
  onNodeFilterChange,
  nodeOptions,
}: CommsLogViewProps) {
  const { t } = useLanguage();

  return (
    <div data-testid="comms-log-view">
      <p className="comms-log-view__description">{t("commsLog.description")}</p>
      <CommsLogFilterBar
        filters={filters}
        onToggleCategory={onToggleCategory}
        onNodeFilterChange={onNodeFilterChange}
        nodeOptions={nodeOptions}
      />
      {entries.length === 0 ? (
        <div className="comms-log-view__empty" data-testid="comms-log-empty">
          <p>{t("commsLog.empty")}</p>
          <p className="comms-log-view__note">{t("commsLog.p2pNote")}</p>
        </div>
      ) : (
        <ul className="comms-log-view__list">
          {entries.map((entry) => (
            <CommsLogEntryRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </div>
  );
}
