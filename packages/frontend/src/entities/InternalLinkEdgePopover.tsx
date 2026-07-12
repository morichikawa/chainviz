import { describeInternalLinkKind } from "../chain-profiles/ethereum/internalLinkKinds.js";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { format } from "../i18n/i18n.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { formatInternalCallList } from "./internalLinkActivity.js";
import { LayerBadge } from "./LayerBadge.js";
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
 * §7.6.3/§7.6.11）。位置決め（`EdgeLabelRenderer` での配置）は
 * `InternalLinkEdge` 側が持ち、ここは中身の描画に専念する
 * （`PeerEdgePopover`/`DeployEdgePopover` と同じ切り分け）。
 *
 * 見出し・説明文・「直近の呼び出し」セクションの表示可否は、端点の
 * `nodeRole` の組を `describeInternalLinkKind` に渡して得る記述子で切り替える
 * （Issue #285。consensus→execution = 既存の Engine API 表現、
 * validator→consensus = Beacon API 表現（活動セクション無し）、それ以外・
 * role 不明はアンカー無しの汎用表現）。
 *
 * 鮮度判定はこのコンポーネントが**レンダーされた時点**の `Date.now()` で
 * 評価する。専用のティッカーは設けない（`docs/worklog/issue-188.md` の
 * 設計メモ参照。既存のホバーポップオーバーもライブ更新の仕組みを持たない）。
 */
export function InternalLinkEdgePopover({
  drivingContainerName,
  drivenContainerName,
  drivingNodeRole,
  drivenNodeRole,
  lastActivity,
}: {
  drivingContainerName: string;
  drivenContainerName: string;
  drivingNodeRole?: string;
  drivenNodeRole?: string;
  lastActivity?: InternalLinkActivitySummary;
}) {
  const { t, lang } = useLanguage();
  const kind = describeInternalLinkKind(drivingNodeRole, drivenNodeRole);
  const fresh =
    kind.showsActivity &&
    lastActivity !== undefined &&
    isActivityFresh(lastActivity.observedAt, Date.now());

  return (
    <div className="internal-link-popover nodrag nopan" role="tooltip">
      <div className="internal-link-popover__heading">
        <span>
          {kind.headingGlossaryKey ? (
            <GlossaryTerm termKey={kind.headingGlossaryKey}>
              {t(kind.headingKey)}
            </GlossaryTerm>
          ) : (
            t(kind.headingKey)
          )}
        </span>
        <LayerBadge layer="d" />
      </div>
      <div className="internal-link-popover__endpoints">
        {drivingContainerName} → {drivenContainerName}
      </div>
      <div className="internal-link-popover__description">
        {kind.description.kind === "segmented" ? (
          <>
            {t(kind.description.prefixKey)}
            <GlossaryTerm termKey={kind.description.termGlossaryKey}>
              {t(kind.description.termKey)}
            </GlossaryTerm>
            {t(kind.description.suffixKey)}
          </>
        ) : (
          t(kind.description.textKey)
        )}
      </div>
      {kind.showsActivity && (
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
      )}
    </div>
  );
}
