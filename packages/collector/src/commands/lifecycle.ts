// フロントからの操作コマンドが最終的に呼び出す「ノード/ワークベンチの
// ライフサイクル操作」の抽象（ポート）。ここはチェーン非依存の契約であり、
// 実際の Docker 構成の組み立て（どのイメージ・どの IP・どのボリューム）は
// ChainAdapter 側の実装（adapters/ethereum/node-lifecycle.ts）が担う。
//
// 各メソッドは成功時に解決し、失敗時は Error を throw する。コマンドの
// 成否（commandResult）への変換は CommandHandler が行う。

export interface NodeLifecycle {
  /** 新規ノード（フォロワー）を追加する。chainProfile が非対応なら throw。 */
  addNode(chainProfile: string): Promise<void>;
  /** addNode で追加したノードを削除する。対象外の nodeId なら throw。 */
  removeNode(nodeId: string): Promise<void>;
  /** 新規ワークベンチを追加する。 */
  addWorkbench(label: string): Promise<void>;
  /** addWorkbench で追加したワークベンチを削除する。対象外なら throw。 */
  removeWorkbench(workbenchId: string): Promise<void>;
}

/** コマンド処理の結果（commandResult へそのまま載る）。 */
export interface CommandResult {
  ok: boolean;
  error?: string;
}
