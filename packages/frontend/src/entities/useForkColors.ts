import type { BlockEntity } from "@chainviz/shared";
import { useMemo, useRef } from "react";
import {
  buildBlockIndex,
  chainRelation,
  defaultMaxAncestorSteps,
  detectForkGroups,
  highestTipHash,
  type ForkGroup,
  type ForkTipCandidate,
} from "./forkState.js";

/**
 * カード枠に使うフォーク色パレットの色数（`styles.css` の
 * `.infra-card--fork-0`〜`.infra-card--fork-3` と対応。Issue #296）。
 * この環境は2バリデーター構成のため通常は2グループまでしか同時に
 * 発生しないが、将来の構成変更に備えて4まで確保する。
 */
export const FORK_COLOR_PALETTE_SIZE = 4;

interface ColoredGroup {
  representativeTipHash: string;
  colorIndex: number;
}

export interface ForkColorAssignment {
  /** nodeId → パレット index（0〜3）。フォークしていないノードは含まれない。 */
  colorIndexByNodeId: Map<string, number>;
}

const EMPTY_ASSIGNMENT: ForkColorAssignment = { colorIndexByNodeId: new Map() };

function nextUnusedColor(used: ReadonlySet<number>): number {
  for (let i = 0; i < FORK_COLOR_PALETTE_SIZE; i += 1) {
    if (!used.has(i)) return i;
  }
  // パレットを使い切った場合（フォーク数がパレット数を超える稀なケース）は
  // 巡回して割り当てる。色の重複は起こりうるが、グループ自体は
  // `entities/forkState.ts` 側で正しく分かれているので表示が破綻するわけ
  // ではない。
  return used.size % FORK_COLOR_PALETTE_SIZE;
}

/**
 * フォーク検知結果（`entities/forkState.ts` の純粋関数）に、レンダーを
 * またいだ色の安定性を付与するフック（ARCHITECTURE.md §9.2「色割り当ての
 * 安定性」、Issue #296）。
 *
 * - 検知ロジック自体は forkState.ts に集約し、ここでは「前回どのグループに
 *   どの色を割り当てたか」という React 側の状態管理だけを持つ
 *   （useBlockPulses.ts が blockPulse.ts の計算とスケジューリングを分離する
 *   のと同じ構成）。
 * - 各グループの「代表 tip」（グループ内で最も高さが大きい tip）どうしを
 *   `chainRelation` で比較し、前回のグループと同一チェーン（"same"）と
 *   判定できたグループには同じ色を引き継ぐ。新規グループには未使用の色を
 *   割り当てる。
 * - フォークが検出されなくなった（全 tip が収束した）瞬間、内部状態を
 *   リセットする。専用の「収束イベント」は無く、次のレンダーで
 *   `detectForkGroups` が空を返すこと自体が収束の表現になる（設計メモ
 *   「収束の検知は専用状態を持たない」）。
 */
export function useForkColorAssignment(
  nodes: readonly ForkTipCandidate[],
  blocks: readonly BlockEntity[],
): ForkColorAssignment {
  const previousRef = useRef<ColoredGroup[]>([]);

  return useMemo(() => {
    const blockByHash = buildBlockIndex(blocks);
    const maxSteps = defaultMaxAncestorSteps(blocks.length);
    const groups = detectForkGroups(nodes, blocks, { maxAncestorSteps: maxSteps });

    if (groups.length === 0) {
      previousRef.current = [];
      return EMPTY_ASSIGNMENT;
    }

    const previous = previousRef.current;
    const usedColors = new Set<number>();
    const consumedPrevious = new Set<number>();

    const colored: ColoredGroup[] = groups.map((group: ForkGroup) => {
      const representativeTipHash = highestTipHash(group, blockByHash);
      const curBlock = blockByHash.get(representativeTipHash);

      let colorIndex: number | undefined;
      if (curBlock) {
        for (let i = 0; i < previous.length; i += 1) {
          if (consumedPrevious.has(i)) continue;
          const prevBlock = blockByHash.get(previous[i].representativeTipHash);
          if (!prevBlock) continue;
          const relation = chainRelation(prevBlock, curBlock, blockByHash, maxSteps);
          if (relation === "same") {
            colorIndex = previous[i].colorIndex;
            consumedPrevious.add(i);
            break;
          }
        }
      }
      if (colorIndex === undefined) colorIndex = nextUnusedColor(usedColors);
      usedColors.add(colorIndex);
      return { representativeTipHash, colorIndex };
    });

    previousRef.current = colored;

    const colorIndexByNodeId = new Map<string, number>();
    groups.forEach((group, i) => {
      for (const nodeId of group.nodeIds) {
        colorIndexByNodeId.set(nodeId, colored[i].colorIndex);
      }
    });
    return { colorIndexByNodeId };
  }, [nodes, blocks]);
}
