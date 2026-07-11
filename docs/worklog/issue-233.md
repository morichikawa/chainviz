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

#### テスト強化(chainviz-tester)

実装担当の `cleanup.unit.test.ts`(`removeCardIfPresent` の基本4分岐)を
土台に、異常系・境界値・構造整合の観点でテストを追加した。既存の
`*.edge.unit.test.ts` 命名慣習に合わせ、関心事ごとに3ファイルへ分割した
(1ファイル1責務)。

- 新規 `packages/e2e/src/ui/support/cleanup.edge.unit.test.ts`
  (`removeCardIfPresent` の異常系・境界。6ケース):
  - `waitForButton → click → waitForRemoved` の呼び出し順が厳密に1回ずつ
    であること。
  - エラー分類の境界: `waitForButton` が Error 以外の値(文字列・
    `undefined`)で reject しても握りつぶす(空 catch が値の種類に依存
    しない)。
  - ボタンが一瞬出現した直後に消える競合(`waitForButton` は成功するが
    続く `click` が element detached で失敗)は握りつぶさず伝播し、
    `waitForRemoved` へ進まないこと。「握りつぶす経路」と「伝播する経路」の
    境界がタイミングで誤判定されないことを固定する。
  - 上記競合でもクリックが通り `waitForRemoved` が即 resolve するなら
    エラーなく成功扱いになること。
  - 連続呼び出しの独立性: 1回目がボタン不在で握りつぶされても2回目は
    通常どおり削除まで進むこと。
- 新規 `packages/e2e/src/ui/support/cleanup-orchestration.unit.test.ts`
  (Playwright 配線層。9ケース。Browser/Page/Locator をフェイクし、
  削除ボタンの `waitFor`/`click` の成否だけを制御して実 `expect` マッチャに
  依存しない):
  - `removeInfraCardIfPresent`: 正しい `infra-card-remove-<id>` を指定
    timeout で待つこと、ボタン不在なら click しないこと、出現後は正しい
    ボタンをクリックすること。
  - `cleanupRemovableCards`: 0件・全空文字なら `browser.newPage` を開かず
    即座に返る(成功パスで待ちを増やさない境界)、空文字混在時は有効な
    entityId のみ対象にする、複数カードでもページを1回だけ開き
    goto→各後始末→close を1度ずつ行う、`viewport` の有無で `newPage` 引数が
    変わること。
  - 複数カードの相互影響と finally 保証(不具合2相当): 途中のカードで削除が
    失敗すると例外を伝播し以降のカードは処理されない一方、`page.close` は
    finally で必ず呼ばれること。
- 新規 `packages/e2e/src/ui/support/cleanup-consistency.unit.test.ts`
  (4ファイルへの適用の一貫性。13ケース。この不具合の本質である「修正が
  一部にしか行き渡らない」再発を検知する):
  - `commands-node` / `commands-workbench` / `wallet-balance` /
    `token-balance` の4 spec が全て `./support/cleanup.js` から
    `cleanupRemovableCards` を import し、`afterAll` で
    `cleanupRemovableCards(browser, ...)` を呼んでいること。
  - 4 spec の `afterAll` が旧不具合の温床だった「削除ボタンの即時
    `count()` 判定」インライン後始末を持たないこと。

**回帰検出の確認**: consistency テストが実際に再発を検知できることを、
`commands-node.spec.ts` の `afterAll` に旧アンチパターン
(`infra-card-remove-<id>` の即時 `count()` 判定)を一時的に差し込んで確認
した。該当ケースが期待どおり失敗し、差し戻すと再び green になることを
確認済み。

**確認**: `pnpm --filter @chainviz/e2e build`(tsc --noEmit)・`pnpm lint`・
`pnpm --filter @chainviz/e2e test`(unit 129件、うち新規28件、すべて
green)を確認した。docker を要する `test:e2e` / `test:e2e:ui` は今回の
追加対象外(追加したのは docker 不要の `*.unit.test.ts` のみ)。

**追加ファイル一覧**:
- 新規: `packages/e2e/src/ui/support/cleanup.edge.unit.test.ts` /
  `cleanup-orchestration.unit.test.ts` / `cleanup-consistency.unit.test.ts`

#### レビュー(chainviz-reviewer)

**判定: 差し戻し**(下記の指摘2件の対応後に再レビュー)。

確認して問題なかった点:

- `removeCardIfPresent` のエラー分類は設計として妥当。握りつぶすのは
  `waitForButton` の失敗(=既に削除済みの通常ケース)のみで、`click` /
  `waitForRemoved` の失敗は素通しで伝播する。意図的な握りつぶしには
  理由コメントが付いており、CLAUDE.md「エラーを握りつぶすコードを
  見逃さない」に適合。Issue #201 レビューの残課題(catch範囲が広すぎる)
  も対象4ファイルでは解消されている。
- 対象4ファイル(commands-node / commands-workbench / wallet-balance /
  token-balance)の共有ヘルパーへの移行は一貫している。旧インライン実装の
  残骸なし。
- `pnpm build` / `pnpm lint` / `pnpm test` をリポジトリ全体で実行し
  すべて green(e2e 129件・shared/collector/frontend 含む)。
- コミット粒度は「1変更1コミット」を満たし(feat→fix→refactor→docs→
  test→docs の6コミット)、Conventional Commits 準拠。
- `docs/PLAN.md`(チェック+Issueリンク)・`docs/WORKLOG.md`(索引)・
  本worklogの記述は実装と一致。
- タイムアウト値(30秒等)は既存テストの実績値を根拠とするコメントが
  付いており、決め打ち定数の禁止ルールに抵触しない。

指摘1: `multi-client.spec.ts` の afterAll が旧パターンのまま取り残されている。

- 同ファイル(main のコミット beff94c で追加。本ブランチの merge-base に
  含まれる)の `afterAll` は
  `removeButton.click({ timeout }).catch(() => {})` というインライン実装で、
  (a) 本Issueの不具合2(クリック後、カードが実際に消えるまで待たずに
  `page.close()` する)がそのまま残っており、(b) `.catch(() => {})` が
  クリックの全失敗を無差別に握りつぶす(Issue #201 レビュー指摘と同型)。
  Issue #238 の本文にも、このファイルの後片付け漏れコンテナ
  (`chainviz-ethereum-e2e-ui-multi-02-2`)が実際に残留した観測記録がある。
- 本worklogの設計メモ自身が「修正が一部にしか行き渡らない再発を防ぐため
  1箇所へ集約する」ことを本Issueの目的として掲げている以上、同一ツリーに
  同型の未移行 afterAll を残したままでは目的を達成したといえない。
  `cleanupRemovableCards(browser, addedWorkbenchIds, { timeoutMs })` への
  移行は小さな変更で済むため、本ブランチで移行すること(移行しない判断を
  とる場合は、その理由を本worklogに明記し別Issueを立てること。ただし
  指摘2の修正と両立しない点に注意)。
- なお `multi-client.spec.ts` 内のコメントは「Issue #238 に追記して別途
  フォローアップする」と書いているが、実際のフォローアップは本Issue #233
  であり、参照がずれている。移行時にこのコメントも整理すること。

指摘2: `cleanup-consistency.unit.test.ts` の第4ケースが看板倒れになっている。

- テスト名・コメントは「4ファイル以外に後始末ファイルが増えていないかを
  検知し、リストの更新を促す」と謳っているが、実装はリスト内4ファイルを
  再読するだけで、リスト外のファイルを一切走査していない(第1ケースの
  重複でしかない)。現に `multi-client.spec.ts` という「リスト外で
  afterAll 後始末を行うファイル」が存在するのにこのテストは green の
  ままであり、「壊れた状態でも通ってしまう意味のないテスト」に該当する。
- `src/ui/` 配下の `*.spec.ts` を実際に列挙し、「afterAll でカード削除の
  後始末を行うファイル(例: `afterAll` と `infra-card-remove-` クリックを
  併せ持つもの、あるいは `cleanupRemovableCards` を使うもの)」の集合が
  `CLEANUP_SPEC_FILES` と一致することを確認する実装に改めること。

QA(chainviz-qa)への申し送り:

- `pnpm test:e2e:ui` による実ブラウザ・実docker環境での確認は本ブランチ
  では未実施(実装担当・テスト担当とも docker 不要のユニットテストのみ
  実行)。QA では UI 層 E2E を実行し、特に UI-CMD 系・UI-C 系の完走後に
  `docker ps -a` で e2e 由来の残存コンテナが無いことを確認すること。
- 競合状態そのもの(goto直後の未反映タイミング)は意図的な再現手段が
  無いため、QA での確認は「後始末が正常系で完遂すること」の確認となる。

#### レビュー差し戻し対応(指摘1・指摘2)

レビューで指摘された2件に対応した。

**指摘1: `multi-client.spec.ts` の移行漏れ**

`multi-client.spec.ts` の `afterAll` を、他4ファイルと同じ
`cleanupRemovableCards(browser, addedWorkbenchIds, { timeoutMs: ... })`
呼び出しに置き換えた。これにより、この Issue が対象とする2つの不具合
(スナップショット未反映時の誤判定・削除完了を待たない `page.close`)が
このファイルでも解消され、`.catch(() => {})` によるクリック全失敗の
無差別な握りつぶしも無くなった。あわせて、ずれていた参照コメント
(「Issue #238 に追記して別途フォローアップする」)も削除した(実際の
フォローアップ先は本 Issue #233 であり、`cleanupRemovableCards` への
移行そのものがそのフォローアップにあたるため)。

対象5ファイル(commands-node / commands-workbench / multi-client /
wallet-balance / token-balance)がすべて共有ヘルパー経由になったことを
確認した。

**指摘2: `cleanup-consistency.unit.test.ts` 第4ケースの看板倒れ**

第4ケースを、`src/ui/` 直下を `readdirSync` で実走査し、各 `*.spec.ts`
ファイルの `test.afterAll` 本体を波括弧の対応関係で切り出した上で
`cleanupRemovableCards` 呼び出しまたは `infra-card-remove-` への直接
参照(旧インライン後始末パターンへの逆戻り)の有無を判定する実装に
改めた。検出結果の集合を `CLEANUP_SPEC_FILES` と突き合わせることで、
「共有ヘルパー未移行のファイルが存在する」状態を実際に検知できるように
した(単純な正規表現で `test.afterAll(...)` の終端 `}` を決め打つと、
本体内の `if`/`for`/`try` が持つ入れ子の `}` に引きずられて誤検知する
恐れがあるため、開き括弧からの深さを辿って対応する閉じ括弧を探す
方式にした)。

**回帰検出の確認(指摘1・2の両方)**: 修正前に問題が実際に存在し、
修正後に解消することを以下の手順で確認した。

1. `git stash` で本対応の2ファイルの変更を退避し、レビュー差し戻し時点
   (`multi-client.spec.ts` が旧インライン実装のまま、
   `cleanup-consistency.unit.test.ts` が看板倒れの第4ケースのまま)の
   状態で `pnpm --filter @chainviz/e2e test` を実行したところ、指摘どおり
   全13件 green のまま(=移行漏れを検知できない)であることを確認した。
2. `cleanup-consistency.unit.test.ts` の修正のみを復元し
   (`multi-client.spec.ts` は旧実装のまま)再実行したところ、新しい
   第4ケースが期待どおり失敗し
   (`multi-client.spec.ts` は共有ヘルパーを呼んでいない)、移行漏れを
   実際に検知できることを確認した。
3. `multi-client.spec.ts` の修正も復元し、再実行したところ全16件
   (5ファイル×3ケース+新第4ケース)が green になることを確認した。

**最終確認**: `pnpm build`(shared/collector/e2e/frontend)・`pnpm lint`・
`pnpm test`(shared 62件・e2e 132件・collector 1154件・frontend 1732件、
すべて green)を確認した。`pnpm test:e2e:ui` は今回も docker 環境を要する
ため未実施(引き続き `chainviz-qa` での実機検証に委ねる)。

**変更ファイル一覧(差し戻し対応分)**:
- 変更: `packages/e2e/src/ui/multi-client.spec.ts`(afterAll を
  `cleanupRemovableCards` 呼び出しに置き換え。ずれた参照コメントを整理)
- 変更: `packages/e2e/src/ui/support/cleanup-consistency.unit.test.ts`
  (第4ケースを `src/ui/` の実走査ベースの実装に置き換え、
  `CLEANUP_SPEC_FILES` に `multi-client.spec.ts` を追加)
- 変更: `docs/worklog/issue-233.md`(本追記)

#### 再レビュー(chainviz-reviewer)

**判定: 合格**。

差し戻した2件の対応を確認した。

- 指摘1(`multi-client.spec.ts` の移行漏れ): 解消。`afterAll` が
  `cleanupRemovableCards(browser, addedWorkbenchIds, { timeoutMs })` 呼び出しに
  置き換わり、旧インライン実装(`.catch(() => {})` による無差別な握りつぶし・
  削除完了を待たない `page.close`)は残っていない。ずれていた参照コメント
  (Issue #238 への言及)も削除済み。
- 指摘2(`cleanup-consistency.unit.test.ts` 第4ケース): 解消。`readdirSync` で
  `src/ui/` 直下の `*.spec.ts` を実走査し、最初の `test.afterAll(` の本体を
  波括弧の深さ追跡で切り出した上で `cleanupRemovableCards` /
  `infra-card-remove-` の有無を判定し、検出集合を `CLEANUP_SPEC_FILES` と
  突き合わせる実装になっている。

検知能力はレビュー側でも独立に再確認した(worklog の主張を鵜呑みにしない
ため)。

1. `multi-client.spec.ts` を差し戻し時点(旧インライン実装)に一時的に
   戻して consistency テストを実行 → 第1・第2ケース(import / 呼び出し)が
   multi-client について失敗し、移行漏れを検知できることを確認。復元済み。
2. リスト外の合成 spec ファイル(afterAll 本体に `if`/`try-finally` の
   入れ子波括弧+インラインの `infra-card-remove-` クリックを含む)を
   一時的に `src/ui/` へ置いて実行 → 第4ケースが期待どおり失敗し、
   「リスト外のファイルが後始末を持つ」方向の検知と、入れ子波括弧が
   あっても本体切り出しが誤らないことの両方を確認。削除済み。

worklog の記述の訂正が1点: 差し戻し対応の「回帰検出の確認」手順2は
「新しい第4ケースが期待どおり失敗し」とあるが、その構成
(`multi-client.spec.ts` が旧実装のまま・`CLEANUP_SPEC_FILES` には
multi-client を含む)で実際に失敗するのは第1・第2ケースである。旧実装の
afterAll 本体は `infra-card-remove-` への参照を含むため第4ケースの走査では
「後始末を行うファイル」として検出され、期待リストとも一致して green の
まま。移行漏れの検知自体はスイート全体として成立しており(上記1で確認)、
実装の欠陥ではなく記録の不正確さに留まるため、この訂正記録をもって
差し戻しはしない。

走査ロジックの将来リスクとして認識しておくべき点(現状は非該当。対応不要):

- 判定対象は各ファイル最初の `test.afterAll(` のアロー関数本体のみ。
  `function` 式のコールバックや2つ目以降の `afterAll` に後始末を書いた
  場合は検出から漏れる。現状の全 spec は「アロー関数の afterAll が1つ」で
  統一されており、リスト内ファイルは第2ケースがアロー形式を固定している。
- afterAll 本体内の文字列リテラルに不均衡な波括弧(例: `"}"`)が入ると
  本体切り出しが途中で終わる可能性がある。現状該当なし。

その他の確認: `pnpm build` / `pnpm lint` / `pnpm test`(shared 62・e2e 132・
collector 1154・frontend 1732)すべて green。追加3コミット
(fix→test→docs)は1変更1コミット・Conventional Commits 準拠。前回合格
済みの観点(エラー分類・4ファイルの移行・docs整合)に影響する変更はない。

QA への申し送りは前回レビュー時のものを引き継ぐ(`pnpm test:e2e:ui` の
実機実行と、完走後の `docker ps -a` での残存コンテナ確認。multi-client の
UI-MULTI 系も対象に含めること)。

#### QA検証記録(chainviz-qa)

**判定: 完了条件を満たしていない(NOT PASS。差し戻し)。**

実機(docker compose Ethereumスタック + Playwright実ブラウザ)で
`pnpm test:e2e:ui` を対象5ファイル(commands-node / commands-workbench /
wallet-balance / token-balance / multi-client)に対して実行した。

**環境準備**: この環境では Playwright の chromium が必要とするシステム
ライブラリ(libnspr4.so / libnss3.so / libnssutil3.so / libasound.so.2 等)が
未インストールで、初回実行は全テストがブラウザ起動段階で失敗した
(`error while loading shared libraries: libnspr4.so`)。過去のセッション
(Issue #245 対応)が scratchpad に展開済みだった同ライブラリ群を
`LD_LIBRARY_PATH` で参照させ、実ブラウザ(Google Chrome for Testing 149)が
起動することを確認してから再実行した。docker スタックは globalSetup が
`docker compose up -d` で起動し、チェーン進行を確認して開始した。

**結果**: 7 passed / 4 failed / 2 did not run。実行後 `docker ps -a` で
動的追加ノード `chainviz-ethereum-reth4` / `chainviz-ethereum-beacon4` が
稼働中のまま残存した。**完了条件(UI層E2E完走後に追加した動的コンテナが
後片付けされていること)は満たされていない。**

**残存の根本原因(Issue #233 の変更とは別のリグレッション)**:

- UI-CMD-01(commands-node.spec.ts:79)が
  `expect(addedRethId).toBeTruthy()`(line 125)で決定的に失敗する
  (同条件で2回再現)。addNode 自体は成功しノードカードは
  before.size+2 まで増える(line 110 は通過)が、追加カードの subtitle を
  `subtitle === "reth"` / `=== "lighthouse"` の完全一致で判定している
  (line 122-123)ため、どちらにも一致せず addedRethId / addedBeaconId が
  空文字のままになる。
- 原因は Issue #215(node-role-visibility、本ブランチに取り込み済みの
  コミット e327072)がノードカードの subtitle を、役割が判明している場合に
  「{役割ラベル} · {clientType}」形式(例: 「実行クライアント · reth」)へ
  変更したこと。追加されるフォロワー reth は役割 execution に分類される
  ため subtitle は「実行クライアント · reth」となり、`=== "reth"` は偽に
  なる(InfraNodeCard.test.tsx の #215 ケースが
  「実行クライアント · reth」を期待していることと一致)。UI-CMD-01 の
  判定はこの形式変更に追従していない。UI層E2Eは CI(pre-push)で実行
  されない(lint/build/unit-testのみ)ため、#215 マージ時にこの破綻が
  検知されず潜在化していた(main 側の commands-node.spec.ts も同じ完全
  一致のままであり、本ブランチ固有の破綻ではない)。
- UI-CMD-01 が ID 捕捉前に失敗する結果、afterAll の
  `cleanupRemovableCards(browser, [addedRethId=""], ...)` は空文字を除外して
  対象0件で即 return し、addNode が作成した reth4/beacon4 を後始末できない。
- この残存 reth4/beacon4 が後続 multi-client(UI-MULTI-01/02)の
  `waitForBaselineNodes`(6ノード期待)を「Received: 8」で失敗させる連鎖も
  起きた(残存2ノード分が上乗せされた)。token-balance(UI-C-05)の失敗は
  操作パネル submit ボタンのクリックが p2p-legend 要素に遮られる別要因の
  タイムアウトで、これも Issue #233 とは無関係。

**Issue #233 のヘルパー自体は正常に機能している(肯定的証拠)**:

- token-balance(UI-C-05)はテスト本体が途中で失敗したにもかかわらず、
  実行後に受け取り用ワークベンチのコンテナは1つも残存しなかった。これは
  「テストが entityId を捕捉済みで、かつ本体が途中失敗した」ケースで
  `cleanupRemovableCards` の安全網が実際にコンテナを削除できたことを示す
  (まさに Issue #233 が対象とする後片付けシナリオ)。
- したがって残存 reth4/beacon4 は `cleanup.ts` の欠陥ではなく、UI-CMD-01 が
  ID を捕捉できずに失敗した(= 安全網に渡す ID が空になった)ことに起因する。

**副次的観点(設計判断として記録)**:

- 現行の安全網は「テストが捕捉した entityId」しか掃除できない。追加は
  docker レベルで成功しているのにテストが ID 捕捉前に失敗するケース
  (今回の UI-CMD-01)ではコンテナが漏れる。Issue #238 の残存コンテナ
  問題の再発を確実に防ぐには、捕捉済み ID の削除に加えて「キャンバス上の
  削除可能カード(compose 起動でないもの)をすべて掃除する」形の安全網に
  する選択肢がある。ただしこれは Issue #233 の当初スコープを超える設計
  判断のため、対応可否は統括に委ねる。

**差し戻し先の提案**:

1. (完了条件のブロッカー)UI-CMD-01 の subtitle 判定を Issue #215 の新形式
   「{役割ラベル} · {clientType}」に追従させる修正 → frontend(または
   e2e の UI spec 担当)。これが解消しないと本 Issue の完了確認
   (E2E 完走 + コンテナ残存なし)が取れない。別 Issue 化して先に直すのが
   妥当。
2. Issue #233 本体(`cleanup.ts` への集約)の扱い(このまま合格とみなすか、
   上記副次観点の安全網強化まで含めるか)は統括の判断。

**環境後始末**: 本検証で作成した reth4/beacon4 は QA 側で `docker rm -f` で
除去済み。ベースの compose スタックは再利用のため稼働継続。事前から存在
した停止コンテナ reth3/beacon3(2026-07-09 生成、本セッション作成物では
ない)は残置している。
