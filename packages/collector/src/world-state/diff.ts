// ワールドステートの差分計算。前回と今回のエンティティ集合を比較して
// DiffEvent[] を生成する純粋関数。エンティティごとの安定キーの取り出しも
// ここに集約する。

import type {
  ChainType,
  DiffEvent,
  PeerEdge,
  WalletEntity,
  WorldStateEntity,
} from "@chainviz/shared";

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
 * ウォレットの観測結果。所有関係（どのワークベンチのものか）は Docker の観測に
 * 由来し、残高・nonce は JSON-RPC から取得する。RPC が一時的に取れなかった
 * アドレスは balance / nonce を undefined にでき、その場合は既存値を維持する。
 * チェーン非依存の語彙（アドレス・残高・nonce・所有者）だけで表現し、
 * ChainAdapter とワールドステートの境界を保つ。
 */
export interface WalletObservation {
  address: string;
  ownerWorkbenchId: string;
  /** wei を 10 進文字列で。undefined なら既存値を維持する。 */
  balance?: string;
  /** undefined なら既存値を維持する。 */
  nonce?: number;
}

/**
 * ウォレットの差分を計算する。ウォレットはノード/ワークベンチと異なり削除
 * されない（CONCEPT.md「ノード/ワークベンチを削除したときの過去データの扱い」）。
 * 観測に現れなくなったウォレット（＝所有ワークベンチが消えた）は
 * entityRemoved にせず、ownerWorkbenchId を null に更新して残す。
 *
 * - observed にあり prev に無い → 残高・nonce が取れていれば entityAdded、
 *   まだ取れていない（balance が undefined）ものは追加を保留（イベントなし）
 * - observed と prev の両方にあり内容が変化 → entityUpdated（変化分のみ）。
 *   balance / nonce が undefined の観測は既存値を維持する
 * - prev にあり observed に無く、かつ ownerWorkbenchId が非 null → 所有者を
 *   null に更新（entityUpdated）。既に null なら何もしない
 */
export function computeWalletDiff(
  prev: WalletEntity[],
  observed: WalletObservation[],
  chainType: ChainType,
): DiffEvent[] {
  const prevMap = new Map(prev.map((w) => [w.address, w]));
  const observedAddresses = new Set(observed.map((o) => o.address));
  const events: DiffEvent[] = [];

  for (const obs of observed) {
    const before = prevMap.get(obs.address);
    if (!before) {
      // 残高・nonce がまだ取れていない新規ウォレットは、誤解を招く暫定値
      // （0）を見せないよう、値が取れる次周期まで追加を保留する。
      if (obs.balance === undefined || obs.nonce === undefined) continue;
      const entity: WalletEntity = {
        kind: "wallet",
        address: obs.address,
        chainType,
        balance: obs.balance,
        nonce: obs.nonce,
        isSmartAccount: false,
        ownerWorkbenchId: obs.ownerWorkbenchId,
        recentTxHashes: [],
      };
      events.push({ type: "entityAdded", entity });
      continue;
    }
    const after: WalletEntity = {
      ...before,
      ownerWorkbenchId: obs.ownerWorkbenchId,
      balance: obs.balance ?? before.balance,
      nonce: obs.nonce ?? before.nonce,
    };
    const patch = fieldPatch(before, after);
    if (patch) events.push({ type: "entityUpdated", id: obs.address, patch });
  }

  for (const w of prev) {
    if (!observedAddresses.has(w.address) && w.ownerWorkbenchId !== null) {
      events.push({
        type: "entityUpdated",
        id: w.address,
        patch: { ownerWorkbenchId: null },
      });
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
