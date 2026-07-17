import { ActionHint } from "../canvas/ActionHint.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { useSidePanel } from "../side-panel/SidePanelContext.js";

/**
 * ヘッダーに置く用語集パネルの開閉トリガー（Issue #313 UX設計 §3.2-1）。
 * `LanguageToggle` の隣、「言語切り替えと同じ学習・参照系のアプリ全域機能」
 * として `app__controls` に置く（キャンバスツールバー側には置かない。
 * ツールバーは「環境を変える操作」の場所であるため）。
 *
 * トグル動作: 用語集パネルが表示中ならクリックで閉じる。それ以外（他の
 * kind のパネルが開いている・パネルが閉じている）ならクリックで
 * `{kind: "glossary"}`（termKey 無し）を開く。ヘッダーボタン起動時は
 * `GlossaryPanelView` 側が検索欄へフォーカスする（`termKey` 省略の意味）。
 */
export function GlossaryOpenButton() {
  const { t } = useLanguage();
  const { view, open, close } = useSidePanel();
  const isOpen = view?.kind === "glossary";

  function handleClick() {
    if (isOpen) {
      close();
    } else {
      open({ kind: "glossary" });
    }
  }

  return (
    <ActionHint hint={t("glossary.open.hint")}>
      <button
        type="button"
        className="glossary-open-button"
        aria-pressed={isOpen}
        onClick={handleClick}
        data-testid="glossary-open-button"
      >
        {t("glossary.open")}
      </button>
    </ActionHint>
  );
}
