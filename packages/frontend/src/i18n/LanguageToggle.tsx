import { useLanguage } from "./LanguageProvider.js";

/**
 * 画面隅に置く UI 言語の切り替えボタン。押すと ja/en をトグルする。
 * ボタンのラベルには「切り替え先の言語」を表示する。
 */
export function LanguageToggle() {
  const { lang, toggle, t } = useLanguage();
  return (
    <button
      type="button"
      className="language-toggle"
      onClick={toggle}
      aria-label={t("language.toggle")}
      data-lang={lang}
    >
      {t("language.toggle")}
    </button>
  );
}
