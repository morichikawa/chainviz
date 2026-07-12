import type { TransactionEntity } from "@chainviz/shared";

/**
 * チェーンリボンのタイルホバー連動ハイライト（Issue #298 第2段階。
 * ARCHITECTURE.md §9.1）に使う純粋関数。「あるブロックに取り込まれた tx の
 * 送信元/宛先/呼び出し先/デプロイ先アドレス」を導出する。ウォレット/
 * コントラクトカードはこの集合に自分の address が含まれるかどうかで
 * ハイライト表示を判定する（`RibbonHoverContext.tsx` から利用）。
 *
 * アドレスは小文字に正規化して返す。`TransactionEntity.from`/
 * `contractCall.contractAddress`/`createdContractAddress` はチェーン側の
 * 生の表記（Ethereum アダプタでは全小文字）である一方、カード側の
 * `entity.address` は EIP-55 チェックサム表記になりうるため
 * （`addressCasing.ts` の docstring と同じ理由）、呼び出し側が
 * `entity.address.toLowerCase()` と突き合わせる前提の関数にする。
 */
export function deriveBlockRelatedAddresses(
  blockHash: string,
  transactions: readonly TransactionEntity[],
): Set<string> {
  const addresses = new Set<string>();
  for (const tx of transactions) {
    if (tx.blockHash !== blockHash) continue;
    addresses.add(tx.from.toLowerCase());
    if (tx.to !== null) addresses.add(tx.to.toLowerCase());
    if (tx.contractCall) {
      addresses.add(tx.contractCall.contractAddress.toLowerCase());
    }
    if (tx.createdContractAddress) {
      addresses.add(tx.createdContractAddress.toLowerCase());
    }
  }
  return addresses;
}
