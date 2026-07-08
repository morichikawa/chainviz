import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { format } from "../i18n/i18n.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { formatInternalCallList } from "./internalLinkActivity.js";
import {
  INTERNAL_LINK_FRESHNESS_MS,
  INTERNAL_LINK_POLL_INTERVAL_MS,
  type InternalLinkActivitySummary,
} from "./internalLinkEdge.js";

/**
 * 最終観測から `INTERNAL_LINK_FRESHNESS_MS` 以内かどうかを判定する（純粋
 * 関数として分離し、テストで固定の `now` を渡せるようにする）。
 * ARCHITECTURE.md §7.6.3「最終観測から10秒を過ぎたら『最近の呼び出しは
 * ありません』に切り替える」。
 */
export function isActivityFresh(
  observedAt: number,
  now: number,
  freshnessMs: number = INTERNAL_LINK_FRESHNESS_MS,
): boolean {
  return now - observedAt <= freshnessMs;
}

/**
 * 内部リンクエッジへのホバーで出すポップオーバーの中身（ARCHITECTURE.md
 * §7.6.3）。位置決め（`EdgeLabelRenderer` での配置）は `InternalLinkEdge` 側が
 * 持ち、ここは中身の描画に専念する（`PeerEdgePopover`/`DeployEdgePopover` と
 * 同じ切り分け）。
 *
 * 鮮度判定はこのコンポーネントが**レンダーされた時点**の `Date.now()` で
 * 評価する。専用のティッカーは設けない（`docs/worklog/issue-188.md` の
 * 設計メモ参照。既存のホバーポップオーバーもライブ更新の仕組みを持たない）。
 */
export function InternalLinkEdgePopover({
  drivingContainerName,
  drivenContainerName,
  lastActivity,
}: {
  drivingContainerName: string;
  drivenContainerName: string;
  lastActivity?: InternalLinkActivitySummary;
}) {
  const { t, lang } = useLanguage();
  const fresh =
    lastActivity !== undefined &&
    isActivityFresh(lastActivity.observedAt, Date.now());

  return (
    <div className="internal-link-popover nodrag nopan" role="tooltip">
      <div className="internal-link-popover__heading">
        <GlossaryTerm termKey="engine-api">{t("edge.internalLink")}</GlossaryTerm>
      </div>
      <div className="internal-link-popover__endpoints">
        {drivingContainerName} → {drivenContainerName}
      </div>
      <div className="internal-link-popover__description">
        {t("internalEdge.pair.prefix")}
        <GlossaryTerm termKey="el-cl-separation">
          {t("internalEdge.pair.term")}
        </GlossaryTerm>
        {t("internalEdge.pair.suffix")}
      </div>
      <div className="internal-link-popover__activity">
        {fresh && lastActivity ? (
          <>
            <div className="internal-link-popover__activity-label">
              {format(t("internalEdge.recentCalls"), {
                seconds: String(Math.round(INTERNAL_LINK_POLL_INTERVAL_MS / 1000)),
              })}
            </div>
            <div className="internal-link-popover__calls">
              {formatInternalCallList(lastActivity.calls, lang, t)}
            </div>
          </>
        ) : (
          <div className="internal-link-popover__no-activity">
            {t("internalEdge.noRecentCalls")}
          </div>
        )}
      </div>
    </div>
  );
}
