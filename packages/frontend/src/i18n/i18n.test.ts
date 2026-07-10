import { describe, expect, it } from "vitest";
import {
  LANGUAGE_STORAGE_KEY,
  type LanguageStorage,
  format,
  isLanguage,
  loadLanguage,
  nextLanguage,
  pickLocale,
  saveLanguage,
  translate,
} from "./i18n.js";
import { messages } from "./messages.js";

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
    expect(loadLanguage(memoryStorage({ [LANGUAGE_STORAGE_KEY]: "zz" }))).toBe(
      "ja",
    );
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

describe("contract card message keys (Issue #165)", () => {
  const contractKeys = [
    "card.contract",
    "contract.unknown",
    "contract.badge.everyNode",
    "contract.badge.uncataloged",
    "contract.popover.description",
    "contract.popover.unknownDescription",
    "field.deployer",
    "field.createdByTx",
    "field.token",
    "edge.deployedBy",
  ] as const;

  it.each(contractKeys)(
    "has non-empty ja and en translations for %s",
    (key) => {
      const entry = messages[key];
      expect(entry.ja.length).toBeGreaterThan(0);
      expect(entry.en.length).toBeGreaterThan(0);
      // 訳し忘れ（ja と en が同一）を検出する。テンプレート文だけ許容する。
      if (key !== "edge.deployedBy") {
        expect(entry.ja).not.toBe(entry.en);
      }
    },
  );

  it("keeps the {address} placeholder in both languages of edge.deployedBy", () => {
    // format() で埋め込む {address} プレースホルダが両言語に残っていること。
    expect(messages["edge.deployedBy"].ja).toContain("{address}");
    expect(messages["edge.deployedBy"].en).toContain("{address}");
  });
});

describe("operation panel message keys (Issue #167)", () => {
  // OperationPanel / 各フォーム / InfraNodeCard / commandMessages が実際に
  // 参照している操作パネル関連キー。訳し忘れ・未定義の回帰ガード。
  const usedOperationKeys = [
    "action.workbenchOperations",
    "action.workbenchOperations.hint",
    "action.workbenchOperations.hint.generic",
    "operation.tab.transfer",
    "operation.tab.deploy",
    "operation.tab.call",
    "operation.transfer.description",
    "operation.transfer.to",
    "operation.transfer.amount",
    "operation.transfer.amount.invalid",
    "operation.transfer.note",
    "operation.transfer.submit",
    "operation.deploy.description",
    "operation.deploy.contract",
    "operation.deploy.submit",
    "operation.deploy.note",
    "operation.call.description",
    "operation.call.target",
    "operation.call.function",
    "operation.call.amount",
    "operation.call.submit",
    "operation.call.empty",
    "operation.arg.invalid.token",
    "operation.arg.tokenUnitSuffix",
    "operation.pending",
    "operation.close",
    "ghost.contract.deploying",
  ] as const;

  it.each(usedOperationKeys)(
    "has non-empty, distinct ja/en translations for %s",
    (key) => {
      const entry = messages[key];
      expect(entry.ja.length).toBeGreaterThan(0);
      expect(entry.en.length).toBeGreaterThan(0);
      expect(entry.ja).not.toBe(entry.en);
    },
  );

  it("keeps the {name} placeholder in both languages of ghost.contract.deploying", () => {
    expect(messages["ghost.contract.deploying"].ja).toContain("{name}");
    expect(messages["ghost.contract.deploying"].en).toContain("{name}");
  });

  it("keeps the {symbol} placeholder in both languages of operation.arg.tokenUnitSuffix (Issue #219)", () => {
    expect(messages["operation.arg.tokenUnitSuffix"].ja).toContain("{symbol}");
    expect(messages["operation.arg.tokenUnitSuffix"].en).toContain("{symbol}");
  });
});

describe("format", () => {
  it("replaces a single placeholder", () => {
    expect(format("hello {name}", { name: "world" })).toBe("hello world");
  });

  it("replaces multiple distinct placeholders", () => {
    expect(format("{a} and {b}", { a: "x", b: "y" })).toBe("x and y");
  });

  it("replaces repeated occurrences of the same placeholder", () => {
    expect(format("{a}-{a}", { a: "z" })).toBe("z-z");
  });

  it("leaves an unmatched placeholder untouched", () => {
    expect(format("hello {name}", {})).toBe("hello {name}");
  });

  it("returns the text unchanged when it has no placeholders", () => {
    expect(format("no placeholders here", { name: "world" })).toBe(
      "no placeholders here",
    );
  });

  it("does not use inherited Object.prototype properties as placeholder values", () => {
    // hasOwnProperty ガードにより、たとえば {toString} のようなキーが
    // プロトタイプ経由で誤って解決されない。
    expect(format("{toString}", {})).toBe("{toString}");
  });

  it("substitutes an empty string value explicitly", () => {
    expect(format("[{name}]", { name: "" })).toBe("[]");
  });
});
