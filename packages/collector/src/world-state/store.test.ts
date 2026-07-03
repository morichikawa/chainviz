import type { NodeEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { WorldStateStore } from "./store.js";

function node(overrides: Partial<NodeEntity> = {}): NodeEntity {
  return {
    kind: "node",
    id: "chainviz-ethereum/reth1",
    containerName: "reth1",
    ip: "172.28.1.1",
    ports: [8545],
    resources: { cpuPercent: 10, memMB: 100 },
    process: { name: "reth" },
    chainType: "ethereum",
    clientType: "reth",
    syncStatus: "syncing",
    blockHeight: 0,
    headBlockHash: "",
    ...overrides,
  };
}

describe("WorldStateStore", () => {
  it("starts empty", () => {
    const store = new WorldStateStore("ethereum");
    const snapshot = store.getSnapshot();
    expect(snapshot.chainType).toBe("ethereum");
    expect(snapshot.entities).toEqual([]);
    expect(snapshot.edges).toEqual([]);
  });

  it("returns add events and reflects them in the snapshot on first poll", () => {
    const store = new WorldStateStore();
    const diff = store.applyInfra([node()]);
    expect(diff).toEqual([{ type: "entityAdded", entity: node() }]);
    expect(store.getSnapshot().entities).toEqual([node()]);
  });

  it("returns an empty diff when a poll brings no changes", () => {
    const store = new WorldStateStore();
    store.applyInfra([node()]);
    const diff = store.applyInfra([node()]);
    expect(diff).toEqual([]);
  });

  it("applies updates by merging the patch into the stored entity", () => {
    const store = new WorldStateStore();
    store.applyInfra([node()]);
    const diff = store.applyInfra([
      node({ resources: { cpuPercent: 80, memMB: 150 } }),
    ]);
    expect(diff).toEqual([
      {
        type: "entityUpdated",
        id: "chainviz-ethereum/reth1",
        patch: { resources: { cpuPercent: 80, memMB: 150 } },
      },
    ]);
    const stored = store.getSnapshot().entities[0] as NodeEntity;
    expect(stored.resources).toEqual({ cpuPercent: 80, memMB: 150 });
    // 変化していないフィールドは保持される
    expect(stored.clientType).toBe("reth");
  });

  it("removes infra entities that are no longer observed", () => {
    const store = new WorldStateStore();
    store.applyInfra([node()]);
    const diff = store.applyInfra([]);
    expect(diff).toEqual([
      { type: "entityRemoved", id: "chainviz-ethereum/reth1" },
    ]);
    expect(store.getSnapshot().entities).toEqual([]);
  });

  it("removes only the infra entity that disappeared, keeping the others", () => {
    const store = new WorldStateStore();
    const reth1 = node();
    const reth2 = node({
      id: "chainviz-ethereum/reth2",
      containerName: "reth2",
      ip: "172.28.1.2",
    });
    store.applyInfra([reth1, reth2]);
    const diff = store.applyInfra([reth2]);
    expect(diff).toEqual([
      { type: "entityRemoved", id: "chainviz-ethereum/reth1" },
    ]);
    const ids = store.getSnapshot().entities.map((e) => (e as NodeEntity).id);
    expect(ids).toEqual(["chainviz-ethereum/reth2"]);
  });

  it("advances the snapshot timestamp on apply", () => {
    const store = new WorldStateStore();
    const before = store.getSnapshot().timestamp;
    store.applyInfra([node()]);
    const after = store.getSnapshot().timestamp;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("re-adds (not updates) an entity that disappeared and came back", () => {
    const store = new WorldStateStore();
    store.applyInfra([node()]); // add
    const removeDiff = store.applyInfra([]); // remove
    expect(removeDiff).toEqual([
      { type: "entityRemoved", id: "chainviz-ethereum/reth1" },
    ]);
    expect(store.getSnapshot().entities).toEqual([]);

    // 同じ ID で戻ってきたら entityUpdated ではなく entityAdded になる
    const returned = node({ resources: { cpuPercent: 70, memMB: 200 } });
    const readdDiff = store.applyInfra([returned]);
    expect(readdDiff).toEqual([{ type: "entityAdded", entity: returned }]);
    expect(store.getSnapshot().entities).toEqual([returned]);
  });

  it("stores a single entity when a poll contains duplicate stable ids", () => {
    const store = new WorldStateStore();
    const diff = store.applyInfra([
      node({ resources: { cpuPercent: 1, memMB: 1 } }),
      node({ resources: { cpuPercent: 2, memMB: 2 } }),
    ]);
    // 重複は後勝ちで 1 件に畳まれる
    expect(diff).toHaveLength(1);
    const entities = store.getSnapshot().entities;
    expect(entities).toHaveLength(1);
    expect((entities[0] as NodeEntity).resources).toEqual({
      cpuPercent: 2,
      memMB: 2,
    });
  });

  it("accumulates successive updates across multiple polls", () => {
    const store = new WorldStateStore();
    store.applyInfra([node()]);
    store.applyInfra([node({ syncStatus: "synced" })]);
    const diff = store.applyInfra([
      node({ syncStatus: "synced", blockHeight: 10 }),
    ]);
    // 2 回目の poll では syncStatus は変化していないため patch は blockHeight のみ
    expect(diff).toEqual([
      {
        type: "entityUpdated",
        id: "chainviz-ethereum/reth1",
        patch: { blockHeight: 10 },
      },
    ]);
    const stored = store.getSnapshot().entities[0] as NodeEntity;
    expect(stored.syncStatus).toBe("synced");
    expect(stored.blockHeight).toBe(10);
  });

  it("does not mutate the snapshot array returned to callers", () => {
    const store = new WorldStateStore();
    store.applyInfra([node()]);
    const snapshot = store.getSnapshot();
    snapshot.entities.push(node({ id: "injected" }));
    // 呼び出し側が返り値をいじっても内部状態は汚染されない
    expect(store.getSnapshot().entities).toHaveLength(1);
  });

  it("emits an add for a second distinct node while keeping the first", () => {
    const store = new WorldStateStore();
    store.applyInfra([node()]);
    const diff = store.applyInfra([
      node(),
      node({ id: "chainviz-ethereum/reth2", containerName: "reth2" }),
    ]);
    expect(diff).toEqual([
      {
        type: "entityAdded",
        entity: node({
          id: "chainviz-ethereum/reth2",
          containerName: "reth2",
        }),
      },
    ]);
    expect(store.getSnapshot().entities).toHaveLength(2);
  });
});
