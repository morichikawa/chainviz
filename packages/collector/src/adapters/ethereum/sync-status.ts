// D層観測（reth のステージ型同期の "Finish" checkpoint、Issue #185/#186）から
// NodeEntity.syncStatus / blockHeight（現状 pollInfra が常に "syncing" / 0 を
// 書くだけの既知のギャップ。docs/ARCHITECTURE.md §7.3）を導出するための、
// 状態を持つキャッシュ。設計の根拠・実測結果は docs/worklog/issue-187.md
// 「設計メモ」を参照。
//
// 書き込みは subscribeNodeInternals の周期ポーリング（D層）から、読み出しは
// pollInfra（A層。toEntity）から行う。store への書き込みは既存の applyInfra
// 経路 1 本のまま変えない（ARCHITECTURE §7.3「情報源はアダプタ内のキャッシュ
// とし、pollInfra がキャッシュから値を埋める」）。

import type { NodeInternals } from "@chainviz/shared";

/**
 * reth のステージ型同期パイプラインの最終段 "Finish" の checkpoint を
 * NodeInternals から取り出す。このステージはブロック高までフルに処理済みで
 * RPC から問い合わせ可能な状態を意味し、実測（docs/worklog/issue-187.md）で
 * `eth_blockNumber` と一致する（1 ブロック程度のずれはスクレイプと RPC 呼び
 * 出しのタイミング差）ことを確認済み。
 *
 * `syncStages` に "Finish" のサンプルが無い場合（reth のバージョン差・
 * 個別スクレイプの乱れで一時的に読めない等）は undefined を返す。呼び出し側
 * (`NodeSyncStatusCache.update`) はこの場合キャッシュを更新せず、前回値を
 * そのまま保持する（想定内の縮退。ログは出さない。reth-metrics.ts が既に
 * 個々のフィールドの欠落を「想定内」として扱っているのと同じ方針）。
 */
export function extractFinishCheckpoint(
  internals: NodeInternals,
): number | undefined {
  return internals.syncStages?.find((s) => s.stage === "Finish")?.checkpoint;
}

/**
 * 「追いついている（synced）」と判定する、他ノードとの checkpoint 差の許容量
 * （ブロック数）。この差を超えていれば "syncing" とみなす。
 *
 * 前提条件（CLAUDE.md「今この瞬間に観測できる状態に依存した固定値をロジックに
 * 埋め込まない」への対応）: この値はチェーンの絶対的な進行状態（稼働時間・
 * ブロック高そのもの）に依存しない「ノード間の相対的な遅れの許容量」であり、
 * チェーンがどれだけ長時間稼働してブロック高が伸びても意味が変わらない。
 * 根拠は実測（docs/worklog/issue-187.md）: 十分に追従済みの reth 同士でも、
 * 並行スクレイプのタイミングのずれにより一時的に数ブロックの差が生じる
 * （実測で最大 3 ブロック）。一方 addNode 直後のバックフィル中のノードとの
 * 差は実測で数百〜数千ブロックであり、この閾値とは桁が大きく異なるため
 * 誤判定の余地が無い。3 秒のスクレイプ間隔・slot time（現実の Ethereum に
 * 合わせ 12 秒）という前提の下でのジッター吸収分。slot time が長いほど単位
 * 時間あたりのブロック生成が減り、並行スクレイプのタイミングずれで生じる
 * ブロック差はむしろ小さくなるため、5 ブロックの許容量はより安全側に働く。
 * 逆に slot time をスクレイプ間隔より大幅に短くする場合は、1 スクレイプ間隔で
 * 生成されるブロック数が増えて誤判定しうるため見直しが必要（既存の
 * NODE_INTERNALS_POLL_INTERVAL_MS と同じ前提）。
 */
export const SYNCED_TOLERANCE_BLOCKS = 5;

/** pollInfra が読み出す、解決済みの同期状態。 */
export interface ResolvedSyncStatus {
  syncStatus: "syncing" | "synced";
  blockHeight: number;
}

/**
 * D層観測（reth の Finish checkpoint）から得た各 EL ノードの最新の既知の
 * ブロック高を保持し、pollInfra が読み出すためのキャッシュ。
 */
export class NodeSyncStatusCache {
  private readonly heights = new Map<string, number>();

  /**
   * 1ノード分の今回の D層観測を記録する。internals に Finish checkpoint が
   * 無ければ何もしない（前回値を保持する。恒久的にではなく、次周期の観測で
   * 更新される想定の一時的な縮退）。
   */
  update(stableId: string, internals: NodeInternals): void {
    const checkpoint = extractFinishCheckpoint(internals);
    if (checkpoint === undefined) return;
    this.heights.set(stableId, checkpoint);
  }

  /**
   * ノードが観測から消えた（removeNode 等）際に前回値を破棄する
   * （RethMetricsTracker.forgetNode と同じ後始末。他ノードの syncStatus
   * 判定の基準〈最大値〉に亡霊のように残り続けないようにする）。
   */
  forgetNode(stableId: string): void {
    this.heights.delete(stableId);
  }

  /**
   * 指定ノードの blockHeight / syncStatus を解決する。まだ一度も D層観測が
   * 得られていなければ undefined（呼び出し側は pollInfra 既定のプレースホルダ
   * "syncing"/0 を使う）。
   *
   * syncStatus は「今回までに観測できた全 EL ノードの中の最大 checkpoint」との
   * 差が SYNCED_TOLERANCE_BLOCKS 以内かどうかで決める。比較対象が自分しか
   * いない（単一ノード構成、または他ノードがまだ D層観測を経ていない）場合は、
   * 比較の基準が無いため常に "synced" とする（基準ノードが存在しない状況で
   * 恒久的に "syncing" 表示になり続けるのを避けるための既定側の倒し方）。
   */
  resolve(stableId: string): ResolvedSyncStatus | undefined {
    const height = this.heights.get(stableId);
    if (height === undefined) return undefined;

    let maxHeight = height;
    for (const h of this.heights.values()) {
      if (h > maxHeight) maxHeight = h;
    }
    const behind = maxHeight - height;

    return {
      blockHeight: height,
      syncStatus: behind <= SYNCED_TOLERANCE_BLOCKS ? "synced" : "syncing",
    };
  }
}
