import type { SyncStageProgress } from "@chainviz/shared";
import { describeSyncStage } from "../chain-profiles/ethereum/syncStageLabels.js";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { pickLocale } from "../i18n/i18n.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { SyncProgressBar } from "./SyncProgressBar.js";

/**
 * InfraPopover の「同期ステージ」セクション（ARCHITECTURE.md §7.6.5）。
 * `syncStages` の配列順（クライアントが公開するステージ順）で全件を1行ずつ
 * 出し、各行にミニプログレスバーを添える。`targetHeight` が0（全 EL
 * ノードの blockHeight が不明）のときはバーを出さず checkpoint の数値のみ
 * にする。呼び出し側（InfraPopover.tsx）は `syncStages` が無い/空のときは
 * このコンポーネント自体を呼ばない。
 */
export function InfraPopoverSyncStages({
  stages,
  targetHeight,
}: {
  stages: readonly SyncStageProgress[];
  targetHeight: number;
}) {
  const { t, lang } = useLanguage();

  return (
    <div className="infra-popover__sync-stages">
      <div className="infra-field__label infra-popover__sync-stages-heading">
        <GlossaryTerm termKey="staged-sync">{t("field.syncStages")}</GlossaryTerm>
      </div>
      <ul className="infra-popover__sync-stage-list">
        {stages.map((stage) => {
          const label = describeSyncStage(stage.stage);
          const displayName = label ? pickLocale(label, lang) : stage.stage;
          return (
            <li key={stage.stage} className="infra-popover__sync-stage-row">
              <div className="infra-popover__sync-stage-line">
                <span>{displayName}</span>
                <span className="infra-field__value">{stage.checkpoint}</span>
              </div>
              {targetHeight > 0 && (
                <SyncProgressBar value={stage.checkpoint} max={targetHeight} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
