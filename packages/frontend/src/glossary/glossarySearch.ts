import type { VisualizationLayer } from "../entities/canvasLayers.js";
import { pickLocale } from "../i18n/i18n.js";
import type { Language } from "../i18n/messages.js";
import type { Glossary, GlossaryTerm } from "./types.js";

/**
 * 用語集パネル（Issue #313。`docs/worklog/issue-313.md` §3.3）向けの純粋関数。
 * 検索・層グループ化のロジックだけをここに切り出し、`GlossaryPanelView.tsx`
 * は表示に専念する（CLAUDE.md「1ファイル1責務」）。
 */

/** 層グループ化の結果として使うキー。対応しない `layer` 値・空文字は "other"。 */
export type GlossaryLayerGroupKey = VisualizationLayer | "other";

export interface GlossaryLayerGroup {
  layer: GlossaryLayerGroupKey;
  terms: GlossaryTerm[];
}

const VISUALIZATION_LAYERS: readonly VisualizationLayer[] = ["a", "b", "c", "d"];
const GROUP_ORDER: readonly GlossaryLayerGroupKey[] = [...VISUALIZATION_LAYERS, "other"];

/**
 * `GlossaryTerm.layer`（`a-infra` 等の chain profile 表記）から、
 * レイヤーレンズ（`entities/canvasLayers.ts`）と語彙を揃えた
 * `VisualizationLayer` を導く。先頭1文字が a〜d のいずれとも一致しない値
 * （未知の値・空文字）は "other" に落とす（UX設計 §3.3 の判定）。
 */
export function resolveGlossaryLayerGroupKey(rawLayer: string): GlossaryLayerGroupKey {
  const prefix = rawLayer.charAt(0).toLowerCase();
  return (VISUALIZATION_LAYERS as readonly string[]).includes(prefix)
    ? (prefix as VisualizationLayer)
    : "other";
}

/**
 * `Glossary`（YAML マッピングキー → 用語の索引）を、YAML に書かれた記載順の
 * 配列に変換する。`parse.ts`/`data.ts` は `Object.create(null)` +
 * 挿入順どおりの代入でオブジェクトを組み立てているため、`Object.values` は
 * 学習順（基礎概念 → 発展）のまま並ぶ（UX設計 §3.3「グループ内の並びは
 * YAML の記載順を維持する」の前提）。
 */
export function glossaryToOrderedTerms(glossary: Glossary): GlossaryTerm[] {
  return Object.values(glossary);
}

/**
 * 用語が検索クエリに一致するか（UX設計 §3.6）。一致対象は用語名（ja/en
 * 両方）・用語キー・現在言語の定義文。大文字小文字を無視した部分一致のみで、
 * スコアリング・あいまい一致はしない（37語に対して過剰なため）。空クエリは
 * 常に一致（全件表示）。
 */
export function matchesGlossaryQuery(
  term: GlossaryTerm,
  query: string,
  lang: Language,
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery === "") return true;

  const haystacks = [term.name.ja, term.name.en, term.key, pickLocale(term.definition, lang)];
  return haystacks.some((text) => text.toLowerCase().includes(normalizedQuery));
}

/** `matchesGlossaryQuery` で絞り込んだ結果（元の並び順を維持する）。 */
export function filterGlossaryTerms(
  terms: readonly GlossaryTerm[],
  query: string,
  lang: Language,
): GlossaryTerm[] {
  return terms.filter((term) => matchesGlossaryQuery(term, query, lang));
}

/**
 * 用語の配列を層（A〜D + その他）でグループ化する。グループの並びは常に
 * a → b → c → d → other、グループ内の並びは入力配列の並びを維持する。
 * 該当する用語が1件も無い層はグループごと出さない（UX設計 §3.6「一致が
 * 無いグループは見出しごと隠す」）。
 */
export function groupGlossaryTermsByLayer(
  terms: readonly GlossaryTerm[],
): GlossaryLayerGroup[] {
  const buckets = new Map<GlossaryLayerGroupKey, GlossaryTerm[]>();
  for (const term of terms) {
    const key = resolveGlossaryLayerGroupKey(term.layer);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(term);
    } else {
      buckets.set(key, [term]);
    }
  }
  return GROUP_ORDER.filter((key) => buckets.has(key)).map((key) => ({
    layer: key,
    // GROUP_ORDER.filter(buckets.has) で存在確認済みのため非 null アサーションで問題ない。
    terms: buckets.get(key) as GlossaryTerm[],
  }));
}
