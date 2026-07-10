import type { ContractEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  FALLBACK_NODE_HEIGHT,
  FALLBACK_NODE_WIDTH,
  buildContractListEntries,
  resolveNodeCenter,
  sortEntriesByAppearance,
  type ContractListEntry,
} from "./contractList.js";
import { contractsToFlowNodes, type ContractFlowNode } from "./contractNode.js";
import { createGhostNode, type GhostFlowNode } from "./ghostNode.js";

function contract(overrides: Partial<ContractEntity> = {}): ContractEntity {
  return {
    kind: "contract",
    address: "0xabc",
    chainType: "ethereum",
    ...overrides,
  };
}

function contractNode(overrides: Partial<ContractEntity> = {}): ContractFlowNode {
  const [node] = contractsToFlowNodes([contract(overrides)], { layout: {} });
  return node;
}

function deployingGhost(commandId: string, label: string): GhostFlowNode {
  return createGhostNode({ commandId, kind: "contract", label, index: 0, catalogKey: label });
}

describe("buildContractListEntries", () => {
  it("maps a known (cataloged) contract to a deployed entry", () => {
    const node = contractNode({
      address: "0xaaa",
      name: "ChainvizToken",
      token: { symbol: "CVZ", decimals: 18 },
    });
    const entries = buildContractListEntries([node], []);
    expect(entries).toEqual<ContractListEntry[]>([
      {
        nodeId: "0xaaa",
        status: "deployed",
        name: "ChainvizToken",
        address: "0xaaa",
        tokenSymbol: "CVZ",
      },
    ]);
  });

  it("includes an uncataloged (unknown) contract with name left undefined", () => {
    const node = contractNode({ address: "0xbbb", name: undefined });
    const entries = buildContractListEntries([node], []);
    expect(entries).toEqual<ContractListEntry[]>([
      { nodeId: "0xbbb", status: "deployed", name: undefined, address: "0xbbb", tokenSymbol: undefined },
    ]);
  });

  it("omits tokenSymbol for a contract with no token metadata", () => {
    const node = contractNode({ address: "0xccc", name: "Counter" });
    const entries = buildContractListEntries([node], []);
    expect(entries[0]?.tokenSymbol).toBeUndefined();
  });

  it("maps a deploying ghost to a deploying entry using the ghost's label as the name", () => {
    const ghost = deployingGhost("cmd-1", "Counter");
    const entries = buildContractListEntries([], [ghost]);
    expect(entries).toEqual<ContractListEntry[]>([
      { nodeId: ghost.id, status: "deploying", name: "Counter" },
    ]);
  });

  it("combines deployed and deploying entries, deployed first", () => {
    const node = contractNode({ address: "0xaaa", name: "ChainvizToken" });
    const ghost = deployingGhost("cmd-1", "Counter");
    const entries = buildContractListEntries([node], [ghost]);
    expect(entries.map((e) => e.status)).toEqual(["deployed", "deploying"]);
  });

  it("returns an empty array when there is nothing deployed or deploying", () => {
    expect(buildContractListEntries([], [])).toEqual([]);
  });
});

describe("sortEntriesByAppearance", () => {
  function entry(nodeId: string): ContractListEntry {
    return { nodeId, status: "deployed", address: nodeId };
  }

  it("puts the entry with the highest order value first (newest on top)", () => {
    const entries = [entry("a"), entry("b"), entry("c")];
    const order = new Map([
      ["a", 0],
      ["b", 2],
      ["c", 1],
    ]);
    const sorted = sortEntriesByAppearance(entries, order);
    expect(sorted.map((e) => e.nodeId)).toEqual(["b", "c", "a"]);
  });

  it("does not mutate the input array", () => {
    const entries = [entry("a"), entry("b")];
    const order = new Map([
      ["a", 0],
      ["b", 1],
    ]);
    sortEntriesByAppearance(entries, order);
    expect(entries.map((e) => e.nodeId)).toEqual(["a", "b"]);
  });

  it("sends an entry missing from the order map to the end (defensive fallback)", () => {
    const entries = [entry("a"), entry("unknown")];
    const order = new Map([["a", 5]]);
    const sorted = sortEntriesByAppearance(entries, order);
    expect(sorted.map((e) => e.nodeId)).toEqual(["a", "unknown"]);
  });
});

describe("resolveNodeCenter", () => {
  it("adds half the measured width/height to the position", () => {
    const center = resolveNodeCenter({ x: 100, y: 200 }, { width: 40, height: 60 });
    expect(center).toEqual({ x: 120, y: 230 });
  });

  it("falls back to default dimensions when measured is undefined", () => {
    const center = resolveNodeCenter({ x: 0, y: 0 }, undefined);
    expect(center).toEqual({
      x: FALLBACK_NODE_WIDTH / 2,
      y: FALLBACK_NODE_HEIGHT / 2,
    });
  });

  it("falls back to default dimensions when measured has no width/height fields", () => {
    const center = resolveNodeCenter({ x: 10, y: 10 }, {});
    expect(center).toEqual({
      x: 10 + FALLBACK_NODE_WIDTH / 2,
      y: 10 + FALLBACK_NODE_HEIGHT / 2,
    });
  });
});
