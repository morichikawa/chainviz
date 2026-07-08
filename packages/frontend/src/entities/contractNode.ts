import type { ContractEntity, WorldStateEntity } from "@chainviz/shared";
import type { Node } from "@xyflow/react";
import type { GridOptions } from "./infraNode.js";
import { DEFAULT_GRID, defaultGridPosition } from "./infraNode.js";
import type { LayoutMap } from "../layout/layoutStore.js";

/**
 * C層拡張のコントラクトカードをキャンバス上に描くための型・変換
 * （ARCHITECTURE.md §6.2/§6.3）。インフラカード（infraNode.ts）・ウォレット
 * カード（walletNode.ts）と対になる。
 */

export interface ContractNodeData extends Record<string, unknown> {
  entity: ContractEntity;
  /**
   * 実カード到着からの一定時間だけ true になる新着強調フラグ（infraNode.ts
   * の InfraNodeData と同じ仕組み。Issue #123 の配置ルールをコントラクト行にも
   * 適用する。ARCHITECTURE.md §6.2）。contractsToFlowNodes 自体はこの値を
   * 持たず、呼び出し側（App.tsx）が useNewArrivalHighlight の結果を後付けする。
   */
  isNew?: boolean;
}

export type ContractFlowNode = Node<ContractNodeData, "contract">;

/** React Flow の nodeTypes で使うコントラクトカードの型名。 */
export const CONTRACT_NODE_TYPE = "contract";

/**
 * コントラクトカードの既定グリッド。インフラ行（originY=0）・ウォレット行
 * （originY=520）に続く3段目の帯として、ウォレット行のカード実測高さと
 * 重ならない値を1040に設定する（ARCHITECTURE.md §6.2 の目安値）。
 */
export const CONTRACT_GRID: GridOptions = {
  ...DEFAULT_GRID,
  originY: 1040,
};

export function isContractEntity(
  entity: WorldStateEntity,
): entity is ContractEntity {
  return entity.kind === "contract";
}

export interface ContractNodeContext {
  layout: LayoutMap;
  grid?: GridOptions;
}

/**
 * ワールドステートのエンティティ群からコントラクトカードの React Flow
 * ノード配列を作る。
 *
 * - contract のみを対象にする。
 * - 位置は安定 ID（address。ウォレットと同じくチェーン側の状態なので
 *   Docker コンテナ ID のように再起動で変わる識別子は使わない）をキーに
 *   layout から引く。未保存なら既定グリッドへ。
 * - 並び順を安定させるため address でソートしてからグリッド添字を割り当てる。
 */
export function contractsToFlowNodes(
  entities: WorldStateEntity[],
  ctx: ContractNodeContext,
): ContractFlowNode[] {
  const grid = ctx.grid ?? CONTRACT_GRID;
  const contracts = entities
    .filter(isContractEntity)
    .sort((a, b) => a.address.localeCompare(b.address));

  return contracts.map((entity, index) => {
    const saved = ctx.layout[entity.address];
    const position = saved ?? defaultGridPosition(index, grid);
    return {
      id: entity.address,
      type: CONTRACT_NODE_TYPE,
      position: { x: position.x, y: position.y },
      data: { entity },
    };
  });
}

/**
 * 2つの ContractFlowNode が「見た目上変化していない」とみなせるか判定する
 * (`stabilizeNodes` に渡す比較関数。infraNode.ts の isSameInfraNode と同じ
 * 狙い。Issue #119)。`isNew` はここでは比較対象にしない（infraNode.ts の
 * InfraNodeData と同じ理由。時間経過に依存する派生フラグのため、呼び出し側
 * App.tsx が stabilizeNodes の後段で別途反映する）。
 */
export function isSameContractNode(
  previous: ContractFlowNode,
  next: ContractFlowNode,
): boolean {
  return (
    previous.data.entity === next.data.entity &&
    previous.position.x === next.position.x &&
    previous.position.y === next.position.y
  );
}
