import type { NodeProps } from "@xyflow/react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { format } from "../i18n/i18n.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { useHoverPopover } from "../interaction/useHoverPopover.js";
import { ChainRibbonPopover } from "./ChainRibbonPopover.js";
import { type ChainRibbonTile, deriveReceivedOrder } from "./chainRibbon.js";
import type { ChainRibbonFlowNode } from "./chainRibbonNode.js";
import { useBlockCadence } from "./useBlockCadence.js";
import { useRibbonHover } from "./RibbonHoverContext.js";
import { shortHex } from "./transaction.js";
import { useFrozenRibbonTiles } from "./useFrozenRibbonTiles.js";

/**
 * タイル1件。着地アニメーション（`chain-ribbon-tile--landing`）・親ブロック
 * ホバー強調（`isParentHighlighted`）・tx チップ等からの逆方向ホバー強調
 * （`RibbonHoverContext` の `hoveredBlockHash`）の3種類の見た目状態を持つ
 * （docs/worklog/issue-298.md §4.3/§4.4、ARCHITECTURE.md §9.1）。
 *
 * ポップオーバー（`ChainRibbonPopover`）はタイル div の**内側の子**として
 * 描画する（`WalletCard`/`ContractCard`/`InfraNodeCard` 等の既存パターンと
 * 同じ配置。Issue #351）。`PopoverPortal` は `document.body` 直下へ実際の
 * DOM を portal するが、React はイベントの合成をこの JSX 上の親子関係
 * （React ツリー）で行うため、こう並べることでポップオーバーへのホバーが
 * タイルへのホバーの延長として扱われる。以前は Fragment で兄弟として
 * 描いており、この恩恵を受けられず離脱直後に閉じてしまっていた
 * （docs/worklog/issue-351.md 参照）。
 */
function ChainRibbonTileView({
  tile,
  txCount,
  nodeLabelById,
  isLanding,
  isParentHighlighted,
  onParentHover,
  onPopoverOpenChange,
}: {
  tile: ChainRibbonTile;
  txCount: number | undefined;
  nodeLabelById: ReadonlyMap<string, string>;
  isLanding: boolean;
  isParentHighlighted: boolean;
  onParentHover: (parentHash: string | null) => void;
  onPopoverOpenChange: (blockHash: string, isOpen: boolean) => void;
}) {
  const { t } = useLanguage();
  // Issue #221: 隙間を通過する一瞬の mouseleave で消えないよう遅延クローズ。
  const { isOpen: hovered, onMouseEnter, onMouseLeave } = useHoverPopover();
  const { hoveredBlockHash, setHoveredBlockHash } = useRibbonHover();
  const tileRef = useRef<HTMLDivElement>(null);
  const { block, connectedToPrevious } = tile;

  // 順方向（このタイルを直接ホバー）・逆方向（tx/活動チップのホバーから
  // このブロックの hash が立った）のどちらでも同じ強調を出す。
  const isReverseHighlighted = hoveredBlockHash === block.hash;

  // Issue #351: 表示窓の凍結条件（下記 ChainRibbonCard）に、
  // `hoveredBlockHash` だけでなくこのタイルのポップオーバー開閉状態も
  // 反映させる。`hoveredBlockHash` はタイル div の mouseleave で即座に
  // null へ戻る一方、ポップオーバー自体は 200ms の猶予でまだ開いている
  // ことがあり（隙間通過中）、その間も表示窓を凍結し続ける必要がある。
  useEffect(() => {
    onPopoverOpenChange(block.hash, hovered);
    return () => onPopoverOpenChange(block.hash, false);
  }, [hovered, block.hash, onPopoverOpenChange]);

  return (
    <div
      ref={tileRef}
      className={[
        "chain-ribbon-tile",
        isLanding ? "chain-ribbon-tile--landing" : "",
        isParentHighlighted || isReverseHighlighted
          ? "chain-ribbon-tile--highlight"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onMouseEnter={() => {
        onMouseEnter();
        setHoveredBlockHash(block.hash);
      }}
      onMouseLeave={() => {
        onMouseLeave();
        setHoveredBlockHash(null);
      }}
      data-testid={`chain-ribbon-tile-${block.hash}`}
      data-connected-to-previous={connectedToPrevious}
    >
      <span className="chain-ribbon-tile__number">#{block.number}</span>
      <span className="chain-ribbon-tile__hash">{shortHex(block.hash, 4, 3)}</span>
      {txCount !== undefined && txCount > 0 && (
        <span
          className="chain-ribbon-tile__tx-badge"
          data-testid={`chain-ribbon-tile-tx-${block.hash}`}
        >
          {format(t("chainRibbon.txBadge"), { count: String(txCount) })}
        </span>
      )}
      {hovered && (
        <ChainRibbonPopover
          anchorRef={tileRef}
          tile={tile}
          txCount={txCount}
          receivedOrder={deriveReceivedOrder(block, nodeLabelById)}
          onParentHover={onParentHover}
        />
      )}
    </div>
  );
}

/**
 * チェーンリボン（Issue #298）。チェーン全体で常設1本のキャンバス内カードで、
 * 直近タイル列を横一列（左が古い・右が最新）に並べる。コントラクトカードと
 * 同じく特定のノードに従属しない実体のため、B/C 層のエッジのように他カードへ
 * つなぐ Handle は持たない（このカードへ/から張られるエッジは無い設計。
 * ARCHITECTURE.md §9.1）。
 *
 * 「親ブロック」行ホバーでの直前タイル強調（`parentHighlightHash`）は、この
 * カード内で完結する局所的な state（複数タイルにまたがる相互作用のため）。
 * ウォレット/コントラクトカードとの相互ハイライト（第2段階。tx/活動チップ
 * ⇔ タイル）は `RibbonHoverContext` 経由の `hoveredBlockHash` を使う。
 *
 * QA差し戻し対応（docs/worklog/issue-298.md）: ホバー中
 * （`hoveredBlockHash !== null`）は `useFrozenRibbonTiles` で表示窓の前進を
 * 一時停止する。実チェーン環境では2秒程度のブロック生成間隔で表示窓
 * （直近8タイル）が前進し続けるため、他カードのチップホバーで一瞬点灯した
 * ハイライトが、窓外へ流出したタイルとともに即座に失われ二度と復帰しない
 * 不具合が実機検証で確認されたための対策。
 *
 * Issue #351: 上記に加え、いずれかのタイルのポップオーバーが開いている間
 * （`openPopoverHashes`）も凍結条件に含める。タイル → 隙間 → ポップオーバー
 * の移動中、`hoveredBlockHash` はタイル div の mouseleave で即座に null に
 * 戻る一方、ポップオーバー自体は `useHoverPopover` の 200ms 猶予でまだ
 * 開いていることがあり、その間に凍結が外れると表示窓が前進してしまう
 * （issue-298 に記録されていた既知の残課題）。
 */
export function ChainRibbonCard({ data }: NodeProps<ChainRibbonFlowNode>) {
  const { txCountByHash, nodeLabelById, landingHashes, blocks } = data;
  const { t } = useLanguage();
  const { hoveredBlockHash } = useRibbonHover();
  const [openPopoverHashes, setOpenPopoverHashes] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const handlePopoverOpenChange = useCallback((blockHash: string, isOpen: boolean) => {
    setOpenPopoverHashes((prev) => {
      if (prev.has(blockHash) === isOpen) return prev;
      const next = new Set(prev);
      if (isOpen) {
        next.add(blockHash);
      } else {
        next.delete(blockHash);
      }
      return next;
    });
  }, []);
  const isHoverActive = hoveredBlockHash !== null || openPopoverHashes.size > 0;
  const tiles = useFrozenRibbonTiles(data.tiles, isHoverActive);
  const [parentHighlightHash, setParentHighlightHash] = useState<string | null>(
    null,
  );
  // 任意項目（UX設計 §3 末尾）: ホバー中の「親ブロック」行が指す親が現在の
  // 表示窓の外（最古タイルより前）にあるとき、左端の「⋯」を同系統の強調で
  // 光らせる。「親は存在するが表示範囲より前にある」ことが伝わる。
  const isOldestParentHighlighted =
    parentHighlightHash !== null &&
    !tiles.some((tile) => tile.block.hash === parentHighlightHash);
  const latest = tiles.length > 0 ? tiles[tiles.length - 1] : undefined;
  // ブロック生成タイミングのインジケータ（Issue #343。ARCHITECTURE.md §10.5）。
  // チェーン全体で1つ、ヘッダに表示する（ノードカードごとには出さない）。
  const cadence = useBlockCadence(blocks);

  return (
    <div className="chain-ribbon-card" data-testid="chain-ribbon-card">
      <div className="chain-ribbon-card__header">
        <span className="chain-ribbon-card__title">
          <GlossaryTerm termKey="block">{t("chainRibbon.title")}</GlossaryTerm>
        </span>
        {latest && (
          <span
            className="chain-ribbon-card__latest"
            data-testid="chain-ribbon-latest"
          >
            {format(t("chainRibbon.latest"), { number: String(latest.block.number) })}
          </span>
        )}
        {cadence && (
          <span className="chain-ribbon-card__cadence" data-testid="chain-ribbon-cadence">
            {cadence.stalled ? (
              <span
                className="chain-ribbon-card__cadence-stalled"
                data-testid="chain-ribbon-cadence-stalled"
              >
                {t("ribbon.blockProductionStalled")}
              </span>
            ) : (
              <>
                <span
                  className="chain-ribbon-card__cadence-bar"
                  data-testid="chain-ribbon-cadence-bar"
                >
                  <span
                    className="chain-ribbon-card__cadence-bar-fill"
                    style={{ width: `${Math.round(cadence.progress * 100)}%` }}
                  />
                </span>
                <span
                  className="chain-ribbon-card__cadence-countdown"
                  data-testid="chain-ribbon-cadence-countdown"
                >
                  {format(t("ribbon.nextBlockCountdown"), {
                    seconds: String(Math.max(0, Math.ceil(cadence.remainingMs / 1000))),
                  })}
                </span>
              </>
            )}
          </span>
        )}
      </div>
      <div className="chain-ribbon-card__subtitle">{t("chainRibbon.subtitle")}</div>
      {tiles.length === 0 ? (
        <div className="chain-ribbon-card__empty" data-testid="chain-ribbon-empty">
          {t("chainRibbon.empty")}
        </div>
      ) : (
        <div className="chain-ribbon-card__row">
          <span
            className={
              isOldestParentHighlighted
                ? "chain-ribbon-card__older chain-ribbon-card__older--highlight"
                : "chain-ribbon-card__older"
            }
            title={t("chainRibbon.older.tooltip")}
            data-testid="chain-ribbon-older"
          >
            ⋯
          </span>
          {tiles.map((tile, index) => (
            <Fragment key={tile.block.hash}>
              {index > 0 && (
                <span
                  className={
                    tile.connectedToPrevious
                      ? "chain-ribbon-card__link chain-ribbon-card__link--connected"
                      : "chain-ribbon-card__link chain-ribbon-card__link--broken"
                  }
                  aria-hidden="true"
                />
              )}
              <ChainRibbonTileView
                tile={tile}
                txCount={txCountByHash.get(tile.block.hash)}
                nodeLabelById={nodeLabelById}
                isLanding={landingHashes.has(tile.block.hash)}
                isParentHighlighted={parentHighlightHash === tile.block.hash}
                onParentHover={setParentHighlightHash}
                onPopoverOpenChange={handlePopoverOpenChange}
              />
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
