import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { KeyValueStorage } from "../platform/storage.js";
import { LANGUAGE_STORAGE_KEY } from "./i18n.js";
import { LanguageProvider } from "./LanguageProvider.js";
import { LanguageToggle } from "./LanguageToggle.js";

afterEach(cleanup);

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

describe("LanguageToggle", () => {
  it("shows the other language as its label and toggles on click", () => {
    const storage = memoryStorage();
    render(
      <LanguageProvider storage={storage} initialLanguage="ja">
        <LanguageToggle />
      </LanguageProvider>,
    );

    // 日本語表示中はトグル先(English)がラベル。
    const button = screen.getByRole("button");
    expect(button.textContent).toBe("English");

    fireEvent.click(button);
    expect(button.textContent).toBe("日本語");
    expect(storage.data.get(LANGUAGE_STORAGE_KEY)).toBe("en");

    fireEvent.click(button);
    expect(button.textContent).toBe("English");
    expect(storage.data.get(LANGUAGE_STORAGE_KEY)).toBe("ja");
  });

  it("starts from the persisted language", () => {
    const storage = memoryStorage();
    storage.setItem(LANGUAGE_STORAGE_KEY, "en");
    render(
      <LanguageProvider storage={storage}>
        <LanguageToggle />
      </LanguageProvider>,
    );
    expect(screen.getByRole("button").textContent).toBe("日本語");
  });
});
