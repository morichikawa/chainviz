import type { WorldStateSnapshot } from "@chainviz/shared";

export function describeSnapshot(snapshot: WorldStateSnapshot): string {
  return `${snapshot.chainType}: ${snapshot.entities.length} entities`;
}
