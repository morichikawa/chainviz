// インメモリのワールドステート store。現在のエンティティ集合を保持し、
// 新しいポーリング結果を取り込むたびに差分（DiffEvent[]）を計算して返す。

import type {
  ChainType,
  DiffEvent,
  PeerEdge,
  WorldStateEntity,
  WorldStateSnapshot,
} from "@chainviz/shared";
import { computeDiff, entityId } from "./diff.js";

/** node / workbench（InfraEntity 系）かどうか。 */
function isInfraEntity(entity: WorldStateEntity): boolean {
  return entity.kind === "node" || entity.kind === "workbench";
}

export class WorldStateStore {
  private readonly entities = new Map<string, WorldStateEntity>();
  private edges: PeerEdge[] = [];
  private timestamp = Date.now();

  constructor(private readonly chainType: ChainType = "ethereum") {}

  /** 現在の全量スナップショットを返す。 */
  getSnapshot(): WorldStateSnapshot {
    return {
      chainType: this.chainType,
      timestamp: this.timestamp,
      entities: [...this.entities.values()],
      edges: [...this.edges],
    };
  }

  /**
   * A 層のポーリング結果（node/workbench の集合）を取り込む。差分計算は
   * InfraEntity 系だけを対象にし、他層が入れたエンティティ（ウォレット等）は
   * 消さずに残す。返り値は適用した差分イベント。
   */
  applyInfra(next: WorldStateEntity[]): DiffEvent[] {
    const prevInfra = [...this.entities.values()].filter(isInfraEntity);
    const diff = computeDiff(prevInfra, next);
    for (const event of diff) this.applyEvent(event);
    this.timestamp = Date.now();
    return diff;
  }

  private applyEvent(event: DiffEvent): void {
    switch (event.type) {
      case "entityAdded":
        this.entities.set(entityId(event.entity), event.entity);
        break;
      case "entityUpdated": {
        const existing = this.entities.get(event.id);
        if (existing) {
          this.entities.set(event.id, {
            ...existing,
            ...event.patch,
          } as WorldStateEntity);
        }
        break;
      }
      case "entityRemoved":
        this.entities.delete(event.id);
        break;
      case "edgeAdded":
      case "edgeRemoved":
        // A 層ではエッジを扱わない（B 層で実装）。
        break;
    }
  }
}
