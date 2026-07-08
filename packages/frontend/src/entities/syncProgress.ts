import type { NodeEntity, SyncStageProgress } from "@chainviz/shared";

/**
 * ノードカード/ポップオーバーの同期ステージ表示（ARCHITECTURE.md §7.6.5）に
 * 使う純粋関数群。「EL ノードかどうか」を `clientType` の文字列判定（reth/geth。
 * `InfraPopover.tsx` の `clientGlossaryKey` が使う判定）ではなく
 * `internals.syncStages` の有無で決める。理由は
 * `docs/worklog/issue-189.md`（設計メモ）参照。ChainAdapter がステージ型同期を
 * 報告できるノードにのみ `syncStages` を積む設計（`NodeInternals` の
 * docstring）なので、この判定はチェーン固有の語彙を持ち込まずに済む。
 */

/**
 * キャンバス上の全 EL ノードの blockHeight 最大値（同期ステージのミニバーの
 * 分母。§7.6.5「チェーン先端を別途観測する追加配線は作らない」）。
 * 該当ノードが1件も無ければ 0（呼び出し側はバーを出さずcheckpointの数値のみ
 * にするフォールバックへ倒す）。
 */
export function computeMaxSyncTargetHeight(
  nodes: Iterable<NodeEntity>,
): number {
  let max = 0;
  for (const node of nodes) {
    if (node.internals?.syncStages === undefined) continue;
    if (node.blockHeight > max) max = node.blockHeight;
  }
  return max;
}

/**
 * カード面に出す「現在のステージ」を導出する（§7.6.5「配列順で最初の
 * 『checkpoint < 目標高』のステージ」。パイプラインは先頭から順に進むため、
 * これが実行中の段階の近似になる）。
 *
 * `targetHeight` が0（全 EL ノードの blockHeight が不明。実運用ではまず
 * 起こらない）の場合は比較のしようがないため、配列の先頭（パイプラインの
 * 最初のステージ）を返すフォールバックにする。呼び出し側は `targetHeight`
 * が0ならバーを出さずステージ名+checkpointのみを表示するため、この
 * フォールバックが実際の見た目を壊すことはない。
 */
export function findCurrentSyncStage(
  stages: readonly SyncStageProgress[],
  targetHeight: number,
): SyncStageProgress | undefined {
  if (stages.length === 0) return undefined;
  if (targetHeight <= 0) return stages[0];
  const inProgress = stages.find((stage) => stage.checkpoint < targetHeight);
  // 全ステージが目標高へ追いついている（= 同期完了）場合は最後のステージを
  // 「現在」として返す。カード面はそもそも syncStatus === "syncing" のときのみ
  // 呼び出すため、この分岐に実際に到達するのは synced 直前の一瞬程度になる。
  return inProgress ?? stages[stages.length - 1];
}
