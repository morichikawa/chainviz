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
