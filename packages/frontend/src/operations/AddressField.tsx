import { useId } from "react";
import type { WalletCandidate } from "./walletCandidates.js";

export interface AddressFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  candidates: WalletCandidate[];
  testId?: string;
}

/**
 * アドレス型の入力欄。キャンバス上の既存ウォレットを `<datalist>` の候補として
 * 提示しつつ、自由入力（アドレス直打ち）も受け付ける（ARCHITECTURE.md §6.5
 * 「宛先: キャンバス上の既存ウォレットから選択 … 自由入力（アドレス直打ち）
 * も可」「アドレス型の引数には既存ウォレットの候補を提示する」）。送金先・
 * 呼び出し引数のアドレス型フィールドの両方から使う共通コンポーネント。
 */
export function AddressField({
  label,
  value,
  onChange,
  candidates,
  testId,
}: AddressFieldProps) {
  const listId = useId();
  return (
    <label className="operation-field">
      <span className="operation-field__label">{label}</span>
      <input
        type="text"
        className="operation-field__input nodrag"
        value={value}
        list={listId}
        onChange={(event) => onChange(event.target.value)}
        data-testid={testId}
      />
      <datalist id={listId}>
        {candidates.map((candidate) => (
          <option key={candidate.address} value={candidate.address}>
            {candidate.label}
          </option>
        ))}
      </datalist>
    </label>
  );
}
