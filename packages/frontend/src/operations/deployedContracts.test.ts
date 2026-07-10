import type { ContractEntity, WorldStateEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import type { ContractCatalogEntry } from "../chain-profiles/ethereum/operationCatalog.js";
import { deriveDeployedContracts } from "./deployedContracts.js";

const TOKEN_ENTRY: ContractCatalogEntry = {
  catalogKey: "ChainvizToken",
  displayName: { ja: "ChainvizToken", en: "ChainvizToken" },
  description: { ja: "最小のERC20", en: "minimal ERC20" },
  token: { symbol: "CVZ", decimals: 18 },
  constructorArgs: [{ name: "initialSupply", type: "uint", unit: "token" }],
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

  describe("token metadata (Issue #219)", () => {
    it("falls back to the catalog's static token metadata when the entity has none observed yet", () => {
      const entities: WorldStateEntity[] = [
        contract({ name: "ChainvizToken", catalogKey: "ChainvizToken", token: undefined }),
      ];
      const candidates = deriveDeployedContracts(entities, catalog);
      expect(candidates[0].token).toEqual({ symbol: "CVZ", decimals: 18 });
    });

    it("prefers the entity's observed token metadata over the catalog's static value", () => {
      const entities: WorldStateEntity[] = [
        contract({
          name: "ChainvizToken",
          catalogKey: "ChainvizToken",
          token: { symbol: "CVZ2", decimals: 6 },
        }),
      ];
      const candidates = deriveDeployedContracts(entities, catalog);
      expect(candidates[0].token).toEqual({ symbol: "CVZ2", decimals: 6 });
    });

    it("passes a malformed observed token through as-is without falling back to the catalog value", () => {
      // 実測値（ContractEntity.token）が壊れている（decimals が非負整数でない）
      // ケースの挙動を固定する。deriveDeployedContracts は実測値の中身を検証
      // せず、truthy であればそのまま採用する（`contract.token ?? entry.token`）。
      // その結果、下流の parseUnits/formatUnits が不正な decimals を防御的に
      // 弾き、トークン単位入力が無効化される（クラッシュはしない）。実測値は
      // collector の decimals() 由来で uint8 のため現実には壊れ得ないが、
      // 万一壊れてもカタログ値へフォールバックしない点を明示しておく。
      const entities: WorldStateEntity[] = [
        contract({
          name: "ChainvizToken",
          catalogKey: "ChainvizToken",
          token: { symbol: "CVZ", decimals: -1 },
        }),
      ];
      const candidates = deriveDeployedContracts(entities, catalog);
      expect(candidates[0].token).toEqual({ symbol: "CVZ", decimals: -1 });
    });

    it("leaves token undefined for a contract whose catalog entry has no token metadata (e.g. Counter)", () => {
      const counterEntry: ContractCatalogEntry = {
        catalogKey: "Counter",
        displayName: { ja: "Counter", en: "Counter" },
        description: { ja: "カウンタ", en: "counter" },
        constructorArgs: [],
        functions: [],
      };
      const entities: WorldStateEntity[] = [
        contract({ name: "Counter", catalogKey: "Counter" }),
      ];
      const candidates = deriveDeployedContracts(entities, [counterEntry]);
      expect(candidates[0].token).toBeUndefined();
    });
  });
});
