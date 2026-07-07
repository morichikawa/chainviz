import { describe, expect, it, vi } from "vitest";
import type { ContractCatalog } from "./catalog.js";
import { ContractTracker } from "./contracts.js";

const catalog: ContractCatalog = {
  ChainvizToken: {
    name: "ChainvizToken",
    abi: [],
    token: { symbol: "CVZ", decimals: 18 },
  },
  Counter: { name: "Counter", abi: [] },
};

describe("ContractTracker.recordDeployment", () => {
  it("returns an unknown-contract entity (address only) when there is no catalog match", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    const entity = tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(entity).toEqual({
      kind: "contract",
      address: "0xnew",
      chainType: "ethereum",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
  });

  it("returns null (does not re-emit) for a duplicate notification of the same address", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    const second = tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(second).toBeNull();
  });

  it("applies a pending catalog key registered before the deployment was detected", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    // deployContract 経由: コマンド処理側が先に登録する想定。
    expect(tracker.registerDeployment("0xnew", "ChainvizToken")).toBeNull();

    const entity = tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(entity).toEqual({
      kind: "contract",
      address: "0xnew",
      chainType: "ethereum",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
      name: "ChainvizToken",
      catalogKey: "ChainvizToken",
      token: { symbol: "CVZ", decimals: 18 },
    });
  });

  it("omits token for a cataloged contract without token metadata", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.registerDeployment("0xctr", "Counter");
    const entity = tracker.recordDeployment({
      address: "0xctr",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx2",
    });
    expect(entity?.name).toBe("Counter");
    expect(entity?.token).toBeUndefined();
  });
});

describe("ContractTracker.registerDeployment (after detection)", () => {
  it("updates an already-tracked unknown contract in place and returns the updated entity", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });

    const updated = tracker.registerDeployment("0xnew", "ChainvizToken");
    expect(updated).toEqual({
      kind: "contract",
      address: "0xnew",
      chainType: "ethereum",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
      name: "ChainvizToken",
      catalogKey: "ChainvizToken",
      token: { symbol: "CVZ", decimals: 18 },
    });
    expect(tracker.get("0xnew")).toEqual(updated);
  });

  it("returns null when re-registering the same catalog key (no change)", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    tracker.registerDeployment("0xnew", "ChainvizToken");
    expect(tracker.registerDeployment("0xnew", "ChainvizToken")).toBeNull();
  });

  it("ignores and logs a warning for an unknown catalog key", () => {
    const log = vi.fn();
    const tracker = new ContractTracker("ethereum", catalog, log);
    const result = tracker.registerDeployment("0xnew", "NoSuchContract");
    expect(result).toBeNull();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('unknown catalog key "NoSuchContract"'),
    );
    // ペンディング登録もされないので、後で検知されても未知のまま。
    const entity = tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(entity?.name).toBeUndefined();
  });

  it("does nothing when there is no catalog at all (catalog load failed at startup)", () => {
    const log = vi.fn();
    const tracker = new ContractTracker("ethereum", undefined, log);
    expect(tracker.registerDeployment("0xnew", "ChainvizToken")).toBeNull();
    expect(log).toHaveBeenCalled();
    const entity = tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(entity?.name).toBeUndefined();
  });
});

describe("ContractTracker.get", () => {
  it("returns undefined for an address that has not been recorded", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    expect(tracker.get("0xabsent")).toBeUndefined();
  });
});
