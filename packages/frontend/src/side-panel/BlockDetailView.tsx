import type { BlockEntity, ContractEntity, TransactionEntity } from "@chainviz/shared";
import type { ReactNode } from "react";
import type { BlockNavigation } from "../entities/blockDetail.js";
import { formatBlockTimestamp, type ReceivedOrderEntry } from "../entities/chainRibbon.js";
import { shortHex, TX_STATUS_MESSAGE_KEY } from "../entities/transaction.js";
import { deriveTxCallPreview } from "../entities/txCallPreview.js";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { format } from "../i18n/i18n.js";
import { useLanguage } from "../i18n/LanguageProvider.js";

export interface BlockDetailViewProps {
  block: BlockEntity;
  /** 前後ナビゲーションの導出結果（`resolveBlockNavigation` の出力）。 */
  navigation: BlockNavigation;
  /** 受信ノード一覧（`deriveReceivedOrder` の出力。チェーンリボンポップオーバーと同じ関数）。 */
  receivedOrder: ReceivedOrderEntry[];
  /** 表示上限で切り出し済みの tx 行（`limitBlockTransactions` の出力）。 */
  visibleTransactions: TransactionEntity[];
  /** 実際の取り込み済み tx 総件数（切り出し前。`selectBlockTransactions` の出力件数）。 */
  totalTxCount: number;
  /** 上限を超えて省略された tx 件数。 */
  overflowCount: number;
  /** tx の呼び出し内容プレビュー（`deriveTxCallPreview`）が宛先コントラクト名を解決するための索引。 */
  contractsByAddress: ReadonlyMap<string, ContractEntity>;
  /** 前後ブロック・親hashフィールドから、指定 hash のブロックへ表示を切り替える。 */
  onNavigate: (hash: string) => void;
}

/** ラベル・値の1行（`ChainRibbonPopover` の同名ヘルパーと同じ見た目。1ファイル1責務のため小さく複製）。 */
function Field({ label, value }: { label: ReactNode; value: string }) {
  return (
    <div className="infra-field">
      <span className="infra-field__label">{label}</span>
      <span className="infra-field__value">{value}</span>
    </div>
  );
}

/**
 * tx 一覧の1行（ARCHITECTURE.md §17.4「情報粒度は `WalletPopoverTxItem` に
 * 揃える」）。ホバーでのライフサイクルポップオーバーは持たない（ブロック
 * 詳細パネルは特定ウォレットに紐付かない一覧のため、`WalletPopoverTxItem`
 * とは違い対象ウォレットの観点での nonce 限定表示等は行わない）。呼び出し
 * 内容プレビューは `WalletPopover.tsx` の `TxCallPreviewLine` と同じ
 * `deriveTxCallPreview` を再利用する。
 */
function BlockDetailTxRow({
  tx,
  contractsByAddress,
}: {
  tx: TransactionEntity;
  contractsByAddress: ReadonlyMap<string, ContractEntity>;
}) {
  const { t } = useLanguage();
  const preview = deriveTxCallPreview(tx, contractsByAddress);

  return (
    <div className="block-detail-view__tx-row" data-testid={`block-detail-tx-${tx.hash}`}>
      <span className="block-detail-view__tx-hash">{shortHex(tx.hash)}</span>
      {tx.nonce !== undefined && (
        <span
          className="block-detail-view__tx-nonce"
          data-testid={`block-detail-tx-nonce-${tx.hash}`}
        >
          {t("field.nonce")} {tx.nonce}
        </span>
      )}
      <span className="block-detail-view__tx-addr">
        {shortHex(tx.from)}
        {" → "}
        {tx.to !== null ? shortHex(tx.to) : t("tx.chip.deploy")}
      </span>
      <span className={`wallet-tx-chip wallet-tx-chip--${tx.status}`}>
        {t(TX_STATUS_MESSAGE_KEY[tx.status])}
      </span>
      {preview && (
        <span className="block-detail-view__tx-call" data-testid={`block-detail-tx-call-${tx.hash}`}>
          {preview.kind === "deploy"
            ? t("tx.chip.deploy")
            : `${preview.label}(${preview.argsPreview
                .map((arg) => `${arg.name}: ${shortHex(arg.value)}`)
                .join(", ")})`}
          {" → "}
          {preview.contractName ?? shortHex(preview.contractAddress)}
        </span>
      )}
    </div>
  );
}

/**
 * サイドパネル（kind: "blockDetail"）の中身（Issue #409。
 * docs/ARCHITECTURE.md §17.4「パネルの中身」）。対象ブロックのフル hash・
 * 親 hash・タイムスタンプ・受信ノード全件・取り込み済み tx 全件を表示し、
 * 「前のブロック」「次のブロック」ボタンで親子関係をたどって保持窓内を
 * 前後に移動できる。
 *
 * ダングリングガード（対象 hash のエンティティが world state から消えた
 * 場合にパネルを閉じる処理）は呼び出し側の `SidePanelHost` が担う。この
 * コンポーネント自体は渡された `block` をそのまま表示するだけの純粋な表示
 * コンポーネント（`ContractSourceView` と同じ役割分担）。
 */
export function BlockDetailView({
  block,
  navigation,
  receivedOrder,
  visibleTransactions,
  totalTxCount,
  overflowCount,
  contractsByAddress,
  onNavigate,
}: BlockDetailViewProps) {
  const { t } = useLanguage();
  const { parent, child, isLatest } = navigation;

  return (
    <div data-testid="block-detail-view">
      <div className="block-detail-view__header">
        <span className="block-detail-view__number">#{block.number}</span>
        <span className="block-detail-view__hash">{shortHex(block.hash)}</span>
      </div>

      <Field
        label={<GlossaryTerm termKey="hash">{t("chainRibbon.popover.hash")}</GlossaryTerm>}
        value={block.hash}
      />

      {parent !== undefined ? (
        <button
          type="button"
          className="block-detail-view__parent-link infra-field nodrag"
          onClick={() => onNavigate(parent.hash)}
          data-testid={`block-detail-parent-link-${block.hash}`}
        >
          <span className="infra-field__label">
            <GlossaryTerm termKey="hash">{t("chainRibbon.popover.parent")}</GlossaryTerm>
          </span>
          <span className="infra-field__value">{block.parentHash}</span>
        </button>
      ) : (
        <Field
          label={<GlossaryTerm termKey="hash">{t("chainRibbon.popover.parent")}</GlossaryTerm>}
          value={block.parentHash}
        />
      )}

      <Field label={t("chainRibbon.popover.time")} value={formatBlockTimestamp(block.timestamp)} />

      <div className="block-detail-view__received">
        <span className="block-detail-view__received-label">
          <GlossaryTerm termKey="gossip">{t("chainRibbon.popover.receivedBy")}</GlossaryTerm>
        </span>
        {receivedOrder.length === 0 ? (
          <span className="block-detail-view__received-empty">
            {t("chainRibbon.popover.receivedByEmpty")}
          </span>
        ) : (
          <ul className="block-detail-view__received-list">
            {receivedOrder.map((entry) => (
              <li key={entry.nodeId} className="block-detail-view__received-item">
                <span className="block-detail-view__received-node">{entry.label}</span>
                <span className="block-detail-view__received-offset">
                  {format(t("chainRibbon.popover.receivedByOffset"), {
                    ms: String(entry.offsetMs),
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="block-detail-view__tx-section">
        <div className="block-detail-view__tx-heading">
          <GlossaryTerm termKey="transaction">{t("chainRibbon.popover.includedTx")}</GlossaryTerm>
          <span className="block-detail-view__tx-count">{totalTxCount}</span>
        </div>
        {totalTxCount === 0 ? (
          <p className="block-detail-view__tx-empty">
            {t("chainRibbon.popover.includedTxEmpty")}
          </p>
        ) : (
          <>
            <ul className="block-detail-view__tx-rows">
              {visibleTransactions.map((tx) => (
                <li key={tx.hash}>
                  <BlockDetailTxRow tx={tx} contractsByAddress={contractsByAddress} />
                </li>
              ))}
            </ul>
            {overflowCount > 0 && (
              <p
                className="block-detail-view__tx-overflow"
                data-testid="block-detail-tx-overflow"
              >
                {format(t("mempoolPanel.overflow"), { count: String(overflowCount) })}
              </p>
            )}
          </>
        )}
      </div>

      <div className="block-detail-view__nav">
        <button
          type="button"
          className="block-detail-view__nav-button"
          data-testid={`block-detail-prev-${block.hash}`}
          disabled={parent === undefined}
          onClick={() => {
            if (parent !== undefined) onNavigate(parent.hash);
          }}
        >
          {t("blockDetail.prev")}
        </button>
        <button
          type="button"
          className="block-detail-view__nav-button"
          data-testid={`block-detail-next-${block.hash}`}
          disabled={child === undefined}
          onClick={() => {
            if (child !== undefined) onNavigate(child.hash);
          }}
        >
          {t("blockDetail.next")}
        </button>
      </div>
      {parent === undefined && (
        <p className="block-detail-view__nav-reason" data-testid="block-detail-prev-reason">
          {t("blockDetail.prev.unavailable")}
        </p>
      )}
      {child === undefined && (
        <p className="block-detail-view__nav-reason" data-testid="block-detail-next-reason">
          {isLatest ? t("blockDetail.next.latest") : t("blockDetail.next.unavailable")}
        </p>
      )}
    </div>
  );
}
