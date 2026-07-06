import { type FormEvent, useState } from "react";
import { useCommandActions } from "../commands/CommandActionsContext.js";
import { useLanguage } from "../i18n/LanguageProvider.js";

export interface CanvasToolbarProps {
  /**
   * addNode コマンドを送ってから、実エンティティ到着 or 失敗で解決されるまでの
   * 間 true になる（Issue #102）。押した瞬間に反応があることを示すため、
   * ボタンへスピナー + 補足文言を足す。二重送信防止のためではないので、
   * このフラグが true でもボタンは押せるままにする（連打時は連打した分だけ
   * ゴーストカードが並ぶ）。
   */
  pendingAddNode?: boolean;
  /** addWorkbench 版。意味は pendingAddNode と同じ。 */
  pendingAddWorkbench?: boolean;
}

/**
 * キャンバス上に重ねて置く操作ツールバー（#37）。ノード追加ボタンと、
 * ラベル入力欄つきのワークベンチ追加フォームを持つ。プロファイルは現状
 * Ethereum 1種のみなので選択 UI は置かない。
 */
export function CanvasToolbar({
  pendingAddNode = false,
  pendingAddWorkbench = false,
}: CanvasToolbarProps = {}) {
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
        className={
          pendingAddNode
            ? "canvas-toolbar__button canvas-toolbar__button--pending"
            : "canvas-toolbar__button"
        }
        aria-busy={pendingAddNode}
        onClick={() => actions.addNode()}
      >
        {pendingAddNode && (
          <span className="canvas-toolbar__spinner" aria-hidden="true" />
        )}
        + {t("action.addNode")}
        {pendingAddNode ? ` (${t("action.addNode.pending")})` : ""}
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
        <button
          type="submit"
          className={
            pendingAddWorkbench
              ? "canvas-toolbar__button canvas-toolbar__button--pending"
              : "canvas-toolbar__button"
          }
          aria-busy={pendingAddWorkbench}
        >
          {pendingAddWorkbench && (
            <span className="canvas-toolbar__spinner" aria-hidden="true" />
          )}
          + {t("action.addWorkbench")}
          {pendingAddWorkbench ? ` (${t("action.addWorkbench.pending")})` : ""}
        </button>
      </form>
    </div>
  );
}
