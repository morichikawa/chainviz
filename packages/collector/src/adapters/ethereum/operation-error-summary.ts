// forge/cast の失敗時 stderr（多くは複数行・カラム位置指摘付きの技術的な
// 英語エラーや、CLI引数パーサーのエラー、コントラクトの revert 理由）を、
// ユーザー向けの簡潔な要約文へ変換する（Issue #209）。
//
// フロント側（operationArgValidation.ts）で uint/address の明らかな型不一致は
// 送信前にブロックされるようになったが、それをすり抜けるケース（カタログの
// string/bool型、将来追加される呼び出し経路、WebSocket経由で直接不正な
// コマンドを送るケース）に対する保険として、collector 側でも失敗時の
// メッセージを読める形に変換する。
//
// forge/cast のコマンド名・エラー文言の形式は Ethereum（Foundry）固有の
// 語彙であり、ChainAdapter 境界の中（このファイル）に閉じ込める。
// commandResult や呼び出し元には要約後の文字列だけを渡す。
//
// パターンに一致しない未知のエラーは、要約せず「最初の行」を（長すぎる
// 場合のみ切り詰めて）返す。生のメッセージを完全に隠さない
// （CLAUDE.md「エラーを握りつぶすコードを見逃さない」）。詳細な複数行の
// 生メッセージ自体は、呼び出し元（node-lifecycle.ts）が console.error に
// 残す前提で、ここでは commandResult.error に載せる要約だけを返す。

/** 未知パターンのフォールバック時、commandResult.error に載せる長さの上限。 */
const FALLBACK_MAX_LENGTH = 200;

/**
 * forge create / cast send の "parser error:" 形式（値の文字列パースに
 * 失敗した際の3行構成: 値 / ^ によるカラム位置 / 理由）で出てくる理由文言を、
 * 既知のものならより分かりやすい文言に変換する。未知の理由はそのまま返す
 * （パターン自体は検出できているので、生の理由を見せても最低限の情報には
 * なる）。
 */
function describeParserErrorReason(reason: string): string {
  switch (reason) {
    case "expected at least one digit":
      return "not a non-negative integer";
    case "invalid string length":
      return "not a 20-byte hex address (0x + 40 hex digits)";
    case "invalid boolean":
      return "not a boolean; expected true or false";
    default:
      return reason;
  }
}

/** 既知のエラーパターン1件分: 検出用の正規表現と、マッチ結果からの要約生成。 */
interface ErrorPattern {
  /** ログ・テストで参照しやすいようパターンに名前を付ける（要約文には出さない）。 */
  name: string;
  regex: RegExp;
  summarize: (match: RegExpMatchArray) => string;
}

// 順序に意味がある。先頭から順に試し、最初にマッチしたパターンを使う。
// 例えば `cast send --value abc ...` の CLI レベルの
// "error: invalid value 'abc' for '--value <VALUE>': parser error:\n..." は
// cliInvalidValue にもマッチしうるが、内側に入れ子になっている
// "parser error:" のほうがより具体的な理由を含むため、parserError を先に
// 試す。
const ERROR_PATTERNS: ErrorPattern[] = [
  {
    // forge create / cast send が値の文字列パースに失敗したときの3行形式。
    // 例: "parser error:\ntest\n^\nexpected at least one digit"
    name: "parserError",
    regex: /parser error:\s*\n([^\n]*)\n[^\n]*\n([^\n]+)/,
    summarize: (m) =>
      `invalid argument value "${m[1].trim()}": ${describeParserErrorReason(m[2].trim())}`,
  },
  {
    // cast の CLI（clap）レベルの引数エラー。値の長さ等がその場で拒否され
    // "parser error:" まで到達しない場合。
    // 例: "error: invalid value '0xnotanaddress' for '[TO]': invalid string length"
    name: "cliInvalidValue",
    regex: /error: invalid value '([^']*)' for '([^']*)':\s*([^\n]+)/,
    summarize: (m) =>
      `invalid value "${m[1]}" for ${m[2]}: ${describeParserErrorReason(m[3].trim())}`,
  },
  {
    // cast send で関数呼び出しの引数の数がABIと合わない場合。
    // 例: "encode length mismatch: expected 2 types, got 1"
    name: "encodeLengthMismatch",
    regex: /encode length mismatch: expected (\d+) types?, got (\d+)/,
    summarize: (m) => `function argument count mismatch (expected ${m[1]}, got ${m[2]})`,
  },
  {
    // forge create でコンストラクタ引数の数がABIと合わない場合。
    // 例: "Constructor argument count mismatch: expected 1 but got 3"
    name: "constructorArgCountMismatch",
    regex: /Constructor argument count mismatch: expected (\d+) but got (\d+)/,
    summarize: (m) => `constructor argument count mismatch (expected ${m[1]}, got ${m[2]})`,
  },
  {
    // コントラクトの require/revert によるオンチェーンの失敗。理由文字列が
    // 付いている場合は ", data:" の手前までを理由として扱う。
    // 例: "execution reverted: ChainvizToken: transfer amount exceeds balance, data: \"0x...\""
    name: "executionReverted",
    regex: /execution reverted(?::\s*([^,]*))?,\s*data:/,
    summarize: (m) => {
      const reason = m[1]?.trim();
      return reason
        ? `contract call reverted: ${reason}`
        : "contract call reverted (no reason returned)";
    },
  },
  {
    // ネイティブ送金・ガス代がアカウント残高を超える場合。
    // 例: "insufficient funds for gas * price + value: have 100 want 999"
    name: "insufficientFunds",
    regex: /insufficient funds for gas \* price \+ value: have (\S+) want (\S+)/,
    summarize: (m) => `insufficient balance for this transaction (have ${m[1]}, need ${m[2]})`,
  },
];

/**
 * forge/cast の失敗時 stderr（`result.stderr.trim() || result.stdout.trim() ||
 * \`exit code ${n}\`` の形で組み立てられた detail 文字列）から、既知の
 * パターンを検出してユーザー向けの簡潔な要約文へ変換する。
 *
 * どのパターンにも一致しない場合は、最初の行を（`FALLBACK_MAX_LENGTH` を
 * 超える場合のみ切り詰めて）そのまま返す。生のメッセージを完全に隠さない
 * ためのフォールバックであり、意図的な仕様（このモジュール冒頭のコメント
 * 参照）。
 */
export function summarizeOperationError(detail: string): string {
  const trimmed = detail.trim();
  for (const pattern of ERROR_PATTERNS) {
    const match = trimmed.match(pattern.regex);
    if (match) return pattern.summarize(match);
  }
  const firstLine = trimmed.split("\n")[0] ?? trimmed;
  return firstLine.length > FALLBACK_MAX_LENGTH
    ? `${firstLine.slice(0, FALLBACK_MAX_LENGTH)}…`
    : firstLine;
}
