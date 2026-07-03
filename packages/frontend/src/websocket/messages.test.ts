import type { Command, WorldStateSnapshot } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { parseServerMessage, serializeCommand } from "./messages.js";

const snapshot: WorldStateSnapshot = {
  chainType: "ethereum",
  timestamp: 0,
  entities: [],
  edges: [],
};

describe("parseServerMessage", () => {
  it("parses a snapshot message", () => {
    const msg = parseServerMessage(JSON.stringify({ type: "snapshot", payload: snapshot }));
    expect(msg?.type).toBe("snapshot");
  });

  it("parses a diff message with an array payload", () => {
    const msg = parseServerMessage(
      JSON.stringify({ type: "diff", payload: [{ type: "entityRemoved", id: "n1" }] }),
    );
    expect(msg?.type).toBe("diff");
  });

  it("parses a commandResult message", () => {
    const msg = parseServerMessage(
      JSON.stringify({ type: "commandResult", commandId: "cmd-1", ok: true }),
    );
    expect(msg).toEqual({ type: "commandResult", commandId: "cmd-1", ok: true });
  });

  it("returns null for invalid JSON", () => {
    expect(parseServerMessage("{not json")).toBeNull();
  });

  it("returns null for unknown or malformed message types", () => {
    expect(parseServerMessage(JSON.stringify({ type: "nope" }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: "diff", payload: {} }))).toBeNull();
    expect(
      parseServerMessage(JSON.stringify({ type: "commandResult", commandId: 1, ok: "yes" })),
    ).toBeNull();
    expect(parseServerMessage(JSON.stringify("a string"))).toBeNull();
    expect(parseServerMessage(JSON.stringify(null))).toBeNull();
  });

  it("returns null for a numeric JSON payload", () => {
    expect(parseServerMessage("42")).toBeNull();
  });

  it("returns null when a snapshot payload is null or missing", () => {
    expect(parseServerMessage(JSON.stringify({ type: "snapshot", payload: null }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: "snapshot" }))).toBeNull();
  });

  it("accepts a diff message with an empty array payload", () => {
    const msg = parseServerMessage(JSON.stringify({ type: "diff", payload: [] }));
    expect(msg?.type).toBe("diff");
  });

  it("returns null when a message has no type field", () => {
    expect(parseServerMessage(JSON.stringify({ payload: [] }))).toBeNull();
  });
});

describe("serializeCommand", () => {
  it("wraps a command in a ClientMessage envelope", () => {
    const text = serializeCommand("cmd-9", { action: "addWorkbench", label: "Bob" });
    expect(JSON.parse(text)).toEqual({
      type: "command",
      commandId: "cmd-9",
      command: { action: "addWorkbench", label: "Bob" },
    });
  });

  it("round-trips every command action shape", () => {
    const commands: Command[] = [
      { action: "addNode", chainProfile: "ethereum" },
      { action: "removeNode", nodeId: "n1" },
      { action: "addWorkbench", label: "Alice" },
      { action: "removeWorkbench", workbenchId: "wb-1" },
    ];
    for (const command of commands) {
      const parsed = JSON.parse(serializeCommand("id", command));
      expect(parsed.command).toEqual(command);
    }
  });
});
