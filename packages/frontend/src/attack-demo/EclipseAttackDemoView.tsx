import { useEffect, useRef, useState } from "react";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { format } from "../i18n/i18n.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { NEW_ARRIVAL_HIGHLIGHT_DURATION_MS } from "../entities/useNewArrivalHighlight.js";
import { EclipseAttackPeerGraph } from "./EclipseAttackPeerGraph.js";
import {
  ECLIPSE_DEMO_SLOT_COUNT,
  addAttackerPeer,
  attackerCount,
  createInitialEclipseAttackDemoState,
  isFullyEclipsed,
  nextHonestSlotIndex,
  resetEclipseAttackDemoState,
  visibleChainBlockKeys,
  type EclipseAttackDemoState,
} from "./eclipseAttackDemo.js";

/**
 * 「eclipse攻撃のしくみ」デモの中身（`kind: "eclipseAttackDemo"`。Issue #416。
 * `docs/worklog/issue-416.md` UX設計 §3）。
 *
 * 状態はこのコンポーネントにローカルな `useState` で完結する
 * （`hashChainDemo`/`signatureDemo` と同じ流儀。`SidePanelView` 側には
 * 何も持たせない）。パネルを閉じて開き直すと必ず
 * `createInitialEclipseAttackDemoState()`（8/8正規ピア）から始まる。
 */
export function EclipseAttackDemoView() {
  const { t } = useLanguage();
  const [state, setState] = useState<EclipseAttackDemoState>(
    createInitialEclipseAttackDemoState,
  );
  const [flashingSlotIndex, setFlashingSlotIndex] = useState<number | null>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    },
    [],
  );

  function flash(index: number) {
    setFlashingSlotIndex(index);
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = setTimeout(() => {
      setFlashingSlotIndex(null);
      flashTimeoutRef.current = null;
    }, NEW_ARRIVAL_HIGHLIGHT_DURATION_MS);
  }

  function handleAddAttacker() {
    // 置き換わる対象のインデックスは、state を更新する「前」に算出する
    // （更新後は既に置き換わってしまっており、どこが変わったか分からない
    // ため）。全スロットが既に攻撃者なら何もしない（ボタンは disabled の
    // はずだが、addAttackerPeer 自身も no-op で安全側に倒れる）。
    const index = nextHonestSlotIndex(state);
    if (index === null) return;
    setState((prev) => addAttackerPeer(prev));
    flash(index);
  }

  function handleReset() {
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = null;
    setFlashingSlotIndex(null);
    setState(resetEclipseAttackDemoState());
  }

  const count = attackerCount(state);
  const percent = Math.round((count / ECLIPSE_DEMO_SLOT_COUNT) * 100);
  const eclipsed = isFullyEclipsed(state);
  const addDisabled = count >= ECLIPSE_DEMO_SLOT_COUNT;
  const chainBlockKeys = visibleChainBlockKeys(state);

  return (
    <div className="eclipse-demo" data-testid="eclipse-demo">
      <p className="eclipse-demo__intro">{t("eclipseDemo.intro")}</p>

      <EclipseAttackPeerGraph
        slots={state.slots}
        flashingSlotIndex={flashingSlotIndex}
        eclipsed={eclipsed}
      />

      <div className="eclipse-demo__meter" data-testid="eclipse-demo-meter">
        <div className="eclipse-demo__meter-track">
          <div
            className="eclipse-demo__meter-fill"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="eclipse-demo__meter-text" aria-live="polite">
          {format(t("eclipseDemo.occupancy"), {
            count: String(count),
            total: String(ECLIPSE_DEMO_SLOT_COUNT),
            percent: String(percent),
          })}
        </p>
      </div>

      <div className="eclipse-demo__actions">
        <button
          type="button"
          className="eclipse-demo__add nodrag"
          onClick={handleAddAttacker}
          disabled={addDisabled}
          data-testid="eclipse-demo-add-attacker"
        >
          {addDisabled ? t("eclipseDemo.allSlotsOccupied") : t("eclipseDemo.addAttacker")}
        </button>
        <button
          type="button"
          className="eclipse-demo__reset nodrag"
          onClick={handleReset}
          data-testid="eclipse-demo-reset"
        >
          {t("eclipseDemo.reset")}
        </button>
      </div>

      <div className="eclipse-demo__view" data-testid="eclipse-demo-view">
        <p className="eclipse-demo__view-label">{t("eclipseDemo.viewLabel")}</p>
        <ul className="eclipse-demo__blocks">
          {chainBlockKeys.map((key) => (
            <li key={key} className="eclipse-demo__block">
              {t(key)}
            </li>
          ))}
        </ul>
        <span
          className={
            eclipsed
              ? "eclipse-demo__badge eclipse-demo__badge--fake"
              : "eclipse-demo__badge eclipse-demo__badge--real"
          }
          data-testid="eclipse-demo-badge"
        >
          {eclipsed ? t("eclipseDemo.badge.fake") : t("eclipseDemo.badge.real")}
        </span>
      </div>

      {eclipsed && (
        <p className="eclipse-demo__warning" data-testid="eclipse-demo-warning">
          {t("eclipseDemo.eclipsedWarning")}
        </p>
      )}

      <p className="eclipse-demo__footer-note">{t("eclipseDemo.simplifiedNote")}</p>
      <p className="eclipse-demo__footer-note">{t("eclipseDemo.defenseNote")}</p>
      {/* UX設計 §3レイアウト8: discovery/bootnode 用語への軽い接続（必須ではない
          追加要素）。sigDemo の otherVerifications と同じ「文の下に用語チップを
          並べる」流儀（文中の部分文字列一致が言語ごとに異なり脆いため、
          `withTermAnchor` ではなくこちらを使う）。 */}
      <p className="eclipse-demo__footer-links">
        <GlossaryTerm termKey="discovery" />
        <GlossaryTerm termKey="bootnode" />
      </p>
    </div>
  );
}
