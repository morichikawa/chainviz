// 「data-testid の前方一致ロケータ」が意図しない要素にも当たっていないかを
// 静的に判定するための純粋関数群（Issue #428 の再発防止）。
//
// UI 層テストは動的な id（`block-detail-prev-<hash>`, `chain-ribbon-tile-<hash>`
// など）を掴むために `[data-testid^="..."]` の前方一致ロケータを使う。ところが
// frontend 側に同じ接頭辞で始まる**固定**の data-testid（例:
// `block-detail-prev-reason`）が別要素として存在すると、前方一致は複数要素に
// マッチし、Playwright の strict mode 違反で実行時に落ちる。
//
// この衝突は「その固定 testid を持つ要素が描画される状態」でしか再現しない
// （`block-detail-prev-reason` は prev が disabled のときだけ描画される）ため、
// ハッピーパスのテストだけでは見逃されやすい。実際 Issue #428 では、同型の
// ヘルパーが2ファイルにあり、片方だけが実機で顕在化した。UI 層 E2E は
// pre-push（`pnpm test`）では走らないので、Docker 非依存のユニットテストとして
// 構造的に検知できるようにしておく。

/** spec 中に現れた前方一致ロケータ1件。 */
export interface PrefixLocator {
  /** `[data-testid^="..."]` の接頭辞。 */
  prefix: string;
  /**
   * ロケータが要素名で絞られている場合のタグ名（`button[data-testid^="..."]`
   * なら `"button"`）。絞っていなければ `null`。
   */
  tag: string | null;
}

/** frontend 側に書かれた固定（テンプレートリテラルでない）の data-testid 1件。 */
export interface StaticTestId {
  /** data-testid の値。 */
  value: string;
  /**
   * その属性を持つ要素のタグ名（直前の `<tag` から求める）。JSX
   * コンポーネント（大文字始まり）など判別できない場合も、書かれている
   * ままの名前を入れる。
   */
  tag: string;
}

/** 前方一致ロケータと固定 testid の衝突1件。 */
export interface AmbiguousPrefixLocator extends PrefixLocator {
  /** 意図せず一緒にマッチしうる固定 testid の一覧。 */
  collidingTestIds: string[];
}

/**
 * コメント（`//` 行コメント・`/* *\/` ブロックコメント）を同じ長さの空白へ
 * 置き換える。文字列・テンプレートリテラルの中身は対象外にする。
 *
 * 「やってはいけないロケータ」を注意書きとしてコメントに書くこと自体は
 * 正しいドキュメントなので、検査対象から外す必要がある。一方で単純に
 * `//` 以降を削るだけだと `"http://..."` のような文字列リテラルを巻き込み、
 * 同じ行にある本物のロケータを見落としかねない。そのため引用符の状態を
 * 追いながら削る。長さを保つため空白で置き換える（抽出側が使う index が
 * 元ソースと一致する）。
 */
export function stripComments(source: string): string {
  const out = source.split("");
  let quote: '"' | "'" | "`" | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i] ?? "";
    const next = source[i + 1] ?? "";

    if (inLineComment) {
      if (char === "\n") inLineComment = false;
      else out[i] = " ";
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        i++;
        inBlockComment = false;
      } else if (char !== "\n") {
        out[i] = " ";
      }
      continue;
    }
    if (quote !== null) {
      if (char === "\\") i++; // エスケープされた次の1文字は状態を変えない
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "/") {
      out[i] = " ";
      out[i + 1] = " ";
      i++;
      inLineComment = true;
      continue;
    }
    if (char === "/" && next === "*") {
      out[i] = " ";
      out[i + 1] = " ";
      i++;
      inBlockComment = true;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
  }

  return out.join("");
}

/**
 * `[data-testid^="..."]` 形式のロケータを抽出する。直前にタグ名が書かれて
 * いれば要素名で絞られているとみなす。コメント中の記述は対象外。
 */
export function extractPrefixLocators(source: string): PrefixLocator[] {
  const pattern = /([A-Za-z][A-Za-z0-9-]*)?\[data-testid\^="([^"]+)"\]/g;
  const found: PrefixLocator[] = [];
  for (const match of stripComments(source).matchAll(pattern)) {
    found.push({ prefix: match[2] ?? "", tag: match[1] ?? null });
  }
  return found;
}

/**
 * `data-testid="固定値"` 形式（テンプレートリテラルでないもの）を、その要素の
 * タグ名とともに抽出する。
 *
 * `data-testid={`...${x}`}` のような動的採番は前方一致ロケータが狙って掴む
 * 相手そのものなので、衝突の対象から除く。コメント中の記述も対象外。
 */
export function extractStaticTestIds(source: string): StaticTestId[] {
  const pattern = /data-testid="([^"]*)"/g;
  const stripped = stripComments(source);
  const found: StaticTestId[] = [];
  for (const match of stripped.matchAll(pattern)) {
    const value = match[1] ?? "";
    if (value === "") continue;
    const before = stripped.slice(0, match.index);
    // 属性は開始タグの内側にあるので、直前の `<tag` を要素名とみなす。
    const tagMatch = before.match(/<([A-Za-z][A-Za-z0-9.]*)[^<]*$/);
    found.push({ value, tag: tagMatch?.[1] ?? "" });
  }
  return found;
}

/**
 * 前方一致ロケータのうち、固定 testid と衝突しうるものを返す。
 *
 * - 要素名で絞っていないロケータは、同じ接頭辞の固定 testid が1つでもあれば
 *   衝突とみなす（どの要素であってもまとめてマッチしてしまうため）。
 * - 要素名で絞っているロケータは、同じ接頭辞かつ**同じタグ**の固定 testid が
 *   ある場合のみ衝突とみなす（`button[...]` は `<p>` の理由文を拾わない）。
 */
export function findAmbiguousPrefixLocators(
  locators: readonly PrefixLocator[],
  staticTestIds: readonly StaticTestId[],
): AmbiguousPrefixLocator[] {
  const ambiguous: AmbiguousPrefixLocator[] = [];
  for (const locator of locators) {
    const colliding = staticTestIds
      .filter(
        (testId) =>
          testId.value.startsWith(locator.prefix) &&
          (locator.tag === null || locator.tag === testId.tag),
      )
      .map((testId) => testId.value);
    if (colliding.length > 0) {
      ambiguous.push({ ...locator, collidingTestIds: [...new Set(colliding)].sort() });
    }
  }
  return ambiguous;
}
