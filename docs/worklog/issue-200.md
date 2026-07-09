### 2026-07-09 Issue #200 操作シナリオ(UI-CMD)のPlaywright実装と移行済みWSテストの整理(設計メモ)

- 担当: collector
- ブランチ: issue-200-ui-cmd-scenarios

#### 設計メモ(着手前)

`packages/e2e/SCENARIOS.md`「操作: ノード/ワークベンチの追加・削除(UI-CMD)」節の
UI-CMD-01〜07(7件)を実装し、対応する移行元WSテスト(`commands.test.ts` /
`error-paths.test.ts`)を同じコミットの中で削除する(実装→削除を別コミットに
分けない。ARCHITECTURE.md §8.1「棚卸し」の方針どおり)。

**ファイル分割方針**(1ファイル1責務。#199 の分割方針を踏襲):

- `src/ui/commands-node.spec.ts`: UI-CMD-01〜04(ノードの追加・削除)
- `src/ui/commands-workbench.spec.ts`: UI-CMD-05〜07(ワークベンチの追加・削除)

**テストの連鎖と `describe.serial`**:

UI-CMD-01→02→03は「UI-CMD-01で追加したノードをUI-CMD-02で検証し、
UI-CMD-03で削除する」という前提の連鎖(SCENARIOS.md に明記)。UI-CMD-05→06→07
も同様(UI-CMD-07はUI-CMD-05/06で追加した分をまとめて削除する)。
`playwright.config.ts` は既に `fullyParallel: false` / `workers: 1` だが、
明示的に意図を示すため `test.describe.serial(...)` でグルーピングし、
モジュールスコープの変数(追加したノード/ワークベンチのentity id)を
テスト間で引き継ぐ。UI-CMD-04(compose起動ノードは削除ボタンが無い)は
連鎖と無関係なので同じファイル内の独立した `test()` にする。

`describe.serial` 内で追加したノード/ワークベンチが途中失敗で残った場合の
後始末として、`test.afterAll` で「まだ残っていれば削除ボタンを押す」保険を
入れる(既存 `commands.test.ts` の `afterAll` と同じ考え方)。

**新規追加ノード/ワークベンチのentity id特定方法**:

- ノード: `.infra-card--node` の `data-testid` 集合をコマンド送信前後で
  差分を取り、新規2件(reth+beacon)を得る。クライアント種別は
  `.infra-card__subtitle` のテキスト(`reth` / `lighthouse`。生の
  `clientType` がそのまま表示されるのは#199で確認済み)で判別する
  (UI-A-01と同じ理由でカード総数を数えるときは種別修飾クラスを使う。
  #199 worklog の申し送り参照)
- ワークベンチ: ラベルからentity id(`${project}/${label}`)を直接組み立て
  られる(collectorのstableId命名規則。`support/serviceIds.ts` の
  `serviceEntityId` をラベルにもそのまま使う)ため差分は不要。2回目追加分は
  `${label}-2`(collector側 `uniqueWorkbenchService` の一意化規則。
  既存WSテスト `error-paths.test.ts` で確認済みの実挙動)
- ゴーストカードは `commandId` を含む `ghost-card-<commandId>` だが、
  commandId はクライアント側の生成カウンタ(`cmd-1`, `cmd-2`...)の実装
  詳細に依存させたくないため、`[data-testid^="ghost-card-"]` の前方一致
  ロケータで特定する(1テスト中に同時に1件しか出さない前提)
- ワークベンチの所有エッジ(C層)は `own-<workbenchId>-<address>` の
  `data-id` 前方一致(`[data-id^="own-<workbenchId>-"]`)で特定し、属性値
  からアドレス部分を取り出して `wallet-card-<address>` を特定する

**タイムアウトの根拠**:

- ノード追加後のカード出現待ち: 既存 `commands.test.ts` が
  `timeoutMs: 30_000` で新規reth出現を待って安定して通っている実績値
  (A層ポーリング`POLL_INTERVAL_MS=3000`の10倍)をそのまま踏襲する
  (`ADD_NODE_CARD_TIMEOUT_MS = 30_000`)
- ワークベンチ追加後のカード/ウォレット/所有エッジ出現待ち: 既存
  `commands.test.ts` の `addWorkbench` 待ち(`timeoutMs: 30_000`)を踏襲する
  (`ADD_WORKBENCH_CARD_TIMEOUT_MS = 30_000`)。ウォレットは
  `WALLET_POLL_INTERVAL_MS=3000` の残高/nonce取得後にしか
  entityAdded にならない(`computeWalletDiff`)ため、カード出現よりは
  1〜2周期分遅れうるが、同じ30秒枠内で十分観測できる想定(既存WSテストの
  実績と同じポーリング間隔前提)
- **前提条件**: いずれもcollectorの各種ポーリング間隔(3000ms)を根拠にした
  倍率であり、ポーリング間隔を変える場合はこの倍率を保ったまま値を
  見直すこと

**PROTO-CMD-01の自己完結化(commands.test.ts側の再構成)**:

`commands.test.ts` の既存構成は「addNode成功テスト」がreth/beaconの出現と
IP取得を担い、「ブロック追従テスト」がそのIPを使い回す1本の依存チェーンに
なっている。UI-CMD-01への移行に伴い前者を削除するため、後者
(PROTO-CMD-01、SCENARIOS.md 棚卸し表で「残す(addNode送信を自己完結に
再構成)」)を、自分自身でaddNodeを送信してreth出現・IP取得まで行う
自己完結型に書き直す。テスト終了時に自分で追加したノードを
removeNodeで後始末する(afterAllでの二重削除を避けるため、成功時は
テスト内で変数をクリアする。既存の削除テストと同じパターン)。

**削除するWSテスト対応表**(SCENARIOS.md §1 棚卸し表どおり):

| 移行元(ファイル / describe / it) | 移行先 |
| --- | --- |
| `commands.test.ts` `describe("addNode")` の `it("ok:true を返し、新しい reth + beacon ペアが出現する")` | UI-CMD-01 |
| `commands.test.ts` `describe("removeNode")` の `it("addNode で追加したノードは削除でき、数秒後に観測から消える")` | UI-CMD-03 |
| `commands.test.ts` `describe("addWorkbench / removeWorkbench")` 全体(2件) | UI-CMD-05 / UI-CMD-07 |
| `error-paths.test.ts` `describe("addWorkbenchのラベル重複")` 全体(2件) | UI-CMD-06 |

残すもの: `commands.test.ts` の `describe("removeNode")` の
`it("compose 起動の既存ノード（reth1）の削除は ok:false で拒否される")`
(PROTO-CMD-02)、および `describe("addNode")` のブロック追従テスト
(PROTO-CMD-01、上記のとおり自己完結に再構成)。

**SCENARIOS.mdの記述修正(実装時に実挙動を確認して確定させる。UI-ERR-02の
既存の「備考」と同じ運用)**:

UI-CMD-07の確認文言「ワークベンチのカードが消える（付随するウォレット
カードも消える）」は、CONCEPT.md「ノード/ワークベンチを削除したときの
過去データの扱い」の設計(ウォレットの残高・nonce・tx履歴はチェーン側の
状態なので削除後も残し、所有エッジ切断＝所有者削除済み表示にする。
`collector/src/world-state/diff.ts` の `computeWalletDiff` で
実装済み・ユニットテスト済み)と矛盾しており、実際にはウォレットカードは
消えず「所有者削除済み(オーファン)」表示(`wallet-orphan-<address>`)に
なって残ることを実装前のコード確認で確認した。着手時点でこの矛盾に
気付いたため、実装時にSCENARIOS.mdの当該確認文言を実挙動に合わせて修正し、
修正後の文言をそのまま `test.step()` に使う。これはバグではなく設計どおり
の挙動(既存ユニットテストが存在する確立済み仕様)なので、GitHub Issueの
起票はしない(SCENARIOS.md記述の誤りの訂正のみ)。

**コミット分割方針**:

- UI-CMD-01実装 + 対応WSテスト削除(commands.test.ts整理: addNode成功
  テスト削除・PROTO-CMD-01自己完結化を含む) → 1コミット
- UI-CMD-02実装(WSテスト削除無し) → 1コミット
- UI-CMD-03実装 + 対応WSテスト削除(removeNodeの追加ノード削除テスト
  削除) → 1コミット
- UI-CMD-04実装(WSテスト削除無し) → 1コミット
- UI-CMD-05〜07実装(commands-workbench.spec.ts新規) +
  対応WSテスト削除(addWorkbench/removeWorkbench全体、
  error-paths.test.tsのラベル重複全体) → 関心事がまとまっているため
  1コミット(3シナリオは1つの連鎖テストとして実装するため分割しない)
- SCENARIOS.md最終更新(`予`マーク除去・棚卸し表更新) → 実装確認後に
  1コミット

#### 実施結果

設計メモのとおり実装したが、コミット分割は#199の前例(1機能グループ=1コミット。
例: 「test(e2e): UI-A(インフラ表示)5シナリオをPlaywrightで実装」が5シナリオ
まとめて1コミット)を踏襲し、実際には以下の3コミットにまとめた
(UI-CMD-01〜04は`describe.serial`とヘルパー関数を共有する1ファイルの
1機能グループ、UI-CMD-05〜07も同様のため、これ以上の細分化は不自然と判断):

1. `test(e2e): UI-CMDノード追加・削除4シナリオを実装し移行済みWSテストを削除`
   (`commands-node.spec.ts`新規 + `commands.test.ts`のnode関連整理)
2. `test(e2e): UI-CMDワークベンチ追加・削除3シナリオを実装し移行済みWSテストを削除`
   (`commands-workbench.spec.ts`新規 + `commands.test.ts`のworkbench関連
   削除 + `error-paths.test.ts`のラベル重複テスト削除)
3. `docs(e2e): SCENARIOS.mdのUI-CMD該当7見出しを実装済みに更新`

いずれも「実装→WSテスト削除」を同じコミットに含める(実装とWSテスト削除を
別コミットに分けない)という必須要件は満たしている。

**実装時に見つかった設計メモとの差分**:

- UI-CMD-01の実装で、ベースライン(追加前のノードカード集合)を数える前に
  compose起動の6ノードカードが出揃うのを待つ必要があった。当初の実装では
  `page.goto("/")`直後に即座に数えてしまい、実機実行で「ベースラインが0件の
  まま数えてしまい、addNode後の差分判定(期待2件)が実際には8件検出されて
  失敗する」ことを確認した(修正前に実際に失敗することを確認済み)。
  `.infra-card--node`が6件になるまで`expect().toHaveCount()`で待ってから
  ベースラインを取得するよう修正し、修正後は green になることを確認した
  (#199のUI-A/B層と同じ「初回スナップショット反映待ち」の考慮漏れ)。
- UI-CMD-07の確認文言修正は設計メモどおり実施した。実装したアサーションは
  ワークベンチカードの消滅に加え、対応するウォレットカードが
  `wallet-orphan-<address>`(所有者削除済みバッジ)付きで残ることを確認する
  内容にした。

**作業中に見つけた別件の指摘(その場では直さずIssue化)**:

SCENARIOS.md §1棚卸し表の運用ルール(「移行」とした行は対応UIシナリオが
green化したコミットでWS版を削除する)を確認していて、Issue #199で
実装・green化されたUI-A-01/UI-B-01に対応する`a-b-layer.test.ts`の2テスト
(「A層スナップショット」「beacon間のPeerEdge」)が、#199のコミットでは
削除されずに残っていることに気付いた(`git log`で当該ファイルが作成後
未変更であることを確認済み)。本Issue(#200)のスコープ外(commands.test.ts /
error-paths.test.tsのみが対象)のため、その場では直さず
[Issue #228](https://github.com/morichikawa/chainviz/issues/228)として
起票した。

**動作確認**:

- `pnpm --filter @chainviz/e2e build`(`tsc --noEmit`)・リポジトリ全体の
  `pnpm build` / `pnpm lint` / `pnpm test`(shared 58 / collector 1084 /
  frontend 1368 / e2e unit 50、いずれも既存どおり green)が通ることを確認した
- `pnpm test:e2e:ui`(Playwright)を実機で実行し、実装した7シナリオを含む
  UI層16件すべてがgreenになることを確認した(既存の稼働中chainviz-ethereum
  スタックを再利用。約1分)
- `pnpm test:e2e`(vitestプロトコル層)を実行し、整理後の18件すべてが
  greenであることを確認した(commands.test.tsが6件→2件、error-paths.test.ts
  が6件→4件に削減。ブロック追従テストは実測430秒で完走)
- 実行環境にはPlaywright chromiumの実行に必要な共有ライブラリ
  (`libnspr4.so`等)が未導入で、`playwright install-deps`はsudoパスワードが
  必要なため使えなかった。別セッションがscratchpadに展開済みだった
  nss/nsprの.deb展開物を`LD_LIBRARY_PATH`に加えて実行した(#199 worklogと
  同じ補足)

**次の担当への申し送り**:

- UI-CMDのカード出現待ちの前に、必ず「待ち始める前のベースラインとなる
  カード集合」が実際に反映済みであることを確認してから差分を取ること
  (`page.goto()`直後は反映前の可能性がある)
- `describe.serial`でテスト間の状態を引き継ぐ場合は、`test.afterAll`で
  「途中失敗時に残った分の後始末」を必ず入れること(commands.test.tsの
  既存afterAllと同じ考え方)

### 2026-07-09 テスト強化記録(tester)

- 担当: tester
- ブランチ: issue-200-ui-cmd-scenarios(実装担当の続き)

#### 実施したこと

実装担当が書いた UI-CMD 7シナリオと、移行に伴い削除された WS テストの
カバレッジを確認し、境界値・異常系・「1回だけ押す」前提の観点で以下を
追加・強化した。実装ロジックは変更していない。

**1. ワークベンチ名一意化の境界値・異常系(collector ユニット)**

`packages/collector/src/adapters/ethereum/node-lifecycle.test.ts` に3件追加。
UI-CMD-06 のID重複回避の実体である `uniqueWorkbenchService` は、既存テストが
`-2` の1ケース(採番ループが1周で返る)しか通っておらず、以下が未検証だった。

- 同名を3回以上追加した場合に相当する `-3`(base と base-2 の両方が使用済みの
  とき採番ループが正しく次の番号へ進む)
- 空ラベル → `"workbench"` フォールバック(フロントの `resolveWorkbenchLabel`
  で既定値化されるが、WebSocket を直接叩く経路では素の空文字列が届きうる
  ための collector 側の防御)
- 前後空白の除去と、空白のみ → `"workbench"` フォールバックの一意化

いずれも実装を意図的に壊すと失敗することを確認済み(`-3` 用に採番ループを
`return base-2` 固定に、フォールバック用に `label.trim()...` を素の `label`
に置き換えて、対応テストが赤になることを確認してから元に戻した)。

**2. ゴーストカードの枚数固定(e2e UI)**

`commands-node.spec.ts`(UI-CMD-01)・`commands-workbench.spec.ts`(UI-CMD-05)の
ゴースト検証を、`first()` の可視確認のみから「ちょうどN枚」の件数固定に
強化した。両シナリオは「ボタンを1回だけ押す」前提(連打防止 Issue #220 は
未実装)だが、1回の操作で生成されるゴースト枚数を固定していなかったため、
コマンドの二重発行が混入しても検知できなかった。

- UI-CMD-01: addNode は reth(EL)+beacon(CL) の2枚を生む → `toHaveCount(2)`
- UI-CMD-05: addWorkbench は1枚を生む → `toHaveCount(1)`

ゴーストは click 時に同期生成され実エンティティ到着まで数秒残るため、
枚数固定のアサーションは安定して観測できる(flaky にならない)。

#### カバレッジ確認の結論

削除された WS テスト(`commands.test.ts` の addNode成功/addWorkbench/
removeWorkbench、`error-paths.test.ts` のラベル重複)は、移行先の
UI-CMD-01/03/05/06/07 が同等以上に検証しており、欠落は無いことを確認した
(SCENARIOS.md §1 棚卸し表と一致)。SCENARIOS.md の UI-CMD 7シナリオの
前提・操作・確認は各 `test.step` に過不足なく対応している。UI-CMD-06 の
2回目追加は、1回目のカード可視化を待ってから2回目を送るため `-2` 採番の
タイミング競合は起きず、待機の使い方も flaky になりにくい。

#### 動作確認

- `pnpm build` / `pnpm lint` / `pnpm test`(ユニット。collector 1084→1087・
  frontend 1368・shared 58・e2e unit 50)いずれも green
- `pnpm test:e2e:ui`(Playwright)を実機で実行し UI層16件すべて green
  (強化した UI-CMD-01/05 のゴースト枚数固定を含む)。既存の稼働中
  chainviz-ethereum スタックを再利用
- `pnpm test:e2e`(プロトコル層 vitest)を実行。最初は PROTO-CMD-01
  (ブロック追従)が height 0 のまま stall して失敗したが、これは約3時間
  稼働・ブロック高約6000まで進んだスタック固有の環境要因(追加 reth の履歴
  バックフィルが時間内に完了しない)であり、テスト強化の変更(テストファイル
  のみ・collector ランタイム不変)とは無関係。`docker compose down -v`→`up`
  した若いチェーンに対しては 18/18 green で通ることを確認した。この
  長時間稼働スタックでの stall は [Issue #229](https://github.com/morichikawa/chainviz/issues/229)
  として起票した(その場では修正しない)

#### 次の担当への申し送り

- 手元でスタックを長時間起動しっぱなしにしていると PROTO-CMD-01 が偽陰性で
  落ちうる(#229)。`pnpm test:e2e` を通したいときはスタックを
  `docker compose down -v`→`up` でリセットしてから実行する
- Playwright chromium の実行には共有ライブラリ(libnspr4.so 等)が必要。
  本環境では別セッションが scratchpad に展開済みの nss/nspr を
  `LD_LIBRARY_PATH` に加えて実行した(#199/#200 実装時と同じ補足)

### 2026-07-09 レビュー記録(reviewer)

- 担当: reviewer
- ブランチ: issue-200-ui-cmd-scenarios(mainからの7コミットを静的レビュー)

#### 確認したこと

- **ARCHITECTURE.md §8.4 の記法規約**: `commands-node.spec.ts` /
  `commands-workbench.spec.ts` とも、`test()` タイトルが
  「`<シナリオID>: <タイトル>`」で SCENARIOS.md と1対1に対応し、各箇条書きが
  `test.step()` になっていることを確認した。7シナリオの「前提・操作・確認」は
  各ステップに過不足なく反映されている
- **実装とWS版削除の同一コミット性**: `git show` で確認。7171507(UI-CMD-01〜04
  実装 + commands.test.ts の addNode成功/追加ノードremoveNode削除 +
  PROTO-CMD-01自己完結化)、6c000fe(UI-CMD-05〜07実装 +
  addWorkbench/removeWorkbench削除 + error-paths.test.ts のラベル重複削除)。
  いずれも実装と削除が同一コミットで、重複・空白期間は無い
- **削除対象と棚卸し表の対応**: 削除された5テスト(addNode成功 /
  追加ノードremoveNode / addWorkbench / removeWorkbench / ラベル重複2件)は
  SCENARIOS.md §1 の「移行済み(#200で削除)」4行と正確に一致。誤削除は無い
- **PROTO-CMD-01 の自己完結化**: 削除された前段テストへの依存(共有変数
  addedRethIp 等)が無くなり、自分で addNode を送信し、baseline 確立待ち→
  追加reth特定→動的タイムアウトで追従判定→成功時は自分で removeNode、
  途中失敗時は afterAll の保険で後始末、という正しい構成になっている
- **PROTO-CMD-02 の残置**: commands.test.ts に「compose 起動の既存ノード
  （reth1）の削除は ok:false で拒否される」が残っていることを確認
- **フロント計装の実在**: 参照する data-testid(canvas-toolbar-add-node /
  canvas-toolbar-workbench-label / infra-card-remove- / ghost-card- /
  wallet-orphan- 等)とクラス(.infra-card--node / .infra-card--new /
  .infra-card__subtitle)がすべて frontend 実装に存在することを確認した。
  ゴーストカードは `infra-card--node` を持たないため UI-CMD-01 のカード数
  勘定に混入しない
- **tester 追加テストの妥当性**: `uniqueWorkbenchService`(node-lifecycle.ts
  686-696行)の実装と突き合わせ、-3への採番進行・空ラベルフォールバック・
  trim/空白のみ+既存衝突の3件が実装の各分岐を実際に検証していることを確認。
  ミューテーション確認(意図的に壊して赤になる確認)済みの記録もある。
  ゴースト枚数固定(2枚/1枚)も二重発行検知として妥当
- **エラー握りつぶし**: 新規コードに握りつぶしは無い。commands.test.ts
  afterAll の `.catch(() => {})` は後始末の保険であることがコメントで明示
  されている(既存パターン踏襲)
- **固定値の前提明記**: タイムアウト(30秒 = ポーリング間隔3000msの10倍、
  外側600秒は動的タイムアウトの安全網)の根拠がコード内コメントと本 worklog
  の両方に記載されている
- **ビルド・テスト**: `pnpm build` / `pnpm lint` / `pnpm test`(shared 58 /
  e2e unit 50 / collector 1087 / frontend 1368)すべて green を確認した
- **docs 整合**: PLAN.md のチェックボックス(#200リンク付き)・WORKLOG.md
  索引・SCENARIOS.md の `予` マーク除去と棚卸し表更新・UI-CMD-07 確認文言の
  訂正(CONCEPT.md の設計と整合)を確認した
- **コミット粒度**: 7コミットとも関心事ごとに分割されている。設計メモの
  当初計画(6コミット)からの変更(#199前例踏襲で機能グループ単位)も worklog に
  理由付きで記録されており妥当

#### 判定

**合格**。差し戻し事項なし。あわせて以下の軽微な指摘(非ブロッキング。
いずれも「誤って合格してしまう」方向の欠陥ではなく、将来の flake 要因)を
残す。今回のマージを止めるものではないが、次に該当ファイルへ手を入れる際に
対応するとよい。

1. **UI-CMD-02 のアサーションがシナリオの選択肢を反映していない**
   (`commands-node.spec.ts` 156-160行): step 文言は SCENARIOS.md どおり
   「ピアエッジ（または接続確立中エッジ）」だが、ロケータは
   `[data-id^="peer-"]` のみで接続確立中エッジ(`connecting-<nodeId>`)を
   受け付けない。なお接続確立中エッジはピア未確立のノードに無条件で出るため、
   これを合格条件に加えると「P2Pが壊れていても通る無意味なテスト」になる。
   実装側(実ピアエッジ必須)が正しく、SCENARIOS.md の確認文言から
   「（または接続確立中エッジ）」を外して文言とアサーションを一致させるのが
   適切な直し方
2. **`ownershipEdgeWalletAddress` の前方一致が同名一意化IDと衝突しうる**
   (`commands-workbench.spec.ts` 31-43行): UI-CMD-07 で workbenchId が
   `.../e2e-ui-carol` のとき、prefix `own-.../e2e-ui-carol-` は
   `e2e-ui-carol-2` の所有エッジ(`own-.../e2e-ui-carol-2-0x...`)にも一致する。
   現状は DOM 順(エンティティ挿入順)で先頭が正しいエッジになるため green
   だが、順序という暗黙の前提に依存している。アドレスは必ず `0x` で始まる
   ため、prefix を `own-<workbenchId>-0x` にすれば曖昧さなく特定できる。
   誤マッチ時の失敗方向は偽陰性(flake)であり偽陽性ではない

Issue #228(a-b-layer.test.ts の削除漏れ)・#229(PROTO-CMD-01 の長時間稼働
スタックでの stall)は本レビューの対象外だが、起票済みであることを確認した。

### 再レビュー: 非ブロッキング指摘2件への対応確認 (chainviz-reviewer, 2026-07-09)

統括が直接対応したコミット b79e5a4 / 91cbb1c(`git diff db48a59..HEAD`)を
再確認した。

#### 確認内容

1. **UI-CMD-02 の文言一致**: `packages/e2e/SCENARIOS.md` の確認項目と
   `commands-node.spec.ts` の `test.step` 文言の両方から
   「（または接続確立中エッジ）」が削除され、ロケータ
   (`[data-id^="peer-"]`、peer エッジのみ判定)と一致した。指摘どおりの
   直し方であり問題なし
2. **所有エッジ prefix の曖昧さ解消**: `ownershipEdgeWalletAddress` の
   prefix が `own-<workbenchId>-0x` に変更され、`e2e-ui-carol` と
   `e2e-ui-carol-2` の衝突が解消された(`own-...-carol-0x` は
   `own-...-carol-2-0x...` に前方一致しない)。`slice(prefix.length - 2)` は
   prefix 末尾の `0x` の先頭位置から切り出すため、戻り値は `0x<hex>` 形式の
   完全なアドレスになる。オフ・バイ・ワンなし(検算済み)。prefix 設計の
   理由と `-2` の意図がコメントで説明されている点も良い

#### 実行結果

- `pnpm --filter @chainviz/e2e exec playwright test src/ui/commands-node.spec.ts src/ui/commands-workbench.spec.ts`
  (LD_LIBRARY_PATH で chromium 用ライブラリを補完、稼働中の
  chainviz-ethereum スタックを再利用): **7 passed (56.0s)**
- 変更した spec 2ファイルの eslint: エラーなし
- コミット粒度: 2件の指摘がそれぞれ独立した1コミット(docs文言 / ロケータ
  修正)に分かれており規約どおり

#### 判定

**合格**。差し戻し事項なし。push・マージは統括に委ねる。
