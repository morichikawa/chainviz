import { describe, expect, it } from "vitest";
import { pickLocale, translate } from "./i18n.js";
import { LANGUAGES, type Language, messages } from "./messages.js";

// Issue #341 の本質は「同じ `{ja, en:""}` という入力に対し translate と
// pickLocale が意図的に異なる結果を返す」点にある。translate（型検査済みの
// UI 文言）は空文字を意図的な値として尊重し、pickLocale（不備がありうる
// glossary/チェーンプロファイルのデータ向け防御）は空文字を『値なし』として
// デフォルト言語へフォールバックする。この境界を対比で固定する。

describe("translate vs pickLocale empty-string boundary (Issue #341)", () => {
  const entry = messages["legend.hint.suffix"];

  it("translate respects an intentionally empty en value (no ja fallback)", () => {
    expect(translate("legend.hint.suffix", "en")).toBe("");
  });

  it("pickLocale falls back to ja for the very same entry (data-side defense)", () => {
    expect(pickLocale(entry, "en")).toBe(entry.ja);
  });

  it("the two helpers diverge for an intentionally empty en value", () => {
    // 差そのものをアサートし、将来どちらかを『揃えて』しまう変更（例:
    // translate を再び pickLocale 経由に戻す）を検出できるようにする。
    expect(translate("legend.hint.suffix", "en")).not.toBe(
      pickLocale(entry, "en"),
    );
  });

  it("translate returns the non-empty ja value unchanged", () => {
    // ja 側は非空。フォールバック挙動の有無に関わらず素の値を返す。
    expect(translate("legend.hint.suffix", "ja")).toBe(entry.ja);
    expect(translate("legend.hint.suffix", "ja")).not.toBe("");
  });
});

describe("intentional empty-string invariant in messages.ts (Issue #341)", () => {
  // 設計メモ（docs/worklog/issue-341.md §1）の前提: messages.ts で意図的な
  // 空文字は legend.hint.suffix.en の1箇所だけ。ここが崩れる（別のキーで
  // 空文字を足す）と translate の「空文字を尊重する」挙動が新しいキーに
  // 波及する。追加時にこのガードを踏むことで、意図的な追加かをレビューで
  // 確認でき、必要なら対応する回帰テストの追加を促せる。
  it("has an empty value only at legend.hint.suffix.en", () => {
    const emptyPairs: Array<[string, Language]> = [];
    for (const [key, entry] of Object.entries(messages)) {
      for (const lang of LANGUAGES) {
        if ((entry as Record<Language, string>)[lang] === "") {
          emptyPairs.push([key, lang]);
        }
      }
    }
    expect(emptyPairs).toEqual([["legend.hint.suffix", "en"]]);
  });

  it("keeps ja non-empty while only en is intentionally empty for legend.hint.suffix", () => {
    expect(messages["legend.hint.suffix"].ja).not.toBe("");
    expect(messages["legend.hint.suffix"].en).toBe("");
  });
});

describe("translate with keys absent from messages (Issue #341 regression scope)", () => {
  // #341 は translate の内部実装（pickLocale 経由 → entry[lang] 直接参照）を
  // 変えたため、「未知キーはキー文字列をそのまま返す」既存契約が両言語で
  // 保たれていることを確認する。
  it("returns the key itself for a genuinely unknown key in either language", () => {
    expect(translate("no.such.key" as never, "ja")).toBe("no.such.key");
    expect(translate("no.such.key" as never, "en")).toBe("no.such.key");
  });

  it("returns an empty-string key unchanged without throwing", () => {
    expect(translate("" as never, "en")).toBe("");
  });
});
