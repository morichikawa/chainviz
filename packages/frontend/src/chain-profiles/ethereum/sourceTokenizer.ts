/**
 * Ethereum チェーンプロファイルのフロント表現セット: コントラクトソース
 * ビュー（Issue #321。docs/ARCHITECTURE.md §12.4）向けの軽量
 * シンタックスハイライト。
 *
 * `ContractSourceCode.language`（`packages/shared`。生の識別子）の解釈は
 * フロント表現セットの責務であり（`syncStageLabels.ts` の
 * `describeSyncStage` / `operationCatalog.ts` と同じ「チェーン固有語彙の
 * 解釈はここに閉じる」流儀）、ワールドステート・glossary にこのマッピングは
 * 持ち込まない。
 *
 * ハイライトライブラリ（Prism/Shiki 等）は不採用（表示対象はカタログ同梱の
 * 自作サンプル2ファイル・計118行のみで文法網羅が不要。依存追加を避け、
 * 純関数としてテストしやすくするため。カタログが増えて保守が割に合わなく
 * なったら再検討する）。
 */

/** トークンの分類（5分類程度。純粋な表示用の粒度で、パース精度は求めない）。 */
export type SourceTokenKind =
  | "comment"
  | "string"
  | "keyword"
  | "type"
  | "number"
  | "plain";

export interface SourceToken {
  kind: SourceTokenKind;
  text: string;
}

// 制御構文・宣言系のキーワード（対象サンプルに現れる範囲 + 一般的な
// Solidity 語彙。文法網羅は目的にしていない）。
const SOLIDITY_KEYWORDS = new Set([
  "pragma",
  "solidity",
  "contract",
  "interface",
  "library",
  "function",
  "constructor",
  "modifier",
  "event",
  "emit",
  "require",
  "revert",
  "assert",
  "if",
  "else",
  "for",
  "while",
  "do",
  "break",
  "continue",
  "return",
  "returns",
  "import",
  "is",
  "using",
  "override",
  "virtual",
  "abstract",
  "external",
  "public",
  "private",
  "internal",
  "payable",
  "view",
  "pure",
  "constant",
  "immutable",
  "indexed",
  "unchecked",
  "memory",
  "storage",
  "calldata",
  "new",
  "delete",
  "true",
  "false",
  "type",
]);

// 型名（値・参照型)。Solidity ではキーワードと文法上区別されるが、表示上は
// 別クラスにして色分けする（設計メモ §12.4「コメント/文字列/キーワード/
// 型名/数値の5分類」）。
const SOLIDITY_TYPES = new Set([
  "address",
  "bool",
  "string",
  "bytes",
  "bytes1",
  "bytes4",
  "bytes32",
  "mapping",
  ...Array.from({ length: 32 }, (_, i) => `uint${(i + 1) * 8}`),
  ...Array.from({ length: 32 }, (_, i) => `int${(i + 1) * 8}`),
  "uint",
  "int",
]);

// コメント（// 行コメント・/* */ ブロックコメント。NatSpec の /// も // に
// 前方一致するのでそのまま拾える）・文字列（"..." / '...'。エスケープ対応）・
// 数値（バージョン表記 "0.8.24" のようなドット区切りも1トークンにする）・
// 識別子の優先順位でマッチする。マッチしなかった区間（空白・記号など）は
// 呼び出し側で "plain" として詰める。
const TOKEN_PATTERN =
  /(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)*\b)|([A-Za-z_$][A-Za-z0-9_$]*)/g;

/**
 * Solidity ソース全文を分類済みトークン列に変換する純関数。改行は個々の
 * トークンの `text` にそのまま含まれうる（ブロックコメントが複数行に
 * またがる場合など）。行単位に割るのは `splitTokensIntoLines` の責務
 * （関心の分離。行分割はどの言語のトークン列にも使える汎用処理のため）。
 */
export function tokenizeSolidity(code: string): SourceToken[] {
  const tokens: SourceToken[] = [];
  let lastIndex = 0;
  for (const match of code.matchAll(TOKEN_PATTERN)) {
    const index = match.index;
    if (index > lastIndex) {
      pushPlain(tokens, code.slice(lastIndex, index));
    }
    const [full, lineComment, blockComment, str, num, ident] = match;
    if (lineComment !== undefined || blockComment !== undefined) {
      tokens.push({ kind: "comment", text: full });
    } else if (str !== undefined) {
      tokens.push({ kind: "string", text: full });
    } else if (num !== undefined) {
      tokens.push({ kind: "number", text: full });
    } else if (ident !== undefined) {
      if (SOLIDITY_KEYWORDS.has(ident)) {
        tokens.push({ kind: "keyword", text: full });
      } else if (SOLIDITY_TYPES.has(ident)) {
        tokens.push({ kind: "type", text: full });
      } else {
        pushPlain(tokens, full);
      }
    }
    lastIndex = index + full.length;
  }
  if (lastIndex < code.length) {
    pushPlain(tokens, code.slice(lastIndex));
  }
  return tokens;
}

/** 直前が "plain" トークンなら連結し、そうでなければ新規追加する（隣接する
 * 記号・空白の断片・非キーワード識別子が無駄に細切れの span にならないように
 * するための整形。トークン分類自体には影響しない）。 */
function pushPlain(tokens: SourceToken[], text: string): void {
  if (text.length === 0) return;
  const last = tokens[tokens.length - 1];
  if (last !== undefined && last.kind === "plain") {
    last.text += text;
    return;
  }
  tokens.push({ kind: "plain", text });
}

/**
 * トークン列を、元のソースの行ごとに分割する純関数（改行を含みうる
 * comment/string トークンも正しく複数行へまたがせる）。空行は空配列になる。
 * `tokens` の各 `text` を連結すると元のソース全文と一致することが前提
 * （`tokenizeSolidity` はこの前提を満たす）。
 */
export function splitTokensIntoLines(tokens: SourceToken[]): SourceToken[][] {
  const lines: SourceToken[][] = [[]];
  for (const token of tokens) {
    const parts = token.text.split("\n");
    parts.forEach((part, i) => {
      if (part.length > 0) {
        lines[lines.length - 1].push({ kind: token.kind, text: part });
      }
      if (i < parts.length - 1) {
        lines.push([]);
      }
    });
  }
  return lines;
}

/**
 * `ContractSourceCode.language` から表示用の行配列を得る（表示コンポーネント
 * 側はこの1関数だけ呼べばよい）。対応の無い言語はプレーンテキスト表示に
 * 倒す（表現セットが知らない言語でも装飾なしで表示だけはできる。
 * ARCHITECTURE.md §12.4）。
 */
export function resolveSourceLines(
  code: string,
  language: string,
): SourceToken[][] {
  const tokens: SourceToken[] =
    language === "solidity" ? tokenizeSolidity(code) : [{ kind: "plain", text: code }];
  return splitTokensIntoLines(tokens);
}
