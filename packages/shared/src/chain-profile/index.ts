import type { DiffEvent } from "../events/index.js";
import type {
  ChainType,
  PeerEdge,
  WorldStateSnapshot,
} from "../world-state/index.js";

export interface ChainAdapter {
  chainType: ChainType;
  pollInfra(): Promise<Partial<WorldStateSnapshot>>;
  subscribePeers(onUpdate: (edges: PeerEdge[]) => void): void;
  subscribeChainEvents(onEvent: (event: DiffEvent) => void): void;
}
