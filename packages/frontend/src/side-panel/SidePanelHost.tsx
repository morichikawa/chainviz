import type { ContractEntity } from "@chainviz/shared";
import { useEffect } from "react";
import type { CommsLogCategory, CommsLogEntry } from "../comms-log/commsLogEntry.js";
import type { CommsLogFilterState } from "../comms-log/commsLogFilter.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { CommsLogView } from "./CommsLogView.js";
import type { CommsLogNodeOption } from "./CommsLogFilterBar.js";
import { ContractSourceView } from "./ContractSourceView.js";
import { SidePanel } from "./SidePanel.js";
import { useSidePanel } from "./SidePanelContext.js";

export interface SidePanelHostProps {
  /** address → ContractEntity の索引（Canvas.tsx が rfNodes から算出する）。 */
  contractsByAddress: Map<string, ContractEntity>;
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
 * ここに閉じる。Issue #313（用語集パネル）はここに case を足すだけで
 * 乗る想定。
 *
 * contractSource: 対象アドレスの `ContractEntity` をここで world state から
 * 引く（保持するのはアドレスのみ。未知→既知への昇格にも自然に追従する。
 * §12.3）。パネルを開いた後にエンティティ自体が world state から消えた
 * 場合（通常は起きない。コントラクトは削除されない設計）は、ダングリング
 * ガードとしてパネルを自動的に閉じる。
 *
 * commsLog: 対象エンティティを持たない（特定の1件を指すパネルではない）
 * ため、ダングリングガードの対象外（下記 `dangling` は contractSource
 * 限定の判定にしている）。
 */
export function SidePanelHost({
  contractsByAddress,
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
