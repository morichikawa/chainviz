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
});
