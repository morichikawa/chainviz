import type { WorldStateEntity } from "@chainviz/shared";
import { type FormEvent, useState } from "react";
import { useCommandActions } from "../commands/CommandActionsContext.js";
import {
  resolveAddNodeHint,
  resolveAddWorkbenchHint,
} from "../commands/commandMessages.js";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { useSidePanel } from "../side-panel/SidePanelContext.js";
import { ActionHint } from "./ActionHint.js";

export interface CanvasToolbarProps {
  /**
   * addNode コマンドを送ってから、実エンティティ到着 or 失敗で解決されるまでの
   * 間 true になる（Issue #102）。押した瞬間に反応があることを示すため、
   * ボタンへスピナー + 補足文言を足す。また、直前の追加がまだ解決していない
   * 間はボタンを `disabled` にし、連打による多重の追加コマンド送信を防ぐ
   * （Issue #220）。ゴースト（仮カード）は entityAdded / commandResult(失敗) /
   * 安全網タイムアウト（`ghostNode.ts` の `GHOST_TIMEOUT_MS`）のいずれかで
   * 必ず消えるため、ボタンが恒久的に押せなくなることはない。
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
  // Issue #317: 通信ログパネルの開閉トグル。SidePanelView は排他（同時に
  // 開けるのは1枚）なので、他のパネル（コントラクトソース等）が開いている
  // 状態でこのボタンを押すとそちらを置き換えて通信ログが開く（既存の
  // ContractCard 側トリガーと同じ `open` の挙動）。
  const { view: sidePanelView, open: openSidePanel, close: closeSidePanel } = useSidePanel();
  const commsLogOpen = sidePanelView?.kind === "commsLog";
  const toggleCommsLog = () => {
    if (commsLogOpen) closeSidePanel();
    else openSidePanel({ kind: "commsLog" });
  };

  const onAddWorkbench = (event: FormEvent) => {
    event.preventDefault();
    actions.addWorkbench(label);
    setLabel("");
  };

  // 押下前の予告ツールチップ（Issue #123 UX設計 §4-1）。接続先を解決できなければ
  // resolveAddNodeHint / resolveAddWorkbenchHint 自身が generic な文言へ倒す。
  const addNodeHintLine1 = resolveAddNodeHint(entities, t);
  const addWorkbenchHint = resolveAddWorkbenchHint(entities, t);

  // ノード追加ボタンのみ2段構成にする（Issue #251 UX設計 docs/worklog/issue-251.md
  // §4）。1段目は既存の「何が起きるか」の文言（上記）、2段目は「なぜ2枚1組
  // なのか」を説明する静的な文言で、ブートノードの解決可否に関わらず常に
  // 付く。2段目の文中にある「EL/CL分離」を GlossaryTerm でくるむために、
  // `internalEdge.pair.prefix/term/suffix`（InternalLinkEdgePopover.tsx）と
  // 同じ3分割パターンを踏襲する。ワークベンチ追加ボタンの hint は対象外。
  const addNodeHint = (
    <>
      <span className="action-hint__line">{addNodeHintLine1}</span>
      <span className="action-hint__line action-hint__line--secondary">
        {t("action.addNode.hint.pair.prefix")}
        <GlossaryTerm termKey="el-cl-separation">
          {t("action.addNode.hint.pair.term")}
        </GlossaryTerm>
        {t("action.addNode.hint.pair.suffix")}
      </span>
    </>
  );

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
          disabled={pendingAddNode}
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
            disabled={pendingAddWorkbench}
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
      <button
        type="button"
        className={
          commsLogOpen
            ? "canvas-toolbar__button canvas-toolbar__button--active"
            : "canvas-toolbar__button"
        }
        aria-pressed={commsLogOpen}
        onClick={toggleCommsLog}
        data-testid="canvas-toolbar-comms-log"
      >
        {t("action.commsLog")}
      </button>
    </div>
  );
}
