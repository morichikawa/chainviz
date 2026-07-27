import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Issue #427 の一般化ガード（横断チェック）。
 *
 * `font: inherit` などの `font` ショートハンドは `font-size` を含む全サブ
 * プロパティを一括で上書きする。ある要素が「`font` ショートハンドを持つ
 * クラス」と「`font-size` を宣言するクラス」を同時に付けていると、CSS の
 * カスケード（同じ詳細度なら後に書かれた方が勝つ）次第で font-size が
 * 意図せず消える。Issue #427 はまさにこの形
 * （`.block-detail-view__parent-link`(font: inherit) と
 * `.infra-field`(font-size: 12px) の併用）で起きた。
 *
 * 単一クラスだけを見る回帰テスト（blockDetailParentLinkFont.css.test.ts）は
 * 同じ間違いが別のクラスで再発したときに検出できない。ここでは styles.css
 * とすべての TSX/TS ソースを突き合わせ、「同じ要素に付く静的クラスの組
 * 合わせ」の全件について同種の衝突が無いことを確認する。
 *
 * 検出漏れの範囲（意図的な割り切り）:
 * - `className` に文字列リテラル / テンプレートリテラルで直接書かれた
 *   静的なクラス名のみを対象にする。`${}` 補間部分は除外する
 *   （動的に付くバリアント修飾クラスは font-size を持たない運用のため）。
 * - CSS 側は単純なフラットルールのみを解析する（このプロジェクトの
 *   styles.css はネスト記法を使っていない）。
 */
function findFrontendSrc(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    for (const candidate of [resolve(dir, "packages/frontend/src"), resolve(dir, "src")]) {
      if (existsSync(join(candidate, "styles.css"))) return candidate;
    }
    dir = dirname(dir);
  }
  throw new Error("packages/frontend/src not found from cwd");
}

const srcDir = findFrontendSrc();
const css = readFileSync(join(srcDir, "styles.css"), "utf8");

/** styles.css を (セレクタ, 宣言ブロック本文) の一覧に分解する。 */
function parseRules(source: string): { selector: string; body: string }[] {
  const rules: { selector: string; body: string }[] = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = ruleRe.exec(source)) !== null) {
    rules.push({ selector: match[1].trim(), body: match[2] });
  }
  return rules;
}

/**
 * `font` ショートハンドを宣言するクラス名と、`font-size` を宣言する
 * クラス名をそれぞれ集める。`font-family` / `font-weight` などの
 * ロングハンドは `font\s*:` にマッチしない（直前が `-` のため）。
 */
function collectFontClasses(source: string): { shorthand: Set<string>; fontSize: Set<string> } {
  const shorthand = new Set<string>();
  const fontSize = new Set<string>();
  for (const rule of parseRules(source)) {
    const classes = [...rule.selector.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
    if (/(^|[;\s])font\s*:/.test(rule.body)) for (const c of classes) shorthand.add(c);
    if (/(^|[;\s])font-size\s*:/.test(rule.body)) for (const c of classes) fontSize.add(c);
  }
  return { shorthand, fontSize };
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...listSourceFiles(path));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

/** 1つの要素に同時に付く静的クラス名の組（2個以上のものだけ）を集める。 */
function collectClassCombos(dir: string): { file: string; tokens: string[] }[] {
  const combos: { file: string; tokens: string[] }[] = [];
  for (const file of listSourceFiles(dir)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const raw = match[1] ?? match[2] ?? "";
      const tokens = raw
        .replace(/\$\{[^}]*\}/g, " ") // 動的補間部分は静的に解決できないため除外
        .split(/\s+/)
        .filter(Boolean);
      if (tokens.length > 1) combos.push({ file: file.slice(dir.length + 1), tokens });
    }
  }
  return combos;
}

/** `font` ショートハンドと `font-size` を同一要素上で衝突させている箇所を列挙する。 */
function findCollisions(source: string): string[] {
  const { shorthand, fontSize } = collectFontClasses(source);
  const collisions: string[] = [];
  for (const { file, tokens } of collectClassCombos(srcDir)) {
    for (const token of tokens) {
      if (!shorthand.has(token)) continue;
      for (const other of tokens) {
        if (other !== token && fontSize.has(other)) {
          collisions.push(`${file}: .${token} (font shorthand) + .${other} (font-size)`);
        }
      }
    }
  }
  return collisions;
}

describe("font shorthand vs font-size collisions across styles.css (Issue #427 generalized)", () => {
  it("finds the classes that use the `font` shorthand at all (guards the detector itself)", () => {
    // 解析が空振りしていないことの確認。ショートハンドを使うクラスが
    // 1つも見つからない状態でテストが緑になってしまうのを防ぐ。
    const { shorthand, fontSize } = collectFontClasses(css);
    expect(shorthand.size).toBeGreaterThan(0);
    expect(fontSize.size).toBeGreaterThan(0);
  });

  it("collects multi-class className combinations from the sources (guards the detector itself)", () => {
    expect(collectClassCombos(srcDir).length).toBeGreaterThan(0);
  });

  it("has no element combining a `font` shorthand class with a font-size class", () => {
    expect(findCollisions(css)).toEqual([]);
  });

  it("detects the Issue #427 combination when the original declaration is restored", () => {
    // 検出器が本当に元の不具合を捕まえられることを、修正前の CSS を
    // 組み立てて確認する（CLAUDE.md「回帰テストが元の不具合を検出できる
    // ことを確認する」）。
    const brokenCss = css.replace(
      /(\.block-detail-view__parent-link\s*\{[^}]*?)font-family:\s*inherit;/,
      "$1font: inherit;",
    );
    expect(brokenCss).not.toBe(css); // 置換が空振りしていないこと
    expect(findCollisions(brokenCss)).toEqual([
      "side-panel/BlockDetailView.tsx: .block-detail-view__parent-link (font shorthand) + .infra-field (font-size)",
    ]);
  });

  it("keeps the remaining `font: inherit` button resets on elements that carry no font-size class", () => {
    // `.contract-list-panel__row` / `.mempool-panel__row` /
    // `.mempool-panel__node-row` は `font: inherit` を使い続けているが、
    // これらは単独クラスで使われ、font-size は親（`.contract-list-panel`
    // / `.mempool-panel` の 11px）から継承する設計なので Issue #427 とは
    // 別物。この前提（親側が font-size を持つこと）が崩れると素の
    // ブラウザ既定サイズに落ちるため、ここで固定しておく。
    //
    // 新しく `font` ショートハンドを使うボタン化リセットを足すときは、
    // 「その要素が font-size を宣言する別クラスと併用されないか」を
    // 確認したうえでこのリストに追加する（Issue #427 の再発防止として、
    // 追加を無自覚に素通りさせないため意図的に列挙している）。
    const { shorthand, fontSize } = collectFontClasses(css);
    for (const cls of shorthand) {
      expect(fontSize.has(cls)).toBe(false); // 自分自身では font-size を宣言しない
    }
    expect([...shorthand].sort()).toEqual([
      "contract-list-panel__row",
      "mempool-panel__node-row",
      "mempool-panel__row",
    ]);
    for (const parent of ["contract-list-panel", "mempool-panel"]) {
      expect(fontSize.has(parent)).toBe(true);
    }
  });
});
