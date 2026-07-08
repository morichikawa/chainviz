import type {
  ContractEntity,
  DecodedArgument,
  TransactionEntity,
} from "@chainviz/shared";
import { shortHex } from "./transaction.js";

/**
 * WalletPopover の tx 一覧に追記する「呼び出し内容」（ARCHITECTURE.md §6.6
 * 「WalletPopover の tx 一覧に呼び出し内容を追記する」）の導出。純粋な
 * データ変換のみを持ち、i18n 文言（`tx.chip.deploy`）の適用は呼び出し側
 * （WalletPopover.tsx）に委ねる。
 */

/** 呼び出し内容プレビューに出す引数の上限件数（§6.6「先頭 1〜2 個のプレビュー」）。 */
export const MAX_ARG_PREVIEW = 2;

export type TxCallPreviewKind = "call" | "deploy";

export interface TxCallPreview {
  kind: TxCallPreviewKind;
  /**
   * 呼び出し内容のラベル。`kind === "call"` のときのみ意味を持ち、
   * `functionName` → `rawFunctionId` 短縮 → tx hash 短縮の優先順で必ず
   * 何らかの文字列になる（WalletCard の `txChipLabel` と同じ優先順）。
   * `kind === "deploy"` のときは undefined（呼び出し側が
   * `tx.chip.deploy` の訳語に置き換える）。
   */
  label?: string;
  /** 引数の先頭 `MAX_ARG_PREVIEW` 件（`kind === "deploy"` のときは常に空）。 */
  argsPreview: DecodedArgument[];
  /** 呼び出し先（call）または作成先（deploy）のコントラクトアドレス。 */
  contractAddress: string;
  /** 宛先コントラクト名。カタログで特定できない/未観測なら undefined
   *（呼び出し側が `shortHex(contractAddress)` にフォールバックする）。 */
  contractName?: string;
}

/**
 * 1件の tx から「呼び出し内容」プレビューを導出する。
 *
 * 優先順位は `transaction.ts` の `txChipLabel` と揃える（デプロイ tx は
 * `to: null` かつ `contractCall` を持たない前提のため実際に優先順位が競合
 * することは無いが、判定ロジックの一貫性のため揃えておく）。
 * - `contractCall.functionName` があれば呼び出し（`kind: "call"`）。
 * - 無ければ `createdContractAddress` があればデプロイ（`kind: "deploy"`）。
 * - どちらも無く `contractCall` があれば呼び出し（`rawFunctionId` の短縮表示、
 *   それも無ければ tx hash の短縮表示をラベルにする）。
 * - どれも無い素の送金は undefined（呼び出し内容を追記しない）。
 */
export function deriveTxCallPreview(
  tx: TransactionEntity,
  contractsByAddress: ReadonlyMap<string, ContractEntity>,
): TxCallPreview | undefined {
  if (tx.contractCall?.functionName !== undefined) {
    const { contractAddress, functionName, args } = tx.contractCall;
    return {
      kind: "call",
      label: functionName,
      argsPreview: (args ?? []).slice(0, MAX_ARG_PREVIEW),
      contractAddress,
      contractName: contractsByAddress.get(contractAddress)?.name,
    };
  }

  if (tx.createdContractAddress !== undefined) {
    return {
      kind: "deploy",
      argsPreview: [],
      contractAddress: tx.createdContractAddress,
      contractName: contractsByAddress.get(tx.createdContractAddress)?.name,
    };
  }

  if (tx.contractCall) {
    const { contractAddress, rawFunctionId, args } = tx.contractCall;
    const label = rawFunctionId !== undefined ? shortHex(rawFunctionId) : shortHex(tx.hash);
    return {
      kind: "call",
      label,
      argsPreview: (args ?? []).slice(0, MAX_ARG_PREVIEW),
      contractAddress,
      contractName: contractsByAddress.get(contractAddress)?.name,
    };
  }

  return undefined;
}
