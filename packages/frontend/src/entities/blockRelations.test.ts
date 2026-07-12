import type { TransactionEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { deriveBlockRelatedAddresses } from "./blockRelations.js";

function tx(overrides: Partial<TransactionEntity> & { hash: string }): TransactionEntity {
  return {
    kind: "transaction",
    from: "0xFrom",
    to: "0xTo",
    status: "included",
    ...overrides,
  };
}

describe("deriveBlockRelatedAddresses", () => {
  it("collects from/to lowercased for tx included in the given block", () => {
    const addresses = deriveBlockRelatedAddresses("0xb1", [
      tx({ hash: "0x1", blockHash: "0xb1", from: "0xAAA", to: "0xBBB" }),
    ]);
    expect(addresses).toEqual(new Set(["0xaaa", "0xbbb"]));
  });

  it("ignores tx belonging to a different block", () => {
    const addresses = deriveBlockRelatedAddresses("0xb1", [
      tx({ hash: "0x1", blockHash: "0xb2", from: "0xAAA", to: "0xBBB" }),
    ]);
    expect(addresses.size).toBe(0);
  });

  it("ignores tx without a blockHash (still pending)", () => {
    const addresses = deriveBlockRelatedAddresses("0xb1", [
      tx({ hash: "0x1", from: "0xAAA", to: "0xBBB", status: "pending" }),
    ]);
    expect(addresses.size).toBe(0);
  });

  it("omits to when it is null (contract creation tx)", () => {
    const addresses = deriveBlockRelatedAddresses("0xb1", [
      tx({ hash: "0x1", blockHash: "0xb1", from: "0xAAA", to: null }),
    ]);
    expect(addresses).toEqual(new Set(["0xaaa"]));
  });

  it("includes contractCall.contractAddress and createdContractAddress", () => {
    const addresses = deriveBlockRelatedAddresses("0xb1", [
      tx({
        hash: "0x1",
        blockHash: "0xb1",
        from: "0xAAA",
        to: "0xCCC",
        contractCall: { contractAddress: "0xCCC", functionName: "transfer" },
      }),
      tx({
        hash: "0x2",
        blockHash: "0xb1",
        from: "0xDDD",
        to: null,
        createdContractAddress: "0xEEE",
      }),
    ]);
    expect(addresses).toEqual(new Set(["0xaaa", "0xccc", "0xddd", "0xeee"]));
  });

  it("aggregates across multiple tx in the same block", () => {
    const addresses = deriveBlockRelatedAddresses("0xb1", [
      tx({ hash: "0x1", blockHash: "0xb1", from: "0xAAA", to: "0xBBB" }),
      tx({ hash: "0x2", blockHash: "0xb1", from: "0xCCC", to: "0xDDD" }),
    ]);
    expect(addresses).toEqual(new Set(["0xaaa", "0xbbb", "0xccc", "0xddd"]));
  });
});
