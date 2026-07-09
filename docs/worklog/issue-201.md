### 2026-07-09 Issue #201 C層シナリオ(UI-C)のPlaywright実装(設計メモ)

- 担当: collector
- ブランチ: issue-201-ui-c-scenarios

#### 設計メモ(着手前)

`packages/e2e/SCENARIOS.md`「C層: トランザクション・ウォレット・コントラクト
(UI-C)」節の UI-C-01〜07(7件)を実装する。`docs/ARCHITECTURE.md` §8.4 の
実装規約(`test()` タイトルは `<シナリオID>: <タイトル>`、各箇条書きは
`test.step()`)に従う。

**ファイル分割方針**(#199/#200 の分割方針を踏襲。1ファイル1責務):

- `src/ui/wallet-balance.spec.ts`: UI-C-01(残高/nonce表示)・UI-C-02(送金)・
  UI-C-07(操作エッジ)。3件とも「compose起動の静的ワークベンチ
  (`chainviz-ethereum/workbench`。プリセットウォレット持ち)から、追加
  ワークベンチのウォレットへ送金する」という一連の流れを共有するため同一
  ファイルに置く(UI-C-02の送金操作がUI-C-07の操作エッジ観測を兼ねる)。
- `src/ui/contract-lifecycle.spec.ts`: UI-C-03(デプロイ)・UI-C-04(呼び出し)・
  UI-C-06(カタログ外コントラクト)。UI-C-03→04は「UI-C-03でデプロイした
  Counterコントラクトのアドレスをモジュールスコープ変数で引き継ぎ、
  UI-C-04で呼び出す」連鎖。UI-C-06は独立(前提のセットアップだけが必要)。
- `src/ui/token-balance.spec.ts`: UI-C-05(トークン残高)。ChainvizToken
  (ERC20)のデプロイ・transferを1テスト内で完結させる(前提のセットアップ
  自体をtest.step内で行う。他ファイルへの依存を作らない)。
- `src/ui/support/operations.ts`: 上記3ファイルが共通で使う、定型操作
  パネルの開閉・送信ヘルパーとワークベンチ追加ヘルパー
  (`openOperationPanel`/`submitTransfer`/`submitDeploy`/`submitCall`/
  `addWorkbenchAndGetWallet`/`ownershipEdgeWalletAddress`)。3ファイルが
  同じ操作パネル操作を繰り返すため、`commands-node.spec.ts`/
  `commands-workbench.spec.ts`が個別に持つ小さなロケータヘルパー
  (`anyGhostCard`等の重複)とは違い、共有モジュールに切り出す
  (重複コードによる修正漏れを避ける狙い)。

**UI-C-06のセットアップ(docker exec)方針**:

Issueの特記事項どおり、ワークベンチコンテナ内で `forge create` を直接
`docker exec`(実装は `docker compose exec -T workbench sh -c '...'`)する。
ここで重要なのは「別のコントラクトを用意する必要は無い」という点:
`packages/collector/src/adapters/ethereum/contracts.ts` の設計
(`recordDeployment`のコメント参照)は「手動デプロイ(= `runWorkbenchOperation`
の`deployContract`経由でない、`registerContractDeployment`が呼ばれない
デプロイ)は、デプロイ済みバイトコードとの照合を一切行わず常に『未知の
コントラクト』として扱う」ため、既存のカタログ内コントラクト(`Counter`)を
そのまま手動 `forge create` しても「未知のコントラクト」として観測される。
そのため新規Solidityファイルを追加せず、既存の `profiles/ethereum/contracts`
の `Counter` を使う。mnemonicは `docker-compose.yml` の workbench サービスが
`env_file` で読み込み済みの `$EL_AND_CL_MNEMONIC` をコンテナ内シェル展開で
参照し、e2e側でmnemonic文字列を二重管理しない
(`helpers/docker.ts` に `deployUncatalogedContractInWorkbench()` を追加)。
この関数はdocker composeへの薄い委譲(分岐無し)で、既存の`compose()`配下の
他関数(`countProjectContainers`/`tearDownChain`等)と同様に専用のユニット
テストは書かない(実docker必須でユニットテスト化できない既存方針を踏襲)。

**ロケータ・待ち時間の方針**:

- 送金先/呼び出し対象は「別のワークベンチを追加してそのプリセット
  ウォレットを使う」(`WalletEntity`はワークベンチ所有のウォレットのみ
  追跡される。`wallet-tracker.ts`参照)。EL_PREMINE_COUNT=8
  (`values.env`)により mnemonic index 0〜7 は genesis でプリファンド済み
  なので、新規追加ワークベンチ(自動採番される wallet index は 1 から。
  `WALLET_INDEX_START=1`)も残高を持ち、送金先としてすぐ使える。
- 操作パネルの各フォームの送信ボタンには`data-testid`が無い
  (`docs/ARCHITECTURE.md` §8.5 の追加計装対象にも含まれていない)。
  文言(i18n)依存のロケータは避ける方針(§8.5)のため、開いているパネル内で
  表示中のフォーム1つに絞った `form button[type="submit"]` という構造的な
  セレクタで特定する(テキスト非依存)。
- ウォレットカードの残高/nonceは`.infra-card__subtitle`のテキスト
  (`"<balance> ETH · <nonce label> <nonce>"`)を正規表現で読む
  (`WalletCard.tsx`参照。balance/nonceそれぞれ専用のtestidは無いため。
  数値部分は言語に依存しない)。トークン残高チップも同様に
  `wallet-token-chip-*`のテキスト(`"<formatted> <symbol>"`)を読む。
- コントラクトデプロイ検知やtx確定はnewHeads購読駆動
  (`index.ts`の`handleBlockInclusion`)でブロック単位(スロット2秒)。
  `cast`/`forge`はreceipt確定を待って終了するため、1回の操作(送金/
  デプロイ/呼び出し)がUIに反映されるまでの待ち上限を
  `OPERATION_EFFECT_TIMEOUT_MS = 30_000`(既存の
  `ADD_WORKBENCH_CARD_TIMEOUT_MS`/`ADD_NODE_CARD_TIMEOUT_MS`と同じ実績値)
  とする。前提: `values.env`の`SLOT_DURATION_IN_SECONDS=2`。実行環境の
  負荷変動を見込んで安全側に倍数を確保している(実測は本Issueの実行時に
  追記する)。
- UI-C-07の操作パルスエッジ(`op-<workbenchId>=><nodeId>`、
  `OPERATION_PULSE_DURATION_MS=900ms`で消える揮発性エッジ)は、
  ロギングプロキシが中継する**全RPC呼び出し**(読み取り含む。
  `operation-observer.ts`参照)ごとに1パルスを生む。`cast send`は
  nonce取得・gas見積り・送信・receipt待ちポーリングなど複数回のRPC
  呼び出しを行うため、操作の実行(数秒間)を通じてパルスが繰り返し
  発生し続ける。したがって「操作を送信 → 直後にパルスエッジの出現を
  `OPERATION_EFFECT_TIMEOUT_MS`以内で確認する」という素朴な逐次実装
  (操作の送信自体を待ってからパルス出現を待つ)で十分観測できると判断した
  (送信と同時に監視を開始する並行実装は複雑さに見合わないと判断)。

以上の方針で実装し、実際に `pnpm test:e2e:ui` を実行して7シナリオ全てが
実際にgreenになることを確認してから完了報告する。

#### 実装後の記録(2026-07-09)

設計メモどおり4ファイル(`wallet-balance.spec.ts` / `contract-lifecycle.spec.ts`
/ `token-balance.spec.ts` / `support/operations.ts`)を実装した。実際に
`pnpm test:e2e:ui` を通す過程で、想定していなかった実装済み機能側の不具合
3件を発見した。いずれも「実 collector を相手にした E2E がこれまで一度も
無かったため、モックデータ・ユニットテストだけでは検出できなかった」種類の
不具合で、UI-C-01〜07 のいずれかを完了させるために必須の修正だったため、
CLAUDE.md「見つけたバグは直さずIssue化するだけに留める」の運用ルールとは
別に、担当パッケージ内(collector)の2件はその場で修正し、担当外
(frontend)の1件は影響範囲を確認したうえで最小限の修正のみ行った
(詳細は各項目に記載)。

**発見・修正した不具合**:

1. **`WalletEntity.recentTxHashes` が実 collector から一度も更新されない
   (collector)**: ウォレットカードの tx チップ表示(ARCHITECTURE.md §6.6)は
   `WalletEntity.recentTxHashes` に依存するが、このフィールドは
   `diff.ts` で `[]` に初期化されるのみで、tx の from/to をウォレットへ
   紐付ける配線がどこにも存在しなかった(Issue #81/#82/#84/#166 はいずれも
   frontend 側の実装で、`mockData.ts` の手動サンプルデータでのみ動作確認
   されていた)。`WorldStateStore.linkTransactionToWallets()` を新設し、
   `index.ts` の `subscribeTransactions` コールバックから
   `store.applyTransaction(tx)` と併せて呼ぶよう配線した。アドレスの
   大文字小文字表記の違い(後述)を吸収するため小文字化して比較する。
   専用テスト: `store-transaction-wallet-link.test.ts`(新規、9件。
   store.test.ts から分離)。
2. **`forge create` の `--constructor-args` が空配列のとき壊れる
   (collector)**: `DeployForm.tsx` はコンストラクタ引数を持たない
   コントラクト(例: Counter)でも `constructorArgs: []`(省略ではなく
   空配列)を送るが、`buildOperationCommand` は
   `operation.constructorArgs !== undefined` だけで判定していたため、
   フラグ`--constructor-args`だけ付いて値を1つも渡さない不正なコマンドを
   組み立ててしまい、`forge create` が
   `a value is required for '--constructor-args <ARGS>...' but none was
   supplied` で失敗していた(UI-C-03 相当の操作が実UIからは常に失敗する
   不具合。既存の `workbench-operations.test.ts` は `undefined` のケースしか
   検証しておらず、フロントが実際に送る「空配列」のケースが未検証だった)。
   `operation.constructorArgs.length > 0` も条件に加えて修正し、この
   ケースのテストを追加した。
3. **デプロイエッジ・確定パルスがアドレス表記の食い違いで描画されない
   (frontend、影響範囲を確認のうえ最小限修正)**: `ContractEntity.
   deployerAddress` / `TransactionEntity.from` は receipt 由来の生の表記
   (Ethereumアダプタでは全小文字)である一方、`WalletEntity.address` は
   mnemonic から viem で導出した EIP-55 チェックサム表記になりうる
   (`wallet-derivation.ts` の docstring 参照)。`entities/deployEdge.ts` の
   `deployEdgesToFlowEdges` は単純な文字列一致(`Set.has`)で端点存在判定を
   していたため、この表記の違いにより**実際にデプロイされたコントラクトでも
   デプロイエッジが一度も描画されない**(UI-C-03 の「デプロイエッジが
   描画される」を満たせない)不具合になっていた。大文字小文字を無視して
   照合したうえで、キャンバス上に実在するウォレットの表記(React Flow の
   ノード id と一致する表記)を edge の端点として使うよう修正した(単に
   大文字小文字を無視するだけでは、edge の source が実在しない表記の
   ままになり React Flow がノードを解決できず描画されないため)。
   `deployEdge.test.ts` にケースを追加。
   - 同根の不具合が `entities/contractCallPulseEdge.ts` /
     `entities/useContractSettlementEffects.ts`(確定時のウォレット→
     コントラクトパルス。ARCHITECTURE.md §6.6)にも残っているが、今回の
     E2E シナリオでは直接検証しないため修正は見送り、
     [#232](https://github.com/morichikawa/chainviz/issues/232) として
     frontend 向けに起票した。

**その他、実装中に見つけた軽微な不具合(修正済み、e2e パッケージ内)**:

- `deployedContractAddresses`(support/operations.ts)が上記3と同じ理由で
  常に空集合を返していた。デプロイエッジの `data-id` を固定長
  (`deploy-` + 42文字のデプロイヤーアドレス + `-` + コントラクトアドレス)
  で分割し、デプロイヤー部分だけ小文字化して比較するよう実装した(不具合3の
  frontend 修正後は、実際には表記が一致するようになったため厳密には
  不要になったが、将来同種の不具合が再発した場合の防御として残した)。
- `test.afterAll` で追加したワークベンチを削除する後始末処理が、
  (a) `page.goto()` 直後にスナップショット反映前の状態で `count()` を
  即座に判定してしまい削除がスキップされる、(b) 削除ボタンをクリックした
  だけで完了を待たずに `page.close()` してしまい、`globalTeardown` で
  collector が停止すると削除(docker停止)が完遂しないままコンテナが残る、
  という2つの競合状態を実機で確認した。`wallet-balance.spec.ts` /
  `token-balance.spec.ts` では `waitFor` での出現待ち + 削除完了
  (`toHaveCount(0)`)待ちに修正した。`commands-node.spec.ts` /
  `commands-workbench.spec.ts`(Issue #200)の同型処理は本Issueの範囲外
  のため未修正のまま
  [#233](https://github.com/morichikawa/chainviz/issues/233) を起票した。

**操作パネルのビューポート越境**: 操作パネル(`OperationPanel.tsx`)は
ワークベンチカードの右側に固定位置(`left: calc(100% + 12px)`)で開く。
キャンバス上の位置はグリッド配置(エンティティ数に応じて右・下に伸びる)
のため、既定のビューポート(Playwright の Desktop Chrome プリセット、
1280x720)では、追加ワークベンチ/コントラクトが数枚存在するだけで
送信ボタンがビューポート外にはみ出しクリックできなくなることを実機で
確認した(パネル自体に表示領域内へ収める機構が無い。#232 と同じ frontend
側の改善余地だが、今回は別Issueにはせず本項に留める。優先度が低いため)。
テスト側の回避策として、操作パネルを実際に開いて送信する3ファイルだけ
`OPERATION_PANEL_VIEWPORT`(1920x1200)を使うようにした
(`support/operations.ts`)。

**実測タイムアウト**: `OPERATION_EFFECT_TIMEOUT_MS = 30_000` は実行時に
過剰だった(実測ではほぼすべての操作が2〜15秒で反映された。デプロイ+呼び出し
2回分を含む UI-C-05 でも全体で15〜17秒程度)。既存の `ADD_NODE_CARD_TIMEOUT_MS`
等と同じ実績値に揃えるため、実測より大きい安全マージンを持たせたまま
30秒を採用している(設計メモに記載した前提どおり)。

**最終確認**: `pnpm --filter @chainviz/e2e test:e2e:ui` で UI 層 23 件
(既存16件 + 新規7件)全て green、`pnpm --filter @chainviz/e2e test:e2e` で
プロトコル層 16 件全て green(collector/store の変更による回帰なし)、
`pnpm build && pnpm lint && pnpm test`(collector 1097件・frontend 1370件
含む)全て green を確認した。`docker ps` で `chainviz-ethereum` プロジェクトの
コンテナが compose 起動の7つのみ(動的追加分の残留なし)であることも
確認済み。

**起票した Issue**:
- [#232](https://github.com/morichikawa/chainviz/issues/232)
  確定時のコントラクトへのパルス/フラッシュがアドレス表記の食い違いで
  発火しない(frontend、未修正)
- [#233](https://github.com/morichikawa/chainviz/issues/233)
  UI-CMD系PlaywrightテストのafterAllクリーンアップが競合状態で無効化
  されうる(collector/e2e、`commands-node.spec.ts`/`commands-workbench.spec.ts`
  側は未修正)

**変更ファイル一覧**:
- 新規: `packages/e2e/src/ui/wallet-balance.spec.ts` /
  `contract-lifecycle.spec.ts` / `token-balance.spec.ts` /
  `support/operations.ts`
- 新規: `packages/collector/src/world-state/store-transaction-wallet-link.test.ts`
- 変更: `packages/collector/src/world-state/store.ts`(`linkTransactionToWallets`
  追加)・`packages/collector/src/index.ts`(配線)・
  `packages/collector/src/adapters/ethereum/workbench-operations.ts`
  (`--constructor-args`の空配列対応)・同 `.test.ts`
- 変更: `packages/e2e/src/helpers/docker.ts`
  (`deployUncatalogedContractInWorkbench`追加)
- 変更: `packages/frontend/src/entities/deployEdge.ts`・`deployEdge.test.ts`
  (アドレス表記の大文字小文字対応)

コミットは関心事ごとに分割する想定(例: collectorのrecentTxHashes配線・
collectorの--constructor-args修正・frontendのdeployEdge修正・e2eの
新規シナリオ本体、をそれぞれ別コミットにする)。

#### テスト強化記録(2026-07-09)

Issue #201 で修正した3件の実プロダクトバグについて、既存のユニット
テストが異常系・境界値まで十分カバーできているかを確認し、抜けていた
観点を追加した。実装ロジックには一切手を入れていない(テストの追加のみ)。

**`linkTransactionToWallets`(`store-transaction-wallet-link.test.ts`、6件追加)**

既存テストは from 単独一致・from/to 両方一致・大文字小文字無視・不一致・
コントラクト生成(to: null)・同一hash重複防止・並び順・上限(20件)到達・
非ウォレット非干渉をカバー済み。以下の境界を追加した。

- 自己送金(from === to が同一アドレス)で hash が1回だけ載る
  (candidateAddresses の Set 重複畳み込みの回帰。二重計上しない)
- 自己送金で from と to の大小表記だけが違う場合も1回だけ載る
- tx.to だけが追跡ウォレットに一致し tx.from は未追跡のケース
  (既存は from 単独一致のみで、to 単独一致が未検証だった)
- from/to に一致する2ウォレットに加えて無関係なウォレットを混ぜても、
  無関係な方には差分が出ない(部分一致で巻き込まない)
- from が空文字(length 0 のガードで候補から除外)でも例外にならず、
  to 側の一致だけを反映する
- from が空文字かつ to が null で候補ゼロなら何もしない

**`deployEdgesToFlowEdges`(`deployEdge.test.ts`、2件追加)**

既存テストは「表記の食い違い(小文字 deployer vs チェックサム present)で
一致する」「一致しない deployer は無視」をカバー済み。以下を追加した。

- deployerAddress と presentWalletIds が互いに異なる混在表記でも一致し、
  端点にはキャンバス上に実在する present 側の表記を採用する
- presentWalletIds に同一アドレスの表記揺れが複数混在した場合(通常は
  起きないが防御的に)、エッジは1本だけ作られ、端点には小文字キー Map の
  後勝ちで最後の表記が採られる(重複エッジを作らないことの回帰)

**`buildOperationCommand` の constructorArgs**

既存テストで undefined・空配列・1件以上・複数件がすべて別テストとして
区別済みであることを確認した(#201 のバグ修正観点は網羅済み)。追加は不要。

**Playwright シナリオの確認結果**

7つの UI-C シナリオが SCENARIOS.md の「前提・操作・確認」の各箇条書きに
過不足なく対応していることを確認した。待機は原則 `expect.poll` /
`toHaveCount` / `waitFor` の web-first リトライで組まれており、固定 sleep に
依存する箇所は無い。1点、`wallet-balance.spec.ts` の UI-C-02「操作パネルに
保留中の表示が出る」ステップは送信直後に `aria-busy="true"` を確認しており、
`toHaveAttribute` の自動リトライ(既定タイムアウト)に依存する。cast send は
数秒かかるため実測では安定して true を捉えられているが、将来 tx 反映が
極端に速くなった場合に aria-busy が true→false へ反転しきってからしか
観測できず flaky になりうる潜在的パターンとして記録に留める(現時点では
実害が無いため Issue 化はしない)。

**確認**: `pnpm build && pnpm lint && pnpm test` 全て green
(collector 1103件・frontend 1372件・shared 58件)。稼働中の
`chainviz-ethereum` スタックを再利用して `playwright test`(UI-C の3ファイル・
7シナリオ)を実行し全て green、実行後に動的追加ワークベンチの残留が
無い(compose 起動の7コンテナのみ)ことも確認した。

#### レビュー記録(2026-07-09、chainviz-reviewer)

ブランチ issue-201-ui-c-scenarios(main から11コミット)を静的レビューした。
判定は**合格**(軽微な指摘1件あり、対応は必須としない)。

**確認した内容**:

- **バグ修正3件の裏付け**: いずれも「修正前は実際に壊れていた」ことを
  コードから確認した。
  1. `recentTxHashes`: 修正前は `diff.ts` の新規ウォレット生成時に `[]` を
     入れる箇所しか書き込みが存在せず、tx を紐付ける経路がどこにも無かった。
     `linkTransactionToWallets` の追加と `index.ts` の配線で解消している。
     併せて、後続の `applyWallets` ポーリングが `computeWalletDiff` の
     `...before` 展開により `recentTxHashes` を上書きしない(維持される)
     ことも確認した。
  2. `--constructor-args`: 修正前は `!== undefined` のみの判定で、
     `DeployForm.tsx` が常に送る空配列 `[]` でフラグだけが付いていた。
     `length > 0` の追加で解消。追加テストは旧実装なら失敗する内容。
  3. `deployEdgesToFlowEdges`: 修正前は `Set.has` の完全一致で、receipt
     由来の小文字 `deployerAddress` と EIP-55 表記の `WalletEntity.address`
     が恒常的に不一致だった。小文字キー Map で照合し present 側表記を
     端点に採る修正は、`App.tsx` の `walletAddressIds` が React Flow の
     ノード id(`walletNodes.map((n) => n.id)`)そのものであることから、
     ノード id 解決の実態と正しく整合している。
- **アドレス照合の設計一貫性**: 小文字化して比較しつつ元の表記を保存する
  方針は `contracts.ts` の `normalizeAddress` の考え方と一貫している。
  store が `WalletEntity.address` 自体を書き換えない判断も、既存キー・
  `computeWalletDiff` の prevMap(完全一致キー)を壊さないために正しい。
- **§8.4 準拠**: 7シナリオとも `test()` タイトルが `<ID>: <タイトル>`、
  各箇条書きが `test.step()` に1対1対応。SCENARIOS.md の `予` マーク削除も
  実装と整合。
- **ロケータ**: `data-testid` を正とし、例外2箇所(ウォレット subtitle の
  正規表現読み・`form button[type="submit"]`)はいずれも文言非依存で、
  §8.5 の趣旨に沿う理由がコメントに明記されている。
- **ChainAdapter 境界**: UI-C-06 の docker exec は e2e ハーネス内の薄い
  委譲のみで、collector/frontend の境界は侵していない。
- **固定値**: `OPERATION_EFFECT_TIMEOUT_MS = 30_000` は成立前提
  (SLOT_DURATION_IN_SECONDS=2)がコードコメントと本 worklog の両方に
  記載されており、運用ルールに適合。
- **コミット粒度**: バグ修正3件(各自のテスト同梱)・e2e 実装3件(ファイル
  単位)・SCENARIOS.md マーク削除・docs・テスト強化2件・記録、と関心事
  ごとに分割されている。
- **ビルド・テスト**: `pnpm build` / `pnpm lint` / `pnpm test` 全て green
  (shared 58・collector 1103・frontend 1372・e2e 50)。
- **テストの質**: 追加テストはいずれも旧実装(修正前ロジック)なら失敗する
  内容で、実装の詳細をなぞるだけの無意味なテストは無い。tester 追加の
  境界(自己送金・to 単独一致・空 from・表記揺れ混在・重複表記の後勝ち)も
  適切。
- **aria-busy の flaky 懸念の扱い**: cast send の実所要(数秒)がある限り
  観測窓は十分で、現時点で Issue 化せず記録に留める判断は妥当。
- **起票 Issue**: #232(frontend、OPEN)・#233(collector、OPEN)の実在と
  ラベルを確認した。

**軽微な指摘(非ブロッキング)**: `wallet-balance.spec.ts` /
`token-balance.spec.ts` の `afterAll` の内側 try/catch は、コメント上は
「ボタンが見つからない(既に削除済み)場合」を想定しているが、実際には
`click()` の失敗や削除完了待ち(`toHaveCount(0)`)のタイムアウトも同じ
catch に握りつぶされ、削除が本当に失敗した場合にログ無しでコンテナが
残留しうる。catch の範囲を `waitFor` だけに絞るか、catch 内で警告ログを
出すのが望ましい。同族の #233(UI-CMD 系の同型処理)の対応時にまとめて
直せば足りるため、本 Issue では対応必須としない。

#### QA検証記録(2026-07-09、chainviz-qa)

ブランチ issue-201-ui-c-scenarios を実機で検証した。判定は**合格**
(完了条件をすべて満たす)。

**1. UI層E2Eフルラン(`pnpm test:e2e:ui`)**

23件すべてグリーン(既存16件 + 今回のUI-C 7件)。UI-C-01〜07が
それぞれ独立したtestとして成功していることを確認した(所要合計 約2.0分)。

**2. プロトコル層E2E(`pnpm test:e2e`)・ユニット(`pnpm test`)**

- プロトコル層は16件中15件グリーン、1件のみ失敗。失敗は
  `commands.test.ts` の addNode(追加rethが既存チェーンにブロック
  追従する)で、稼働2時間超・ブロック高4497の長時間稼働チェーンへ
  新規rethを追加した際、履歴バックフィルが高さ0のまま停止したことに
  よる。この失敗は本Issueの変更範囲外(#201のcollector変更は
  store.ts/index.tsのtx→ウォレット紐付け配線と
  workbench-operationsのconstructor-args対応のみで、ノード追加や
  EL間P2Pバックフィルには一切関与しない)。切り分けのため
  `docker compose down -v && up -d` でチェーンを作り直し、履歴が短い
  状態で `commands.test.ts` のみ再実行したところ addNode を含む2件とも
  グリーンになった。これにより当該失敗は長時間稼働チェーンへの新規
  ノード追加という環境要因(CLAUDE.mdが警告する固定タイムアウト/
  バックフィルの脆さ)であり、#201による回帰でないことを確認した。
- ユニットは全パッケージグリーン(shared 58 / e2e単体 50 /
  collector 1103 / frontend 1372)。collectorのログに現れる
  「failed to decode...」等は異常系テストが意図的に出力するもので、
  全41ファイルpassed。

**3. 修正3件の実機・目視確認(実ブラウザで操作しスクリーンショット取得)**

稼働中のchainviz-ethereumスタックに対し、既存のsupport/operations
ヘルパーを再利用した使い捨てのPlaywrightスクリプトで実操作し、以下を
目視確認した(確認後にスクリプトは削除)。

- バグ1(recentTxHashes反映): 静的ワークベンチから追加ワークベンチの
  ウォレットへ1 ETH送金後、送金元ウォレットカードにtxチップ
  (「tx · 1 pending」)が実際に出現することを確認。
- バグ2(引数無しコントラクトのデプロイ): デプロイタブでCounter
  (コンストラクタ引数無し)をデプロイし、コントラクトカード
  (`contract-card-<address>`、表示名「Counter」)が実際に現れることを
  確認(forge createのフラグエラーが解消)。
- バグ3(デプロイエッジのアドレス表記揺れ): デプロイ元ウォレット →
  Counterのデプロイエッジ(`deploy-<deployer>-<contract>`)がcount=1で
  実際に描画されることを確認。

**4. トークン残高の変化**

ChainvizToken(初期供給1000 CVZ)をデプロイ後、100 CVZをrecipientへ
transferした結果、送金元ウォレットカードのトークンチップが
1000.0000 CVZ → 900.0000 CVZ に減り、受信側ウォレットカードに
100.0000 CVZ のチップが現れることを目視確認した(送信側・受信側とも
残高変化が見える)。

**5. カタログ外コントラクトの表示**

ワークベンチ内で `forge create`(docker exec)によりカタログ外
コントラクトをデプロイした結果、`contract-card-uncataloged-<address>`
の「未知のコントラクト」表記でカードが現れることを確認した。

**環境の後始末**: 検証で追加したワークベンチはすべて削除し、`docker ps`
がcompose起動の7コンテナのみ(動的追加分の残留なし)であることを確認した。

**結論**: Issue #201 の完了条件をすべて満たす。プロトコル層の唯一の失敗は
#201と無関係な環境要因(長時間稼働チェーンへの新規ノード追加時の
バックフィル停止)であり、本Issueの合格判定を妨げない。なお当該
addNodeバックフィルの脆さ自体は既存の別課題(固定タイムアウト依存)で
あり、必要なら別途Issue化を検討する余地がある。
