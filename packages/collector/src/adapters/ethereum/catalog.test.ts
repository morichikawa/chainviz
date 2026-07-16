import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readContractCatalog } from "./catalog.js";

describe("readContractCatalog", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function writeCatalog(content: string): string {
    dir = mkdtempSync(path.join(tmpdir(), "chainviz-catalog-"));
    const contractsDir = path.join(dir, "contracts");
    mkdirSync(contractsDir, { recursive: true });
    writeFileSync(path.join(contractsDir, "catalog.json"), content);
    return dir;
  }

  it("reads a well-formed catalog into a key -> entry map", () => {
    const profileDir = writeCatalog(
      JSON.stringify({
        ChainvizToken: {
          name: "ChainvizToken",
          abi: [{ type: "function", name: "transfer" }],
          token: { symbol: "CVZ", decimals: 18 },
        },
        Counter: { name: "Counter", abi: [] },
      }),
    );

    const catalog = readContractCatalog(profileDir, () => {});
    expect(catalog).toBeDefined();
    expect(catalog?.ChainvizToken.name).toBe("ChainvizToken");
    expect(catalog?.ChainvizToken.token).toEqual({ symbol: "CVZ", decimals: 18 });
    expect(catalog?.Counter).toEqual({ name: "Counter", abi: [] });
  });

  it("returns undefined and logs a specific error when the file does not exist", () => {
    const logs: unknown[][] = [];
    const catalog = readContractCatalog("/nonexistent/profile/dir", (m, d) =>
      logs.push([m, d]),
    );
    expect(catalog).toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(logs[0][0]).toContain("failed to read contract catalog");
    expect(logs[0][0]).toContain("/nonexistent/profile/dir");
  });

  it("returns undefined and logs a specific error when the file is not valid JSON", () => {
    const profileDir = writeCatalog("{ not valid json");
    const logs: unknown[][] = [];
    const catalog = readContractCatalog(profileDir, (m, d) => logs.push([m, d]));
    expect(catalog).toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(logs[0][0]).toContain("failed to parse contract catalog");
  });

  it("returns undefined and logs when the top-level JSON value is not an object", () => {
    const profileDir = writeCatalog(JSON.stringify(["not", "an", "object"]));
    const logs: unknown[][] = [];
    const catalog = readContractCatalog(profileDir, (m, d) => logs.push([m, d]));
    expect(catalog).toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(logs[0][0]).toContain("is not a JSON object");
  });

  it("skips (but does not fail) a malformed entry missing name/abi", () => {
    const profileDir = writeCatalog(
      JSON.stringify({
        Good: { name: "Good", abi: [] },
        Bad: { abi: [] }, // name missing
      }),
    );
    const logs: unknown[][] = [];
    const catalog = readContractCatalog(profileDir, (m, d) => logs.push([m, d]));
    expect(catalog).toBeDefined();
    expect(catalog?.Good).toEqual({ name: "Good", abi: [] });
    expect(catalog?.Bad).toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(logs[0][0]).toContain('entry "Bad"');
  });

  it("returns an empty catalog (not undefined) for an empty JSON object", () => {
    // 空のカタログは「読めたが 1 件も載っていない」状態。undefined（読み込み
    // 失敗による復号無効化）とは区別する必要がある: 空 {} は正常な読み込みで
    // あり、以後デプロイされたコントラクトはすべて「未知」になるだけ。
    const profileDir = writeCatalog("{}");
    const logs: unknown[][] = [];
    const catalog = readContractCatalog(profileDir, (m, d) => logs.push([m, d]));
    expect(catalog).toEqual({});
    expect(logs).toHaveLength(0);
  });

  it("returns undefined and logs when the top-level JSON value is null", () => {
    // JSON.parse("null") は null を返す（パース自体は成功する）。null は
    // typeof === "object" なので、null チェックが無いと後続の Object.entries で
    // 落ちる。読み込み失敗として undefined に倒れることを固定する。
    const profileDir = writeCatalog("null");
    const logs: unknown[][] = [];
    const catalog = readContractCatalog(profileDir, (m, d) => logs.push([m, d]));
    expect(catalog).toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(logs[0][0]).toContain("is not a JSON object");
  });

  it("returns undefined and logs when the top-level JSON value is a number", () => {
    const profileDir = writeCatalog("42");
    const logs: unknown[][] = [];
    const catalog = readContractCatalog(profileDir, (m, d) => logs.push([m, d]));
    expect(catalog).toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(logs[0][0]).toContain("is not a JSON object");
  });

  it("returns undefined and logs a parse error for an empty file", () => {
    // 空ファイルは JSON として不正（JSON.parse("") が throw する）。ファイル
    // 欠落（read 失敗）とは別経路の縮退（parse 失敗）に落ちることを固定する。
    const profileDir = writeCatalog("");
    const logs: unknown[][] = [];
    const catalog = readContractCatalog(profileDir, (m, d) => logs.push([m, d]));
    expect(catalog).toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(logs[0][0]).toContain("failed to parse contract catalog");
  });

  it("skips a null entry value without throwing (null is typeof object)", () => {
    const profileDir = writeCatalog(
      JSON.stringify({ Good: { name: "Good", abi: [] }, Bad: null }),
    );
    const logs: unknown[][] = [];
    const catalog = readContractCatalog(profileDir, (m, d) => logs.push([m, d]));
    expect(catalog?.Good).toEqual({ name: "Good", abi: [] });
    expect(catalog?.Bad).toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(logs[0][0]).toContain('entry "Bad"');
  });

  it("skips an entry whose value is a primitive (string / number)", () => {
    const profileDir = writeCatalog(
      JSON.stringify({
        Good: { name: "Good", abi: [] },
        Str: "not an object",
        Num: 7,
      }),
    );
    const logs: unknown[][] = [];
    const catalog = readContractCatalog(profileDir, (m, d) => logs.push([m, d]));
    expect(catalog?.Good).toEqual({ name: "Good", abi: [] });
    expect(catalog?.Str).toBeUndefined();
    expect(catalog?.Num).toBeUndefined();
    expect(logs).toHaveLength(2);
  });

  it("skips an entry whose name is not a string", () => {
    const profileDir = writeCatalog(
      JSON.stringify({
        Good: { name: "Good", abi: [] },
        Bad: { name: 123, abi: [] }, // name wrong type
      }),
    );
    const logs: unknown[][] = [];
    const catalog = readContractCatalog(profileDir, (m, d) => logs.push([m, d]));
    expect(catalog?.Good).toEqual({ name: "Good", abi: [] });
    expect(catalog?.Bad).toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(logs[0][0]).toContain('entry "Bad"');
  });

  it("skips an entry whose abi is present but not an array", () => {
    const profileDir = writeCatalog(
      JSON.stringify({
        Good: { name: "Good", abi: [] },
        Bad: { name: "Bad", abi: { type: "function" } }, // abi must be an array
      }),
    );
    const logs: unknown[][] = [];
    const catalog = readContractCatalog(profileDir, (m, d) => logs.push([m, d]));
    expect(catalog?.Good).toEqual({ name: "Good", abi: [] });
    expect(catalog?.Bad).toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(logs[0][0]).toContain('entry "Bad"');
  });

  it("keeps the good entries when several malformed entries are interleaved", () => {
    const profileDir = writeCatalog(
      JSON.stringify({
        A: { name: "A", abi: [] },
        B: { abi: [] }, // missing name
        C: { name: "C", abi: [{ type: "event" }] },
        D: 0, // primitive
      }),
    );
    const logs: unknown[][] = [];
    const catalog = readContractCatalog(profileDir, (m, d) => logs.push([m, d]));
    expect(Object.keys(catalog ?? {}).sort()).toEqual(["A", "C"]);
    expect(logs).toHaveLength(2);
  });

  it("passes a well-formed source field through verbatim (Issue #321)", () => {
    const profileDir = writeCatalog(
      JSON.stringify({
        ChainvizToken: {
          name: "ChainvizToken",
          abi: [],
          source: { fileName: "ChainvizToken.sol", language: "solidity", code: "contract X {}" },
        },
      }),
    );
    const logs: unknown[][] = [];
    const catalog = readContractCatalog(profileDir, (m, d) => logs.push([m, d]));
    expect(catalog?.ChainvizToken.source).toEqual({
      fileName: "ChainvizToken.sol",
      language: "solidity",
      code: "contract X {}",
    });
    expect(logs).toHaveLength(0);
  });

  it("omits source (but keeps the entry) for an entry with no source field at all", () => {
    const profileDir = writeCatalog(JSON.stringify({ Counter: { name: "Counter", abi: [] } }));
    const catalog = readContractCatalog(profileDir, () => {});
    expect(catalog?.Counter.source).toBeUndefined();
  });

  it("keeps the entry but drops a malformed source (missing code), logging the reason", () => {
    const profileDir = writeCatalog(
      JSON.stringify({
        Bad: {
          name: "Bad",
          abi: [],
          source: { fileName: "Bad.sol", language: "solidity" }, // code missing
        },
      }),
    );
    const logs: unknown[][] = [];
    const catalog = readContractCatalog(profileDir, (m, d) => logs.push([m, d]));
    expect(catalog?.Bad).toBeDefined();
    expect(catalog?.Bad.name).toBe("Bad");
    expect(catalog?.Bad.source).toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(logs[0][0]).toContain('entry "Bad"');
    expect(logs[0][0]).toContain("malformed source");
  });

  it("keeps the entry but drops a source whose fields have the wrong types", () => {
    const profileDir = writeCatalog(
      JSON.stringify({
        Bad: {
          name: "Bad",
          abi: [],
          source: { fileName: "Bad.sol", language: "solidity", code: 12345 }, // code not a string
        },
      }),
    );
    const logs: unknown[][] = [];
    const catalog = readContractCatalog(profileDir, (m, d) => logs.push([m, d]));
    expect(catalog?.Bad.source).toBeUndefined();
    expect(logs).toHaveLength(1);
  });

  it("keeps the entry but drops a source that is not an object (e.g. a string)", () => {
    const profileDir = writeCatalog(
      JSON.stringify({ Bad: { name: "Bad", abi: [], source: "not an object" } }),
    );
    const logs: unknown[][] = [];
    const catalog = readContractCatalog(profileDir, (m, d) => logs.push([m, d]));
    expect(catalog?.Bad.source).toBeUndefined();
    expect(logs).toHaveLength(1);
  });

  it("keeps the entry but drops a source missing only fileName (each field is checked individually)", () => {
    const profileDir = writeCatalog(
      JSON.stringify({
        Bad: { name: "Bad", abi: [], source: { language: "solidity", code: "contract X {}" } },
      }),
    );
    const logs: unknown[][] = [];
    const catalog = readContractCatalog(profileDir, (m, d) => logs.push([m, d]));
    expect(catalog?.Bad).toBeDefined();
    expect(catalog?.Bad.source).toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(logs[0][0]).toContain("malformed source");
  });

  it("keeps the entry but drops a source missing only language", () => {
    const profileDir = writeCatalog(
      JSON.stringify({
        Bad: { name: "Bad", abi: [], source: { fileName: "Bad.sol", code: "contract X {}" } },
      }),
    );
    const logs: unknown[][] = [];
    const catalog = readContractCatalog(profileDir, (m, d) => logs.push([m, d]));
    expect(catalog?.Bad.source).toBeUndefined();
    expect(logs).toHaveLength(1);
  });

  it("keeps the entry but drops a source whose fileName is the wrong type", () => {
    const profileDir = writeCatalog(
      JSON.stringify({
        Bad: {
          name: "Bad",
          abi: [],
          source: { fileName: 123, language: "solidity", code: "contract X {}" },
        },
      }),
    );
    const logs: unknown[][] = [];
    const catalog = readContractCatalog(profileDir, (m, d) => logs.push([m, d]));
    expect(catalog?.Bad.source).toBeUndefined();
    expect(logs).toHaveLength(1);
  });

  it("keeps the entry but drops a source whose language is the wrong type", () => {
    const profileDir = writeCatalog(
      JSON.stringify({
        Bad: {
          name: "Bad",
          abi: [],
          source: { fileName: "Bad.sol", language: 5, code: "contract X {}" },
        },
      }),
    );
    const logs: unknown[][] = [];
    const catalog = readContractCatalog(profileDir, (m, d) => logs.push([m, d]));
    expect(catalog?.Bad.source).toBeUndefined();
    expect(logs).toHaveLength(1);
  });

  it("keeps the entry but drops a null source without throwing (null is typeof object)", () => {
    // source: null は typeof === "object" だが null チェックで弾かれる。
    // Object.entries 等で落ちずに source だけ落ちることを固定する。
    const profileDir = writeCatalog(
      JSON.stringify({ Bad: { name: "Bad", abi: [], source: null } }),
    );
    const logs: unknown[][] = [];
    const catalog = readContractCatalog(profileDir, (m, d) => logs.push([m, d]));
    expect(catalog?.Bad).toBeDefined();
    expect(catalog?.Bad.source).toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(logs[0][0]).toContain("malformed source");
  });

  it("keeps the entry but drops a source that is an array (arrays are typeof object)", () => {
    const profileDir = writeCatalog(
      JSON.stringify({ Bad: { name: "Bad", abi: [], source: ["ChainvizToken.sol"] } }),
    );
    const logs: unknown[][] = [];
    const catalog = readContractCatalog(profileDir, (m, d) => logs.push([m, d]));
    expect(catalog?.Bad.source).toBeUndefined();
    expect(logs).toHaveLength(1);
  });

  it("accepts a source whose fields are all empty strings (empty is a valid string, boundary)", () => {
    // fileName/language/code が空文字でも「string である」ため source は有効。
    // 空ソース（code: ""）はフロント側で空表示として扱う正当な入力であり、
    // ここで落とさない（型検証の境界を「空文字は不正ではない」に固定する）。
    const profileDir = writeCatalog(
      JSON.stringify({ Empty: { name: "Empty", abi: [], source: { fileName: "", language: "", code: "" } } }),
    );
    const logs: unknown[][] = [];
    const catalog = readContractCatalog(profileDir, (m, d) => logs.push([m, d]));
    expect(catalog?.Empty.source).toEqual({ fileName: "", language: "", code: "" });
    expect(logs).toHaveLength(0);
  });

  it("passes source code containing newlines, tabs and Unicode through verbatim", () => {
    // ソース全文は改行・タブ・非ASCII（NatSpec の日本語コメント等）を含みうる。
    // JSON 経由でこれらが変形しないこと（表示が壊れないこと）を固定する。
    const code = "// 日本語コメント\ncontract X {\n\tuint256 public count; // café ☕\n}\n";
    const profileDir = writeCatalog(
      JSON.stringify({
        Uni: { name: "Uni", abi: [], source: { fileName: "X.sol", language: "solidity", code } },
      }),
    );
    const catalog = readContractCatalog(profileDir, () => {});
    expect(catalog?.Uni.source?.code).toBe(code);
  });

  it("passes a very long source code string through verbatim", () => {
    const code = "// line\n".repeat(5000);
    const profileDir = writeCatalog(
      JSON.stringify({
        Big: { name: "Big", abi: [], source: { fileName: "Big.sol", language: "solidity", code } },
      }),
    );
    const catalog = readContractCatalog(profileDir, () => {});
    expect(catalog?.Big.source?.code).toBe(code);
    expect(catalog?.Big.source?.code.length).toBe(code.length);
  });

  it("passes token metadata through verbatim without validating its shape", () => {
    // isValidEntry は name/abi しか検証せず token は素通しする。token の形が
    // 想定外（decimals 欠落など）でもエントリ自体は生き残り、そのまま
    // ContractEntity.token へ渡る。この「token は未検証で通る」現状を固定して
    // おき、将来 token 検証を追加したときに気付けるようにする。
    const profileDir = writeCatalog(
      JSON.stringify({
        Tok: { name: "Tok", abi: [], token: { symbol: "ONLY_SYMBOL" } },
      }),
    );
    const catalog = readContractCatalog(profileDir, () => {});
    expect(catalog?.Tok.token).toEqual({ symbol: "ONLY_SYMBOL" });
  });
});
