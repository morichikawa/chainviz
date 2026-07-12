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

## 2026-07-12 Issue #295 実装（着手前メモ）

- 担当: collector
- 設計メモ（上記）の決定事項1〜3・引き継ぎ内容をそのまま採用する。
  実装方針を以下に確認として記す。

### 実装方針

1. `packages/collector/src/adapters/ethereum/ether-display.ts` を新規作成し、
   `formatWeiAsEther(wei: string): string` を実装する。中身は
   `packages/frontend/src/entities/tokenAmount.ts` の `formatUnits`
   （BigInt計算・符号処理・`decimals` 桁ゼロ埋めしてから先頭
   `fractionDigits` 桁を取り出す方式）を土台に、decimals=18・
   fractionDigits=6 固定へ単純化し、以下を追加する:
   - 末尾ゼロを削る（ただし小数部は最低1桁残す。`replace(/0+$/, "")` の
     結果が空文字になったら `"0"` を補う）
   - `BigInt()` が解釈できない入力は wei をそのまま返す（既存
     `formatUnits` と同じフォールバック方針）
   単位 `" ETH"` は付けない（呼び出し側の `summarize` テンプレートで付与）。
2. `ether-display.test.ts` に以下のケースを用意する: 整数ETH
   （末尾ゼロ削り後 `.0` が残る例）、小数が6桁ちょうど、6桁を超える値の
   切り捨て、小数末尾に複数ゼロがある場合の削り、Issueの実例
   （`1000000000000000000000000000` → `1000000000.0` /
   `999999999999999999999999999999999` → `999999999999999.999999`）、
   非数値入力のフォールバック、負値。
3. `operation-error-summary.ts` の `insufficientFunds.summarize` を
   `formatWeiAsEther` 適用後に ` ETH` を付与する形へ変更する。
4. `operation-error-summary.test.ts` の該当ケース（"summarizes insufficient
   native balance for a transfer"）の期待値を ETH 表示に更新する。
5. コミットは (a) `ether-display.ts` 新設+テスト、(b)
   `operation-error-summary.ts` の呼び出し変更、(c)
   `operation-error-summary.test.ts` の既存ケース期待値更新、の3つに分ける
   （設計・エラーパターン修正・既存テスト更新で関心事が異なるため）。
6. 実装後、`chainviz-ethereum` スタックを起動し、残高の少ないアカウントから
   多い額を送金するコマンドを実際に発行して `commandResult.error` に
   ETH 単位の表示が出ることを確認する。

### 実装結果

設計・着手前メモの方針どおりに実装した。

- `packages/collector/src/adapters/ethereum/ether-display.ts`（新規）:
  `formatWeiAsEther(wei: string): string` を実装。BigInt計算、decimals=18
  固定、小数部最大6桁を切り捨て、末尾ゼロを削る（最低1桁は残す）、
  `BigInt()` が解釈できない入力は入力をそのまま返すフォールバック。
- `packages/collector/src/adapters/ethereum/ether-display.test.ts`（新規）:
  整数ETH表示・6桁ちょうど・6桁超の切り捨て（四捨五入しないことの確認）・
  末尾ゼロ削り・ゼロ値・負値・Issue実例の2値・非数値/非整数フォールバックの
  10ケース。
- `operation-error-summary.ts`: `insufficientFunds.summarize` を
  `formatWeiAsEther` 経由でETH表示にした上で `" ETH"` を付与する形へ変更。
- `operation-error-summary.test.ts`: 既存の insufficientFunds ケースの
  期待値を ETH 表示に更新（`have 1000000000.0 ETH, need
  999999999999999.999999 ETH`）。

コミットは (1) ether-display 新設+テスト、(2)
operation-error-summary.ts の呼び出し変更、(3) 既存テストの期待値更新、の
3つに分けた。

### 実機検証

`chainviz-ethereum` の Docker スタック（既に起動済みのものをそのまま
利用）に対し、本ブランチでビルドした collector を別ポート
（WebSocket 4100 / proxy 4101）で起動し、WebSocket 経由で
`runWorkbenchOperation`（`transfer`、残高を大幅に超える金額）コマンドを
実際に送信した。

- 修正前の挙動（設計メモ・Issue本文の記述どおり、実装前のコードで再現
  済みと判断できる）: `have <wei>, need <wei>` の生数値表示
- 修正後の実機応答（実測）:
  ```
  commandResult: {"ok":false,"error":"transfer 999999999999999999999999999999999 to 0xfCd9569Ab54097047D3b512510674826aaf444d6 failed on workbench chainviz-ethereum/test: insufficient balance for this transaction (have 999998765.999999 ETH, need 999999999999999.999999 ETH)"}
  ```
  wei の生数値ではなく ETH 単位の小数表示になっていることを確認した。
- 検証用に立てた collector プロセスは確認後に停止した。ワークベンチの
  実行環境（Dockerスタック）自体は変更していない。

### ビルド・テスト

- `pnpm --filter @chainviz/collector build`: 成功
- `pnpm --filter @chainviz/collector test`: 52 test files / 1319 tests
  すべて成功

### ARCHITECTURE.md 更新の要否

不要と判断した。エラー要約機構（Issue #209）は ARCHITECTURE.md に節を
持たず（コード内コメントが正）、本件はスキーマ・プロトコル・UX 構造の
いずれにも触れないメッセージ文言レベルの変更のため、該当箇所が存在
しない。設計判断の記録は本ファイルが担う。

## 2026-07-12 Issue #295 テスト強化（tester）

- 担当: tester
- 内容: 実装担当の基本テスト（ether-display 10 / operation-error-summary の
  insufficientFunds 1）を、切り捨て境界・桁数境界・末尾ゼロ削り・BigInt
  パースの想定外入力・統合の観点で強化した。実装コードは変更していない。

### `ether-display.test.ts` 追加ケース（10 → 31）

- 切り捨て境界（丸めないこと）: 7桁目がちょうど 5 のとき繰り上げない、
  7桁目が 5 より大きくても繰り上げない、6桁目が有効な値のとき落とさない、
  1e-6 ETH ちょうど（表示可能な最小桁）。
- 桁数境界: 1 wei と 999999999999 wei（いずれも 1e-6 ETH 未満）が 0.0 に
  潰れること（worklog「6桁の根拠」で許容と明記した既知の挙動）、uint256
  最大値（2^256-1）が Number の丸め誤差なく 78桁整数部＋6桁小数部で出る
  こと、巨大な負値の小数切り捨て。
- 末尾ゼロ削り: 全ゼロ（1.000000→1.0）・一部ゼロ（1.100000→1.1）・
  内側ゼロを削らない（1.010000→1.01）・先頭ゼロを保持しつつ末尾のみ削る
  （0.000100→0.0001）。
- BigInt パースの想定外入力（throw しないことの網羅）: 空文字列・空白のみ・
  16進（0xff）・先頭プラス符号・前後空白付きは BigInt が解釈して数値化
  される（フォールバックに落ちない）ことを、マイナス符号のみ・
  scientific notation（1e18）・アンダースコア区切り（1_000）・数値＋
  ゴミ（100abc）はフォールバック（入力そのまま返す）に落ちることを、
  それぞれ characterization test として固定した。

### `operation-error-summary.test.ts` 追加ケース（21 → 27）

- insufficientFunds の統合（正規表現マッチ→have/need 両方に formatWeiAsEther
  適用→テンプレート組み立て）: have/need 両値を ETH 変換する、ガス代相当の
  1e-5 差（have 5.0 / need 5.000021）が 6桁表示で潰れず見えること（6桁採用の
  主眼）、sub-1e-6 の値（have 100 want 999）が両方 0.0 ETH に潰れる既知の
  ロスあり挙動、整数 ETH の need に `.0` が付くこと。他パターン（parserError
  等）は既存テストで無影響を担保済み。

### バグ検出力の確認（意図的な実装破壊）

追加テストが元実装のバグを検出できることを、`ether-display.ts` を一時的に
壊して確認した（確認後は元に戻し、diff で同一を確認済み）:

1. 切り捨てを四捨五入に変更 → 切り捨て境界の新規ケースが失敗。
2. 末尾ゼロ削りの正規表現 `/0+$/` を `/0+/` に変更 → 内側ゼロ・先頭ゼロの
   新規ケースが失敗。
3. 小数部最低1桁保証（`trimmed.length > 0 ? trimmed : "0"`）を削除 →
   多数のケースが失敗。

### ファイル分割の判断

`ether-display.test.ts` は単一関数 `formatWeiAsEther` のみを対象とするため
1ファイルのまま維持し、観点ごとに describe ブロックで整理した（1ファイル
1責務。関数が1つなので分割しない）。

### ビルド・テスト

- `pnpm --filter @chainviz/collector build`: 成功
- `pnpm --filter @chainviz/collector test`: 52 files / 1344 tests すべて成功
  （ether-display 31・operation-error-summary 27 を含む）
