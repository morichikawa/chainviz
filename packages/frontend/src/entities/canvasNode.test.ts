import type { ContractEntity, NodeEntity, WalletEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { CHAIN_RIBBON_ID, chainRibbonToFlowNode } from "./chainRibbonNode.js";
import {
  type CanvasFlowNode,
  canvasNodeLayoutKey,
  preserveDraggingState,
  preserveMeasuredDimensions,
} from "./canvasNode.js";
import type { ContractFlowNode } from "./contractNode.js";
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

const contract: ContractEntity = {
  kind: "contract",
  address: "0xc0ntract",
  chainType: "ethereum",
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
        contractsByAddress: new Map(),
      },
    };
    expect(canvasNodeLayoutKey(walletNode)).toBe("0xabc");
  });

  it("uses address for contract cards", () => {
    const contractNode: ContractFlowNode = {
      id: contract.address,
      type: "contract",
      position: { x: 0, y: 0 },
      data: { entity: contract, activity: [] },
    };
    expect(canvasNodeLayoutKey(contractNode)).toBe("0xc0ntract");
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

  it("uses the fixed chain-ribbon id for the chain ribbon card", () => {
    const ribbonNode = chainRibbonToFlowNode({
      tiles: [],
      txCountByHash: new Map(),
      nodeLabelById: new Map(),
      landingHashes: new Set(),
      layout: {},
    });
    expect(canvasNodeLayoutKey(ribbonNode)).toBe(CHAIN_RIBBON_ID);
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

  it("preserves the order of the next array", () => {
    const previous = [
      infraNode({ id: "a", measured: { width: 10, height: 10 } }),
      infraNode({ id: "b", measured: { width: 20, height: 20 } }),
      infraNode({ id: "c", measured: { width: 30, height: 30 } }),
    ];
    const next = [infraNode({ id: "c" }), infraNode({ id: "a" }), infraNode({ id: "b" })];
    const result = preserveMeasuredDimensions(next, previous);
    expect(result.map((n) => n.id)).toEqual(["c", "a", "b"]);
  });

  it("attaches measured only to nodes with a previous match, leaving new ones untouched", () => {
    const previous = [infraNode({ id: "a", measured: { width: 10, height: 10 } })];
    const next = [infraNode({ id: "a" }), infraNode({ id: "new" })];
    const result = preserveMeasuredDimensions(next, previous);
    expect(result[0].measured).toEqual({ width: 10, height: 10 });
    expect(result[1]).toBe(next[1]);
    expect(result[1].measured).toBeUndefined();
  });

  it("overwrites a partially-populated next.measured with the full previous measured", () => {
    // next 側が width だけ持ち height を欠く(未計測扱い)場合、直前の完全な
    // measured で丸ごと置き換える。
    const previous = [infraNode({ measured: { width: 200, height: 77 } })];
    const next = [infraNode({ measured: { width: 5, height: undefined } })];
    const result = preserveMeasuredDimensions(next, previous);
    expect(result[0].measured).toEqual({ width: 200, height: 77 });
    expect(result[0]).not.toBe(next[0]);
  });

  it("carries a stale measured over when the same id is removed and re-added in one tick", () => {
    // 純粋関数としては id でしか突き合わせられないため、同じ id で作り直された
    // ノードには直前の measured を引き継ぐ(呼び出し側の rfNodes に旧ノードが
    // 残っている限りの挙動を明文化する。実運用では削除→再追加は別 tick に
    // 分かれ、その時点の previous には当該 id が無いため引き継がれない)。
    const previous = [infraNode({ id: "reth-1", measured: { width: 111, height: 222 } })];
    // 内容が別物(別コンテナ)でも id が同じなら measured を引き継いでしまう。
    const readded = infraNode({ id: "reth-1" });
    const result = preserveMeasuredDimensions([readded], previous);
    expect(result[0].measured).toEqual({ width: 111, height: 222 });
  });

  it("matches by id even when the node type changed for the same id (unusual but must not throw)", () => {
    // 通常 id はカード種別ごとに衝突しない(containerName / address / commandId)が、
    // 万一同一 id で type が変わっても id ベースの突き合わせは安全に動く。
    const previous: CanvasFlowNode[] = [
      { ...infraNode({ id: "shared", measured: { width: 40, height: 50 } }) },
    ];
    const walletNext: WalletFlowNode = {
      id: "shared",
      type: "wallet",
      position: { x: 0, y: 0 },
      data: {
        entity: wallet,
        transactions: [],
        settlingHashes: [],
        ownerPresent: false,
        contractsByAddress: new Map(),
      },
    };
    const result = preserveMeasuredDimensions<CanvasFlowNode>([walletNext], previous);
    expect(result[0].type).toBe("wallet");
    expect(result[0].measured).toEqual({ width: 40, height: 50 });
  });

  it("preserves measured across a mixed array of infra and wallet cards, keyed by id", () => {
    const walletMeasured = { width: 300, height: 120 };
    const previous: CanvasFlowNode[] = [
      infraNode({ id: "reth-1", measured: { width: 200, height: 77 } }),
      {
        id: "0xabc",
        type: "wallet",
        position: { x: 0, y: 0 },
        measured: walletMeasured,
        data: {
          entity: wallet,
          transactions: [],
          settlingHashes: [],
          ownerPresent: false,
          contractsByAddress: new Map(),
        },
      },
    ];
    const next: CanvasFlowNode[] = [
      infraNode({ id: "reth-1" }),
      {
        id: "0xabc",
        type: "wallet",
        position: { x: 0, y: 0 },
        data: {
          entity: wallet,
          transactions: [],
          settlingHashes: [],
          ownerPresent: false,
          contractsByAddress: new Map(),
        },
      },
    ];
    const result = preserveMeasuredDimensions<CanvasFlowNode>(next, previous);
    expect(result[0].measured).toEqual({ width: 200, height: 77 });
    expect(result[1].measured).toEqual(walletMeasured);
  });
});

describe("preserveDraggingState", () => {
  it("returns next unchanged when there is no previous state (initial mount)", () => {
    const next = [infraNode()];
    expect(preserveDraggingState(next, [])).toBe(next);
  });

  it("returns next unchanged when no previous node is currently dragging", () => {
    const previous = [infraNode({ position: { x: 10, y: 10 } })];
    const next = [infraNode({ position: { x: 999, y: 999 } })];
    expect(preserveDraggingState(next, previous)).toBe(next);
  });

  it(
    "keeps the previous position/dragging/selected for a node currently being " +
      "dragged, instead of the new position from a WebSocket-driven update " +
      "(Issue #328)",
    () => {
      // ドラッグ中: previous(直前の rfNodes)はカーソル位置・dragging: true を
      // 持つ。next(WebSocket diff 後に親が再計算した nodes)は layout 由来の
      // 「ドラッグ開始前の保存位置」のまま。
      const previous = [
        infraNode({
          position: { x: 240, y: 180 },
          dragging: true,
          selected: true,
        }),
      ];
      const next = [infraNode({ position: { x: 0, y: 0 } })];
      const result = preserveDraggingState(next, previous);
      expect(result[0].position).toEqual({ x: 240, y: 180 });
      expect(result[0].dragging).toBe(true);
      expect(result[0].selected).toBe(true);
    },
  );

  it("uses next's position for a node that is not dragging, even if other nodes are (WebSocket updates for other nodes still apply)", () => {
    const previous = [
      infraNode({ id: "a", position: { x: 100, y: 100 }, dragging: true }),
      infraNode({ id: "b", position: { x: 5, y: 5 } }),
    ];
    const next = [
      infraNode({ id: "a", position: { x: 0, y: 0 } }),
      infraNode({ id: "b", position: { x: 50, y: 50 } }),
    ];
    const result = preserveDraggingState(next, previous);
    expect(result.find((n) => n.id === "a")?.position).toEqual({ x: 100, y: 100 });
    expect(result.find((n) => n.id === "b")?.position).toEqual({ x: 50, y: 50 });
  });

  it("keeps next's data (WorldState-derived content) even for a dragging node, only overriding position/dragging/selected", () => {
    const draggedEntity = { ...node, blockHeight: 999 };
    const previous: CanvasFlowNode[] = [
      infraNode({ position: { x: 240, y: 180 }, dragging: true }),
    ];
    const next: CanvasFlowNode[] = [
      infraNode({ position: { x: 0, y: 0 }, data: { entity: draggedEntity } }),
    ];
    const result = preserveDraggingState(next, previous);
    expect(result[0].position).toEqual({ x: 240, y: 180 });
    expect((result[0] as InfraFlowNode).data.entity).toBe(draggedEntity);
  });

  it("restores next's position once dragging has stopped (previous.dragging is false after onNodeDragStop)", () => {
    const previous = [
      infraNode({ position: { x: 240, y: 180 }, dragging: false, selected: true }),
    ];
    const next = [infraNode({ position: { x: 300, y: 300 } })];
    const result = preserveDraggingState(next, previous);
    expect(result[0]).toBe(next[0]);
    expect(result[0].position).toEqual({ x: 300, y: 300 });
  });

  it("leaves a newly added node (no matching previous id) untouched even while another node is dragging", () => {
    const previous = [
      infraNode({ id: "existing", position: { x: 240, y: 180 }, dragging: true }),
    ];
    const next = [
      infraNode({ id: "existing", position: { x: 0, y: 0 } }),
      infraNode({ id: "brand-new", position: { x: 50, y: 50 } }),
    ];
    const result = preserveDraggingState(next, previous);
    expect(result[1]).toBe(next[1]);
    // 新規ノードは position も next のまま（ドラッグ保全の対象外）。
    expect(result[1].position).toEqual({ x: 50, y: 50 });
  });

  it("preserves position/dragging/selected for every node dragged at once (multi-select drag)", () => {
    // マルチセレクトで複数ノードを同時にドラッグしている場合、React Flow は
    // 選択中の全ノードに dragging: true を積む。全ノードが保全対象になる。
    const previous = [
      infraNode({ id: "a", position: { x: 100, y: 100 }, dragging: true, selected: true }),
      infraNode({ id: "b", position: { x: 200, y: 200 }, dragging: true, selected: true }),
    ];
    const next = [
      infraNode({ id: "a", position: { x: 0, y: 0 } }),
      infraNode({ id: "b", position: { x: 0, y: 0 } }),
    ];
    const result = preserveDraggingState(next, previous);
    expect(result.find((n) => n.id === "a")?.position).toEqual({ x: 100, y: 100 });
    expect(result.find((n) => n.id === "b")?.position).toEqual({ x: 200, y: 200 });
    expect(result.every((n) => n.dragging === true && n.selected === true)).toBe(true);
  });

  it("does not resurrect a dragging node that has been removed from next (entity removed mid-drag)", () => {
    // ドラッグ中のノードが WebSocket 更新で削除され next から消えた場合、
    // previous 側の dragging: true に引きずられて復活させてはいけない。
    // 結果は next をベースに map するため、消えたノードは結果にも現れない。
    const previous = [
      infraNode({ id: "gone", position: { x: 100, y: 100 }, dragging: true }),
      infraNode({ id: "stay", position: { x: 5, y: 5 } }),
    ];
    const next = [infraNode({ id: "stay", position: { x: 9, y: 9 } })];
    const result = preserveDraggingState(next, previous);
    expect(result).toHaveLength(1);
    expect(result.find((n) => n.id === "gone")).toBeUndefined();
    expect(result[0].id).toBe("stay");
    expect(result[0].position).toEqual({ x: 9, y: 9 });
  });

  it("treats dragging: undefined the same as not dragging (only strict true is preserved)", () => {
    // dragging フラグを持たない（undefined）ノードは、false と同じく保全対象外。
    // 判定が `dragging === true` の厳密比較のため両者に差は無い。
    const previous = [infraNode({ position: { x: 100, y: 100 }, dragging: undefined })];
    const next = [infraNode({ position: { x: 0, y: 0 } })];
    expect(preserveDraggingState(next, previous)).toBe(next);
  });

  it("copies previous.selected even when it is undefined, overriding selected on next", () => {
    // ドラッグ中は previous 側の操作状態を正とする。previous.selected が
    // undefined（未選択）なら、next.selected が true でも undefined で上書きする。
    const previous = [infraNode({ position: { x: 100, y: 100 }, dragging: true })];
    const next = [infraNode({ position: { x: 0, y: 0 }, selected: true })];
    const result = preserveDraggingState(next, previous);
    expect(result[0].selected).toBeUndefined();
  });

  it("returns a fresh object for the dragging node without mutating next or aliasing previous", () => {
    const previous = [infraNode({ position: { x: 100, y: 100 }, dragging: true })];
    const next = [infraNode({ position: { x: 0, y: 0 } })];
    const result = preserveDraggingState(next, previous);
    expect(result[0]).not.toBe(next[0]);
    expect(result[0]).not.toBe(previous[0]);
    // 元の next 要素は書き換えない（純粋関数として不変性を保つ）。
    expect(next[0].position).toEqual({ x: 0, y: 0 });
  });

  it("preserves the order of the next array while a node is dragging", () => {
    const previous = [
      infraNode({ id: "a", position: { x: 1, y: 1 }, dragging: true }),
      infraNode({ id: "b" }),
      infraNode({ id: "c" }),
    ];
    const next = [infraNode({ id: "c" }), infraNode({ id: "a" }), infraNode({ id: "b" })];
    const result = preserveDraggingState(next, previous);
    expect(result.map((n) => n.id)).toEqual(["c", "a", "b"]);
  });

  it("handles an empty next array even when a previous node is dragging", () => {
    const previous = [infraNode({ position: { x: 100, y: 100 }, dragging: true })];
    expect(preserveDraggingState([], previous)).toEqual([]);
  });

  it("preserves the dragged card across a mixed array of infra and wallet cards, keyed by id", () => {
    const walletNode: WalletFlowNode = {
      id: "0xabc",
      type: "wallet",
      position: { x: 300, y: 300 },
      dragging: true,
      selected: true,
      data: {
        entity: wallet,
        transactions: [],
        settlingHashes: [],
        ownerPresent: false,
        contractsByAddress: new Map(),
      },
    };
    const previous: CanvasFlowNode[] = [
      infraNode({ id: "reth-1", position: { x: 10, y: 10 } }),
      walletNode,
    ];
    const next: CanvasFlowNode[] = [
      infraNode({ id: "reth-1", position: { x: 11, y: 11 } }),
      {
        id: "0xabc",
        type: "wallet",
        position: { x: 0, y: 0 },
        data: {
          entity: wallet,
          transactions: [],
          settlingHashes: [],
          ownerPresent: false,
          contractsByAddress: new Map(),
        },
      },
    ];
    const result = preserveDraggingState<CanvasFlowNode>(next, previous);
    // infra はドラッグ中でないので next の position を反映する。
    expect(result[0].position).toEqual({ x: 11, y: 11 });
    // wallet はドラッグ中なので previous の position/dragging/selected を維持する。
    expect(result[1].position).toEqual({ x: 300, y: 300 });
    expect(result[1].dragging).toBe(true);
    expect(result[1].selected).toBe(true);
  });

  it("composes with preserveMeasuredDimensions as Canvas.tsx does (measured from previous, position/dragging/selected from previous, data from next)", () => {
    // Canvas.tsx の実際の合成:
    //   preserveDraggingState(preserveMeasuredDimensions(nodes, current), current)
    // ドラッグ中ノードでも measured は preserveMeasuredDimensions が previous から
    // 引き継ぎ、position/dragging/selected は preserveDraggingState が previous から
    // 引き継ぎ、data（残高・ブロック高など）は next の最新値が残る。両関数が
    // 触るフィールドが独立しているため相互に打ち消し合わない。
    const draggedEntity = { ...node, blockHeight: 4242 };
    const previous = [
      infraNode({
        position: { x: 240, y: 180 },
        dragging: true,
        selected: true,
        measured: { width: 200, height: 77 },
      }),
    ];
    const next = [infraNode({ position: { x: 0, y: 0 }, data: { entity: draggedEntity } })];
    const result = preserveDraggingState(preserveMeasuredDimensions(next, previous), previous);
    expect(result[0].position).toEqual({ x: 240, y: 180 });
    expect(result[0].dragging).toBe(true);
    expect(result[0].selected).toBe(true);
    expect(result[0].measured).toEqual({ width: 200, height: 77 });
    expect((result[0] as InfraFlowNode).data.entity).toBe(draggedEntity);
  });
});
