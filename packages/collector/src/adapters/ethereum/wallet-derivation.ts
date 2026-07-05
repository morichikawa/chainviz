// ワークベンチが保持する mnemonic からウォレットアドレスを導出する部分。
// BIP-39 mnemonic / BIP-44 導出パスといった Ethereum 固有の鍵の扱いは
// このファイル（ChainAdapter 実装の内側）に閉じ込め、ワールドステートの
// スキーマや共通層には漏らさない（CLAUDE.md「ChainAdapter 境界」）。

import { mnemonicToAccount } from "viem/accounts";

/**
 * ワークベンチコンテナに付与する「そのワークベンチが主に使う導出インデックス」
 * を表すラベル。addWorkbench 時に採番して付け、観測側（WalletTracker /
 * pollInfra）はこのラベルから同じアドレスを再現する。ラベルを単一の真実の
 * 情報源にすることで、collector を再起動してもインデックスが安定する
 * （Issue #65 の「Docker ラベルを真実の情報源とする」方針に揃える）。
 */
export const WALLET_INDEX_LABEL = "com.chainviz.wallet-index";

/**
 * compose 由来のワークベンチ（collector が採番していない = ラベルを持たない）が
 * 使う既定の導出インデックス。profiles/ethereum の README 例が
 * `--mnemonic-index 0` を使っており、プリマインの先頭アカウントに対応する。
 */
export const DEFAULT_WALLET_INDEX = 0;

/**
 * mnemonic と導出インデックスから Ethereum アドレスを導出する。導出パスは
 * Foundry 既定（`m/44'/60'/0'/0/N`）に一致させる。viem の mnemonicToAccount は
 * addressIndex を N に割り当てた同じパスを使うため、cast --mnemonic-index N と
 * 同一のアドレスになる。戻り値は EIP-55 チェックサム付きの 0x アドレス。
 */
export function deriveWalletAddress(mnemonic: string, index: number): string {
  return mnemonicToAccount(mnemonic, { addressIndex: index }).address;
}

/**
 * コンテナのラベルから導出インデックスを読む。ラベルが無い・数値でない場合は
 * 既定インデックス（compose 由来ワークベンチ）にフォールバックする。
 */
export function workbenchWalletIndex(labels: Record<string, string>): number {
  const raw = labels[WALLET_INDEX_LABEL];
  if (raw === undefined) return DEFAULT_WALLET_INDEX;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_WALLET_INDEX;
}
