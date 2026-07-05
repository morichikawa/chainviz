import { Handle, type NodeProps, Position } from "@xyflow/react";
import { useState } from "react";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { shortHex } from "./transaction.js";
import { formatEther, type WalletFlowNode } from "./walletNode.js";
import { WalletPopover } from "./WalletPopover.js";

/**
 * C層のウォレット（EOA / スマートアカウント）を表すキャンバス上のカード。
 * アドレス・残高・nonce と直近 tx チップを出し、ホバーで詳細ポップオーバーを
 * 表示する。tx チップは pending 中は明滅し、pending → 確定へ変わった瞬間に
 * 確定フラッシュ演出を当てる（Issue #81 の tx ライフサイクル表示）。
 */
export function WalletCard({ data }: NodeProps<WalletFlowNode>) {
  const { entity, transactions, settlingHashes, ownerPresent } = data;
  const { t } = useLanguage();
  const [hovered, setHovered] = useState(false);

  const kindTermKey = entity.isSmartAccount ? "smart-account" : "eoa";
  const kindLabel = entity.isSmartAccount
    ? t("wallet.smartAccount")
    : t("wallet.eoa");
  const settling = new Set(settlingHashes);
  const pendingCount = transactions.filter(
    (tx) => tx.status === "pending",
  ).length;

  return (
    <div
      className="infra-card infra-card--wallet"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
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
              <span
                key={tx.hash}
                className={`wallet-tx-chip wallet-tx-chip--${tx.status}${
                  settling.has(tx.hash) ? " is-settling" : ""
                }`}
                title={shortHex(tx.hash)}
                data-testid={`wallet-tx-chip-${tx.hash}`}
                data-status={tx.status}
              >
                {shortHex(tx.hash, 4, 3)}
              </span>
            ))
          )}
        </div>
      </div>
      {hovered && (
        <WalletPopover entity={entity} transactions={transactions} />
      )}
    </div>
  );
}
