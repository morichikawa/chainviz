import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  type Language,
  type Localized,
  type MessageKey,
  messages,
} from "./messages.js";

export type { Language, Localized, MessageKey } from "./messages.js";

export const LANGUAGE_STORAGE_KEY = "chainviz.lang";

export interface LanguageStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 任意の値が対応言語かどうか判定する。 */
export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as string[]).includes(value);
}

/**
 * `{ja, en}` 形式のテキストから現在の言語の文字列を取り出す。
 * 対象言語の値が空/未定義ならデフォルト言語へフォールバックする。
 */
export function pickLocale(
  localized: Partial<Localized> | undefined,
  lang: Language,
): string {
  if (!localized) return "";
  // 空文字も「値なし」として扱いデフォルト言語へフォールバックする。
  // glossary の parse 側はトリムのみで空文字を弾かないため、空文字翻訳が
  // 入りうる（i18n.ts の docstring と挙動を一致させる）。
  const value = localized[lang];
  if (value !== undefined && value !== "") return value;
  return localized[DEFAULT_LANGUAGE] ?? "";
}

/** UI 文言を現在の言語で引く。未知キーはキー文字列をそのまま返す。 */
export function translate(key: MessageKey, lang: Language): string {
  const entry = messages[key] as Localized | undefined;
  if (!entry) return key;
  return pickLocale(entry, lang);
}

/** 保存済みの UI 言語を読み込む。未保存・不正値はデフォルト言語。 */
export function loadLanguage(storage: LanguageStorage): Language {
  const raw = storage.getItem(LANGUAGE_STORAGE_KEY);
  return isLanguage(raw) ? raw : DEFAULT_LANGUAGE;
}

/** UI 言語を保存する。 */
export function saveLanguage(storage: LanguageStorage, lang: Language): void {
  storage.setItem(LANGUAGE_STORAGE_KEY, lang);
}

/** 2言語間のトグル先を返す（画面隅の切り替えボタン用）。 */
export function nextLanguage(lang: Language): Language {
  return lang === "ja" ? "en" : "ja";
}
