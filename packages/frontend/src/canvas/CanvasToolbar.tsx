import type { WorldStateEntity } from "@chainviz/shared";
import { type FormEvent, useState } from "react";
import { useCommandActions } from "../commands/CommandActionsContext.js";
import {
  resolveAddNodeHint,
  resolveAddWorkbenchHint,
} from "../commands/commandMessages.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { ActionHint } from "./ActionHint.js";

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
  /**
   * 現在のワールドステートのエンティティ（Issue #123 UX設計 §4-1）。
   * ボタンのホバー/フォーカス予告ツールチップに出す接続先（ブートノード /
   * RPC 接続先）の解決に使う。省略時は空配列扱いとなり、どちらのツール
   * チップも generic な文言にフォールバックする。
   */
  entities?: WorldStateEntity[];
}

/**
 * キャンバス上に重ねて置く操作ツールバー（#37）。ノード追加ボタンと、
 * ラベル入力欄つきのワークベンチ追加フォームを持つ。プロファイルは現状
 * Ethereum 1種のみなので選択 UI は置かない。
 */
export function CanvasToolbar({
  pendingAddNode = false,
  pendingAddWorkbench = false,
  entities = [],
}: CanvasToolbarProps = {}) {
  const { t } = useLanguage();
  const actions = useCommandActions();
  const [label, setLabel] = useState("");

  const onAddWorkbench = (event: FormEvent) => {
    event.preventDefault();
    actions.addWorkbench(label);
    setLabel("");
  };

  // 押下前の予告ツールチップ（Issue #123 UX設計 §4-1）。接続先を解決できなければ
  // resolveAddNodeHint / resolveAddWorkbenchHint 自身が generic な文言へ倒す。
  const addNodeHint = resolveAddNodeHint(entities, t);
  const addWorkbenchHint = resolveAddWorkbenchHint(entities, t);

  return (
    <div className="canvas-toolbar">
      <ActionHint hint={addNodeHint}>
        <button
          type="button"
          className={
            pendingAddNode
              ? "canvas-toolbar__button canvas-toolbar__button--pending"
              : "canvas-toolbar__button"
          }
          aria-busy={pendingAddNode}
          onClick={() => actions.addNode()}
          data-testid="canvas-toolbar-add-node"
        >
          {pendingAddNode && (
            <span className="canvas-toolbar__spinner" aria-hidden="true" />
          )}
          + {t("action.addNode")}
          {pendingAddNode ? ` (${t("action.addNode.pending")})` : ""}
        </button>
      </ActionHint>
      <form className="canvas-toolbar__workbench" onSubmit={onAddWorkbench}>
        <input
          type="text"
          className="canvas-toolbar__input"
          value={label}
          placeholder={t("action.workbenchLabelPlaceholder")}
          aria-label={t("action.workbenchLabelPlaceholder")}
          onChange={(event) => setLabel(event.target.value)}
          data-testid="canvas-toolbar-workbench-label"
        />
        <ActionHint hint={addWorkbenchHint}>
          <button
            type="submit"
            className={
              pendingAddWorkbench
                ? "canvas-toolbar__button canvas-toolbar__button--pending"
                : "canvas-toolbar__button"
            }
            aria-busy={pendingAddWorkbench}
            data-testid="canvas-toolbar-add-workbench"
          >
            {pendingAddWorkbench && (
              <span className="canvas-toolbar__spinner" aria-hidden="true" />
            )}
            + {t("action.addWorkbench")}
            {pendingAddWorkbench ? ` (${t("action.addWorkbench.pending")})` : ""}
          </button>
        </ActionHint>
      </form>
    </div>
  );
}
