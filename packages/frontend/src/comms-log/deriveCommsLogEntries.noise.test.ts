// 「ログエントリを生み出してはいけない」DiffEvent の組み合わせを固定する
// テスト。各カテゴリの正常系（entityが生成されるケース）はカテゴリ別
// ファイルにあるため、ここでは誤分類・過剰記録の防止という関心事に絞る
// （CLAUDE.md のテスト分割方針）。ログが「揮発イベントの記録」であるという
// 性質上、resource 更新のような高頻度の内部更新が紛れ込むと実用にならない
// ため、これらが無視されることの回帰価値は高い。
import type { WorldState } from "../world-state/store.js";
import { describe, expect, it } from "vitest";
import { deriveCommsLogEntries } from "./deriveCommsLogEntries.js";
import { testBlock, testNode, testTransaction, testWorkbench } from "./testFixtures.js";

describe("deriveCommsLogEntries: entityUpdated that must not produce a log entry", () => {
  it("ignores a node update (e.g. resource/sync-status churn is not a comms event)", () => {
    const prevState: WorldState = {
      entities: { "reth-1": testNode({ id: "reth-1", syncStatus: "syncing" }) },
      edges: [],
    };
    const entries = deriveCommsLogEntries(
      prevState,
      [
        {
          type: "entityUpdated",
          id: "reth-1",
          patch: { syncStatus: "synced", resources: { cpuPercent: 50, memMB: 512 } },
        },
      ],
      1_000,
    );
    expect(entries).toEqual([]);
  });

  it("ignores a workbench update", () => {
    const prevState: WorldState = {
      entities: { "wb-1": testWorkbench({ id: "wb-1", label: "Alice" }) },
      edges: [],
    };
    const entries = deriveCommsLogEntries(
      prevState,
      [{ type: "entityUpdated", id: "wb-1", patch: { walletIds: ["0xw1"] } }],
      1_000,
    );
    expect(entries).toEqual([]);
  });

  it("ignores a block update that only touches non-receivedAt fields", () => {
    const prevState: WorldState = {
      entities: { "0xb1": testBlock({ hash: "0xb1", number: 5, receivedAt: { "reth-1": 1_000 } }) },
      edges: [],
    };
    const entries = deriveCommsLogEntries(
      prevState,
      [{ type: "entityUpdated", id: "0xb1", patch: { timestamp: 2_000 } }],
      1_000,
    );
    expect(entries).toEqual([]);
  });
});

describe("deriveCommsLogEntries: entityRemoved that must not produce a log entry", () => {
  it("ignores removal of a block (only node/workbench/contract removals are environment events)", () => {
    const prevState: WorldState = {
      entities: { "0xb1": testBlock({ hash: "0xb1", number: 5 }) },
      edges: [],
    };
    const entries = deriveCommsLogEntries(prevState, [{ type: "entityRemoved", id: "0xb1" }], 1_000);
    expect(entries).toEqual([]);
  });

  it("ignores removal of a transaction", () => {
    const prevState: WorldState = {
      entities: { "0xa11c": testTransaction({ hash: "0xa11c", status: "pending" }) },
      edges: [],
    };
    const entries = deriveCommsLogEntries(prevState, [{ type: "entityRemoved", id: "0xa11c" }], 1_000);
    expect(entries).toEqual([]);
  });

  it("ignores removal of a wallet (out of scope per design)", () => {
    const prevState: WorldState = {
      entities: {
        "0xw1": {
          kind: "wallet",
          address: "0xw1",
          chainType: "ethereum",
          balance: "0",
          nonce: 0,
          isSmartAccount: false,
          ownerWorkbenchId: null,
          recentTxHashes: [],
        },
      },
      edges: [],
    };
    const entries = deriveCommsLogEntries(prevState, [{ type: "entityRemoved", id: "0xw1" }], 1_000);
    expect(entries).toEqual([]);
  });

  it("ignores removal of an id that is not present in the state (defensive)", () => {
    const entries = deriveCommsLogEntries(
      { entities: {}, edges: [] },
      [{ type: "entityRemoved", id: "ghost" }],
      1_000,
    );
    expect(entries).toEqual([]);
  });
});
