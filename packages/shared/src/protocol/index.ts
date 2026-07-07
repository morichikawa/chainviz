import type { DiffEvent } from "../events/index.js";
import type { WorldStateSnapshot } from "../world-state/index.js";

/**
 * ワークベンチ上で実行する定型操作。collector が対象ワークベンチコンテナ内の
 * 開発ツール（Ethereum プロファイルなら Foundry の cast / forge）を実行する。
 * その RPC 呼び出しはワークベンチの通常の接続経路（ロギングプロキシ）を通る
 * ため、操作エッジ・tx ライフサイクルの可視化に特別な配線なしでそのまま乗る。
 * 金額（amount）はチェーンの最小単位（Ethereum なら wei）の 10 進文字列。
 */
export type WorkbenchOperation =
  | {
      /** ネイティブ通貨の送金（支払い）。 */
      type: "transfer";
      to: string;
      amount: string;
    }
  | {
      /** チェーンプロファイルのコントラクトカタログに載っているコントラクトのデプロイ。 */
      type: "deployContract";
      contractKey: string;
    }
  | {
      /** デプロイ済みコントラクトの関数呼び出し（トークンの transfer 等）。 */
      type: "callContract";
      contractAddress: string;
      functionName: string;
      /**
       * 引数は文字列で受け渡し、型解釈（数値・アドレス等への変換）は
       * カタログのインターフェース定義を持つアダプタ側が行う。
       */
      args: string[];
      /** 呼び出しに添える送金額。省略時は 0。 */
      amount?: string;
    };

export type Command =
  | { action: "addNode"; chainProfile: string }
  | { action: "removeNode"; nodeId: string }
  | { action: "addWorkbench"; label: string }
  | { action: "removeWorkbench"; workbenchId: string }
  | {
      action: "runWorkbenchOperation";
      workbenchId: string;
      operation: WorkbenchOperation;
    };

export type ServerMessage =
  | { type: "snapshot"; payload: WorldStateSnapshot }
  | { type: "diff"; payload: DiffEvent[] }
  | { type: "commandResult"; commandId: string; ok: boolean; error?: string };

export type ClientMessage = {
  type: "command";
  commandId: string;
  command: Command;
};
