import type { ContractEntity } from "@chainviz/shared";

/**
 * `WalletCard`/`WalletPopover` に出す、1件のNFT保有（対応する
 * `ContractEntity` の `nft` メタ情報と突き合わせ済み。Issue #315）。
 */
export interface WalletNftHolding {
  contractAddress: string;
  /** `ContractEntity.nft.symbol`。 */
  symbol: string;
  /** コントラクトの表示名。カタログで特定できていない場合は undefined。 */
  contractName?: string;
  tokenId: string;
}

/**
 * `tokenId`（10進文字列）を数値として比較する。`BigInt` で解釈できない
 * 壊れた値は文字列比較にフォールバックする（`tokenAmount.ts`
 * `formatUnits` と同じ「壊れたメタデータでも例外を投げない」流儀）。
 */
function compareTokenId(a: string, b: string): number {
  try {
    const diff = BigInt(a) - BigInt(b);
    if (diff < 0n) return -1;
    if (diff > 0n) return 1;
    return 0;
  } catch {
    return a.localeCompare(b);
  }
}

/**
 * 台帳はコントラクト側（`ContractEntity.nftTokens`）に持つ設計（Issue #315。
 * docs/worklog/issue-315.md「データモデル」）のため、ウォレット単位の保有
 * 一覧は全コントラクトの台帳から `ownerAddress` 照合で導出する純関数。
 *
 * `resolveWalletTokenBalances`（ARCHITECTURE.md §6.7）と対になるが、走査の
 * 向きが逆（あちらはウォレット自身が持つ `tokenBalances` を起点にコントラクト
 * を引く。こちらはコントラクト側の台帳を起点にウォレットへ寄せる）。
 *
 * - `nft` メタ情報（symbol）を持たない、または `nftTokens` を持たない
 *   コントラクトはスキップする（未観測 = 何も持っていないとみなす。
 *   `resolveWalletTokenBalances` のダングリングガードと同じ「情報が
 *   足りない分は出さない」流儀）
 * - `ownerAddress` の照合は大文字小文字を無視する（`WalletEntity.address` は
 *   EIP-55 表記になりうる一方、台帳側はチェーンの生の表記。
 *   docs/worklog/issue-315.md「ownerAddress は小文字へ正規化」参照）
 * - 結果は `contractAddress` → `tokenId`（数値）の順で安定ソートする
 *   （複数コントラクトを横断して集約するため、`contractsByAddress` の
 *   走査順序に依存しない決定的な表示順にする）
 */
export function resolveWalletNftHoldings(
  walletAddress: string,
  contracts: Iterable<ContractEntity>,
): WalletNftHolding[] {
  const lower = walletAddress.toLowerCase();
  const holdings: WalletNftHolding[] = [];
  for (const contract of contracts) {
    if (!contract.nft || !contract.nftTokens) continue;
    for (const token of contract.nftTokens) {
      if (token.ownerAddress.toLowerCase() !== lower) continue;
      holdings.push({
        contractAddress: contract.address,
        symbol: contract.nft.symbol,
        contractName: contract.name,
        tokenId: token.tokenId,
      });
    }
  }
  holdings.sort((a, b) => {
    const byContract = a.contractAddress.localeCompare(b.contractAddress);
    if (byContract !== 0) return byContract;
    return compareTokenId(a.tokenId, b.tokenId);
  });
  return holdings;
}

/**
 * NFT保有チップ（`WalletCard`）／ポップオーバーの保有行（`WalletPopover`）に
 * 出す「SYMBOL #tokenId」形式のラベル（設計メモ「CVN #1」形式）。
 */
export function formatNftChipLabel(
  holding: Pick<WalletNftHolding, "symbol" | "tokenId">,
): string {
  return `${holding.symbol} #${holding.tokenId}`;
}
