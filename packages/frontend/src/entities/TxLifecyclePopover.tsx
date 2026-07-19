import type { TransactionEntity } from "@chainviz/shared";
import type { RefObject } from "react";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import type { MessageKey } from "../i18n/messages.js";
import { PopoverPortal } from "../interaction/PopoverPortal.js";
import { useOptionalSidePanel } from "../side-panel/SidePanelContext.js";
import { TX_STATUS_MESSAGE_KEY, shortHex } from "./transaction.js";
import {
  deriveTxLifecycleFromTx,
  type TxLifecycleStage,
  type TxLifecycleStageKey,
  type TxLifecycleStageState,
} from "./txLifecycle.js";

/** 段階ごとのラベル文言キー。 */
const STAGE_LABEL_KEY: Record<TxLifecycleStageKey, MessageKey> = {
  signed: "tx.lifecycle.stage.signed",
  sent: "tx.lifecycle.stage.sent",
  mempool: "tx.lifecycle.stage.mempool",
  included: "tx.lifecycle.stage.included",
};

/** 段階ごとの一言説明の文言キー（failed 時の4段階目は別文言を使う）。 */
const STAGE_DESCRIPTION_KEY: Record<TxLifecycleStageKey, MessageKey> = {
  signed: "tx.lifecycle.desc.signed",
  sent: "tx.lifecycle.desc.sent",
  mempool: "tx.lifecycle.desc.mempool",
  included: "tx.lifecycle.desc.included",
};

/**
 * 段階ごとの用語解説キー。「送信」は Issue #212 実装時点で `rpc-endpoint`
 * 用語が未新設（単位A）だったため一時的に `workbench` にフォールバック
 * していたが、Issue #215（単位A）で `rpc-endpoint` が新設されたため
 * 差し替えた（docs/worklog/issue-211.md 8節・14節の設計メモを参照）。
 */
const STAGE_TERM_KEY: Record<TxLifecycleStageKey, string> = {
  signed: "signature",
  sent: "rpc-endpoint",
  mempool: "mempool",
  included: "block",
};

/** 見た目上の状態ごとのマーク。観測できない「進行中」を誇張しないよう、
 * 未到達(pending)には控えめな○を使う。 */
const STAGE_MARK: Record<TxLifecycleStageState, string> = {
  done: "✓", // ✓
  active: "●", // ●
  pending: "○", // ○
  failed: "✕", // ✕
};

function stageDescriptionKey(stage: TxLifecycleStage): MessageKey {
  if (stage.key === "included" && stage.state === "failed") {
    return "tx.lifecycle.desc.includedFailed";
  }
  // pending(未到達)の場合、完了を断定する説明文（過去形）を出すと
  // ○マーク（未到達）と矛盾する（Issue #212 QA差し戻し）。未到達専用の
  // 完了断定しない文言に分岐する。
  if (stage.key === "included" && stage.state === "pending") {
    return "tx.lifecycle.desc.includedPending";
  }
  return STAGE_DESCRIPTION_KEY[stage.key];
}

/**
 * tx チップ・tx 一覧行（WalletCard / WalletPopover）で共通に使う、ホバー時の
 * ライフサイクル詳細ポップオーバー（ARCHITECTURE.md §6.11、Issue #212
 * 単位D）。ヘッダ（hash 短縮 + 既存ステータスバッジ）+ 4段階の縦リストを
 * 表示するだけで、状態導出ロジックは `txLifecycle.ts` の
 * `deriveTxLifecycleFromTx` に委ねる。
 *
 * `anchorRef` はこのポップオーバーを開いた tx チップ/行への ref（Issue #245）。
 * React Flow のノードはそれぞれ独立したスタッキングコンテキストを持つため、
 * `PopoverPortal` でそのアンカーを基準位置に body 直下へ描画し、隣接カードの
 * 下に隠れないようにする。
 *
 * 末尾の「署名と検証のしくみを試す」ボタン（Issue #402）は、1段目の
 * 「署名」がまさに何をしているのかをその場で開ける文脈導線（UX設計
 * `docs/worklog/issue-402.md` §3導線1）。ポップオーバーはチップの子として
 * 描画済み（Issue #351 のパターン）なのでホバー中のクリックが成立する。
 * `useOptionalSidePanel()` を使う（`GlossaryTerm` と同じパターン。
 * `SidePanelProvider` の外でレンダーされる既存の単体テストを壊さないため）。
 */
export function TxLifecyclePopover({
  anchorRef,
  tx,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  tx: TransactionEntity;
}) {
  const { t } = useLanguage();
  const sidePanel = useOptionalSidePanel();
  const stages = deriveTxLifecycleFromTx(tx);

  return (
    <PopoverPortal
      anchorRef={anchorRef}
      gapPx={6}
      className="tx-lifecycle-popover"
      role="tooltip"
      data-testid={`tx-lifecycle-popover-${tx.hash}`}
    >
      <div className="tx-lifecycle-popover__header">
        <span className="tx-lifecycle-popover__hash">{shortHex(tx.hash)}</span>
        <span className={`wallet-tx-chip wallet-tx-chip--${tx.status}`}>
          {t(TX_STATUS_MESSAGE_KEY[tx.status])}
        </span>
      </div>
      <ul className="tx-lifecycle-popover__stages">
        {stages.map((stage) => (
          <li
            key={stage.key}
            className={`tx-lifecycle-popover__stage tx-lifecycle-popover__stage--${stage.state}`}
            data-testid={`tx-lifecycle-stage-${tx.hash}-${stage.key}`}
            data-stage-state={stage.state}
          >
            <span
              className="tx-lifecycle-popover__stage-mark"
              aria-hidden="true"
            >
              {STAGE_MARK[stage.state]}
            </span>
            <span className="tx-lifecycle-popover__stage-body">
              <span className="tx-lifecycle-popover__stage-label">
                <GlossaryTerm termKey={STAGE_TERM_KEY[stage.key]}>
                  {t(STAGE_LABEL_KEY[stage.key])}
                </GlossaryTerm>
              </span>
              <span className="tx-lifecycle-popover__stage-desc">
                {t(stageDescriptionKey(stage))}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="tx-lifecycle-popover__sig-demo-open nodrag"
        onClick={(event) => {
          event.stopPropagation();
          sidePanel?.open({ kind: "signatureDemo" });
        }}
        data-testid={`tx-lifecycle-sig-demo-open-${tx.hash}`}
      >
        {t("sigDemo.open")}
      </button>
    </PopoverPortal>
  );
}
