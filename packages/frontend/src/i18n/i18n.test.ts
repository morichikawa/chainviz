import { describe, expect, it } from "vitest";
import {
  LANGUAGE_STORAGE_KEY,
  type LanguageStorage,
  isLanguage,
  loadLanguage,
  nextLanguage,
  pickLocale,
  saveLanguage,
  translate,
} from "./i18n.js";

function memoryStorage(initial: Record<string, string> = {}): LanguageStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe("isLanguage", () => {
  it("accepts supported languages and rejects others", () => {
    expect(isLanguage("ja")).toBe(true);
    expect(isLanguage("en")).toBe(true);
    expect(isLanguage("fr")).toBe(false);
    expect(isLanguage(null)).toBe(false);
    expect(isLanguage(123)).toBe(false);
  });
});

describe("pickLocale", () => {
  it("returns the value for the requested language", () => {
    expect(pickLocale({ ja: "こんにちは", en: "hello" }, "en")).toBe("hello");
  });

  it("falls back to the default language when a value is missing", () => {
    expect(pickLocale({ ja: "こんにちは" }, "en")).toBe("こんにちは");
  });

  it("returns an empty string for undefined input", () => {
    expect(pickLocale(undefined, "ja")).toBe("");
  });

  it("returns the requested language even when the default is missing", () => {
    expect(pickLocale({ en: "hello" }, "en")).toBe("hello");
  });

  it("returns an empty string when neither the language nor the default exists", () => {
    expect(pickLocale({} as never, "en")).toBe("");
  });

  it("falls back to the default language when the requested value is empty", () => {
    expect(pickLocale({ ja: "こんにちは", en: "" }, "en")).toBe("こんにちは");
  });

  it("returns an empty string when both the language and default are empty", () => {
    expect(pickLocale({ ja: "", en: "" }, "en")).toBe("");
  });
});

describe("translate", () => {
  it("looks up UI strings by language", () => {
    expect(translate("card.node", "ja")).toBe("ノード");
    expect(translate("card.node", "en")).toBe("Node");
  });

  it("returns the key itself for an unknown message key", () => {
    expect(translate("does.not.exist" as never, "ja")).toBe("does.not.exist");
  });
});

describe("loadLanguage / saveLanguage", () => {
  it("defaults to Japanese when unset or invalid", () => {
    expect(loadLanguage(memoryStorage())).toBe("ja");
    expect(
      loadLanguage(memoryStorage({ [LANGUAGE_STORAGE_KEY]: "zz" })),
    ).toBe("ja");
  });

  it("round-trips a saved language", () => {
    const storage = memoryStorage();
    saveLanguage(storage, "en");
    expect(loadLanguage(storage)).toBe("en");
  });
});

describe("nextLanguage", () => {
  it("toggles between the two supported languages", () => {
    expect(nextLanguage("ja")).toBe("en");
    expect(nextLanguage("en")).toBe("ja");
  });
});
