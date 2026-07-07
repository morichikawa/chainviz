// runWorkbenchOperation（送金・コントラクトデプロイ・コントラクト呼び出し）を、
// ワークベンチコンテナ内で実行する Foundry の cast / forge のコマンド列へ
// 変換する部分と、実行結果（stdout）からトランザクションハッシュ等を取り出す
// 部分。cast / forge のコマンド名・引数・出力形式といった Ethereum 固有の
// 語彙はこのファイル（ChainAdapter 実装の内側）に閉じ込め、commands/ 層や
// ワールドステートには漏らさない（CLAUDE.md「ChainAdapter 境界」）。
//
// deployContract の contractKey は、現時点では forge create の CONTRACT 引数
// （例: "src/ChainvizToken.sol:ChainvizToken"）としてそのまま渡す。カタログ
// キー（例: "chainviz-token"）→ forge ターゲットの解決は、コントラクト
// カタログ（profiles/ethereum/contracts/catalog.json）の読み込みを担う
// 別Issue（#161: コントラクトカタログの読み込みとデプロイ検知・追跡）の
// 範囲であり、本ファイルはカタログの存在を前提にしない（責務の分離）。
//
// 同様に、callContract の functionName も cast send の関数シグネチャ引数
// （例: "transfer(address,uint256)"）としてそのまま渡す。引数の型解釈
// （数値・アドレス等への変換）をカタログの ABI を使って行う機能は #162
// （関数呼び出し・イベントログの復号）の範囲であり、本ファイルは文字列の
// ままの args をそのまま cast へ渡す。

import type { WorkbenchOperation } from "@chainviz/shared";

/**
 * サンプルコントラクトの Foundry プロジェクト（profiles/ethereum/contracts/）を
 * ワークベンチコンテナへ bind mount するパス。docker-compose.yml の
 * `workbench` サービスの working_dir と揃える（Issue #158）。
 */
export const CONTRACTS_MOUNT_PATH = "/contracts";

/** cast / forge の実行に必要な、ワークベンチ・鍵に関するコンテキスト。 */
export interface OperationContext {
  /** ワークベンチの主たる鍵の mnemonic（values.env 由来）。 */
  mnemonic: string;
  /** そのワークベンチが使う BIP-44 導出インデックス。 */
  walletIndex: number;
  /** ワークベンチが RPC 呼び出しに使う URL（ロギングプロキシ経由）。 */
  ethRpcUrl: string;
}

/**
 * WorkbenchOperation を、ワークベンチコンテナ内で実行する cast / forge の
 * コマンド列（配列）へ変換する。戻り値は配列のまま docker exec（Cmd）へ渡す
 * ことを前提とし、呼び出し側でシェル文字列へ連結してはならない
 * （コマンドインジェクション防止。Issue #163 の設計事項）。
 */
export function buildOperationCommand(
  operation: WorkbenchOperation,
  ctx: OperationContext,
): string[] {
  const walletArgs = [
    "--rpc-url",
    ctx.ethRpcUrl,
    "--mnemonic",
    ctx.mnemonic,
    "--mnemonic-index",
    String(ctx.walletIndex),
  ];

  switch (operation.type) {
    case "transfer":
      return ["cast", "send", ...walletArgs, "--value", operation.amount, operation.to];

    case "deployContract": {
      // forge create の --constructor-args は可変長（値をいくつでも取り込む）
      // オプションのため、後ろに他のフラグを置くと誤って取り込まれてしまう。
      // Foundry 公式の使用例に倣い、CONTRACT 位置引数を先頭（create 直後）に
      // 置いた上で、--constructor-args はコマンド列の最後に置く。
      const constructorArgs =
        operation.constructorArgs !== undefined
          ? ["--constructor-args", ...operation.constructorArgs]
          : [];
      return [
        "forge",
        "create",
        operation.contractKey,
        "--root",
        CONTRACTS_MOUNT_PATH,
        ...walletArgs,
        "--broadcast",
        ...constructorArgs,
      ];
    }

    case "callContract": {
      const valueArgs =
        operation.amount !== undefined ? ["--value", operation.amount] : [];
      return [
        "cast",
        "send",
        ...walletArgs,
        ...valueArgs,
        operation.contractAddress,
        operation.functionName,
        ...operation.args,
      ];
    }
  }
}

/** cast send の平テキスト出力（"key<space...>value" の行形式）から transactionHash を取り出す。 */
export function parseCastTxHash(stdout: string): string | undefined {
  return stdout.match(/^transactionHash\s+(0x[0-9a-fA-F]+)/m)?.[1];
}

/** forge create の出力の "Transaction hash: 0x..." 行からハッシュを取り出す。 */
export function parseForgeTxHash(stdout: string): string | undefined {
  return stdout.match(/Transaction hash:\s*(0x[0-9a-fA-F]+)/i)?.[1];
}

/** forge create の出力の "Deployed to: 0x..." 行からデプロイ先アドレスを取り出す。 */
export function parseForgeDeployedAddress(stdout: string): string | undefined {
  return stdout.match(/Deployed to:\s*(0x[0-9a-fA-F]+)/i)?.[1];
}

/** runWorkbenchOperation の実行結果から抽出できた付随情報（ログ用途）。 */
export interface OperationOutcome {
  txHash?: string;
  deployedAddress?: string;
}

/**
 * exec の標準出力から、操作の種類に応じてトランザクションハッシュ・
 * （デプロイの場合は）デプロイ先アドレスを取り出す。cast/forge の出力形式は
 * バージョンによって変わりうるため、抽出できない場合は該当フィールドを
 * 省略するだけで例外にはしない（操作自体の成否は exec の終了コードで
 * 別途判定済みであり、ここでの抽出失敗は「付随情報が取れなかった」だけの
 * 扱いにとどめる）。
 */
export function parseOperationOutcome(
  operation: WorkbenchOperation,
  stdout: string,
): OperationOutcome {
  if (operation.type === "deployContract") {
    return {
      txHash: parseForgeTxHash(stdout),
      deployedAddress: parseForgeDeployedAddress(stdout),
    };
  }
  return { txHash: parseCastTxHash(stdout) };
}

/** ログ・エラーメッセージに載せる、操作を人間可読に説明する短い文字列。 */
export function describeOperation(operation: WorkbenchOperation): string {
  switch (operation.type) {
    case "transfer":
      return `transfer ${operation.amount} to ${operation.to}`;
    case "deployContract":
      return `deployContract ${operation.contractKey}`;
    case "callContract":
      return `callContract ${operation.functionName} on ${operation.contractAddress}`;
  }
}
