// ワールドステートの差分計算。前回と今回のエンティティ集合を比較して
// DiffEvent[] を生成する純粋関数。エンティティごとの安定キーの取り出しも
// ここに集約する。

import type { DiffEvent, PeerEdge, WorldStateEntity } from "@chainviz/shared";

/**
 * エンティティの安定キーを取り出す。InfraEntity 系（node/workbench）は id、
 * それ以外はチェーン上のアドレス/ハッシュを使う。
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

/** 2 値が等しいか（プレーンデータ前提の簡易ディープ比較）。 */
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 変化したトップレベルフィールドだけを patch として抽出する。変化が無ければ
 * null を返す。
 */
function fieldPatch(
  before: WorldStateEntity,
  after: WorldStateEntity,
): Partial<WorldStateEntity> | null {
  const patch: Record<string, unknown> = {};
  const beforeRecord = before as unknown as Record<string, unknown>;
  const afterRecord = after as unknown as Record<string, unknown>;
  for (const key of Object.keys(after)) {
    const beforeValue = beforeRecord[key];
    const afterValue = afterRecord[key];
    if (!deepEqual(beforeValue, afterValue)) {
      patch[key] = afterValue;
    }
  }
  return Object.keys(patch).length > 0
    ? (patch as Partial<WorldStateEntity>)
    : null;
}

/**
 * 前回（prev）から今回（next）への差分イベントを計算する。
 * - next にのみ存在 → entityAdded
 * - 両方に存在し内容が変化 → entityUpdated（変化フィールドのみの patch）
 * - prev にのみ存在 → entityRemoved
 */
export function computeDiff(
  prev: WorldStateEntity[],
  next: WorldStateEntity[],
): DiffEvent[] {
  const prevMap = new Map(prev.map((e) => [entityId(e), e]));
  const nextMap = new Map(next.map((e) => [entityId(e), e]));
  const events: DiffEvent[] = [];

  for (const [id, entity] of nextMap) {
    const before = prevMap.get(id);
    if (!before) {
      events.push({ type: "entityAdded", entity });
    } else {
      const patch = fieldPatch(before, entity);
      if (patch) events.push({ type: "entityUpdated", id, patch });
    }
  }

  for (const id of prevMap.keys()) {
    if (!nextMap.has(id)) {
      events.push({ type: "entityRemoved", id });
    }
  }

  return events;
}

/**
 * エッジの安定キー。fromNodeId / toNodeId / networkId の 3 つ組で同一性を判定する
 * （PeerEdge は生成側で無向に正規化済み。networkId が変われば別エッジ扱い）。
 */
export function edgeKey(edge: PeerEdge): string {
  return [edge.fromNodeId, edge.toNodeId, edge.networkId].join("|");
}

/**
 * 前回（prev）から今回（next）へのエッジ差分を計算する。
 * - next にのみ存在 → edgeAdded
 * - prev にのみ存在 → edgeRemoved（同一性キーである from/to/networkId を載せる）
 * エッジには「内容の更新」概念を設けない（差異があれば別エッジ = remove + add）。
 */
export function computeEdgeDiff(
  prev: PeerEdge[],
  next: PeerEdge[],
): DiffEvent[] {
  const prevMap = new Map(prev.map((e) => [edgeKey(e), e]));
  const nextMap = new Map(next.map((e) => [edgeKey(e), e]));
  const events: DiffEvent[] = [];

  for (const [key, edge] of nextMap) {
    if (!prevMap.has(key)) events.push({ type: "edgeAdded", edge });
  }

  for (const [key, edge] of prevMap) {
    if (!nextMap.has(key)) {
      events.push({
        type: "edgeRemoved",
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        networkId: edge.networkId,
      });
    }
  }

  return events;
}
