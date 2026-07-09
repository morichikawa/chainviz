### 2026-07-09 Issue #202 異常系・複数クライアントシナリオ(UI-ERR・UI-MULTI)のPlaywright実装と移行済みWSテストの整理(設計メモ)

- 担当: collector
- ブランチ: issue-202-ui-err-multi-scenarios

#### 設計メモ(着手前)

`packages/e2e/SCENARIOS.md`「異常系(UI-ERR)」「複数クライアント・再接続
(UI-MULTI)」節の6シナリオ(UI-ERR-01〜04・UI-MULTI-01〜02)を実装し、
対応する移行元WSテスト(`reconnect.test.ts`の2件: 「複数クライアントへの
差分ブロードキャスト」→UI-MULTI-01、「切断中の変更が再接続後スナップ
ショットに反映」→UI-MULTI-02)を同じコミットの中で削除する。

**着手前に実機で確認した実挙動(SCENARIOS.mdの`予`注記どおり、着手前に
確定させる)**:

1. **UI-ERR-01(collector停止→切断バッジ→再起動→リロードで復帰)**:
   実際にcollectorプロセスをkillすると、フロントの接続状態バッジは
   ほぼ即時(実測12ms)に「切断」へ変わる(TCP接続がプロセス終了で
   即座に閉じるため)。再起動後にページをリロードすると「接続済み」に
   戻り、compose起動の6ノード分のカードも再表示されることを確認した。
   SCENARIOS.mdの記述どおりで矛盾は無い。
2. **UI-ERR-02(collector停止中のaddNode操作)**: SCENARIOS.mdの当初案
   (「タイムアウト(60秒。`GHOST_TIMEOUT_MS`)でエラートーストが表示され、
   ゴーストカードが消える」)を実機で検証したところ、**実際にはエラー
   トーストは一切表示されず、ゴーストカードだけが60秒後に静かに消える**
   ことを確認した。原因は`websocket/client.ts`の`sendCommand`が未接続
   (`socket === null`)でも`commandId`を生成して返してしまい(実際には
   何も送信されない)、`useCommands.ts`の`handleCommandResult`(エラー
   トーストを出す唯一の経路)を経由せず、`entities/ghostNode.ts`の
   `GHOST_TIMEOUT_MS`という「UI上の仮カードを残し続けないための安全網」
   だけでゴーストが消えるため。これは意図された挙動とは言えない
   (実際のUX上の欠落)と判断し、[Issue #235](https://github.com/morichikawa/chainviz/issues/235)
   として起票した。SCENARIOS.mdの確認文言は実挙動(トーストは出ない)に
   合わせて修正する。
3. **UI-ERR-03(定型操作フォームの不正入力の実行前ブロック)**:
   SCENARIOS.mdの原案どおり送金フォームの宛先に`0x123`を入力して確認した
   ところ、`TransferForm.tsx`の`canSubmit`は宛先が空でないことしか見て
   おらず、アドレス形式のバリデーションが無いため**そのまま送信されて
   しまう**ことを確認した(Issue #209のDeployForm引数の同種の問題と同じ)。
   [Issue #236](https://github.com/morichikawa/chainviz/issues/236)として
   起票した。一方、金額フィールド(`amount`)は`parseEtherToWei`による
   クライアント側バリデーションが実際に機能しており(不正な形式だと
   送信ボタンが`disabled`になりインラインエラーが出る)、こちらは
   SCENARIOS.mdの「実行前に弾かれる」という意図をそのまま体現できる。
   よってUI-ERR-03の操作対象を「宛先の不正なアドレス」から「金額の
   不正な値(例: `abc`)」に差し替え、宛先側の欠落は上記Issueへの参照を
   備考として残す形でSCENARIOS.mdを修正する。
4. **UI-ERR-04(残高超過の送金失敗)**: 静的ワークベンチ(compose起動)の
   プリセットウォレットは`EL_PREMINE_COUNT=8`により約7億ETH
   (実測: `699999998.999999999987587632`)というジェネシス由来の大きな
   残高を持つため、金額には残高を明確に超える値(実装では`999999999999`
   ETH。10進の桁数を多めに取り、環境依存の実際の残高がどうであれ確実に
   超過するようにする)を使う必要がある。この場合`cast send`のgas見積り
   時点で`insufficient funds for gas * price + value`という具体的な
   エラーがほぼ即座(実測1秒程度)に返り、commandResult(ok:false)経由で
   エラートーストに反映されることを確認した(SCENARIOS.mdの原案どおりで
   矛盾なし)。トーストの文言はFoundryのバージョンに依存しうるため、
   テストの合格条件は文言の完全一致ではなく「入力した宛先アドレスを
   含む(=汎用メッセージへのすり替えでない、具体的な内容であることの
   証拠)」とする。

**collectorプロセスの停止・再起動の扱い方(UI-ERR-01/02共通)**:

`playwright-global-setup.ts`のglobalSetupはUI層E2E専用ポート(4125)で
collectorを1つ起動する。UI-ERR-01/02は「テストハーネスが実際にcollector
プロセスを停止・再起動する」ことが本質なので、既存の起動済みcollectorを
対象にkill/再起動する方式を選んだ(親タスクの指示どおり「実装しやすい方」。
新規に別ポートのcollectorを都度立てる方式は採らなかった。理由: フロントの
`VITE_COLLECTOR_URL`はvite dev起動時にビルド時埋め込みされる値のため、
1ページだけ別collectorへ向けるにはfrontendにURLオーバーライド機構を
追加する必要が生じ、frontend側のスコープ変更になってしまう)。

**実装時に判明した誤り(着手時の設計との差分)**: 当初「globalSetupが
起動したcollectorの参照をモジュールスコープの可変変数(レジストリ)に
差し替え可能な形で持たせ、globalTeardownはそのレジストリ経由で最新の
collectorを止める」という設計にしたが、実機で実行したところ
`no collector registered yet`エラーで即座に失敗した。原因は、
**Playwrightの`globalSetup`/`globalTeardown`はテストを実際に走らせる
「ワーカープロセス」とは別のOSプロセスで実行される**ため、globalSetupが
メモリ上に書き込んだ変数はワーカープロセス側のテストコード
(`connection-errors.spec.ts`)からは一切見えないというNode.jsのプロセス
モデル上の制約だった(同一プロセス内のクロージャ共有を前提にした設計の
誤り)。この問題を修正し、以下のファイルベースの受け渡しに設計し直した:

- `helpers/collector-registry.ts`は、`os.tmpdir()`配下の固定パス
  (`e2e-lock.ts`の排他ロックファイルと同じ考え方。UI層E2Eは
  `acquireE2eLock()`により同時に1本しか走らない前提のため固定パスでも
  衝突しない)へ「現在のcollectorのPID/ポート」をJSONで書き込む
  (`registerCollector`)/読む(`readRegisteredCollector`)/削除する
  (`clearRegisteredCollector`)関数と、登録済みcollectorをPIDベースで
  SIGTERM→(反応なければ)SIGKILLで停止する`stopRegisteredCollector`を
  提供する。プロセスをまたいでも、ファイルという共有ストレージ経由なら
  正しく最新の状態を読み書きできる
- `playwright-global-setup.ts`(メインプロセス)は起動したcollectorを
  `registerCollector`でファイルへ書き込み、globalTeardownは
  `stopRegisteredCollector`→`clearRegisteredCollector`の順で後片付けする
  (クロージャの変数は使わない)
- `connection-errors.spec.ts`(ワーカープロセス)は、`stopRegisteredCollector()`
  で既存collectorを停止→アサーション→`startCollector(UI_E2E_COLLECTOR_PORT)`
  で再起動→`registerCollector(...)`でファイルを更新、という手順を踏む。
  これにより、globalTeardownが実行される時点(メインプロセス)で
  受け渡しファイルを読めば、ワーカープロセスが再起動した「差し替え後の
  collector」のPIDが正しく分かり、孤児プロセスを残さず後始末できる
- `connection-errors.spec.ts`は`test.afterEach`で「collectorが生きて
  いなければ(`isRegisteredCollectorAlive()`がfalse)再起動し登録し直す」
  安全網を持つ(UI-ERR-02はシナリオの性質上collectorを止めたまま
  テストを終える構成になるため、後続の他specファイルのために必ず
  collectorを復旧させてからテストを終える)
- `stopRegisteredCollector`のPID生死判定・kill呼び出しはテストで差し替え
  可能なDIパラメータにした(`e2e-lock.ts`の`AcquireE2eLockOptions`と同じ
  流儀)。これにより`collector-registry.unit.test.ts`で実プロセスを
  起動・終了させずにSIGTERM→SIGKILLの切り替えロジックを検証できる

**ファイル分割方針**(1ファイル1責務。#199〜#201の分割方針を踏襲):

- `src/ui/connection-errors.spec.ts`: UI-ERR-01・UI-ERR-02
  (collector停止・再起動を扱う。前述のレジストリ経由のcollector制御)
- `src/ui/form-validation.spec.ts`: UI-ERR-03・UI-ERR-04
  (定型操作フォームのバリデーション。`support/operations.ts`の
  `openOperationPanel`等を再利用)
- `src/ui/multi-client.spec.ts`: UI-MULTI-01・UI-MULTI-02
  (`browser.newContext()`で複数ブラウザコンテキストを扱う)

**UI-MULTI-01/02の実装方針**:

- `browser`フィクスチャから`newContext()`で独立したブラウザコンテキスト
  (Cookie/localStorage等を共有しない、別クライアント相当)を作る
- UI-MULTI-01: コンテキストA/Bで`page.goto("/")`→両方で compose起動の
  6ノードカードが揃うのを待つ(baseline確立。#200と同じ理由)→Aで
  `addWorkbench`→A・B両方にカード出現を確認→Bで`removeNode`→A・B両方で
  消滅を確認、という一連をA/Bの`page`を使い分けて実施する
- UI-MULTI-02: コンテキストAで対象ワークベンチが無いことを確認した後、
  `page.close()`で切断を模す→**別コンテキストB**で`addWorkbench`→
  カード確定を待つ→コンテキストAで`context.newPage()`により新しい
  ページを開く(＝シナリオの「Aで再度ページを開く」)→新しいスナップ
  ショットに反映されていることを確認する。`page.close()`と
  `context.newPage()`の組み合わせにより、同じコンテキスト(A)のまま
  「一度切断してから再度開く」という体裁を保ちつつ、実際のWebSocket
  切断(タブを閉じる=TCP接続が閉じる)を発生させる
- 追加したワークベンチの後始末は`commands-workbench.spec.ts`と同じ
  `test.afterAll`の安全網パターン(未削除のものが残っていれば削除ボタンを
  押す)を使う。UI-MULTI-01はシナリオ自体が削除まで含むため通常は
  afterAllで何もしないが、途中失敗時の保険として同じ仕組みに乗せる

**タイムアウトの根拠**:

- ノード/ワークベンチカード出現・消滅待ち: 既存踏襲の
  `ENTITY_APPEAR_TIMEOUT_MS = 30_000`(`support/operations.ts`。#200/#201
  で実績のある値)をそのまま使う
- UI-ERR-01の切断バッジ反映待ち: 実測12msだが、実行環境の負荷変動を
  見込んで安全側に既存の接続バッジ関連の実績値(`connection.spec.ts`が
  使う30秒)をそのまま踏襲する
- UI-ERR-02のゴースト消滅待ち: `GHOST_TIMEOUT_MS = 60_000`
  (frontend側の固定UX定数。ネットワークの稼働時間等の環境状態に依存
  しない値のため、この値を直接の根拠にしてよい)に安全マージン10秒を
  足した`70_000`を待ち上限にする。この待ちだけで70秒かかるため、
  Playwrightの既定テストタイムアウト(`playwright.config.ts`の
  `timeout: 60_000`)を`test.setTimeout(120_000)`で明示的に上書きする
- **前提条件**: `GHOST_TIMEOUT_MS`はfrontend側の固定値であり、
  この値自体が変更された場合はUI-ERR-02の待ち上限もそれに追随させて
  見直すこと(値の根拠がfrontend側の実装に一致していることが前提)

**UI-ERR-04の残高超過金額の前提条件**: 静的ワークベンチの残高は
`profiles/ethereum/values.env`の`EL_PREMINE_COUNT`とジェネシス生成時の
premine量に依存する(実測時点で約7億ETH)。テストで使う超過金額
(`999999999999`ETH)は「実測残高より確実に大きい」ことを狙った安全側の
固定値であり、premine量の設定自体が将来大きく変わった場合はこの値も
見直すこと。

#### 作業中に見つけた別件の指摘(その場では直さずIssue化)

- [Issue #235](https://github.com/morichikawa/chainviz/issues/235):
  collector切断中に送信したaddNode/addWorkbenchは、ゴースト消滅のみで
  エラートーストが出ない(前述の実挙動確認3参照)
- [Issue #236](https://github.com/morichikawa/chainviz/issues/236):
  送金フォーム(TransferForm)の宛先にクライアント側のアドレス形式
  バリデーションが無い(前述の実挙動確認3参照。Issue #209の同種の問題)

### 2026-07-09 Issue #202 異常系・複数クライアントシナリオ(UI-ERR・UI-MULTI)のPlaywright実装と移行済みWSテストの整理(完了)

- 担当: collector
- ブランチ: issue-202-ui-err-multi-scenarios

#### 内容

前セッションが中断した状態(設計メモ・6シナリオの実装ファイル・
collector-registry.tsによるプロセス間collector停止/再起動の受け渡し機構・
reconnect.test.tsの移行対象2件削除まで一通り完了していた)を引き継ぎ、
以下を実施した。

1. **`packages/e2e/src/ui/form-validation.spec.ts` のUI-ERR-03アサーション
   修正**: `aria-busy` 属性が厳密に `"false"` であることを検証していたが、
   実機で検証したところ稼働中のチェーンではブロック高進行のタイミング
   次第でこの属性自体がDOM上から欠落する(=`undefined`)ことがあり、
   決定的でないことが判明した(`App.tsx` の `infraNodesWithHighlight` の
   メモ化最適化に起因。詳細は起票した
   [Issue #237](https://github.com/morichikawa/chainviz/issues/237)
   参照)。アサーションを `not.toHaveAttribute("aria-busy", "true")`
   (busyでないことの確認としてはこちらで意味論上十分)に変更した。
2. **`packages/e2e/src/ui/multi-client.spec.ts` の後片付け(`afterAll`)
   修正**: `commands-node.spec.ts`/`commands-workbench.spec.ts`
   (Issue #200)と同型の「`page.goto("/")` 直後に `removeButton.count()`
   を同期的に読んで0件なら削除をスキップする」実装が、スナップショット
   反映前のタイミングと「既に削除済み」を区別できないレースを持つことを
   実機で確認した(UI-MULTI-02が作成したワークベンチが後片付けされずに
   残り続ける事象を実際に再現)。`removeButton.click({ timeout:
   ENTITY_APPEAR_TIMEOUT_MS }).catch(() => {})` へ変更し、Playwrightの
   自動待機に後片付けの成否判定を任せる形にした。同型のレースが残る
   既存2ファイルへの手当ては本Issueの範囲を超えるため、
   [Issue #238](https://github.com/morichikawa/chainviz/issues/238)へ
   追記コメントで申し送りした。
3. `packages/e2e/SCENARIOS.md` の該当6見出し(UI-ERR-01〜04・
   UI-MULTI-01/02)の `予` を `済` に変更し、UI-ERR-02(実際にはトースト
   非表示)・UI-ERR-03(金額バリデーションへの差し替え)の確認文言を実挙動
   に合わせて修正した。§1棚卸し表の2行(reconnect.test.ts由来の2件)を
   「移行済み(#202で削除)」に更新した。
4. `docs/PLAN.md` のチェックボックスにチェックを付けた。

#### 検証

- `pnpm test:e2e:ui`(29テスト、UI-ERR-01〜04・UI-MULTI-01/02の6シナリオ
  含む)を実行し、全件green(29/29)になることを確認した(複数回実行し
  安定してgreenになることを確認済み)。
- `pnpm test:e2e`(プロトコル層、13テスト)・`pnpm test`(collector/
  frontend/shared/e2e の全ユニットテスト)・`pnpm build`・`pnpm lint`が
  いずれも通ることを確認した。

#### 調査中に見つけた別件の指摘(その場では直さずIssue化)

検証の過程で `pnpm test:e2e:ui` のフルスイート実行が断続的に(60〜70%
程度の頻度で)テスト11〜14番目あたりからカスケード的に失敗する事象に
遭遇した。詳しく調査した結果、以下が判明した。

- 失敗中は実際に **collectorプロセスが死んでいた**(登録ファイルが指す
  PIDが存在せず、WebSocketポートがconnection refusedだった)。フロント
  のレンダリング不具合ではなく、collectorプロセス自体のクラッシュが
  原因。
- `packages/collector/src/index.ts` の `installProcessSafetyNet` は設計上
  `uncaughtException` を捕捉すると `process.exit(1)` する(Issue #63/#65
  の経緯によるフェイルファスト方針)。この安全網自体は正しい設計判断
  だが、collectorの生死を監視して再起動する仕組みが
  `connection-errors.spec.ts`(本Issueで新規追加。UI-ERR-01/02で初めて
  collectorを実際に停止・再起動する)の `afterEach` にしか無いため、
  **他のspecファイル実行中に何らかの理由でcollectorが落ちると、以降の
  スイート全体が復旧しないままカスケード的に失敗する**という構造的な
  弱点がある。
- 実際にcollectorが何の例外で落ちているかは特定できなかった(標準出力が
  子プロセスの内部バッファにのみ蓄積され、クラッシュ後に取り出す手段が
  無かった)。SIGTERM/SIGKILLによる停止・再起動サイクルそのものを
  スタンドアロンスクリプトで模擬し、90秒間フレッシュなWS接続を繰り返し
  ても再現しなかったため、単純な再起動サイクル自体が原因ではなく、
  実ブラウザ(chromium)によるページ遷移・WebSocket接続の挙動と絡んだ
  もう少し複雑な条件が必要と見られる。
- [Issue #238](https://github.com/morichikawa/chainviz/issues/238)として
  詳細な再現条件・切り分け結果・対応候補(collectorクラッシュ時のログ
  保存、スイート全体で使える生死チェックの共通化、各specの後片付けの
  頑健化)を記録して起票した。本Issueの完了条件(6シナリオがgreenになる
  こと)は複数回のクリーンな実行で満たしていることを確認済みのため、
  この件は今回のPRでは対応せず追って調査する。

### 2026-07-09 Issue #202 テスト強化記録

- 担当: tester
- ブランチ: issue-202-ui-err-multi-scenarios

#### 追加したテストの観点

`collector-registry.unit.test.ts` に異常系・境界値のケースを追加した
(12ケース → 26ケース)。UI-ERR-01/02 が collector プロセスを実際に
停止・再起動する土台となる受け渡し機構のため、プロセス間で共有する
ファイルの破損・型不一致・PID の生死判定を重点的に補強した。

- `isRegisteredCollectorAlive`(従来カバレッジ 0 件): `connection-errors.spec.ts`
  の `afterEach` 安全網(止まっていれば再起動する判断)が依存する関数だが
  ユニットテストが無かった。未登録 → false、登録済みかつ PID 生存 → true
  (自プロセスの PID を利用)、登録済みでも PID 死亡 → false、受け渡し
  ファイル破損 → false の4ケースを追加。
  - 「死んでいる PID」はマジックナンバー直書き(PID 再利用で偽陽性化)を
    避け、`spawnSync` で使い捨てプロセスを同期起動・即終了させて reap
    済みの PID を得る方式で決定的にした。
- `readRegisteredCollector` の入力堅牢性: 従来は「壊れた JSON」「port 欠落」
  のみ。以下を追加 — pid 欠落、port の型不一致(文字列)、空ファイル(0
  バイト)、JSON がオブジェクトでない(null/数値/文字列/配列の4種を
  `it.each`)、余分なフィールドがあっても pid/port だけ取り出せる(前方
  互換)。
- `stopRegisteredCollector`: 従来は「初回ポーリングで死亡 → SIGKILL 不送信」
  のみ。「後続のポーリングで死亡した場合もループが継続し SIGKILL を
  送らない」ケース(初回で死ななくてもポーリングが回ることの確認)と、
  受け渡しファイル破損時(登録なし扱い)に kill を呼ばないケースを追加。

#### 実装への手当ては無し

新規のテスト追加のみで、実装ロジック(`collector-registry.ts` 等)と
既存の Playwright spec は変更していない。テスト強化の過程で新規の
バグは検出しなかった(既知の #235〜#238 は前セッションで起票済み)。

#### 検証

- `pnpm build` / `pnpm lint` / `pnpm test`(全パッケージのユニットテスト。
  e2e の collector-registry ユニットは 26/26 green)がいずれも通ることを
  確認した。
- `pnpm test:e2e`(プロトコル層、13/13 green)を実行した。
- `pnpm test:e2e:ui`(29テスト)を3回連続で実行し、いずれも 29/29 green
  になることを確認した(UI-MULTI の `afterAll` 後片付けの安定性、
  connection-errors による collector 差し替え後の後続 spec への副作用が
  無いことを含む)。#238 のカスケード失敗は今回の3回では再現しなかった。
