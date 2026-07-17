import type { ContractEntity } from "@chainviz/shared";
import { useEffect } from "react";
import type { LayerFilter } from "../entities/canvasLayers.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { ContractSourceView } from "./ContractSourceView.js";
import { GlossaryPanelView } from "./GlossaryPanelView.js";
import { SidePanel } from "./SidePanel.js";
import { useSidePanel } from "./SidePanelContext.js";

export interface SidePanelHostProps {
  /** address → ContractEntity の索引（Canvas.tsx が rfNodes から算出する）。 */
  contractsByAddress: Map<string, ContractEntity>;
  /**
   * レイヤーレンズの現在の選択状態（Issue #313: 用語集パネルの
   * レイヤーチップの active 表示に使う）。
   */
  layerFilter: LayerFilter;
  /** レイヤーレンズの選択状態を変更する（Issue #313: 用語集パネルの
   * レイヤーチップから `App.tsx` の `setLayerFilter` へ中継する）。 */
  onLayerFilterChange: (layer: LayerFilter) => void;
}

/**
 * `SidePanelView.kind` ごとに中身コンポーネントを振り分けるディスパッチャ
 * （Issue #321。docs/ARCHITECTURE.md §12.2「同時に開けるパネルは1枚」）。
 * `SidePanel`（シェル）自体は kind を一切知らないため、この振り分けは
 * ここに閉じる。Issue #313 で "glossary" を追加した。Issue #317（ノード間
 * 通信ログ）も同じくここに case を足すだけで乗る想定。
 *
 * contractSource: 対象アドレスの `ContractEntity` をここで world state から
 * 引く（保持するのはアドレスのみ。未知→既知への昇格にも自然に追従する。
 * §12.3）。パネルを開いた後にエンティティ自体が world state から消えた
 * 場合（通常は起きない。コントラクトは削除されない設計）は、ダングリング
 * ガードとしてパネルを自動的に閉じる。このガードは contractSource 固有
 * （対象エンティティを world state から引く kind）のものなので、他の kind
 * （glossary は世界状態を参照しない）まで含めて `contract === undefined` で
 * 判定しないよう `view?.kind === "contractSource"` を明示的に含める
 * （含めないと glossary パネルが開いた瞬間に誤ってダングリング扱いされ
 * 自動的に閉じてしまう）。
 *
 * glossary: 対象は glossary データ自体（`GlossaryPanelView` が
 * `useGlossary()` で直接引く）であり world state 由来のエンティティを持た
 * ないため、ダングリングガードの対象外。
 */
export function SidePanelHost({
  contractsByAddress,
  layerFilter,
  onLayerFilterChange,
}: SidePanelHostProps) {
  const { t } = useLanguage();
  const { view, close } = useSidePanel();
  const contract =
    view?.kind === "contractSource"
      ? contractsByAddress.get(view.address)
      : undefined;
  const dangling = view?.kind === "contractSource" && contract === undefined;

  useEffect(() => {
    if (dangling) close();
  }, [dangling, close]);

  if (view === null || dangling) return null;

  if (view.kind === "contractSource" && contract !== undefined) {
    return (
      <SidePanel
        ariaLabel={t("contractSource.title")}
        title={t("contractSource.title")}
        onClose={close}
      >
        <ContractSourceView contract={contract} />
      </SidePanel>
    );
  }

  if (view.kind === "glossary") {
    return (
      <SidePanel
        ariaLabel={t("glossary.panel.title")}
        title={t("glossary.panel.title")}
        onClose={close}
      >
        <GlossaryPanelView
          termKey={view.termKey}
          layerFilter={layerFilter}
          onLayerFilterChange={onLayerFilterChange}
        />
      </SidePanel>
    );
  }

  return null;
}
