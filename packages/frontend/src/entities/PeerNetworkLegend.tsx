import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { useOptionalSidePanel } from "../side-panel/SidePanelContext.js";
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
 *
 * 固定ヒントの2行目に `eclipseAttack`（Eclipse攻撃）への用語アンカーを
 * 添える（ARCHITECTURE.md §17.4、Issue #413。攻撃手法解説の土台）。
 *
 * Issue #416: ヒント文の下に「eclipse攻撃のしくみ」デモの入口ボタンを
 * 追加する（`docs/worklog/issue-416.md` UX設計 §4）。「ノードの接続ピア」
 * という主題がこの凡例と直接対応するため、この砂場の単一の入口として
 * ここに置く（チェーンリボンカード・ノードカード・ピアエッジホバー
 * ポップオーバーへの配置は文脈のズレ等の理由で不採用と判断済み）。
 */
export function PeerNetworkLegend({ edges }: { edges: PeerFlowEdge[] }) {
  const { t } = useLanguage();
  const sidePanel = useOptionalSidePanel();

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
      {/* Issue #413（ARCHITECTURE.md §17.4）: 特定ノードの接続ピアという
          主題がこの凡例と直接対応するため、Eclipse攻撃への用語アンカーを
          2行目のヒントとして添える。 */}
      <p className="p2p-legend__hint p2p-legend__hint--attack" data-testid="p2p-legend-eclipse-hint">
        {t("legend.eclipseHint.prefix")}
        <GlossaryTerm termKey="eclipseAttack">{t("legend.eclipseHint.term")}</GlossaryTerm>
        {t("legend.eclipseHint.suffix")}
      </p>
      <button
        type="button"
        className="p2p-legend__eclipse-demo-open nodrag"
        onClick={() => sidePanel?.open({ kind: "eclipseAttackDemo" })}
        data-testid="p2p-legend-eclipse-demo-open"
      >
        {t("eclipseDemo.open")}
      </button>
    </div>
  );
}
