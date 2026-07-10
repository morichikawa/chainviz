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
