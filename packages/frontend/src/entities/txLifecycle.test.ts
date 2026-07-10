import { describe, expect, it } from "vitest";
import { deriveTxLifecycle, deriveTxLifecycleFromTx } from "./txLifecycle.js";

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

describe("deriveTxLifecycleFromTx", () => {
  it("derives from the tx entity's status field", () => {
    const stages = deriveTxLifecycleFromTx({
      kind: "transaction",
      hash: "0x1",
      from: "0xa",
      to: "0xb",
      status: "included",
    });
    expect(stages.every((stage) => stage.state === "done")).toBe(true);
  });
});
