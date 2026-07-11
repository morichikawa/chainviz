import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { Glossary, GlossaryTerm } from "./types.js";

export interface GlossaryContextValue {
  glossary: Glossary;
  /** 用語キーから用語を引く。未登録なら undefined。 */
  lookup: (key: string) => GlossaryTerm | undefined;
}

const GlossaryContext = createContext<GlossaryContextValue | null>(null);

export interface GlossaryProviderProps {
  children: ReactNode;
  /** 用語データ。App では実データ、テストではモックを注入する。 */
  glossary: Glossary;
}

export function GlossaryProvider({ children, glossary }: GlossaryProviderProps) {
  const value = useMemo<GlossaryContextValue>(
    () => ({
      glossary,
      // `glossary` はオブジェクトリテラル相当（App.tsx の既定値・テストの
      // モックともに `Object.prototype` を継承する）のため、ガード無しの
      // ブラケットアクセスだと `key` が "toString" / "constructor" /
      // "__proto__" のような継承メンバ名のとき、その継承メンバ（関数など）
      // を誤って真値として返してしまう（`nodeRoles.ts` の
      // `describeNodeRole`、`syncStageLabels.ts` の `describeSyncStage` と
      // 同種の穴、Issue #215/#258/#264）。`Object.hasOwn` で自身の列挙可能
      // プロパティかどうかを確認してから引くことでこれを防ぐ。
      lookup: (key) => (Object.hasOwn(glossary, key) ? glossary[key] : undefined),
    }),
    [glossary],
  );
  return (
    <GlossaryContext.Provider value={value}>{children}</GlossaryContext.Provider>
  );
}

export function useGlossary(): GlossaryContextValue {
  const ctx = useContext(GlossaryContext);
  if (!ctx) {
    throw new Error("useGlossary must be used within a GlossaryProvider");
  }
  return ctx;
}
