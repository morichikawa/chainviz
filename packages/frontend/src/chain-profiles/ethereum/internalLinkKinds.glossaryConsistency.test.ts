// Issue #420 テスト強化: 内部リンクの「活動セクションを表示するか」
// （`showsActivity`）と、見出しに紐づく用語集の定義文の主張が食い違わないことを
// 固定する。
//
// Issue #285 の時点では beacon-api の定義文に「呼び出しの観測経路が無いため
// パルスは流れない」と書かれており、Issue #420 で観測経路を新設したのに
// 合わせて定義文も書き換えた。コード（showsActivity）と用語集（説明文）は
// 別ファイルなので、片方だけ戻ると「パルスが流れているのに『流れない』と
// 説明する」矛盾が静かに残る。その組み合わせをテストで縛る。
//
// 用語 YAML の読み方は glossaryRelatedTermsIntegrity.test.ts と同じ
// （cwd から repo ルートの glossary/ を探して直接読む）。

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGlossaryYaml } from "../../glossary/parse.js";
import { describeInternalLinkKind } from "./internalLinkKinds.js";

function findGlossaryFile(relativePath: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, relativePath);
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error(`${relativePath} not found from cwd`);
}

const dInternal = parseGlossaryYaml(
  readFileSync(findGlossaryFile("glossary/ethereum/terms/d-internal.yaml"), "utf8"),
);

describe("internal link kinds vs. glossary definitions (Issue #420)", () => {
  it("has a glossary entry for every heading anchor used by a known role pair", () => {
    for (const pair of [
      ["consensus", "execution"],
      ["validator", "consensus"],
    ] as const) {
      const key = describeInternalLinkKind(pair[0], pair[1]).headingGlossaryKey;
      expect(key).toBeDefined();
      expect(dInternal[key as string]).toBeDefined();
    }
  });

  it("describes pulses in the beacon-api definition now that validator activity is observed", () => {
    const kind = describeInternalLinkKind("validator", "consensus");
    expect(kind.showsActivity).toBe(true);
    const term = dInternal["beacon-api"];
    // 活動セクションを出す（パルスが流れる）以上、定義文も「流れる」側で
    // 書かれていること。逆に showsActivity を false へ戻すなら定義文も
    // 戻す必要がある。
    expect(term.definition.ja).toContain("パルス");
    expect(term.definition.ja).not.toContain("パルスは流れない");
    expect(term.definition.en.toLowerCase()).toContain("pulse");
    expect(term.definition.en.toLowerCase()).not.toContain("no pulses");
    expect(term.definition.en.toLowerCase()).not.toContain("no observed call activity");
  });

  it("keeps the engine-api definition consistent with its own activity section", () => {
    const kind = describeInternalLinkKind("consensus", "execution");
    expect(kind.showsActivity).toBe(true);
    const term = dInternal["engine-api"];
    expect(term.definition.ja).toContain("パルス");
    expect(term.definition.en.toLowerCase()).toContain("pulse");
  });

  it("keeps the beacon-api definition bilingual and non-empty after the rewrite", () => {
    const term = dInternal["beacon-api"];
    expect(term.definition.ja.trim().length).toBeGreaterThan(0);
    expect(term.definition.en.trim().length).toBeGreaterThan(0);
    expect(term.layer).toBe("d-internal");
    // 見出し・関連語のリンクは Issue #285 のまま維持されていること。
    expect(term.relatedTerms).toContain("validator");
    expect(term.relatedTerms).toContain("engine-api");
  });
});
