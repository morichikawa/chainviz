import { describe, expect, it } from "vitest";
import {
  CHAIN_RIBBON_DEFAULT_POSITION,
  CHAIN_RIBBON_ID,
  CHAIN_RIBBON_NODE_TYPE,
  chainRibbonToFlowNode,
} from "./chainRibbonNode.js";

describe("chainRibbonToFlowNode", () => {
  it("uses the fixed chain-ribbon id and node type", () => {
    const node = chainRibbonToFlowNode({
      tiles: [],
      txCountByHash: new Map(),
      nodeLabelById: new Map(),
      landingHashes: new Set(),
      blocks: [],
      layout: {},
    });
    expect(node.id).toBe(CHAIN_RIBBON_ID);
    expect(node.type).toBe(CHAIN_RIBBON_NODE_TYPE);
  });

  it("falls back to the default position when layout has no saved entry", () => {
    const node = chainRibbonToFlowNode({
      tiles: [],
      txCountByHash: new Map(),
      nodeLabelById: new Map(),
      landingHashes: new Set(),
      blocks: [],
      layout: {},
    });
    expect(node.position).toEqual(CHAIN_RIBBON_DEFAULT_POSITION);
  });

  it("uses the saved layout position when present", () => {
    const node = chainRibbonToFlowNode({
      tiles: [],
      txCountByHash: new Map(),
      nodeLabelById: new Map(),
      landingHashes: new Set(),
      blocks: [],
      layout: { [CHAIN_RIBBON_ID]: { x: 42, y: 99 } },
    });
    expect(node.position).toEqual({ x: 42, y: 99 });
  });

  it("passes through the tiles/txCountByHash/nodeLabelById/landingHashes/blocks as-is", () => {
    const tiles = [
      {
        block: {
          kind: "block" as const,
          hash: "0x1",
          number: 1,
          parentHash: "0x0",
          timestamp: 0,
          receivedAt: {},
        },
        connectedToPrevious: false,
      },
    ];
    const txCountByHash = new Map([["0x1", 3]]);
    const nodeLabelById = new Map([["n1", "chainviz-reth-1"]]);
    const landingHashes = new Set(["0x1"]);
    const blocks = [tiles[0].block];
    const node = chainRibbonToFlowNode({
      tiles,
      txCountByHash,
      nodeLabelById,
      landingHashes,
      blocks,
      layout: {},
    });
    expect(node.data.tiles).toBe(tiles);
    expect(node.data.txCountByHash).toBe(txCountByHash);
    expect(node.data.nodeLabelById).toBe(nodeLabelById);
    expect(node.data.landingHashes).toBe(landingHashes);
    expect(node.data.blocks).toBe(blocks);
  });
});
