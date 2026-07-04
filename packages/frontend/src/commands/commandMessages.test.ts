import type { Command } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { translate } from "../i18n/i18n.js";
import type { MessageKey } from "../i18n/messages.js";
import {
  DEFAULT_WORKBENCH_LABEL,
  describeCommandError,
  resolveWorkbenchLabel,
} from "./commandMessages.js";

const tJa = (key: MessageKey) => translate(key, "ja");
const tEn = (key: MessageKey) => translate(key, "en");

describe("resolveWorkbenchLabel", () => {
  it("trims surrounding whitespace", () => {
    expect(resolveWorkbenchLabel("  Alice  ")).toBe("Alice");
  });

  it("falls back to the default label when empty or blank", () => {
    expect(resolveWorkbenchLabel("")).toBe(DEFAULT_WORKBENCH_LABEL);
    expect(resolveWorkbenchLabel("   ")).toBe(DEFAULT_WORKBENCH_LABEL);
  });

  it("treats tabs and newlines as blank whitespace", () => {
    expect(resolveWorkbenchLabel("\t")).toBe(DEFAULT_WORKBENCH_LABEL);
    expect(resolveWorkbenchLabel("\n")).toBe(DEFAULT_WORKBENCH_LABEL);
    expect(resolveWorkbenchLabel("\t\n \r")).toBe(DEFAULT_WORKBENCH_LABEL);
  });

  it("preserves whitespace between words while trimming the edges", () => {
    expect(resolveWorkbenchLabel("  Alice   Bob  ")).toBe("Alice   Bob");
  });

  it("keeps special characters and emoji intact", () => {
    expect(resolveWorkbenchLabel("  <script>&#  ")).toBe("<script>&#");
    expect(resolveWorkbenchLabel(" 🚀ノード ")).toBe("🚀ノード");
  });

  it("does not truncate a very long label", () => {
    const long = "x".repeat(5000);
    expect(resolveWorkbenchLabel(`  ${long}  `)).toBe(long);
  });
});

describe("describeCommandError", () => {
  it("uses the per-action message for each command", () => {
    const cases: [Command, string][] = [
      [{ action: "addNode", chainProfile: "ethereum" }, "ノードの追加に失敗しました"],
      [{ action: "removeNode", nodeId: "reth-node-1" }, "ノードの削除に失敗しました"],
      [{ action: "addWorkbench", label: "x" }, "ワークベンチの追加に失敗しました"],
      [
        { action: "removeWorkbench", workbenchId: "wb-1" },
        "ワークベンチの削除に失敗しました",
      ],
    ];
    for (const [command, expected] of cases) {
      expect(describeCommandError(command, undefined, tJa)).toBe(expected);
    }
  });

  it("appends the collector error detail when present", () => {
    const message = describeCommandError(
      { action: "removeNode", nodeId: "reth-node-1" },
      "cannot remove a validator node",
      tEn,
    );
    expect(message).toBe("Failed to remove node: cannot remove a validator node");
  });

  it("ignores blank error details", () => {
    const message = describeCommandError(
      { action: "addNode", chainProfile: "ethereum" },
      "   ",
      tEn,
    );
    expect(message).toBe("Failed to add node");
  });

  it("falls back to a generic message when the command is unknown", () => {
    expect(describeCommandError(undefined, undefined, tJa)).toBe(
      "コマンドの実行に失敗しました",
    );
  });

  it("appends the detail even when the command is unknown", () => {
    expect(describeCommandError(undefined, "boom", tEn)).toBe(
      "Command failed: boom",
    );
  });

  it("treats an empty-string error the same as a missing one", () => {
    expect(
      describeCommandError({ action: "addNode", chainProfile: "ethereum" }, "", tEn),
    ).toBe("Failed to add node");
  });

  it("trims surrounding whitespace from the appended detail", () => {
    expect(
      describeCommandError(
        { action: "removeNode", nodeId: "reth-node-1" },
        "  boom  ",
        tEn,
      ),
    ).toBe("Failed to remove node: boom");
  });
});
