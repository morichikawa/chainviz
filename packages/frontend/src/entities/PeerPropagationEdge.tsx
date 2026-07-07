import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
} from "@xyflow/react";
import { PeerEdgePopover } from "./PeerEdgePopover.js";
import type { PeerFlowEdge } from "./peerEdge.js";

/**
 * B層のピア接続（紐）を描くカスタムエッジ。通常時は `BaseEdge` で紐を1本
 * 引くだけだが、`data.pulses` に伝播パルスが載っている間は、その光の点を
 * CSS の `offset-path`（styles.css の `pulse-travel` キーフレーム）で
 * エッジ上に走らせる（Issue #125。旧 SVG `animateMotion` から移行。要素の
 * 動的挿入時に開始時刻がずれて即終端固定される SMIL のバグを回避するため）。
 *
 * パルスの進行方向・所要時間は `blockPulse.ts` が実データから算出し、
 * `useBlockPulses` が実時間にスケジュールして `data.pulses` へ流し込む。
 * ここは受け取ったパルスを描くだけで、タイミングの判断は持たない。
 *
 * `data.hovered`（Canvas.tsx がホバー中の紐の id を突き合わせて注入する。
 * Issue #124 B）が true の間は紐を太く強調し、中点付近に説明ポップオーバーを
 * 出す。パルスが走行中でも `BaseEdge` とパルスの `<circle>` はそのまま
 * 描画され続けるため、ホバーで表示が壊れることはない。
 */
export function PeerPropagationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  data,
}: EdgeProps<PeerFlowEdge>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const pulses = data?.pulses ?? [];
  const hovered = data?.hovered ?? false;
  const networkId = data?.networkId ?? "";
  const endpoints = data?.endpoints ?? ["", ""];

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        // ホバー中は strokeWidth を太くして「今どの紐を見ているか」を分かり
        // やすくする（Issue #124 B）。既定は peerEdge.ts が設定する 2。
        style={hovered ? { ...style, strokeWidth: 3.5 } : style}
        className={hovered ? "peer-edge--hovered" : undefined}
      />
      {pulses.map((pulse) => (
        // r は初期値(4)よりわずかに大きくし、ダーク背景での視認性を高めた
        // （Issue #32、CSS 側の drop-shadow 拡大とあわせて調整）。
        // アニメーションは CSS の offset-path（styles.css の pulse-travel）で
        // 行う。SMIL の animateMotion は begin 未指定だと文書タイムライン
        // 0秒起点で解決され、動的挿入時には再生済み扱いとなり fill=freeze で
        // 終端に固定されて一度も動かない（Issue #125）。
        <circle
          key={pulse.key}
          className="peer-pulse"
          r={5}
          style={{
            offsetPath: `path("${edgePath}")`,
            animationDuration: `${pulse.durationMs}ms`,
            animationDirection: pulse.reverse ? "reverse" : "normal",
          }}
        />
      ))}
      {hovered && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "none",
            }}
          >
            <PeerEdgePopover networkId={networkId} endpoints={endpoints} />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
