import type { ContractEntity } from "@chainviz/shared";
import { useEffect } from "react";
import type { CommsLogCategory, CommsLogEntry } from "../comms-log/commsLogEntry.js";
import type { CommsLogFilterState } from "../comms-log/commsLogFilter.js";
import type { LayerFilter } from "../entities/canvasLayers.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { CommsLogView } from "./CommsLogView.js";
import type { CommsLogNodeOption } from "./CommsLogFilterBar.js";
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
  /**
   * 通信ログ（Issue #317）。蓄積・保持窓管理はここでは行わず、App層で常駐
   * する `useCommsLog` から渡された表示用データ・ハンドラをそのまま
   * `CommsLogView` へ渡すだけ（`contractsByAddress` と同じ「表示直前に
   * world state から引く／渡された値をそのまま使う」役割分担）。
   */
  commsLog: {
    /** フィルタ適用後（表示対象）のエントリ。新しい順。 */
    visibleEntries: CommsLogEntry[];
    filters: CommsLogFilterState;
    toggleCategory: (category: CommsLogCategory) => void;
    setNodeFilter: (nodeId: string | null) => void;
  };
  /** 通信ログのノードフィルタ用ドロップダウンに出す、現存の node/workbench 一覧。 */
  commsLogNodeOptions: CommsLogNodeOption[];
}

/**
 * `SidePanelView.kind` ごとに中身コンポーネントを振り分けるディスパッチャ
 * （Issue #321。docs/ARCHITECTURE.md §12.2「同時に開けるパネルは1枚」）。
 * `SidePanel`（シェル）自体は kind を一切知らないため、この振り分けは
 * ここに閉じる。Issue #313 で "glossary" を、Issue #317 で "commsLog" を
 * それぞれここに case を足す形で追加した。
 *
 * contractSource: 対象アドレスの `ContractEntity` をここで world state から
 * 引く（保持するのはアドレスのみ。未知→既知への昇格にも自然に追従する。
 * §12.3）。パネルを開いた後にエンティティ自体が world state から消えた
 * 場合（通常は起きない。コントラクトは削除されない設計）は、ダングリング
 * ガードとしてパネルを自動的に閉じる。このガードは contractSource 固有
 * （対象エンティティを world state から引く kind）のものなので、他の kind
 * まで含めて `contract === undefined` で判定しないよう
 * `view?.kind === "contractSource"` を明示的に含める（含めないと glossary /
 * commsLog パネルが開いた瞬間に誤ってダングリング扱いされ自動的に閉じて
 * しまう）。
 *
 * glossary: 対象は glossary データ自体（`GlossaryPanelView` が
 * `useGlossary()` で直接引く）であり world state 由来のエンティティを持た
 * ないため、ダングリングガードの対象外。
 *
 * commsLog: 対象エンティティを持たない（特定の1件を指すパネルではない）
 * ため、同じくダングリングガードの対象外。
 */
export function SidePanelHost({
  contractsByAddress,
  layerFilter,
  onLayerFilterChange,
  commsLog,
  commsLogNodeOptions,
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

  if (view.kind === "commsLog") {
    return (
      <SidePanel ariaLabel={t("commsLog.title")} title={t("commsLog.title")} onClose={close}>
        <CommsLogView
          entries={commsLog.visibleEntries}
          filters={commsLog.filters}
          onToggleCategory={commsLog.toggleCategory}
          onNodeFilterChange={commsLog.setNodeFilter}
          nodeOptions={commsLogNodeOptions}
        />
      </SidePanel>
    );
  }

  return null;
}
