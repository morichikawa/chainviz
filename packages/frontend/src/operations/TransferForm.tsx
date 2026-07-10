import { type FormEvent, useState } from "react";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { AddressField } from "./AddressField.js";
import { parseEtherToWei } from "./etherAmount.js";
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
 */
export function TransferForm({ walletCandidates, onSubmit }: TransferFormProps) {
  const { t } = useLanguage();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");

  const amountWei = parseEtherToWei(amount);
  const canSubmit = to.trim() !== "" && amountWei !== undefined;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({ to: to.trim(), amountWei });
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
        type="submit"
        className="operation-form__submit nodrag"
        disabled={!canSubmit}
      >
        {t("operation.transfer.submit")}
      </button>
    </form>
  );
}
