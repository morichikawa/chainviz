import type { BlockEntity } from "@chainviz/shared";
import { useEffect, useMemo, useState } from "react";
import {
  type BlockCadenceProgress,
  computeBlockCadenceProgress,
  deriveBlockCadence,
} from "./blockCadence.js";

/**
 * 表示粒度（秒単位のカウントダウン）に対して十分な tick 間隔（ms）。
 * `useRibbonLanding.ts` の演出時間と同様、実行環境の状態から動的に導出する
 * 量ではない固定 UX 値（docs/worklog/issue-343.md §4）。
 */
const TICK_INTERVAL_MS = 250;

/**
 * ブロック生成タイミングのインジケータ（Issue #343。ARCHITECTURE.md §10.5）の
 * React/タイマー側の責務。`ChainRibbonCard` から直近ブロック集合を受け取り、
 * 残り時間・進捗・停滞状態を tick ごとに再計算して返す。
 *
 * 導出（`deriveBlockCadence`。interval/anchor の算出）はブロック集合
 * （`blocks`）が変わったときだけ実行し、毎 tick は剰余計算
 * （`computeBlockCadenceProgress`）だけを行う（設計メモ §4）。導出が
 * 不成立（null）ならインジケータ非表示を意味する `null` を返し、tick も
 * 起動しない。
 */
export function useBlockCadence(
  blocks: readonly BlockEntity[],
): BlockCadenceProgress | null {
  const cadence = useMemo(() => deriveBlockCadence(blocks, Date.now()), [blocks]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!cadence) return;
    // cadence が変わった（新しいブロックが観測された等）直後は tick を
    // 待たず即座に最新時刻へ揃える。
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [cadence]);

  if (!cadence) return null;
  return computeBlockCadenceProgress(cadence, now);
}
