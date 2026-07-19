import { useEffect, useMemo, useRef, useState } from "react";
import { NEW_ARRIVAL_HIGHLIGHT_DURATION_MS } from "../entities/useNewArrivalHighlight.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { HashChainBlockRow } from "./HashChainBlockRow.js";
import {
  createInitialHashChainDemoState,
  deriveBlockHash,
  isBlockValid,
  isFullyRepaired,
  relinkBlock,
  resetHashChainDemoState,
  updateBlockData,
  type HashChainDemoState,
} from "./hashChainDemo.js";

/**
 * 「ハッシュのしくみ」デモの中身（`kind: "hashChainDemo"`。Issue #401。
 * `docs/worklog/issue-401.md` UX設計）。
 *
 * 状態はこのコンポーネントにローカルな `useState` で完結する（`SidePanelView`
 * 側には何も持たせない）。パネルを閉じて開き直すと必ず
 * `createInitialHashChainDemoState()` から始まる（学習デモは毎回同じ起点が
 * 明快、という設計判断。UX設計 §3冒頭）。
 *
 * 「全部つなぎ直せた」まとめメッセージ（`hashDemo.repairedSummary`）は、
 * 「一度でも編集/つなぎ直し操作をした後に、全ブロックが有効な状態」で
 * 表示する。初期状態（無操作）で既に全ブロックが有効なままこのメッセージが
 * 出てしまわないよう、`hasInteracted` フラグを別に持つ（pure logic 側の
 * `isFullyRepaired` だけでは「まだ何もしていない」と「改ざん→修復し切った」
 * を区別できないため）。
 */
export function HashChainDemoView() {
  const { t } = useLanguage();
  const [state, setState] = useState<HashChainDemoState>(createInitialHashChainDemoState);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [flashingIndices, setFlashingIndices] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const flashTimeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(
    () => () => {
      for (const timeout of flashTimeoutsRef.current.values()) clearTimeout(timeout);
      flashTimeoutsRef.current.clear();
    },
    [],
  );

  // 直前の操作で変わったハッシュを短くフラッシュする（既存の新着ハイライトの
  // 流儀を再利用。UX設計 §3レイアウト「ハッシュ値が変わった瞬間は短いフラッシュ」）。
  function flash(index: number) {
    setFlashingIndices((prev) => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
    const existing = flashTimeoutsRef.current.get(index);
    if (existing) clearTimeout(existing);
    const timeout = setTimeout(() => {
      setFlashingIndices((prev) => {
        if (!prev.has(index)) return prev;
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
      flashTimeoutsRef.current.delete(index);
    }, NEW_ARRIVAL_HIGHLIGHT_DURATION_MS);
    flashTimeoutsRef.current.set(index, timeout);
  }

  function handleDataChange(index: number, data: string) {
    setState((prev) => updateBlockData(prev, index, data));
    setHasInteracted(true);
    flash(index);
  }

  function handleRelink(index: number) {
    setState((prev) => relinkBlock(prev, index));
    setHasInteracted(true);
    flash(index);
  }

  function handleReset() {
    for (const timeout of flashTimeoutsRef.current.values()) clearTimeout(timeout);
    flashTimeoutsRef.current.clear();
    setFlashingIndices(new Set());
    setState(resetHashChainDemoState());
    setHasInteracted(false);
  }

  const hashes = useMemo(() => state.blocks.map((block) => deriveBlockHash(block)), [state]);
  const validity = useMemo(
    () => state.blocks.map((_, index) => isBlockValid(state.blocks, index)),
    [state],
  );
  const showRepairedSummary = hasInteracted && isFullyRepaired(state.blocks);

  return (
    <div className="hash-chain-demo" data-testid="hash-chain-demo">
      <p className="hash-chain-demo__intro">{t("hashDemo.intro")}</p>
      {state.blocks.map((block, index) => (
        <div key={block.number} className="hash-chain-demo__row">
          {index > 0 && (
            <span
              className={
                validity[index]
                  ? "hash-chain-demo__connector hash-chain-demo__connector--connected"
                  : "hash-chain-demo__connector hash-chain-demo__connector--broken"
              }
              aria-hidden="true"
              data-testid={`hash-chain-demo-connector-${block.number}`}
            />
          )}
          <HashChainBlockRow
            block={block}
            hash={hashes[index]!}
            valid={validity[index]!}
            flashing={flashingIndices.has(index)}
            onDataChange={(data) => handleDataChange(index, data)}
            onRelink={index > 0 ? () => handleRelink(index) : undefined}
          />
        </div>
      ))}
      {showRepairedSummary && (
        <p className="hash-chain-demo__summary" data-testid="hash-chain-demo-summary">
          {t("hashDemo.repairedSummary")}
        </p>
      )}
      <button
        type="button"
        className="hash-chain-demo__reset nodrag"
        onClick={handleReset}
        data-testid="hash-chain-demo-reset"
      >
        {t("hashDemo.reset")}
      </button>
      <p className="hash-chain-demo__footer-note">{t("hashDemo.whoComputes")}</p>
      <p className="hash-chain-demo__footer-note">{t("hashDemo.simplifiedNote")}</p>
    </div>
  );
}
