import type { ContractEntity, TokenBalance } from "@chainviz/shared";
import { formatUnits } from "./tokenAmount.js";
import { shortHex } from "./transaction.js";

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

/**
 * トークン残高チップ（`WalletCard`）／ポップオーバーのトークン残高行
 * （`WalletPopover`）に出す「コントラクト名（アドレス短縮表記）」ラベル
 * （Issue #218 派生）。
 *
 * 同名のトークンコントラクトが複数デプロイされている場合（例:
 * ChainvizToken を2回デプロイした環境）、名前だけでは区別できない。常に
 * アドレスの短縮表記を併記することで、名前が同じでも別コントラクトだと
 * 分かるようにする。`contractName` が未特定（カタログ外コントラクト）の
 * 場合は呼び出し側が用意した `unknownLabel`（i18n 訳語）で置き換える。
 */
export function formatTokenContractLabel(
  balance: Pick<ResolvedTokenBalance, "contractName" | "contractAddress">,
  unknownLabel: string,
): string {
  return `${balance.contractName ?? unknownLabel} (${shortHex(balance.contractAddress)})`;
}
