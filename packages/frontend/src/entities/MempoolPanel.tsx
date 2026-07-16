import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { format } from "../i18n/i18n.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import type { MempoolNodeEntry, MempoolTxEntry } from "./mempoolList.js";
import { shortHex } from "./transaction.js";

/**
 * mempool（未承認 tx）全体を俯瞰する常設ミニパネル（Issue #330。
 * `docs/ARCHITECTURE.md` §11、`docs/worklog/issue-330.md` 参照）。
 * `ContractListPanel` と同型のキャンバスオーバーレイだが、
 * `ContractListPanel` と異なり **0 件でも常に描画する**（§11.3。空である
 * こと自体が「tx が滞りなく取り込まれている」という意味のある状態のため）。
 *
 * 上段は C層（`TransactionEntity` の pending 集合）、下段は D層
 * （`NodeEntity.internals.mempool` のノード別実数）に対応する（§11.1）。
 * 行クリックで送信元ウォレットへパンする処理自体はこのコンポーネントの外
 * （Canvas.tsx）が持つ（`ContractListPanel` と同じ「onSelect は id を渡す
 * だけの薄いコールバック」の分離）。from に対応するウォレットカードが
 * キャンバス上に存在しない行（`walletCardId === undefined`）はクリック
 * 不可として描画する。
 */
export function MempoolPanel({
  txEntries,
  overflowCount,
  totalPendingCount,
  nodeEntries,
  onSelectTx,
}: {
  /** 表示上限で切り出し済みの行（`limitMempoolTxEntries` の出力）。 */
  txEntries: MempoolTxEntry[];
  /** 上限を超えて省略された件数。 */
  overflowCount: number;
  /** ヘッダーに出す総 pending 件数（`txEntries` の元になった全件数）。 */
  totalPendingCount: number;
  nodeEntries: MempoolNodeEntry[];
  /** クリックされた行の `walletCardId`（= 解決済みのウォレットカード id）を渡す。 */
  onSelectTx: (walletCardId: string) => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="mempool-panel" data-testid="mempool-panel">
      <div className="mempool-panel__header">
        <GlossaryTerm termKey="mempool">{t("mempoolPanel.title")}</GlossaryTerm>
        <span className="mempool-panel__count">{totalPendingCount}</span>
      </div>
      {txEntries.length === 0 ? (
        <p className="mempool-panel__empty">{t("mempoolPanel.empty")}</p>
      ) : (
        <>
          <ul className="mempool-panel__rows">
            {txEntries.map((entry) => (
              <li key={entry.hash}>
                <MempoolTxRow entry={entry} onSelectTx={onSelectTx} />
              </li>
            ))}
          </ul>
          {overflowCount > 0 && (
            <p className="mempool-panel__overflow" data-testid="mempool-overflow">
              {format(t("mempoolPanel.overflow"), { count: String(overflowCount) })}
            </p>
          )}
        </>
      )}
      {nodeEntries.length > 0 && (
        <div className="mempool-panel__nodes">
          <div className="mempool-panel__nodes-title">
            <GlossaryTerm termKey="txpool">{t("mempoolPanel.nodesTitle")}</GlossaryTerm>
          </div>
          <ul className="mempool-panel__node-rows">
            {nodeEntries.map((node) => (
              <li
                key={node.nodeId}
                className="mempool-panel__node-row"
                data-testid={`mempool-node-row-${node.nodeId}`}
              >
                <span className="mempool-panel__node-label">{node.label}</span>
                <span className="mempool-panel__node-counts">
                  {format(t("txpool.value"), {
                    pending: String(node.pending),
                    queued: String(node.queued),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** tx 一覧の行1件（クリック可能なボタン、または非クリックの静的行）。 */
function MempoolTxRow({
  entry,
  onSelectTx,
}: {
  entry: MempoolTxEntry;
  onSelectTx: (walletCardId: string) => void;
}) {
  const { t } = useLanguage();
  const content = (
    <>
      <span className="mempool-panel__hash">{shortHex(entry.hash, 4, 3)}</span>
      <span className="mempool-panel__addr">
        {shortHex(entry.from)}
        {" → "}
        {entry.to !== null ? shortHex(entry.to) : t("tx.chip.deploy")}
      </span>
      {entry.functionName !== undefined && (
        <span className="mempool-panel__fn">{entry.functionName}</span>
      )}
    </>
  );

  if (entry.walletCardId === undefined) {
    return (
      <div
        className="mempool-panel__row mempool-panel__row--static"
        data-testid={`mempool-tx-row-${entry.hash}`}
      >
        {content}
      </div>
    );
  }

  const walletCardId = entry.walletCardId;
  return (
    <button
      type="button"
      className="mempool-panel__row"
      data-testid={`mempool-tx-row-${entry.hash}`}
      title={t("mempoolPanel.jumpHint")}
      onClick={() => onSelectTx(walletCardId)}
    >
      {content}
    </button>
  );
}
