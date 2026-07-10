import type {
  OperationArgField,
  OperationArgType,
} from "../chain-profiles/ethereum/operationCatalog.js";
import { parseUnits } from "./tokenAmount.js";

/**
 * デプロイのコンストラクタ引数・コントラクト呼び出しの関数引数について、
 * ABI型情報（`OperationArgField.type`）に基づき送信前にクライアント側で
 * 明らかな型不一致を弾く（Issue #209）。
 *
 * ARCHITECTURE.md §6.10 決定事項2により、値の実際の型解釈・エンコード
 * （`uint256`への変換等）は collector 側の ChainAdapter が行う設計を
 * 変更しない。ここではその手前で「見た目が明らかに型と合わない入力
 * （例: uint 引数に "test"）」を防ぐだけの簡易チェックに留める。
 */

/** 非負整数（先頭ゼロ許容・符号なし・小数/指数表記なし・空文字不可）。 */
const UINT_PATTERN = /^\d+$/;

/** `0x` + 40桁16進数（大文字小文字混在可。EIP-55チェックサムは検証しない）。 */
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * 単一の引数値がABI型と矛盾しないかを判定する。
 *
 * `string`/`bool`は現状カタログ（ChainvizToken/Counter）で使われておらず、
 * このIssueのスコープ外のため常に妥当として扱う（自由入力のまま通す）。
 */
export function isValidOperationArgValue(
  type: OperationArgType,
  rawValue: string,
): boolean {
  const value = rawValue.trim();
  switch (type) {
    case "uint":
      return UINT_PATTERN.test(value);
    case "address":
      return ADDRESS_PATTERN.test(value);
    case "string":
    case "bool":
      return true;
    default:
      return true;
  }
}

/**
 * 引数フィールドの並びと、対応する入力値の並びをまとめて検証する。
 * `values`は`fields`と同じ長さ・順序であることを前提にする
 * （DeployForm/CallFormの`args`ステートがそうであるように）。
 *
 * `field.unit === "token"` の引数は通常のABI型チェック（uintの整数専用
 * パターン）ではなく、`tokenDecimals`桁のトークン単位10進入力として
 * `parseUnits`で検証する（Issue #219）。`tokenDecimals`が省略されている
 * （対象コントラクトのtoken情報が取れない）場合は、単位換算ができないため
 * 安全側に倒して常に無効とする。
 */
export function validateOperationArgs(
  fields: OperationArgField[],
  values: string[],
  tokenDecimals?: number,
): boolean {
  return fields.every((field, index) => {
    const value = values[index] ?? "";
    if (field.unit === "token") {
      return tokenDecimals !== undefined && parseUnits(value, tokenDecimals) !== undefined;
    }
    return isValidOperationArgValue(field.type, value);
  });
}

/**
 * 送信直前に、`unit === "token"`の引数だけトークン単位の入力を
 * `tokenDecimals`桁の最小単位の10進文字列へ変換する。他の引数はそのまま
 * 返す（値の実際の型解釈・エンコードはcollector側のChainAdapterが担う設計
 * を変えないため。ARCHITECTURE.md §6.10 決定事項2）。
 *
 * 呼び出し側は事前に`validateOperationArgs`で全引数が妥当なことを
 * 確認してから呼ぶ前提。防御的に、変換できない値（不正な入力や
 * `tokenDecimals`未指定）はそのままの文字列を返す（クラッシュさせず、
 * 送信自体はcollector側のエンコードエラーとして扱われる）。
 */
export function convertOperationArgsToChainValues(
  fields: OperationArgField[],
  values: string[],
  tokenDecimals?: number,
): string[] {
  return fields.map((field, index) => {
    const value = values[index] ?? "";
    if (field.unit === "token" && tokenDecimals !== undefined) {
      return parseUnits(value, tokenDecimals) ?? value;
    }
    return value;
  });
}
