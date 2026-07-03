import type {
  NodeEntity,
  WorkbenchEntity,
  WorldStateEntity,
} from "@chainviz/shared";
import type { Node } from "@xyflow/react";
import type { LayoutMap } from "../layout/layoutStore.js";

/** A層で描画対象になるインフラエンティティ（コンテナ）。 */
export type InfraEntity = NodeEntity | WorkbenchEntity;

export interface InfraNodeData extends Record<string, unknown> {
  entity: InfraEntity;
}

export type InfraFlowNode = Node<InfraNodeData, "infra">;

export function isInfraEntity(entity: WorldStateEntity): entity is InfraEntity {
  return entity.kind === "node" || entity.kind === "workbench";
}

export interface GridOptions {
  columns: number;
  gapX: number;
  gapY: number;
  originX: number;
  originY: number;
}

export const DEFAULT_GRID: GridOptions = {
  columns: 3,
  gapX: 260,
  gapY: 200,
  originX: 0,
  originY: 0,
};

/** レイアウト未保存のカードを並べる既定のグリッド座標を返す。 */
export function defaultGridPosition(
  index: number,
  grid: GridOptions = DEFAULT_GRID,
): { x: number; y: number } {
  const col = index % grid.columns;
  const row = Math.floor(index / grid.columns);
  return {
    x: grid.originX + col * grid.gapX,
    y: grid.originY + row * grid.gapY,
  };
}

/**
 * ワールドステートのエンティティ群を React Flow のノード配列に変換する。
 *
 * - node / workbench のみを対象にする（A層）。
 * - 位置は安定 ID（containerName）をキーに layout から引く。未保存なら
 *   既定グリッドへ配置する。
 * - 並び順を安定させるため id でソートしてからグリッド添字を割り当てる。
 */
export function entitiesToFlowNodes(
  entities: WorldStateEntity[],
  layout: LayoutMap,
  grid: GridOptions = DEFAULT_GRID,
): InfraFlowNode[] {
  const infra = entities
    .filter(isInfraEntity)
    .sort((a, b) => a.id.localeCompare(b.id));

  return infra.map((entity, index) => {
    const saved = layout[entity.containerName];
    const position = saved ?? defaultGridPosition(index, grid);
    return {
      id: entity.id,
      type: "infra",
      position: { x: position.x, y: position.y },
      data: { entity },
    };
  });
}
