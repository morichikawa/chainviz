import type { WorldStateEntity } from "@chainviz/shared";

/**
 * `BlockEntity.receivedAt` の生キー1件を「実際に受信したノード」に正規化
 * したもの。
 */
export interface BlockReceipt {
  nodeId: string;
  receivedAt: number;
}

/**
 * `BlockEntity.receivedAt` の生キーから、EL/CLの2キー記録（Issue #141）に
 * よる重複を畳んで1論理ノード1エントリにする（Issue #317設計メモ §7.1
 * 候補(b)）。
 *
 * collector側 `executionTargets`（targets.ts）は、同じ受信1回につき対になる
 * beacon（CL）の stableId と自身（EL）の stableId の両方へ同じ時刻を書き込む
 * （`receivedAtKeys: [beaconStableId, obs.stableId]`）。beacon 側は
 * `NodeEntity.drivesNodeId` で対になる execution ノードを指しているため、
 * 「自分が駆動する相手のキーが同じ receivedAt に同じ時刻で存在する」場合は
 * 駆動する側（beacon）のキーをエイリアスとして除外し、駆動される側
 * （execution）のキーだけを残す。
 *
 * この判定は `drivesNodeId` という汎用スキーマの構造だけを見ており、
 * "execution"/"consensus" のようなロール名の文字列を一切参照しない
 * （CLAUDE.mdの ChainAdapter 境界どおり、チェーン固有解釈をこの関数に
 * 持ち込まない）。
 */
export function dedupeBlockReceipts(
  receivedAt: Readonly<Record<string, number>>,
  entities: Readonly<Record<string, WorldStateEntity>>,
): BlockReceipt[] {
  const receipts: BlockReceipt[] = [];
  for (const [nodeId, timestamp] of Object.entries(receivedAt)) {
    if (!Number.isFinite(timestamp)) continue; // 未受信（NaN/Infinity）は無視する

    const entity = entities[nodeId];
    const drivesNodeId =
      entity !== undefined && entity.kind === "node" ? entity.drivesNodeId : undefined;
    if (drivesNodeId !== undefined && receivedAt[drivesNodeId] === timestamp) {
      continue; // 駆動する側（beacon）のエイリアスキー。駆動される側で計上済み。
    }
    receipts.push({ nodeId, receivedAt: timestamp });
  }
  return receipts;
}
