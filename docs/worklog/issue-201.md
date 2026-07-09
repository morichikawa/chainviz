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
