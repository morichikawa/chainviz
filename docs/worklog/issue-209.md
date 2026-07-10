### 2026-07-10 Issue #209 デプロイ/呼び出しフォームのコンストラクタ引数・関数引数にクライアント側バリデーションを追加する

#### 設計メモ（実装着手前）

**対象範囲**: このIssueのうち frontend 担当分のみ。collector側（forgeの生
stderrをそのまま`Error`に詰めて伝播させている箇所のサニタイズ）は別途
`chainviz-collector`に依頼する別作業とし、ここでは触れない。

**現状確認**:
- `operationCatalog.ts`の`OperationArgField.type`は`"address" | "uint" |
  "string" | "bool"`の4種類だが、実際にカタログ（ChainvizToken/Counter）で
  使われているのは`"uint"`と`"address"`のみ。
- `DeployForm.tsx`のコンストラクタ引数入力、`CallForm.tsx`の関数引数入力の
  どちらも、現状は型に関わらず`type="text"`の自由入力をそのまま
  `constructorArgs`/`args`の文字列配列としてcollectorへ渡している
  （`CallForm.tsx`はaddress型のみ`AddressField`でウォレット候補の
  datalistを提示するが、値そのものの検証はしていない）。
- `TransferForm.tsx`・`CallForm.tsx`のpayable金額欄は既に
  `etherAmount.ts`の`parseEtherToWei`で検証し、無効な間は
  `operation.transfer.amount.invalid`のエラー文言を出しつつ送信ボタンを
  `disabled`にするパターンが確立している。今回はこれと同じパターンを
  ABI型の引数にも適用する。

**バリデーションルール**:
- `type: "uint"`: `/^\d+$/`（先頭ゼロ許容・符号なし・小数/指数表記なし・
  空文字は不可）にマッチする文字列のみ許可する。上限は設けない
  （BigIntで表現できる範囲かどうかはcollector側のエンコード処理に委ねる。
  ここでは「非負整数の見た目をしているか」だけを見る）。
- `type: "address"`: `/^0x[0-9a-fA-F]{40}$/`（`0x`+40桁hex、大文字小文字
  混在可）にマッチする文字列のみ許可する。EIP-55チェックサムの検証は
  行わない（誤ったチェックサムでも`cast`/collector側は解釈できるため、
  ここで弾く必要はない。過剰なバリデーションにしない）。
- `type: "string" | "bool"`: 現状カタログで未使用のため、今回は常に
  「妥当」として扱い自由入力のまま通す（将来これらの型を使うカタログ
  エントリが追加された時点で、別途バリデーションルールを検討する。
  今回のスコープではuint/addressのみと明記されている）。

**実装方針**:
- 新規ファイル`packages/frontend/src/operations/operationArgValidation.ts`に
  純粋関数`isValidOperationArgValue(type, value)`と
  `validateOperationArgs(fields, values)`を実装する（`etherAmount.ts`と
  同様、ロジックをコンポーネントから切り離してユニットテストしやすくする）。
- 新規コンポーネント`packages/frontend/src/operations/OperationArgInput.tsx`で
  「引数入力欄 + （address型なら）ウォレット候補datalist + 無効時の
  インラインエラー文言」をひとつにまとめ、`DeployForm.tsx`と
  `CallForm.tsx`の両方から使う（現状この2箇所でほぼ同じ引数入力の
  マークアップが重複しているため、重複を解消しつつ検証ロジックを
  一箇所に閉じ込める）。
- `DeployForm.tsx`・`CallForm.tsx`はそれぞれ`canSubmit`の条件に
  `validateOperationArgs(...)`を追加し、いずれかの引数が無効な間は
  送信ボタンを`disabled`にする（既存のamount検証と同じ「無効化 +
  エラー文言表示」の併用パターン）。
- i18nメッセージを2件追加する: `operation.arg.invalid.uint` /
  `operation.arg.invalid.address`（`operation.transfer.amount.invalid`と
  同じトーンの文言）。
- `DeployForm`は現状`walletCandidates`を受け取っていない（address型の
  コンストラクタ引数を持つカタログエントリが今のところ存在しないため）。
  今回はバリデーションのみをスコープとし、`walletCandidates`を新たに
  スレッディングする改修（`OperationPanel.tsx`からの配線を含む）は
  行わない。`OperationArgInput`は`walletCandidates`省略時は空配列
  として扱い、address型でも通常のテキスト入力＋バリデーションとして
  機能する（将来コンストラクタにaddress引数を持つカタログが増えた
  場合に備え、コンポーネント自体はcandidates対応済みにしておく）。
- 既存の`DeployForm.test.tsx`/`CallForm.test.tsx`には、現状の
  「クライアント側は型を検証しない」ことを明示的に確認するテストケースが
  複数あり（例:「submits raw constructor arg strings without client-side
  type validation」「submits an empty string for a required constructor
  arg left blank」）、これらは今回の変更で意図的に振る舞いを反転させる
  ため、新しい振る舞いを検証するテストに書き換える。

以上を踏まえて実装する。

#### 実装記録

- 担当: frontend
- ブランチ: issue-209-deploy-form-validation
- 内容:
  - `packages/frontend/src/operations/operationArgValidation.ts`を新規作成。
    `isValidOperationArgValue(type, value)`（1引数の判定）と
    `validateOperationArgs(fields, values)`（複数引数の一括判定）の
    2つの純粋関数を実装。`uint`は`/^\d+$/`、`address`は
    `/^0x[0-9a-fA-F]{40}$/`（EIP-55チェックサムは検証しない）で判定し、
    `string`/`bool`は常に妥当として扱う（スコープ外）。ユニットテスト
    （`operationArgValidation.test.ts`、19ケース）で、Issueの再現値
    （`test`/`sss`）が弾かれること、有効な値・空文字・境界値の挙動を
    確認した。
  - `packages/frontend/src/operations/OperationArgInput.tsx`を新規作成。
    `DeployForm.tsx`/`CallForm.tsx`で重複していた「引数入力欄（address型は
    ウォレット候補のdatalist付き）+ 無効時のエラー文言」のマークアップを
    共通化し、`isValidOperationArgValue`を使って表示を切り替える
    コンポーネントにした。値が空文字の間はエラー文言を出さない
    （既存の`TransferForm`/`CallForm`の金額欄と同じ「未入力はエラー表示
    せず、ボタン無効化のみで防ぐ」方針に揃えた）。ユニットテスト
    （`OperationArgInput.test.tsx`、8ケース）を追加。
  - `DeployForm.tsx`・`CallForm.tsx`を`OperationArgInput`を使うよう書き換え、
    `canSubmit`の条件に`validateOperationArgs(...)`を追加（無効な引数が
    1つでもあれば送信ボタンを`disabled`にする）。
  - i18nメッセージ`operation.arg.invalid.uint`/`operation.arg.invalid.address`
    を`messages.ts`に追加（ja/en両方）。
  - 既存の`DeployForm.test.tsx`/`CallForm.test.tsx`のうち、旧来の
    「クライアント側は型検証しない」ことを明示的に確認していたテスト
    ケースを、新しい振る舞い（無効な入力ではボタンが無効化されエラーが
    出る／有効な入力では送信できる）を確認するテストに置き換えた。
    `CallForm.test.tsx`の既存テストが使っていた`"0xbob"`（不正な
    アドレス値）は、バリデーション追加により送信をブロックする値になる
    ため、有効な40桁hexアドレスに差し替えた。
- 動作確認:
  - `pnpm build`・`pnpm test`（ルート、全パッケージ）がすべて成功。
    frontend単体では93ファイル1403テストが green。
  - `pnpm exec eslint packages/frontend/src/operations
    packages/frontend/src/i18n/messages.ts`でlintエラーなしを確認。
  - `pnpm --filter @chainviz/frontend dev`でモッククライアント
    （`VITE_COLLECTOR_URL`未設定時の既定動作）を使い実際にブラウザ
    （Playwrightのchromiumを一時スクリプトから利用。スクリプト自体は
    確認後に削除済み）を起動して手動確認した。デプロイタブで
    `initialSupply`に`"test"`を入力すると
    「0以上の整数を入力してください（例: 1000）」のエラーが表示され
    送信ボタンが無効化されること、有効な数値に直すとエラーが消え送信
    できるようになることを確認した。呼び出しタブでも同様に、
    `transfer`の`to`引数に不正なアドレス文字列を入れるとエラー表示・
    送信不可になり、有効なアドレス・数量を入れると送信可能になることを
    確認した。
- 決定事項・注意点:
  - collector側（forgeの生stderrをそのまま`Error`に詰めて伝播させている
    箇所のサニタイズ）はこのIssueの範囲外。別途`chainviz-collector`へ
    依頼する別作業として残っているため、Issue #209自体（GitHub）は
    このPRだけではクローズされない見込み。`docs/PLAN.md`のバックログ
    該当行（#209）はチェックを付けず、本文もそのままにした
    （frontend側の対応は完了したが、Issue全体としては未完了のため）。
  - `DeployForm`は現状`walletCandidates`を受け取っておらず、address型の
    コンストラクタ引数にはウォレット候補のdatalistが出ない（今のところ
    ChainvizToken/Counterのどちらもaddress型のコンストラクタ引数を
    持たないため実害はない）。`OperationArgInput`自体は`walletCandidates`
    省略時は空配列として扱う設計にしてあるため、将来address型の
    コンストラクタ引数を持つカタログエントリが増えた場合は、
    `DeployFormProps`に`walletCandidates`を追加し`OperationPanel.tsx`から
    配線すれば対応できる（今回はスコープ外として見送った）。
  - `string`/`bool`型はカタログ未使用のため、バリデーションは常に
    妥当扱いのまま。今後これらの型を使うカタログエントリが追加された
    時点で、別途ルールを検討する必要がある。

### 2026-07-10 Issue #209 collector側: forge/castの失敗stderrを要約してcommandResult.errorへ渡す

#### 設計メモ（実装着手前・collector担当分）

**対象範囲**: このIssueのうち collector 担当分。frontend側（クライアント側の
型バリデーション）は上記で完了済み。ここでは、フロントのバリデーションを
すり抜けるケース（カタログのstring/bool型、将来の呼び出し経路、WebSocket
経由で直接不正なコマンドを送るケース）に対する保険として、
`runWorkbenchOperation`が失敗時にforge/castの生stderrをそのまま
`commandResult.error`へ渡している箇所を、既知パターンを検出した簡潔な
要約文へ変換する。

**実際に手元のchainviz-ethereumスタック（稼働中のものを再利用）で
forge create / cast sendを不正な値で実行し、実際のエラー文言を確認した**
（`chainviz-ethereum-workbench-1`から、`reth1:8545`へ直接向けて実行。
本番経路のロギングプロキシは経由していないが、forge/cast自体が返す
エラー文言はRPC接続先に依存しないため、確認目的としては十分）。

観測できた生エラーのパターンと、対応する要約ルール:

| # | 発生条件 | 生stderr（要旨） | 要約後 |
|---|---|---|---|
| 1 | `forge create --constructor-args test`（uint型引数に非数値） | `Error: parser error:\ntest\n^\nexpected at least one digit` | `invalid argument value "test": not a non-negative integer` |
| 2 | `cast send ... "transfer(address,uint256)" <addr> notanumber`（引数に非数値） | 同上（parser error形式） | `invalid argument value "notanumber": not a non-negative integer` |
| 3 | `cast send ... "transfer(address,uint256)" 0xbadaddr 100`（address引数が短すぎる） | `Error: parser error:\n0xbadaddr\n^\ninvalid string length` | `invalid argument value "0xbadaddr": not a 20-byte hex address (0x + 40 hex digits)` |
| 4 | `cast send ... "setActive(bool)" notabool`（bool引数が不正） | `Error: parser error:\nnotabool\n        ^\ninvalid boolean` | `invalid argument value "notabool": not a boolean; expected true or false` |
| 5 | `cast send --value abc ...`（`--value`のようなCLIオプション自体の値が不正） | `error: invalid value 'abc' for '--value <VALUE>': parser error:\nabc\n^\nexpected at least one digit` | 上記と同じ「parser error」パターンが内包されているため、パターン1と同じ要約規則が先に適用される: `invalid argument value "abc": not a non-negative integer` |
| 6 | `cast send ... 0xnotanaddress`（TO位置引数がclapレベルで拒否される。値が短すぎてparser errorに到達しない） | `error: invalid value '0xnotanaddress' for '[TO]': invalid string length` | `invalid value "0xnotanaddress" for [TO]: not a 20-byte hex address (0x + 40 hex digits)` |
| 7 | `cast send ... "transfer(address,uint256)" <addr>`（引数の数が不足） | `Error: encode length mismatch: expected 2 types, got 1` | `function argument count mismatch (expected 2, got 1)` |
| 8 | `forge create ... --constructor-args 100 200 300`（コンストラクタ引数の数が超過） | `Error: Constructor argument count mismatch: expected 1 but got 3` | `constructor argument count mismatch (expected 1, got 3)` |
| 9 | 残高不足のアカウントからのtoken transfer（`require`のカスタムメッセージ） | `Error: Failed to estimate gas: ...: execution reverted: ChainvizToken: transfer amount exceeds balance, data: "0x08c379a0...": Error("...")` | `contract call reverted: ChainvizToken: transfer amount exceeds balance` |
| 10 | ETHの送金額がアカウント残高を超過 | `Error: Failed to estimate gas: ...: insufficient funds for gas * price + value: have <X> want <Y>` | `insufficient balance for this transaction (have <X>, need <Y>)` |
| 11（未知パターンの例） | 存在しないコントラクトファイルを指定 | `Error: "/contracts/nope.sol": No such file or directory (os error 2)` | パターンに一致しないため、生メッセージの最初の行をそのまま（200文字を超える場合のみ切り詰めて）使う |

**実装方針**:
- 新規ファイル`packages/collector/src/adapters/ethereum/operation-error-summary.ts`に
  純粋関数`summarizeOperationError(detail: string): string`を実装する
  （forge/cast固有の語彙・パースルールなので、ChainAdapter境界の中である
  ethereumアダプタ配下に閉じ込める。`workbench-operations.ts`は
  「コマンドの構築・出力からの情報抽出」が責務なので、「失敗メッセージの
  要約」は関心事が異なる別ファイルに分離する）。
- 既知パターンは正規表現の配列として持ち、先頭から順に試して最初に
  マッチしたものを使う（順序に意味がある。上表#5のように「parser error」
  パターンが「CLIレベルのinvalid valueパターン」の内側に入れ子になっている
  場合があるため、より具体的な「parser error」パターンを先に置く）。
- パターンに一致しない場合は、フォールバックとして生メッセージの最初の
  1行を返す（長い場合のみ200文字で切り詰めて`…`を付与）。生のメッセージを
  完全に隠さない（CLAUDE.md「エラーを握りつぶすコードを見逃さない」）。
- `node-lifecycle.ts`の`runWorkbenchOperation`は、既存どおり
  `console.error`には生のdetail（stderr全文）をそのまま残しつつ、
  `throw new Error(...)`に詰めるメッセージ本文だけを
  `summarizeOperationError(detail)`の戻り値に差し替える。詳細情報は
  ログから追える状態を維持する。
- 単位（wei）の人間可読化（ETH単位への変換等）は今回のスコープに含めない
  （BigInt変換や桁揃えなど別途の設計判断が必要になり、Issueの主眼である
  「型不一致の生パーサーエラーをそのまま見せない」から外れるため）。
  将来必要になれば別Issueとして起票する。
- テストは新規ファイル`operation-error-summary.test.ts`に実装（1ファイル
  1責務の原則をテストファイルにも適用。`workbench-operations.test.ts`
  （既に454行）にこれ以上ケースを積み増さない）。上表の実際の生stderrを
  そのままフィクスチャに使い、既知パターンの検出・要約内容、未知パターンの
  フォールバック（短い文はそのまま・長い文は200文字で切り詰め）の両方を
  カバーする。あわせて`node-lifecycle.test.ts`の既存の失敗系テスト
  （「throws with the stderr detail...」「falls back to stdout...」）が、
  要約後もそれぞれの正規表現アサーション（`/insufficient funds for gas/`
  `/exit code 2/`）を満たし続けることを確認する（既存テストの想定stderrは
  簡略化されたフィクスチャで`summarizeOperationError`の既知パターンには
  一致せずフォールバック＝原文そのまま、になるため、既存アサーションは
  そのまま通る想定）。

以上を踏まえて実装する。

#### 実装記録（collector側）

- 担当: collector
- ブランチ: issue-209-deploy-form-validation
- 内容:
  - `packages/collector/src/adapters/ethereum/operation-error-summary.ts`を
    新規作成。`summarizeOperationError(detail: string): string`を実装し、
    forge/castの失敗stderrから以下の既知パターンを検出して要約する:
    - `parser error:`形式（値の文字列パース失敗。uint/address/boolの
      型不一致すべてがこの形式で出る）
    - CLIレベルの`invalid value '...' for '...':`（clapの引数パーサーが
      parser errorに到達する前に拒否するケース）
    - `encode length mismatch`（関数呼び出しの引数の数の不一致）
    - `Constructor argument count mismatch`（デプロイのコンストラクタ引数の
      数の不一致）
    - `execution reverted`（コントラクトのrevert。requireのカスタム
      メッセージがあれば含める）
    - `insufficient funds for gas * price + value`（ネイティブ残高不足）
    パターンに一致しない場合は、生メッセージの最初の1行を（200文字を
    超える場合のみ`…`を付けて切り詰め）そのまま返すフォールバックとし、
    生のエラーを完全には隠さない方針にした。
  - `packages/collector/src/adapters/ethereum/node-lifecycle.ts`の
    `runWorkbenchOperation`を変更し、失敗時に`throw new Error(...)`へ
    詰めるメッセージ本文を、生のstderr（detail）から
    `summarizeOperationError(detail)`の戻り値に差し替えた。
    `console.error`へ生のdetailをそのまま残す既存の挙動は変更していない
    （詳細情報はログから追える状態を維持）。
  - ユニットテスト`operation-error-summary.test.ts`（17ケース）を新規作成。
    設計メモの対応表にある実際の生stderrをフィクスチャに使い、既知
    パターンごとの要約内容と、未知パターンのフォールバック（そのまま・
    先頭行のみ・200文字切り詰め・前後空白のtrim）を確認した。
  - `node-lifecycle.test.ts`の既存テスト（失敗時にstderr内容がthrowされる
    ことを確認する2件）は変更していない。想定stderrが簡略化された
    フィクスチャのため`summarizeOperationError`の既知パターンには一致せず
    フォールバック（原文そのまま）になり、既存のアサーション
    （`/insufficient funds for gas/`、`/exit code 2/`）はそのまま通ることを
    確認した。
- 動作確認:
  - `pnpm build`・`pnpm lint`（対象ファイルへの`eslint`実行）・
    `pnpm test`（ルート、全パッケージ）がすべて成功。collector単体では
    42ファイル1120テストがgreen（新規17ケースを含む）。
  - 稼働中のchainviz-ethereumスタック（`scripts/dev-up.sh`で起動した
    collector/frontendを含む）を再利用し、実際にforge create / cast send
    を不正な値で実行して生のエラー文言を採取した（設計メモの対応表の
    元データ）。
  - WebSocket経由で実際に`runWorkbenchOperation`コマンドを送り、
    修正前後で`commandResult.error`の内容が変わることを確認した:
    - 修正前（`node-lifecycle.ts`の変更のみ一時的に`git stash`で戻して
      再現）: `deployContract`にIssueと同じ`"test2"`という
      非数値コンストラクタ引数を渡すと、
      `error: "... Error: parser error:\ntest2\n^\nexpected at least one digit"`
      という生の複数行エラーがそのまま返ることを確認（Issue本文の再現手順と
      一致）。
    - 修正後: 同じ操作で
      `error: "... invalid argument value \"test3\": not a non-negative integer"`
      という1行の要約に変わることを確認。あわせて、コンストラクタ引数の
      数が合わないケース（`constructor argument count mismatch (expected 1,
      got 3)`）と、残高不足によるrevertケース（`contract call reverted:
      ChainvizToken: transfer amount exceeds balance`）も実際にデプロイ済み
      コントラクトへ呼び出しを送って確認した。
    - いずれのケースでも`.dev-pids/collector.log`には生のstderr（複数行の
      parser error等）がそのまま残っていることを確認し、詳細情報が
      ログから追える状態を維持していることを確認した。
- 決定事項・注意点:
  - collector側のメッセージは英語のまま（既存の`throw new Error(...)`群と
    同じトーン）にした。collectorパッケージにi18nの仕組みは無く、
    frontend側の`describeCommandError`がi18nの定型文言 +
    このdetail文字列を単純連結する既存パターンに合わせた（多言語対応が
    必要な場合はfrontend側で別途翻訳する設計になっている）。
  - wei単位の金額（`insufficientFunds`パターンのhave/want）はETH単位への
    変換をせず生の10進文字列のまま出す方針にした。桁数は多いが、元の
    RPCエラー全文（"Failed to estimate gas: server returned an error
    response: error code -32003: ..."）よりは大幅に簡潔になっている。
    単位変換は別途の設計判断（丸め方・表示桁数）が必要になるため、
    このIssueのスコープ外として見送った。
  - frontend側・collector側の両方が完了したため、`docs/PLAN.md`の
    バックログ該当行（#209）にチェックを付けた。GitHub Issue自体の
    クローズはPRマージ時の`Closes #209`による自動クローズに委ねる
    （実装担当は`gh issue close`しない）。

#### テスト強化記録

- 担当: tester
- ブランチ: issue-209-deploy-form-validation
- 目的: 実装担当が書いた基本テスト（ハッピーパス中心）に対し、異常系・
  境界値・表記ゆれの観点でケースを追加する。実装コードは変更していない。
- 追加した観点:
  - `operationArgValidation.test.ts`（10ケース追加）:
    - uint: 明示的なプラス符号（`+42`）、数字間に混じった空白・タブ
      （`1 000` / `1\t000`。trim は前後空白のみ）、全角数字（`４２`。
      `\d` は ASCII のみ）、極端に長い桁（`9`×100。上限を設けない設計の
      確認）をそれぞれ弾く／通すことを確認。
    - address: 大文字プレフィックス（`0X…`。小文字 `0x` のみ許可）、
      内部に空白を含むアドレス、前後空白付き（trim して有効）を確認。
    - `validateOperationArgs`: 先頭以外のフィールドが無効な場合の検出、
      フィールド数を超える余分な値の無視、スコープ外の string/bool を
      挟んでも他フィールドの有効/無効が最終結果を左右することを確認。
  - `operation-error-summary.test.ts`（6ケース追加、forge/cast の
    バージョン差異を想定した表記ゆれ）:
    - `encode length mismatch` の単数形 `expected 1 type`（`types?` の
      両対応）、`got 0` のケース。
    - parser error / CLI invalid value の理由が既知パターンに一致しない
      場合に、握りつぶさず生の理由をそのまま載せること（
      `describeParserErrorReason` のデフォルト分岐）。
    - CRLF 改行（Windows 版 forge 出力）でも parser error を要約できること。
    - キャレット位置（`^` の桁）が深い場合でも要約できること。
  - `OperationArgInput.test.tsx`（4ケース追加）:
    - 無効な uint / address でそれぞれ型固有のエラー文言（別々の文言）が
      表示されること（どの引数がなぜ無効かが伝わるか）。
    - 空白のみの値はエラー赤字を出さないこと。
    - エラー文言の `data-testid` が各入力の `testId` プレフィックスに
      紐づくこと（複数引数が並んだときにどの欄のエラーか特定できる）。
  - `CallForm.test.tsx`（3ケース追加）:
    - transfer(address, uint) で一方の引数だけが無効なとき、無効な引数に
      のみエラーが出て有効な引数には出ないこと（to のみ無効 / amount のみ
      無効の両方向）。
    - 2引数とも無効 → 送信不可、両方訂正 → 送信可、という遷移。
  - `DeployForm.test.tsx`（1ケース追加）:
    - 合成カタログ（address + uint の2引数コンストラクタ）で「1つでも
      無効なら送信不可・全て有効なら送信可」が崩れないこと、引数が順序
      どおり `onSubmit` に渡ること。
- 動作確認:
  - `pnpm build` / `pnpm lint` / `pnpm test`（ルート、全パッケージ）が
    すべて成功。frontend は 1421 テスト、collector は 1126 テストが green。
- 決定事項・注意点:
  - テスト強化のみで実装は変更していない。追加ケースを書く過程で
    実装のバグは見つからなかった（既知パターンに一致しない理由は生の
    まま載る、余分な値は無視、といった挙動はいずれも意図的な設計で
    あることをテストで固定した）。
