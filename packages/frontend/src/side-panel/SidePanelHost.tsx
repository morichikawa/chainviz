import type { ContractEntity } from "@chainviz/shared";
import { useEffect } from "react";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { ContractSourceView } from "./ContractSourceView.js";
import { SidePanel } from "./SidePanel.js";
import { useSidePanel } from "./SidePanelContext.js";

export interface SidePanelHostProps {
  /** address → ContractEntity の索引（App.tsx で既に算出済みのものを使う）。 */
  contractsByAddress: Map<string, ContractEntity>;
}

/**
 * `SidePanelView.kind` ごとに中身コンポーネントを振り分けるディスパッチャ
 * （Issue #321。docs/worklog/issue-321.md §12.2「同時に開けるパネルは1枚」）。
 * `SidePanel`（シェル）自体は kind を一切知らないため、この振り分けは
 * ここに閉じる。Issue #313（用語集パネル）・#317（ノード間通信ログ）は
 * ここに case を足すだけで乗る想定。
 *
 * contractSource: 対象アドレスの `ContractEntity` をここで world state から
 * 引く（保持するのはアドレスのみ。未知→既知への昇格にも自然に追従する。
 * §12.3）。パネルを開いた後にエンティティ自体が world state から消えた
 * 場合（通常は起きない。コントラクトは削除されない設計）は、ダングリング
 * ガードとしてパネルを自動的に閉じる。
 */
export function SidePanelHost({ contractsByAddress }: SidePanelHostProps) {
  const { t } = useLanguage();
  const { view, close } = useSidePanel();
  const contract =
    view?.kind === "contractSource"
      ? contractsByAddress.get(view.address)
      : undefined;
  const dangling = view !== null && contract === undefined;

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

  return null;
}
