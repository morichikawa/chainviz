import type { TransactionEntity } from "@chainviz/shared";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { useRef } from "react";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { useHoverPopover } from "../interaction/useHoverPopover.js";
import { useRibbonHover } from "./RibbonHoverContext.js";
import { shortHex, txChipLabel } from "./transaction.js";
import { TxLifecyclePopover } from "./TxLifecyclePopover.js";
import { formatNftChipLabel, resolveWalletNftHoldings } from "./walletNftHoldings.js";
import {
  formatTokenContractLabel,
  resolveWalletTokenBalances,
} from "./walletTokenBalances.js";
import { formatEther, type WalletFlowNode } from "./walletNode.js";
import { WalletPopover } from "./WalletPopover.js";

/**
 * tx チップ1件。ホバー/フォーカスで `TxLifecyclePopover`（署名 → 送信 →
 * mempool → ブロック取り込みの4段階）を表示する（ARCHITECTURE.md §6.11、
 * Issue #212 単位D）。以前あった `title` 属性（hash のみのネイティブ
 * ツールチップ）はこのポップオーバーに置き換わったため無い。
 *
 * Issue #298 第2段階: このチップのホバーは同時にチェーンリボンの該当タイル
 * （tx.blockHash が確定していれば）を強調させる（`RibbonHoverContext`
 * 経由の逆方向ハイライト。ARCHITECTURE.md §9.1）。
 */
function TxChip({ tx, isSettling }: { tx: TransactionEntity; isSettling: boolean }) {
  const { t } = useLanguage();
  // Issue #221: 隙間を通過する一瞬の mouseleave で消えないよう遅延クローズ。
  const { isOpen: hovered, onMouseEnter, onMouseLeave, onFocus, onBlur } =
    useHoverPopover();
  const { setHoveredTxHash } = useRibbonHover();
  const label = txChipLabel(tx);
  const text = label.kind === "deploy" ? t("tx.chip.deploy") : label.text;
  // Issue #245: 隣接カードの下に隠れないよう body 直下へ portal 描画する。
  // 位置合わせの基準はこのチップ自体（アンカー）。
  const chipRef = useRef<HTMLSpanElement>(null);

  return (
    <span
      ref={chipRef}
      className={`wallet-tx-chip wallet-tx-chip--${tx.status}${
        isSettling ? " is-settling" : ""
      }`}
      tabIndex={0}
      data-testid={`wallet-tx-chip-${tx.hash}`}
      data-status={tx.status}
      data-label-kind={label.kind}
      // Issue #388: tx がどのブロックに含まれたかを e2e から直接特定できる
      // よう、完全な blockHash を露出する（pending 中は undefined なので
      // React は属性自体を出さない）。`data-parent-hash`（Issue #351）・
      // `data-connected-to-previous`（Issue #298）と同じ「表示テキストからは
      // 逆引きできない完全な hash をテスト専用に露出する」既存の流儀。
      data-block-hash={tx.blockHash}
      onMouseEnter={() => {
        onMouseEnter();
        setHoveredTxHash(tx.hash);
      }}
      onMouseLeave={() => {
        onMouseLeave();
        setHoveredTxHash(null);
      }}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {text}
      {hovered && <TxLifecyclePopover anchorRef={chipRef} tx={tx} />}
    </span>
  );
}

/**
 * C層のウォレット（EOA / スマートアカウント）を表すキャンバス上のカード。
 * アドレス・残高・nonce と直近 tx チップを出し、ホバーで詳細ポップオーバーを
 * 表示する。tx チップは pending 中は明滅し、pending → 確定へ変わった瞬間に
 * 確定フラッシュ演出を当てる（Issue #81 の tx ライフサイクル表示）。
 *
 * tx チップのラベルは hash 短縮ではなく「意味」優先で出す（ARCHITECTURE.md
 * §6.6。優先順位は `txChipLabel` 参照。Issue #166）。tx hash 自体はホバー/
 * フォーカスで開く `TxLifecyclePopover`（ARCHITECTURE.md §6.11、Issue #212）
 * のヘッダに表示する（`TxChip` 参照。以前の title 属性は置き換わった）。
 *
 * 残高行の下には、追跡中のトークン残高チップ列を出す（ARCHITECTURE.md
 * §6.7、Issue #168）。対応する `ContractEntity` の token 情報と突き合わせて
 * 「{amount} {symbol}」形式に整形し、突き合わせ不能な分やトークン残高が
 * 1件もない場合はセクションごと表示しない（`resolveWalletTokenBalances`
 * 参照）。
 *
 * トークン残高の下には、保有 NFT チップ列を出す（Issue #315）。台帳は
 * コントラクト側（`ContractEntity.nftTokens`）に持つ設計のため、
 * `data.contractsByAddress` の全コントラクトから `resolveWalletNftHoldings`
 * で導出する。1件も無ければセクション自体を出さない（トークン残高と同じ
 * 「情報が無ければ出さない」流儀。所有関係を表す新しいエッジは張らない
 * 設計。docs/worklog/issue-315.md 参照）。
 */
export function WalletCard({ data }: NodeProps<WalletFlowNode>) {
  const {
    entity,
    transactions,
    popoverTransactions,
    settlingHashes,
    ownerPresent,
    contractsByAddress,
  } = data;
  const { t } = useLanguage();
  // Issue #221: 隙間を通過する一瞬の mouseleave で消えないよう遅延クローズ。
  const { isOpen: hovered, onMouseEnter, onMouseLeave } = useHoverPopover();
  // Issue #245: カード本体を WalletPopover の位置合わせの基準にする。
  const cardRef = useRef<HTMLDivElement>(null);
  // Issue #298 第2段階: チェーンリボンのタイルホバーで、そのブロックに
  // 取り込まれた tx の送信元/宛先だった場合に強調する（順方向ハイライト）。
  const { highlightedAddresses } = useRibbonHover();
  const ribbonHighlighted = highlightedAddresses.has(entity.address.toLowerCase());

  const kindTermKey = entity.isSmartAccount ? "smart-account" : "eoa";
  const kindLabel = entity.isSmartAccount
    ? t("wallet.smartAccount")
    : t("wallet.eoa");
  const settling = new Set(settlingHashes);
  const pendingCount = transactions.filter(
    (tx) => tx.status === "pending",
  ).length;
  // トークン残高チップ列（ARCHITECTURE.md §6.7、Issue #168）。対応する
  // ContractEntity が未観測/token情報なしの分は除外済み(ダングリングガード)。
  const tokenBalances = resolveWalletTokenBalances(
    entity.tokenBalances,
    contractsByAddress,
  );
  // 保有 NFT チップ列（Issue #315）。台帳はコントラクト側にあるため、
  // 全コントラクトの nftTokens から address 照合で導出する。
  const nftHoldings = resolveWalletNftHoldings(
    entity.address,
    contractsByAddress.values(),
  );

  return (
    <div
      ref={cardRef}
      className={`infra-card infra-card--wallet${
        ribbonHighlighted ? " infra-card--ribbon-highlight" : ""
      }`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-testid={`wallet-card-${entity.address}`}
    >
      {/* 所有エッジ（ワークベンチ → ウォレット）の受け口。ウォレットは
          エッジの target なので target ハンドルを持つ。見た目は CSS で隠す。 */}
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
          <GlossaryTerm termKey={kindTermKey}>{kindLabel}</GlossaryTerm>
        </span>
        {!ownerPresent && (
          <span
            className="wallet-card__orphan"
            title={t("wallet.ownerDeleted")}
            data-testid={`wallet-orphan-${entity.address}`}
          >
            {t("wallet.ownerDeleted")}
          </span>
        )}
      </div>
      <div className="infra-card__name">{shortHex(entity.address)}</div>
      <div className="infra-card__subtitle">
        {formatEther(entity.balance)} ETH ·{" "}
        <GlossaryTerm termKey="nonce">{t("field.nonce")}</GlossaryTerm>{" "}
        {entity.nonce}
      </div>
      {tokenBalances.length > 0 && (
        <div
          className="wallet-card__tokens"
          data-testid={`wallet-tokens-${entity.address}`}
        >
          <span className="wallet-card__tokens-label">
            <GlossaryTerm termKey="token">{t("field.tokenBalances")}</GlossaryTerm>
          </span>
          <div className="wallet-card__token-chips">
            {tokenBalances.map((tb) => (
              <span
                key={tb.contractAddress}
                className="wallet-token-chip"
                title={formatTokenContractLabel(tb, t("contract.unknown"))}
                data-testid={`wallet-token-chip-${entity.address}-${tb.contractAddress}`}
              >
                {tb.formatted} {tb.symbol}
              </span>
            ))}
          </div>
        </div>
      )}
      {nftHoldings.length > 0 && (
        <div
          className="wallet-card__nft"
          data-testid={`wallet-nft-${entity.address}`}
        >
          <span className="wallet-card__nft-label">
            <GlossaryTerm termKey="nft">{t("field.nftHoldings")}</GlossaryTerm>
          </span>
          <div className="wallet-card__nft-chips">
            {nftHoldings.map((holding) => (
              <span
                key={`${holding.contractAddress}-${holding.tokenId}`}
                className="wallet-nft-chip"
                title={formatTokenContractLabel(
                  { contractAddress: holding.contractAddress, contractName: holding.contractName },
                  t("contract.unknown"),
                )}
                data-testid={`wallet-nft-chip-${entity.address}-${holding.contractAddress}-${holding.tokenId}`}
              >
                {formatNftChipLabel(holding)}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="wallet-card__tx" data-testid={`wallet-tx-${entity.address}`}>
        <span className="wallet-card__tx-label">
          <GlossaryTerm termKey="mempool">{t("field.recentTx")}</GlossaryTerm>
          {pendingCount > 0 ? ` · ${pendingCount} pending` : ""}
        </span>
        <div className="wallet-card__tx-chips">
          {transactions.length === 0 ? (
            <span className="wallet-card__tx-empty">{t("wallet.noTx")}</span>
          ) : (
            transactions.map((tx) => (
              <TxChip key={tx.hash} tx={tx} isSettling={settling.has(tx.hash)} />
            ))
          )}
        </div>
      </div>
      {hovered && (
        <WalletPopover
          anchorRef={cardRef}
          entity={entity}
          transactions={popoverTransactions}
          contractsByAddress={contractsByAddress}
        />
      )}
    </div>
  );
}
