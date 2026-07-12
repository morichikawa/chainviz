import type { LayerFilter, VisualizationLayer } from "../entities/canvasLayers.js";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import type { MessageKey } from "../i18n/messages.js";
import { ActionHint } from "./ActionHint.js";

const LAYER_LABEL_KEY: Record<VisualizationLayer, MessageKey> = {
  a: "layerFilter.a",
  b: "layerFilter.b",
  c: "layerFilter.c",
  d: "layerFilter.d",
};

const LAYER_HINT_KEY: Record<VisualizationLayer, MessageKey> = {
  a: "layerFilter.hint.a",
  b: "layerFilter.hint.b",
  c: "layerFilter.hint.c",
  d: "layerFilter.hint.d",
};

export interface LayerFilterBarProps {
  /** 現在選択中のレイヤー("all" が既定・絞り込み無し)。 */
  value: LayerFilter;
  onChange: (value: LayerFilter) => void;
  /** チップとして表示する層の一覧（現在のチェーンプロファイルに存在する層）。 */
  layers: readonly VisualizationLayer[];
}

/**
 * 「レイヤーレンズ」の選択チップバー(Issue #299。UX設計は
 * `docs/worklog/issue-299.md` §3.1)。キャンバス操作ツールバー
 * (`CanvasToolbar`)の直下に置く単一選択(排他)のチップバーで、選ぶとその層
 * 以外の要素が薄くなる。「すべて」が既定で、リロードで必ずここへ戻る
 * (選択状態は永続化しない)。
 *
 * 同じチップをもう一度押すか「すべて」を押すと解除される(UX設計 §3.1 手順3)。
 * 各チップはホバー/フォーカスで「この層は何か」+「選ぶと何が起きるか」を
 * 説明する予告ツールチップ(`ActionHint`。既存の追加ボタンと同じ流儀)を持つ。
 */
export function LayerFilterBar({ value, onChange, layers }: LayerFilterBarProps) {
  const { t } = useLanguage();

  return (
    <div className="layer-filter-bar" data-testid="layer-filter-bar">
      <span className="layer-filter-bar__label">
        <GlossaryTerm termKey="visualization-layers">
          {t("layerFilter.label")}
        </GlossaryTerm>
      </span>
      <ActionHint hint={t("layerFilter.hint.all")}>
        <button
          type="button"
          className={
            value === "all"
              ? "layer-filter-bar__chip layer-filter-bar__chip--active"
              : "layer-filter-bar__chip"
          }
          aria-pressed={value === "all"}
          onClick={() => onChange("all")}
          data-testid="layer-filter-chip-all"
        >
          {t("layerFilter.all")}
        </button>
      </ActionHint>
      {layers.map((layer) => (
        <ActionHint key={layer} hint={t(LAYER_HINT_KEY[layer])}>
          <button
            type="button"
            className={
              value === layer
                ? "layer-filter-bar__chip layer-filter-bar__chip--active"
                : "layer-filter-bar__chip"
            }
            aria-pressed={value === layer}
            onClick={() => onChange(value === layer ? "all" : layer)}
            data-testid={`layer-filter-chip-${layer}`}
          >
            {t(LAYER_LABEL_KEY[layer])}
          </button>
        </ActionHint>
      ))}
    </div>
  );
}
