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

describe("TransactionLifecycleTracker.recordInclusion createdContractAddress (Issue #160)", () => {
  it("maps a non-null receipt contractAddress to createdContractAddress", () => {
    const tracker = new TransactionLifecycleTracker();
    const changed = tracker.recordInclusion("0xblock", [
      {
        hash: "0xdeploy",
        from: "0xdeployer",
        to: null,
        status: "included",
        contractAddress: "0xnewcontract",
      },
    ]);
    expect(changed[0].createdContractAddress).toBe("0xnewcontract");
  });

  it("omits createdContractAddress for an ordinary tx (contractAddress null)", () => {
    const tracker = new TransactionLifecycleTracker();
    const changed = tracker.recordInclusion("0xblock", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "included", contractAddress: null },
    ]);
    expect(changed[0].createdContractAddress).toBeUndefined();
  });

  it("omits createdContractAddress when the field is not provided at all (back-compat)", () => {
    const tracker = new TransactionLifecycleTracker();
    const changed = tracker.recordInclusion("0xblock", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "included" },
    ]);
    expect(changed[0].createdContractAddress).toBeUndefined();
    expect(changed[0]).not.toHaveProperty("createdContractAddress");
  });

  it("preserves an already-recorded createdContractAddress across a duplicate notification without it", () => {
    // 別ノードからの重複通知で contractAddress が省略されても、
    // 一度確定した作成先アドレスを失わない。
    const tracker = new TransactionLifecycleTracker();
    tracker.recordInclusion("0xblockA", [
      {
        hash: "0xdeploy",
        from: "0xdeployer",
        to: null,
        status: "included",
        contractAddress: "0xnewcontract",
      },
    ]);
    // 同一 tx が別ブロックへ付け替わる通知（reorg 相当）で contractAddress が
    // 省略されても、既存の値を保持する。
    const changed = tracker.recordInclusion("0xblockB", [
      { hash: "0xdeploy", from: "0xdeployer", to: null, status: "included" },
    ]);
    expect(changed[0].createdContractAddress).toBe("0xnewcontract");
  });

  it("maps a zero-address contractAddress to createdContractAddress (truthy string, not treated as absent)", () => {
    // ゼロアドレスは falsy な空文字とは異なり truthy な文字列なので、
    // createdContractAddress として載る（作成先が実際にゼロアドレスに
    // なることは通常ないが、値の意味判定はこの層で行わない）。
    const tracker = new TransactionLifecycleTracker();
    const changed = tracker.recordInclusion("0xblock", [
      {
        hash: "0xdeploy",
        from: "0xdeployer",
        to: null,
        status: "included",
        contractAddress: "0x0000000000000000000000000000000000000000",
      },
    ]);
    expect(changed[0].createdContractAddress).toBe(
      "0x0000000000000000000000000000000000000000",
    );
  });

  it("omits createdContractAddress when contractAddress is an empty string (falsy)", () => {
    // 空文字は falsy なので createdContractAddress を載せない（省略と同じ扱い。
    // 空文字を「作成先アドレス」として可視化に流さない防御）。
    const tracker = new TransactionLifecycleTracker();
    const changed = tracker.recordInclusion("0xblock", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "included", contractAddress: "" },
    ]);
    expect(changed[0]).not.toHaveProperty("createdContractAddress");
  });

  it("lets a later non-null contractAddress overwrite a previously recorded one (documents current non-strict-immutability behavior)", () => {
    // 特性化テスト: createdContractAddress の不変性は「省略時に既存値を保つ」
    // ところまでで、後続通知が別の非 null 値を持つ場合は新しい値で上書きされる
    // （contractAddress は sender+nonce から決まり同一 tx では変わらないため、
    // 異なる値が来ること自体が本来あり得ないが、来た場合の実挙動を固定する）。
    const tracker = new TransactionLifecycleTracker();
    tracker.recordInclusion("0xblockA", [
      {
        hash: "0xdeploy",
        from: "0xdeployer",
        to: null,
        status: "included",
        contractAddress: "0xoriginal",
      },
    ]);
    const changed = tracker.recordInclusion("0xblockB", [
      {
        hash: "0xdeploy",
        from: "0xdeployer",
        to: null,
        status: "included",
        contractAddress: "0xdifferent",
      },
    ]);
    expect(changed[0].createdContractAddress).toBe("0xdifferent");
  });
});

describe("TransactionLifecycleTracker.recordPending contractCall (Issue #162)", () => {
  it("attaches a decoded contractCall when provided", () => {
    const tracker = new TransactionLifecycleTracker();
    const entity = tracker.recordPending({
      hash: "0xt1",
      from: "0xa",
      to: "0xcontract",
      contractCall: {
        contractAddress: "0xcontract",
        functionName: "transfer",
        args: [{ name: "to", value: "0xb" }],
      },
    });
    expect(entity?.contractCall).toEqual({
      contractAddress: "0xcontract",
      functionName: "transfer",
      args: [{ name: "to", value: "0xb" }],
    });
  });

  it("omits contractCall when not provided (ordinary tx / uncataloged destination)", () => {
    const tracker = new TransactionLifecycleTracker();
    const entity = tracker.recordPending({ hash: "0xt1", from: "0xa", to: "0xb" });
    expect(entity).not.toHaveProperty("contractCall");
  });
});

describe("TransactionLifecycleTracker.recordInclusion contractCall/contractEvents (Issue #162)", () => {
  it("carries forward the contractCall recorded at pending time when a tx is included", () => {
    const tracker = new TransactionLifecycleTracker();
    tracker.recordPending({
      hash: "0xt1",
      from: "0xa",
      to: "0xcontract",
      contractCall: { contractAddress: "0xcontract", functionName: "mint" },
    });
    const changed = tracker.recordInclusion("0xblock", [
      { hash: "0xt1", from: "0xa", to: "0xcontract", status: "included" },
    ]);
    expect(changed[0].contractCall).toEqual({
      contractAddress: "0xcontract",
      functionName: "mint",
    });
  });

  it("does not invent a contractCall for a tx that was never observed pending (pending-skip constraint)", () => {
    // pending を経ずに取り込みだけを観測した tx は contractCall が付かない
    // (docs/ARCHITECTURE.md §4 の制約)。
    const tracker = new TransactionLifecycleTracker();
    const changed = tracker.recordInclusion("0xblock", [
      { hash: "0xnew", from: "0xa", to: "0xcontract", status: "included" },
    ]);
    expect(changed[0]).not.toHaveProperty("contractCall");
  });

  it("attaches decoded contractEvents from the receipt logs", () => {
    const tracker = new TransactionLifecycleTracker();
    const changed = tracker.recordInclusion("0xblock", [
      {
        hash: "0xt1",
        from: "0xa",
        to: "0xcontract",
        status: "included",
        contractEvents: [
          { contractAddress: "0xcontract", eventName: "Transfer", args: [] },
        ],
      },
    ]);
    expect(changed[0].contractEvents).toEqual([
      { contractAddress: "0xcontract", eventName: "Transfer", args: [] },
    ]);
  });

  it("omits contractEvents entirely when the tx emitted no events (empty array)", () => {
    const tracker = new TransactionLifecycleTracker();
    const changed = tracker.recordInclusion("0xblock", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "included", contractEvents: [] },
    ]);
    expect(changed[0]).not.toHaveProperty("contractEvents");
  });

  it("omits contractEvents when the field is not provided at all (back-compat)", () => {
    const tracker = new TransactionLifecycleTracker();
    const changed = tracker.recordInclusion("0xblock", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "included" },
    ]);
    expect(changed[0]).not.toHaveProperty("contractEvents");
  });

  it("replaces contractEvents with the newest block's decode result on a reorg (does not merge across blocks)", () => {
    const tracker = new TransactionLifecycleTracker();
    tracker.recordInclusion("0xblockA", [
      {
        hash: "0xt1",
        from: "0xa",
        to: "0xb",
        status: "included",
        contractEvents: [{ contractAddress: "0xb", eventName: "Old" }],
      },
    ]);
    const changed = tracker.recordInclusion("0xblockB", [
      {
        hash: "0xt1",
        from: "0xa",
        to: "0xb",
        status: "included",
        contractEvents: [{ contractAddress: "0xb", eventName: "New" }],
      },
    ]);
    expect(changed[0].contractEvents).toEqual([
      { contractAddress: "0xb", eventName: "New" },
    ]);
  });
});

describe("TransactionLifecycleTracker.recordPending nonce (Issue #319)", () => {
  it("attaches the observed nonce", () => {
    const tracker = new TransactionLifecycleTracker();
    const entity = tracker.recordPending({
      hash: "0xt1",
      from: "0xa",
      to: "0xb",
      nonce: 5,
    });
    expect(entity?.nonce).toBe(5);
  });

  it("attaches nonce 0 as a meaningful value, not an omission", () => {
    const tracker = new TransactionLifecycleTracker();
    const entity = tracker.recordPending({
      hash: "0xt1",
      from: "0xa",
      to: "0xb",
      nonce: 0,
    });
    expect(entity).toHaveProperty("nonce", 0);
  });

  it("omits nonce when not provided (tx detail unavailable)", () => {
    const tracker = new TransactionLifecycleTracker();
    const entity = tracker.recordPending({ hash: "0xt1", from: "0xa", to: "0xb" });
    expect(entity).not.toHaveProperty("nonce");
  });
});

describe("TransactionLifecycleTracker.recordInclusion nonce (Issue #319)", () => {
  it("carries forward the nonce recorded at pending time when a tx is included", () => {
    const tracker = new TransactionLifecycleTracker();
    tracker.recordPending({ hash: "0xt1", from: "0xa", to: "0xb", nonce: 7 });
    const changed = tracker.recordInclusion("0xblock", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "included" },
    ]);
    expect(changed[0].nonce).toBe(7);
  });

  it("carries forward a pending nonce of 0 (falsy-but-meaningful value)", () => {
    const tracker = new TransactionLifecycleTracker();
    tracker.recordPending({ hash: "0xt1", from: "0xa", to: "0xb", nonce: 0 });
    const changed = tracker.recordInclusion("0xblock", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "included" },
    ]);
    expect(changed[0]).toHaveProperty("nonce", 0);
  });

  it("does not invent a nonce for a tx that was never observed pending (pending-skip constraint)", () => {
    // pending を経ずに取り込みだけを観測した tx は receipt に nonce が含まれ
    // ないため付与できない（Issue #86 の方針。追加 RPC で埋めない）。
    const tracker = new TransactionLifecycleTracker();
    const changed = tracker.recordInclusion("0xblock", [
      { hash: "0xnew", from: "0xa", to: "0xb", status: "included" },
    ]);
    expect(changed[0]).not.toHaveProperty("nonce");
  });

  it("keeps nonce omitted when pending had no nonce and inclusion also has none (existing without nonce)", () => {
    // pending を観測したが nonce が取れなかった（例: 正規化で省略された）tx を
    // 取り込む場合、existing?.nonce も tx.nonce も undefined。フィールドを
    // でっち上げず省略のままにする（existing はあるが nonce だけ無いケース）。
    const tracker = new TransactionLifecycleTracker();
    tracker.recordPending({ hash: "0xt1", from: "0xa", to: "0xb" });
    const changed = tracker.recordInclusion("0xblock", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "included" },
    ]);
    expect(changed[0]).not.toHaveProperty("nonce");
  });

  it("retains the pending nonce when a tx is re-included in a different block (reorg-like)", () => {
    // 別ブロックへの付け替え（reorg 相当）でも nonce は tx 固有で不変のため、
    // 最初の pending 観測値を保持し続ける（existing 優先が複数回の inclusion を
    // またいでも効くこと）。
    const tracker = new TransactionLifecycleTracker();
    tracker.recordPending({ hash: "0xt1", from: "0xa", to: "0xb", nonce: 9 });
    tracker.recordInclusion("0xblockA", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "included" },
    ]);
    const changed = tracker.recordInclusion("0xblockB", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "included" },
    ]);
    expect(changed[0].nonce).toBe(9);
  });

  it("tracks each tx's nonce independently when two txs share the same nonce value (defensive)", () => {
    // 同一 nonce を持つ複数 tx は正常なチェーンでは起きない（同一アカウントの
    // nonce は一意）が、防御的に hash ごとに独立して保持されることを確認する。
    const tracker = new TransactionLifecycleTracker();
    tracker.recordPending({ hash: "0xt1", from: "0xa", to: "0xb", nonce: 4 });
    tracker.recordPending({ hash: "0xt2", from: "0xc", to: "0xd", nonce: 4 });
    const changed = tracker.recordInclusion("0xblock", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "included" },
      { hash: "0xt2", from: "0xc", to: "0xd", status: "included" },
    ]);
    expect(changed.find((e) => e.hash === "0xt1")?.nonce).toBe(4);
    expect(changed.find((e) => e.hash === "0xt2")?.nonce).toBe(4);
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

describe("TransactionLifecycleTracker.updateContractEvents (Issue #244)", () => {
  it("returns null and does nothing for an untracked hash", () => {
    const tracker = new TransactionLifecycleTracker();
    const result = tracker.updateContractEvents("0xghost", [
      { contractAddress: "0xc", eventName: "Transfer", args: [] },
    ]);
    expect(result).toBeNull();
    expect(tracker.get("0xghost")).toBeUndefined();
  });

  it("returns null and leaves the tracked tx untouched when given an empty array", () => {
    const tracker = new TransactionLifecycleTracker();
    tracker.recordInclusion("0xblock", [
      {
        hash: "0xt1",
        from: "0xa",
        to: null,
        status: "included",
        contractAddress: "0xc",
        contractEvents: [{ contractAddress: "0xc", rawEventId: "0xtopic0" }],
      },
    ]);
    const result = tracker.updateContractEvents("0xt1", []);
    expect(result).toBeNull();
    // 既存の contractEvents（raw フォールバック）を空へ後退させない。
    expect(tracker.get("0xt1")?.contractEvents).toEqual([
      { contractAddress: "0xc", rawEventId: "0xtopic0" },
    ]);
  });

  it("replaces contractEvents on a tracked tx and returns the updated entity", () => {
    const tracker = new TransactionLifecycleTracker();
    tracker.recordInclusion("0xblock", [
      {
        hash: "0xt1",
        from: "0xa",
        to: null,
        status: "included",
        contractAddress: "0xc",
        contractEvents: [{ contractAddress: "0xc", rawEventId: "0xtopic0" }],
      },
    ]);
    const updated = tracker.updateContractEvents("0xt1", [
      {
        contractAddress: "0xc",
        eventName: "Transfer",
        args: [{ name: "value", value: "1000" }],
      },
    ]);
    expect(updated).toEqual<TransactionEntity>({
      kind: "transaction",
      hash: "0xt1",
      from: "0xa",
      to: null,
      status: "included",
      blockHash: "0xblock",
      createdContractAddress: "0xc",
      contractEvents: [
        {
          contractAddress: "0xc",
          eventName: "Transfer",
          args: [{ name: "value", value: "1000" }],
        },
      ],
    });
    expect(tracker.get("0xt1")).toEqual(updated);
  });

  it("does not change other fields (status/blockHash/createdContractAddress) when replacing contractEvents", () => {
    const tracker = new TransactionLifecycleTracker();
    tracker.recordInclusion("0xblockA", [
      {
        hash: "0xt1",
        from: "0xa",
        to: null,
        status: "failed",
        contractAddress: "0xc",
        contractEvents: [{ contractAddress: "0xc", rawEventId: "0xtopic0" }],
      },
    ]);
    const updated = tracker.updateContractEvents("0xt1", [
      { contractAddress: "0xc", eventName: "Transfer", args: [] },
    ]);
    expect(updated?.status).toBe("failed");
    expect(updated?.blockHash).toBe("0xblockA");
    expect(updated?.createdContractAddress).toBe("0xc");
  });

  it("re-inserts the updated tx as the newest entry (survives eviction ahead of older entries)", () => {
    const tracker = new TransactionLifecycleTracker(2);
    tracker.recordInclusion("0xblock", [
      { hash: "0xt1", from: "0xa", to: null, status: "included", contractAddress: "0xc" },
    ]);
    tracker.recordPending({ hash: "0xt2", from: "0xa", to: "0xb" });
    // t1 を最新扱いへ入れ直す。
    tracker.updateContractEvents("0xt1", [
      { contractAddress: "0xc", eventName: "Transfer", args: [] },
    ]);
    // maxTxs(2) を超える3件目が入ると、最古(t2)ではなく本来 t1 より後に
    // 追加された t2 が最古扱いのままなら t2 が押し出されるはず、という
    // 直感に反し、直近 updateContractEvents で入れ直された t1 は生き残る。
    tracker.recordPending({ hash: "0xt3", from: "0xa", to: "0xb" });
    expect(tracker.get("0xt1")).toBeDefined();
    expect(tracker.get("0xt2")).toBeUndefined();
    expect(tracker.get("0xt3")).toBeDefined();
  });

  it("returns null (does not resurrect) for a tx that was tracked but has since been evicted", () => {
    // Issue #244 の自己修復では、生ログを保持するバッファ
    // （undecodedDeployLogs、上限200）が tx ライフサイクル（maxTxs）より
    // 長生きし得る。カタログ登録が届いた時点で対象の tx が既に evict 済み
    // だった場合でも、updateContractEvents は null を返すだけで新たな
    // エンティティを作り直さない（redecodeBufferedDeployLogs が onTx を
    // 呼ばずに済むための前提）。
    const tracker = new TransactionLifecycleTracker(1);
    tracker.recordInclusion("0xblock", [
      {
        hash: "0xdeploytx",
        from: "0xa",
        to: null,
        status: "included",
        contractAddress: "0xc",
        contractEvents: [{ contractAddress: "0xc", rawEventId: "0xtopic0" }],
      },
    ]);
    // maxTxs(1) を超える別 tx が入り、デプロイ tx は evict される。
    tracker.recordPending({ hash: "0xother", from: "0xa", to: "0xb" });
    expect(tracker.get("0xdeploytx")).toBeUndefined();

    const result = tracker.updateContractEvents("0xdeploytx", [
      { contractAddress: "0xc", eventName: "Transfer", args: [] },
    ]);
    expect(result).toBeNull();
    // 生き残っている別 tx を巻き込んで作り直したりしない。
    expect(tracker.get("0xdeploytx")).toBeUndefined();
    expect(tracker.get("0xother")).toBeDefined();
  });

  it("returns a fresh object without mutating the previously stored entity", () => {
    // put は差し替え用の新オブジェクトを保持するが、呼び出し側が更新前に
    // 取得済みだった参照（entityUpdated 前のスナップショット等）を後から
    // 書き換えないことを特性化する。
    const tracker = new TransactionLifecycleTracker();
    tracker.recordInclusion("0xblock", [
      {
        hash: "0xt1",
        from: "0xa",
        to: null,
        status: "included",
        contractAddress: "0xc",
        contractEvents: [{ contractAddress: "0xc", rawEventId: "0xtopic0" }],
      },
    ]);
    const before = tracker.get("0xt1");
    const updated = tracker.updateContractEvents("0xt1", [
      { contractAddress: "0xc", eventName: "Transfer", args: [] },
    ]);
    expect(updated).not.toBe(before);
    // 以前の参照は raw フォールバックのまま。
    expect(before?.contractEvents).toEqual([
      { contractAddress: "0xc", rawEventId: "0xtopic0" },
    ]);
  });
});

describe("TransactionLifecycleTracker.reset (Issue #357)", () => {
  it("forgets previously tracked tx (pending and included)", () => {
    const tracker = new TransactionLifecycleTracker();
    tracker.recordPending({ hash: "0xpending", from: "0xa", to: "0xb" });
    tracker.recordInclusion("0xblock", [
      { hash: "0xincluded", from: "0xa", to: "0xb", status: "included" },
    ]);
    expect(tracker.get("0xpending")).toBeDefined();
    expect(tracker.get("0xincluded")).toBeDefined();

    tracker.reset();

    expect(tracker.get("0xpending")).toBeUndefined();
    expect(tracker.get("0xincluded")).toBeUndefined();
  });

  it("allows the same hash to be recorded as pending again after reset", () => {
    const tracker = new TransactionLifecycleTracker();
    tracker.recordInclusion("0xblock", [
      { hash: "0xt1", from: "0xa", to: "0xb", status: "included" },
    ]);
    tracker.reset();

    // reset 前は included 済みの hash を recordPending しても null（巻き戻り
    // 防止のガード）。reset 後は新規 pending として受理されることを確認する。
    const entity = tracker.recordPending({ hash: "0xt1", from: "0xa", to: "0xb" });
    expect(entity?.status).toBe("pending");
  });
});
