import type { ContractEntity, WorldStateEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import type { ContractCatalogEntry } from "../chain-profiles/ethereum/operationCatalog.js";
import { deriveDeployedContracts } from "./deployedContracts.js";

const TOKEN_ENTRY: ContractCatalogEntry = {
  catalogKey: "ChainvizToken",
  displayName: { ja: "ChainvizToken", en: "ChainvizToken" },
  description: { ja: "最小のERC20", en: "minimal ERC20" },
  constructorArgs: [{ name: "initialSupply", type: "uint" }],
  functions: [],
};

const catalog: ContractCatalogEntry[] = [TOKEN_ENTRY];

function contract(overrides: Partial<ContractEntity> = {}): ContractEntity {
  return {
    kind: "contract",
    address: "0xcccccccccccccccccccccccccccccccccccccc",
    chainType: "ethereum",
    ...overrides,
  };
}

describe("deriveDeployedContracts", () => {
  it("includes a contract whose catalogKey matches an operation catalog entry", () => {
    const entities: WorldStateEntity[] = [
      contract({ name: "ChainvizToken", catalogKey: "ChainvizToken" }),
    ];
    const candidates = deriveDeployedContracts(entities, catalog);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].catalog).toBe(TOKEN_ENTRY);
    expect(candidates[0].label).toContain("ChainvizToken");
  });

  it("excludes a contract with no catalogKey (unknown contract, §6.4)", () => {
    const entities: WorldStateEntity[] = [contract({ catalogKey: undefined })];
    expect(deriveDeployedContracts(entities, catalog)).toEqual([]);
  });

  it("excludes a contract whose catalogKey does not resolve in the operation catalog", () => {
    const entities: WorldStateEntity[] = [
      contract({ name: "Mystery", catalogKey: "NotInOperationCatalog" }),
    ];
    expect(deriveDeployedContracts(entities, catalog)).toEqual([]);
  });

  it("falls back to the catalogKey as the display name when the entity's name is absent", () => {
    const entities: WorldStateEntity[] = [
      contract({ name: undefined, catalogKey: "ChainvizToken" }),
    ];
    const candidates = deriveDeployedContracts(entities, catalog);
    expect(candidates[0].label).toContain("ChainvizToken");
  });

  it("sorts candidates by address", () => {
    const entities: WorldStateEntity[] = [
      contract({
        address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        catalogKey: "ChainvizToken",
      }),
      contract({
        address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        catalogKey: "ChainvizToken",
      }),
    ];
    const candidates = deriveDeployedContracts(entities, catalog);
    expect(candidates.map((c) => c.address)).toEqual([
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ]);
  });

  it("ignores non-contract entities", () => {
    const entities: WorldStateEntity[] = [
      {
        kind: "wallet",
        address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        chainType: "ethereum",
        balance: "0",
        nonce: 0,
        isSmartAccount: false,
        ownerWorkbenchId: null,
        recentTxHashes: [],
      },
    ];
    expect(deriveDeployedContracts(entities, catalog)).toEqual([]);
  });
});
