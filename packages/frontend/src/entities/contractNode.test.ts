import type { ContractEntity, NodeEntity, TransactionEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  CONTRACT_GRID,
  contractsToFlowNodes,
  isContractEntity,
  isSameContractNode,
} from "./contractNode.js";
import { DEFAULT_GRID } from "./infraNode.js";

function tx(overrides: Partial<TransactionEntity> = {}): TransactionEntity {
  return {
    kind: "transaction",
    hash: "0xtx",
    from: "0xfrom",
    to: "0xabc",
    status: "included",
    blockHash: "0xb1",
    ...overrides,
  };
}

function contract(overrides: Partial<ContractEntity> = {}): ContractEntity {
  return {
    kind: "contract",
    address: "0xabc",
    chainType: "ethereum",
    ...overrides,
  };
}

const node: NodeEntity = {
  kind: "node",
  id: "reth-1",
  containerName: "c-reth-1",
  ip: "1.1.1.1",
  ports: [8545],
  resources: { cpuPercent: 1, memMB: 1 },
  process: { name: "reth" },
  chainType: "ethereum",
  clientType: "reth",
  syncStatus: "synced",
  blockHeight: 1,
  headBlockHash: "0x0",
};

function ctx(
  overrides: Partial<Parameters<typeof contractsToFlowNodes>[1]> = {},
) {
  return {
    layout: {},
    ...overrides,
  };
}

describe("isContractEntity", () => {
  it("accepts contracts and rejects nodes", () => {
    expect(isContractEntity(contract())).toBe(true);
    expect(isContractEntity(node)).toBe(false);
  });
});

describe("contractsToFlowNodes", () => {
  it("keeps only contract entities and sorts by address", () => {
    const nodes = contractsToFlowNodes(
      [contract({ address: "0xb" }), node, contract({ address: "0xa" })],
      ctx(),
    );
    expect(nodes.map((n) => n.id)).toEqual(["0xa", "0xb"]);
    expect(nodes.every((n) => n.type === "contract")).toBe(true);
  });

  it("uses saved positions keyed by address", () => {
    const nodes = contractsToFlowNodes(
      [contract({ address: "0xa" })],
      ctx({ layout: { "0xa": { x: 11, y: 22 } } }),
    );
    expect(nodes[0].position).toEqual({ x: 11, y: 22 });
  });

  it("falls back to the contract grid origin when unsaved", () => {
    const nodes = contractsToFlowNodes([contract({ address: "0xa" })], ctx());
    expect(nodes[0].position).toEqual({
      x: CONTRACT_GRID.originX,
      y: CONTRACT_GRID.originY,
    });
  });

  it("assigns successive grid slots to multiple unsaved contracts", () => {
    const nodes = contractsToFlowNodes(
      [contract({ address: "0xa" }), contract({ address: "0xb" })],
      ctx(),
    );
    expect(nodes[0].position).not.toEqual(nodes[1].position);
  });

  it("returns an empty array when there are no contracts", () => {
    expect(contractsToFlowNodes([], ctx())).toEqual([]);
    // node のみ渡しても contract が無ければ空。
    expect(contractsToFlowNodes([node], ctx())).toEqual([]);
  });

  it("wraps to the next grid row past the column count (CONTRACT_GRID has 3 columns)", () => {
    // 4件目（sorted index 3）は 2 段目の左端に折り返す。列数は CONTRACT_GRID
    // 由来（DEFAULT_GRID.columns = 3）。
    const nodes = contractsToFlowNodes(
      ["0xa", "0xb", "0xc", "0xd"].map((address) => contract({ address })),
      ctx(),
    );
    expect(nodes.map((n) => n.position)).toEqual([
      { x: CONTRACT_GRID.originX, y: CONTRACT_GRID.originY },
      {
        x: CONTRACT_GRID.originX + CONTRACT_GRID.gapX,
        y: CONTRACT_GRID.originY,
      },
      {
        x: CONTRACT_GRID.originX + CONTRACT_GRID.gapX * 2,
        y: CONTRACT_GRID.originY,
      },
      {
        x: CONTRACT_GRID.originX,
        y: CONTRACT_GRID.originY + CONTRACT_GRID.gapY,
      },
    ]);
  });

  it("keeps a saved contract at its saved position regardless of sibling count/order (Issue #113)", () => {
    // 保存済みカードは、あとから辞書順で手前に来る別コントラクトが増えても
    // レイアウトから読むため位置がずれない（並び順で添字を振り直す旧方式の
    // 温床を踏まない。Issue #113）。
    const context = ctx({ layout: { "0xz": { x: 777, y: 888 } } });
    const alone = contractsToFlowNodes([contract({ address: "0xz" })], context);
    const withSiblings = contractsToFlowNodes(
      [
        contract({ address: "0xz" }),
        contract({ address: "0xa" }),
        contract({ address: "0xb" }),
      ],
      context,
    );
    const savedAlone = alone.find((n) => n.id === "0xz");
    const savedWith = withSiblings.find((n) => n.id === "0xz");
    expect(savedAlone?.position).toEqual({ x: 777, y: 888 });
    expect(savedWith?.position).toEqual({ x: 777, y: 888 });
  });

  it("computes an unsaved contract's interim slot from its sorted index (App.tsx resolves collisions on persist)", () => {
    // 未保存カードの暫定位置は sorted index 由来（index 1 = 2列目）。この関数
    // 自体は保存済みカードの占有セルを避けない（infraNode の findFreeGridPosition
    // と異なる）。恒久位置の衝突回避は App.tsx の resolveLayoutPositions が担う。
    const nodes = contractsToFlowNodes(
      [contract({ address: "0xa" }), contract({ address: "0xb" })],
      ctx({ layout: { "0xa": { x: 5, y: 6 } } }),
    );
    const b = nodes.find((n) => n.id === "0xb");
    expect(b?.position).toEqual({
      x: CONTRACT_GRID.originX + CONTRACT_GRID.gapX,
      y: CONTRACT_GRID.originY,
    });
  });

  it("carries the entity through to node data unchanged", () => {
    const entity = contract({ address: "0xa", name: "ChainvizToken" });
    const nodes = contractsToFlowNodes([entity], ctx());
    expect(nodes[0].data.entity).toBe(entity);
  });

  it("derives an empty activity array when no transactions/blockNumberByHash are given (Issue #166)", () => {
    const nodes = contractsToFlowNodes([contract({ address: "0xa" })], ctx());
    expect(nodes[0].data.activity).toEqual([]);
  });

  it("derives activity chips from ctx.transactions, filtered by contract address", () => {
    const nodes = contractsToFlowNodes(
      [contract({ address: "0xabc" })],
      ctx({
        transactions: [
          tx({
            hash: "0xcall",
            contractCall: { contractAddress: "0xabc", functionName: "transfer" },
          }),
        ],
      }),
    );
    expect(nodes[0].data.activity).toEqual([
      {
        key: "0xcall-call",
        kind: "call",
        label: "transfer",
        decoded: true,
        args: [],
        txHash: "0xcall",
      },
    ]);
  });

  it("uses ctx.blockNumberByHash to order activity chips newest-first", () => {
    const older = tx({
      hash: "0xold",
      blockHash: "0xb1",
      contractCall: { contractAddress: "0xabc", functionName: "old" },
    });
    const newer = tx({
      hash: "0xnew",
      blockHash: "0xb2",
      contractCall: { contractAddress: "0xabc", functionName: "new" },
    });
    const nodes = contractsToFlowNodes(
      [contract({ address: "0xabc" })],
      ctx({
        transactions: [older, newer],
        blockNumberByHash: new Map([
          ["0xb1", 1],
          ["0xb2", 2],
        ]),
      }),
    );
    expect(nodes[0].data.activity.map((c) => c.label)).toEqual(["new", "old"]);
  });
});

describe("isSameContractNode", () => {
  it("returns true when nothing meaningful changed between two recomputations (Issue #119)", () => {
    const entity = contract({ address: "0xa" });
    const context = ctx();
    const previous = contractsToFlowNodes([entity], context)[0];
    const next = contractsToFlowNodes([entity], context)[0];
    expect(previous).not.toBe(next);
    expect(isSameContractNode(previous, next)).toBe(true);
  });

  it("returns false when the entity reference changed", () => {
    const context = ctx();
    const previous = contractsToFlowNodes(
      [contract({ address: "0xa" })],
      context,
    )[0];
    const next = contractsToFlowNodes(
      [contract({ address: "0xa" })],
      context,
    )[0];
    expect(isSameContractNode(previous, next)).toBe(false);
  });

  it("returns false when only x changed", () => {
    const entity = contract({ address: "0xa" });
    const previous = contractsToFlowNodes(
      [entity],
      ctx({ layout: { "0xa": { x: 0, y: 5 } } }),
    )[0];
    const next = contractsToFlowNodes(
      [entity],
      ctx({ layout: { "0xa": { x: 1, y: 5 } } }),
    )[0];
    expect(isSameContractNode(previous, next)).toBe(false);
  });

  it("returns false when only y changed", () => {
    const entity = contract({ address: "0xa" });
    const previous = contractsToFlowNodes(
      [entity],
      ctx({ layout: { "0xa": { x: 5, y: 0 } } }),
    )[0];
    const next = contractsToFlowNodes(
      [entity],
      ctx({ layout: { "0xa": { x: 5, y: 1 } } }),
    )[0];
    expect(isSameContractNode(previous, next)).toBe(false);
  });

  it("compares position by value: distinct position objects with equal x/y are 'same'", () => {
    const entity = contract({ address: "0xa" });
    const base = contractsToFlowNodes([entity], ctx())[0];
    const previous = { ...base, position: { x: 3, y: 4 } };
    const next = { ...base, position: { x: 3, y: 4 } };
    expect(previous.position).not.toBe(next.position);
    expect(isSameContractNode(previous, next)).toBe(true);
  });

  it("detects a deep entity field change via the new entity reference the store hands back", () => {
    const before = contract({ address: "0xa", name: undefined });
    const after = contract({ address: "0xa", name: "ChainvizToken" });
    const previous = contractsToFlowNodes([before], ctx())[0];
    const next = contractsToFlowNodes([after], ctx())[0];
    expect(isSameContractNode(previous, next)).toBe(false);
  });

  it("ignores the isNew highlight flag when comparing (added by App.tsx after stabilize)", () => {
    // isNew は時間経過に依存する派生フラグで、App.tsx が stabilizeNodes の後段で
    // 付ける。比較対象に含めないため、entity/position が同じなら isNew の差だけ
    // では「変化なし」とみなす（infraNode の isSameInfraNode と同じ流儀）。
    const entity = contract({ address: "0xa" });
    const base = contractsToFlowNodes([entity], ctx())[0];
    const previous = { ...base, data: { ...base.data, isNew: false } };
    const next = { ...base, data: { ...base.data, isNew: true } };
    expect(isSameContractNode(previous, next)).toBe(true);
  });

  it("ignores the flashKind settle-flash flag when comparing (added by App.tsx after stabilize)", () => {
    const entity = contract({ address: "0xa" });
    const base = contractsToFlowNodes([entity], ctx())[0];
    const previous = { ...base, data: { ...base.data, flashKind: undefined } };
    const next = { ...base, data: { ...base.data, flashKind: "success" as const } };
    expect(isSameContractNode(previous, next)).toBe(true);
  });

  it("returns true when activity is recomputed with the same content (Issue #119: content, not reference)", () => {
    // deriveContractActivity は毎回新しいチップオブジェクトを作るため、内容が
    // 同じなら「変化なし」とみなす必要がある（sameContractActivity 経由）。
    const entity = contract({ address: "0xabc" });
    const transactions = [
      tx({
        hash: "0xcall",
        contractCall: { contractAddress: "0xabc", functionName: "transfer" },
      }),
    ];
    const previous = contractsToFlowNodes([entity], ctx({ transactions }))[0];
    const next = contractsToFlowNodes([entity], ctx({ transactions }))[0];
    expect(previous.data.activity).not.toBe(next.data.activity);
    expect(isSameContractNode(previous, next)).toBe(true);
  });

  it("returns false when activity content actually changed (new tx settled)", () => {
    const entity = contract({ address: "0xabc" });
    const previous = contractsToFlowNodes(
      [entity],
      ctx({ transactions: [] }),
    )[0];
    const next = contractsToFlowNodes(
      [entity],
      ctx({
        transactions: [
          tx({
            hash: "0xcall",
            contractCall: { contractAddress: "0xabc", functionName: "transfer" },
          }),
        ],
      }),
    )[0];
    expect(isSameContractNode(previous, next)).toBe(false);
  });
});

describe("CONTRACT_GRID", () => {
  it("sits below the infra/wallet bands and reuses the shared grid geometry", () => {
    // コントラクト行はインフラ行（originY=0）・ウォレット行より下の3段目の帯。
    // originY 以外の列数・間隔は共有グリッドと同じにして整列させる。
    expect(CONTRACT_GRID.originY).toBeGreaterThan(0);
    expect(CONTRACT_GRID).toMatchObject({
      columns: DEFAULT_GRID.columns,
      gapX: DEFAULT_GRID.gapX,
      gapY: DEFAULT_GRID.gapY,
      originX: DEFAULT_GRID.originX,
    });
  });
});
