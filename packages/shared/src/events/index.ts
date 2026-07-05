import type {
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
  | { type: "operationObserved"; edge: OperationEdge };
