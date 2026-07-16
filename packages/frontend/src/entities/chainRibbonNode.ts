import type { BlockEntity } from "@chainviz/shared";
import type { Node } from "@xyflow/react";
import type { ChainRibbonTile } from "./chainRibbon.js";
import type { LayoutMap, Position } from "../layout/layoutStore.js";

/**
 * チェーンリボン（Issue #298。ARCHITECTURE.md §9）を React Flow のノードに
 * 変換するための型・関数。`contractNode.ts` と同じくチェーン側の状態を表す
 * カードだが、コントラクトと違い「チェーン全体で常に1本」なので、複数件を
 * 並べるグリッド計算は行わない（安定 id は固定文字列）。
 */

/** チェーンリボンの React Flow ノード id（チェーン全体で1本・固定）。 */
export const CHAIN_RIBBON_ID = "chain-ribbon";

/** React Flow の nodeTypes で使うチェーンリボンカードの型名。 */
export const CHAIN_RIBBON_NODE_TYPE = "chainRibbon";

/**
 * 保存済みレイアウトが無い場合の既定位置（docs/worklog/issue-298.md §4.1
 * 「ノード群の下・ウォレット群の上」）。インフラ行は originY=0
 * （`infraNode.ts` の DEFAULT_GRID）、ウォレット行は originY=520
 * （`walletNode.ts` の WALLET_GRID）なので、その間の帯に置く。他カードとの
 * 重なりは「要件としない」（UX設計 §4.1）ため、ユーザーがドラッグすれば
 * 以後はその位置が保存される。
 */
export const CHAIN_RIBBON_DEFAULT_POSITION: Position = { x: -20, y: 260 };

export interface ChainRibbonNodeData extends Record<string, unknown> {
  /** タイル列（番号昇順・末尾が最新。`deriveRibbonTiles` の出力）。 */
  tiles: ChainRibbonTile[];
  /** ブロック hash -> 取り込み tx 件数（`countTransactionsByBlockHash` の出力）。 */
  txCountByHash: ReadonlyMap<string, number>;
  /** ノード id -> 表示名（containerName）。「受信したノード」欄の解決に使う。 */
  nodeLabelById: ReadonlyMap<string, string>;
  /** 着地アニメーション中のタイル hash 集合（`useRibbonLanding` の出力）。 */
  landingHashes: ReadonlySet<string>;
  /**
   * 直近の `BlockEntity` 全件（タイル表示窓（8件）に絞る前の、store が保持する
   * 全ブロック）。ブロック生成タイミングのインジケータ（Issue #343。
   * ARCHITECTURE.md §10.5）の導出に使う。`tiles` は表示件数に絞られており
   * 導出に必要な差分の冗長性が足りないため、別途渡す。
   */
  blocks: readonly BlockEntity[];
}

export type ChainRibbonFlowNode = Node<ChainRibbonNodeData, "chainRibbon">;

export interface ChainRibbonNodeContext {
  tiles: ChainRibbonTile[];
  txCountByHash: ReadonlyMap<string, number>;
  nodeLabelById: ReadonlyMap<string, string>;
  landingHashes: ReadonlySet<string>;
  blocks: readonly BlockEntity[];
  layout: LayoutMap;
}

/** チェーンリボンの React Flow ノードを1件組み立てる。 */
export function chainRibbonToFlowNode(
  ctx: ChainRibbonNodeContext,
): ChainRibbonFlowNode {
  const saved = ctx.layout[CHAIN_RIBBON_ID];
  const position = saved ?? CHAIN_RIBBON_DEFAULT_POSITION;
  return {
    id: CHAIN_RIBBON_ID,
    type: CHAIN_RIBBON_NODE_TYPE,
    position: { x: position.x, y: position.y },
    data: {
      tiles: ctx.tiles,
      txCountByHash: ctx.txCountByHash,
      nodeLabelById: ctx.nodeLabelById,
      landingHashes: ctx.landingHashes,
      blocks: ctx.blocks,
    },
  };
}
