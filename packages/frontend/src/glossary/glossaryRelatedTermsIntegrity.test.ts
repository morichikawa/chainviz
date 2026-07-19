// Issue #406 テスト強化: 実際の用語 YAML 4ファイルをマージした全用語集に対し、
// relatedTerms の参照整合性を固定する。
//
// - どの用語の relatedTerms も、存在する用語キーだけを指す（dangling 参照ゼロ）
// - どの用語も自分自身を relatedTerms に含めない（無意味な自己参照ゼロ）
// - 新設した keccak256 エントリがスキーマ（layer・{ja,en}）を満たす
// - keccak256 と hash / signature の相互リンクが双方向に張られている
//
// data.ts は Vite の `?raw` インポートで4ファイルを読むが、テストからは
// parse.test.ts と同じく cwd から repo ルートの glossary/ を探して直接読む。
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mergeGlossaries, parseGlossaryYaml } from "./parse.js";
import type { Glossary } from "./types.js";

function findGlossaryFile(relativePath: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, relativePath);
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error(`${relativePath} not found from cwd`);
}

function loadMergedGlossary(): Glossary {
  const names = ["a-infra", "b-network", "c-transaction", "d-internal"];
  return mergeGlossaries(
    ...names.map((name) =>
      parseGlossaryYaml(
        readFileSync(findGlossaryFile(`glossary/ethereum/terms/${name}.yaml`), "utf8"),
      ),
    ),
  );
}

const glossary = loadMergedGlossary();
const keys = new Set(Object.keys(glossary));

describe("glossary relatedTerms integrity (all real files merged)", () => {
  it("every relatedTerms reference points to an existing term key (no dangling links)", () => {
    const dangling: string[] = [];
    for (const term of Object.values(glossary)) {
      for (const related of term.relatedTerms) {
        if (!keys.has(related)) dangling.push(`${term.key} -> ${related}`);
      }
    }
    expect(dangling).toEqual([]);
  });

  it("no term lists itself in relatedTerms", () => {
    const selfRefs: string[] = [];
    for (const term of Object.values(glossary)) {
      if (term.relatedTerms.includes(term.key)) selfRefs.push(term.key);
    }
    expect(selfRefs).toEqual([]);
  });
});

describe("keccak256 term entry (Issue #406)", () => {
  it("exists and matches the expected schema (layer + non-empty {ja,en})", () => {
    const entry = glossary.keccak256;
    expect(entry).toBeTruthy();
    expect(entry.layer).toBe("c-transaction");
    expect(entry.name.ja.length).toBeGreaterThan(0);
    expect(entry.name.en.length).toBeGreaterThan(0);
    expect(entry.definition.ja.length).toBeGreaterThan(0);
    expect(entry.definition.en.length).toBeGreaterThan(0);
    // ja と en が同一（訳し忘れ）でないこと。
    expect(entry.definition.ja).not.toBe(entry.definition.en);
  });

  it("lists hash, signature and block as related terms", () => {
    expect(glossary.keccak256.relatedTerms).toEqual(
      expect.arrayContaining(["hash", "signature", "block"]),
    );
  });
});

describe("keccak256 mutual links (relatedTerms are bidirectional)", () => {
  it("hash links to keccak256 and keccak256 links back to hash", () => {
    expect(glossary.hash.relatedTerms).toContain("keccak256");
    expect(glossary.keccak256.relatedTerms).toContain("hash");
  });

  it("signature links to keccak256 and keccak256 links back to signature", () => {
    expect(glossary.signature.relatedTerms).toContain("keccak256");
    expect(glossary.keccak256.relatedTerms).toContain("signature");
  });
});
