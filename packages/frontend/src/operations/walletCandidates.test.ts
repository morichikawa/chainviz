import type {
  WalletEntity,
  WorkbenchEntity,
  WorldStateEntity,
} from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { deriveWalletCandidates } from "./walletCandidates.js";

function wallet(overrides: Partial<WalletEntity> = {}): WalletEntity {
  return {
    kind: "wallet",
    address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    chainType: "ethereum",
    balance: "0",
    nonce: 0,
    isSmartAccount: false,
    ownerWorkbenchId: null,
    recentTxHashes: [],
    ...overrides,
  };
}

function workbench(overrides: Partial<WorkbenchEntity> = {}): WorkbenchEntity {
  return {
    kind: "workbench",
    id: "workbench-alice",
    containerName: "chainviz-workbench-alice",
    ip: "172.20.0.30",
    ports: [],
    resources: { cpuPercent: 0, memMB: 0 },
    process: { name: "foundry" },
    label: "Alice",
    walletIds: [],
    ...overrides,
  };
}

describe("deriveWalletCandidates", () => {
  it("returns an empty array when there are no wallets", () => {
    expect(deriveWalletCandidates([workbench()])).toEqual([]);
  });

  it("labels a wallet with its owner workbench's label when the owner is present", () => {
    const entities: WorldStateEntity[] = [
      workbench({ id: "workbench-alice", label: "Alice" }),
      wallet({
        address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ownerWorkbenchId: "workbench-alice",
      }),
    ];
    const candidates = deriveWalletCandidates(entities);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].address).toBe(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(candidates[0].label).toContain("Alice");
    expect(candidates[0].label).toContain("0xaaaa");
  });

  it("falls back to an address-only label when ownerWorkbenchId is null", () => {
    const entities: WorldStateEntity[] = [
      wallet({
        address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        ownerWorkbenchId: null,
      }),
    ];
    const candidates = deriveWalletCandidates(entities);
    expect(candidates[0].label).not.toContain("(");
  });

  it("falls back to an address-only label when the owner workbench id does not resolve (deleted owner)", () => {
    const entities: WorldStateEntity[] = [
      wallet({
        address: "0xcccccccccccccccccccccccccccccccccccccc",
        ownerWorkbenchId: "workbench-deleted",
      }),
    ];
    const candidates = deriveWalletCandidates(entities);
    expect(candidates[0].label).not.toContain("(");
  });

  it("sorts candidates by address for stable ordering", () => {
    const entities: WorldStateEntity[] = [
      wallet({ address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
      wallet({ address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
    ];
    const candidates = deriveWalletCandidates(entities);
    expect(candidates.map((c) => c.address)).toEqual([
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ]);
  });

  it("ignores non-wallet entities", () => {
    const entities: WorldStateEntity[] = [
      workbench(),
      {
        kind: "block",
        hash: "0x1",
        number: 1,
        parentHash: "0x0",
        timestamp: 0,
        receivedAt: {},
      },
    ];
    expect(deriveWalletCandidates(entities)).toEqual([]);
  });
});
