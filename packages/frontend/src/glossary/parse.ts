import yaml from "js-yaml";
import { LANGUAGES, type Localized } from "../i18n/messages.js";
import type { Glossary, GlossaryTerm } from "./types.js";

function toLocalized(value: unknown): Localized | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const result = {} as Localized;
  for (const lang of LANGUAGES) {
    const text = record[lang];
    if (typeof text !== "string") return null;
    result[lang] = text.trim();
  }
  return result;
}

function toTerm(key: string, value: unknown): GlossaryTerm | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;

  const name = toLocalized(record.name);
  const definition = toLocalized(record.definition);
  if (!name || !definition) return null;

  const layer = typeof record.layer === "string" ? record.layer : "";

  const relatedTerms = Array.isArray(record.relatedTerms)
    ? record.relatedTerms.filter((t): t is string => typeof t === "string")
    : [];

  return { key, name, definition, layer, relatedTerms };
}

/**
 * 用語 YAML テキストを Glossary に変換する。name/definition が `{ja, en}`
 * 揃っていないエントリは読み飛ばす（壊れた1件で全体が落ちないように）。
 * 入力が空・非オブジェクトなら空の Glossary を返す。
 *
 * `glossary` は `Object.create(null)` で構築する（`Object.prototype` を
 * 継承しない）。素のオブジェクトリテラル（`{}`）は `__proto__` という
 * 名前のアクセサ（Annex B）を継承しており、YAML のマッピングキーが
 * たまたま `"__proto__"` だった場合に `glossary["__proto__"] = term` が
 * 「`__proto__` という own property を作る」のではなく `glossary` 自身の
 * `[[Prototype]]` を書き換えてしまう（プロトタイプ汚染。Issue #264 で
 * 素朴な再現スクリプトにより確認済み）。`Object.create(null)` にはこの
 * アクセサ自体が存在しないため、`"__proto__"` は通常の own property として
 * 扱われる。
 */
export function parseGlossaryYaml(text: string): Glossary {
  const doc = yaml.load(text);
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return Object.create(null) as Glossary;
  }

  const glossary: Glossary = Object.create(null) as Glossary;
  for (const [key, value] of Object.entries(doc as Record<string, unknown>)) {
    const term = toTerm(key, value);
    if (term) glossary[key] = term;
  }
  return glossary;
}

/**
 * 複数の用語 YAML をマージして1つの Glossary にする。マージ先も
 * `Object.create(null)` にする（`parseGlossaryYaml` と同じ理由。合成元の
 * いずれかが `"__proto__"` という own property を持つケースで、
 * `Object.assign` の書き込み先が素のオブジェクトリテラルのままだと、
 * そちら側で同じ `[[Prototype]]` 書き換えの罠を踏んでしまうため）。
 */
export function mergeGlossaries(...parts: Glossary[]): Glossary {
  return Object.assign(Object.create(null) as Glossary, ...parts) as Glossary;
}
