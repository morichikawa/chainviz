import type { OperationArgField } from "../chain-profiles/ethereum/operationCatalog.js";
import { format } from "../i18n/i18n.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import type { MessageKey } from "../i18n/messages.js";
import { AddressField } from "./AddressField.js";
import { isValidOperationArgValue } from "./operationArgValidation.js";
import { parseUnits } from "./tokenAmount.js";
import type { WalletCandidate } from "./walletCandidates.js";

export interface OperationArgInputProps {
  field: OperationArgField;
  value: string;
  onChange: (value: string) => void;
  /** address型の入力補助に使う既存ウォレットの候補（省略時は候補なし）。 */
  walletCandidates?: WalletCandidate[];
  /**
   * `field.unit === "token"` のときのトークン情報（symbol/decimals）。
   * 省略時は単位換算を行わず、通常のABI型（uint = 最小単位の整数）として
   * 扱う（Issue #219）。
   */
  tokenInfo?: { symbol: string; decimals: number };
  testId: string;
}

/** ABI型ごとに送信前に検証する型のみエラー文言キーを持つ（§209のスコープ）。 */
const ERROR_MESSAGE_KEY: Partial<Record<OperationArgField["type"], MessageKey>> = {
  uint: "operation.arg.invalid.uint",
  address: "operation.arg.invalid.address",
};

/**
 * デプロイのコンストラクタ引数・コントラクト呼び出しの関数引数、共通の
 * 1引数ぶんの入力欄（ARCHITECTURE.md §6.5）。`DeployForm`/`CallForm`
 * どちらもほぼ同じマークアップ（引数名をラベルにしたテキスト入力、
 * address型は既存ウォレットの候補提示）だったため共通化し、あわせて
 * ABI型に基づく送信前バリデーション（Issue #209）を一箇所に閉じ込める。
 *
 * 値の実際の型解釈・エンコードは引き続き collector 側の ChainAdapter が
 * 行う（ARCHITECTURE.md §6.10 決定事項2）。ここでは「明らかに型と矛盾する
 * 入力」を送信前に防ぐだけの簡易チェックに留め、無効な間はエラー文言を
 * 表示する（送信ボタンの無効化は呼び出し側の `canSubmit` が担う）。
 *
 * `field.unit === "token"` かつ `tokenInfo` がある引数は、トークン単位の
 * 10進入力として扱い、ラベルに単位（例:「（CVZ単位）」）を添えて表示する
 * （Issue #219: 単位換算方式。実際の最小単位への変換は送信直前に
 * `convertOperationArgsToChainValues` が行うため、ここでは検証のみ）。
 */
export function OperationArgInput({
  field,
  value,
  onChange,
  walletCandidates = [],
  tokenInfo,
  testId,
}: OperationArgInputProps) {
  const { t } = useLanguage();
  const isTokenUnit = field.unit === "token" && tokenInfo !== undefined;

  const errorKey = isTokenUnit ? "operation.arg.invalid.token" : ERROR_MESSAGE_KEY[field.type];
  const isValid = isTokenUnit
    ? parseUnits(value, tokenInfo.decimals) !== undefined
    : isValidOperationArgValue(field.type, value);
  const showError = errorKey !== undefined && value.trim() !== "" && !isValid;

  const label = isTokenUnit
    ? `${field.name}${format(t("operation.arg.tokenUnitSuffix"), { symbol: tokenInfo.symbol })}`
    : field.name;

  return (
    <>
      {field.type === "address" ? (
        <AddressField
          label={field.name}
          value={value}
          onChange={onChange}
          candidates={walletCandidates}
          testId={testId}
        />
      ) : (
        <label className="operation-field">
          <span className="operation-field__label">{label}</span>
          <input
            type="text"
            className="operation-field__input nodrag"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            data-testid={testId}
          />
        </label>
      )}
      {showError && errorKey && (
        <p className="operation-form__error" data-testid={`${testId}-error`}>
          {t(errorKey)}
        </p>
      )}
    </>
  );
}
