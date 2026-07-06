import type {
  NodeEntity,
  WorkbenchEntity,
  WorldStateEntity,
} from "@chainviz/shared";
import type { Node } from "@xyflow/react";
import type { LayoutMap, Position } from "../layout/layoutStore.js";

/** A層で描画対象になるインフラエンティティ（コンテナ）。 */
export type InfraEntity = NodeEntity | WorkbenchEntity;

export interface InfraNodeData extends Record<string, unknown> {
  entity: InfraEntity;
  /**
   * entity が workbench で `rpcTargetNodeId` を解決できた場合の、対象ノードの
   * containerName（カード詳細ポップオーバーの「操作先ノード」欄用。
   * Issue #123）。解決できない場合は省略する（フォールバック: 欄自体を出さない）。
   */
  rpcTargetContainerName?: string;
  /**
   * 実カード到着からの一定時間だけ true になる新着強調フラグ（Issue #123）。
   * entitiesToFlowNodes 自体はこの値を持たない（新着判定は時間経過に依存する
   * ため、entities/useNewArrivalHighlight.ts が別途計算し、呼び出し側
   * （App.tsx）がこのフィールドへ後付けする）。
   */
  isNew?: boolean;
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

/** レイアウト上の位置を、空き判定に使う衝突キー（"x,y"）へ変換する。 */
export function positionKey(position: Position): string {
  return `${position.x},${position.y}`;
}

/**
 * `occupied`（`positionKey` で変換済みの衝突キー集合）のどれとも衝突しない、
 * 既定グリッド上で最初に見つかる空き位置を返す（Issue #123）。グリッド添字を
 * 0 から順に試し、既に使われている座標を飛ばして最初の空きセルを返す純粋関数。
 *
 * 「エンティティの並び順に応じて添字を振り直す」旧方式（Issue #113 の温床）
 * と違い、この関数は「今どのセルが埋まっているか」という状態だけから毎回
 * 独立に空きセルを決めるため、既存カードの増減で結果が変わらない。
 */
export function findFreeGridPosition(
  occupied: Iterable<string>,
  grid: GridOptions = DEFAULT_GRID,
): Position {
  const occupiedKeys = new Set(occupied);
  let index = 0;
  let position = defaultGridPosition(index, grid);
  while (occupiedKeys.has(positionKey(position))) {
    index += 1;
    position = defaultGridPosition(index, grid);
  }
  return position;
}

/**
 * 保存済みレイアウトに無いコンテナ名へ、既存の位置と衝突しない空きグリッド
 * スロットを割り当てた新しいレイアウトマップを返す（純粋関数。Issue #123
 * UX設計 §4-3 ルール1）。割り当て済みの分はそのまま引き継ぐ。
 *
 * 割り当て順は containerName の辞書順（到着順に依存しない決定的な順序）。
 * 追加すべきものが無ければ引数の `layout` をそのまま返す（参照の変化で
 * 「何か変わった」を安価に判定できるようにするため）。
 *
 * 呼び出し側（App.tsx）はこの結果を localStorage へ永続化することで、
 * 「エンティティ初出時に位置を確定し、以後は二度と動かさない」を実現する。
 */
export function resolveLayoutPositions(
  containerNames: string[],
  layout: LayoutMap,
  grid: GridOptions = DEFAULT_GRID,
): LayoutMap {
  const missing = containerNames.filter((name) => !(name in layout)).sort();
  if (missing.length === 0) return layout;

  const occupied = new Set(Object.values(layout).map(positionKey));
  const next: LayoutMap = { ...layout };
  for (const name of missing) {
    const position = findFreeGridPosition(occupied, grid);
    next[name] = position;
    occupied.add(positionKey(position));
  }
  return next;
}

/**
 * ワールドステートのエンティティ群を React Flow のノード配列に変換する。
 *
 * - node / workbench のみを対象にする（A層）。
 * - 位置は安定 ID（containerName）をキーに layout から引く。未保存の場合は
 *   `resolveLayoutPositions` と同じアルゴリズムでその場限りの表示用位置を
 *   計算する（実際の確定・永続化は呼び出し側 App.tsx が担う。1レンダー分の
 *   暫定表示に過ぎず、次のレンダーで確定位置に切り替わる。Issue #123）。
 * - 並び順を安定させるため id でソートする（位置の算出には使わない）。
 */
export function entitiesToFlowNodes(
  entities: WorldStateEntity[],
  layout: LayoutMap,
  grid: GridOptions = DEFAULT_GRID,
): InfraFlowNode[] {
  const infra = entities
    .filter(isInfraEntity)
    .sort((a, b) => a.id.localeCompare(b.id));

  const nodesById = new Map<string, NodeEntity>();
  for (const entity of entities) {
    if (entity.kind === "node") nodesById.set(entity.id, entity);
  }

  const occupied = new Set(Object.values(layout).map(positionKey));
  const fallbackPositions = new Map<string, Position>();

  return infra.map((entity) => {
    let position: Position | undefined = layout[entity.containerName];
    if (!position) position = fallbackPositions.get(entity.containerName);
    if (!position) {
      position = findFreeGridPosition(occupied, grid);
      occupied.add(positionKey(position));
      fallbackPositions.set(entity.containerName, position);
    }

    const rpcTargetContainerName =
      entity.kind === "workbench" && entity.rpcTargetNodeId
        ? nodesById.get(entity.rpcTargetNodeId)?.containerName
        : undefined;

    return {
      id: entity.id,
      type: "infra",
      position: { x: position.x, y: position.y },
      data: { entity, rpcTargetContainerName },
    };
  });
}

/**
 * 2つの InfraFlowNode が「見た目上変化していない」とみなせるか判定する
 * (`stabilizeNodes` に渡す比較関数。Issue #119)。
 *
 * `entity` は WorldState 側で内容に変化がない限り同一オブジェクト参照が
 * 保たれる(`world-state/store.ts` の `applyDiff` 参照)ため、参照比較だけで
 * 「実データが変わっていないか」を安価に判定できる。
 */
export function isSameInfraNode(
  previous: InfraFlowNode,
  next: InfraFlowNode,
): boolean {
  return (
    previous.data.entity === next.data.entity &&
    previous.position.x === next.position.x &&
    previous.position.y === next.position.y
  );
}
