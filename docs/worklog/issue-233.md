### 2026-07-11 Issue #233 UI-CMD系PlaywrightテストのafterAllクリーンアップが競合状態で無効化されうる

#### 設計メモ(着手前)

**背景**: Issue #201 の実装中に、`test.afterAll` によるワークベンチ/ノードの
後始末処理に2つの競合状態があることが判明した。

1. `page.goto("/")` 直後は WebSocket 接続・snapshot 受信・React 描画が
   完了していないことがあり、直後に `removeButton.count()` を判定すると
   実際にはカードが存在するのに `0` と判定されて削除がスキップされる。
2. 削除ボタンのクリックはコマンド送信のみで、docker 停止・削除の完了を
   待たない。カードが実際に消えるまで待たずに `page.close()` すると、
   そのファイルが最後の実行ファイルだった場合に直後の `globalTeardown` で
   collector が停止し、削除が完遂しないままコンテナが残る。

Issue #201 では `wallet-balance.spec.ts` / `token-balance.spec.ts` の2ファイル
だけこの場しのぎの回避策(`waitFor` で出現を待ってからクリックし、
`toHaveCount(0)` で消滅を待つ)をインラインで実装したが、同型の
`commands-node.spec.ts` / `commands-workbench.spec.ts`(Issue #200)は
当時の作業範囲外として未修正のまま残されていた。さらに、直したはずの
2ファイルの実装にもレビューで指摘された残課題がある
(`docs/worklog/issue-201.md` の「軽微な指摘」): `waitFor` → `click` →
`toHaveCount(0)` を1つの `try/catch` にまとめてしまっているため、
「ボタンが最後まで見つからない(既に削除済みの通常ケース)」以外に
「クリックそのものが失敗した」「削除完了待ちがタイムアウトした(=本当に
削除が失敗した)」場合まで同じ `catch` で握りつぶしてしまい、後始末が
本当に失敗してもログも例外も残らない。これは CLAUDE.md
「エラーを握りつぶすコードを見逃さない」に反する状態でもある。

**方針**: 4ファイル(`commands-node.spec.ts` / `commands-workbench.spec.ts` /
`wallet-balance.spec.ts` / `token-balance.spec.ts`)に同じロジックを
コピーで増やすと、今回のように「直したはずが一部にしか適用されていない」
再発を繰り返す。そこで安全な削除後始末ロジックを
`packages/e2e/src/ui/support/cleanup.ts` に1箇所へ切り出し、4ファイル
すべてがそこから呼び出す形にする。

- `removeCardIfPresent(actions)`: Playwright に依存しない純粋な
  オーケストレーション関数。`{ waitForButton, click, waitForRemoved }` の
  3つの非同期アクションを受け取り、
  - `waitForButton` が失敗(ボタンが最後まで現れない)した場合は「既に
    削除済み」とみなして何もせず返る(想定される通常ケース)
  - `waitForButton` が成功したら `click` → `waitForRemoved` の順に実行し、
    どちらかが失敗したら例外をそのまま呼び出し元に伝播させる(catch で
    握りつぶさない。レビューで指摘された残課題への対応でもある)
  という分岐だけを持つため、実ブラウザ無しで vitest によるユニットテストが
  書ける(`cleanup.unit.test.ts`)。
- `removeInfraCardIfPresent(page, entityId, timeoutMs)`: 上記を
  Playwright の実 API(`getByTestId` + `Locator.waitFor` +
  `expect(...).toHaveCount(0)`)に配線する薄いラッパー。
- `cleanupRemovableCards(browser, entityIds, options)`: `afterAll` 本体が
  行う「(必要なら)ページを開いて goto → 各 entityId を安全に削除 → 必ず
  page.close()」という定型処理をまとめる。`entityIds` が空(=本体テストが
  既に後始末済み)ならページすら開かず即座に返る。

この設計により:
- `commands-node.spec.ts` / `commands-workbench.spec.ts` の `afterAll` は
  従来の即時 `count()` 判定(不具合1)をやめ、`waitFor` ベースの安全な
  判定に置き換わる(不具合1・2の修正)。
- `wallet-balance.spec.ts` / `token-balance.spec.ts` は既存のインライン
  実装を共有ヘルパー呼び出しに置き換え、重複コードを解消しつつ、
  レビュー指摘(catch範囲が広すぎる)も同時に解消する。

**再現性の検討**: この競合状態はタイミング依存(WebSocket接続・snapshot
反映・Reactレンダリングの完了と `page.goto` 後の判定処理の間の競争)であり、
実行環境の負荷やネットワーク遅延に依存するため、意図的かつ安定的に
再現させる制御点が無い(WS配信を遅延させるモックやテスト用フックが
現状の collector/frontend に存在しない)。実際、Issue #201 の worklog に
「実機で確認した不具合」と記載があるとおり、既に一度実機で再現した実績が
ある不具合であり、今回修正する4ファイルは構造的に同一の
`count()` 即時判定パターンを共有している。そのため、今回は
「修正前のコード(即時 `count()` 判定)が原理的にこの競合状態を検知
できないこと」を、実ブラウザでの再現ではなく、新しい
`removeCardIfPresent` のユニットテストで「ボタン出現が遅延するケースでも
正しく削除できる」ことを確認する形で裏付ける(ボタンが遅延して現れる
シナリオを模したテストケースを追加する)。また「クリック後に消滅を待たず
成功扱いにする」旧不具合2についても、`waitForRemoved` が失敗したときに
例外が伝播すること(=握りつぶさないこと)をユニットテストで確認する。
これらは実ブラウザでの再現に代わる形での妥当性確認とする。

#### 実施内容

設計メモどおり、`packages/e2e/src/ui/support/cleanup.ts` を新規作成した。

- `removeCardIfPresent(actions)`: Playwright に依存しない純粋な
  オーケストレーション関数。`waitForButton` が失敗したら何もせず返り、
  成功したら `click` → `waitForRemoved` の順に実行し、いずれかが失敗
  したら例外をそのまま伝播させる。
- `removeInfraCardIfPresent(page, entityId, timeoutMs)`: 上記を実
  Playwright API(`Locator.waitFor` / `Locator.click` /
  `expect(...).toHaveCount(0)`)に配線する薄いラッパー。
- `cleanupRemovableCards(browser, entityIds, options)`: `afterAll` 本体の
  定型処理(ページを開く → goto → 各 entityId を安全に削除 → 必ず
  page.close)をまとめる。`entityIds` が空(=本体テストが既に後始末済み)
  ならページを開かず即座に返るため、通常の成功パスでは追加の待ち時間は
  発生しない。

この共有ヘルパーを次の4ファイルの `afterAll` から呼び出す形に置き換えた。

- `commands-node.spec.ts`: 旧不具合(`removeButton.count()` の即時判定・
  クリック後の完了待ちなし)を修正。reth のカードを削除すると対の beacon
  カードも一緒に消えるため、渡す entityId は `addedRethId` のみでよい
  (UI-CMD-03 のアサーションと同じ前提)。
- `commands-workbench.spec.ts`: 同様に修正。`addedWorkbenchIds`(複数)を
  そのまま渡す。
- `wallet-balance.spec.ts` / `token-balance.spec.ts`: Issue #201 で
  インラインに実装していた同型ロジック(2ファイルにコピーされていた)を
  共有ヘルパー呼び出しに置き換えた。あわせて、Issue #201 のレビューで
  指摘されていた「catch の範囲が click・削除完了待ちまで含んでしまい、
  本当の失敗を握りつぶす」問題も、`removeCardIfPresent` の設計(catch は
  `waitForButton` のみ)によって解消された。

**再現確認**: 設計メモに記載のとおり、実ブラウザでの意図的な再現は
タイミング制御点が無く困難なため見送った。代わりに
`cleanup.unit.test.ts` で以下を確認した。

- ボタンが最後まで現れない場合は何もせず正常終了する(通常ケース)。
- ボタンが遅延して現れる場合(旧不具合1が見逃していたケースを模した
  シナリオ)でも、出現を待ってから正しく削除まで進む。
- クリックが失敗した場合、例外を握りつぶさず伝播させる。
- 削除完了待ちがタイムアウトした場合(旧不具合2相当。削除が完遂しない
  ままにもかかわらず成功扱いにしてしまう問題)、例外を握りつぶさず
  伝播させる。

このテストを一時的に `removeCardIfPresent` の catch 範囲を旧実装同様に
広げてみたところ(削除完了待ち失敗時も何もせず正常終了させる実装に
戻す)、該当のテストケースが実際に失敗する(=期待どおり不具合を検知
できる)ことを確認してから元の実装に戻した。これにより、このテストが
実際に想定する不具合クラスを検出できることを確認済み。

**最終確認**: `pnpm build`(shared/collector/e2e/frontend 全パッケージ)・
`pnpm lint`・`pnpm test`(shared 62件・e2e 101件・collector 1154件・
frontend 1732件、すべて green)を確認した。`pnpm test:e2e:ui` による
実ブラウザでの確認は、docker環境を要するため今回のセッションでは実施
していない(実装は Playwright の公開 API のみを使う配線であり、
wallet-balance.spec.ts / token-balance.spec.ts は元々同じ実装で実 e2e
グリーンだったことを踏まえると回帰リスクは小さいと判断したが、
`chainviz-qa` による実機検証で最終確認する)。

**変更ファイル一覧**:
- 新規: `packages/e2e/src/ui/support/cleanup.ts` /
  `packages/e2e/src/ui/support/cleanup.unit.test.ts`
- 変更: `packages/e2e/src/ui/commands-node.spec.ts` /
  `commands-workbench.spec.ts` /  `wallet-balance.spec.ts` /
  `token-balance.spec.ts`(`afterAll` を共有ヘルパー呼び出しに置き換え)
- 新規: `docs/worklog/issue-233.md`(本ファイル)
- 変更: `docs/WORKLOG.md`(索引追加)・`docs/PLAN.md`(チェックボックス
  更新)
