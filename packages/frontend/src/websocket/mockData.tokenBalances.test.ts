import type { ContractEntity, WalletEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { createMockSnapshot } from "./mockData.js";

/**
 * `createMockSnapshot` に追加した、ウォレットのトークン残高サンプル
 * （Issue #168）に絞ったテスト。既存の `mockData.test.ts` が肥大化しない
 * よう別ファイルに分ける（`mockData.workbenchOperations.test.ts` と同じ
 * 方針）。
 */
describe("createMockSnapshot wallet token balances (ARCHITECTURE.md §6.7)", () => {
  function wallets(): WalletEntity[] {
    return createMockSnapshot().entities.filter(
      (e): e is WalletEntity => e.kind === "wallet",
    );
  }

  function contracts(): ContractEntity[] {
    return createMockSnapshot().entities.filter(
      (e): e is ContractEntity => e.kind === "contract",
    );
  }

  it("gives Alice a tokenBalance resolvable against a cataloged token contract", () => {
    const alice = wallets().find((w) => w.ownerWorkbenchId === "workbench-alice" && !w.isSmartAccount);
    expect(alice?.tokenBalances).toBeDefined();
    expect(alice?.tokenBalances).toHaveLength(1);

    const tokenContractAddresses = new Set(
      contracts()
        .filter((c) => c.token !== undefined)
        .map((c) => c.address),
    );
    for (const balance of alice?.tokenBalances ?? []) {
      expect(tokenContractAddresses.has(balance.contractAddress)).toBe(true);
    }
  });

  it("gives Bob one resolvable tokenBalance and one dangling (unobserved contract) tokenBalance", () => {
    const bob = wallets().find((w) => w.ownerWorkbenchId === null);
    expect(bob?.tokenBalances).toHaveLength(2);

    const allEntityAddresses = new Set(
      createMockSnapshot()
        .entities.filter((e): e is ContractEntity => e.kind === "contract")
        .map((c) => c.address),
    );
    const resolvable = (bob?.tokenBalances ?? []).filter((b) =>
      allEntityAddresses.has(b.contractAddress),
    );
    const dangling = (bob?.tokenBalances ?? []).filter(
      (b) => !allEntityAddresses.has(b.contractAddress),
    );
    expect(resolvable).toHaveLength(1);
    expect(dangling).toHaveLength(1);
  });
});
