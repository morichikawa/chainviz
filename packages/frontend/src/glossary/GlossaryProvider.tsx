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
    () => ({ glossary, lookup: (key) => glossary[key] }),
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
