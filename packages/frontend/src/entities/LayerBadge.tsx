import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import type { MessageKey } from "../i18n/messages.js";
import type { VisualizationLayer } from "./canvasLayers.js";

const LAYER_BADGE_LABEL_KEY: Record<VisualizationLayer, MessageKey> = {
  a: "layerBadge.a",
  b: "layerBadge.b",
  c: "layerBadge.c",
  d: "layerBadge.d",
};

/**
 * ポップオーバー見出しに添える小さな層バッジ(Issue #299 UX設計 §6-3。
 * `docs/worklog/issue-299.md` 参照)。「要素→層」の対応を個別要素からも
 * 学べるようにする狙いで、`infra-card__badge--bootnode` と同型
 * (pill + `GlossaryTerm`)にする。`visualization-layers` 用語へのアンカーを
 * 兼ねる。
 */
export function LayerBadge({ layer }: { layer: VisualizationLayer }) {
  const { t } = useLanguage();
  return (
    <span
      className={`layer-badge layer-badge--${layer}`}
      data-testid={`layer-badge-${layer}`}
    >
      <GlossaryTerm termKey="visualization-layers">
        {t(LAYER_BADGE_LABEL_KEY[layer])}
      </GlossaryTerm>
    </span>
  );
}
