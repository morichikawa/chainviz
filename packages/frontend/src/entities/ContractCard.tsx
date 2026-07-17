import { Handle, type NodeProps, Position } from "@xyflow/react";
import { useRef } from "react";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { useHoverPopover } from "../interaction/useHoverPopover.js";
import { PopoverPortal } from "../interaction/PopoverPortal.js";
import { useSidePanel } from "../side-panel/SidePanelContext.js";
import type { ContractActivityChip } from "./contractActivity.js";
import { resolveContractNftLedger } from "./contractNftLedger.js";
import { ContractPopover } from "./ContractPopover.js";
import type { ContractFlowNode } from "./contractNode.js";
import { useRibbonHover } from "./RibbonHoverContext.js";
import { shortHex } from "./transaction.js";

/**
 * 「直近の呼び出し・イベント」チップ1件（ARCHITECTURE.md §6.6）。復号済みなら
 * 関数名/イベント名を、そうでなければ生の識別子の短縮表示を出す。ホバーで
 * 引数一覧（復号済み）または復号不能である旨（GlossaryTerm: abi）を出す。
 */
/**
 * Issue #298 第2段階: このチップのホバーは同時にチェーンリボンの該当タイル
 * （由来 tx の blockHash が確定していれば）を強調させる（逆方向ハイライト。
 * ARCHITECTURE.md §9.1。`WalletCard.tsx` の `TxChip` と同じ仕組み）。
 */
function ActivityChip({ chip }: { chip: ContractActivityChip }) {
  const { t } = useLanguage();
  // Issue #221: 隙間を通過する一瞬の mouseleave で消えないよう遅延クローズ。
  const { isOpen: hovered, onMouseEnter, onMouseLeave } = useHoverPopover();
  const { setHoveredTxHash } = useRibbonHover();
  const hasDetail = chip.decoded ? chip.args.length > 0 : true;
  // Issue #245: 隣接カードの下に隠れないよう body 直下へ portal 描画する。
  // 位置合わせの基準はこのチップ自体（アンカー）。
  const chipRef = useRef<HTMLSpanElement>(null);

  return (
    <span
      ref={chipRef}
      className={[
        "contract-activity-chip",
        `contract-activity-chip--${chip.kind}`,
        chip.decoded ? "" : "contract-activity-chip--undecoded",
      ]
        .filter(Boolean)
        .join(" ")}
      onMouseEnter={() => {
        onMouseEnter();
        setHoveredTxHash(chip.txHash);
      }}
      onMouseLeave={() => {
        onMouseLeave();
        setHoveredTxHash(null);
      }}
      data-testid={`contract-activity-chip-${chip.key}`}
      data-kind={chip.kind}
      data-decoded={chip.decoded}
    >
      {chip.kind === "event" ? "◆ " : ""}
      {chip.label}
      {hovered && hasDetail && (
        <PopoverPortal
          anchorRef={chipRef}
          gapPx={6}
          className="contract-activity-chip__popover"
          role="tooltip"
        >
          {chip.decoded ? (
            chip.args.map((arg, index) => (
              <span
                key={`${chip.key}-arg-${index}-${arg.name}`}
                className="contract-activity-chip__arg"
              >
                {arg.name}: {arg.value}
              </span>
            ))
          ) : (
            <GlossaryTerm termKey="abi">{t("contract.chip.undecoded")}</GlossaryTerm>
          )}
        </PopoverPortal>
      )}
    </span>
  );
}

/**
 * C層拡張のコントラクトカード（ARCHITECTURE.md §6.3/§6.6）。ウォレットカードと
 * 同型の骨格（ヘッダ・名前・サブタイトル）を持つが、チェーン側の状態のため
 * 削除ボタンは置かない（Issue #103 の「削除できないものに削除 UI を出さない」
 * 流儀）。
 *
 * カタログで特定できない（`name` 省略）コントラクトは「未知のコントラクト」
 * として名前を出し、カード枠を破線 + muted 色にして既知カードと区別する
 * （§6.4）。「全ノードで実行」ピルはホバーで EVM の用語解説を出し、確定した
 * 呼び出しが全ノードへ同時にブロック伝播として見えるタイミングの一致（§6.6、
 * Issue #166 で実装）と合わせて「特定ノードではない」ことを伝える。
 *
 * `flashKind` はtx確定の瞬間（呼び出し・デプロイ）に一時的に立つ演出フラグ
 * （§6.6「確定時のコントラクトへのパルス」）。ウォレットの tx チップの
 * `is-settling` と同系の演出で、failed の tx は失敗色のフラッシュにする。
 *
 * NFT コントラクト（`entity.nft` を持つ）は、活動チップ列の下に「発行済み
 * NFT」節を出す（Issue #315。docs/worklog/issue-315.md「フロント表現:
 * エッジは張らない。カード2視点」）。台帳（`entity.nftTokens`）が省略
 * （未観測）ならこの節自体を出さず、空配列なら「まだ発行されていません」を
 * 出す（`resolveContractNftLedger` はこの区別をしないため、判定は
 * `entity.nftTokens !== undefined` で行う）。
 */
export function ContractCard({ data }: NodeProps<ContractFlowNode>) {
  const { entity, activity, isNew, flashKind, walletAddresses } = data;
  const { t } = useLanguage();
  // Issue #321: サイドパネル（コントラクトソースビュー）を開く。
  const { open: openSidePanel } = useSidePanel();
  // Issue #221: 隙間を通過する一瞬の mouseleave で消えないよう遅延クローズ。
  const { isOpen: hovered, onMouseEnter, onMouseLeave } = useHoverPopover();
  // Issue #245: カード本体を ContractPopover の位置合わせの基準にする。
  const cardRef = useRef<HTMLDivElement>(null);
  // Issue #298 第2段階: チェーンリボンのタイルホバーで、そのブロックに
  // 取り込まれた tx の呼び出し先/作成先だった場合に強調する（順方向）。
  const { highlightedAddresses } = useRibbonHover();
  const ribbonHighlighted = highlightedAddresses.has(entity.address.toLowerCase());

  const isUncataloged = entity.name === undefined;
  const name = entity.name ?? t("contract.unknown");
  // Issue #315: 「発行済み NFT」節。省略（未観測）とセクション自体を出さない
  // 判定は、生の nftTokens（undefined か否か）で行う。
  const isNftObserved = entity.nftTokens !== undefined;
  const nftLedger = resolveContractNftLedger(
    entity.nftTokens,
    walletAddresses ?? [],
  );

  const className = [
    "infra-card",
    "infra-card--contract",
    isUncataloged ? "infra-card--contract-unknown" : "",
    isNew ? "infra-card--new" : "",
    flashKind ? `contract-card--settle-${flashKind}` : "",
    ribbonHighlighted ? "infra-card--ribbon-highlight" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={cardRef}
      className={className}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-testid={`contract-card-${entity.address}`}
    >
      {/* デプロイエッジ（ウォレット → コントラクト）の受け口。コントラクトへ
          張られるエッジはこの1種類のみ（§6.3「ノードへのエッジは張らない」）。
          source ハンドルは他のカード（InfraNodeCard/WalletCard）と同様、
          現状使わなくても骨格として持たせておく。 */}
      <Handle
        type="target"
        position={Position.Left}
        className="infra-card__handle"
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="infra-card__handle"
        isConnectable={false}
      />
      <div className="infra-card__header">
        <span className="infra-card__kind">
          <GlossaryTerm termKey="contract">{t("card.contract")}</GlossaryTerm>
        </span>
        <span className="contract-card__badges">
          {isUncataloged && (
            <span
              className="contract-card__badge--uncataloged"
              data-testid={`contract-card-uncataloged-${entity.address}`}
            >
              {t("contract.badge.uncataloged")}
            </span>
          )}
          <span
            className="contract-card__badge--everynode"
            data-testid={`contract-card-everynode-${entity.address}`}
          >
            <GlossaryTerm termKey="evm">{t("contract.badge.everyNode")}</GlossaryTerm>
          </span>
        </span>
      </div>
      <div className="infra-card__name">{name}</div>
      <div className="infra-card__subtitle">
        {shortHex(entity.address)}
        {entity.token && (
          <>
            {" · "}
            <GlossaryTerm termKey="token">{t("field.token")}</GlossaryTerm>{" "}
            {entity.token.symbol}
          </>
        )}
      </div>
      <div
        className="contract-card__activity"
        data-testid={`contract-activity-${entity.address}`}
      >
        <span className="contract-card__activity-label">
          <GlossaryTerm termKey="event-log">{t("contract.activity")}</GlossaryTerm>
        </span>
        <div className="contract-card__activity-chips">
          {activity.length === 0 ? (
            <span className="contract-card__activity-empty">
              {t("contract.noActivity")}
            </span>
          ) : (
            activity.map((chip) => <ActivityChip key={chip.key} chip={chip} />)
          )}
        </div>
      </div>
      {/* Issue #315: NFT コントラクトの「発行済み NFT」節。台帳（省略=未観測）
          はセクション自体を出さない。空配列（観測済みだが未発行）は
          「まだ発行されていません」を出す。新しいエッジは張らない設計
          （docs/worklog/issue-315.md「フロント側」参照）。 */}
      {isNftObserved && (
        <div
          className="contract-card__nft"
          data-testid={`contract-nft-${entity.address}`}
        >
          <span className="contract-card__nft-label">
            <GlossaryTerm termKey="nft">{t("contract.issuedNft")}</GlossaryTerm>
          </span>
          <div className="contract-card__nft-chips">
            {nftLedger.length === 0 ? (
              <span className="contract-card__nft-empty">{t("contract.noNft")}</span>
            ) : (
              nftLedger.map((token) => (
                <span
                  key={token.tokenId}
                  className="contract-nft-chip"
                  data-testid={`contract-nft-chip-${entity.address}-${token.tokenId}`}
                >
                  #{token.tokenId} · {shortHex(token.ownerAddress)}
                </span>
              ))
            )}
          </div>
        </div>
      )}
      {/* Issue #321: コントラクトソースビューを開くボタン。未知のコントラクト
          （sourceCode を持たない）にも出す。押すとパネル側で「なぜ見られない
          か」を明示する（見出しを隠すより学べる方を優先。ARCHITECTURE.md
          §6.4 と同じ方針）。React Flow のドラッグ開始を拾わないよう nodrag
          を付ける（infra-card__remove 等と同じ）。 */}
      <button
        type="button"
        className="contract-card__view-source nodrag"
        onClick={() => openSidePanel({ kind: "contractSource", address: entity.address })}
        data-testid={`contract-view-source-${entity.address}`}
      >
        {t("contract.viewSource")}
      </button>
      {hovered && (
        <ContractPopover
          anchorRef={cardRef}
          entity={entity}
          walletAddresses={walletAddresses}
        />
      )}
    </div>
  );
}
