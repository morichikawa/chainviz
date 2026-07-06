import type {
  NodeEntity,
  WalletEntity,
  WorkbenchEntity,
} from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRID,
  type InfraFlowNode,
  defaultGridPosition,
  entitiesToFlowNodes,
  findFreeGridPosition,
  isInfraEntity,
  isSameInfraNode,
  positionKey,
  resolveLayoutPositions,
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

  it("assigns unsaved cards to the lowest free grid slot, not wasting a slot on saved cards (Issue #123)", () => {
    // b は保存済み(グリッド外の座標)。a と c は未保存で、互いに衝突しない
    // 最小の空きセルへ詰めて割り当てられる（b の保存位置がグリッド上の
    // セルでなければ、a=index0, c=index1 になる。旧実装は配列内の並び順で
    // index を消費していたため c は index2 になっていた）。
    const nodes = entitiesToFlowNodes(
      [node("c", "c-c"), node("a", "c-a"), node("b", "c-b")],
      { "c-b": { x: 999, y: 888 } },
    );
    expect(nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(nodes[1].position).toEqual({ x: 999, y: 888 });
    expect(nodes[2].position).toEqual({ x: DEFAULT_GRID.gapX, y: 0 });
  });

  it("does not shift a previously-saved card's position when a new unsaved card appears (Issue #123)", () => {
    // 既存カード a は保存済み。新規カード b が増えても a の位置は変わらない
    // （旧「id ソートで添字を振り直す」方式ではここが動いてしまっていた）。
    const before = entitiesToFlowNodes([node("a", "c-a")], {
      "c-a": { x: 500, y: 500 },
    });
    const after = entitiesToFlowNodes([node("a", "c-a"), node("b", "c-b")], {
      "c-a": { x: 500, y: 500 },
    });
    expect(after.find((n) => n.id === "a")?.position).toEqual(
      before[0].position,
    );
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

  it("returns false when only x changed", () => {
    const entity = node("a", "c-a");
    const previous = entitiesToFlowNodes([entity], { "c-a": { x: 0, y: 5 } })[0];
    const next = entitiesToFlowNodes([entity], { "c-a": { x: 1, y: 5 } })[0];
    expect(isSameInfraNode(previous, next)).toBe(false);
  });

  it("returns false when only y changed", () => {
    const entity = node("a", "c-a");
    const previous = entitiesToFlowNodes([entity], { "c-a": { x: 5, y: 0 } })[0];
    const next = entitiesToFlowNodes([entity], { "c-a": { x: 5, y: 1 } })[0];
    expect(isSameInfraNode(previous, next)).toBe(false);
  });

  it("compares position by value, so distinct position objects with equal x/y are 'same'", () => {
    // 同じ entity 参照・座標だが position は別オブジェクト。参照比較ではなく
    // x/y の値比較なので同一とみなす(不要な再計測を招かない)。
    const entity = node("a", "c-a");
    const previous: InfraFlowNode = {
      id: "a",
      type: "infra",
      position: { x: 3, y: 4 },
      data: { entity },
    };
    const next: InfraFlowNode = {
      id: "a",
      type: "infra",
      position: { x: 3, y: 4 },
      data: { entity },
    };
    expect(previous.position).not.toBe(next.position);
    expect(isSameInfraNode(previous, next)).toBe(true);
  });

  it("detects a deep field change because the store hands back a new entity reference", () => {
    // resources のような入れ子フィールドだけが変わっても、WorldState 側は
    // 内容変更時に必ず新しい entity オブジェクトを作る(参照が変わる)ため
    // isSameInfraNode は変化を取りこぼさない。浅い比較で深い変更を
    // 見逃していないことの確認。
    const base = node("a", "c-a");
    const changed: typeof base = {
      ...base,
      resources: { ...base.resources, cpuPercent: 99 },
    };
    const previous = { ...entitiesToFlowNodes([base], {})[0], data: { entity: base } };
    const next = { ...entitiesToFlowNodes([changed], {})[0], data: { entity: changed } };
    expect(isSameInfraNode(previous, next)).toBe(false);
  });

  it("returns true only while the exact same entity reference is shared (reference-based, by design)", () => {
    // 同一 entity 参照であれば内容も同一であることが保証される(store 契約)。
    const shared = node("a", "c-a");
    const previous = { ...entitiesToFlowNodes([shared], {})[0], data: { entity: shared } };
    const next = { ...entitiesToFlowNodes([shared], {})[0], data: { entity: shared } };
    expect(isSameInfraNode(previous, next)).toBe(true);
  });
});

describe("positionKey", () => {
  it("encodes x and y as a comma-separated string", () => {
    expect(positionKey({ x: 10, y: 20 })).toBe("10,20");
  });

  it("distinguishes positions that only differ in one coordinate", () => {
    expect(positionKey({ x: 1, y: 2 })).not.toBe(positionKey({ x: 2, y: 1 }));
  });

  it("handles negative and zero coordinates", () => {
    expect(positionKey({ x: 0, y: -5 })).toBe("0,-5");
  });
});

describe("findFreeGridPosition (Issue #123)", () => {
  it("returns the first grid cell when nothing is occupied", () => {
    expect(findFreeGridPosition([])).toEqual(defaultGridPosition(0));
  });

  it("skips occupied cells and returns the first free one", () => {
    const occupied = [positionKey(defaultGridPosition(0)), positionKey(defaultGridPosition(1))];
    expect(findFreeGridPosition(occupied)).toEqual(defaultGridPosition(2));
  });

  it("finds a gap in the middle of the occupied set (not just the tail)", () => {
    const occupied = [positionKey(defaultGridPosition(0)), positionKey(defaultGridPosition(2))];
    expect(findFreeGridPosition(occupied)).toEqual(defaultGridPosition(1));
  });

  it("accepts any Iterable<string>, not only an array", () => {
    const occupied = new Set([positionKey(defaultGridPosition(0))]);
    expect(findFreeGridPosition(occupied)).toEqual(defaultGridPosition(1));
  });

  it("honors a custom grid", () => {
    const grid = { columns: 1, gapX: 10, gapY: 10, originX: 0, originY: 0 };
    const occupied = [positionKey(defaultGridPosition(0, grid))];
    expect(findFreeGridPosition(occupied, grid)).toEqual(defaultGridPosition(1, grid));
  });

  it("does not loop forever when every cell up to a large index is occupied", () => {
    const occupied = Array.from({ length: 50 }, (_, i) => positionKey(defaultGridPosition(i)));
    expect(findFreeGridPosition(occupied)).toEqual(defaultGridPosition(50));
  });
});

describe("resolveLayoutPositions (Issue #123 §4-3)", () => {
  it("returns the same layout reference unchanged when nothing is missing", () => {
    const layout = { "c-a": { x: 0, y: 0 } };
    expect(resolveLayoutPositions(["c-a"], layout)).toBe(layout);
  });

  it("assigns a free grid slot to a single missing container", () => {
    const next = resolveLayoutPositions(["c-a"], {});
    expect(next["c-a"]).toEqual(defaultGridPosition(0));
  });

  it("does not overwrite an already-saved position for an existing container", () => {
    const layout = { "c-a": { x: 500, y: 500 } };
    const next = resolveLayoutPositions(["c-a", "c-b"], layout);
    expect(next["c-a"]).toEqual({ x: 500, y: 500 });
  });

  it("assigns missing containers in alphabetical order (deterministic, not arrival order)", () => {
    const next = resolveLayoutPositions(["c-b", "c-a"], {});
    expect(next["c-a"]).toEqual(defaultGridPosition(0));
    expect(next["c-b"]).toEqual(defaultGridPosition(1));
  });

  it("skips a grid cell already occupied by a saved position that happens to land on it", () => {
    // 保存済み c-a がグリッド上のセル(0番)と一致する座標にある場合、
    // 新規カード c-b はそこを避けて次の空きセル(1番)へ入る。
    const layout = { "c-a": defaultGridPosition(0) };
    const next = resolveLayoutPositions(["c-a", "c-b"], layout);
    expect(next["c-b"]).toEqual(defaultGridPosition(1));
  });

  it("preserves previously-assigned entries across repeated calls (never moves existing cards)", () => {
    const first = resolveLayoutPositions(["c-a"], {});
    const second = resolveLayoutPositions(["c-a", "c-b"], first);
    expect(second["c-a"]).toEqual(first["c-a"]);
  });

  it("returns an empty object for no container names and an empty layout", () => {
    expect(resolveLayoutPositions([], {})).toEqual({});
  });

  it("honors a custom grid when assigning new positions", () => {
    const grid = { columns: 1, gapX: 10, gapY: 20, originX: 5, originY: 7 };
    const next = resolveLayoutPositions(["c-a"], {}, grid);
    expect(next["c-a"]).toEqual(defaultGridPosition(0, grid));
  });

  it("fills multiple interior gaps when several containers are missing at once", () => {
    // slot0 と slot2 が保存済みで埋まっている。未保存の c-x, c-y は空いている
    // slot1 → slot3 の順に詰めて割り当てられる（複数欠けの中抜けを正しく埋める）。
    const layout = {
      "c-0": defaultGridPosition(0),
      "c-2": defaultGridPosition(2),
    };
    const next = resolveLayoutPositions(["c-0", "c-2", "c-x", "c-y"], layout);
    expect(next["c-x"]).toEqual(defaultGridPosition(1));
    expect(next["c-y"]).toEqual(defaultGridPosition(3));
  });

  it("keeps a removed card's slot reserved via its stale layout entry so a new card never overlaps it (Issue #113-adjacent)", () => {
    // App.tsx は削除されたカードのレイアウトエントリを掃除せず、present な
    // containerName だけを resolveLayoutPositions へ渡す。stale なエントリが
    // slot を占有し続けるため、削除→追加が入り乱れても新規カードが削除済み
    // カードの位置と重ならない（Issue #113 と同種の重なりが再発しないことの確認）。
    const layout = {
      "c-a": defaultGridPosition(0),
      "c-b": defaultGridPosition(1),
    };
    // c-a は削除済み（present に含めない）。新規 c-c が来る。
    const next = resolveLayoutPositions(["c-b", "c-c"], layout);
    expect(next["c-c"]).toEqual(defaultGridPosition(2));
    expect(next["c-c"]).not.toEqual(layout["c-a"]);
  });

  it("does not consume a grid slot for a saved card placed off the grid (dragged away)", () => {
    // ドラッグでグリッド外へ動かした保存済みカードはグリッドセルを占有しない。
    // 新規カードは slot0 から普通に詰められる（resolveLayoutPositions 単体での確認）。
    const layout = { "c-a": { x: 12345, y: 67890 } };
    const next = resolveLayoutPositions(["c-a", "c-b"], layout);
    expect(next["c-b"]).toEqual(defaultGridPosition(0));
  });
});
