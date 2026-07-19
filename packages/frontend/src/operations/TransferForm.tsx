import { type FormEvent, useState } from "react";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { useOptionalSidePanel } from "../side-panel/SidePanelContext.js";
import { AddressField } from "./AddressField.js";
import { parseEtherToWei } from "./etherAmount.js";
import { isValidOperationArgValue } from "./operationArgValidation.js";
import type { WalletCandidate } from "./walletCandidates.js";

export interface TransferFormProps {
  walletCandidates: WalletCandidate[];
  /** 送金コマンドを発行する。amount は wei 文字列に変換済みで渡す。 */
  onSubmit: (params: { to: string; amountWei: string }) => void;
}

/**
 * 定型操作パネルの「送金」タブ（ARCHITECTURE.md §6.5-1）。宛先はキャンバス上の
 * 既存ウォレットからの選択または自由入力、金額は ETH 単位の10進入力を受け付け、
 * 送信直前に wei へ変換する（§6.10 決定事項3）。
 *
 * 宛先はデプロイ/呼び出しフォームのaddress型引数（`operationArgValidation.ts`）
 * と同じ`0x` + 40桁16進の形式チェックを行い、無効な間は送信ボタンを無効化して
 * エラー文言を表示する（Issue #236。金額欄と同じ「未入力はエラー表示せず
 * ボタン無効化のみ、非空の無効値はエラー表示」というパターンに揃える）。
 *
 * フォーム下部・送信ボタンの直前の小リンク（Issue #402）は「今からする
 * 送金の裏側」を開く文脈導線（UX設計 `docs/worklog/issue-402.md` §3導線2。
 * 最も文脈の強い導線として送信操作そのものに隣接させる）。
 * `useOptionalSidePanel()` を使う（`GlossaryTerm` と同じパターン。
 * `SidePanelProvider` の外でレンダーされる既存の単体テストを壊さないため）。
 */
export function TransferForm({ walletCandidates, onSubmit }: TransferFormProps) {
  const { t } = useLanguage();
  const sidePanel = useOptionalSidePanel();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");

  const amountWei = parseEtherToWei(amount);
  const toTrimmed = to.trim();
  const toValid = toTrimmed !== "" && isValidOperationArgValue("address", toTrimmed);
  const canSubmit = toValid && amountWei !== undefined;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({ to: toTrimmed, amountWei });
  };

  return (
    <form className="operation-form" onSubmit={handleSubmit}>
      <p className="operation-form__note">{t("operation.transfer.description")}</p>
      <AddressField
        label={t("operation.transfer.to")}
        value={to}
        onChange={setTo}
        candidates={walletCandidates}
        testId="operation-transfer-to"
      />
      {toTrimmed !== "" && !toValid && (
        <p className="operation-form__error" data-testid="operation-transfer-to-error">
          {t("operation.arg.invalid.address")}
        </p>
      )}
      <label className="operation-field">
        <span className="operation-field__label">
          {t("operation.transfer.amount")}
        </span>
        <input
          type="text"
          className="operation-field__input nodrag"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          data-testid="operation-transfer-amount"
        />
      </label>
      {amount.trim() !== "" && amountWei === undefined && (
        <p className="operation-form__error">
          {t("operation.transfer.amount.invalid")}
        </p>
      )}
      <p className="operation-form__note">{t("operation.transfer.note")}</p>
      <button
        type="button"
        className="operation-form__sig-demo-open nodrag"
        onClick={() => sidePanel?.open({ kind: "signatureDemo" })}
        data-testid="operation-transfer-sig-demo-open"
      >
        {t("sigDemo.open")}
      </button>
      <button
        type="submit"
        className="operation-form__submit nodrag"
        disabled={!canSubmit}
      >
        {t("operation.transfer.submit")}
      </button>
    </form>
  );
}
