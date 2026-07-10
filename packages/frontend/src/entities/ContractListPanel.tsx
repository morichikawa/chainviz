import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { format } from "../i18n/i18n.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import type { ContractListEntry } from "./contractList.js";
import { shortHex } from "./transaction.js";

/**
 * デプロイ済み・デプロイ中のコントラクトをキャンバス左下に常設一覧表示する
 * パネル（Issue #218「デプロイ済みのスマートコントラクト一覧」+ #211
 * 「デプロイ結果がどこにあるか」の導線。`docs/worklog/issue-211.md`
 * 「単位C」参照）。`PeerNetworkLegend`（右下・B層）と対になる常設ミニ
 * パネルで、キャンバス上のカードを探して回る負担への直接の答えになる。
 *
 * 行クリックで該当カードへキャンバスをパンする処理自体はこのコンポーネント
 * の外（Canvas.tsx）が持つ（`onSelect` はノード id を渡すだけの薄い
 * コールバック）。1件も無ければ何も表示しない（初期画面を汚さない。
 * ウォレット0件時の流儀と同じ）。
 */
export function ContractListPanel({
  entries,
  onSelect,
}: {
  entries: ContractListEntry[];
  onSelect: (nodeId: string) => void;
}) {
  const { t } = useLanguage();

  if (entries.length === 0) return null;

  return (
    <div className="contract-list-panel" data-testid="contract-list-panel">
      <div className="contract-list-panel__header">
        <GlossaryTerm termKey="contract">{t("contractList.title")}</GlossaryTerm>
        <span className="contract-list-panel__count">{entries.length}</span>
      </div>
      <ul className="contract-list-panel__rows">
        {entries.map((entry) => (
          <li key={entry.nodeId}>
            <button
              type="button"
              className="contract-list-panel__row"
              data-testid={`contract-list-row-${entry.nodeId}`}
              title={t("contractList.jumpHint")}
              onClick={() => onSelect(entry.nodeId)}
            >
              {entry.status === "deploying" ? (
                <span className="contract-list-panel__deploying">
                  <span className="ghost-card__spinner" aria-hidden="true" />
                  {format(t("contractList.deploying"), { name: entry.name ?? "" })}
                </span>
              ) : (
                <span className="contract-list-panel__deployed">
                  <span className="contract-list-panel__name">
                    {entry.name ?? t("contract.unknown")}
                  </span>
                  <span className="contract-list-panel__address">
                    {shortHex(entry.address ?? "")}
                  </span>
                  {entry.tokenSymbol !== undefined && (
                    <span className="contract-list-panel__token">
                      {" · "}
                      {entry.tokenSymbol}
                    </span>
                  )}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
