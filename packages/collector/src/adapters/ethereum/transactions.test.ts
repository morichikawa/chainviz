import type { TransactionEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { TransactionLifecycleTracker } from "./transactions.js";

describe("TransactionLifecycleTracker.recordPending", () => {
  it("adds an unseen tx as pending", () => {
    const tracker = new TransactionLifecycleTracker();
    const entity = tracker.recordPending({
      hash: "0xt1",
      from: "0xa",
      to: "0xb",
    });
    expect(entity).toEqual<TransactionEntity>({
      kind: "transaction",
      hash: "0xt1",
      from: "0xa",
      to: "0xb",
      status: "pending",
    });
  });

  it("preserves a null 'to' (contract creation)", () => {
    const tracker = new TransactionLifecycleTracker();
    const entity = tracker.recordPending({ hash: "0xt1", from: "0xa", to: null });
    expect(entity?.to).toBeNull();
  });

  it("returns null on a duplicate pending notification", () => {
    const tracker = new TransactionLifecycleTracker();
    tracker.recordPending({ hash: "0xt1", from: "0xa", to: "0xb" });
    expect(
      tracker.recordPending({ hash: "0xt1", from: "0xa", to: "0xb" }),
    ).toBeNull();
  });

  it("does not roll an already-included tx back to pending", () => {
    const tracker = new TransactionLifecycleTracker();
    tracker.recordPending({ hash: "0xt1", from: "0xa", to: "0xb" });
    tracker.recordInclusion("0xblock", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "included" },
    ]);
    expect(
      tracker.recordPending({ hash: "0xt1", from: "0xa", to: "0xb" }),
    ).toBeNull();
    expect(tracker.get("0xt1")?.status).toBe("included");
  });

  it("does not roll an already-failed tx back to pending", () => {
    const tracker = new TransactionLifecycleTracker();
    tracker.recordPending({ hash: "0xt1", from: "0xa", to: "0xb" });
    tracker.recordInclusion("0xblock", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "failed" },
    ]);
    expect(
      tracker.recordPending({ hash: "0xt1", from: "0xa", to: "0xb" }),
    ).toBeNull();
    expect(tracker.get("0xt1")?.status).toBe("failed");
  });
});

describe("TransactionLifecycleTracker.recordInclusion", () => {
  it("promotes a tracked pending tx to included with the block hash", () => {
    const tracker = new TransactionLifecycleTracker();
    tracker.recordPending({ hash: "0xt1", from: "0xa", to: "0xb" });
    const changed = tracker.recordInclusion("0xblock", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "included" },
    ]);
    expect(changed).toEqual<TransactionEntity[]>([
      {
        kind: "transaction",
        hash: "0xt1",
        from: "0xa",
        to: "0xb",
        status: "included",
        blockHash: "0xblock",
      },
    ]);
  });

  it("promotes a tracked pending tx to failed with the block hash", () => {
    // ブロックに取り込まれたが実行に失敗した(receipt.status === 0x0)ケース。
    const tracker = new TransactionLifecycleTracker();
    tracker.recordPending({ hash: "0xt1", from: "0xa", to: "0xb" });
    const changed = tracker.recordInclusion("0xblock", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "failed" },
    ]);
    expect(changed).toEqual<TransactionEntity[]>([
      {
        kind: "transaction",
        hash: "0xt1",
        from: "0xa",
        to: "0xb",
        status: "failed",
        blockHash: "0xblock",
      },
    ]);
  });

  it("keeps the original from/to when the block reports different values", () => {
    // ブロック側の tx 表現が万一欠けても、pending 時に得た詳細を優先する。
    const tracker = new TransactionLifecycleTracker();
    tracker.recordPending({ hash: "0xt1", from: "0xa", to: "0xb" });
    const changed = tracker.recordInclusion("0xblock", [
      { hash: "0xt1", from: "0xZZ", to: "0xYY", status: "included" },
    ]);
    expect(changed[0].from).toBe("0xa");
    expect(changed[0].to).toBe("0xb");
  });

  it("adds a never-seen tx directly as included using the block's from/to", () => {
    const tracker = new TransactionLifecycleTracker();
    const changed = tracker.recordInclusion("0xblock", [
      { hash: "0xt9", from: "0xc", to: null, status: "included" },
    ]);
    expect(changed).toEqual<TransactionEntity[]>([
      {
        kind: "transaction",
        hash: "0xt9",
        from: "0xc",
        to: null,
        status: "included",
        blockHash: "0xblock",
      },
    ]);
  });

  it("adds a never-seen tx directly as failed using the block's from/to", () => {
    // pending 通知を取りこぼした、実行に失敗した tx を直接 failed として追加する。
    const tracker = new TransactionLifecycleTracker();
    const changed = tracker.recordInclusion("0xblock", [
      { hash: "0xt9", from: "0xc", to: null, status: "failed" },
    ]);
    expect(changed).toEqual<TransactionEntity[]>([
      {
        kind: "transaction",
        hash: "0xt9",
        from: "0xc",
        to: null,
        status: "failed",
        blockHash: "0xblock",
      },
    ]);
  });

  it("emits no change when the same block includes the same tx with the same status again", () => {
    const tracker = new TransactionLifecycleTracker();
    tracker.recordPending({ hash: "0xt1", from: "0xa", to: "0xb" });
    tracker.recordInclusion("0xblock", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "included" },
    ]);
    const second = tracker.recordInclusion("0xblock", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "included" },
    ]);
    expect(second).toEqual([]);
  });

  it("re-emits when a tx moves to a different block (reorg)", () => {
    const tracker = new TransactionLifecycleTracker();
    tracker.recordPending({ hash: "0xt1", from: "0xa", to: "0xb" });
    tracker.recordInclusion("0xblockA", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "included" },
    ]);
    const moved = tracker.recordInclusion("0xblockB", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "included" },
    ]);
    expect(moved).toHaveLength(1);
    expect(moved[0].blockHash).toBe("0xblockB");
  });

  it("re-emits when the same block re-reports a tx with a different status", () => {
    // 同一 blockHash でも status 自体が変わっていれば変化として扱う
    // (現実には reorg 以外で起きないはずだが、スキップ条件が blockHash と
    // status の両方を見ることの回帰確認)。
    const tracker = new TransactionLifecycleTracker();
    tracker.recordPending({ hash: "0xt1", from: "0xa", to: "0xb" });
    tracker.recordInclusion("0xblock", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "included" },
    ]);
    const changed = tracker.recordInclusion("0xblock", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "failed" },
    ]);
    expect(changed).toHaveLength(1);
    expect(changed[0].status).toBe("failed");
    expect(tracker.get("0xt1")?.status).toBe("failed");
  });

  it("only returns the txs that actually changed within a block", () => {
    const tracker = new TransactionLifecycleTracker();
    tracker.recordPending({ hash: "0xt1", from: "0xa", to: "0xb" });
    tracker.recordInclusion("0xblock", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "included" },
    ]);
    // t1 は既に included、t2 は新規。返るのは t2 だけ。
    const changed = tracker.recordInclusion("0xblock", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "included" },
      { hash: "0xt2", from: "0xc", to: "0xd", status: "failed" },
    ]);
    expect(changed.map((t) => t.hash)).toEqual(["0xt2"]);
  });

  it("routes a mixed block: some txs included, some failed, in one call", () => {
    // 同一ブロックに success と failed が混在するケースの振り分け。
    const tracker = new TransactionLifecycleTracker();
    tracker.recordPending({ hash: "0xok", from: "0xa", to: "0xb" });
    tracker.recordPending({ hash: "0xbad", from: "0xc", to: "0xd" });
    const changed = tracker.recordInclusion("0xblock", [
      { hash: "0xok", from: "0xa", to: "0xb", status: "included" },
      { hash: "0xbad", from: "0xc", to: "0xd", status: "failed" },
      // pending 未追跡の新規 tx（success/failed 双方）も同じブロックで確定させる。
      { hash: "0xnew1", from: "0xe", to: "0xf", status: "included" },
      { hash: "0xnew2", from: "0xg", to: null, status: "failed" },
    ]);
    expect(
      changed.map((t) => [t.hash, t.status]),
    ).toEqual([
      ["0xok", "included"],
      ["0xbad", "failed"],
      ["0xnew1", "included"],
      ["0xnew2", "failed"],
    ]);
    // 各 tx にブロックハッシュが付与される（failed も取り込まれてはいる）。
    expect(changed.every((t) => t.blockHash === "0xblock")).toBe(true);
  });

  it("re-emits when the same block re-reports a tx moving from failed to included", () => {
    // included → failed の逆（failed → included）でもステータス変化として扱う。
    const tracker = new TransactionLifecycleTracker();
    tracker.recordPending({ hash: "0xt1", from: "0xa", to: "0xb" });
    tracker.recordInclusion("0xblock", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "failed" },
    ]);
    const changed = tracker.recordInclusion("0xblock", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "included" },
    ]);
    expect(changed).toHaveLength(1);
    expect(changed[0].status).toBe("included");
    expect(tracker.get("0xt1")?.status).toBe("included");
  });

  it("returns an empty array for an empty block (no txs)", () => {
    const tracker = new TransactionLifecycleTracker();
    expect(tracker.recordInclusion("0xblock", [])).toEqual([]);
  });

  it("emits each tx once when the same block lists it twice with the same status", () => {
    // ブロック内に同一 tx ハッシュが重複して現れても、2 件目は
    // 既に同一 blockHash・同一 status なのでスキップされる。
    const tracker = new TransactionLifecycleTracker();
    const changed = tracker.recordInclusion("0xblock", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "included" },
      { hash: "0xt1", from: "0xa", to: "0xb", status: "included" },
    ]);
    expect(changed.map((t) => t.hash)).toEqual(["0xt1"]);
  });
});

describe("TransactionLifecycleTracker eviction", () => {
  it("drops the oldest tracked txs once maxTxs is exceeded", () => {
    const tracker = new TransactionLifecycleTracker(2);
    tracker.recordPending({ hash: "0xt1", from: "0xa", to: "0xb" });
    tracker.recordPending({ hash: "0xt2", from: "0xa", to: "0xb" });
    tracker.recordPending({ hash: "0xt3", from: "0xa", to: "0xb" });
    // 3 件目で最古の t1 が押し出される。
    expect(tracker.get("0xt1")).toBeUndefined();
    expect(tracker.get("0xt2")).toBeDefined();
    expect(tracker.get("0xt3")).toBeDefined();
  });
});
