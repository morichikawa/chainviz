import type { BlockEntity } from "@chainviz/shared";
import { useEffect, useRef, useState } from "react";
import {
  type ActivePulse,
  computeBlockPulses,
  isFreshBlock,
  pulseSeenKey,
} from "./blockPulse.js";
import type { PeerFlowEdge } from "./peerEdge.js";

/**
 * ブロックの受信時刻更新を監視し、実データに基づくパルスをエッジ上へ
 * 走らせるためのフック。純粋なタイミング計算は `blockPulse.ts` に置き、
 * ここは「新しい伝播区間の検知・実時間へのスケジューリング・後片付け」という
 * React / タイマー側の責務だけを持つ。
 *
 * 波の見え方は2通りの経路で自然に立ち上がる:
 * - 差分がノードごとに逐次届く場合: 各区間は受信のたびに検知されるため、
 *   collector から届くタイミングそのものが実際の伝播スタッガーになる。
 * - 複数ノード分の受信が1回の差分にまとまって届く場合: 各区間の `startDelayMs`
 *   （波の起点からの出発遅延）を使って、ブラウザ側でスタッガーを再現する。
 */
export function useBlockPulses(
  blocks: BlockEntity[],
  edges: PeerFlowEdge[],
): ActivePulse[] {
  const [active, setActive] = useState<ActivePulse[]>([]);

  // スケジュール済みの伝播区間（ブロック → エッジ集合）。再スケジュールを防ぐ。
  const seenRef = useRef<Map<string, Set<string>>>(new Map());
  // ブロックごとの波の起点に対応するブラウザ時刻（初回検知時にアンカーする）。
  const anchorRef = useRef<Map<string, number>>(new Map());
  // 実行中のタイマー。アンマウント時にまとめて破棄する。
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const seqRef = useRef(0);

  // computeBlockPulses に渡す最新のエッジ集合。エッジ変化では再スケジュールせず、
  // 次のブロック更新時に最新のエッジを参照させる（deps を blocks に絞るため）。
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  useEffect(() => {
    const now = Date.now();
    const seen = seenRef.current;
    const anchors = anchorRef.current;
    const timers = timersRef.current;
    const liveHashes = new Set<string>();

    for (const block of blocks) {
      liveHashes.add(block.hash);
      if (!isFreshBlock(block, now)) continue;

      if (!anchors.has(block.hash)) anchors.set(block.hash, now);
      const anchor = anchors.get(block.hash) ?? now;

      let seenEdges = seen.get(block.hash);
      if (!seenEdges) {
        seenEdges = new Set();
        seen.set(block.hash, seenEdges);
      }

      for (const seg of computeBlockPulses(block, edgesRef.current)) {
        if (seenEdges.has(seg.edgeId)) continue;
        seenEdges.add(seg.edgeId);

        const key = `${pulseSeenKey(block.hash, seg.edgeId)}#${seqRef.current++}`;
        const elapsed = now - anchor;
        const startOffset = Math.max(0, seg.startDelayMs - elapsed);

        const startTimer = setTimeout(() => {
          timers.delete(startTimer);
          setActive((cur) => [
            ...cur,
            {
              key,
              edgeId: seg.edgeId,
              reverse: seg.reverse,
              durationMs: seg.durationMs,
            },
          ]);
          const endTimer = setTimeout(() => {
            timers.delete(endTimer);
            setActive((cur) => cur.filter((p) => p.key !== key));
          }, seg.durationMs);
          timers.add(endTimer);
        }, startOffset);
        timers.add(startTimer);
      }
    }

    // 現在のブロック集合から消えたハッシュのアンカー / 既知エッジを掃除する
    // （collector 側の直近ウィンドウから外れた過去ブロック）。
    for (const hash of anchors.keys()) {
      if (!liveHashes.has(hash)) anchors.delete(hash);
    }
    for (const hash of seen.keys()) {
      if (!liveHashes.has(hash)) seen.delete(hash);
    }
  }, [blocks]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return active;
}
