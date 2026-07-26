import type { ReactNode } from "react";
import { shortHex } from "../entities/transaction.js";
import {
  connectorGridColumnAfter,
  tileGridColumn,
  type LongRangeAttackDemoBlock,
} from "./longRangeAttackDemo.js";

/** タイル1枚の見た目区分（UX設計 §3）。`plain` は無印（まだ確定していない/
 * 正規と共有している）、`finalized` は正規チェーンの確定済み区間（緑系）、
 * `fork` は攻撃者チェーンの分岐後区間（既存のフォーク色パレット）。 */
export type LongRangeTileVariant = "plain" | "finalized" | "fork";

export interface LongRangeChainRowProps {
  /** 行見出し（「正規のチェーン」/「攻撃者が作り直した履歴」）。 */
  rowLabel: ReactNode;
  /** 共有グリッド上のこの行の行番号（1始まり）。 */
  gridRow: number;
  /** 描画するブロック列（番号昇順であること）。 */
  blocks: readonly LongRangeAttackDemoBlock[];
  /** ブロックごとの見た目区分を決める。 */
  variantFor: (block: LongRangeAttackDemoBlock) => LongRangeTileVariant;
  /** この番号のブロックから次のブロックへの連結線を破線にする（分岐点の
   * 直前。未指定ならすべて実線）。 */
  brokenLinkAfterNumber?: number;
  /** 特定ブロックの直下に添える小さな注記（UX設計 §3「同じ番号でも中身が
   * 違う、ライバルのブロックです」）。 */
  note?: { blockNumber: number; text: ReactNode; testId: string };
  /** 確定済みバッジ等、タイルの下に添える追加ラベル（`finalized` 変種のみ
   * 使う想定だが呼び出し側の裁量に委ねる）。 */
  finalizedBadgeLabel?: ReactNode;
  testIdPrefix: string;
}

const VARIANT_CLASS: Record<LongRangeTileVariant, string> = {
  plain: "long-range-demo__tile",
  finalized: "long-range-demo__tile long-range-demo__tile--finalized",
  fork: "long-range-demo__tile long-range-demo__tile--fork",
};

/**
 * 正規/攻撃者共通のタイル行描画（Issue #415。`HashChainBlockRow.tsx` が
 * `HashChainDemoView.tsx` から分離されているのと同じ切り方。1ファイル1責務）。
 *
 * `LongRangeAttackDemoView.tsx` 側は共通の `grid-template-columns` を持つ
 * 1つのグリッドコンテナ（`.long-range-demo__grid`）を用意し、この行は
 * その中の1行分（`gridRow`）のセルを埋めるだけで、グリッド自体は生成しない
 * （正規/checkpoint/攻撃者の3段が同じ列位置に揃う、という不変条件を
 * 「共有グリッドを1つだけ作る」という構造そのもので保証するため）。
 */
export function LongRangeChainRow({
  rowLabel,
  gridRow,
  blocks,
  variantFor,
  brokenLinkAfterNumber,
  note,
  finalizedBadgeLabel,
  testIdPrefix,
}: LongRangeChainRowProps) {
  return (
    <>
      <div
        className="long-range-demo__row-label"
        style={{ gridRow, gridColumn: 1 }}
        data-testid={`${testIdPrefix}-label`}
      >
        {rowLabel}
      </div>
      {blocks.map((block) => {
        const variant = variantFor(block);
        const showNote = note?.blockNumber === block.number;
        return (
          <div
            key={block.number}
            className="long-range-demo__tile-cell"
            style={{ gridRow, gridColumn: tileGridColumn(block.number) }}
          >
            <div
              className={VARIANT_CLASS[variant]}
              data-testid={`${testIdPrefix}-tile-${block.number}`}
            >
              <span className="long-range-demo__tile-number">#{block.number}</span>
              <span className="long-range-demo__tile-hash" title={block.hash}>
                {shortHex(block.hash)}
              </span>
              {variant === "finalized" && finalizedBadgeLabel && (
                <span
                  className="long-range-demo__tile-badge"
                  data-testid={`${testIdPrefix}-finalized-${block.number}`}
                >
                  {finalizedBadgeLabel}
                </span>
              )}
            </div>
            {showNote && (
              <p className="long-range-demo__rival-note" data-testid={note!.testId}>
                {note!.text}
              </p>
            )}
          </div>
        );
      })}
      {blocks.map((block, index) => {
        if (index === blocks.length - 1) return null;
        const broken = block.number === brokenLinkAfterNumber;
        return (
          <span
            key={`link-${block.number}`}
            className={
              broken
                ? "long-range-demo__link long-range-demo__link--broken"
                : "long-range-demo__link"
            }
            aria-hidden="true"
            style={{ gridRow, gridColumn: connectorGridColumnAfter(block.number) }}
            data-testid={`${testIdPrefix}-link-${block.number}`}
          />
        );
      })}
    </>
  );
}
