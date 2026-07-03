import type {
  DiffEvent,
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
        const { fromNodeId, toNodeId } = event.edge;
        const exists = edges.some(
          (e) => e.fromNodeId === fromNodeId && e.toNodeId === toNodeId,
        );
        if (!exists) ensureEdgesCopy().push(event.edge);
        break;
      }
      case "edgeRemoved": {
        const next = edges.filter(
          (e) =>
            !(
              e.fromNodeId === event.fromNodeId &&
              e.toNodeId === event.toNodeId
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

/** WorldState 内のエンティティを配列として取り出す。 */
export function listEntities(state: WorldState): WorldStateEntity[] {
  return Object.values(state.entities);
}
