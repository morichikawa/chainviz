import type { ContractEntity, TokenBalance } from "@chainviz/shared";
import { formatUnits } from "./tokenAmount.js";

/**
 * `WalletCard`/`WalletPopover` に出す、1件のトークン残高（対応する
 * `ContractEntity` の `token` メタ情報と突き合わせ済み）。
 */
export interface ResolvedTokenBalance {
  contractAddress: string;
  /** `ContractEntity.token.symbol`。 */
  symbol: string;
  /** コントラクトの表示名。カタログで特定できていない場合は undefined。 */
  contractName?: string;
  /** `token.decimals` 桁を反映した人間可読な残高表記。 */
  formatted: string;
}

/**
 * `WalletEntity.tokenBalances` を対応する `ContractEntity`（`contractAddress`
 * で照合）と突き合わせ、表示用に解決する（ARCHITECTURE.md §6.7）。
 *
 * 対応する `ContractEntity` がまだ観測できていない、または観測できていても
 * `token`（symbol/decimals）を持たない場合、その1件は結果から除外する
 * （「ダングリングガード」の流儀。symbol/decimals が不明な生の数値を
 * アドレスだけで出しても桁の意味が分からず混乱を招くため、非表示を選ぶ。
 * ARCHITECTURE.md「対応する ContractEntity が未観測の tokenBalance は
 * 表示しない」）。
 *
 * `tokenBalances` が省略・空なら空配列を返す（呼び出し側はこれを
 * 「トークン残高セクション自体を出さない」判定に使う）。
 */
export function resolveWalletTokenBalances(
  tokenBalances: TokenBalance[] | undefined,
  contractsByAddress: ReadonlyMap<string, ContractEntity>,
): ResolvedTokenBalance[] {
  if (!tokenBalances || tokenBalances.length === 0) return [];

  const resolved: ResolvedTokenBalance[] = [];
  for (const balance of tokenBalances) {
    const contract = contractsByAddress.get(balance.contractAddress);
    if (!contract?.token) continue;
    resolved.push({
      contractAddress: balance.contractAddress,
      symbol: contract.token.symbol,
      contractName: contract.name,
      formatted: formatUnits(balance.amount, contract.token.decimals),
    });
  }
  return resolved;
}
