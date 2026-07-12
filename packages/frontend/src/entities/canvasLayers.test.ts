import type { ContractEntity, NodeEntity, WalletEntity, WorkbenchEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  LAYER_LENS_DIM_CLASS,
  computeLayerVisibility,
  edgeVisualizationLayer,
  withLayerDimClassName,
} from "./canvasLayers.js";
import type { CanvasFlowEdge, CanvasFlowNode } from "./canvasNode.js";
import { CONTRACT_NODE_TYPE, type ContractFlowNode } from "./contractNode.js";
import { CONTRACT_CALL_PULSE_EDGE_TYPE } from "./contractCallPulseEdge.js";
import { DEPLOY_EDGE_TYPE } from "./deployEdge.js";
import { createGhostNode } from "./ghostNode.js";
import type { InfraFlowNode } from "./infraNode.js";
import { INTERNAL_LINK_EDGE_TYPE } from "./internalLinkEdge.js";
import { OPERATION_EDGE_TYPE } from "./operationEdge.js";
import { OPERATION_TARGET_EDGE_TYPE } from "./operationTargetEdge.js";
import { OWNERSHIP_EDGE_TYPE } from "./ownershipEdge.js";
import { PEER_EDGE_TYPE } from "./peerEdge.js";
import { PENDING_CONNECTION_EDGE_TYPE } from "./pendingConnectionEdge.js";
import { CONNECTING_EDGE_TYPE } from "./connectingEdge.js";
import { WALLET_NODE_TYPE, type WalletFlowNode } from "./walletNode.js";

const rethEntity: NodeEntity = {
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

const lighthouseEntity: NodeEntity = {
  ...rethEntity,
  id: "lighthouse-1",
  containerName: "chainviz-lighthouse-1",
  clientType: "lighthouse",
};

const workbenchEntity: WorkbenchEntity = {
  kind: "workbench",
  id: "workbench-1",
  containerName: "chainviz-workbench-1",
  ip: "172.20.0.50",
  ports: [],
  resources: { cpuPercent: 0.1, memMB: 32 },
  process: { name: "foundry" },
  label: "Alice",
  walletIds: [],
  removable: true,
};

const walletEntity: WalletEntity = {
  kind: "wallet",
  address: "0xwallet",
  chainType: "ethereum",
  balance: "0",
  nonce: 0,
  isSmartAccount: false,
  ownerWorkbenchId: null,
  recentTxHashes: [],
};

const contractEntity: ContractEntity = {
  kind: "contract",
  address: "0xcontract",
  chainType: "ethereum",
};

function infraNode(overrides: Partial<InfraFlowNode> = {}): InfraFlowNode {
  return {
    id: rethEntity.id,
    type: "infra",
    position: { x: 0, y: 0 },
    data: { entity: rethEntity },
    ...overrides,
  };
}

function walletNode(overrides: Partial<WalletFlowNode> = {}): WalletFlowNode {
  return {
    id: walletEntity.address,
    type: WALLET_NODE_TYPE,
    position: { x: 0, y: 0 },
    data: {
      entity: walletEntity,
      transactions: [],
      settlingHashes: [],
      ownerPresent: false,
      contractsByAddress: new Map(),
    },
    ...overrides,
  };
}

function contractNode(overrides: Partial<ContractFlowNode> = {}): ContractFlowNode {
  return {
    id: contractEntity.address,
    type: CONTRACT_NODE_TYPE,
    position: { x: 0, y: 0 },
    data: { entity: contractEntity, activity: [] },
    ...overrides,
  };
}

function peerEdge(id: string, source: string, target: string): CanvasFlowEdge {
  return {
    id,
    type: PEER_EDGE_TYPE,
    source,
    target,
    data: { networkId: "1337" },
  };
}

describe("edgeVisualizationLayer", () => {
  it("maps each in-scope edge type to its layer (UX design §3.2)", () => {
    expect(edgeVisualizationLayer({ type: PEER_EDGE_TYPE })).toBe("b");
    expect(edgeVisualizationLayer({ type: OWNERSHIP_EDGE_TYPE })).toBe("c");
    expect(edgeVisualizationLayer({ type: DEPLOY_EDGE_TYPE })).toBe("c");
    expect(edgeVisualizationLayer({ type: OPERATION_EDGE_TYPE })).toBe("c");
    expect(edgeVisualizationLayer({ type: OPERATION_TARGET_EDGE_TYPE })).toBe("c");
    expect(edgeVisualizationLayer({ type: CONTRACT_CALL_PULSE_EDGE_TYPE })).toBe("c");
    expect(edgeVisualizationLayer({ type: INTERNAL_LINK_EDGE_TYPE })).toBe("d");
  });

  it("returns undefined for operation-feedback edges (ghost-origin), keeping them out of the lens (Issue #102/#220)", () => {
    expect(edgeVisualizationLayer({ type: PENDING_CONNECTION_EDGE_TYPE })).toBeUndefined();
    expect(edgeVisualizationLayer({ type: CONNECTING_EDGE_TYPE })).toBeUndefined();
  });

  it("returns undefined for an edge with no type", () => {
    expect(edgeVisualizationLayer({ type: undefined })).toBeUndefined();
  });
});

describe("computeLayerVisibility", () => {
  it("dims nothing when filter is 'all'", () => {
    const nodes: CanvasFlowNode[] = [infraNode(), walletNode(), contractNode()];
    const edges: CanvasFlowEdge[] = [peerEdge("p1", "reth-1", "lighthouse-1")];
    const result = computeLayerVisibility(nodes, edges, "all");
    expect(result.dimNodeIds.size).toBe(0);
    expect(result.dimEdgeIds.size).toBe(0);
  });

  it("A layer: keeps all infra cards normal and dims every edge and non-infra card", () => {
    const infra1 = infraNode({ id: "reth-1" });
    const infra2 = infraNode({ id: "lighthouse-1", data: { entity: lighthouseEntity } });
    const wallet = walletNode();
    const contract = contractNode();
    const edge = peerEdge("p1", "reth-1", "lighthouse-1");

    const result = computeLayerVisibility([infra1, infra2, wallet, contract], [edge], "a");

    expect(result.dimNodeIds.has("reth-1")).toBe(false);
    expect(result.dimNodeIds.has("lighthouse-1")).toBe(false);
    expect(result.dimNodeIds.has(wallet.id)).toBe(true);
    expect(result.dimNodeIds.has(contract.id)).toBe(true);
    // A層にはエッジが割り当てられていないため、B層のピア接続も dim される。
    expect(result.dimEdgeIds.has("p1")).toBe(true);
  });

  it("B layer: keeps peer edges and their endpoint cards normal, dims everything else", () => {
    const infra1 = infraNode({ id: "reth-1" });
    const infra2 = infraNode({ id: "lighthouse-1", data: { entity: lighthouseEntity } });
    const workbench = infraNode({ id: "workbench-1", data: { entity: workbenchEntity } });
    const wallet = walletNode();
    const edge = peerEdge("p1", "reth-1", "lighthouse-1");

    const result = computeLayerVisibility([infra1, infra2, workbench, wallet], [edge], "b");

    expect(result.dimEdgeIds.has("p1")).toBe(false);
    expect(result.dimNodeIds.has("reth-1")).toBe(false); // ピアエッジの端点
    expect(result.dimNodeIds.has("lighthouse-1")).toBe(false); // ピアエッジの端点
    expect(result.dimNodeIds.has("workbench-1")).toBe(true); // 端点ではないインフラカード
    expect(result.dimNodeIds.has(wallet.id)).toBe(true);
  });

  it("C layer: keeps wallet/contract cards, C-layer edges, and their endpoint infra cards normal", () => {
    const workbench = infraNode({ id: "workbench-1", data: { entity: workbenchEntity } });
    const rpcTargetNode = infraNode({ id: "reth-1" });
    const wallet = walletNode();
    const contract = contractNode();
    const operationTargetEdge: CanvasFlowEdge = {
      id: "optarget-1",
      type: OPERATION_TARGET_EDGE_TYPE,
      source: "workbench-1",
      target: "reth-1",
      data: { workbenchContainerName: "chainviz-workbench-1", targetContainerName: "chainviz-reth-1" },
    };
    const peer = peerEdge("p1", "reth-1", "lighthouse-1"); // C層には属さない

    const result = computeLayerVisibility(
      [workbench, rpcTargetNode, wallet, contract],
      [operationTargetEdge, peer],
      "c",
    );

    expect(result.dimNodeIds.has(wallet.id)).toBe(false);
    expect(result.dimNodeIds.has(contract.id)).toBe(false);
    expect(result.dimNodeIds.has("workbench-1")).toBe(false); // operationTarget の端点
    expect(result.dimNodeIds.has("reth-1")).toBe(false); // operationTarget の端点
    expect(result.dimEdgeIds.has("optarget-1")).toBe(false);
    expect(result.dimEdgeIds.has("p1")).toBe(true);
  });

  it("D layer: keeps internal-link endpoints normal and dims workbench/wallet/contract", () => {
    const cl = infraNode({ id: "lighthouse-1", data: { entity: lighthouseEntity } });
    const el = infraNode({ id: "reth-1" });
    const workbench = infraNode({ id: "workbench-1", data: { entity: workbenchEntity } });
    const internalLinkEdge: CanvasFlowEdge = {
      id: "internal-link-1",
      type: INTERNAL_LINK_EDGE_TYPE,
      source: "lighthouse-1",
      target: "reth-1",
      data: { drivingContainerName: "chainviz-lighthouse-1", drivenContainerName: "chainviz-reth-1" },
    };

    const result = computeLayerVisibility([cl, el, workbench], [internalLinkEdge], "d");

    expect(result.dimNodeIds.has("lighthouse-1")).toBe(false);
    expect(result.dimNodeIds.has("reth-1")).toBe(false);
    expect(result.dimNodeIds.has("workbench-1")).toBe(true);
  });

  it("never dims ghost cards or their pending/connecting edges regardless of the selected layer", () => {
    const ghost = createGhostNode({ commandId: "cmd-1", kind: "node", label: "ethereum", index: 0 });
    const pending: CanvasFlowEdge = {
      id: "pending-1",
      type: PENDING_CONNECTION_EDGE_TYPE,
      source: ghost.id,
      target: "reth-1",
    };
    const connecting: CanvasFlowEdge = {
      id: "connecting-1",
      type: CONNECTING_EDGE_TYPE,
      source: "reth-1",
      target: "lighthouse-1",
    };

    const result = computeLayerVisibility([ghost, infraNode()], [pending, connecting], "c");

    expect(result.dimNodeIds.has(ghost.id)).toBe(false);
    expect(result.dimEdgeIds.has("pending-1")).toBe(false);
    expect(result.dimEdgeIds.has("connecting-1")).toBe(false);
  });

  it("does not dim an infra card currently showing the new-arrival glow, even if it would otherwise be dimmed", () => {
    const glowing = infraNode({ id: "reth-1", data: { entity: rethEntity, isNew: true } });
    const result = computeLayerVisibility([glowing], [], "c");
    expect(result.dimNodeIds.has("reth-1")).toBe(false);
  });
});

describe("withLayerDimClassName", () => {
  it("adds the dim class when dim is true and className is undefined", () => {
    expect(withLayerDimClassName(undefined, true)).toBe(LAYER_LENS_DIM_CLASS);
  });

  it("appends the dim class to an existing className", () => {
    expect(withLayerDimClassName("peer-edge peer-edge--net-a", true)).toBe(
      `peer-edge peer-edge--net-a ${LAYER_LENS_DIM_CLASS}`,
    );
  });

  it("returns the same className reference when already in the desired dim state (true)", () => {
    const className = `peer-edge ${LAYER_LENS_DIM_CLASS}`;
    expect(withLayerDimClassName(className, true)).toBe(className);
  });

  it("returns the same className reference when already in the desired dim state (false)", () => {
    const className = "peer-edge";
    expect(withLayerDimClassName(className, false)).toBe(className);
  });

  it("removes the dim class while preserving other classes", () => {
    expect(withLayerDimClassName(`peer-edge ${LAYER_LENS_DIM_CLASS}`, false)).toBe("peer-edge");
  });

  it("returns undefined when removing the dim class leaves nothing behind", () => {
    expect(withLayerDimClassName(LAYER_LENS_DIM_CLASS, false)).toBeUndefined();
  });

  it("returns undefined unchanged when dim is false and className was already undefined", () => {
    expect(withLayerDimClassName(undefined, false)).toBeUndefined();
  });
});
