import { useEffect, useRef, useState } from "react";
import { isFreshBlock } from "./blockPulse.js";
import type { ChainRibbonTile } from "./chainRibbon.js";

/**
 * 新タイルの「着地」演出（数百ms程度のスライド+発光。ARCHITECTURE.md §9.3、
 * docs/worklog/issue-298.md §4.3）をどれくらいの時間続けるか。UI 上の演出
 * 時間という固定 UX 値であり、実行環境の状態から動的に導出する量ではない
 * （useNewArrivalHighlight.ts の NEW_ARRIVAL_HIGHLIGHT_DURATION_MS と同じ
 * 位置づけ）。
 */
export const RIBBON_LANDING_DURATION_MS = 600;

/**
 * リボンのタイル列を監視し、新しく現れたタイルの hash を一定時間だけ
 * 「着地中」として返すフック（`useNewArrivalHighlight.ts` と同じ形の
 * React/タイマー側の責務）。
 *
 * `isFreshBlock`（`blockPulse.ts` の既存鮮度ガード）を再利用し、
 * 再接続時のスナップショットで一斉に届いた過去分はアニメーションしない
 * （ARCHITECTURE.md §9.3）。初回レンダー（まだ基準が無い状態）は
 * 「今あるタイル集合」をそのまま基準にするだけで着地アニメーションは
 * 発生させない（useNewArrivalHighlight の ready ガードと同じ狙いだが、
 * こちらは常時マウントされているカードのため接続確立フラグは要らず、
 * 初回 effect 呼び出し自体を基準にできる）。
 */
export function useRibbonLanding(tiles: ChainRibbonTile[]): Set<string> {
  const [landing, setLanding] = useState<Set<string>>(new Set());
  const knownRef = useRef<Set<string> | null>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const now = Date.now();
    const currentHashes = new Set(tiles.map((tile) => tile.block.hash));

    if (knownRef.current === null) {
      // 初回呼び出しを基準にする（既存タイルは着地アニメーションしない）。
      knownRef.current = currentHashes;
      return;
    }

    const known = knownRef.current;
    const arrived = tiles.filter(
      (tile) => !known.has(tile.block.hash) && isFreshBlock(tile.block, now),
    );
    knownRef.current = currentHashes;
    if (arrived.length === 0) return;

    setLanding((current) => {
      const next = new Set(current);
      for (const tile of arrived) next.add(tile.block.hash);
      return next;
    });

    const timers = timersRef.current;
    for (const tile of arrived) {
      const hash = tile.block.hash;
      const timer = setTimeout(() => {
        timers.delete(hash);
        setLanding((current) => {
          if (!current.has(hash)) return current;
          const next = new Set(current);
          next.delete(hash);
          return next;
        });
      }, RIBBON_LANDING_DURATION_MS);
      timers.set(hash, timer);
    }
  }, [tiles]);

  // アンマウント時に残っているタイマーをまとめて破棄する。
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return landing;
}
