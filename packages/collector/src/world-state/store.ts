// インメモリのワールドステート store。現在のエンティティ集合を保持し、
// 新しいポーリング結果を取り込むたびに差分（DiffEvent[]）を計算して返す。

import type {
  BlockEntity,
  ChainType,
  DiffEvent,
  PeerEdge,
  WalletEntity,
  WorldStateEntity,
  WorldStateSnapshot,
} from "@chainviz/shared";
import {
  computeDiff,
  computeEdgeDiff,
  computeWalletDiff,
  edgeKey,
  entityId,
  type WalletObservation,
} from "./diff.js";

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

  /**
   * B 層のピア接続（PeerEdge の集合）を取り込む。前回のエッジ集合との差分を
   * 計算し、edgeAdded / edgeRemoved を適用する。返り値は適用した差分イベント。
   */
  applyPeers(next: PeerEdge[]): DiffEvent[] {
    const diff = computeEdgeDiff(this.edges, next);
    for (const event of diff) this.applyEvent(event);
    this.timestamp = Date.now();
    return diff;
  }

  /**
   * B 層のブロック受信タイミング（BlockEntity）を取り込む。ブロックはハッシュを
   * キーとするエンティティなので、既存の同一ブロックとの差分だけを計算する
   * （他のエンティティは触らない）。返り値は適用した差分イベント。
   */
  applyBlock(block: BlockEntity): DiffEvent[] {
    const existing = this.entities.get(block.hash);
    const prev = existing ? [existing] : [];
    const diff = computeDiff(prev, [block]);
    for (const event of diff) this.applyEvent(event);
    this.timestamp = Date.now();
    return diff;
  }

  /**
   * C 層のウォレット観測（WalletObservation の集合）を取り込む。差分は wallet
   * エンティティだけを対象にし、他層のエンティティは触らない。観測に現れなく
   * なったウォレットは削除せず ownerWorkbenchId を null にして残す（CONCEPT.md
   * の決定。computeWalletDiff 参照）。返り値は適用した差分イベント。
   */
  applyWallets(observed: WalletObservation[]): DiffEvent[] {
    const prevWallets = [...this.entities.values()].filter(
      (e): e is WalletEntity => e.kind === "wallet",
    );
    const diff = computeWalletDiff(prevWallets, observed, this.chainType);
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
      case "edgeAdded": {
        const key = edgeKey(event.edge);
        if (!this.edges.some((e) => edgeKey(e) === key)) {
          this.edges = [...this.edges, event.edge];
        }
        break;
      }
      case "edgeRemoved":
        this.edges = this.edges.filter(
          (e) =>
            !(
              e.fromNodeId === event.fromNodeId &&
              e.toNodeId === event.toNodeId &&
              e.networkId === event.networkId
            ),
        );
        break;
    }
  }
}
