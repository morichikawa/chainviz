import type { NftToken } from "@chainviz/shared";
import { buildLowerCaseIndex } from "./addressCasing.js";

/**
 * `ContractCard`/`ContractPopover` の「発行済み NFT」節に出す、1件の所有
 * 記録（Issue #315）。台帳の生の `ownerAddress` は `ContractEntity.address`
 * 等と同じくチェーン側の生の表記（Ethereum アダプタでは小文字）だが、対応
 * する `WalletEntity` が存在すればその表記（EIP-55 になりうる）に揃える
 * （`addressCasing.ts`）。
 */
export interface ResolvedNftToken {
  tokenId: string;
  /**
   * 表示用の所有者アドレス。大文字小文字を無視して一致する `WalletEntity`
   * があればその表記、無ければ台帳の生の表記をそのまま使う。
   */
  ownerAddress: string;
}

/**
 * `ContractEntity.nftTokens`（発行済み NFT の所有台帳）を表示用に解決する
 * （docs/worklog/issue-315.md「フロント側: 台帳はコントラクトカード」）。
 *
 * `resolveWalletTokenBalances`（ARCHITECTURE.md §6.7）と対になる、コントラクト
 * 視点の関数。あちらと違い「対応する相手が見つからない」場合でも行ごと除外
 * はしない（台帳自体がこのコントラクトの完全な記録であり、対応するウォレット
 * カードがまだキャンバス上に無い＝追跡外アドレスが持っている、というのも
 * 正当な状態のため。docs/worklog/issue-315.md
 * 「ウォレット単位の保有一覧は台帳から純関数で導出できる」参照）。
 *
 * `nftTokens` が省略・空なら空配列を返す（呼び出し側はこれを「発行済み NFT
 * セクション自体を出さない/『まだ発行されていません』を出す」判定に使う）。
 * 並び順は `nftTokens` の入力順（collector 側で tokenId 昇順が保証される
 * ため、そのまま使う。ARCHITECTURE.md §2 の `NftToken` doc コメント参照）。
 */
export function resolveContractNftLedger(
  nftTokens: NftToken[] | undefined,
  walletAddresses: Iterable<string>,
): ResolvedNftToken[] {
  if (!nftTokens || nftTokens.length === 0) return [];
  const walletIndex = buildLowerCaseIndex(walletAddresses);
  return nftTokens.map((token) => ({
    tokenId: token.tokenId,
    ownerAddress: walletIndex.get(token.ownerAddress.toLowerCase()) ?? token.ownerAddress,
  }));
}
