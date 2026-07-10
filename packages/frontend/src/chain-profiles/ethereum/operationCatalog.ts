import type { Localized } from "../../i18n/messages.js";

/**
 * Ethereum チェーンプロファイルのフロント表現セット。定型操作パネル
 * （ARCHITECTURE.md §6.5）のデプロイ/呼び出しタブが必要とする「UI フォーム
 * 組み立てに必要な最小情報」を静的データとして持つ。
 *
 * ABI そのもの（型・エンコーディングの正確な定義）は持たない。値はすべて
 * 文字列のまま `WorkbenchOperation` の `constructorArgs` / `args` に渡り、
 * 実際の型解釈（数値・アドレス等へのエンコード）は collector 側の
 * ChainAdapter（カタログの ABI を持つ）が行う（ARCHITECTURE.md §6.10
 * 決定事項2）。フロントはこの型情報を「アドレス型の引数に既存ウォレットの
 * 候補を提示する」といった入力補助にのみ使う。
 *
 * `catalogKey` は `profiles/ethereum/contracts/catalog.json` のトップレベル
 * キー、および collector が `ContractEntity.catalogKey` / `WorkbenchOperation
 * (deployContract).contractKey` として使う値と完全に一致させる（値がずれると
 * デプロイの forge ターゲット解決・呼び出し対象コントラクトの照合の両方が
 * 壊れる）。カタログ自体との二重管理は ARCHITECTURE.md §6.5 で許容済み。
 */

/** UI フォームの入力補助に使う引数の型分類。 */
export type OperationArgType = "address" | "uint" | "string" | "bool";

export interface OperationArgField {
  /** ABI 上の引数名（表示ラベルにそのまま使う。§6.5「引数名をラベルにした
   * テキスト入力」）。 */
  name: string;
  type: OperationArgType;
  /**
   * この引数がトークン量を表す場合に付与する（Issue #219）。`"token"` の
   * ときフォームはトークン単位の10進入力（例: `1.5`）を受け付け、送信前に
   * 対象コントラクトの `token.decimals` で最小単位へ変換する
   * （`operations/tokenAmount.ts` の `parseUnits`）。省略時は従来どおり
   * 最小単位の生の整数値をそのまま入力させる。
   */
  unit?: "token";
}

export interface OperationFunctionForm {
  /**
   * `cast send` に渡す完全な関数シグネチャ（例: "transfer(address,uint256)"）。
   * `WorkbenchOperation.callContract.functionName` へそのまま渡す
   * （collector 側 `buildOperationCommand` はこの文字列を関数名として
   * cast へそのまま渡すのみで、シグネチャの組み立ては行わない）。
   */
  signature: string;
  /** UI に出す表示名（通常は関数名のみ。例: "transfer"）。 */
  label: string;
  /** 関数選択の直下に表示する一言説明（Issue #213）。 */
  description: Localized;
  args: OperationArgField[];
  /** payable な関数のみ金額欄を出す（§6.5）。 */
  payable: boolean;
}

export interface ContractCatalogEntry {
  /** `ContractEntity.catalogKey` / `deployContract.contractKey` と一致するキー。 */
  catalogKey: string;
  displayName: Localized;
  /** デプロイタブのコントラクト選択に添える一言説明（§6.5）。 */
  description: Localized;
  /**
   * ERC20系のトークン情報（symbol/decimals）。`unit: "token"` な引数の
   * 単位換算に使う（Issue #219）。トークンを持たないコントラクト
   * （例: Counter）では省略する。デプロイ済みの実体からは
   * `ContractEntity.token`（実測値）が優先され、こちらはまだ実体が無い
   * デプロイタブでのみ使われる静的な値（`operations/deployedContracts.ts`
   * 参照）。
   */
  token?: { symbol: string; decimals: number };
  constructorArgs: OperationArgField[];
  /** GUI から呼び出せる関数（state を変更する関数のみを掲載する。view/pure
   * な読み取り専用関数は cast send で呼ぶ意味が無いため対象外）。 */
  functions: OperationFunctionForm[];
}

/**
 * `profiles/ethereum/contracts/catalog.json` に対応するサンプルコントラクト
 * （Issue #158/#159）の操作フォーム定義。カタログ全体（catalog.json）が
 * 増えたら、ここにも対応するエントリを追加する。
 */
export const ETHEREUM_OPERATION_CATALOG: ContractCatalogEntry[] = [
  {
    catalogKey: "ChainvizToken",
    displayName: { ja: "ChainvizToken", en: "ChainvizToken" },
    description: {
      ja: "最小の ERC20 トークン",
      en: "A minimal ERC20 token",
    },
    // ソース `profiles/ethereum/contracts/src/ChainvizToken.sol` の
    // symbol/decimals 定数と一致させる（Issue #219）。
    token: { symbol: "CVZ", decimals: 18 },
    constructorArgs: [{ name: "initialSupply", type: "uint", unit: "token" }],
    functions: [
      {
        signature: "transfer(address,uint256)",
        label: "transfer",
        description: {
          ja: "自分のトークン残高から to へ amount を送ります",
          en: "Sends amount from your token balance to 'to'.",
        },
        args: [
          { name: "to", type: "address" },
          { name: "amount", type: "uint", unit: "token" },
        ],
        payable: false,
      },
      {
        signature: "approve(address,uint256)",
        label: "approve",
        description: {
          ja: "spender に、自分の残高から amount まで引き出す許可を与えます",
          en: "Allows 'spender' to withdraw up to amount from your balance.",
        },
        args: [
          { name: "spender", type: "address" },
          { name: "amount", type: "uint", unit: "token" },
        ],
        payable: false,
      },
      {
        signature: "transferFrom(address,address,uint256)",
        label: "transferFrom",
        description: {
          ja: "approve で許可された範囲で from から to へトークンを移します",
          en: "Moves tokens from 'from' to 'to', within an approved allowance.",
        },
        args: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "amount", type: "uint", unit: "token" },
        ],
        payable: false,
      },
      {
        signature: "mint(address,uint256)",
        label: "mint",
        description: {
          ja: "新しいトークンを amount 分発行して to に与えます（デプロイした人だけが実行できます）",
          en: "Issues amount of new tokens to 'to' (only the deployer can call this).",
        },
        args: [
          { name: "to", type: "address" },
          { name: "amount", type: "uint", unit: "token" },
        ],
        payable: false,
      },
    ],
  },
  {
    catalogKey: "Counter",
    displayName: { ja: "Counter", en: "Counter" },
    description: {
      ja: "一番単純な学習用コントラクト",
      en: "The simplest learning contract",
    },
    constructorArgs: [],
    functions: [
      {
        signature: "increment()",
        label: "increment",
        description: { ja: "カウンタを 1 増やします", en: "Increases the counter by 1." },
        args: [],
        payable: false,
      },
      {
        signature: "incrementBy(uint256)",
        label: "incrementBy",
        description: {
          ja: "カウンタを amount 増やします",
          en: "Increases the counter by amount.",
        },
        args: [{ name: "amount", type: "uint" }],
        payable: false,
      },
      {
        signature: "reset()",
        label: "reset",
        description: { ja: "カウンタを 0 に戻します", en: "Resets the counter to 0." },
        args: [],
        payable: false,
      },
    ],
  },
];

/** `catalogKey` からカタログエントリを引く。見つからなければ undefined。 */
export function getOperationCatalogEntry(
  catalogKey: string,
): ContractCatalogEntry | undefined {
  return ETHEREUM_OPERATION_CATALOG.find(
    (entry) => entry.catalogKey === catalogKey,
  );
}
