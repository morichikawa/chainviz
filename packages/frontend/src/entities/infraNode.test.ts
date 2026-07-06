import type {
  NodeEntity,
  WalletEntity,
  WorkbenchEntity,
} from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRID,
  defaultGridPosition,
  entitiesToFlowNodes,
  isInfraEntity,
  isSameInfraNode,
} from "./infraNode.js";

function node(id: string, containerName = `c-${id}`): NodeEntity {
  return {
    kind: "node",
    id,
    containerName,
    ip: "172.20.0.2",
    ports: [8545],
    resources: { cpuPercent: 1, memMB: 100 },
    process: { name: "reth node" },
    chainType: "ethereum",
    clientType: "reth",
    syncStatus: "synced",
    blockHeight: 1,
    headBlockHash: "0x0",
  };
}

const workbench: WorkbenchEntity = {
  kind: "workbench",
  id: "wb-1",
  containerName: "c-wb",
  ip: "172.20.0.9",
  ports: [],
  resources: { cpuPercent: 0, memMB: 10 },
  process: { name: "sh" },
  label: "Alice",
  walletIds: [],
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

describe("isInfraEntity", () => {
  it("accepts node and workbench, rejects other kinds", () => {
    expect(isInfraEntity(node("n1"))).toBe(true);
    expect(isInfraEntity(workbench)).toBe(true);
    expect(isInfraEntity(wallet)).toBe(false);
  });
});

describe("defaultGridPosition", () => {
  it("lays out cards row by row", () => {
    expect(defaultGridPosition(0)).toEqual({ x: 0, y: 0 });
    expect(defaultGridPosition(1)).toEqual({ x: DEFAULT_GRID.gapX, y: 0 });
    expect(defaultGridPosition(3)).toEqual({ x: 0, y: DEFAULT_GRID.gapY });
  });
});

describe("entitiesToFlowNodes", () => {
  it("keeps only infra entities and sorts by id", () => {
    const nodes = entitiesToFlowNodes([node("b"), wallet, node("a")], {});
    expect(nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(nodes.every((n) => n.type === "infra")).toBe(true);
  });

  it("uses saved positions keyed by containerName", () => {
    const nodes = entitiesToFlowNodes([node("a", "c-a")], {
      "c-a": { x: 42, y: 43 },
    });
    expect(nodes[0].position).toEqual({ x: 42, y: 43 });
  });

  it("falls back to the default grid when unsaved", () => {
    const nodes = entitiesToFlowNodes([node("a"), node("b")], {});
    expect(nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(nodes[1].position).toEqual({ x: DEFAULT_GRID.gapX, y: 0 });
  });

  it("wraps the entity in node data", () => {
    const nodes = entitiesToFlowNodes([workbench], {});
    expect(nodes[0].data.entity).toBe(workbench);
  });

  it("returns an empty array for no infra entities", () => {
    expect(entitiesToFlowNodes([wallet], {})).toEqual([]);
  });

  it("returns an empty array for an empty input", () => {
    expect(entitiesToFlowNodes([], {})).toEqual([]);
  });

  it("wraps grid positions to the next row past the column count", () => {
    const nodes = entitiesToFlowNodes(
      [node("a"), node("b"), node("c"), node("d")],
      {},
    );
    // columns = 3。4件目 (index 3) は次の行の先頭へ。
    expect(nodes[3].position).toEqual({ x: 0, y: DEFAULT_GRID.gapY });
  });

  it("mixes saved positions with grid fallbacks using the sorted index", () => {
    // b は保存済み、a と c は未保存。ソート順 a,b,c で index 0,1,2。
    const nodes = entitiesToFlowNodes(
      [node("c", "c-c"), node("a", "c-a"), node("b", "c-b")],
      { "c-b": { x: 999, y: 888 } },
    );
    expect(nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(nodes[1].position).toEqual({ x: 999, y: 888 });
    expect(nodes[2].position).toEqual({ x: 2 * DEFAULT_GRID.gapX, y: 0 });
  });

  it("honors custom grid options", () => {
    const nodes = entitiesToFlowNodes([node("a"), node("b")], {}, {
      columns: 1,
      gapX: 10,
      gapY: 20,
      originX: 5,
      originY: 7,
    });
    expect(nodes[0].position).toEqual({ x: 5, y: 7 });
    // columns = 1 なので2件目は次の行へ。
    expect(nodes[1].position).toEqual({ x: 5, y: 27 });
  });

  it("sorts ids lexicographically (string, not numeric)", () => {
    const nodes = entitiesToFlowNodes([node("n10"), node("n2"), node("n1")], {});
    expect(nodes.map((n) => n.id)).toEqual(["n1", "n10", "n2"]);
  });
});

describe("isSameInfraNode", () => {
  it("returns true when entity reference and position are unchanged (Issue #119)", () => {
    const [previous] = entitiesToFlowNodes([node("a")], {});
    const [next] = entitiesToFlowNodes([node("a")], {});
    // entitiesToFlowNodes は同じ入力からでも毎回新しいノードオブジェクトを
    // 作るが、entity 自体(引数の node("a") と同一の値)は同じ参照。
    const sharedEntity = node("a");
    const withSharedEntity = { ...previous, data: { entity: sharedEntity } };
    const nextWithSharedEntity = { ...next, data: { entity: sharedEntity } };
    expect(isSameInfraNode(withSharedEntity, nextWithSharedEntity)).toBe(true);
  });

  it("returns false when the entity reference changed", () => {
    const [a] = entitiesToFlowNodes([node("a")], {});
    const [b] = entitiesToFlowNodes([node("a")], {});
    // node("a") をそれぞれ別に呼んでいるため entity の参照は異なる。
    expect(isSameInfraNode(a, b)).toBe(false);
  });

  it("returns false when only the position changed", () => {
    const entity = node("a", "c-a");
    const previous = entitiesToFlowNodes([entity], {})[0];
    const next = entitiesToFlowNodes([entity], { "c-a": { x: 1, y: 2 } })[0];
    expect(isSameInfraNode(previous, next)).toBe(false);
  });
});
