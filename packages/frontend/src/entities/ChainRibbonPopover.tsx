import type { ReactNode, RefObject } from "react";
import { useEffect, useRef } from "react";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { format } from "../i18n/i18n.js";
import { PopoverPortal } from "../interaction/PopoverPortal.js";
import { useOptionalSidePanel } from "../side-panel/SidePanelContext.js";
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
 * `onParentHover` の第2引数（`sourceHash`）は「このポップオーバー自身の
 * タイルの hash」を渡す。`ChainRibbonCard` 側はこれを使って、このタイル
 * 自身が同時に逆方向ハイライト（`isReverseHighlighted`）で光るのを
 * 一時的に抑え、強調対象が「親タイルのみ」になるようにする（QA差し戻し
 * 対応。docs/worklog/issue-351.md 参照。行をホバーしていない間・他タイル
 * が逆方向ハイライトされる場合には影響しない）。
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
  onParentHover: (parentHash: string | null, sourceHash: string) => void;
}) {
  const { t } = useLanguage();
  const sidePanel = useOptionalSidePanel();
  const { block } = tile;
  // Issue #351: 「親ブロック」行がホバーされたまま、行自身の mouseleave が
  // 一度も発火せずにこのポップオーバーが unmount されると
  // （`ChainRibbonCard` 側の `parentHighlightHash`）が解除されず、直前
  // タイルの強調枠が固着したまま残る。行のホバー中かどうかをここで追跡し、
  // unmount 時にホバー中のままなら確実に解除する（強調の寿命はこの
  // ポップオーバーの寿命を超えない、という不変条件を保証する）。
  const parentRowHoveredRef = useRef(false);

  useEffect(() => {
    return () => {
      if (parentRowHoveredRef.current) {
        parentRowHoveredRef.current = false;
        onParentHover(null, block.hash);
      }
    };
  }, [onParentHover, block.hash]);

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
      <Field
        label={<GlossaryTerm termKey="hash">{t("chainRibbon.popover.hash")}</GlossaryTerm>}
        value={block.hash}
      />
      <div
        className="infra-field chain-ribbon-popover__parent"
        onMouseEnter={() => {
          parentRowHoveredRef.current = true;
          onParentHover(block.parentHash, block.hash);
        }}
        onMouseLeave={() => {
          parentRowHoveredRef.current = false;
          onParentHover(null, block.hash);
        }}
        data-testid={`chain-ribbon-popover-parent-${block.hash}`}
        // e2e/テスト専用の完全な親hash露出（`data-connected-to-previous`等と
        // 同じ用途）。表示テキストは shortHex で切り詰めており、実チェーンの
        // 本物のhashでは逆引きできないため（Issue #351 QA差し戻し対応）。
        data-parent-hash={block.parentHash}
      >
        <span className="infra-field__label">
          <GlossaryTerm termKey="hash">{t("chainRibbon.popover.parent")}</GlossaryTerm>
        </span>
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
      {/* Issue #409: このブロックの詳細パネル（フル hash・受信ノード全件・
          取り込み tx 全件 + 前後ナビゲーション）を開く文脈導線。既存の
          「ハッシュのしくみを試す」ボタン（Issue #401）と同型のパターン
          （ポップオーバー内ボタン。タイル本体には新規クリックトリガーを
          足さない。ARCHITECTURE.md §17.2）。 */}
      <button
        type="button"
        className="chain-ribbon-popover__block-detail-open nodrag"
        onClick={(event) => {
          event.stopPropagation();
          sidePanel?.open({ kind: "blockDetail", hash: block.hash });
        }}
        data-testid={`chain-ribbon-popover-block-detail-open-${block.hash}`}
      >
        {t("blockDetail.open")}
      </button>
      {/* Issue #401: ポップオーバー内の文脈導線(常設入口はカード側の
          subtitle 行に別途ある)。ホバー中クリック可能なため、ここから直接
          砂場デモへ飛べる。 */}
      <button
        type="button"
        className="chain-ribbon-popover__hash-demo-open nodrag"
        onClick={(event) => {
          event.stopPropagation();
          sidePanel?.open({ kind: "hashChainDemo" });
        }}
        data-testid={`chain-ribbon-popover-hash-demo-open-${block.hash}`}
      >
        {t("hashDemo.open")}
      </button>
    </PopoverPortal>
  );
}
