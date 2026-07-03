import type { PeerEdge, WorldStateEntity } from "../world-state/index.js";

export type DiffEvent =
  | { type: "entityAdded"; entity: WorldStateEntity }
  | { type: "entityUpdated"; id: string; patch: Partial<WorldStateEntity> }
  | { type: "entityRemoved"; id: string }
  | { type: "edgeAdded"; edge: PeerEdge }
  | {
      type: "edgeRemoved";
      fromNodeId: string;
      toNodeId: string;
      networkId: string;
    };
