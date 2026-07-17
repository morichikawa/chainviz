// 同一 diff バッチ内で「同じエンティティ／エッジへの複数イベントが連続する」
// ケースの網羅テスト。block カテゴリの entityAdded→entityUpdated 見落とし
// （deriveCommsLogEntries.block.test.ts の回帰）は、`running`（イベントを
// 1件ずつ適用して進める state）の導入で修正済みだが、同じ仕組みが tx・環境・
// peer など block 以外のカテゴリでも正しく機能する（横展開漏れが無い）ことを
// このファイルで固定する。CLAUDE.md のテスト分割方針に従い、カテゴリ別
// ファイルとは別に「バッチ内の逐次適用」という関心事だけをここへ集約する。
import type { BlockEntity, TransactionEntity } from "@chainviz/shared";
import type { WorldState } from "../world-state/store.js";
import { describe, expect, it } from "vitest";
import { deriveCommsLogEntries } from "./deriveCommsLogEntries.js";
import { testBlock, testNode, testTransaction } from "./testFixtures.js";

const emptyState: WorldState = { entities: {}, edges: [] };

describe("deriveCommsLogEntries: same-batch sequential events (tx)", () => {
  it("emits both the pending add and the included update when they arrive in one batch", () => {
    const block = testBlock({ hash: "0xblock1", number: 130 });
    const tx = testTransaction({ hash: "0xa11c", status: "pending" });
    // block を先に足しておく（included の blockNumber 解決に使う）。
    const prevState: WorldState = { entities: { "0xblock1": block }, edges: [] };

    const entries = deriveCommsLogEntries(
      prevState,
      [
        { type: "entityAdded", entity: tx },
        { type: "entityUpdated", id: "0xa11c", patch: { status: "included", blockHash: "0xblock1" } },
      ],
      3_000,
    );

    const txEntries = entries.filter((entry) => entry.category === "tx");
    expect(txEntries.map((entry) => (entry.category === "tx" ? entry.status : null))).toEqual([
      "pending",
      "included",
    ]);
    const included = txEntries.find((entry) => entry.category === "tx" && entry.status === "included");
    expect(included).toMatchObject({ blockNumber: 130 });
  });

  it("emits both the pending add and a failed update in one batch", () => {
    const entries = deriveCommsLogEntries(
      emptyState,
      [
        { type: "entityAdded", entity: testTransaction({ hash: "0xa11c", status: "pending" }) },
        { type: "entityUpdated", id: "0xa11c", patch: { status: "failed" } },
      ],
      3_000,
    );

    const statuses = entries
      .filter((entry) => entry.category === "tx")
      .map((entry) => (entry.category === "tx" ? entry.status : null));
    expect(statuses).toEqual(["pending", "failed"]);
  });

  it("resolves the block number of an included tx whose block was added earlier in the same batch", () => {
    const block: BlockEntity = testBlock({ hash: "0xblock9", number: 900 });
    const tx: TransactionEntity = testTransaction({
      hash: "0xbeef",
      status: "included",
      blockHash: "0xblock9",
    });

    const entries = deriveCommsLogEntries(
      emptyState,
      [
        { type: "entityAdded", entity: block },
        { type: "entityAdded", entity: tx },
      ],
      3_000,
    );

    const txEntry = entries.find((entry) => entry.category === "tx");
    expect(txEntry).toMatchObject({ status: "included", blockNumber: 900 });
  });
});

describe("deriveCommsLogEntries: same-batch sequential events (environment)", () => {
  it("emits both an addition and a removal of the same node in one batch", () => {
    const entries = deriveCommsLogEntries(
      emptyState,
      [
        { type: "entityAdded", entity: testNode({ id: "reth-3", containerName: "chainviz-reth-3" }) },
        { type: "entityRemoved", id: "reth-3" },
      ],
      2_000,
    );

    const changes = entries
      .filter((entry) => entry.category === "environment")
      .map((entry) => (entry.category === "environment" ? entry.change : null));
    expect(changes).toEqual(["nodeAdded", "nodeRemoved"]);
    // 削除エントリのラベルも、そのバッチで追加された containerName から解決できる。
    const removed = entries.find(
      (entry) => entry.category === "environment" && entry.change === "nodeRemoved",
    );
    expect(removed).toMatchObject({ subjectLabel: "chainviz-reth-3" });
  });
});

describe("deriveCommsLogEntries: same-batch sequential events (peer)", () => {
  it("emits both a connect and a disconnect of the same edge in one batch", () => {
    const prevState = {
      entities: {
        "reth-1": testNode({ id: "reth-1", containerName: "chainviz-reth-1" }),
        "reth-2": testNode({ id: "reth-2", containerName: "chainviz-reth-2" }),
      },
      edges: [],
    } as WorldState;

    const entries = deriveCommsLogEntries(
      prevState,
      [
        {
          type: "edgeAdded",
          edge: { kind: "peer", fromNodeId: "reth-1", toNodeId: "reth-2", networkId: "1337" },
        },
        { type: "edgeRemoved", fromNodeId: "reth-1", toNodeId: "reth-2", networkId: "1337" },
      ],
      1_000,
    );

    const changes = entries
      .filter((entry) => entry.category === "peer")
      .map((entry) => (entry.category === "peer" ? entry.change : null));
    expect(changes.sort()).toEqual(["connected", "disconnected"]);
    // 両方とも端点ラベルが解決できている（id フォールバックではない）。
    for (const entry of entries) {
      if (entry.category === "peer") {
        expect(entry.fromLabel).toBe("chainviz-reth-1");
        expect(entry.toLabel).toBe("chainviz-reth-2");
      }
    }
  });
});

describe("deriveCommsLogEntries: same-batch sequential events (multiple blocks interleaved)", () => {
  it("tracks each block's receivedAt independently when two blocks are added and updated in one batch", () => {
    const prevState = {
      entities: {
        "reth-1": testNode({ id: "reth-1", containerName: "reth-1" }),
        "reth-2": testNode({ id: "reth-2", containerName: "reth-2" }),
      },
      edges: [],
    } as WorldState;
    const blockA: BlockEntity = testBlock({ hash: "0xA", number: 1, receivedAt: { "reth-1": 1_000 } });
    const blockB: BlockEntity = testBlock({ hash: "0xB", number: 2, receivedAt: { "reth-1": 2_000 } });

    const entries = deriveCommsLogEntries(
      prevState,
      [
        { type: "entityAdded", entity: blockA },
        { type: "entityAdded", entity: blockB },
        { type: "entityUpdated", id: "0xA", patch: { receivedAt: { "reth-1": 1_000, "reth-2": 1_100 } } },
        { type: "entityUpdated", id: "0xB", patch: { receivedAt: { "reth-1": 2_000, "reth-2": 2_150 } } },
      ],
      3_000,
    );

    const blockEntries = entries.filter((entry) => entry.category === "block");
    // 各ブロック2ノードぶん = 計4件。片方の update が握りつぶされていないこと。
    expect(blockEntries).toHaveLength(4);
    const byKey = Object.fromEntries(
      blockEntries.map((entry) =>
        entry.category === "block" ? [`${entry.blockNumber}:${entry.nodeId}`, entry] : ["", entry],
      ),
    );
    expect(byKey["1:reth-2"]).toMatchObject({ relativeDelayMs: 100 });
    expect(byKey["2:reth-2"]).toMatchObject({ relativeDelayMs: 150 });
  });
});
