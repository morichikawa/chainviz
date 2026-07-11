import type { ContractEntity, TransactionEntity, WalletEntity } from "@chainviz/shared";
import type { RefObject } from "react";
import { useRef } from "react";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { useHoverPopover } from "../interaction/useHoverPopover.js";
import { PopoverPortal } from "../interaction/PopoverPortal.js";
import { shortHex, TX_STATUS_MESSAGE_KEY } from "./transaction.js";
import { deriveTxCallPreview } from "./txCallPreview.js";
import { TxLifecyclePopover } from "./TxLifecyclePopover.js";
import { formatEther } from "./walletNode.js";
import {
  formatTokenContractLabel,
  resolveWalletTokenBalances,
} from "./walletTokenBalances.js";

/**
 * 「呼び出し内容」プレビュー1件（ARCHITECTURE.md §6.6「WalletPopover の tx
 * 一覧に呼び出し内容を追記する」）。関数名＋引数の先頭 1〜2 個のプレビュー
 * ＋宛先コントラクト名（未知なら短縮アドレス）を1行で出す。deploy は
 * `tx.chip.deploy` の訳語をラベル代わりに使う。
 */
function TxCallPreviewLine({
  tx,
  contractsByAddress,
}: {
  tx: TransactionEntity;
  contractsByAddress: ReadonlyMap<string, ContractEntity>;
}) {
  const { t } = useLanguage();
  const preview = deriveTxCallPreview(tx, contractsByAddress);
  if (!preview) return null;

  const targetLabel = preview.contractName ?? shortHex(preview.contractAddress);
  const callLabel =
    preview.kind === "deploy"
      ? t("tx.chip.deploy")
      : `${preview.label}(${preview.argsPreview
          .map((arg) => `${arg.name}: ${shortHex(arg.value)}`)
          .join(", ")})`;

  return (
    <span
      className="wallet-popover__tx-call"
      data-testid={`wallet-tx-call-${tx.hash}`}
    >
      {callLabel} → {targetLabel}
    </span>
  );
}

/**
 * tx 一覧の1行。ホバー/フォーカスで `TxLifecyclePopover`（署名 → 送信 →
 * mempool → ブロック取り込みの4段階）を表示する（ARCHITECTURE.md §6.11、
 * Issue #212 単位D）。WalletCard の tx チップと同じポップオーバーを使う
 * ことで表示内容を一本化する。
 */
function WalletPopoverTxItem({
  tx,
  contractsByAddress,
}: {
  tx: TransactionEntity;
  contractsByAddress: ReadonlyMap<string, ContractEntity>;
}) {
  const { t } = useLanguage();
  // Issue #221: 隙間を通過する一瞬の mouseleave で消えないよう遅延クローズ。
  const { isOpen: hovered, onMouseEnter, onMouseLeave, onFocus, onBlur } =
    useHoverPopover();
  // Issue #245: 隣接カードの下に隠れないよう body 直下へ portal 描画する。
  // 位置合わせの基準はこの行自体（アンカー）。
  const itemRef = useRef<HTMLLIElement>(null);

  return (
    <li
      ref={itemRef}
      className="wallet-popover__tx-item"
      tabIndex={0}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <span className="wallet-popover__tx-hash">{shortHex(tx.hash)}</span>
      <span className={`wallet-tx-chip wallet-tx-chip--${tx.status}`}>
        {t(TX_STATUS_MESSAGE_KEY[tx.status])}
      </span>
      <TxCallPreviewLine tx={tx} contractsByAddress={contractsByAddress} />
      {hovered && <TxLifecyclePopover anchorRef={itemRef} tx={tx} />}
    </li>
  );
}

/**
 * ウォレットカードのホバーで出る詳細ポップオーバー。アドレス全文・残高
 * （wei と Ether）・nonce・所有者・直近 tx の一覧を表示する。tx がコントラクト
 * 呼び出し/デプロイであれば、関数名＋引数プレビュー＋宛先コントラクト名を
 * 追記する（ARCHITECTURE.md §6.6、Issue #166）。
 *
 * 追跡中のトークン残高があれば「トークン残高」行を追記し、コントラクト名
 * （未特定なら「未知のコントラクト」）＋短縮アドレス＋整形済み残高を1件ずつ
 * 列挙する（ARCHITECTURE.md §6.7、Issue #168）。同名のトークンコントラクトが
 * 複数デプロイされていても短縮アドレスで区別できる（Issue #218 派生。
 * `formatTokenContractLabel` 参照）。
 *
 * `anchorRef` はこのポップオーバーを開いたカード本体への ref（Issue #245）。
 * React Flow のノードはそれぞれ独立したスタッキングコンテキストを持つため、
 * `PopoverPortal` でこのカードを基準位置に body 直下へ描画し、隣接カードの
 * 下に隠れないようにする。
 */
export function WalletPopover({
  anchorRef,
  entity,
  transactions,
  contractsByAddress = new Map(),
}: {
  anchorRef: RefObject<HTMLElement | null>;
  entity: WalletEntity;
  transactions: TransactionEntity[];
  contractsByAddress?: ReadonlyMap<string, ContractEntity>;
}) {
  const { t } = useLanguage();
  const tokenBalances = resolveWalletTokenBalances(
    entity.tokenBalances,
    contractsByAddress,
  );

  return (
    <PopoverPortal anchorRef={anchorRef} gapPx={8} className="infra-popover" role="tooltip">
      <div className="infra-field">
        <span className="infra-field__label">{t("field.address")}</span>
        <span className="infra-field__value">{shortHex(entity.address, 10, 6)}</span>
      </div>
      <div className="infra-field">
        <span className="infra-field__label">
          <GlossaryTerm termKey="wei">{t("field.balance")}</GlossaryTerm>
        </span>
        <span className="infra-field__value">
          {formatEther(entity.balance)} ETH
        </span>
      </div>
      <div className="infra-field">
        <span className="infra-field__label">
          <GlossaryTerm termKey="nonce">{t("field.nonce")}</GlossaryTerm>
        </span>
        <span className="infra-field__value">{entity.nonce}</span>
      </div>
      <div className="infra-field">
        <span className="infra-field__label">{t("field.owner")}</span>
        <span className="infra-field__value">
          {entity.ownerWorkbenchId ?? t("wallet.ownerDeleted")}
        </span>
      </div>
      {tokenBalances.length > 0 && (
        <div className="wallet-popover__tokens">
          <span className="infra-field__label">
            <GlossaryTerm termKey="token">{t("field.tokenBalances")}</GlossaryTerm>
          </span>
          <ul className="wallet-popover__token-list">
            {tokenBalances.map((tb) => (
              <li
                key={tb.contractAddress}
                className="wallet-popover__token-item"
                data-testid={`wallet-token-${entity.address}-${tb.contractAddress}`}
              >
                <span className="wallet-popover__token-name">
                  {formatTokenContractLabel(tb, t("contract.unknown"))}
                </span>
                <span className="wallet-popover__token-amount">
                  {tb.formatted} {tb.symbol}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="wallet-popover__tx">
        <span className="infra-field__label">
          <GlossaryTerm termKey="transaction">{t("field.recentTx")}</GlossaryTerm>
        </span>
        {transactions.length === 0 ? (
          <span className="infra-field__value">{t("wallet.noTx")}</span>
        ) : (
          <ul className="wallet-popover__tx-list">
            {transactions.map((tx) => (
              <WalletPopoverTxItem
                key={tx.hash}
                tx={tx}
                contractsByAddress={contractsByAddress}
              />
            ))}
          </ul>
        )}
      </div>
    </PopoverPortal>
  );
}
