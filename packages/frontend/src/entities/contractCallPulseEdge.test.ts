import { describe, expect, it } from "vitest";
import {
  CONTRACT_CALL_PULSE_EDGE_TYPE,
  type ContractCallPulse,
  type ContractCallPulseFlowEdge,
  addContractCallPulse,
  buildContractCallPulseEdge,
  contractCallPulseEdgeId,
  removeContractCallPulse,
} from "./contractCallPulseEdge.js";

const ALICE = "0xalice";
const TOKEN = "0xtoken";

function pulse(key: string): ContractCallPulse {
  return { key, durationMs: 900 };
}

describe("contractCallPulseEdgeId", () => {
  it("is stable for the same wallet/contract pair", () => {
    expect(contractCallPulseEdgeId(ALICE, TOKEN)).toBe(
      contractCallPulseEdgeId(ALICE, TOKEN),
    );
  });

  it("differs by direction", () => {
    expect(contractCallPulseEdgeId(ALICE, TOKEN)).not.toBe(
      contractCallPulseEdgeId(TOKEN, ALICE),
    );
  });
});

describe("buildContractCallPulseEdge", () => {
  it("builds a wallet -> contract edge when both endpoints are present", () => {
    const edge = buildContractCallPulseEdge(
      ALICE,
      TOKEN,
      new Set([ALICE]),
      new Set([TOKEN]),
    );
    expect(edge).toMatchObject({
      id: contractCallPulseEdgeId(ALICE, TOKEN),
      type: CONTRACT_CALL_PULSE_EDGE_TYPE,
      source: ALICE,
      target: TOKEN,
      data: { pulses: [] },
    });
  });

  it("returns null when the wallet is missing", () => {
    expect(
      buildContractCallPulseEdge(ALICE, TOKEN, new Set(), new Set([TOKEN])),
    ).toBeNull();
  });

  it("returns null when the contract is missing", () => {
    expect(
      buildContractCallPulseEdge(ALICE, TOKEN, new Set([ALICE]), new Set()),
    ).toBeNull();
  });

  it("returns null for a self-loop (same address for both)", () => {
    expect(
      buildContractCallPulseEdge(ALICE, ALICE, new Set([ALICE]), new Set([ALICE])),
    ).toBeNull();
  });

  it("carries render metadata (className, stroke)", () => {
    const edge = buildContractCallPulseEdge(
      ALICE,
      TOKEN,
      new Set([ALICE]),
      new Set([TOKEN]),
    );
    expect(edge?.className).toBe("contract-call-pulse-edge");
    expect(edge?.style?.stroke).toBeDefined();
  });
});

describe("addContractCallPulse", () => {
  it("adds a new edge carrying one pulse", () => {
    const base = buildContractCallPulseEdge(
      ALICE,
      TOKEN,
      new Set([ALICE]),
      new Set([TOKEN]),
    ) as ContractCallPulseFlowEdge;
    const next = addContractCallPulse([], base, pulse("p1"));
    expect(next).toHaveLength(1);
    expect(next[0].data?.pulses).toEqual([pulse("p1")]);
  });

  it("appends a pulse to an existing edge with the same id", () => {
    const base = buildContractCallPulseEdge(
      ALICE,
      TOKEN,
      new Set([ALICE]),
      new Set([TOKEN]),
    ) as ContractCallPulseFlowEdge;
    const once = addContractCallPulse([], base, pulse("p1"));
    const twice = addContractCallPulse(once, base, pulse("p2"));
    expect(twice).toHaveLength(1);
    expect(twice[0].data?.pulses).toEqual([pulse("p1"), pulse("p2")]);
  });

  it("does not mutate the input array", () => {
    const base = buildContractCallPulseEdge(
      ALICE,
      TOKEN,
      new Set([ALICE]),
      new Set([TOKEN]),
    ) as ContractCallPulseFlowEdge;
    const input: ContractCallPulseFlowEdge[] = [];
    const next = addContractCallPulse(input, base, pulse("p1"));
    expect(input).toEqual([]);
    expect(next).not.toBe(input);
  });

  it("appends a new edge without touching an unrelated existing edge", () => {
    const BOB = "0xbob";
    const aliceEdge = buildContractCallPulseEdge(
      ALICE,
      TOKEN,
      new Set([ALICE]),
      new Set([TOKEN]),
    ) as ContractCallPulseFlowEdge;
    const bobEdge = buildContractCallPulseEdge(
      BOB,
      TOKEN,
      new Set([BOB]),
      new Set([TOKEN]),
    ) as ContractCallPulseFlowEdge;
    const withAlice = addContractCallPulse([], aliceEdge, pulse("p1"));
    const withBoth = addContractCallPulse(withAlice, bobEdge, pulse("p2"));
    expect(withBoth).toHaveLength(2);
    expect(withBoth.map((e) => e.id)).toEqual([aliceEdge.id, bobEdge.id]);
    expect(withBoth[0].data?.pulses).toEqual([pulse("p1")]);
  });
});

describe("removeContractCallPulse", () => {
  it("drops the edge when its last pulse is removed", () => {
    const base = buildContractCallPulseEdge(
      ALICE,
      TOKEN,
      new Set([ALICE]),
      new Set([TOKEN]),
    ) as ContractCallPulseFlowEdge;
    const withPulse = addContractCallPulse([], base, pulse("p1"));
    const next = removeContractCallPulse(withPulse, base.id, "p1");
    expect(next).toEqual([]);
  });

  it("keeps the edge when other pulses remain", () => {
    const base = buildContractCallPulseEdge(
      ALICE,
      TOKEN,
      new Set([ALICE]),
      new Set([TOKEN]),
    ) as ContractCallPulseFlowEdge;
    const withTwo = addContractCallPulse(
      addContractCallPulse([], base, pulse("p1")),
      base,
      pulse("p2"),
    );
    const next = removeContractCallPulse(withTwo, base.id, "p1");
    expect(next).toHaveLength(1);
    expect(next[0].data?.pulses).toEqual([pulse("p2")]);
  });

  it("is a no-op for an unknown edge id", () => {
    const base = buildContractCallPulseEdge(
      ALICE,
      TOKEN,
      new Set([ALICE]),
      new Set([TOKEN]),
    ) as ContractCallPulseFlowEdge;
    const withPulse = addContractCallPulse([], base, pulse("p1"));
    const next = removeContractCallPulse(withPulse, "nonexistent", "p1");
    expect(next).toEqual(withPulse);
  });

  it("returns an empty array for an empty input", () => {
    expect(removeContractCallPulse([], "any", "p1")).toEqual([]);
  });

  it("keeps the edge unchanged when the pulse key is not found on it", () => {
    const base = buildContractCallPulseEdge(
      ALICE,
      TOKEN,
      new Set([ALICE]),
      new Set([TOKEN]),
    ) as ContractCallPulseFlowEdge;
    const withPulse = addContractCallPulse([], base, pulse("p1"));
    const next = removeContractCallPulse(withPulse, base.id, "nonexistent");
    expect(next).toHaveLength(1);
    expect(next[0].data?.pulses).toEqual([pulse("p1")]);
  });

  it("removes a pulse from the targeted edge only, leaving other edges intact", () => {
    const BOB = "0xbob";
    const aliceEdge = buildContractCallPulseEdge(
      ALICE,
      TOKEN,
      new Set([ALICE]),
      new Set([TOKEN]),
    ) as ContractCallPulseFlowEdge;
    const bobEdge = buildContractCallPulseEdge(
      BOB,
      TOKEN,
      new Set([BOB]),
      new Set([TOKEN]),
    ) as ContractCallPulseFlowEdge;
    const withBoth = addContractCallPulse(
      addContractCallPulse([], aliceEdge, pulse("p1")),
      bobEdge,
      pulse("p2"),
    );
    // Alice のエッジは最後のパルスが消えて落ち、Bob のエッジは残る。
    const next = removeContractCallPulse(withBoth, aliceEdge.id, "p1");
    expect(next.map((e) => e.id)).toEqual([bobEdge.id]);
    expect(next[0].data?.pulses).toEqual([pulse("p2")]);
  });
});
