import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { NetworkLabel } from "./NetworkLabel.js";
import { groupEdgesByNetwork, type PeerFlowEdge } from "./peerEdge.js";

/**
 * キャンバス右下に常時表示するネットワーク凡例（Issue #124 A）。
 *
 * 「reth 同士の P2P メッシュが時間とともに増えていくのは正常」という前提を
 * 伝えるための3経路のうちの1つ（常時見える場所での一言）。networkId ごとに
 * 色チップ・名前・現在描画中の接続数を1行で示し、最下部に固定のヒント文を
 * 置く（`docs/worklog/issue-124.md` の UX設計）。
 *
 * peer エッジが1本も無いとき（起動直後などノード数が少ない構成）は
 * 何も表示しない。
 */
export function PeerNetworkLegend({ edges }: { edges: PeerFlowEdge[] }) {
  const { t } = useLanguage();

  if (edges.length === 0) return null;

  const groups = groupEdgesByNetwork(edges);

  return (
    <div className="p2p-legend" data-testid="p2p-legend">
      {[...groups.entries()].map(([networkId, group]) => (
        <div className="p2p-legend__row" key={networkId}>
          <NetworkLabel networkId={networkId} />
          <span className="p2p-legend__count" data-testid={`p2p-legend-count-${networkId}`}>
            {group.length}
          </span>
        </div>
      ))}
      <p className="p2p-legend__hint">
        {t("legend.hint.prefix")}
        <GlossaryTerm termKey="discovery">{t("legend.hint.term")}</GlossaryTerm>
        {t("legend.hint.suffix")}
      </p>
    </div>
  );
}
