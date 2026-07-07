// フロントからの操作コマンドが最終的に呼び出す「ノード/ワークベンチの
// ライフサイクル操作」の抽象（ポート）。ここはチェーン非依存の契約であり、
// 実際の Docker 構成の組み立て（どのイメージ・どの IP・どのボリューム）は
// ChainAdapter 側の実装（adapters/ethereum/node-lifecycle.ts）が担う。
//
// 各メソッドは成功時に解決し、失敗時は Error を throw する。コマンドの
// 成否（commandResult）への変換は CommandHandler が行う。

import type { WorkbenchOperation } from "@chainviz/shared";

/**
 * runWorkbenchOperation の実行結果のうち、collector 内部のログに使う付随
 * 情報。docs/ARCHITECTURE.md §3 の設計どおり、commandResult 自体は ok/error
 * だけを返し（実際の反映は後続の diff で届く）、この結果は CommandHandler が
 * ログへ残すためだけに使う。プロトコル（ServerMessage）を拡張してフロントへ
 * 渡す変更は packages/shared の型変更を伴うため本 Issue の範囲外とする
 * （必要になった場合は chainviz-reviewer と調整のうえで追加する）。
 */
export interface WorkbenchOperationResult {
  /** cast send / forge create の出力から抽出できたトランザクションハッシュ。 */
  txHash?: string;
  /** deployContract の場合、forge create の出力から抽出できたデプロイ先アドレス。 */
  deployedAddress?: string;
}

export interface NodeLifecycle {
  /** 新規ノード（フォロワー）を追加する。chainProfile が非対応なら throw。 */
  addNode(chainProfile: string): Promise<void>;
  /** addNode で追加したノードを削除する。対象外の nodeId なら throw。 */
  removeNode(nodeId: string): Promise<void>;
  /** 新規ワークベンチを追加する。 */
  addWorkbench(label: string): Promise<void>;
  /** addWorkbench で追加したワークベンチを削除する。対象外なら throw。 */
  removeWorkbench(workbenchId: string): Promise<void>;
  /**
   * ワークベンチコンテナ内で定型操作（送金・コントラクトデプロイ・
   * コントラクト呼び出し）を実行する。対象ワークベンチが見つからない、
   * 鍵（mnemonic）が使えない、実行したコマンドが失敗（非ゼロ終了コード）
   * した場合は、具体的な理由を含む Error を throw する。
   */
  runWorkbenchOperation(
    workbenchId: string,
    operation: WorkbenchOperation,
  ): Promise<WorkbenchOperationResult>;
}

/** コマンド処理の結果（commandResult へそのまま載る）。 */
export interface CommandResult {
  ok: boolean;
  error?: string;
}
