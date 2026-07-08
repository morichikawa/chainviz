import type { Command, NodeEntity, WorkbenchEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { translate } from "../i18n/i18n.js";
import type { MessageKey } from "../i18n/messages.js";
import {
  DEFAULT_WORKBENCH_LABEL,
  describeCommandError,
  resolveAddNodeHint,
  resolveAddWorkbenchHint,
  resolveWorkbenchLabel,
  resolveWorkbenchOperationsHint,
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
      [
        {
          action: "runWorkbenchOperation",
          workbenchId: "wb-1",
          operation: { type: "transfer", to: "0xbob", amount: "1" },
        },
        "ワークベンチ操作の実行に失敗しました",
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

function node(overrides: Partial<NodeEntity> = {}): NodeEntity {
  return {
    kind: "node",
    id: "reth-1",
    containerName: "chainviz-reth-1",
    ip: "172.20.0.2",
    ports: [8545],
    resources: { cpuPercent: 1, memMB: 100 },
    process: { name: "reth node" },
    chainType: "ethereum",
    clientType: "reth",
    syncStatus: "synced",
    blockHeight: 1,
    headBlockHash: "0x0",
    ...overrides,
  };
}

function workbench(overrides: Partial<WorkbenchEntity> = {}): WorkbenchEntity {
  return {
    kind: "workbench",
    id: "wb-1",
    containerName: "chainviz-wb-1",
    ip: "172.20.0.9",
    ports: [],
    resources: { cpuPercent: 0, memMB: 10 },
    process: { name: "foundry" },
    label: "Alice",
    walletIds: [],
    ...overrides,
  };
}

describe("resolveAddNodeHint (Issue #123 §4-1)", () => {
  it("interpolates both bootnode container names when both are resolvable", () => {
    const elBoot = node({ id: "reth-1", containerName: "chainviz-reth-1", clientType: "reth", p2pRole: "bootnode" });
    const clBoot = node({
      id: "lh-1",
      containerName: "chainviz-lighthouse-1",
      clientType: "lighthouse",
      p2pRole: "bootnode",
    });
    const message = resolveAddNodeHint([elBoot, clBoot], tJa);
    expect(message).toContain("chainviz-reth-1");
    expect(message).toContain("chainviz-lighthouse-1");
    expect(message).not.toBe(tJa("action.addNode.hint.generic"));
  });

  it("falls back to the generic hint when only the execution bootnode is known", () => {
    const elBoot = node({ id: "reth-1", clientType: "reth", p2pRole: "bootnode" });
    expect(resolveAddNodeHint([elBoot], tJa)).toBe(tJa("action.addNode.hint.generic"));
  });

  it("falls back to the generic hint when only the consensus bootnode is known", () => {
    // execution-only の対称ケース。片方だけ埋めた半端な文言は誤解を招くため、
    // 両方揃わなければ generic に倒す（§4-5）。
    const clBoot = node({ id: "lh-1", clientType: "lighthouse", p2pRole: "bootnode" });
    expect(resolveAddNodeHint([clBoot], tJa)).toBe(tJa("action.addNode.hint.generic"));
  });

  it("falls back to the generic hint when no bootnode is known (Issue #123 §4-5)", () => {
    expect(resolveAddNodeHint([], tEn)).toBe(tEn("action.addNode.hint.generic"));
  });

  it("renders the English hint text", () => {
    const elBoot = node({ id: "reth-1", clientType: "reth", p2pRole: "bootnode" });
    const clBoot = node({ id: "lh-1", clientType: "lighthouse", p2pRole: "bootnode" });
    const message = resolveAddNodeHint([elBoot, clBoot], tEn);
    expect(message).toContain("as bootnodes");
    expect(message).toContain(elBoot.containerName);
  });
});

describe("resolveAddWorkbenchHint (Issue #123 §4-1)", () => {
  it("interpolates the resolved RPC target container name", () => {
    const target = node({ id: "reth-1", containerName: "chainviz-reth-1" });
    const wb = workbench({ rpcTargetNodeId: "reth-1" });
    const message = resolveAddWorkbenchHint([target, wb], tJa);
    expect(message).toContain("chainviz-reth-1");
    expect(message).not.toBe(tJa("action.addWorkbench.hint.generic"));
  });

  it("falls back to the generic hint when no RPC target is resolvable (Issue #123 §4-5)", () => {
    expect(resolveAddWorkbenchHint([], tEn)).toBe(
      tEn("action.addWorkbench.hint.generic"),
    );
  });
});

describe("resolveWorkbenchOperationsHint (ARCHITECTURE.md §6.5)", () => {
  it("interpolates the RPC target container name when resolved", () => {
    const message = resolveWorkbenchOperationsHint("chainviz-reth-1", tJa);
    expect(message).toContain("chainviz-reth-1");
    expect(message).not.toBe(tJa("action.workbenchOperations.hint.generic"));
  });

  it("falls back to the generic hint when the RPC target is unresolved", () => {
    expect(resolveWorkbenchOperationsHint(undefined, tEn)).toBe(
      tEn("action.workbenchOperations.hint.generic"),
    );
  });

  it("renders the English hint text", () => {
    const message = resolveWorkbenchOperationsHint("chainviz-reth-1", tEn);
    expect(message).toContain("chainviz-reth-1");
    expect(message).toContain("cast / forge");
  });
});
