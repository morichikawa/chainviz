import type { ReactNode, RefObject } from "react";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { format } from "../i18n/i18n.js";
import { PopoverPortal } from "../interaction/PopoverPortal.js";
import type { ChainRibbonTile, ReceivedOrderEntry } from "./chainRibbon.js";
import { formatBlockTimestamp } from "./chainRibbon.js";
import { shortHex } from "./transaction.js";

function Field({ label, value }: { label: ReactNode; value: string }) {
  return (
    <div className="infra-field">
      <span className="infra-field__label">{label}</span>
      <span className="infra-field__value">{value}</span>
    </div>
  );
}

/**
 * タイルホバーのポップオーバー本体（docs/worklog/issue-298.md §4.4、
 * ARCHITECTURE.md §9.3）。
 *
 * 「親ブロック」行だけはホバーで直前タイルを強調する特別扱いを持つ
 * （用語集が文章で教えている「parentHash の連なりがチェーンそのもの」を
 * 実物で確認できる、この機能の学習上の要。UX設計 §4.4）。強調対象は
 * `onParentHover` 経由で `ChainRibbonCard` 側の state を動かすだけで、この
 * コンポーネント自体はどのタイルが強調されているかを持たない。
 *
 * `anchorRef` はこのポップオーバーを開いたタイルへの ref（Issue #245 の
 * 既存ポップオーバー群と同じ、body 直下への portal 描画のための基準位置）。
 */
export function ChainRibbonPopover({
  anchorRef,
  tile,
  txCount,
  receivedOrder,
  onParentHover,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  tile: ChainRibbonTile;
  txCount: number | undefined;
  receivedOrder: ReceivedOrderEntry[];
  onParentHover: (parentHash: string | null) => void;
}) {
  const { t } = useLanguage();
  const { block } = tile;

  return (
    <PopoverPortal
      anchorRef={anchorRef}
      gapPx={8}
      className="infra-popover chain-ribbon-popover"
      role="tooltip"
      data-testid={`chain-ribbon-popover-${block.hash}`}
    >
      <Field
        label={<GlossaryTerm termKey="block">{t("chainRibbon.popover.number")}</GlossaryTerm>}
        value={`#${block.number}`}
      />
      <Field label={t("chainRibbon.popover.hash")} value={block.hash} />
      <div
        className="infra-field chain-ribbon-popover__parent"
        onMouseEnter={() => onParentHover(block.parentHash)}
        onMouseLeave={() => onParentHover(null)}
        data-testid={`chain-ribbon-popover-parent-${block.hash}`}
      >
        <span className="infra-field__label">{t("chainRibbon.popover.parent")}</span>
        <span className="infra-field__value">{shortHex(block.parentHash)}</span>
      </div>
      <Field
        label={t("chainRibbon.popover.time")}
        value={formatBlockTimestamp(block.timestamp)}
      />
      <div className="infra-field">
        <span className="infra-field__label">
          <GlossaryTerm termKey="transaction">
            {t("chainRibbon.popover.includedTx")}
          </GlossaryTerm>
        </span>
        <span className="infra-field__value">
          {txCount && txCount > 0 ? txCount : t("chainRibbon.popover.includedTxEmpty")}
        </span>
      </div>
      <div className="chain-ribbon-popover__received">
        <span className="chain-ribbon-popover__received-label">
          <GlossaryTerm termKey="gossip">{t("chainRibbon.popover.receivedBy")}</GlossaryTerm>
        </span>
        {receivedOrder.length === 0 ? (
          <span className="chain-ribbon-popover__received-empty">
            {t("chainRibbon.popover.receivedByEmpty")}
          </span>
        ) : (
          <ul className="chain-ribbon-popover__received-list">
            {receivedOrder.map((entry) => (
              <li key={entry.nodeId} className="chain-ribbon-popover__received-item">
                <span className="chain-ribbon-popover__received-node">{entry.label}</span>
                <span className="chain-ribbon-popover__received-offset">
                  {format(t("chainRibbon.popover.receivedByOffset"), {
                    ms: String(entry.offsetMs),
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PopoverPortal>
  );
}
