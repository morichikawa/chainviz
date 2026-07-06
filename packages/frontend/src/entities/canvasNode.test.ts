import type { NodeEntity, WalletEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { canvasNodeLayoutKey } from "./canvasNode.js";
import { createGhostNode } from "./ghostNode.js";
import type { InfraFlowNode } from "./infraNode.js";
import type { WalletFlowNode } from "./walletNode.js";

const node: NodeEntity = {
  kind: "node",
  id: "reth-1",
  containerName: "chainviz-reth-1",
  ip: "172.20.0.10",
  ports: [8545],
  resources: { cpuPercent: 1, memMB: 100 },
  process: { name: "reth" },
  chainType: "ethereum",
  clientType: "reth",
  syncStatus: "synced",
  blockHeight: 1,
  headBlockHash: "0x0",
};

const wallet: WalletEntity = {
  kind: "wallet",
  address: "0xabc",
  chainType: "ethereum",
  balance: "0",
  nonce: 0,
  isSmartAccount: false,
  ownerWorkbenchId: null,
  recentTxHashes: [],
};

describe("canvasNodeLayoutKey", () => {
  it("uses containerName for infra cards", () => {
    const infraNode: InfraFlowNode = {
      id: node.id,
      type: "infra",
      position: { x: 0, y: 0 },
      data: { entity: node },
    };
    expect(canvasNodeLayoutKey(infraNode)).toBe("chainviz-reth-1");
  });

  it("uses address for wallet cards", () => {
    const walletNode: WalletFlowNode = {
      id: wallet.address,
      type: "wallet",
      position: { x: 0, y: 0 },
      data: {
        entity: wallet,
        transactions: [],
        settlingHashes: [],
        ownerPresent: false,
      },
    };
    expect(canvasNodeLayoutKey(walletNode)).toBe("0xabc");
  });

  it("uses commandId for ghost cards (which are non-draggable so this is never persisted)", () => {
    const ghost = createGhostNode({
      commandId: "cmd-1",
      kind: "node",
      label: "ethereum",
      index: 0,
    });
    expect(canvasNodeLayoutKey(ghost)).toBe("cmd-1");
  });

  it("uses commandId for workbench ghosts too (kind does not change the key source)", () => {
    const ghost = createGhostNode({
      commandId: "cmd-9",
      kind: "workbench",
      label: "Carol",
      index: 3,
    });
    expect(canvasNodeLayoutKey(ghost)).toBe("cmd-9");
  });

  it("gives ghosts sharing a containerName-like label distinct keys (keyed by commandId, not label)", () => {
    // ラベルが同じでも commandId が違えばレイアウトキーは衝突しない。
    const a = createGhostNode({ commandId: "a", kind: "node", label: "ethereum", index: 0 });
    const b = createGhostNode({ commandId: "b", kind: "node", label: "ethereum", index: 1 });
    expect(canvasNodeLayoutKey(a)).not.toBe(canvasNodeLayoutKey(b));
  });
});
