import type { ContractEntity, TransactionEntity, WalletEntity } from "@chainviz/shared";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import type { MessageKey } from "../i18n/messages.js";
import { formatEther } from "./walletNode.js";
import { shortHex } from "./transaction.js";
import { deriveTxCallPreview } from "./txCallPreview.js";
import { resolveWalletTokenBalances } from "./walletTokenBalances.js";

const TX_STATUS_KEY: Record<TransactionEntity["status"], MessageKey> = {
  pending: "tx.status.pending",
  included: "tx.status.included",
  failed: "tx.status.failed",
};

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
 * ウォレットカードのホバーで出る詳細ポップオーバー。アドレス全文・残高
 * （wei と Ether）・nonce・所有者・直近 tx の一覧を表示する。tx がコントラクト
 * 呼び出し/デプロイであれば、関数名＋引数プレビュー＋宛先コントラクト名を
 * 追記する（ARCHITECTURE.md §6.6、Issue #166）。
 *
 * 追跡中のトークン残高があれば「トークン残高」行を追記し、コントラクト名
 * （未特定なら symbol）＋整形済み残高を1件ずつ列挙する（ARCHITECTURE.md
 * §6.7、Issue #168）。
 */
export function WalletPopover({
  entity,
  transactions,
  contractsByAddress = new Map(),
}: {
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
    <div className="infra-popover" role="tooltip">
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
                  {tb.contractName ?? tb.symbol}
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
              <li key={tx.hash} className="wallet-popover__tx-item">
                <span className="wallet-popover__tx-hash">
                  {shortHex(tx.hash)}
                </span>
                <span className={`wallet-tx-chip wallet-tx-chip--${tx.status}`}>
                  {t(TX_STATUS_KEY[tx.status])}
                </span>
                <TxCallPreviewLine tx={tx} contractsByAddress={contractsByAddress} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
