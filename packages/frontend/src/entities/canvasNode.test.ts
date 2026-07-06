import type { NodeEntity, WalletEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { canvasNodeLayoutKey, preserveMeasuredDimensions } from "./canvasNode.js";
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

function infraNode(overrides: Partial<InfraFlowNode> = {}): InfraFlowNode {
  return {
    id: node.id,
    type: "infra",
    position: { x: 0, y: 0 },
    data: { entity: node },
    ...overrides,
  };
}

describe("preserveMeasuredDimensions", () => {
  it("returns next unchanged when there is no previous state (initial mount)", () => {
    const next = [infraNode()];
    expect(preserveMeasuredDimensions(next, [])).toBe(next);
  });

  it("carries the previously measured size over to a node lacking measured (Issue #119)", () => {
    const previous = [infraNode({ measured: { width: 200, height: 77 } })];
    // 親（App.tsx）が組み立て直した、内容は同じだが参照は別の新しいノード。
    const next = [infraNode()];
    const result = preserveMeasuredDimensions(next, previous);
    expect(result[0].measured).toEqual({ width: 200, height: 77 });
    // 元の next 要素は書き換えず、新しいオブジェクトとして返す。
    expect(result[0]).not.toBe(next[0]);
  });

  it("keeps next's own measured value when it already has one", () => {
    const previous = [infraNode({ measured: { width: 200, height: 77 } })];
    const next = [infraNode({ measured: { width: 999, height: 999 } })];
    const result = preserveMeasuredDimensions(next, previous);
    expect(result[0]).toBe(next[0]);
    expect(result[0].measured).toEqual({ width: 999, height: 999 });
  });

  it("does not attach measured for a node with no matching previous id (newly added node)", () => {
    const previous = [infraNode({ id: "existing", measured: { width: 1, height: 1 } })];
    const next = [infraNode({ id: "brand-new" })];
    const result = preserveMeasuredDimensions(next, previous);
    expect(result[0]).toBe(next[0]);
    expect(result[0].measured).toBeUndefined();
  });

  it("ignores a previous entry whose measured is only partially populated", () => {
    const previous = [infraNode({ measured: { width: 200, height: undefined } })];
    const next = [infraNode()];
    const result = preserveMeasuredDimensions(next, previous);
    expect(result[0]).toBe(next[0]);
    expect(result[0].measured).toBeUndefined();
  });

  it("returns next unchanged when no previous node has a usable measured value", () => {
    const previous = [infraNode()]; // measured 未設定
    const next = [infraNode()];
    expect(preserveMeasuredDimensions(next, previous)).toBe(next);
  });

  it("handles an empty next array", () => {
    const previous = [infraNode({ measured: { width: 1, height: 1 } })];
    expect(preserveMeasuredDimensions([], previous)).toEqual([]);
  });

  it("matches previous and next entries by id, not array position", () => {
    const previous = [
      infraNode({ id: "a", measured: { width: 10, height: 10 } }),
      infraNode({ id: "b", measured: { width: 20, height: 20 } }),
    ];
    // next は順序が入れ替わっている。
    const next = [infraNode({ id: "b" }), infraNode({ id: "a" })];
    const result = preserveMeasuredDimensions(next, previous);
    expect(result.find((n) => n.id === "a")?.measured).toEqual({ width: 10, height: 10 });
    expect(result.find((n) => n.id === "b")?.measured).toEqual({ width: 20, height: 20 });
  });
});
