// Beacon API の `GET /eth/v1/node/syncing`（Issue #274）から
// NodeEntity.syncStatus / blockHeight（CL ノードでは現状 pollInfra が常に
// "syncing" / 0 を書くだけの既知のギャップ。docs/ARCHITECTURE.md §7.3）を
// 導出するための、状態を持つキャッシュ。EL 用の sync-status.ts とは判定
// ロジック（他ノードとの最大値比較 vs ノード自身の自己申告フラグ）が
// 異なるため、同居させず別ファイルに分離する（1 ファイル 1 責務）。
// 設計の根拠・実測結果は docs/worklog/issue-274.md「設計メモ」を参照。
//
// 書き込みは pollNodeInternalsOnce の周期ポーリング（D層）から、読み出しは
// pollInfra（A層。toEntity）から行う。store への書き込みは既存の applyInfra
// 経路 1 本のまま変えない（sync-status.ts と同じ方針）。

import type { BeaconSyncingSnapshot } from "./beacon-api.js";
import type { ResolvedSyncStatus } from "./sync-status.js";

/**
 * ビーコンノードの自己申告フラグから syncStatus / blockHeight を導出する
 * 純関数。
 *
 * `is_syncing` / `el_offline` / `is_optimistic` の**いずれか 1 つでも
 * true なら `"syncing"`**、すべて false のときのみ `"synced"` とする。
 * `el_offline: true` は接続先 EL が落ちていて頭を進められない状態、
 * `is_optimistic: true` は EL 未検証のヘッドを楽観的に持っている状態で、
 * どちらも「健全に追従できている」とは言えないため保守的に "syncing" 側へ
 * 倒す（docs/worklog/issue-274.md 決定事項 3）。EL 側（sync-status.ts）の
 * ような他ノードとの checkpoint 比較は行わない（lighthouse 自身が先端追従を
 * 判定して返すため不要）。
 *
 * `blockHeight` には `headSlot`（ヘッドスロット）をそのまま入れる。EL の
 * ブロック高とは単位・意味が異なる値であることに注意（NodeEntity.blockHeight
 * のドキュメントコメント参照。フロント側で表示ラベルを役割に応じて
 * 切り替える）。
 */
export function resolveBeaconSyncStatus(
  raw: BeaconSyncingSnapshot,
): ResolvedSyncStatus {
  const synced = !raw.isSyncing && !raw.elOffline && !raw.isOptimistic;
  return {
    syncStatus: synced ? "synced" : "syncing",
    blockHeight: raw.headSlot,
  };
}

/**
 * D層観測（Beacon API の自己申告同期状態）から得た各 CL ノードの最新の
 * 解決済み同期状態を保持し、pollInfra が読み出すためのキャッシュ。
 * `NodeSyncStatusCache`（EL 用）と異なり、他ノードとの最大値比較を持たない
 * 単純な `stableId -> ResolvedSyncStatus` の保持のみ（判定は
 * `resolveBeaconSyncStatus` が観測のたびに完結させる）。
 */
export class BeaconSyncStatusCache {
  private readonly resolved = new Map<string, ResolvedSyncStatus>();

  /** 1ノード分の今回の D層観測（解決済み）を記録する。 */
  set(stableId: string, resolved: ResolvedSyncStatus): void {
    this.resolved.set(stableId, resolved);
  }

  /**
   * ノードが観測から消えた（removeNode 等）際に前回値を破棄する
   * （`NodeSyncStatusCache.forgetNode` と同じ後始末）。
   */
  forgetNode(stableId: string): void {
    this.resolved.delete(stableId);
  }

  /**
   * 指定ノードの blockHeight / syncStatus を解決する。まだ一度も D層観測が
   * 得られていなければ undefined（呼び出し側は pollInfra 既定のプレースホルダ
   * "syncing"/0 を使う）。
   */
  resolve(stableId: string): ResolvedSyncStatus | undefined {
    return this.resolved.get(stableId);
  }
}
