import type { TransactionEntity, WalletEntity } from "@chainviz/shared";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import type { MessageKey } from "../i18n/messages.js";
import { formatEther } from "./walletNode.js";
import { shortHex } from "./transaction.js";

const TX_STATUS_KEY: Record<TransactionEntity["status"], MessageKey> = {
  pending: "tx.status.pending",
  included: "tx.status.included",
  failed: "tx.status.failed",
};

/**
 * ウォレットカードのホバーで出る詳細ポップオーバー。アドレス全文・残高
 * （wei と Ether）・nonce・所有者・直近 tx の一覧を表示する。
 */
export function WalletPopover({
  entity,
  transactions,
}: {
  entity: WalletEntity;
  transactions: TransactionEntity[];
}) {
  const { t } = useLanguage();

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
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
