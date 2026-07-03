import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { type KeyValueStorage, getBrowserStorage } from "../platform/storage.js";
import {
  type Language,
  loadLanguage,
  nextLanguage,
  saveLanguage,
  translate,
} from "./i18n.js";
import type { MessageKey } from "./messages.js";

export interface LanguageContextValue {
  lang: Language;
  setLang: (lang: Language) => void;
  toggle: () => void;
  /** UI 文言を現在の言語で引く。 */
  t: (key: MessageKey) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export interface LanguageProviderProps {
  children: ReactNode;
  /** 永続化ストレージ（既定はブラウザ localStorage、無ければメモリ）。 */
  storage?: KeyValueStorage;
  /** 初期言語（未指定なら保存値、無ければ日本語）。 */
  initialLanguage?: Language;
}

export function LanguageProvider({
  children,
  storage,
  initialLanguage,
}: LanguageProviderProps) {
  const [store] = useState<KeyValueStorage>(() => storage ?? getBrowserStorage());
  const [lang, setLangState] = useState<Language>(
    () => initialLanguage ?? loadLanguage(store),
  );

  const setLang = useCallback(
    (next: Language) => {
      setLangState(next);
      saveLanguage(store, next);
    },
    [store],
  );

  const toggle = useCallback(() => {
    setLang(nextLanguage(lang));
  }, [lang, setLang]);

  const value = useMemo<LanguageContextValue>(
    () => ({ lang, setLang, toggle, t: (key) => translate(key, lang) }),
    [lang, setLang, toggle],
  );

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return ctx;
}
