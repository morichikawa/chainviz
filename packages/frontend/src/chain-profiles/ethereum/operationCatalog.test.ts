import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ETHEREUM_OPERATION_CATALOG,
  type OperationArgType,
  getOperationCatalogEntry,
} from "./operationCatalog.js";

describe("ETHEREUM_OPERATION_CATALOG", () => {
  it("keys every entry with the exact catalogKey collector/catalog.json use (ChainvizToken/ChainvizNFT/Counter)", () => {
    const keys = ETHEREUM_OPERATION_CATALOG.map((entry) => entry.catalogKey);
    expect(keys).toEqual(["ChainvizToken", "ChainvizNFT", "Counter"]);
  });

  it("gives every function a full cast signature (name + parens), not just a bare name", () => {
    for (const entry of ETHEREUM_OPERATION_CATALOG) {
      for (const fn of entry.functions) {
        expect(fn.signature).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*\(.*\)$/);
      }
    }
  });

  it("keeps each function's arg count consistent with the signature's comma count", () => {
    for (const entry of ETHEREUM_OPERATION_CATALOG) {
      for (const fn of entry.functions) {
        const inner = fn.signature.slice(
          fn.signature.indexOf("(") + 1,
          fn.signature.lastIndexOf(")"),
        );
        const expectedArgCount = inner === "" ? 0 : inner.split(",").length;
        expect(fn.args).toHaveLength(expectedArgCount);
      }
    }
  });

  it("gives ChainvizToken a single uint constructor arg (initialSupply, in token units per Issue #219)", () => {
    const entry = getOperationCatalogEntry("ChainvizToken");
    expect(entry?.constructorArgs).toEqual([
      { name: "initialSupply", type: "uint", unit: "token" },
    ]);
  });

  it("gives Counter no constructor args", () => {
    const entry = getOperationCatalogEntry("Counter");
    expect(entry?.constructorArgs).toEqual([]);
  });

  it("marks no sample function as payable (no payable functions exist in the sample contracts)", () => {
    for (const entry of ETHEREUM_OPERATION_CATALOG) {
      for (const fn of entry.functions) {
        expect(fn.payable).toBe(false);
      }
    }
  });

  it("gives every function a non-empty ja/en description (Issue #213)", () => {
    for (const entry of ETHEREUM_OPERATION_CATALOG) {
      for (const fn of entry.functions) {
        expect(fn.description.ja.length).toBeGreaterThan(0);
        expect(fn.description.en.length).toBeGreaterThan(0);
      }
    }
  });

  it("gives ChainvizToken token metadata matching the deployed source's symbol/decimals (Issue #219)", () => {
    const entry = getOperationCatalogEntry("ChainvizToken");
    // profiles/ethereum/contracts/src/ChainvizToken.sol: symbol="CVZ", decimals=18.
    expect(entry?.token).toEqual({ symbol: "CVZ", decimals: 18 });
  });

  it("gives Counter no token metadata (it is not a token contract)", () => {
    const entry = getOperationCatalogEntry("Counter");
    expect(entry?.token).toBeUndefined();
  });

  it("marks every ChainvizToken amount-like arg (constructor and function args named amount/initialSupply) with unit: token", () => {
    const entry = getOperationCatalogEntry("ChainvizToken");
    expect(entry?.constructorArgs.find((arg) => arg.name === "initialSupply")?.unit).toBe(
      "token",
    );
    for (const fn of entry?.functions ?? []) {
      const amountArg = fn.args.find((arg) => arg.name === "amount");
      if (amountArg) expect(amountArg.unit).toBe("token");
    }
  });

  it("does not mark Counter's incrementBy amount as a token unit (it is a plain counter, not a token)", () => {
    const entry = getOperationCatalogEntry("Counter");
    const incrementBy = entry?.functions.find((fn) => fn.label === "incrementBy");
    expect(incrementBy?.args.find((arg) => arg.name === "amount")?.unit).toBeUndefined();
  });

  // --- Issue #315: ChainvizNFT(ERC-721サブセット) ---

  it("gives ChainvizNFT no constructor args (matches the source: no constructor params)", () => {
    const entry = getOperationCatalogEntry("ChainvizNFT");
    expect(entry?.constructorArgs).toEqual([]);
  });

  it("gives ChainvizNFT no token metadata (it is not a quantity-based ERC20 token)", () => {
    const entry = getOperationCatalogEntry("ChainvizNFT");
    expect(entry?.token).toBeUndefined();
  });

  it(
    "never marks a ChainvizNFT tokenId arg with unit: 'token' " +
      "(tokenId is a discrete identifier, not a decimals-scaled quantity)",
    () => {
      const entry = getOperationCatalogEntry("ChainvizNFT");
      for (const fn of entry?.functions ?? []) {
        const tokenIdArg = fn.args.find((arg) => arg.name === "tokenId");
        if (tokenIdArg) expect(tokenIdArg.unit).toBeUndefined();
      }
    },
  );

  it("never marks any arg with unit: 'token' on an entry without token metadata (general guard for the ERC20/721 copy-paste trap)", () => {
    // `unit: "token"` は decimals 換算を伴うため token メタ情報を持つ
    // エントリでのみ意味を持つ。ChainvizNFT の approve/transferFrom は
    // ERC-20 と同型のシグネチャで、コピペで `unit: "token"` が紛れ込むと
    // tokenId が decimals 換算されて壊れる（docs/worklog/issue-315.md の罠）。
    // 引数名に依存しない一般則として、token メタ情報を持たないエントリの
    // 全引数に unit が付いていないことを保証する。
    for (const entry of ETHEREUM_OPERATION_CATALOG) {
      if (entry.token) continue;
      for (const arg of entry.constructorArgs) {
        expect(arg.unit).toBeUndefined();
      }
      for (const fn of entry.functions) {
        for (const arg of fn.args) {
          expect(arg.unit).toBeUndefined();
        }
      }
    }
  });

  it("exposes exactly mint/approve/transferFrom for ChainvizNFT (per docs/worklog/issue-315.md)", () => {
    const entry = getOperationCatalogEntry("ChainvizNFT");
    expect(entry?.functions.map((fn) => fn.label).sort()).toEqual([
      "approve",
      "mint",
      "transferFrom",
    ]);
  });
});

describe("getOperationCatalogEntry", () => {
  it("returns undefined for an unknown catalog key", () => {
    expect(getOperationCatalogEntry("NotInCatalog")).toBeUndefined();
  });

  it("is case-sensitive (catalogKey must match exactly, e.g. not 'chainviztoken')", () => {
    expect(getOperationCatalogEntry("chainviztoken")).toBeUndefined();
  });
});

/**
 * `operationCatalog.ts` はフロント表現セット（ABI そのものではない UI 用の
 * 静的データ）だが、その catalogKey・関数シグネチャ・コンストラクタ引数・
 * payable 判定・引数名は `profiles/ethereum/contracts/catalog.json` の実 ABI
 * と食い違ってはならない（ずれるとデプロイの forge 解決・呼び出しタブの照合が
 * 壊れる。実装担当が「catalogKey の食い違いを修正した」と報告した箇所の回帰
 * ガード）。カタログ JSON はパッケージ外（リポジトリ直下 profiles/）にあるため
 * node の fs で直接読んで突き合わせる。
 */
describe("ETHEREUM_OPERATION_CATALOG matches the real catalog.json ABI", () => {
  interface AbiInput {
    name: string;
    type: string;
  }
  interface AbiEntry {
    type: string;
    name?: string;
    stateMutability?: string;
    inputs?: AbiInput[];
  }
  // カタログ JSON はリポジトリ直下 profiles/ にあり、パッケージ相対では
  // テスト実行時の cwd（vitest はパッケージ配下）に依存する。cwd から上へ
  // たどって profiles/ethereum/contracts/catalog.json を探す（実行位置に
  // 依存しないようにする）。
  function findCatalogJson(): string {
    const relative = "profiles/ethereum/contracts/catalog.json";
    let dir = process.cwd();
    for (;;) {
      const candidate = resolve(dir, relative);
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) {
        throw new Error(`could not locate ${relative} above ${process.cwd()}`);
      }
      dir = parent;
    }
  }
  const catalogJson = JSON.parse(
    readFileSync(findCatalogJson(), "utf8"),
  ) as Record<string, { abi: AbiEntry[] }>;

  /** ABI のソリディティ型を UI 側の入力補助分類へ写す。 */
  function abiTypeToArgType(abiType: string): OperationArgType {
    if (abiType === "address") return "address";
    if (abiType === "bool") return "bool";
    if (abiType === "string") return "string";
    if (/^u?int\d*$/.test(abiType)) return "uint";
    throw new Error(`unmapped ABI type: ${abiType}`);
  }

  /** state を変える（cast send で呼ぶ意味がある）関数だけ抜き出す。 */
  function stateChangingFunctions(abi: AbiEntry[]): AbiEntry[] {
    return abi.filter(
      (entry) =>
        entry.type === "function" &&
        entry.stateMutability !== "view" &&
        entry.stateMutability !== "pure",
    );
  }

  function signatureOf(entry: AbiEntry): string {
    const types = (entry.inputs ?? []).map((input) => input.type).join(",");
    return `${entry.name}(${types})`;
  }

  it("only lists catalogKeys that exist as top-level keys in catalog.json", () => {
    for (const entry of ETHEREUM_OPERATION_CATALOG) {
      expect(Object.keys(catalogJson)).toContain(entry.catalogKey);
    }
  });

  it("matches each contract's constructor args (name, order, mapped type) to the ABI", () => {
    for (const entry of ETHEREUM_OPERATION_CATALOG) {
      const abi = catalogJson[entry.catalogKey].abi;
      const ctor = abi.find((item) => item.type === "constructor");
      const abiCtorArgs = ctor?.inputs ?? [];
      expect(entry.constructorArgs.map((arg) => arg.name)).toEqual(
        abiCtorArgs.map((input) => input.name),
      );
      entry.constructorArgs.forEach((arg, index) => {
        expect(arg.type).toBe(abiTypeToArgType(abiCtorArgs[index].type));
      });
    }
  });

  it("lists exactly the ABI's state-changing functions (no missing, no phantom, view/pure excluded)", () => {
    for (const entry of ETHEREUM_OPERATION_CATALOG) {
      const abi = catalogJson[entry.catalogKey].abi;
      const abiSignatures = stateChangingFunctions(abi).map(signatureOf).sort();
      const catalogSignatures = entry.functions.map((fn) => fn.signature).sort();
      expect(catalogSignatures).toEqual(abiSignatures);
    }
  });

  it("matches each function's arg names/types and payable flag to the ABI", () => {
    for (const entry of ETHEREUM_OPERATION_CATALOG) {
      const abi = catalogJson[entry.catalogKey].abi;
      const abiBySignature = new Map(
        stateChangingFunctions(abi).map((fn) => [signatureOf(fn), fn] as const),
      );
      for (const fn of entry.functions) {
        const abiFn = abiBySignature.get(fn.signature);
        expect(abiFn).toBeDefined();
        if (!abiFn) continue;
        const abiInputs = abiFn.inputs ?? [];
        expect(fn.args.map((arg) => arg.name)).toEqual(
          abiInputs.map((input) => input.name),
        );
        fn.args.forEach((arg, index) => {
          expect(arg.type).toBe(abiTypeToArgType(abiInputs[index].type));
        });
        expect(fn.payable).toBe(abiFn.stateMutability === "payable");
      }
    }
  });
});
