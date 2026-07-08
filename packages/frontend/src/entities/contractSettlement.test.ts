import type { ContractEntity, TransactionEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  resolveContractSettlementEvent,
  resolveContractSettlementEvents,
} from "./contractSettlement.js";

const TOKEN = "0xtoken0000000000000000000000000000000000";
const ALICE = "0xalice000000000000000000000000000000000";
const BOB = "0xbob00000000000000000000000000000000000";

function tx(overrides: Partial<TransactionEntity> = {}): TransactionEntity {
  return {
    kind: "transaction",
    hash: "0xhash",
    from: ALICE,
    to: BOB,
    status: "included",
    ...overrides,
  };
}

function contract(address: string): ContractEntity {
  return { kind: "contract", address, chainType: "ethereum" };
}

describe("resolveContractSettlementEvent", () => {
  it("resolves via contractCall.contractAddress", () => {
    const t = tx({ contractCall: { contractAddress: TOKEN, functionName: "transfer" } });
    const event = resolveContractSettlementEvent(t, new Set([TOKEN]));
    expect(event).toEqual({
      txHash: "0xhash",
      contractAddress: TOKEN,
      fromAddress: ALICE,
      failed: false,
    });
  });

  it("prioritizes createdContractAddress (deploy) over contractCall", () => {
    const t = tx({
      to: null,
      createdContractAddress: TOKEN,
      contractCall: { contractAddress: BOB, functionName: "x" },
    });
    const event = resolveContractSettlementEvent(t, new Set([TOKEN, BOB]));
    expect(event?.contractAddress).toBe(TOKEN);
  });

  it("falls back to `to` matching a known contract when contractCall is omitted", () => {
    const t = tx({ to: TOKEN, contractCall: undefined });
    const event = resolveContractSettlementEvent(t, new Set([TOKEN]));
    expect(event?.contractAddress).toBe(TOKEN);
  });

  it("returns null when `to` is a plain wallet (not a known contract) and no other field resolves", () => {
    const t = tx({ to: BOB, contractCall: undefined, createdContractAddress: undefined });
    expect(resolveContractSettlementEvent(t, new Set([TOKEN]))).toBeNull();
  });

  it("returns null when `to` is null and there is no contractCall/createdContractAddress", () => {
    const t = tx({ to: null });
    expect(resolveContractSettlementEvent(t, new Set([TOKEN]))).toBeNull();
  });

  it("returns null when the resolved contract address is not in the known set (dangling guard)", () => {
    const t = tx({ contractCall: { contractAddress: TOKEN, functionName: "transfer" } });
    expect(resolveContractSettlementEvent(t, new Set())).toBeNull();
  });

  it("marks failed:true for a failed tx", () => {
    const t = tx({
      status: "failed",
      contractCall: { contractAddress: TOKEN, functionName: "transfer" },
    });
    const event = resolveContractSettlementEvent(t, new Set([TOKEN]));
    expect(event?.failed).toBe(true);
  });

  it("marks failed:false for an included tx", () => {
    const t = tx({ contractCall: { contractAddress: TOKEN, functionName: "transfer" } });
    const event = resolveContractSettlementEvent(t, new Set([TOKEN]));
    expect(event?.failed).toBe(false);
  });

  it("uses tx.from as fromAddress even for a deploy (to is null)", () => {
    const t = tx({ to: null, from: ALICE, createdContractAddress: TOKEN });
    const event = resolveContractSettlementEvent(t, new Set([TOKEN]));
    expect(event?.fromAddress).toBe(ALICE);
  });

  it("resolves only the call target, ignoring events emitted from a different contract", () => {
    // 1 つの tx が複数コントラクトに影響する場合（ルーター経由でトークンが
    // イベントを発する等）でも、パルスは呼び出し先へ 1 本という §6.6 の設計。
    // contractEvents の発行元は確定解決に使わない。
    const OTHER = "0xother0000000000000000000000000000000000";
    const t = tx({
      to: TOKEN,
      contractCall: { contractAddress: TOKEN, functionName: "transfer" },
      contractEvents: [{ contractAddress: OTHER, eventName: "Swap" }],
    });
    const event = resolveContractSettlementEvent(t, new Set([TOKEN, OTHER]));
    expect(event?.contractAddress).toBe(TOKEN);
  });

  it("returns null when createdContractAddress is set but unknown, without falling through to contractCall", () => {
    // `??` の優先順位により createdContractAddress が最優先で選ばれるため、
    // それが未知なら contractCall が既知でも null になる（デプロイと呼び出しが
    // 同一 tx に同居することは実際上ないが、優先順位の回帰テストとして固定する）。
    const UNKNOWN = "0xunknown00000000000000000000000000000000";
    const t = tx({
      to: null,
      createdContractAddress: UNKNOWN,
      contractCall: { contractAddress: TOKEN, functionName: "x" },
    });
    expect(resolveContractSettlementEvent(t, new Set([TOKEN]))).toBeNull();
  });

  it("prefers contractCall over the `to` fallback when both point to known but different contracts", () => {
    const t = tx({
      to: BOB, // BOB is a known contract here
      contractCall: { contractAddress: TOKEN, functionName: "transfer" },
    });
    const event = resolveContractSettlementEvent(t, new Set([TOKEN, BOB]));
    expect(event?.contractAddress).toBe(TOKEN);
  });
});

describe("resolveContractSettlementEvents", () => {
  it("returns an empty array for no settled hashes", () => {
    expect(resolveContractSettlementEvents([], new Map(), [])).toEqual([]);
  });

  it("skips a hash that is not found in txByHash", () => {
    const events = resolveContractSettlementEvents(["0xmissing"], new Map(), [
      contract(TOKEN),
    ]);
    expect(events).toEqual([]);
  });

  it("resolves multiple settled hashes against multiple contracts", () => {
    const callTx = tx({
      hash: "0xcall",
      contractCall: { contractAddress: TOKEN, functionName: "transfer" },
    });
    const deployTx = tx({
      hash: "0xdeploy",
      to: null,
      createdContractAddress: BOB, // BOB acting as a contract address here
    });
    const txByHash = new Map([
      ["0xcall", callTx],
      ["0xdeploy", deployTx],
    ]);
    const events = resolveContractSettlementEvents(
      ["0xcall", "0xdeploy"],
      txByHash,
      [contract(TOKEN), contract(BOB)],
    );
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.contractAddress)).toEqual([TOKEN, BOB]);
  });

  it("excludes a settled tx whose target contract is unknown", () => {
    const t = tx({
      hash: "0xcall",
      contractCall: { contractAddress: TOKEN, functionName: "transfer" },
    });
    const events = resolveContractSettlementEvents(
      ["0xcall"],
      new Map([["0xcall", t]]),
      [], // no known contracts
    );
    expect(events).toEqual([]);
  });

  it("preserves the settled-hash order in the output events", () => {
    const first = tx({
      hash: "0xfirst",
      contractCall: { contractAddress: TOKEN, functionName: "a" },
    });
    const second = tx({
      hash: "0xsecond",
      to: null,
      createdContractAddress: BOB,
    });
    const txByHash = new Map([
      ["0xfirst", first],
      ["0xsecond", second],
    ]);
    const events = resolveContractSettlementEvents(
      ["0xsecond", "0xfirst"],
      txByHash,
      [contract(TOKEN), contract(BOB)],
    );
    expect(events.map((e) => e.txHash)).toEqual(["0xsecond", "0xfirst"]);
  });

  it("emits a duplicate event when the same settled hash appears twice (no dedup)", () => {
    const t = tx({
      hash: "0xdup",
      contractCall: { contractAddress: TOKEN, functionName: "transfer" },
    });
    const events = resolveContractSettlementEvents(
      ["0xdup", "0xdup"],
      new Map([["0xdup", t]]),
      [contract(TOKEN)],
    );
    expect(events).toHaveLength(2);
  });
});
