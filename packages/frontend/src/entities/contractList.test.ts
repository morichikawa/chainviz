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
      token: { symbol: "CVZDEMO", decimals: 18 },
    });
    const entries = buildContractListEntries([node], []);
    expect(entries).toEqual<ContractListEntry[]>([
      {
        nodeId: "0xaaa",
        status: "deployed",
        name: "ChainvizToken",
        address: "0xaaa",
        tokenSymbol: "CVZDEMO",
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

  it("preserves input order across multiple deployed contracts", () => {
    const nodes = [
      contractNode({ address: "0xaaa", name: "First" }),
      contractNode({ address: "0xbbb", name: "Second" }),
      contractNode({ address: "0xccc", name: "Third" }),
    ];
    const entries = buildContractListEntries(nodes, []);
    expect(entries.map((e) => e.nodeId)).toEqual(["0xaaa", "0xbbb", "0xccc"]);
  });

  it("preserves input order across multiple deploying ghosts", () => {
    const ghosts = [
      deployingGhost("cmd-1", "Counter"),
      deployingGhost("cmd-2", "ChainvizToken"),
    ];
    const entries = buildContractListEntries([], ghosts);
    expect(entries.map((e) => e.name)).toEqual(["Counter", "ChainvizToken"]);
    expect(entries.every((e) => e.status === "deploying")).toBe(true);
  });

  it("combines several deployed and several deploying entries, all deployed first", () => {
    const nodes = [
      contractNode({ address: "0xaaa", name: "First" }),
      contractNode({ address: "0xbbb", name: "Second" }),
    ];
    const ghosts = [deployingGhost("cmd-1", "Counter"), deployingGhost("cmd-2", "Extra")];
    const entries = buildContractListEntries(nodes, ghosts);
    expect(entries.map((e) => e.status)).toEqual([
      "deployed",
      "deployed",
      "deploying",
      "deploying",
    ]);
  });

  it("keeps an empty ghost label as an empty name rather than dropping the entry", () => {
    // ghost の label は本来空にならない想定だが、空でも行自体は落とさない
    // （呼び出し側 ContractListPanel が name ?? "" で描画する）。
    const ghost = deployingGhost("cmd-1", "");
    const entries = buildContractListEntries([], [ghost]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ status: "deploying", name: "" });
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

  it("returns an empty array when there are no entries", () => {
    expect(sortEntriesByAppearance([], new Map())).toEqual([]);
  });

  it("keeps the input order for entries sharing the same order value (stable)", () => {
    const entries = [entry("a"), entry("b"), entry("c")];
    const order = new Map([
      ["a", 1],
      ["b", 1],
      ["c", 1],
    ]);
    const sorted = sortEntriesByAppearance(entries, order);
    expect(sorted.map((e) => e.nodeId)).toEqual(["a", "b", "c"]);
  });

  it("keeps input order for all entries when the order map is empty (all treated as oldest)", () => {
    const entries = [entry("a"), entry("b"), entry("c")];
    const sorted = sortEntriesByAppearance(entries, new Map());
    expect(sorted.map((e) => e.nodeId)).toEqual(["a", "b", "c"]);
  });

  it("puts a freshly-appeared deploying ghost above an older deployed contract", () => {
    // buildContractListEntries は deployed を先に並べるが、出現順ソートで
    // 「今しがた出たデプロイ中の行」が最上段へ来る（実利用シナリオ）。
    const deployedEntry: ContractListEntry = {
      nodeId: "0xold",
      status: "deployed",
      address: "0xold",
    };
    const deployingEntry: ContractListEntry = {
      nodeId: "ghost-new",
      status: "deploying",
      name: "Counter",
    };
    const order = new Map([
      ["0xold", 0],
      ["ghost-new", 1],
    ]);
    const sorted = sortEntriesByAppearance([deployedEntry, deployingEntry], order);
    expect(sorted.map((e) => e.nodeId)).toEqual(["ghost-new", "0xold"]);
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

  it("uses the measured width but falls back on a missing height (partial measured)", () => {
    const center = resolveNodeCenter({ x: 100, y: 200 }, { width: 40 });
    expect(center).toEqual({ x: 120, y: 200 + FALLBACK_NODE_HEIGHT / 2 });
  });

  it("uses the measured height but falls back on a missing width (partial measured)", () => {
    const center = resolveNodeCenter({ x: 100, y: 200 }, { height: 60 });
    expect(center).toEqual({ x: 100 + FALLBACK_NODE_WIDTH / 2, y: 230 });
  });

  it("handles negative positions (cards laid out above/left of the origin)", () => {
    const center = resolveNodeCenter({ x: -100, y: -50 }, { width: 40, height: 60 });
    expect(center).toEqual({ x: -80, y: -20 });
  });

  it("handles a zero-sized measured node without dividing away the position", () => {
    const center = resolveNodeCenter({ x: 30, y: 40 }, { width: 0, height: 0 });
    expect(center).toEqual({ x: 30, y: 40 });
  });
});
