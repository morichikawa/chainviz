import { type FormEvent, useState } from "react";
import { useLanguage } from "../i18n/LanguageProvider.js";
import type { DeployedContractCandidate } from "./deployedContracts.js";
import { parseEtherToWei } from "./etherAmount.js";
import { OperationArgInput } from "./OperationArgInput.js";
import { validateOperationArgs } from "./operationArgValidation.js";
import type { WalletCandidate } from "./walletCandidates.js";

export interface CallFormProps {
  deployedContracts: DeployedContractCandidate[];
  walletCandidates: WalletCandidate[];
  onSubmit: (params: {
    contractAddress: string;
    functionName: string;
    args: string[];
    amountWei?: string;
  }) => void;
  /** 呼び出せるコントラクトが無いときに「デプロイ」タブへ切り替える導線用。 */
  onSwitchToDeploy: () => void;
}

/**
 * 定型操作パネルの「コントラクト呼び出し」タブ（ARCHITECTURE.md §6.5-3）。
 * 対象はキャンバス上のデプロイ済み・カタログ既知のコントラクトのみ選択肢に
 * 出す。関数はカタログのフォーム定義から選び、引数は引数名をラベルにした
 * テキスト入力（アドレス型は既存ウォレットの候補を提示）。payable な関数の
 * ときだけ金額欄を出す。
 */
export function CallForm({
  deployedContracts,
  walletCandidates,
  onSubmit,
  onSwitchToDeploy,
}: CallFormProps) {
  const { t } = useLanguage();
  const [contractAddress, setContractAddress] = useState(
    deployedContracts[0]?.address ?? "",
  );
  const selectedContract = deployedContracts.find(
    (c) => c.address === contractAddress,
  );
  const [functionSignature, setFunctionSignature] = useState(
    selectedContract?.catalog.functions[0]?.signature ?? "",
  );
  const selectedFunction = selectedContract?.catalog.functions.find(
    (fn) => fn.signature === functionSignature,
  );
  const [args, setArgs] = useState<string[]>(
    () => selectedFunction?.args.map(() => "") ?? [],
  );
  const [amount, setAmount] = useState("");

  if (deployedContracts.length === 0) {
    return (
      <div className="operation-form">
        <p className="operation-form__note">{t("operation.call.empty")}</p>
        <button
          type="button"
          className="operation-form__submit nodrag"
          onClick={onSwitchToDeploy}
          data-testid="operation-call-switch-to-deploy"
        >
          {t("operation.tab.deploy")}
        </button>
      </div>
    );
  }

  const selectContract = (address: string) => {
    setContractAddress(address);
    const contract = deployedContracts.find((c) => c.address === address);
    const firstFn = contract?.catalog.functions[0];
    setFunctionSignature(firstFn?.signature ?? "");
    setArgs(firstFn ? firstFn.args.map(() => "") : []);
  };

  const selectFunction = (signature: string) => {
    setFunctionSignature(signature);
    const fn = selectedContract?.catalog.functions.find(
      (candidate) => candidate.signature === signature,
    );
    setArgs(fn ? fn.args.map(() => "") : []);
  };

  const setArgAt = (index: number, value: string) => {
    setArgs((current) => {
      const next = [...current];
      next[index] = value;
      return next;
    });
  };

  const amountWei = amount.trim() === "" ? undefined : parseEtherToWei(amount);
  const amountInvalid = amount.trim() !== "" && amountWei === undefined;
  const argsValid = selectedFunction
    ? validateOperationArgs(selectedFunction.args, args)
    : false;
  const canSubmit =
    selectedFunction !== undefined && !amountInvalid && argsValid;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedFunction || !selectedContract) return;
    if (amountInvalid || !argsValid) return;
    onSubmit({
      contractAddress: selectedContract.address,
      functionName: selectedFunction.signature,
      args,
      amountWei,
    });
  };

  return (
    <form className="operation-form" onSubmit={handleSubmit}>
      <label className="operation-field">
        <span className="operation-field__label">{t("operation.call.target")}</span>
        <select
          className="operation-field__input nodrag"
          value={contractAddress}
          onChange={(event) => selectContract(event.target.value)}
          data-testid="operation-call-target"
        >
          {deployedContracts.map((candidate) => (
            <option key={candidate.address} value={candidate.address}>
              {candidate.label}
            </option>
          ))}
        </select>
      </label>
      <label className="operation-field">
        <span className="operation-field__label">
          {t("operation.call.function")}
        </span>
        <select
          className="operation-field__input nodrag"
          value={functionSignature}
          onChange={(event) => selectFunction(event.target.value)}
          data-testid="operation-call-function"
        >
          {selectedContract?.catalog.functions.map((fn) => (
            <option key={fn.signature} value={fn.signature}>
              {fn.label}
            </option>
          ))}
        </select>
      </label>
      {selectedFunction?.args.map((arg, index) => (
        <OperationArgInput
          key={arg.name}
          field={arg}
          value={args[index] ?? ""}
          onChange={(value) => setArgAt(index, value)}
          walletCandidates={walletCandidates}
          testId={`operation-call-arg-${arg.name}`}
        />
      ))}
      {selectedFunction?.payable && (
        <>
          <label className="operation-field">
            <span className="operation-field__label">
              {t("operation.call.amount")}
            </span>
            <input
              type="text"
              className="operation-field__input nodrag"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              data-testid="operation-call-amount"
            />
          </label>
          {amountInvalid && (
            <p className="operation-form__error">
              {t("operation.transfer.amount.invalid")}
            </p>
          )}
        </>
      )}
      <button
        type="submit"
        className="operation-form__submit nodrag"
        disabled={!canSubmit}
      >
        {t("operation.call.submit")}
      </button>
    </form>
  );
}
