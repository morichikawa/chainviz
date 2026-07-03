import type { DiffEvent } from "../events/index.js";
import type { WorldStateSnapshot } from "../world-state/index.js";

export type Command =
  | { action: "addNode"; chainProfile: string }
  | { action: "removeNode"; nodeId: string }
  | { action: "addWorkbench"; label: string }
  | { action: "removeWorkbench"; workbenchId: string };

export type ServerMessage =
  | { type: "snapshot"; payload: WorldStateSnapshot }
  | { type: "diff"; payload: DiffEvent[] }
  | { type: "commandResult"; commandId: string; ok: boolean; error?: string };

export type ClientMessage = {
  type: "command";
  commandId: string;
  command: Command;
};
