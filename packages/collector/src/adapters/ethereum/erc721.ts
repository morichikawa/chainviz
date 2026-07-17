// ERC-721 の totalSupply()/ownerOf(uint256) を eth_call で問い合わせ、
// コントラクトの所有台帳を組み立てる部分（Issue #315）。ABI エンコード/
// デコード（viem への依存）はこのファイルの内側に閉じ込め、呼び出し側
// （nft-tracker.ts）にはコントラクトアドレス・tokenId（10 進文字列）・
// 所有者アドレスというチェーン非依存に近い語彙だけを渡す（erc20.ts と同じ
// 「ABI はアダプタ配下に閉じ込める」方針。CLAUDE.md「ChainAdapter 境界」）。
//
// totalSupply() は ERC-721 コア標準の一部ではなく（ERC721Enumerable 拡張の
// 関数）、viem の標準 erc721Abi には含まれない。ownerOf(uint256) は標準に
// 含まれるが、2 関数の取得元を viem 標準 ABI とこのファイル内定義とに分けると
// かえって読みにくいため、両方をこのファイル内の最小 ABI として自己完結させる
// （docs/worklog/issue-315.md「erc721.ts で viem の erc721Abi を使うか最小
// ABI をインラインで持つか」の実装時の決定）。totalSupply() を持つことは、
// カタログの nft メタ情報で特定できたコントラクト（ChainvizNFT。
// profiles/ethereum/contracts/src/ChainvizNFT.sol）に限られる前提。

import { decodeFunctionResult, encodeFunctionData, type Hex } from "viem";
import type { NftToken } from "@chainviz/shared";
import { normalizeAddress } from "./contracts.js";
import { ethCall, type EthRpcClient } from "./eth-rpc-client.js";

/** totalSupply()/ownerOf(uint256) だけを含む最小 ABI（上記コメント参照）。 */
const nftLedgerAbi = [
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/** 発行済み総数（totalSupply）を取得する。 */
async function fetchTotalSupply(
  rpc: EthRpcClient,
  url: string,
  contractAddress: string,
): Promise<bigint> {
  const data = encodeFunctionData({
    abi: nftLedgerAbi,
    functionName: "totalSupply",
  });
  const result = await ethCall(rpc, url, contractAddress, data);
  return decodeFunctionResult({
    abi: nftLedgerAbi,
    functionName: "totalSupply",
    data: result as Hex,
  });
}

/** 指定 tokenId の所有者アドレス（小文字正規化済み）を取得する。 */
async function fetchOwnerOf(
  rpc: EthRpcClient,
  url: string,
  contractAddress: string,
  tokenId: bigint,
): Promise<string> {
  const data = encodeFunctionData({
    abi: nftLedgerAbi,
    functionName: "ownerOf",
    args: [tokenId],
  });
  const result = await ethCall(rpc, url, contractAddress, data);
  const owner = decodeFunctionResult({
    abi: nftLedgerAbi,
    functionName: "ownerOf",
    data: result as Hex,
  });
  return normalizeAddress(owner);
}

/**
 * ERC-721 コントラクトの所有台帳全体（tokenId 1〜totalSupply の所有者）を
 * eth_call で取得する。totalSupply が 0 なら空配列を返す（まだ何も発行
 * されていない。ContractEntity.nftTokens の「空配列 = 観測できたが未発行」
 * の約束どおり）。
 *
 * totalSupply の取得・いずれかの tokenId の ownerOf 取得のうちどれか 1 つでも
 * 失敗すれば、この関数全体が reject する（呼び出し側 nft-tracker.ts は
 * 「この周期の取得は失敗」として前回の台帳を維持する）。部分的に取得できた
 * 分だけの不完全な台帳を返すと、「まだ観測できていない tokenId」なのか
 * 「本当に所有者が変わった」のか区別できなくなるため、この関数の粒度では
 * 全成功・全失敗の二値にする（CLAUDE.md「エラーを握りつぶさない」— reject
 * した理由は呼び出し側がログに残す）。
 *
 * burn が無く 1 始まりの連番で採番される（コントラクト側で保証。
 * profiles/ethereum/contracts/src/ChainvizNFT.sol 参照）という前提により、
 * ERC721Enumerable を実装しなくても 1〜totalSupply の全 tokenId を列挙できる。
 * この前提が崩れるコントラクト（burn 実装済み等）をカタログに追加する場合は
 * この関数を再検討すること。
 *
 * RPC 呼び出し回数は 1（totalSupply）+ totalSupply（ownerOf）。学習用の
 * ローカル環境では発行数が高々数十個という前提を置き、固定上限は設けて
 * いない（CLAUDE.md「固定値の前提条件を明記する」ルール。
 * docs/worklog/issue-315.md 設計メモにも同じ前提を記録済み）。
 */
export async function fetchErc721Ledger(
  rpc: EthRpcClient,
  url: string,
  contractAddress: string,
): Promise<NftToken[]> {
  const totalSupply = await fetchTotalSupply(rpc, url, contractAddress);
  if (totalSupply <= 0n) return [];

  const tokenIds = Array.from({ length: Number(totalSupply) }, (_, i) =>
    BigInt(i + 1),
  );
  const owners = await Promise.all(
    tokenIds.map((tokenId) => fetchOwnerOf(rpc, url, contractAddress, tokenId)),
  );
  return tokenIds.map((tokenId, i) => ({
    tokenId: tokenId.toString(10),
    ownerAddress: owners[i],
  }));
}
