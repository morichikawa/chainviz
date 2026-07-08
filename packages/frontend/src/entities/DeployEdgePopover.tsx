import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { format } from "../i18n/i18n.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { shortHex } from "./transaction.js";

/**
 * デプロイエッジ（ウォレット → コントラクト）へのホバーで出すポップオーバー
 * の中身（ARCHITECTURE.md §6.3「デプロイエッジ（常設）」。PeerEdgePopover と
 * 同型で、位置決めは呼び出し側の `DeployEdge`（`EdgeLabelRenderer`）が持つ）。
 */
export function DeployEdgePopover({
  deployerAddress,
}: {
  deployerAddress: string;
}) {
  const { t } = useLanguage();

  return (
    <div className="deploy-popover nodrag nopan" role="tooltip">
      <GlossaryTerm termKey="deploy">
        {format(t("edge.deployedBy"), { address: shortHex(deployerAddress) })}
      </GlossaryTerm>
    </div>
  );
}
