import { type FormEvent, useState } from "react";
import type { ContractCatalogEntry } from "../chain-profiles/ethereum/operationCatalog.js";
import { pickLocale } from "../i18n/i18n.js";
import { useLanguage } from "../i18n/LanguageProvider.js";

export interface DeployFormProps {
  catalog: ContractCatalogEntry[];
  onSubmit: (params: { contractKey: string; constructorArgs: string[] }) => void;
}

/**
 * 定型操作パネルの「デプロイ」タブ（ARCHITECTURE.md §6.5-2）。カタログ
 * （フロント表現セットの静的データ）掲載分から選び、コンストラクタ引数は
 * 引数名をラベルにしたテキスト入力で受け付ける。値の型解釈は collector
 * 側の ChainAdapter が行うため、ここでは文字列のまま渡す（§6.10 決定事項2）。
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

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
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
        <label className="operation-field" key={arg.name}>
          <span className="operation-field__label">{arg.name}</span>
          <input
            type="text"
            className="operation-field__input nodrag"
            value={args[index] ?? ""}
            onChange={(event) => setArgAt(index, event.target.value)}
            data-testid={`operation-deploy-arg-${arg.name}`}
          />
        </label>
      ))}
      <p className="operation-form__note">{t("operation.deploy.note")}</p>
      <button
        type="submit"
        className="operation-form__submit nodrag"
        disabled={!selected}
      >
        {t("operation.deploy.submit")}
      </button>
    </form>
  );
}
