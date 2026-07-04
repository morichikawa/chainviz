import { type FormEvent, useState } from "react";
import { useCommandActions } from "../commands/CommandActionsContext.js";
import { useLanguage } from "../i18n/LanguageProvider.js";

/**
 * キャンバス上に重ねて置く操作ツールバー（#37）。ノード追加ボタンと、
 * ラベル入力欄つきのワークベンチ追加フォームを持つ。プロファイルは現状
 * Ethereum 1種のみなので選択 UI は置かない。
 */
export function CanvasToolbar() {
  const { t } = useLanguage();
  const actions = useCommandActions();
  const [label, setLabel] = useState("");

  const onAddWorkbench = (event: FormEvent) => {
    event.preventDefault();
    actions.addWorkbench(label);
    setLabel("");
  };

  return (
    <div className="canvas-toolbar">
      <button
        type="button"
        className="canvas-toolbar__button"
        onClick={() => actions.addNode()}
      >
        + {t("action.addNode")}
      </button>
      <form className="canvas-toolbar__workbench" onSubmit={onAddWorkbench}>
        <input
          type="text"
          className="canvas-toolbar__input"
          value={label}
          placeholder={t("action.workbenchLabelPlaceholder")}
          aria-label={t("action.workbenchLabelPlaceholder")}
          onChange={(event) => setLabel(event.target.value)}
        />
        <button type="submit" className="canvas-toolbar__button">
          + {t("action.addWorkbench")}
        </button>
      </form>
    </div>
  );
}
