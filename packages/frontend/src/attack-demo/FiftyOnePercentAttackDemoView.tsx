import { useEffect, useRef, useState } from "react";
import { NEW_ARRIVAL_HIGHLIGHT_DURATION_MS } from "../entities/useNewArrivalHighlight.js";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { format } from "../i18n/i18n.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { AttackBranchBox } from "./AttackBranchBox.js";
import {
  TOTAL_VALIDATORS,
  branchValidatorIds,
  canonicalBranch,
  createInitialFiftyOnePercentAttackDemoState,
  marginToFlip,
  resetFiftyOnePercentAttackDemoState,
  toggleValidator,
  weightOfBranchA,
  weightOfBranchB,
  type FiftyOnePercentAttackDemoState,
} from "./fiftyOnePercentAttackDemo.js";

/**
 * 「51%攻撃のしくみ」デモの中身（`kind: "fiftyOnePercentAttackDemo"`。
 * Issue #414。`docs/worklog/issue-414.md` UX設計）。
 *
 * 状態はこのコンポーネントにローカルな `useState` で完結する
 * （`HashChainDemoView`/`SignatureDemoView` と同じく `SidePanelView` 側には
 * 何も持たせない）。パネルを閉じて開き直すと必ず
 * `createInitialFiftyOnePercentAttackDemoState()` から始まる。
 *
 * アニメーション: バリデーターをトグルした直後、そのバリデーターのボタンを
 * 短時間フラッシュする。トグルの結果 canonical な枝が変わった場合は、
 * 両方の枝の状態バッジも合わせてフラッシュする（UX設計 §3「アニメーション」。
 * `HashChainDemoView` が使っている `NEW_ARRIVAL_HIGHLIGHT_DURATION_MS` と
 * 同じ「変化箇所を短く光らせる」パターンを再利用し、新しいアニメーション
 * 機構は作らない）。
 */
export function FiftyOnePercentAttackDemoView() {
  const { t } = useLanguage();
  const [state, setState] = useState<FiftyOnePercentAttackDemoState>(
    createInitialFiftyOnePercentAttackDemoState,
  );
  const [flashingValidatorIds, setFlashingValidatorIds] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const [badgeFlashing, setBadgeFlashing] = useState(false);
  const validatorTimeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const badgeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      for (const timeout of validatorTimeoutsRef.current.values()) clearTimeout(timeout);
      validatorTimeoutsRef.current.clear();
      if (badgeTimeoutRef.current) clearTimeout(badgeTimeoutRef.current);
    },
    [],
  );

  function flashValidator(id: number) {
    setFlashingValidatorIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    const existing = validatorTimeoutsRef.current.get(id);
    if (existing) clearTimeout(existing);
    const timeout = setTimeout(() => {
      setFlashingValidatorIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      validatorTimeoutsRef.current.delete(id);
    }, NEW_ARRIVAL_HIGHLIGHT_DURATION_MS);
    validatorTimeoutsRef.current.set(id, timeout);
  }

  function flashBadges() {
    setBadgeFlashing(true);
    if (badgeTimeoutRef.current) clearTimeout(badgeTimeoutRef.current);
    badgeTimeoutRef.current = setTimeout(() => {
      setBadgeFlashing(false);
      badgeTimeoutRef.current = null;
    }, NEW_ARRIVAL_HIGHLIGHT_DURATION_MS);
  }

  function handleToggleValidator(id: number) {
    const prevCanonical = canonicalBranch(state);
    const next = toggleValidator(state, id);
    if (canonicalBranch(next) !== prevCanonical) flashBadges();
    setState(next);
    flashValidator(id);
  }

  function handleReset() {
    for (const timeout of validatorTimeoutsRef.current.values()) clearTimeout(timeout);
    validatorTimeoutsRef.current.clear();
    setFlashingValidatorIds(new Set());
    if (badgeTimeoutRef.current) clearTimeout(badgeTimeoutRef.current);
    setBadgeFlashing(false);
    setState(resetFiftyOnePercentAttackDemoState());
  }

  const attackerCount = weightOfBranchB(state);
  const percent = Math.round((attackerCount / TOTAL_VALIDATORS) * 100);
  const canonical = canonicalBranch(state);
  const margin = marginToFlip(state);

  return (
    <div className="attack51-demo" data-testid="attack51-demo">
      <p className="attack51-demo__intro">{t("attack51Demo.intro")}</p>
      <div className="attack51-demo__summary">
        <span className="attack51-demo__summary-label">{t("attack51Demo.summaryLabel")}</span>
        <span className="attack51-demo__summary-value" data-testid="attack51-demo-summary-value">
          {format(t("attack51Demo.summaryValue"), {
            attacker: String(attackerCount),
            total: String(TOTAL_VALIDATORS),
            percent: String(percent),
          })}
        </span>
      </div>
      <div className="attack51-demo__tree" data-testid="attack51-demo-tree">
        <div className="attack51-demo__common-parent" data-testid="attack51-demo-common-parent">
          {t("attack51Demo.commonParent")}
        </div>
        <div className="attack51-demo__connectors" aria-hidden="true">
          <span className="attack51-demo__connector attack51-demo__connector--a" />
          <span className="attack51-demo__connector attack51-demo__connector--b" />
        </div>
        <div className="attack51-demo__branches">
          <AttackBranchBox
            branch="a"
            validatorIds={branchValidatorIds(state, "a")}
            weight={weightOfBranchA(state)}
            canonical={canonical === "a"}
            flashingValidatorIds={flashingValidatorIds}
            badgeFlashing={badgeFlashing}
            onToggleValidator={handleToggleValidator}
          />
          <AttackBranchBox
            branch="b"
            validatorIds={branchValidatorIds(state, "b")}
            weight={weightOfBranchB(state)}
            canonical={canonical === "b"}
            flashingValidatorIds={flashingValidatorIds}
            badgeFlashing={badgeFlashing}
            onToggleValidator={handleToggleValidator}
          />
        </div>
      </div>
      <p
        className="attack51-demo__margin-hint"
        aria-live="polite"
        data-testid="attack51-demo-margin-hint"
      >
        {margin.flipped
          ? t("attack51Demo.alreadyFlipped")
          : format(t("attack51Demo.marginToFlip"), { count: String(margin.count) })}
      </p>
      {/* UX設計 §3-5: fork choice ルールの説明行に用語集アンカーを乗せる
          （見出しを兼ねる文全体をアンカーにする。既存の GlossaryTerm 利用例
          はいずれもフィールド名程度の短い語だが、この行は ja/en で訳文の
          構造が異なり共通の部分文字列が無いため、`withTermAnchor` の
          「文中の1語を差し替える」方式は使わず、文全体をラベルにする。
          Issue #413 で glossary に `fiftyOnePercentAttack` が追加される
          前は `GlossaryTerm` が未知語として下線無しでそのまま表示する
          （既存の防御的フォールバック。GlossaryTerm.tsx 参照）。 */}
      <p className="attack51-demo__fork-choice-rule">
        <GlossaryTerm termKey="fiftyOnePercentAttack">
          {t("attack51Demo.forkChoiceRule")}
        </GlossaryTerm>
      </p>
      <p className="attack51-demo__threshold-note">{t("attack51Demo.thresholdNote")}</p>
      <button
        type="button"
        className="attack51-demo__reset nodrag"
        onClick={handleReset}
        data-testid="attack51-demo-reset"
      >
        {t("attack51Demo.reset")}
      </button>
      <p className="attack51-demo__footer-note">{t("attack51Demo.simplifiedNote")}</p>
      <p className="attack51-demo__footer-note">{t("attack51Demo.whoDecides")}</p>
    </div>
  );
}
