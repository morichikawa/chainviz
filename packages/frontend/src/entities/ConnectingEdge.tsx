import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
} from "@xyflow/react";
import { useLanguage } from "../i18n/LanguageProvider.js";
import type { ConnectingFlowEdge } from "./connectingEdge.js";

/**
 * 実カード到着後、まだ実 PeerEdge が1本も届いていないノードから、対応する
 * ブートノードへ向けて描く「接続確立中」の仮エッジ（Issue #123 UX設計
 * §4-4）。ラベルに「P2P接続を確立中…」を添えて、孤立カードに見えてしまう
 * 期間中も「今まさに繋がりつつある」ことを伝える。
 */
export function ConnectingEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps<ConnectingFlowEdge>) {
  const { t } = useLanguage();
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} />
      <EdgeLabelRenderer>
        <div
          className="connecting-edge__label"
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "none",
          }}
        >
          {t("edge.connecting")}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
