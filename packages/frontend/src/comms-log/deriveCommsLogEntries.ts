import type {
  BlockEntity,
  DiffEvent,
  TransactionEntity,
  WorldStateEntity,
} from "@chainviz/shared";
import { applyDiff, type WorldState } from "../world-state/store.js";
import { dedupeBlockReceipts } from "./blockReceiptDedup.js";
import type { CommsLogEntry } from "./commsLogEntry.js";
import { resolveActorLabel } from "./resolveActorLabel.js";

/**
 * 差分イベント列から通信ログのエントリを導出する純関数（Issue #317設計メモ
 * §7.1）。`useWorldState` の `onDiff` 到着時、`applyDiff` 適用前の
 * `prevState` を渡して呼ぶ想定（receivedAt の増分検出・tx の status 遷移
 * 検出に prevState が要る）。
 *
 * 表示名の解決は「適用後（prevState + events）」の世界を優先しつつ、
 * `entityRemoved` で消えた対象（環境カテゴリの削除イベント・切断した
 * PeerEdgeの端点）は prevState 側にしか残っていないため、両者をマージした
 * 索引を使う（後勝ち = 新しい情報を優先）。
 *
 * 増分検出（block の receivedAt・tx の status 遷移）は「1件前の event まで
 * 適用した state」を基準にする（`running`。event を1件ずつ `applyDiff` して
 * 進める）。events 全体の直前（`prevState`）を基準に固定してしまうと、同じ
 * バッチ内で「ブロックの entityAdded → 直後の entityUpdated（receivedAt
 * 追記）」のように同一エンティティへの複数イベントが連続するケース
 * （collector・モックの両方で起こりうる。モックの `advanceChain` が典型例）
 * で、後段の entityUpdated が「まだ存在しないエンティティの更新」として
 * 静かに無視されてしまう（実際にモックモードでの目視確認でこの欠落を
 * 発見した）。
 *
 * 戻り値は「新しい順（timestamp 降順）」。同一 events 列からは複数件
 * 生まれうる（例: 1ブロックを複数ノードがほぼ同時に受信）。
 *
 * スナップショット適用時は呼ばないこと（設計メモ §7.1「diff由来のみ」。
 * 接続状態変化は `useCommsLog` が別途 `noteConnectionStatus` で扱う）。
 */
export function deriveCommsLogEntries(
  prevState: WorldState,
  events: DiffEvent[],
  now: number,
): CommsLogEntry[] {
  const finalState = applyDiff(prevState, events);
  const entities: Record<string, WorldStateEntity> = {
    ...prevState.entities,
    ...finalState.entities,
  };

  const out: CommsLogEntry[] = [];
  let seq = 0;
  const nextId = (category: string) => `${category}-${now}-${seq++}`;

  // このバッチ内で「今処理しているイベントの直前」の state。イベントを
  // 1件処理するたびに、そのイベントだけを適用して1件ずつ進める。
  let running = prevState;

  for (const event of events) {
    switch (event.type) {
      case "operationObserved": {
        const { fromWorkbenchId, toNodeId, operation, observedAt, outcome, durationMs } =
          event.edge;
        out.push({
          id: nextId("operation"),
          category: "operation",
          timestamp: observedAt,
          actorIds: [fromWorkbenchId, toNodeId],
          workbenchId: fromWorkbenchId,
          workbenchLabel: resolveActorLabel(entities, fromWorkbenchId),
          nodeId: toNodeId,
          nodeLabel: resolveActorLabel(entities, toNodeId),
          method: operation,
          outcome,
          durationMs,
        });
        break;
      }

      case "nodeLinkActivity": {
        const { fromNodeId, toNodeId, calls, observedAt } = event.activity;
        if (calls.length === 0) break; // 増分ゼロは記録しない(通常は届かない設計。念のためのガード)
        out.push({
          id: nextId("internal"),
          category: "internal",
          timestamp: observedAt,
          actorIds: [fromNodeId, toNodeId],
          fromNodeId,
          fromLabel: resolveActorLabel(entities, fromNodeId),
          toNodeId,
          toLabel: resolveActorLabel(entities, toNodeId),
          calls: calls.map((call) => ({
            method: call.method,
            count: call.count,
            latencyMs: call.latencyMs,
          })),
        });
        break;
      }

      case "entityAdded": {
        const { entity } = event;
        if (entity.kind === "block") {
          // 通常は新規ブロックなので prior は {} だが、念のため running 側の
          // 既存値があればそれを優先する（entityRemoved を経ずに同一 hash が
          // 再度 entityAdded されるような通常起きないケースへの防御）。
          const priorBlock = running.entities[entity.hash];
          const priorReceivedAt = priorBlock?.kind === "block" ? priorBlock.receivedAt : {};
          out.push(
            ...deriveBlockReceiptEntries(
              entity.hash,
              entity.number,
              priorReceivedAt,
              entity.receivedAt,
              entities,
              nextId,
            ),
          );
        } else if (entity.kind === "transaction") {
          out.push(deriveTxEntry(entity.hash, entity.status, entity.blockHash, entities, now, nextId));
        } else if (entity.kind === "node") {
          out.push(
            buildEnvironmentEntry("nodeAdded", entity.id, entity.containerName, now, nextId),
          );
        } else if (entity.kind === "workbench") {
          out.push(buildEnvironmentEntry("workbenchAdded", entity.id, entity.label, now, nextId));
        } else if (entity.kind === "contract") {
          out.push(
            buildEnvironmentEntry("contractDeployed", entity.address, entity.name, now, nextId),
          );
        }
        // wallet: 設計メモ §7.1 の対象外（記録しない）。
        break;
      }

      case "entityUpdated": {
        // event.patch は `Partial<WorldStateEntity>`（entityAdded の
        // `event.entity` と違い、対象 kind を静的に絞り込めない疎な差分）
        // のため、before.kind による絞り込みが済んだ後にその kind の
        // Partial 型へキャストしてからフィールドへアクセスする
        // （`applyDiff` 側の `{ ...existing, ...event.patch } as
        // WorldStateEntity` と同じ、ランタイムの kind 一致を前提にした
        // キャスト）。
        const before = running.entities[event.id];
        if (before?.kind === "block") {
          const patch = event.patch as Partial<BlockEntity>;
          if (patch.receivedAt !== undefined) {
            out.push(
              ...deriveBlockReceiptEntries(
                event.id,
                before.number,
                before.receivedAt,
                patch.receivedAt,
                entities,
                nextId,
              ),
            );
          }
        } else if (before?.kind === "transaction") {
          const patch = event.patch as Partial<TransactionEntity>;
          if (patch.status !== undefined) {
            const blockHash =
              patch.blockHash !== undefined ? patch.blockHash : before.blockHash;
            out.push(
              deriveTxEntry(before.hash, patch.status, blockHash, entities, now, nextId),
            );
          }
        }
        break;
      }

      case "entityRemoved": {
        const removed = running.entities[event.id];
        if (removed?.kind === "node") {
          out.push(
            buildEnvironmentEntry("nodeRemoved", removed.id, removed.containerName, now, nextId),
          );
        } else if (removed?.kind === "workbench") {
          out.push(
            buildEnvironmentEntry("workbenchRemoved", removed.id, removed.label, now, nextId),
          );
        } else if (removed?.kind === "contract") {
          out.push(
            buildEnvironmentEntry(
              "contractRemoved",
              removed.address,
              removed.name,
              now,
              nextId,
            ),
          );
        }
        break;
      }

      case "edgeAdded": {
        const { fromNodeId, toNodeId, networkId } = event.edge;
        out.push(buildPeerEntry("connected", fromNodeId, toNodeId, networkId, entities, now, nextId));
        break;
      }

      case "edgeRemoved": {
        const { fromNodeId, toNodeId, networkId } = event;
        out.push(
          buildPeerEntry("disconnected", fromNodeId, toNodeId, networkId, entities, now, nextId),
        );
        break;
      }

      default:
        break; // 未知のイベント型は無視する(前方互換。applyDiffと同じ流儀)。
    }

    // running を「このイベントまで適用した state」へ1件分だけ進める
    // （次のイベントの処理で「直前」として参照するため）。
    running = applyDiff(running, [event]);
  }

  out.sort((a, b) => b.timestamp - a.timestamp);
  return out;
}

function deriveBlockReceiptEntries(
  blockHash: string,
  blockNumber: number,
  prevReceivedAt: Readonly<Record<string, number>>,
  nextReceivedAt: Readonly<Record<string, number>>,
  entities: Readonly<Record<string, WorldStateEntity>>,
  nextId: (category: string) => string,
): CommsLogEntry[] {
  const receipts = dedupeBlockReceipts(nextReceivedAt, entities);
  if (receipts.length === 0) return [];
  const origin = Math.min(...receipts.map((receipt) => receipt.receivedAt));

  const out: CommsLogEntry[] = [];
  for (const receipt of receipts) {
    if (prevReceivedAt[receipt.nodeId] === receipt.receivedAt) continue; // 変化なし
    out.push({
      id: nextId("block"),
      category: "block",
      timestamp: receipt.receivedAt,
      actorIds: [receipt.nodeId],
      nodeId: receipt.nodeId,
      nodeLabel: resolveActorLabel(entities, receipt.nodeId),
      blockNumber,
      relativeDelayMs: receipt.receivedAt - origin,
      isOrigin: receipt.receivedAt === origin,
    });
  }
  return out;
}

function deriveTxEntry(
  hash: string,
  status: "pending" | "included" | "failed",
  blockHash: string | undefined,
  entities: Readonly<Record<string, WorldStateEntity>>,
  now: number,
  nextId: (category: string) => string,
): CommsLogEntry {
  const blockEntity = blockHash !== undefined ? entities[blockHash] : undefined;
  const blockNumber = blockEntity?.kind === "block" ? blockEntity.number : undefined;
  return {
    id: nextId("tx"),
    category: "tx",
    timestamp: now,
    actorIds: [],
    hash,
    status,
    blockNumber,
  };
}

function buildEnvironmentEntry(
  change:
    | "nodeAdded"
    | "nodeRemoved"
    | "workbenchAdded"
    | "workbenchRemoved"
    | "contractDeployed"
    | "contractRemoved",
  subjectId: string,
  subjectLabel: string | undefined,
  now: number,
  nextId: (category: string) => string,
): CommsLogEntry {
  return {
    id: nextId("environment"),
    category: "environment",
    timestamp: now,
    actorIds: [subjectId],
    subjectId,
    subjectLabel,
    change,
  };
}

function buildPeerEntry(
  change: "connected" | "disconnected",
  fromNodeId: string,
  toNodeId: string,
  networkId: string,
  entities: Readonly<Record<string, WorldStateEntity>>,
  now: number,
  nextId: (category: string) => string,
): CommsLogEntry {
  return {
    id: nextId("peer"),
    category: "peer",
    timestamp: now,
    actorIds: [fromNodeId, toNodeId],
    fromNodeId,
    fromLabel: resolveActorLabel(entities, fromNodeId),
    toNodeId,
    toLabel: resolveActorLabel(entities, toNodeId),
    networkId,
    change,
  };
}
