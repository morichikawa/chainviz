### 2026-07-11 Issue #236 送金フォーム(TransferForm)の宛先にクライアント側のアドレス形式バリデーションを追加する

#### 設計メモ（実装着手前）

**現状確認**:
- `TransferForm.tsx`の`canSubmit = to.trim() !== "" && amountWei !== undefined`は、
  宛先が空でないことしか見ておらず、アドレス形式（`0x` + 40桁16進）の検証を
  行っていない。金額欄（`amount`）は`parseEtherToWei`で既に検証されており、
  無効な間はエラー文言表示 + 送信ボタン`disabled`のパターンが確立している。
- Issue #209で`operationArgValidation.ts`に`isValidOperationArgValue(type,
  value)`が実装済みで、`type: "address"`は`/^0x[0-9a-fA-F]{40}$/`（大文字
  小文字混在可、EIP-55チェックサム非検証）で判定する。DeployForm/CallFormの
  コンストラクタ引数・関数引数のaddress型入力は既にこの関数で検証されている
  （`OperationArgInput.tsx`経由）が、`TransferForm`は別系統のコンポーネント
  （`AddressField`を直接使い、`OperationArgField`型を経由しない）のため、
  この恩恵を受けていなかった（Issue #209のレビュー記録にも同じ指摘が
  申し送りとして残っている）。
- i18nメッセージ`operation.arg.invalid.address`（「0xで始まる40桁の16進数の
  アドレスを入力してください（例: 0x1234…）」/ 英語版）が既に存在し、
  文言としてもそのまま転用できる（新規に文言を増やすと表記が分裂するため、
  同じ文言を使い回す）。

**実装方針（車輪の再発明をしない）**:
- `TransferForm.tsx`に`isValidOperationArgValue`をインポートし、
  `isValidOperationArgValue("address", to)`で宛先を検証する。新しい
  バリデーション関数は作らない（既存の`operationArgValidation.ts`を
  再利用するのみ）。
- `canSubmit`の条件に「宛先が空でないこと」に加えて「宛先がアドレス形式
  として妥当であること」を追加する。
- エラー表示は既存の金額欄と同じ「無効な入力があるときだけ`operation-form__error`
  クラスの`<p>`を出す」パターンに揃える。表示位置は`AddressField`の直後
  （`CallForm.tsx`のamount欄エラーと同じく、対象フィールドの直下）とする。
  文言は新規追加せず`operation.arg.invalid.address`を再利用する。
- `AddressField.tsx`自体は変更しない（`OperationArgInput.tsx`と違い、
  `TransferForm`は`OperationArgField`という型を持たないため、エラー表示は
  `TransferForm`側で完結させる。既存の金額欄と同じ構成に揃える）。
- 既存の`TransferForm.test.tsx`は「送信成功」を確認するテストで`"0xbob"`
  という不正な形式のアドレスを使っており、今回の変更でこれらは送信不可に
  変わる。Issue #209のCallForm.test.tsxで行ったのと同様に、有効な40桁hex
  アドレスへ差し替える。あわせて、不正アドレスで送信ボタンが無効化される
  こと・エラー文言が表示されること・訂正後に送信可能に戻ることを確認する
  新規テストケースを追加する。

以上を踏まえて実装する。

#### 実装記録

- 担当: frontend
- ブランチ: issue-236-transfer-address-validation
- 内容:
  - `TransferForm.tsx`に`operationArgValidation.ts`の
    `isValidOperationArgValue("address", ...)`を再利用した宛先の形式検証を
    追加。`toTrimmed`（trim済み宛先）を導出し、`toValid = toTrimmed !== ""
    && isValidOperationArgValue("address", toTrimmed)`とした上で
    `canSubmit`の条件に組み込んだ（宛先が空、または形式不正なら送信不可）。
  - 宛先が非空かつ形式不正なときだけ、既存の金額欄と同じ
    `operation-form__error`クラスの`<p>`でエラー文言を表示する
    （`data-testid="operation-transfer-to-error"`）。新規の文言は追加せず、
    Issue #209で追加済みの`operation.arg.invalid.address`をそのまま再利用
    した（DeployForm/CallFormのaddress型引数と同じ文言・トーン）。
  - 新規のバリデーション関数・i18nキーは追加していない（既存ロジックの
    再利用のみ）。`AddressField.tsx`自体は変更していない。
  - テスト: `TransferForm.test.tsx`に、既存の「送信成功」系テストが使って
    いた不正な形式の値`"0xbob"`を有効な40桁hexアドレスへ差し替えた上で、
    以下を新規追加した。
    - 不正な形式（`"0x123"`）で送信ボタンが無効化され、エラー文言
      （`data-testid`）が表示されること。
    - 宛先が空の間はエラー文言を表示しないこと（未入力とバリデーション
      エラーの区別。金額欄と同じ方針）。
    - 不正な値を入力後、有効な値に訂正するとエラーが消え送信可能に戻る
      こと（状態遷移の確認）。
    - フォームの`submit`イベント発火（Enterキー等のボタンdisabled回避
      経路）でも不正な宛先ではガードが効き`onSubmit`が呼ばれないこと。
  - `OperationPanel.test.tsx`の「送金フォーム送信でrunWorkbenchOperationが
    呼ばれる」テストが同じく`"0xbob"`を使っていたため、有効な40桁hex
    アドレスへ差し替えた（`TransferForm`をレンダーして実際に送信する
    唯一の他コンポーネントテストだったため）。
  - `grep`で他に`"0xbob"`を使うテストが多数あることを確認したが、
    いずれも`TransferForm`自体をレンダーせず、コマンド送出後の下流層
    （`useCommandsWorkbenchOperations`・`contractActivity`・
    `mockData.workbenchOperations`等、任意の文字列をそのまま受け取る
    フィクスチャ）のテストであり、今回のバリデーションの影響を受けない
    ため変更していない。
- 動作確認:
  - `pnpm --filter @chainviz/frontend build` / `pnpm --filter
    @chainviz/frontend test`、および`pnpm exec eslint`（変更ファイル）が
    いずれも成功。
  - ルートの`pnpm build` / `pnpm test`（shared/collector/e2e/frontend
    全パッケージ）も成功（frontend: 112ファイル1736テストgreen）。
- 決定事項・注意点:
  - Issue本文にある「collector側: Foundryの生エラーをそのまま
    `commandResult.error`に乗せず、既知パターンを要約する」については、
    Issue #209で`summarizeOperationError`が既に実装済みで、`transfer`の
    宛先不正（`[TO]`のCLIレベルエラー）も要約対象に含まれている
    （`operation-error-summary.ts`の対応表#6）。したがって、このIssueで
    collector側の追加対応は不要と判断した（フロント側のクライアント
    バリデーションで送信前にブロックするのが主対応、collector側の要約は
    既存の保険としてそのまま機能する）。
  - `TransferForm`は今後も`AddressField`を直接使う構成のままとした
    （`OperationArgInput`への統合はスコープ外。`OperationArgField`という
    ABIカタログ由来の型を持たないため、無理に共通化すると型の整合を
    取るための追加の抽象化が必要になり、今回のIssueの範囲を超える）。

#### テスト強化記録（tester）

- 担当: tester
- 目的: 実装担当が追加した基本テスト（TransferForm.test.tsx）に対し、
  宛先アドレスバリデーションの境界値・異常系・状態遷移を補強する。
- 追加内容: 新規ファイル
  `packages/frontend/src/operations/TransferForm.addressValidation.test.tsx`
  を作成し、Issue #236固有のエッジケースをここに集約した（既存の
  TransferForm.test.tsxは基本挙動、operationArgValidation.test.tsは関数単体
  という関心分離に揃え、既存ファイルの肥大化を避けた）。追加した観点:
  - 境界値（送信不可+エラー表示、submitイベントでも送出されないこと）:
    39桁/41桁の16進、`0x`無しの40桁、大文字`0X`プレフィックス、
    非16進文字、桁間に空白を含む値、`0x`のみ、ウォレットラベル文字列。
  - 有効な境界値（エラー非表示+送信可能）: 大文字小文字混在の
    checksummedアドレス（EIP-55非強制）、前後に空白がある有効アドレス
    （trim後の値で送出されること）。
  - 空白のみの入力は「未入力扱い」でエラーを出さずボタンのみ無効（空欄と
    バリデーションエラーの区別）。
  - エラーの共存・優先順位: 宛先と金額が同時に不正なとき両方のエラーが
    並存すること、片方だけ訂正しても他方のエラーが残り送信不可のままの
    こと、両方揃って初めて送信可能になること。
  - 往復操作: 不正→有効→不正でエラー表示とボタン活性が正しく追従する
    こと、不正値を全消しで空に戻すとエラーが消える（未入力扱いに復帰）
    こと。
  - `isValidOperationArgValue("address", ...)`単体の境界（39/41桁・
    大文字小文字混在・`0x`無し・大文字`0X`・埋め込み空白・前後空白・
    非16進）は既存の`operationArgValidation.test.ts`で網羅済みのため、
    関数側のテスト追加は不要と判断した。
- 実装のバグ・差し戻し事項: 無し（既存実装の挙動は境界値・異常系とも
  期待どおりで、テストは全て追加時点でgreen）。
- 動作確認: `pnpm --filter @chainviz/frontend build`（成功）、
  `pnpm --filter @chainviz/frontend test`（113ファイル1753テストgreen。
  従来1736 + 新規17）、新規ファイルのeslint（成功）。

#### レビュー記録

- 担当: reviewer
- ブランチ: issue-236-transfer-address-validation
- 判定: **合格**
- 確認した内容:
  - 既存ロジックの再利用: 新しいバリデーション関数・正規表現・i18nキーを
    追加せず、Issue #209 の `isValidOperationArgValue("address", ...)` と
    既存文言 `operation.arg.invalid.address` をそのまま再利用していることを
    コードで確認。車輪の再発明は無い。
  - 表示パターンの一貫性: エラー表示は `OperationArgInput.tsx`
    （DeployForm/CallForm の address 型引数）と同じ
    「非空かつ無効なときのみ `operation-form__error` クラスの `<p>` を表示、
    未入力はボタン無効化のみ」のパターンで、`data-testid` も既存の
    `${testId}-error` 規約（`operation-transfer-to-error`）に沿っている。
  - ガードの二重化: ボタンの `disabled` に加えて `handleSubmit` 内でも
    `canSubmit` を確認しており、Enter キー等の submit イベント経路でも
    不正な宛先で `onSubmit` が呼ばれないことをテストで検証済み。
  - テストの質: 実装担当の基本4ケースに加え、tester の
    `TransferForm.addressValidation.test.tsx`（17件）が 39/41桁・`0x`無し・
    大文字 `0X`・非16進・埋め込み空白・空白のみ・ラベル文字列などの境界値、
    宛先と金額のエラー共存・片方のみ訂正・往復編集の状態遷移を DOM の実挙動
    （エラー表示・ボタン活性・`onSubmit` 呼び出し有無）で検証しており、
    実装の詳細をなぞるだけの無意味なテストは無い。既存テストの `"0xbob"`
    差し替えも、TransferForm をレンダーする2ファイルのみに限定されており
    影響範囲の判断が worklog に記録されている。
  - 境界の遵守: フロント内で完結する変更で、チェーン固有語彙の漏れ・
    `packages/shared` への影響は無い。エラーの握りつぶし・環境状態依存の
    決め打ち定数も無い。collector 側対応が不要という判断は
    `packages/collector/src/adapters/ethereum/operation-error-summary.ts` の
    `cliInvalidValue` パターン（`[TO]` の CLI レベルエラーを要約）が既に
    存在することを確認し、妥当と判断した。
  - ビルド・lint・テスト: リポジトリルートで `pnpm build` / `pnpm lint` /
    `pnpm test` が全て成功（frontend: 113ファイル1753テスト green）。
  - コミット粒度: `fix(frontend)` / `docs` / `test(frontend)` の3コミットで
    1変更1コミット・Conventional Commits に準拠。
  - docs: `docs/PLAN.md` のチェック + Issue リンク、`docs/WORKLOG.md` 索引の
    1行追加、worklog の設計メモ・実装記録・テスト強化記録がいずれも実装と
    一致している。
- 指摘事項: 無し。
