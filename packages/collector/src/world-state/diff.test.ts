import type { NodeEntity, WorkbenchEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { computeDiff, entityId } from "./diff.js";

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

function workbench(overrides: Partial<WorkbenchEntity> = {}): WorkbenchEntity {
  return {
    kind: "workbench",
    id: "chainviz-ethereum/workbench",
    containerName: "workbench",
    ip: "172.28.3.1",
    ports: [],
    resources: { cpuPercent: 0, memMB: 5 },
    process: { name: "sh" },
    label: "workbench",
    walletIds: [],
    ...overrides,
  };
}

describe("entityId", () => {
  it("uses id for infra entities", () => {
    expect(entityId(node())).toBe("chainviz-ethereum/reth1");
    expect(entityId(workbench())).toBe("chainviz-ethereum/workbench");
  });

  it("uses address for wallet and contract", () => {
    expect(
      entityId({
        kind: "wallet",
        address: "0xabc",
        chainType: "ethereum",
        balance: "0",
        nonce: 0,
        isSmartAccount: false,
        ownerWorkbenchId: null,
        recentTxHashes: [],
      }),
    ).toBe("0xabc");
  });

  it("uses hash for block and transaction", () => {
    expect(
      entityId({
        kind: "block",
        hash: "0xdead",
        number: 1,
        parentHash: "0x0",
        timestamp: 0,
        receivedAt: {},
      }),
    ).toBe("0xdead");
  });
});

describe("computeDiff", () => {
  it("emits entityAdded for new entities", () => {
    const events = computeDiff([], [node()]);
    expect(events).toEqual([{ type: "entityAdded", entity: node() }]);
  });

  it("emits entityRemoved for entities that disappeared", () => {
    const events = computeDiff([node()], []);
    expect(events).toEqual([
      { type: "entityRemoved", id: "chainviz-ethereum/reth1" },
    ]);
  });

  it("emits no events when nothing changed", () => {
    const events = computeDiff([node()], [node()]);
    expect(events).toEqual([]);
  });

  it("emits entityUpdated with only the changed fields", () => {
    const before = node({ resources: { cpuPercent: 10, memMB: 100 } });
    const after = node({ resources: { cpuPercent: 55, memMB: 120 } });
    const events = computeDiff([before], [after]);
    expect(events).toEqual([
      {
        type: "entityUpdated",
        id: "chainviz-ethereum/reth1",
        patch: { resources: { cpuPercent: 55, memMB: 120 } },
      },
    ]);
  });

  it("detects changes in nested arrays", () => {
    const before = node({ ports: [8545] });
    const after = node({ ports: [8545, 8546] });
    const events = computeDiff([before], [after]);
    expect(events).toEqual([
      {
        type: "entityUpdated",
        id: "chainviz-ethereum/reth1",
        patch: { ports: [8545, 8546] },
      },
    ]);
  });

  it("handles a combination of add, update and remove in one pass", () => {
    const reth1 = node();
    const reth1Updated = node({ resources: { cpuPercent: 99, memMB: 100 } });
    const wb = workbench();
    const events = computeDiff([reth1, wb], [reth1Updated]);

    expect(events).toContainEqual({
      type: "entityUpdated",
      id: "chainviz-ethereum/reth1",
      patch: { resources: { cpuPercent: 99, memMB: 100 } },
    });
    expect(events).toContainEqual({
      type: "entityRemoved",
      id: "chainviz-ethereum/workbench",
    });
    expect(events).toHaveLength(2);
  });

  it("emits all add/update events before any remove event", () => {
    const keep = node();
    const keepUpdated = node({ resources: { cpuPercent: 42, memMB: 100 } });
    const gone = node({ id: "chainviz-ethereum/reth2" });
    const fresh = node({ id: "chainviz-ethereum/reth3" });

    const events = computeDiff([keep, gone], [keepUpdated, fresh]);
    const lastEvent = events[events.length - 1];
    expect(lastEvent?.type).toBe("entityRemoved");
    // remove は末尾にまとまる（add/update が先）
    const removeIndex = events.findIndex((e) => e.type === "entityRemoved");
    const nonRemoveAfter = events
      .slice(removeIndex)
      .some((e) => e.type !== "entityRemoved");
    expect(nonRemoveAfter).toBe(false);
  });

  it("returns no events for two empty inputs", () => {
    expect(computeDiff([], [])).toEqual([]);
  });

  it("collapses duplicate ids in next, keeping the last occurrence", () => {
    // 安定 ID が重複するケース（compose service ラベルの重複など）。
    // Map で後勝ちになり、1 エンティティとして 1 イベントに畳まれる。
    const first = node({ resources: { cpuPercent: 1, memMB: 1 } });
    const second = node({ resources: { cpuPercent: 2, memMB: 2 } });
    const events = computeDiff([], [first, second]);
    expect(events).toEqual([
      {
        type: "entityAdded",
        entity: node({ resources: { cpuPercent: 2, memMB: 2 } }),
      },
    ]);
  });

  it("collapses duplicate ids in prev into a single remove", () => {
    const dupA = node();
    const dupB = node({ resources: { cpuPercent: 9, memMB: 9 } });
    const events = computeDiff([dupA, dupB], []);
    expect(events).toEqual([
      { type: "entityRemoved", id: "chainviz-ethereum/reth1" },
    ]);
  });

  it("reports a full patch when many fields change at once", () => {
    const before = node();
    const after = node({
      ip: "10.0.0.9",
      ports: [8545, 8546],
      syncStatus: "synced",
      blockHeight: 128,
      headBlockHash: "0xabc",
    });
    const events = computeDiff([before], [after]);
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event.type).toBe("entityUpdated");
    if (event.type === "entityUpdated") {
      expect(event.patch).toEqual({
        ip: "10.0.0.9",
        ports: [8545, 8546],
        syncStatus: "synced",
        blockHeight: 128,
        headBlockHash: "0xabc",
      });
    }
  });

  it("distinguishes entities that differ only by kind-specific keys", () => {
    const before = workbench({ label: "Alice" });
    const after = workbench({ label: "Bob" });
    const events = computeDiff([before], [after]);
    expect(events).toEqual([
      {
        type: "entityUpdated",
        id: "chainviz-ethereum/workbench",
        patch: { label: "Bob" },
      },
    ]);
  });
});
