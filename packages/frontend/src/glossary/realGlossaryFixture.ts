// テスト専用の支援モジュール（アプリ本体からは import しない）。repo ルートの
// 用語 YAML（`glossary/ethereum/terms/*.yaml`）を実ファイルとして読み、
// パース済みの Glossary を返す。
//
// アプリ本体は `data.ts` が Vite の `?raw` インポートで同じ4ファイルを読むが、
// テストは Vite のエイリアス解決に依存せず `parse.ts` を直接叩く（既存の
// parse.test.ts / glossaryRelatedTermsIntegrity.test.ts と同じ流儀）。同じ
// 読み込みコードを複数のテストファイルへ書き写すのを避けるためここへ集約した
// （Issue #413 テスト強化で用語データ側のテストが4ファイルに増えたため）。
//
// ファイル単位の Glossary も返せるようにしている: 「どの YAML に定義されて
// いるか」「`layer` の値と定義ファイルが食い違っていないか」「同じキーが複数
// ファイルに重複定義されていないか」といったマージ前でしか検証できない
// 不変条件のため。
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mergeGlossaries, parseGlossaryYaml } from "./parse.js";
import type { Glossary } from "./types.js";

/** 用語 YAML のファイル名（= `data.ts` が読む4ファイルと同じ並び）。 */
export const GLOSSARY_FILE_NAMES = [
  "a-infra",
  "b-network",
  "c-transaction",
  "d-internal",
] as const;

export type GlossaryFileName = (typeof GLOSSARY_FILE_NAMES)[number];

/**
 * cwd（vitest はパッケージ直下で走る）から親方向へ辿って repo ルートの
 * ファイルを探す。パッケージ直下・repo ルートのどちらから実行されても
 * 同じファイルに解決できるようにするため（既存テストと同じ実装）。
 */
function findRepoFile(relativePath: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, relativePath);
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error(`${relativePath} not found from cwd`);
}

/** 用語 YAML 1ファイルを読んでパースする。 */
export function loadGlossaryFile(name: GlossaryFileName): Glossary {
  return parseGlossaryYaml(
    readFileSync(findRepoFile(`glossary/ethereum/terms/${name}.yaml`), "utf8"),
  );
}

/** 4ファイルを個別にパースした結果（ファイル名 → Glossary）。 */
export function loadGlossaryFiles(): Record<GlossaryFileName, Glossary> {
  const result = {} as Record<GlossaryFileName, Glossary>;
  for (const name of GLOSSARY_FILE_NAMES) {
    result[name] = loadGlossaryFile(name);
  }
  return result;
}

/** 4ファイルをマージした、アプリが実際に使うのと同じ内容の Glossary。 */
export function loadRealGlossary(): Glossary {
  return mergeGlossaries(...GLOSSARY_FILE_NAMES.map((name) => loadGlossaryFile(name)));
}
