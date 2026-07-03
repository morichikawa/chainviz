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
 */
export function parseGlossaryYaml(text: string): Glossary {
  const doc = yaml.load(text);
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return {};
  }

  const glossary: Glossary = {};
  for (const [key, value] of Object.entries(doc as Record<string, unknown>)) {
    const term = toTerm(key, value);
    if (term) glossary[key] = term;
  }
  return glossary;
}

/** 複数の用語 YAML をマージして1つの Glossary にする。 */
export function mergeGlossaries(...parts: Glossary[]): Glossary {
  return Object.assign({}, ...parts) as Glossary;
}
