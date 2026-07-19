import type { ChangeEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { shortHex } from "../entities/transaction.js";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { NEW_ARRIVAL_HIGHLIGHT_DURATION_MS } from "../entities/useNewArrivalHighlight.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import {
  ALICE_ADDRESS,
  ALICE_SANDBOX_PRIVATE_KEY,
  createInitialSignatureDemoState,
  deriveRecoveredAddress,
  deriveSignature,
  isValid,
  resetSignatureDemoState,
  resignAsAlice,
  resignAsAttacker,
  updateReceivedContent,
  updateWorkbenchContent,
  type SignatureDemoState,
  type TxDraft,
} from "./signatureDemo.js";

/** 直前に押した再署名ボタンの種類（`sigDemo.resignAttackerResult` /
 * `sigDemo.resignAliceResult` の結果メッセージの表示条件にのみ使う。
 * `hashChainDemo` の `hasInteracted` と同じ理由: 純粋ロジック側の
 * `isValid` だけでは「初期状態からまだ何もしていない」と「たった今
 * 再署名した」を区別できないため、View 側のローカル state で持つ。 */
type LastAction = "attacker" | "alice" | null;

/** 値が変わった直後だけ短くフラッシュする（Issue #401 の流儀を再利用）。 */
function useFlash(value: string): boolean {
  const [flashing, setFlashing] = useState(false);
  const previousRef = useRef(value);
  useEffect(() => {
    if (previousRef.current === value) return;
    previousRef.current = value;
    setFlashing(true);
    const timeout = setTimeout(() => setFlashing(false), NEW_ARRIVAL_HIGHLIGHT_DURATION_MS);
    return () => clearTimeout(timeout);
  }, [value]);
  return flashing;
}

/**
 * 「署名と検証のしくみ」デモの中身（`kind: "signatureDemo"`。Issue #402。
 * `docs/worklog/issue-402.md` UX設計・実装設計メモ）。
 *
 * 状態はこのコンポーネントにローカルな `useState` で完結する
 * （`SidePanelView` 側には何も持たせない。`HashChainDemoView` と同じ判断）。
 * パネルを閉じて開き直すと必ず `createInitialSignatureDemoState()` から
 * 始まる。
 */
export function SignatureDemoView() {
  const { t } = useLanguage();
  const [state, setState] = useState<SignatureDemoState>(createInitialSignatureDemoState);
  const [lastAction, setLastAction] = useState<LastAction>(null);

  function handleWorkbenchChange(patch: Partial<TxDraft>) {
    setState((prev) => updateWorkbenchContent(prev, patch));
    setLastAction(null);
  }

  function handleReceivedChange(patch: Partial<TxDraft>) {
    setState((prev) => updateReceivedContent(prev, patch));
    setLastAction(null);
  }

  function handleResignAttacker() {
    setState((prev) => resignAsAttacker(prev));
    setLastAction("attacker");
  }

  function handleResignAlice() {
    setState((prev) => resignAsAlice(prev));
    setLastAction("alice");
  }

  function handleReset() {
    setState(resetSignatureDemoState());
    setLastAction(null);
  }

  const signature = deriveSignature(state);
  const recovered = deriveRecoveredAddress(state);
  const valid = isValid(state);
  const signatureFlashing = useFlash(signature);
  const recoveredFlashing = useFlash(recovered);

  return (
    <div className="signature-demo" data-testid="signature-demo">
      <p className="signature-demo__intro">{t("sigDemo.intro")}</p>

      <div className="signature-demo__zone signature-demo__zone--workbench">
        <div className="signature-demo__zone-heading">{t("sigDemo.zone.workbench")}</div>

        <div className="signature-demo__field">
          <span className="signature-demo__field-label">{t("sigDemo.privateKey")}</span>
          <span
            className="signature-demo__field-value"
            title={ALICE_SANDBOX_PRIVATE_KEY}
            data-testid="signature-demo-private-key"
          >
            {shortHex(ALICE_SANDBOX_PRIVATE_KEY)}
          </span>
        </div>
        <p className="signature-demo__note">{t("sigDemo.privateKeyNote")}</p>

        <div className="signature-demo__field">
          <span className="signature-demo__field-label">{t("sigDemo.field.from")}</span>
          <span
            className="signature-demo__field-value"
            title={ALICE_ADDRESS}
            data-testid="signature-demo-from"
          >
            {shortHex(ALICE_ADDRESS)}
          </span>
        </div>
        <p className="signature-demo__note">{t("sigDemo.addressNote")}</p>

        <label className="signature-demo__field signature-demo__field--input">
          <span className="signature-demo__field-label">{t("sigDemo.field.to")}</span>
          <input
            type="text"
            className="signature-demo__input nodrag"
            value={state.sent.content.to}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              handleWorkbenchChange({ to: event.target.value })
            }
            data-testid="signature-demo-workbench-to"
          />
        </label>
        <label className="signature-demo__field signature-demo__field--input">
          <span className="signature-demo__field-label">{t("sigDemo.field.amount")}</span>
          <input
            type="text"
            className="signature-demo__input nodrag"
            value={state.sent.content.amountEth}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              handleWorkbenchChange({ amountEth: event.target.value })
            }
            data-testid="signature-demo-workbench-amount"
          />
        </label>

        <div className="signature-demo__compute" aria-hidden="true">
          <span className="signature-demo__compute-fn">f(x)</span>
          <span className="signature-demo__compute-label">{t("sigDemo.compute.sign")}</span>
        </div>
        <div className="signature-demo__derived">
          <span className="signature-demo__derived-label">{t("sigDemo.signature")}</span>
          <span
            className={
              signatureFlashing
                ? "signature-demo__derived-value signature-demo__derived-value--flash"
                : "signature-demo__derived-value"
            }
            title={signature}
            data-testid="signature-demo-signature"
          >
            {shortHex(signature)}
          </span>
        </div>
      </div>

      <p className="signature-demo__transport">{t("sigDemo.transport")}</p>

      <div className="signature-demo__zone signature-demo__zone--node">
        <div className="signature-demo__zone-heading">{t("sigDemo.zone.node")}</div>

        <label className="signature-demo__field signature-demo__field--input">
          <span className="signature-demo__field-label">{t("sigDemo.field.to")}</span>
          <input
            type="text"
            className="signature-demo__input nodrag"
            value={state.received.to}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              handleReceivedChange({ to: event.target.value })
            }
            data-testid="signature-demo-received-to"
          />
        </label>
        <label className="signature-demo__field signature-demo__field--input">
          <span className="signature-demo__field-label">{t("sigDemo.field.amount")}</span>
          <input
            type="text"
            className="signature-demo__input nodrag"
            value={state.received.amountEth}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              handleReceivedChange({ amountEth: event.target.value })
            }
            data-testid="signature-demo-received-amount"
          />
        </label>
        <p className="signature-demo__hint">{t("sigDemo.tamperHint")}</p>

        <div className="signature-demo__field">
          <span className="signature-demo__field-label">{t("sigDemo.field.receivedSignature")}</span>
          <span
            className="signature-demo__field-value"
            title={signature}
            data-testid="signature-demo-received-signature"
          >
            {shortHex(signature)}
          </span>
        </div>

        <div className="signature-demo__compute" aria-hidden="true">
          <span className="signature-demo__compute-fn">f⁻¹(x)</span>
          <span className="signature-demo__compute-label">{t("sigDemo.compute.verify")}</span>
        </div>
        <p className="signature-demo__note">{t("sigDemo.verifyNote")}</p>
        <div className="signature-demo__derived">
          <span className="signature-demo__derived-label">{t("sigDemo.recovered")}</span>
          <span
            className={
              recoveredFlashing
                ? "signature-demo__derived-value signature-demo__derived-value--flash"
                : "signature-demo__derived-value"
            }
            title={recovered}
            data-testid="signature-demo-recovered"
          >
            {shortHex(recovered)}
          </span>
        </div>

        <div
          className={
            valid
              ? "signature-demo__badge signature-demo__badge--valid"
              : "signature-demo__badge signature-demo__badge--invalid"
          }
          data-testid="signature-demo-badge"
        >
          {valid ? t("sigDemo.badge.valid") : t("sigDemo.badge.invalid")}
        </div>

        {!valid && (
          <div className="signature-demo__actions">
            <button
              type="button"
              className="signature-demo__resign-attacker nodrag"
              onClick={handleResignAttacker}
              data-testid="signature-demo-resign-attacker"
            >
              {t("sigDemo.resignAttacker")}
            </button>
            <button
              type="button"
              className="signature-demo__resign-alice nodrag"
              onClick={handleResignAlice}
              data-testid="signature-demo-resign-alice"
            >
              {t("sigDemo.resignAlice")}
            </button>
          </div>
        )}
        {lastAction === "attacker" && (
          <p className="signature-demo__result" data-testid="signature-demo-result-attacker">
            {t("sigDemo.resignAttackerResult")}
          </p>
        )}
        {lastAction === "alice" && (
          <p className="signature-demo__result" data-testid="signature-demo-result-alice">
            {t("sigDemo.resignAliceResult")}
          </p>
        )}
      </div>

      <button
        type="button"
        className="signature-demo__reset nodrag"
        onClick={handleReset}
        data-testid="signature-demo-reset"
      >
        {t("sigDemo.reset")}
      </button>

      <p className="signature-demo__footer-note">{t("sigDemo.whoVerifies")}</p>
      <p className="signature-demo__footer-note">{t("sigDemo.otherVerifications")}</p>
      <p className="signature-demo__footer-links">
        <GlossaryTerm termKey="attestation">
          {t("sigDemo.otherVerifications.attestation")}
        </GlossaryTerm>
        <GlossaryTerm termKey="engine-api">
          {t("sigDemo.otherVerifications.engineApi")}
        </GlossaryTerm>
      </p>
      <p className="signature-demo__footer-note">{t("sigDemo.simplifiedNote")}</p>
    </div>
  );
}
