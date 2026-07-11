import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider, useGlossary } from "./GlossaryProvider.js";
import type { Glossary } from "./types.js";

afterEach(() => {
  cleanup();
});

const glossary: Glossary = {
  container: {
    key: "container",
    name: { ja: "コンテナ", en: "Container" },
    definition: { ja: "隔離された実行単位", en: "An isolated runtime unit" },
    layer: "a-infra",
    relatedTerms: [],
  },
};

function wrapper({ children }: { children: ReactNode }) {
  return <GlossaryProvider glossary={glossary}>{children}</GlossaryProvider>;
}

describe("useGlossary lookup", () => {
  it("resolves a known key to its term", () => {
    const { result } = renderHook(() => useGlossary(), { wrapper });
    expect(result.current.lookup("container")?.name.en).toBe("Container");
  });

  it("returns undefined for an unregistered key", () => {
    const { result } = renderHook(() => useGlossary(), { wrapper });
    expect(result.current.lookup("does-not-exist")).toBeUndefined();
  });

  it("does not leak inherited Object.prototype members for prototype-pollution-like keys", () => {
    // 回帰テスト（Issue #264）: `glossary` プロップはオブジェクトリテラル
    // 相当で `Object.prototype` を継承するため、ガード無しのブラケット
    // アクセスだと "toString" 等の継承メンバ名で継承メンバ（関数など）を
    // 誤って真値として返してしまっていた（`describeNodeRole`/
    // `describeSyncStage` と同種の穴）。`Object.hasOwn` ガードで未登録
    // キーの undefined フォールバックが崩れないことを固定する。
    const { result } = renderHook(() => useGlossary(), { wrapper });
    expect(result.current.lookup("toString")).toBeUndefined();
    expect(result.current.lookup("constructor")).toBeUndefined();
    expect(result.current.lookup("__proto__")).toBeUndefined();
    expect(result.current.lookup("valueOf")).toBeUndefined();
    expect(result.current.lookup("hasOwnProperty")).toBeUndefined();
    expect(result.current.lookup("isPrototypeOf")).toBeUndefined();
  });

  it("returns undefined for every enumerable and non-enumerable Object.prototype member", () => {
    // 上のテストは代表的な継承メンバのみを見ているが、`toString`/
    // `constructor`/`__proto__` 以外の継承メンバ（`propertyIsEnumerable`/
    // `toLocaleString`/`propertyIsEnumerable` など）でも `Object.hasOwn`
    // ガードが等しく機能することを、`Object.prototype` 上の全メンバ名を
    // 総当たりで確認して固定する（将来 lookup の実装が個別キーの
    // 名指しブラックリストに退化しても検知できるようにする）。
    const { result } = renderHook(() => useGlossary(), { wrapper });
    const inheritedNames = [
      ...Object.getOwnPropertyNames(Object.prototype),
      "__proto__",
    ];
    for (const name of inheritedNames) {
      expect(result.current.lookup(name)).toBeUndefined();
    }
  });

  it("resolves a term stored under a legitimate own \"__proto__\" key (guard must not over-block)", () => {
    // 回帰テスト（Issue #264）: ガードの目的は継承メンバの漏れ防止であって、
    // 正当な own property を弾くことではない。`parse.ts` は
    // `Object.create(null)` ベースで glossary を構築するため、YAML キーが
    // たまたま "__proto__" だった用語は「継承アクセサ」ではなく通常の
    // own property として格納される。この glossary を注入したとき lookup が
    // その用語を（undefined ではなく）返すことを固定し、`Object.hasOwn`
    // ガードが過剰に弾いていないことを保証する。
    const nullProtoGlossary = Object.create(null) as Glossary;
    nullProtoGlossary.__proto__ = {
      key: "__proto__",
      name: { ja: "邪悪", en: "evil" },
      definition: { ja: "説明", en: "definition" },
      layer: "",
      relatedTerms: [],
    };
    function nullProtoWrapper({ children }: { children: ReactNode }) {
      return (
        <GlossaryProvider glossary={nullProtoGlossary}>
          {children}
        </GlossaryProvider>
      );
    }
    const { result } = renderHook(() => useGlossary(), {
      wrapper: nullProtoWrapper,
    });
    expect(result.current.lookup("__proto__")?.name.en).toBe("evil");
    // 一方で存在しない継承メンバ名は依然 undefined を返す。
    expect(result.current.lookup("toString")).toBeUndefined();
  });
});

describe("useGlossary outside a provider", () => {
  it("throws a descriptive error", () => {
    // renderHook 内で例外が投げられるとテストランナーに伝播するよう、
    // エラー境界なしで直接 hook 呼び出しをラップする。
    expect(() => renderHook(() => useGlossary())).toThrow(
      "useGlossary must be used within a GlossaryProvider",
    );
  });
});
