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
