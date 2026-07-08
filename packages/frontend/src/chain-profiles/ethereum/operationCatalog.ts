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
    constructorArgs: [{ name: "initialSupply", type: "uint" }],
    functions: [
      {
        signature: "transfer(address,uint256)",
        label: "transfer",
        args: [
          { name: "to", type: "address" },
          { name: "amount", type: "uint" },
        ],
        payable: false,
      },
      {
        signature: "approve(address,uint256)",
        label: "approve",
        args: [
          { name: "spender", type: "address" },
          { name: "amount", type: "uint" },
        ],
        payable: false,
      },
      {
        signature: "transferFrom(address,address,uint256)",
        label: "transferFrom",
        args: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "amount", type: "uint" },
        ],
        payable: false,
      },
      {
        signature: "mint(address,uint256)",
        label: "mint",
        args: [
          { name: "to", type: "address" },
          { name: "amount", type: "uint" },
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
      { signature: "increment()", label: "increment", args: [], payable: false },
      {
        signature: "incrementBy(uint256)",
        label: "incrementBy",
        args: [{ name: "amount", type: "uint" }],
        payable: false,
      },
      { signature: "reset()", label: "reset", args: [], payable: false },
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
