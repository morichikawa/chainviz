import { describe, expect, it } from "vitest";
import { translate } from "../i18n/i18n.js";
import type { MessageKey } from "../i18n/messages.js";
import type { CommsLogEntry } from "./commsLogEntry.js";
import { describeCommsLogEntry } from "./commsLogText.js";

const t = (key: MessageKey) => translate(key, "en");

function base(overrides: Partial<CommsLogEntry> & Pick<CommsLogEntry, "category">) {
  return { id: "id-1", timestamp: 1_000, actorIds: [], ...overrides } as CommsLogEntry;
}

describe("describeCommsLogEntry: operation", () => {
  it("shows 'workbench -> node' as subject and the raw method as body", () => {
    const text = describeCommsLogEntry(
      base({
        category: "operation",
        workbenchId: "wb-1",
        workbenchLabel: "Alice",
        nodeId: "reth-1",
        nodeLabel: "chainviz-reth-1",
        method: "eth_sendRawTransaction",
      }),
      t,
    );
    expect(text).toEqual({ subject: "Alice → chainviz-reth-1", body: "eth_sendRawTransaction" });
  });
});

describe("describeCommsLogEntry: internal", () => {
  it("joins multiple calls, appending latency only where observed", () => {
    const text = describeCommsLogEntry(
      base({
        category: "internal",
        fromNodeId: "beacon-1",
        fromLabel: "chainviz-lighthouse-1",
        toNodeId: "reth-1",
        toLabel: "chainviz-reth-1",
        calls: [
          { method: "engine_newPayloadV4", count: 1, latencyMs: 12 },
          { method: "engine_forkchoiceUpdatedV3", count: 2 },
        ],
      }),
      t,
    );
    expect(text.subject).toBe("chainviz-lighthouse-1 → chainviz-reth-1");
    expect(text.body).toBe("engine_newPayloadV4 ×1 · 12ms, engine_forkchoiceUpdatedV3 ×2");
  });
});

describe("describeCommsLogEntry: block", () => {
  it("uses the 'first to receive' phrasing for the origin, with no offset", () => {
    const text = describeCommsLogEntry(
      base({
        category: "block",
        nodeId: "reth-1",
        nodeLabel: "chainviz-reth-1",
        blockNumber: 129,
        relativeDelayMs: 0,
        isOrigin: true,
      }),
      t,
    );
    expect(text).toEqual({
      subject: "chainviz-reth-1",
      body: "First to receive block #129",
    });
  });

  it("shows the relative delay (2 decimal places) for a non-origin receiver", () => {
    const text = describeCommsLogEntry(
      base({
        category: "block",
        nodeId: "reth-2",
        nodeLabel: "chainviz-reth-2",
        blockNumber: 129,
        relativeDelayMs: 420,
        isOrigin: false,
      }),
      t,
    );
    expect(text.body).toBe("Received block #129 (+0.42s)");
  });
});

describe("describeCommsLogEntry: tx", () => {
  it("shows the short hash as subject and 'submitted to mempool' for pending", () => {
    const text = describeCommsLogEntry(
      base({ category: "tx", hash: "0xa11c000000000000000000000000000000000000000000000000000000000000", status: "pending" }),
      t,
    );
    expect(text.body).toBe("Submitted to mempool");
    expect(text.subject.startsWith("0xa11c")).toBe(true);
  });

  it("includes the block number for included tx when known", () => {
    const text = describeCommsLogEntry(
      base({ category: "tx", hash: "0xabc", status: "included", blockNumber: 130 }),
      t,
    );
    expect(text.body).toBe("Included in block #130");
  });

  it("falls back to a block-number-less phrasing for included tx when unknown", () => {
    const text = describeCommsLogEntry(base({ category: "tx", hash: "0xabc", status: "included" }), t);
    expect(text.body).toBe("Included");
  });

  it("describes a failed tx with its block number", () => {
    const text = describeCommsLogEntry(
      base({ category: "tx", hash: "0xabc", status: "failed", blockNumber: 131 }),
      t,
    );
    expect(text.body).toBe("Failed in block #131");
  });

  it("falls back to a block-number-less phrasing for failed tx when unknown", () => {
    const text = describeCommsLogEntry(base({ category: "tx", hash: "0xabc", status: "failed" }), t);
    expect(text.body).toBe("Failed");
  });
});

describe("describeCommsLogEntry: peer", () => {
  it("uses a bidirectional arrow between the two endpoints", () => {
    const text = describeCommsLogEntry(
      base({
        category: "peer",
        fromNodeId: "reth-1",
        fromLabel: "chainviz-reth-1",
        toNodeId: "reth-2",
        toLabel: "chainviz-reth-2",
        networkId: "1337",
        change: "connected",
      }),
      t,
    );
    expect(text).toEqual({
      subject: "chainviz-reth-1 ⇄ chainviz-reth-2",
      body: "Peer link established",
    });
  });

  it("describes disconnection", () => {
    const text = describeCommsLogEntry(
      base({
        category: "peer",
        fromNodeId: "a",
        fromLabel: "a",
        toNodeId: "b",
        toLabel: "b",
        networkId: "1337",
        change: "disconnected",
      }),
      t,
    );
    expect(text.body).toBe("Peer link disconnected");
  });
});

describe("describeCommsLogEntry: environment", () => {
  it("describes a node addition using its label", () => {
    const text = describeCommsLogEntry(
      base({ category: "environment", subjectId: "reth-3", subjectLabel: "chainviz-reth-3", change: "nodeAdded" }),
      t,
    );
    expect(text).toEqual({ subject: "chainviz-reth-3", body: "Node added" });
  });

  it("falls back to the 'unknown contract' text when a deployed contract has no catalog name", () => {
    const text = describeCommsLogEntry(
      base({ category: "environment", subjectId: "0xc1", subjectLabel: undefined, change: "contractDeployed" }),
      t,
    );
    expect(text.subject).toBe("Unknown contract");
  });

  it("describes a collector disconnection without repeating 'collector' in the body", () => {
    const text = describeCommsLogEntry(
      base({ category: "environment", change: "collectorDisconnected" }),
      t,
    );
    expect(text).toEqual({ subject: "Collector", body: "Lost connection" });
  });

  it("describes a collector reconnection", () => {
    const text = describeCommsLogEntry(
      base({ category: "environment", change: "collectorReconnected" }),
      t,
    );
    expect(text).toEqual({ subject: "Collector", body: "Reconnected" });
  });
});
