import type { BlockEntity, ContractEntity, TransactionEntity } from "@chainviz/shared";
import { useEffect } from "react";
import type { CommsLogCategory, CommsLogEntry } from "../comms-log/commsLogEntry.js";
import type { CommsLogFilterState } from "../comms-log/commsLogFilter.js";
import {
  limitBlockTransactions,
  resolveBlockNavigation,
  selectBlockTransactions,
} from "../entities/blockDetail.js";
import type { LayerFilter } from "../entities/canvasLayers.js";
import { deriveReceivedOrder } from "../entities/chainRibbon.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { HashChainDemoView } from "../crypto-demo/HashChainDemoView.js";
import { SignatureDemoView } from "../crypto-demo/SignatureDemoView.js";
import { BlockDetailView } from "./BlockDetailView.js";
import { CommsLogView } from "./CommsLogView.js";
import type { CommsLogNodeOption } from "./CommsLogFilterBar.js";
import { ContractSourceView } from "./ContractSourceView.js";
import { GlossaryPanelView } from "./GlossaryPanelView.js";
import { SidePanel } from "./SidePanel.js";
import { useSidePanel } from "./SidePanelContext.js";

// SidePanelHostProps の省略可能な blockDetail 関連 props（後述）の既定値。
// モジュールスコープの固定参照にして、props 省略時に毎レンダー新しい
// Map/配列を作らないようにする（`contractsByAddress` 等と違い、これらは
// Canvas.tsx から渡されない単体テスト・ハーネスで頻繁に省略されるため）。
const EMPTY_BLOCKS_BY_HASH: ReadonlyMap<string, BlockEntity> = new Map();
const EMPTY_NODE_LABEL_BY_ID: ReadonlyMap<string, string> = new Map();
const EMPTY_TRANSACTIONS: readonly TransactionEntity[] = [];

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
  /**
   * ブロック詳細パネル（Issue #409。ARCHITECTURE.md §17）が対象ブロック・
   * 前後ナビゲーションを引くための hash → `BlockEntity` の索引。Canvas.tsx が
   * チェーンリボンノード（`type === CHAIN_RIBBON_NODE_TYPE`）の
   * `data.blocks`（保持窓内の全件）から算出する（`contractsByAddress` と
   * 同じ「rfNodes を filter するだけ」の流儀）。省略時は空 Map（パネルは
   * 常にダングリング扱いになり即座に閉じる。Canvas.tsx を経由しない単体
   * テスト・ハーネス向けの既定値）。
   */
  blocksByHash?: ReadonlyMap<string, BlockEntity>;
  /**
   * ブロック詳細パネルの「受信したノード」欄の解決に使う、ノード id →
   * 表示名の索引。チェーンリボンノードの `data.nodeLabelById` と同じもの
   * （`deriveReceivedOrder` の第2引数）。省略時は空 Map。
   */
  blockNodeLabelById?: ReadonlyMap<string, string>;
  /**
   * 現在の最新ブロックの hash（チェーンリボンの最新タイルと同じ値）。
   * ブロック詳細パネルの「次のブロック」ボタンが disabled のとき、
   * 「最新に到達した」か「観測が追い付いていない等」かを出し分けるために
   * 使う（`resolveBlockNavigation` の `isLatest`）。省略時（チェーンリボンが
   * まだ1件もタイルを持たない等）は常に isLatest=false 扱い。
   */
  latestBlockHash?: string;
  /**
   * ブロック詳細パネルの tx 一覧に使う、ワールドステートの全
   * `TransactionEntity`（mempool パネルに渡しているものと同じ生の配列。
   * `selectBlockTransactions` がここで対象ブロックへ絞り込む）。省略時は
   * 空配列（tx 一覧は常に0件表示になる）。
   */
  transactions?: readonly TransactionEntity[];
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
 *
 * hashChainDemo（Issue #401）: 実チェーンから完全に独立した学習用の疑似
 * データ（砂場）を扱い、world state 由来のエンティティを一切持たないため、
 * commsLog / glossary と同じくダングリングガードの対象外。
 *
 * signatureDemo（Issue #402）: hashChainDemo と同じ理由でダングリング
 * ガードの対象外。
 *
 * blockDetail（Issue #409）: 対象 hash の `BlockEntity` を `blocksByHash` から
 * 引く（保持するのは hash のみ。contractSource と同じ「未知→既知の昇格」
 * ではなく「保持窓から外れて消える」向きの遷移だが、同じダングリングガード
 * の仕組みで扱える）。対象ブロックが保持窓から外れて `blocksByHash` から
 * 消えた場合、contractSource と同じ方針でパネルを自動的に閉じる
 * （ARCHITECTURE.md §17.2「ダングリングガード」）。
 */
export function SidePanelHost({
  contractsByAddress,
  layerFilter,
  onLayerFilterChange,
  commsLog,
  commsLogNodeOptions,
  blocksByHash = EMPTY_BLOCKS_BY_HASH,
  blockNodeLabelById = EMPTY_NODE_LABEL_BY_ID,
  latestBlockHash,
  transactions = EMPTY_TRANSACTIONS,
}: SidePanelHostProps) {
  const { t } = useLanguage();
  const { view, open, close } = useSidePanel();
  const contract =
    view?.kind === "contractSource"
      ? contractsByAddress.get(view.address)
      : undefined;
  const block = view?.kind === "blockDetail" ? blocksByHash.get(view.hash) : undefined;
  const dangling =
    (view?.kind === "contractSource" && contract === undefined) ||
    (view?.kind === "blockDetail" && block === undefined);

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

  if (view.kind === "hashChainDemo") {
    return (
      <SidePanel ariaLabel={t("hashDemo.title")} title={t("hashDemo.title")} onClose={close}>
        <HashChainDemoView />
      </SidePanel>
    );
  }

  if (view.kind === "signatureDemo") {
    return (
      <SidePanel ariaLabel={t("sigDemo.title")} title={t("sigDemo.title")} onClose={close}>
        <SignatureDemoView />
      </SidePanel>
    );
  }

  if (view.kind === "blockDetail" && block !== undefined) {
    const navigation = resolveBlockNavigation(block, blocksByHash, latestBlockHash);
    const blockTransactions = selectBlockTransactions(block.hash, transactions);
    const { visible: visibleTransactions, overflowCount } =
      limitBlockTransactions(blockTransactions);
    return (
      <SidePanel
        ariaLabel={t("blockDetail.title")}
        title={t("blockDetail.title")}
        onClose={close}
      >
        <BlockDetailView
          block={block}
          navigation={navigation}
          receivedOrder={deriveReceivedOrder(block, blockNodeLabelById)}
          visibleTransactions={visibleTransactions}
          totalTxCount={blockTransactions.length}
          overflowCount={overflowCount}
          contractsByAddress={contractsByAddress}
          onNavigate={(hash) => open({ kind: "blockDetail", hash })}
        />
      </SidePanel>
    );
  }

  return null;
}
