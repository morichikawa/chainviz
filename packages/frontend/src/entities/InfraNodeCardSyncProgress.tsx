import type { SyncStageProgress } from "@chainviz/shared";
import { describeSyncStage } from "../chain-profiles/ethereum/syncStageLabels.js";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { format, pickLocale } from "../i18n/i18n.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { SyncProgressBar } from "./SyncProgressBar.js";
import { findCurrentSyncStage } from "./syncProgress.js";

/**
 * InfraNodeCard の「バックフィル進行」1行（ARCHITECTURE.md §7.6.5 カード面）。
 * `syncStatus === "syncing"` かつ `internals.syncStages` があるノードにのみ
 * 呼び出し側（InfraNodeCard.tsx）から描画される。`synced` になったら
 * 呼び出し側の条件自体が false になり、この行ごと消える。
 */
export function InfraNodeCardSyncProgress({
  stages,
  targetHeight,
}: {
  stages: readonly SyncStageProgress[];
  targetHeight: number;
}) {
  const { t, lang } = useLanguage();
  const current = findCurrentSyncStage(stages, targetHeight);
  if (!current) return null;

  const label = describeSyncStage(current.stage);
  const stageName = label ? pickLocale(label, lang) : current.stage;
  const text =
    targetHeight > 0
      ? format(t("sync.progress"), {
          stage: stageName,
          checkpoint: String(current.checkpoint),
          target: String(targetHeight),
        })
      : format(t("sync.progressNoTarget"), {
          stage: stageName,
          checkpoint: String(current.checkpoint),
        });

  return (
    <div className="infra-card__sync-progress">
      <div className="infra-card__sync-progress-text">
        <GlossaryTerm termKey="staged-sync">{text}</GlossaryTerm>
      </div>
      {targetHeight > 0 && (
        <SyncProgressBar value={current.checkpoint} max={targetHeight} />
      )}
    </div>
  );
}
