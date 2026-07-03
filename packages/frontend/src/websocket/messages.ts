import type { ClientMessage, Command, ServerMessage } from "@chainviz/shared";

/**
 * サーバーから届いた生テキストを ServerMessage にパースする。
 * JSON でない、または既知の type でない場合は null を返す（例外は投げない）。
 */
export function parseServerMessage(raw: string): ServerMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const msg = parsed as Record<string, unknown>;
  switch (msg.type) {
    case "snapshot":
      return msg.payload && typeof msg.payload === "object"
        ? (parsed as ServerMessage)
        : null;
    case "diff":
      return Array.isArray(msg.payload) ? (parsed as ServerMessage) : null;
    case "commandResult":
      return typeof msg.commandId === "string" && typeof msg.ok === "boolean"
        ? (parsed as ServerMessage)
        : null;
    default:
      return null;
  }
}

/** 操作コマンドを ClientMessage の JSON テキストにする。 */
export function serializeCommand(commandId: string, command: Command): string {
  const message: ClientMessage = { type: "command", commandId, command };
  return JSON.stringify(message);
}
