import type { WorldStateSnapshot } from "@chainviz/shared";

export function createEmptySnapshot(): WorldStateSnapshot {
  return {
    chainType: "ethereum",
    timestamp: Date.now(),
    entities: [],
    edges: [],
  };
}
