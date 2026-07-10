import type {
  OperationArgField,
  OperationArgType,
} from "../chain-profiles/ethereum/operationCatalog.js";

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
 */
export function validateOperationArgs(
  fields: OperationArgField[],
  values: string[],
): boolean {
  return fields.every((field, index) =>
    isValidOperationArgValue(field.type, values[index] ?? ""),
  );
}
