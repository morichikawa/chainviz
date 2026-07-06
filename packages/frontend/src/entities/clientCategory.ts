/**
 * クライアント種別文字列（`NodeEntity.clientType`）から EL / CL の別を判定する。
 *
 * チェーン非依存にしたい判定ではあるが、現状 Ethereum プロファイル1つしか
 * 無いため、reth/geth を実行層（execution）、lighthouse/prysm を合意層
 * （consensus）に対応づける単純な文字列マッチングで十分実用になる
 * （ARCHITECTURE.md §5 の EL/CL 用語解説キー a-infra.yaml の分類と対応）。
 * 将来チェーンプロファイルが増えたら、この判定はチェーンプロファイル側の
 * 表現セットへ移す必要がある。
 */
export type ClientCategory = "execution" | "consensus" | "other";

export function clientCategory(clientType: string): ClientCategory {
  const lower = clientType.toLowerCase();
  if (lower.includes("reth") || lower.includes("geth")) return "execution";
  if (lower.includes("lighthouse") || lower.includes("prysm")) return "consensus";
  return "other";
}
