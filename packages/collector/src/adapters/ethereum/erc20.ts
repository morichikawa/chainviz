// ERC20 の balanceOf(address) を eth_call で問い合わせる部分（Issue #164）。
// ABI エンコード/デコード（viem への依存）はこのファイルの内側に閉じ込め、
// 呼び出し側（wallet-tracker.ts）にはトークンコントラクトアドレス・ウォレット
// アドレス・残高の 10 進文字列というチェーン非依存に近い語彙だけを渡す
// （decode.ts と同じ「ABI はアダプタ配下に閉じ込める」方針。CLAUDE.md
// 「ChainAdapter 境界」）。
//
// カタログの ABI（コントラクトごとに個別）ではなく viem の標準 erc20Abi を使う。
// WalletEntity.tokenBalances の対象は、コントラクトカタログで token メタ情報
// （symbol/decimals）を持つコントラクトに限られ（docs/ARCHITECTURE.md §4）、
// これらはいずれも ERC20 標準の balanceOf(address) を実装している前提のため、
// コントラクトごとに異なりうるカタログ ABI を経由する必要がない。

import { decodeFunctionResult, encodeFunctionData, erc20Abi, type Hex } from "viem";
import { ethCall, type EthRpcClient } from "./eth-rpc-client.js";

/**
 * ERC20 トークンコントラクトの balanceOf(walletAddress) を eth_call で問い合わせ、
 * 最小単位での残高を 10 進文字列で返す（TokenBalance.amount と同じ、精度落ちを
 * 防ぐための文字列表現）。
 */
export async function fetchErc20Balance(
  rpc: EthRpcClient,
  url: string,
  tokenAddress: string,
  walletAddress: string,
): Promise<string> {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [walletAddress as Hex],
  });
  const result = await ethCall(rpc, url, tokenAddress, data);
  const balance = decodeFunctionResult({
    abi: erc20Abi,
    functionName: "balanceOf",
    data: result as Hex,
  });
  return balance.toString(10);
}
