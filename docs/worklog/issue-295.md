# Issue #295 残高不足エラーメッセージがwei単位の生数値で表示され分かりにくい

## 2026-07-12 Issue #295 設計（wei→ETH変換の置き場所と表示仕様）

- 担当: designer
- ブランチ: issue-295-balance-error-eth-display
- 内容: 送金操作の残高不足時に `commandResult.error` へ載る要約文
  （`insufficient balance for this transaction (have <wei>, need <wei>)`）の
  数値を ETH 単位表示へ変換するための設計。変換ロジックの置き場所・丸め
  挙動・作業分担を確定した。実装コードは書いていない（設計のみ）。

### 現状のデータフロー（変更しない部分）

forge/cast の stderr → `summarizeOperationError()`
（`packages/collector/src/adapters/ethereum/operation-error-summary.ts`、
ChainAdapter 境界の内側）→ `node-lifecycle.ts` が throw → CommandHandler →
`commandResult.error`（string）→ WebSocket → frontend のトースト表示。

このフロー自体は変えない。変換は `summarizeOperationError` の
`insufficientFunds` パターンの `summarize` 内に閉じる。

### 決定事項1: 変換ロジックは collector 側に軽量実装する（shared へ共通化しない）

`packages/shared` へ `formatUnits` を共通化する案は採らない。理由:

1. `packages/shared` は現在ランタイム export がゼロの純粋な型定義
   パッケージ（world-state / events / protocol / chain-profile すべて型のみ。
   テストも型の絞り込みのコンパイル時検証が目的）。CLAUDE.md も shared を
   「共有スキーマ（ワールドステートの型定義）」と位置づけており、この
   1箇所の修正のためにパッケージの性格を変えるのは過大
2. 「wei」「ETH」「decimals=18」は Ethereum 固有の前提。エラーメッセージの
   組み立ては ChainAdapter 境界の内側（`adapters/ethereum/`）で完結して
   おり、変換もそこに閉じるのが境界原則に合致する。shared へ置くと逆に
   チェーン固有の前提が共有層へ滲む
3. 共通化が正当化されるのは「複数パッケージ・複数チェーンで同じ変換が
   必要」になった時点。現時点で collector 側の利用箇所は 1 つだけであり、
   今共通化するのは先回り実装（CLAUDE.md「先の Phase のための先回り実装を
   しない」）
4. frontend の `entities/tokenAmount.ts` の `formatUnits` は
   `Intl.NumberFormat` 等を使わない BigInt の純関数（約30行）で、複製
   コストが小さい。二重管理のリスクは「表示桁数の趣味の差」程度で、
   仕様が発散しても実害がない

frontend 側の `formatUnits` / `formatEther` は変更しない（UI の残高表示は
桁が揃う固定4桁のままが適切）。

### 決定事項2: 表示仕様（丸め挙動）

frontend の `formatUnits`（切り捨て・固定 fractionDigits・末尾ゼロ保持、
例 `1.0000`）をそのまま複製せず、エラーメッセージ用に以下の仕様とする:

- BigInt で計算し精度落ちさせない（Number 変換禁止）
- 小数部は最大 **6桁**・**切り捨て**（丸めない）
- 末尾ゼロは削るが、小数部は最低1桁残す（`1 ETH` ではなく `1.0 ETH`。
  Issue 本文の期待例に合わせる。整数と紛れない表記）
- 単位 `" ETH"` の付与はヘルパーではなく `summarize` テンプレート側で行う
  （ヘルパーは数値文字列だけ返す）
- `BigInt()` で解釈できない入力（正規表現の `\S+` は理論上非数値も拾う）
  は入力文字列をそのまま返す（frontend `formatUnits` と同じフォール
  バック方針。エラーメッセージ生成の途中で throw しない）

**6桁の根拠**（固定値の前提条件。CLAUDE.md「観測できる状態に依存した
固定値」ルールに基づき明記）: 本プロファイルの開発ネットで残高不足の
have/need 差の最小オーダーはガス代で、21000 gas × ~1 gwei ≈ 0.000021 ETH
（1e-5 オーダー）。小数4桁（1e-4）ではガス分の差が消えて have と need が
同一表示になりうるため、それを表現できる 6桁（1e-6）とした。ガス価格が
極端に下がる等で 1e-6 ETH 未満の差になった場合は have/need が同一表示に
なりうるが、生の wei 値は `node-lifecycle.ts` が必ず `console.error` へ
残す設計（Issue #209）のため、正確な値はログから追える。許容する。

### 決定事項3: shared 型変更なし・frontend 作業なし

- `commandResult.error` は既存どおり単一 string。「have/need を構造化して
  protocol に載せ、frontend 側で `formatEther` 表示する」案は却下
  （エラー種別ごとの構造化は protocol 拡張として過大で、`summarize` の
  設計思想「境界の内側で要約文字列に落とし、外へは文字列だけ渡す」に
  反する）
- frontend / shared / node-env に作業はない。実装は collector のみ

### 波及確認: 影響は insufficientFunds パターンのみ

`operation-error-summary.ts` の他の4パターンを確認した:

- `parserError` / `cliInvalidValue`: ユーザー入力値のエコー（wei ではない）
- `encodeLengthMismatch` / `constructorArgCountMismatch`: 引数の個数
- `executionReverted`: revert 理由文字列（例: "transfer amount exceeds
  balance"。数値を含まない）。ERC-20 のトークン量が理由文字列に載る
  規約は使っていない

よって数値変換が必要なのは `insufficientFunds` のみ。

### 実装担当（chainviz-collector）への引き継ぎ

1. 新規ファイル `packages/collector/src/adapters/ethereum/ether-display.ts`
   （1ファイル1責務。`operation-error-summary.ts` に埋め込まない）:
   - `formatWeiAsEther(wei: string): string` — 上記「決定事項2」の仕様
   - 対応するテスト `ether-display.test.ts`（整数 ETH・小数切り捨て・
     末尾ゼロ削り・最低1桁・6桁超の切り捨て・非数値フォールバック・
     Issue の実例 `1000000000000000000000000000` → `1000000000.0` など）
2. `operation-error-summary.ts` の `insufficientFunds.summarize` を
   `insufficient balance for this transaction (have ${formatWeiAsEther(m[1])} ETH, need ${formatWeiAsEther(m[2])} ETH)`
   の形へ変更
3. `operation-error-summary.test.ts` の既存 insufficientFunds ケースを
   期待値ごと更新（変換後の ETH 表示を期待する）

実装時に判断してよい点: ヘルパーの内部構成（frontend `formatUnits` の
アルゴリズムを参考に書き下ろしてよい）、テストケースの追加。
変えてはいけない点: 上記の決定事項1〜3、ファイル分割方針。

### ARCHITECTURE.md 更新の要否

不要と判断した。エラー要約機構（Issue #209）は ARCHITECTURE.md に節を
持たず（コード内コメントが正）、本件はスキーマ・プロトコル・UX 構造の
いずれにも触れないメッセージ文言レベルの変更のため、該当箇所が存在
しない。設計判断の記録は本ファイルが担う。
