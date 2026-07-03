import type { Localized } from "../i18n/messages.js";

/**
 * 用語1件。glossary/<chain>/terms/*.yaml の1エントリに対応する
 * （docs/ARCHITECTURE.md §5）。`key` は YAML のマッピングキーを取り込んだもの。
 */
export interface GlossaryTerm {
  key: string;
  name: Localized;
  definition: Localized;
  layer: string;
  relatedTerms: string[];
}

/** 用語キー -> 用語 の索引。 */
export type Glossary = Record<string, GlossaryTerm>;
