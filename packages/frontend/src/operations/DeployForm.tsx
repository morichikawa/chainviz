import { type FormEvent, useState } from "react";
import type { ContractCatalogEntry } from "../chain-profiles/ethereum/operationCatalog.js";
import { pickLocale } from "../i18n/i18n.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { OperationArgInput } from "./OperationArgInput.js";
import { validateOperationArgs } from "./operationArgValidation.js";

export interface DeployFormProps {
  catalog: ContractCatalogEntry[];
  onSubmit: (params: { contractKey: string; constructorArgs: string[] }) => void;
}

/**
 * 定型操作パネルの「デプロイ」タブ（ARCHITECTURE.md §6.5-2）。カタログ
 * （フロント表現セットの静的データ）掲載分から選び、コンストラクタ引数は
 * 引数名をラベルにしたテキスト入力で受け付ける。値の実際の型解釈
 * （エンコード）は collector 側の ChainAdapter が行うため、ここでは文字列の
 * まま渡す（§6.10 決定事項2）。ただし送信前に、ABI型（uint/address）と
 * 明らかに矛盾する入力は `validateOperationArgs` で弾き、送信ボタンを
 * 無効化する（Issue #209: forge の生パーサーエラーがそのままトースト表示
 * される不具合の対策）。
 */
export function DeployForm({ catalog, onSubmit }: DeployFormProps) {
  const { t, lang } = useLanguage();
  const [selectedKey, setSelectedKey] = useState(catalog[0]?.catalogKey ?? "");
  const [args, setArgs] = useState<string[]>(
    () => catalog[0]?.constructorArgs.map(() => "") ?? [],
  );

  const selected = catalog.find((entry) => entry.catalogKey === selectedKey);

  const selectContract = (catalogKey: string) => {
    setSelectedKey(catalogKey);
    const entry = catalog.find((e) => e.catalogKey === catalogKey);
    setArgs(entry ? entry.constructorArgs.map(() => "") : []);
  };

  const setArgAt = (index: number, value: string) => {
    setArgs((current) => {
      const next = [...current];
      next[index] = value;
      return next;
    });
  };

  const canSubmit =
    selected !== undefined && validateOperationArgs(selected.constructorArgs, args);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !selected) return;
    onSubmit({ contractKey: selected.catalogKey, constructorArgs: args });
  };

  return (
    <form className="operation-form" onSubmit={handleSubmit}>
      <label className="operation-field">
        <span className="operation-field__label">
          {t("operation.deploy.contract")}
        </span>
        <select
          className="operation-field__input nodrag"
          value={selectedKey}
          onChange={(event) => selectContract(event.target.value)}
          data-testid="operation-deploy-contract"
        >
          {catalog.map((entry) => (
            <option key={entry.catalogKey} value={entry.catalogKey}>
              {pickLocale(entry.displayName, lang)} —{" "}
              {pickLocale(entry.description, lang)}
            </option>
          ))}
        </select>
      </label>
      {selected?.constructorArgs.map((arg, index) => (
        <OperationArgInput
          key={arg.name}
          field={arg}
          value={args[index] ?? ""}
          onChange={(value) => setArgAt(index, value)}
          testId={`operation-deploy-arg-${arg.name}`}
        />
      ))}
      <p className="operation-form__note">{t("operation.deploy.note")}</p>
      <button
        type="submit"
        className="operation-form__submit nodrag"
        disabled={!canSubmit}
      >
        {t("operation.deploy.submit")}
      </button>
    </form>
  );
}
