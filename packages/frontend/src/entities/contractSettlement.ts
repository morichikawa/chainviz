import type { ContractEntity, TransactionEntity } from "@chainviz/shared";

/**
 * tx確定時のコントラクトへのパルス・確定フラッシュ（ARCHITECTURE.md
 * §6.6「確定時のコントラクトへのパルス」）で使う、確定した tx から対象
 * コントラクトを解決する純粋関数群。実時間へのスケジューリング（React /
 * タイマー側の責務）は `useContractSettlementEffects.ts` に置く
 * （useTxLifecycle / useOperationPulses と同じ分離方針）。
 */

/** tx 確定 1 件が、どのコントラクトへの出来事だったかを表す解決結果。 */
export interface ContractSettlementEvent {
  txHash: string;
  contractAddress: string;
  /** パルスの出発点になる送信元アドレス。 */
  fromAddress: string;
  /** 確定フラッシュを失敗色にするか（tx.status === "failed"）。 */
  failed: boolean;
}

/**
 * 確定した tx 1 件から、対象コントラクトへの確定イベントを導出する。
 *
 * - デプロイ（`createdContractAddress`）を最優先で見る。
 * - 次に呼び出し（`contractCall.contractAddress`）。
 * - 省略されている場合は `to` と既知コントラクトアドレスの照合でフォール
 *   バックする（§4 の制約対応: pending を経ずに観測した呼び出しでは
 *   `contractCall` 自体が省略されることがあるため）。
 * - 対象が定まらない、または対象コントラクトが現在キャンバス上に存在
 *   しない場合は null（ダングリング参照ガード。呼び出し側はパルス・
 *   フラッシュのどちらも出さない）。
 */
export function resolveContractSettlementEvent(
  tx: TransactionEntity,
  knownContractAddresses: ReadonlySet<string>,
): ContractSettlementEvent | null {
  const contractAddress =
    tx.createdContractAddress ??
    tx.contractCall?.contractAddress ??
    (tx.to !== null && tx.to !== undefined && knownContractAddresses.has(tx.to)
      ? tx.to
      : undefined);

  if (contractAddress === undefined) return null;
  if (!knownContractAddresses.has(contractAddress)) return null;

  return {
    txHash: tx.hash,
    contractAddress,
    fromAddress: tx.from,
    failed: tx.status === "failed",
  };
}

/**
 * 確定した tx のハッシュ列（`detectTxSettlements` の出力）から、既知の
 * コントラクトが絡むものだけを確定イベントとして抜き出す。
 */
export function resolveContractSettlementEvents(
  settledHashes: readonly string[],
  txByHash: ReadonlyMap<string, TransactionEntity>,
  contracts: readonly ContractEntity[],
): ContractSettlementEvent[] {
  const known = new Set(contracts.map((c) => c.address));
  const events: ContractSettlementEvent[] = [];
  for (const hash of settledHashes) {
    const tx = txByHash.get(hash);
    if (!tx) continue;
    const event = resolveContractSettlementEvent(tx, known);
    if (event) events.push(event);
  }
  return events;
}
