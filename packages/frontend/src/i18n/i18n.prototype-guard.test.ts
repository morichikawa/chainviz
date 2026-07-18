import { describe, expect, it } from "vitest";
import { type Language, format, translate } from "./i18n.js";

// Issue #371: translate() / format() が `Object.prototype` 由来のキー
// (toString など)をプロトタイプチェーン経由で解決してしまわないことの
// 網羅的なガードテスト。i18n.test.ts には最小限の代表ケースがあるが、
// プロトタイプ汚染防御という関心事を独立ファイルに切り出して観点を
// 洗い出す(CLAUDE.md: テストファイルも1責務)。

// messages / params のどちらにも自己プロパティとして存在せず、
// ガードが無ければプロトタイプチェーン経由で拾われてしまうキー群。
// 通常の Object リテラルが継承する列挙不可プロパティを網羅する。
const prototypeKeys = [
  "toString",
  "toLocaleString",
  "valueOf",
  "constructor",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
] as const;

const languages: Language[] = ["ja", "en"];

describe("translate() prototype-pollution guard (Issue #371)", () => {
  // これらが実際に Object.prototype 由来(自己プロパティでない)ことを
  // 前提として明示する。前提が崩れるとテストの意味が失われるため確認する。
  it.each(prototypeKeys)(
    "%s is genuinely inherited, not an own property of a plain object",
    (key) => {
      expect(Object.prototype.hasOwnProperty.call({}, key)).toBe(false);
      // 素の {} 上ではプロトタイプ経由で値(関数など)が拾える。
      expect(({} as Record<string, unknown>)[key]).not.toBeUndefined();
    },
  );

  it.each(prototypeKeys)(
    "returns the key itself for the inherited key %s in every language",
    (key) => {
      for (const lang of languages) {
        expect(translate(key as never, lang)).toBe(key);
      }
    },
  );

  it("guards __proto__, which resolves to the prototype object rather than a function", () => {
    // __proto__ は messages["__proto__"] がプロトタイプ(オブジェクト)を
    // 返す特殊ケース。関数を返す他のキーと挙動が異なるが、hasOwnProperty
    // は同じく false のためガードで保護され、キー文字列がそのまま返る。
    expect(translate("__proto__" as never, "ja")).toBe("__proto__");
    expect(translate("__proto__" as never, "en")).toBe("__proto__");
  });
});

describe("translate() still resolves genuine MessageKeys after the guard (Issue #371)", () => {
  // ガード追加でプロトタイプ由来キーを弾く一方、実在キーの正常系が
  // 壊れていないことを複数キーで担保する(既存正常系の回帰)。
  const realKeys = [
    { key: "card.node", ja: "ノード", en: "Node" },
    { key: "card.wallet", ja: "ウォレット", en: "Wallet" },
    { key: "connection.connected", ja: "接続済み", en: "Connected" },
    { key: "language.toggle", ja: "English", en: "日本語" },
  ] as const;

  it.each(realKeys)(
    "returns the ja/en translation for $key (not the key string)",
    ({ key, ja, en }) => {
      expect(translate(key, "ja")).toBe(ja);
      expect(translate(key, "en")).toBe(en);
      // 実在キーはキー文字列そのものにフォールバックしていないこと。
      expect(translate(key, "ja")).not.toBe(key);
    },
  );
});

describe("translate() and format() guards behave identically for inherited keys (Issue #371)", () => {
  // translate() の新ガードと format() の既存ガードが、同じプロトタイプ
  // 由来キー集合に対して同じ「素通し(キー/プレースホルダをそのまま返す)」
  // 挙動をすることを並べて比較する。実装パターンが揃っていることの担保。
  it.each(prototypeKeys)(
    "both leave the inherited key %s untouched",
    (key) => {
      // translate: 空の params ではなく messages を対象にするが、
      // どちらも「自己プロパティでないキーは解決しない」契約は共通。
      expect(translate(key as never, "ja")).toBe(key);
      // format: {key} プレースホルダは params に無ければそのまま残る。
      expect(format(`{${key}}`, {})).toBe(`{${key}}`);
    },
  );

  it("both resolve a key that IS an own property (parity on the positive path)", () => {
    // 自己プロパティとして存在する場合は両者とも解決する、という対の確認。
    // format 側は params に own プロパティがあれば置換する。
    expect(format("{name}", { name: "world" })).toBe("world");
    // translate 側は messages に own プロパティ(card.node)があれば解決する。
    expect(translate("card.node", "en")).toBe("Node");
  });
});
