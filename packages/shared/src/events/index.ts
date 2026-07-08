import type {
  NodeLinkActivity,
  OperationEdge,
  PeerEdge,
  WorldStateEntity,
} from "../world-state/index.js";

export type DiffEvent =
  | { type: "entityAdded"; entity: WorldStateEntity }
  | { type: "entityUpdated"; id: string; patch: Partial<WorldStateEntity> }
  | { type: "entityRemoved"; id: string }
  // edgeAdded / edgeRemoved は永続的なピア接続（PeerEdge）の状態遷移専用。
  // エッジの同一性キーは from/to/networkId の 3 つ組。
  | { type: "edgeAdded"; edge: PeerEdge }
  | {
      type: "edgeRemoved";
      fromNodeId: string;
      toNodeId: string;
      networkId: string;
    }
  // operationObserved は 1 回きりの観測イベント（揮発性）。スナップショット・
  // store の状態には畳み込まれず、対応する削除イベントも存在しない
  // （描画側が受信時にパルス等として消費し、自身のタイミングで消す）。
  | { type: "operationObserved"; edge: OperationEdge }
  // nodeLinkActivity は駆動リンク（NodeEntity.drivesNodeId）上の内部 API
  // 呼び出しの観測イベント（揮発性。D層）。operationObserved と同じく
  // スナップショット・store の状態には畳み込まれず、描画側が受信時に
  // パルス等として消費する。1 回の呼び出しごとではなく観測間隔内の増分と
  // して届く点が operationObserved と異なる（NodeLinkActivity 参照）。
  | { type: "nodeLinkActivity"; activity: NodeLinkActivity };
