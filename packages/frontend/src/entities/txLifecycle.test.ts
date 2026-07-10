import type { TxStatus } from "./transaction.js";
import { describe, expect, it } from "vitest";
import { deriveTxLifecycle, deriveTxLifecycleFromTx } from "./txLifecycle.js";

const ALL_STATUSES: TxStatus[] = ["pending", "included", "failed"];

describe("deriveTxLifecycle (Issue #212 単位D: tx ライフサイクル導出)", () => {
  it("marks signed/sent as done, mempool as active, and inclusion as not yet reached for pending", () => {
    expect(deriveTxLifecycle("pending")).toEqual([
      { key: "signed", state: "done" },
      { key: "sent", state: "done" },
      { key: "mempool", state: "active" },
      { key: "included", state: "pending" },
    ]);
  });

  it("marks every stage as done for included", () => {
    expect(deriveTxLifecycle("included")).toEqual([
      { key: "signed", state: "done" },
      { key: "sent", state: "done" },
      { key: "mempool", state: "done" },
      { key: "included", state: "done" },
    ]);
  });

  it("marks signed/sent/mempool as done and only the inclusion stage as failed for failed", () => {
    expect(deriveTxLifecycle("failed")).toEqual([
      { key: "signed", state: "done" },
      { key: "sent", state: "done" },
      { key: "mempool", state: "done" },
      { key: "included", state: "failed" },
    ]);
  });
});

describe("deriveTxLifecycle invariants (Issue #212: 観測不能な状態を誇張しない)", () => {
  it("always returns exactly the four stages in a fixed order for every status", () => {
    for (const status of ALL_STATUSES) {
      const stages = deriveTxLifecycle(status);
      expect(stages.map((stage) => stage.key)).toEqual([
        "signed",
        "sent",
        "mempool",
        "included",
      ]);
    }
  });

  it("never marks signed or sent as 'active' — collector cannot observe those real-time states, so they are only ever shown as already-completed facts", () => {
    for (const status of ALL_STATUSES) {
      const stages = deriveTxLifecycle(status);
      const signed = stages.find((stage) => stage.key === "signed");
      const sent = stages.find((stage) => stage.key === "sent");
      expect(signed?.state).not.toBe("active");
      expect(sent?.state).not.toBe("active");
      // signed/sent は tx が見えている時点で常に done。
      expect(signed?.state).toBe("done");
      expect(sent?.state).toBe("done");
    }
  });

  it("only ever puts the 'active' marker on the mempool stage (the sole state chainviz can legitimately observe as ongoing)", () => {
    for (const status of ALL_STATUSES) {
      for (const stage of deriveTxLifecycle(status)) {
        if (stage.state === "active") {
          expect(stage.key).toBe("mempool");
        }
      }
    }
  });

  it("only ever puts the 'failed' marker on the inclusion stage", () => {
    for (const status of ALL_STATUSES) {
      for (const stage of deriveTxLifecycle(status)) {
        if (stage.state === "failed") {
          expect(stage.key).toBe("included");
        }
      }
    }
  });

  it("returns a fresh array/objects on each call so callers cannot mutate shared state", () => {
    const first = deriveTxLifecycle("pending");
    const second = deriveTxLifecycle("pending");
    expect(first).not.toBe(second);
    first[0].state = "failed";
    // 別呼び出しの結果に汚染が漏れない。
    expect(deriveTxLifecycle("pending")[0].state).toBe("done");
  });

  it("marks exactly one stage as active for a pending tx and none for included/failed", () => {
    const activeCount = (status: TxStatus) =>
      deriveTxLifecycle(status).filter((stage) => stage.state === "active").length;
    expect(activeCount("pending")).toBe(1);
    expect(activeCount("included")).toBe(0);
    expect(activeCount("failed")).toBe(0);
  });
});

describe("deriveTxLifecycleFromTx", () => {
  function tx(status: TxStatus) {
    return {
      kind: "transaction" as const,
      hash: "0x1",
      from: "0xa",
      to: "0xb",
      status,
    };
  }

  it("derives from the tx entity's status field", () => {
    const stages = deriveTxLifecycleFromTx(tx("included"));
    expect(stages.every((stage) => stage.state === "done")).toBe(true);
  });

  it("delegates to deriveTxLifecycle for every status (identical output)", () => {
    for (const status of ALL_STATUSES) {
      expect(deriveTxLifecycleFromTx(tx(status))).toEqual(deriveTxLifecycle(status));
    }
  });
});
