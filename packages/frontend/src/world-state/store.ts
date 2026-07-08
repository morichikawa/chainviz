import type {
  DiffEvent,
  NodeLinkActivity,
  OperationEdge,
  PeerEdge,
  WorldStateEntity,
  WorldStateSnapshot,
} from "@chainviz/shared";

/**
 * フロント側で保持するワールドステート。エンティティは安定 ID をキーにした
 * マップで持ち、エッジ（ピア接続）は配列で持つ。collector から届く
 * スナップショット + 差分イベントをこの形へ畳み込む。
 */
export interface WorldState {
  entities: Record<string, WorldStateEntity>;
  edges: PeerEdge[];
}

export const emptyWorldState: WorldState = { entities: {}, edges: [] };

/**
 * エンティティ種別ごとの安定識別子を返す。差分イベント（entityUpdated /
 * entityRemoved）が持つ `id` はこの値を指す前提。InfraEntity（node /
 * workbench）は `id`、それ以外はアドレスやハッシュを自然キーとして使う。
 */
export function entityId(entity: WorldStateEntity): string {
  switch (entity.kind) {
    case "node":
    case "workbench":
      return entity.id;
    case "wallet":
    case "contract":
      return entity.address;
    case "block":
    case "transaction":
    case "userOperation":
      return entity.hash;
  }
}

/** スナップショットを WorldState に変換する（接続直後に1回呼ぶ）。 */
export function applySnapshot(snapshot: WorldStateSnapshot): WorldState {
  const entities: Record<string, WorldStateEntity> = {};
  for (const entity of snapshot.entities) {
    entities[entityId(entity)] = entity;
  }
  return { entities, edges: [...snapshot.edges] };
}

/**
 * 差分イベント列を現在の WorldState に適用し、新しい WorldState を返す
 * （イミュータブル。元の state は変更しない）。未知のイベントや、対象の
 * 存在しない update/remove は安全に無視する。
 */
export function applyDiff(state: WorldState, events: DiffEvent[]): WorldState {
  if (events.length === 0) return state;

  const entities = { ...state.entities };
  let edges = state.edges;

  const ensureEdgesCopy = () => {
    if (edges === state.edges) edges = [...edges];
    return edges;
  };

  for (const event of events) {
    switch (event.type) {
      case "entityAdded": {
        entities[entityId(event.entity)] = event.entity;
        break;
      }
      case "entityUpdated": {
        const existing = entities[event.id];
        if (existing) {
          entities[event.id] = {
            ...existing,
            ...event.patch,
          } as WorldStateEntity;
        }
        break;
      }
      case "entityRemoved": {
        delete entities[event.id];
        break;
      }
      case "edgeAdded": {
        // エッジの同一性キーは from/to/networkId の3つ組（ARCHITECTURE.md §2。
        // collector 側 world-state/diff.ts の edgeKey と同じ判定）。
        const { fromNodeId, toNodeId, networkId } = event.edge;
        const exists = edges.some(
          (e) =>
            e.fromNodeId === fromNodeId &&
            e.toNodeId === toNodeId &&
            e.networkId === networkId,
        );
        if (!exists) ensureEdgesCopy().push(event.edge);
        break;
      }
      case "edgeRemoved": {
        const next = edges.filter(
          (e) =>
            !(
              e.fromNodeId === event.fromNodeId &&
              e.toNodeId === event.toNodeId &&
              e.networkId === event.networkId
            ),
        );
        if (next.length !== edges.length) edges = next;
        break;
      }
      default: {
        // 未知のイベント型は無視する（前方互換）。
        break;
      }
    }
  }

  return { entities, edges };
}

/**
 * 差分イベント列から揮発性の操作観測（operationObserved）だけを抜き出す。
 *
 * OperationEdge はワールドステート（entities / edges）へ畳み込まず、描画側が
 * 受信時に一度きりのパルスアニメーションとして消費する（ARCHITECTURE.md §2）。
 * そのため applyDiff とは分離し、この関数で取り出して別経路へ流す。
 */
export function extractOperations(events: DiffEvent[]): OperationEdge[] {
  const operations: OperationEdge[] = [];
  for (const event of events) {
    if (event.type === "operationObserved") operations.push(event.edge);
  }
  return operations;
}

/**
 * 差分イベント列から揮発性の内部リンク活動観測（nodeLinkActivity。D層。
 * ARCHITECTURE.md §7.6.4）だけを抜き出す。`extractOperations` と同じ理由
 * （ワールドステートへ畳み込まず、描画側が一度きりのパルスアニメーション
 * として消費する）で applyDiff とは分離する。
 */
export function extractNodeLinkActivities(events: DiffEvent[]): NodeLinkActivity[] {
  const activities: NodeLinkActivity[] = [];
  for (const event of events) {
    if (event.type === "nodeLinkActivity") activities.push(event.activity);
  }
  return activities;
}

/** WorldState 内のエンティティを配列として取り出す。 */
export function listEntities(state: WorldState): WorldStateEntity[] {
  return Object.values(state.entities);
}

/** WorldState 内のピア接続（B層のエッジ）を配列として取り出す。 */
export function listEdges(state: WorldState): PeerEdge[] {
  return state.edges;
}
