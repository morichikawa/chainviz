import { COMMS_LOG_CATEGORIES, type CommsLogCategory } from "../comms-log/commsLogEntry.js";
import type { CommsLogFilterState } from "../comms-log/commsLogFilter.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import type { MessageKey } from "../i18n/messages.js";

const CATEGORY_LABEL_KEY: Record<CommsLogCategory, MessageKey> = {
  operation: "commsLog.category.operation",
  internal: "commsLog.category.internal",
  block: "commsLog.category.block",
  tx: "commsLog.category.tx",
  peer: "commsLog.category.peer",
  environment: "commsLog.category.environment",
};

export interface CommsLogNodeOption {
  id: string;
  label: string;
}

export interface CommsLogFilterBarProps {
  filters: CommsLogFilterState;
  onToggleCategory: (category: CommsLogCategory) => void;
  onNodeFilterChange: (nodeId: string | null) => void;
  /** 「ノード」ドロップダウンに出す現存の node/workbench 一覧。 */
  nodeOptions: CommsLogNodeOption[];
}

/**
 * 通信ログパネルのフィルタ（設計メモ §5.4）。表示だけを絞り、蓄積には
 * 影響しない。カテゴリは `LayerFilterBar` と同じ複数選択トグルチップ、
 * ノードは単一選択のドロップダウンにする（設計メモ §5.4）。
 */
export function CommsLogFilterBar({
  filters,
  onToggleCategory,
  onNodeFilterChange,
  nodeOptions,
}: CommsLogFilterBarProps) {
  const { t } = useLanguage();

  return (
    <div className="comms-log-filter-bar" data-testid="comms-log-filter-bar">
      <div className="comms-log-filter-bar__categories">
        <span className="comms-log-filter-bar__label">{t("commsLog.filter.categoryLabel")}</span>
        {COMMS_LOG_CATEGORIES.map((category) => {
          const active = filters.categories[category];
          return (
            <button
              key={category}
              type="button"
              className={
                active
                  ? "comms-log-filter-bar__chip comms-log-filter-bar__chip--active"
                  : "comms-log-filter-bar__chip"
              }
              aria-pressed={active}
              onClick={() => onToggleCategory(category)}
              data-testid={`comms-log-filter-${category}`}
            >
              {t(CATEGORY_LABEL_KEY[category])}
            </button>
          );
        })}
      </div>
      <label className="comms-log-filter-bar__node">
        <span className="comms-log-filter-bar__label">{t("commsLog.filter.nodeLabel")}</span>
        <select
          value={filters.nodeId ?? ""}
          onChange={(event) => onNodeFilterChange(event.target.value === "" ? null : event.target.value)}
          data-testid="comms-log-node-filter"
        >
          <option value="">{t("commsLog.filter.nodeAll")}</option>
          {nodeOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
