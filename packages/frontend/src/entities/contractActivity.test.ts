import type { TransactionEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  type ContractActivityChip,
  deriveContractActivity,
  sameContractActivity,
} from "./contractActivity.js";
import { shortHex } from "./transaction.js";

const CONTRACT = "0xcontract0000000000000000000000000000000";
const OTHER_CONTRACT = "0xother0000000000000000000000000000000000";

function tx(overrides: Partial<TransactionEntity> = {}): TransactionEntity {
  return {
    kind: "transaction",
    hash: "0xhash0000000000000000000000000000000000000000000000000000000000",
    from: "0xfrom00000000000000000000000000000000000",
    to: CONTRACT,
    status: "included",
    blockHash: "0xblock1",
    ...overrides,
  };
}

describe("deriveContractActivity", () => {
  it("returns an empty array when there are no transactions", () => {
    expect(deriveContractActivity(CONTRACT, [], new Map())).toEqual([]);
  });

  it("excludes pending transactions (only settled tx counts)", () => {
    const t = tx({
      status: "pending",
      contractCall: { contractAddress: CONTRACT, functionName: "transfer" },
    });
    expect(deriveContractActivity(CONTRACT, [t], new Map())).toEqual([]);
  });

  it("produces a call chip with the decoded function name", () => {
    const t = tx({
      hash: "0xabc",
      contractCall: {
        contractAddress: CONTRACT,
        functionName: "transfer",
        args: [{ name: "to", value: "0xbob" }],
      },
    });
    const chips = deriveContractActivity(CONTRACT, [t], new Map());
    expect(chips).toEqual([
      {
        key: "0xabc-call",
        kind: "call",
        label: "transfer",
        decoded: true,
        args: [{ name: "to", value: "0xbob" }],
        txHash: "0xabc",
      },
    ]);
  });

  it("falls back to a shortened rawFunctionId when the function is undecoded", () => {
    const t = tx({
      hash: "0xabc",
      contractCall: {
        contractAddress: CONTRACT,
        rawFunctionId: "0xa9059cbb",
      },
    });
    const chips = deriveContractActivity(CONTRACT, [t], new Map());
    expect(chips[0]).toMatchObject({
      kind: "call",
      label: "0xa9059cbb",
      decoded: false,
    });
  });

  it("ignores a contractCall targeting a different contract", () => {
    const t = tx({
      contractCall: { contractAddress: OTHER_CONTRACT, functionName: "transfer" },
    });
    expect(deriveContractActivity(CONTRACT, [t], new Map())).toEqual([]);
  });

  it("produces one event chip per matching contractEvents entry", () => {
    const t = tx({
      hash: "0xabc",
      contractEvents: [
        {
          contractAddress: CONTRACT,
          eventName: "Transfer",
          args: [{ name: "value", value: "1" }],
        },
        { contractAddress: OTHER_CONTRACT, eventName: "Approval" },
        { contractAddress: CONTRACT, rawEventId: "0xdead" },
      ],
    });
    const chips = deriveContractActivity(CONTRACT, [t], new Map());
    expect(chips).toEqual([
      {
        key: "0xabc-event-0",
        kind: "event",
        label: "Transfer",
        decoded: true,
        args: [{ name: "value", value: "1" }],
        txHash: "0xabc",
      },
      {
        key: "0xabc-event-2",
        kind: "event",
        label: "0xdead",
        decoded: false,
        args: [],
        txHash: "0xabc",
      },
    ]);
  });

  it("combines a call chip and its event chips from the same tx", () => {
    const t = tx({
      hash: "0xabc",
      contractCall: { contractAddress: CONTRACT, functionName: "transfer" },
      contractEvents: [{ contractAddress: CONTRACT, eventName: "Transfer" }],
    });
    const chips = deriveContractActivity(CONTRACT, [t], new Map());
    expect(chips.map((c) => c.kind)).toEqual(["call", "event"]);
  });

  it("orders chips by descending block number (newer first)", () => {
    const older = tx({
      hash: "0xold",
      blockHash: "0xb1",
      contractCall: { contractAddress: CONTRACT, functionName: "old" },
    });
    const newer = tx({
      hash: "0xnew",
      blockHash: "0xb2",
      contractCall: { contractAddress: CONTRACT, functionName: "new" },
    });
    const blockNumberByHash = new Map([
      ["0xb1", 10],
      ["0xb2", 20],
    ]);
    const chips = deriveContractActivity(
      CONTRACT,
      [older, newer],
      blockNumberByHash,
    );
    expect(chips.map((c) => c.label)).toEqual(["new", "old"]);
  });

  it("falls back to -1 (oldest) when the blockHash cannot be resolved, tie-broken by hash", () => {
    const a = tx({
      hash: "0xaaa",
      blockHash: "0xunresolved-a",
      contractCall: { contractAddress: CONTRACT, functionName: "a" },
    });
    const b = tx({
      hash: "0xbbb",
      blockHash: "0xunresolved-b",
      contractCall: { contractAddress: CONTRACT, functionName: "b" },
    });
    const chips = deriveContractActivity(CONTRACT, [b, a], new Map());
    // 両方とも rank=-1 なので tx hash の辞書順（"0xaaa" < "0xbbb"）で安定する。
    expect(chips.map((c) => c.label)).toEqual(["a", "b"]);
  });

  it("treats a tx with no blockHash as unresolved (rank -1)", () => {
    const noBlock = tx({
      hash: "0xnoblock",
      blockHash: undefined,
      status: "failed",
      contractCall: { contractAddress: CONTRACT, functionName: "noBlock" },
    });
    const withBlock = tx({
      hash: "0xwithblock",
      blockHash: "0xb1",
      contractCall: { contractAddress: CONTRACT, functionName: "withBlock" },
    });
    const chips = deriveContractActivity(
      CONTRACT,
      [noBlock, withBlock],
      new Map([["0xb1", 5]]),
    );
    expect(chips.map((c) => c.label)).toEqual(["withBlock", "noBlock"]);
  });

  it("caps the result at the given limit", () => {
    const txs = Array.from({ length: 10 }, (_, i) =>
      tx({
        hash: `0xtx${i}`,
        contractCall: { contractAddress: CONTRACT, functionName: `fn${i}` },
      }),
    );
    expect(deriveContractActivity(CONTRACT, txs, new Map(), 3)).toHaveLength(3);
  });

  it("defaults the limit to DEFAULT_RECENT_TX_LIMIT (6)", () => {
    const txs = Array.from({ length: 10 }, (_, i) =>
      tx({
        hash: `0xtx${i}`,
        contractCall: { contractAddress: CONTRACT, functionName: `fn${i}` },
      }),
    );
    expect(deriveContractActivity(CONTRACT, txs, new Map())).toHaveLength(6);
  });

  it("ignores a failed tx's data only insofar as status filtering goes (failed still counts as settled)", () => {
    const t = tx({
      hash: "0xfailed",
      status: "failed",
      contractCall: { contractAddress: CONTRACT, functionName: "revert" },
    });
    expect(deriveContractActivity(CONTRACT, [t], new Map())).toHaveLength(1);
  });

  it("returns an empty array when neither contractCall nor contractEvents match", () => {
    const t = tx({ contractCall: undefined, contractEvents: undefined });
    expect(deriveContractActivity(CONTRACT, [t], new Map())).toEqual([]);
  });

  it("falls back to a shortened tx hash for a call chip with neither functionName nor rawFunctionId", () => {
    const t = tx({
      hash: "0xdeadbeef00000000000000000000000000000000000000000000000000000000",
      contractCall: { contractAddress: CONTRACT },
    });
    const chips = deriveContractActivity(CONTRACT, [t], new Map());
    expect(chips[0]).toMatchObject({
      kind: "call",
      label: shortHex(t.hash),
      decoded: false,
    });
  });

  it("falls back to a shortened tx hash for an event chip with neither eventName nor rawEventId", () => {
    const t = tx({
      hash: "0xfeedface00000000000000000000000000000000000000000000000000000000",
      contractEvents: [{ contractAddress: CONTRACT }],
    });
    const chips = deriveContractActivity(CONTRACT, [t], new Map());
    expect(chips[0]).toMatchObject({
      kind: "event",
      label: shortHex(t.hash),
      decoded: false,
    });
  });

  it("treats an empty contractEvents array as no events (no crash, no chips)", () => {
    const t = tx({ hash: "0xempty", contractEvents: [] });
    expect(deriveContractActivity(CONTRACT, [t], new Map())).toEqual([]);
  });

  it("orders the call chip before its event chips and keeps event order within a tx", () => {
    const t = tx({
      hash: "0xabc",
      contractCall: { contractAddress: CONTRACT, functionName: "transfer" },
      contractEvents: [
        { contractAddress: CONTRACT, eventName: "First" },
        { contractAddress: CONTRACT, eventName: "Second" },
      ],
    });
    const chips = deriveContractActivity(CONTRACT, [t], new Map());
    expect(chips.map((c) => c.label)).toEqual(["transfer", "First", "Second"]);
  });

  it("caps combined call+event chips at the limit, keeping the call chip first", () => {
    const t = tx({
      hash: "0xabc",
      contractCall: { contractAddress: CONTRACT, functionName: "call0" },
      contractEvents: Array.from({ length: 10 }, (_, i) => ({
        contractAddress: CONTRACT,
        eventName: `evt${i}`,
      })),
    });
    const chips = deriveContractActivity(CONTRACT, [t], new Map(), 3);
    expect(chips.map((c) => c.label)).toEqual(["call0", "evt0", "evt1"]);
  });

  it("keeps only the call chip when contractEvents come from a different contract (per-emitter filtering)", () => {
    const t = tx({
      hash: "0xabc",
      contractCall: { contractAddress: CONTRACT, functionName: "transfer" },
      contractEvents: [
        { contractAddress: OTHER_CONTRACT, eventName: "Elsewhere" },
      ],
    });
    const chips = deriveContractActivity(CONTRACT, [t], new Map());
    expect(chips.map((c) => c.kind)).toEqual(["call"]);
  });

  it("keeps only matching event chips when the call targets a different contract", () => {
    const t = tx({
      hash: "0xabc",
      contractCall: { contractAddress: OTHER_CONTRACT, functionName: "route" },
      contractEvents: [{ contractAddress: CONTRACT, eventName: "Transfer" }],
    });
    const chips = deriveContractActivity(CONTRACT, [t], new Map());
    expect(chips.map((c) => ({ kind: c.kind, label: c.label }))).toEqual([
      { kind: "event", label: "Transfer" },
    ]);
  });

  it("mixes decoded and undecoded chips across multiple txs for the same contract", () => {
    const decodedTx = tx({
      hash: "0xd1",
      blockHash: "0xb2",
      contractCall: { contractAddress: CONTRACT, functionName: "transfer" },
    });
    const undecodedTx = tx({
      hash: "0xd2",
      blockHash: "0xb1",
      contractCall: { contractAddress: CONTRACT, rawFunctionId: "0xa9059cbb" },
    });
    const chips = deriveContractActivity(
      CONTRACT,
      [undecodedTx, decodedTx],
      new Map([
        ["0xb1", 5],
        ["0xb2", 6],
      ]),
    );
    expect(chips.map((c) => c.decoded)).toEqual([true, false]);
  });

  it("does not mutate the input transactions array", () => {
    const txs = [
      tx({ hash: "0xa", contractCall: { contractAddress: CONTRACT, functionName: "a" } }),
      tx({ hash: "0xb", contractCall: { contractAddress: CONTRACT, functionName: "b" } }),
    ];
    const snapshot = [...txs];
    deriveContractActivity(CONTRACT, txs, new Map());
    expect(txs).toEqual(snapshot);
  });
});

describe("sameContractActivity", () => {
  function chip(overrides: Partial<ContractActivityChip> = {}): ContractActivityChip {
    return {
      key: "0xabc-call",
      kind: "call",
      label: "transfer",
      decoded: true,
      args: [{ name: "to", value: "0xbob" }],
      txHash: "0xabc",
      ...overrides,
    };
  }

  it("returns true for two empty arrays", () => {
    expect(sameContractActivity([], [])).toBe(true);
  });

  it("returns false when lengths differ", () => {
    expect(sameContractActivity([chip()], [])).toBe(false);
  });

  it("returns true for structurally identical but distinct chip objects", () => {
    expect(sameContractActivity([chip()], [chip()])).toBe(true);
  });

  it("returns false when a label differs", () => {
    expect(
      sameContractActivity([chip()], [chip({ label: "approve" })]),
    ).toBe(false);
  });

  it("returns false when decoded differs", () => {
    expect(
      sameContractActivity([chip()], [chip({ decoded: false })]),
    ).toBe(false);
  });

  it("returns false when an arg value differs", () => {
    const a = chip({ args: [{ name: "to", value: "0xbob" }] });
    const b = chip({ args: [{ name: "to", value: "0xalice" }] });
    expect(sameContractActivity([a], [b])).toBe(false);
  });

  it("returns false when arg counts differ", () => {
    const a = chip({ args: [{ name: "to", value: "0xbob" }] });
    const b = chip({ args: [] });
    expect(sameContractActivity([a], [b])).toBe(false);
  });

  it("compares element-wise in order", () => {
    const a = [chip({ key: "1" }), chip({ key: "2" })];
    const b = [chip({ key: "2" }), chip({ key: "1" })];
    expect(sameContractActivity(a, b)).toBe(false);
  });
});
