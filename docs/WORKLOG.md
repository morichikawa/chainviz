# chainviz 作業記録(索引)

各タスクの完了時に、担当したエージェントが記録を残す。`docs/PLAN.md` の
チェックボックスは「どこまで進んだか」を示すだけなので、「何を・なぜ・
どう実施したか」「実装中に判明した注意点」はこちらに残す。commit ログと
あわせて読むことで、後から経緯を追えるようにする。

この記録は平易で正確な日本語で書く(担当エージェントのペルソナの口調は
使わない)。

## ファイル構成

1本の巨大なファイルに追記し続けると肥大化し、エージェントが作業前に
読み込むコスト(トークン消費)が際限なく増えてしまう(2026-07-05 時点で
4500行を超えていたため分割した)。そのため、**Issue(または一体で
実装された複数Issueのまとまり)ごとに `docs/worklog/issue-<番号>.md` と
いうファイルに分けて記録する**。このファイル(`docs/WORKLOG.md`)は
索引のみを持ち、本文は持たない。

- 記録を追記するときは、対応する `docs/worklog/issue-<番号>.md` を開き
  (無ければ新規作成し)、そこに追記する。既存の近い番号のIssueと一体で
  実装した場合は、その既存ファイルにまとめてよい(例: `issue-34-36.md`)
- 特定のIssueに紐付かない記録(`docs/PLAN.md`・`CLAUDE.md` 自体の更新など)
  は `docs/worklog/meta.md` に追記する
- 新しいファイルを追加・既存ファイルに初めて追記した場合は、下記の索引
  テーブルに1行追加する(索引テーブル自体は簡潔に保つ。詳細は各ファイルへ)

## 記入フォーマット(各 `docs/worklog/issue-<番号>.md` 共通)

```
### YYYY-MM-DD Issue #<番号> <タイトル>
- 担当: <collector | frontend | node-env | reviewer | qa | tester>
- ブランチ: issue-<番号>-<スラッグ>
- 内容: 何を実装・変更したか
- 決定事項・注意点: 実装中に判明した仕様の詳細、次の担当が知っておくべきこと
```

## 索引

| Issue | 内容 | 記録 |
| --- | --- | --- |
| #1-#5 | Issue #1・#2・#3 Ethereum プロファイルのノード環境 | [2026-07-04](worklog/issue-1-5.md) |
| #7-#9 | Issue #7・#8・#9 A層(インフラ可視化)の collector 実装 | [2026-07-04](worklog/issue-7-9.md) |
| #10-#16 | Issue #10〜#16 Phase 1 フロントエンド(A層インフラ可視化) | [2026-07-04](worklog/issue-10-16.md) |
| #19-#21 | Issue #19・#20・#21 Phase 2 collector(B層 P2Pグラフのデータ収集) | [2026-07-04](worklog/issue-19-21.md) |
| #22-#24 | Issue #22・#23・#24 B層(P2P ピア接続グラフ)のフロント描画 | [2026-07-04](worklog/issue-22-24.md) |
| #25-#28 | Issue #25 ブロック伝播パルスアニメーションの実装 | [2026-07-04](worklog/issue-25-28.md) |
| #32 | Issue #32 ダークモードのUI視認性改善 | [2026-07-04〜2026-07-05](worklog/issue-32.md) |
| #34-#36 | Issue #34・#35・#36 キャンバスからのノード/ワークベンチ追加・削除(collector側) | [2026-07-04](worklog/issue-34-36.md) |
| #37-#39 | Issue #37・#38・#39 キャンバスからのノード/ワークベンチ追加・削除(frontend) | [2026-07-04](worklog/issue-37-39.md) |
| #41 | Issue #41 lighthouse-bn.sh の set -f が /data 初期化の glob 展開を無効化する不具合 | [2026-07-04](worklog/issue-41.md) |
| #43 | Issue #43 beacon単独再起動によるEL/CL乖離への対応 | [2026-07-04](worklog/issue-43.md) |
| #44 | Issue #44 reth(EL)同士の P2P 同期を有効化 | [2026-07-04](worklog/issue-44.md) |
| #46 | Issue #46 lighthouse-bn.shの/data初期化順序を修正 | [2026-07-04](worklog/issue-46.md) |
| #51-#54 | Issue #51-#54 E2E(結合)テストの導入(packages/e2e) | [2026-07-04](worklog/issue-51-54.md) |
| #56 | Issue #56 genesis サービスの冪等化 | [2026-07-04](worklog/issue-56.md) |
| #58 | Issue #58 E2Eテストに異常系シナリオを追加する | [2026-07-04](worklog/issue-58.md) |
| #59 | Issue #59 E2E に再接続・複数クライアントシナリオを追加 | [2026-07-04](worklog/issue-59.md) |
| #63 | Issue #63 コンテナ削除競合(HTTP 409)によるクラッシュと孤児蓄積の対策 | [2026-07-04](worklog/issue-63.md) |
| #64 | Issue #64 test:e2e 複数worktree同時実行時のcollectorポート奪い合い対策 | [2026-07-04](worklog/issue-64.md) |
| #65 | Issue #65 起動時のmanagedコンテナ回収によるレジストリ再構築 | [2026-07-04](worklog/issue-65.md) |
| #68 | Issue #68 WebSocket接続ごとのerrorリスナー | [2026-07-04](worklog/issue-68.md) |
| #76 | Issue #76 reth WSでtxライフサイクル(pending→included)を追跡する | [2026-07-05](worklog/issue-76.md) |
| #77 | Issue #77 ワークベンチのウォレット残高・nonceをポーリングしWalletEntityに反映 | [2026-07-05](worklog/issue-77.md) |
| #78 | Issue #78 ワークベンチの接続先をロギングプロキシ経由に変更する | [2026-07-05](worklog/issue-78.md) |
| #79 | Issue #79 ワークベンチRPC観測用ロギングプロキシの実装 | [2026-07-05](worklog/issue-79.md) |
| #80 | Issue #80 操作エッジ(OperationEdge/operationObserved)の shared 型定義と collector 側の観測→配信配線 | [2026-07-05](worklog/issue-80.md) |
| #81-#84 | Issue #81/#82/#84 C層フロント(txライフサイクル・ウォレット・用語) | [2026-07-05](worklog/issue-81-84.md) |
| #83 | Issue #83 ワークベンチ→ノードの操作エッジ(operationObserved)をエッジ+パルスで描画 | [2026-07-05](worklog/issue-83.md) |
| #86 | Issue #86 txライフサイクルのfailedステータス(receipt status 0x0の検知)の設計 | [2026-07-06](worklog/issue-86.md) |
| #99 | Issue #99 WSL2環境でcollectorのWebSocket/ロギングプロキシが繋がらない(listen host を0.0.0.0に明示) | [2026-07-06](worklog/issue-99.md) |
| #102 | Issue #102 ノード/ワークベンチ追加時の仮カード(ゴーストノード)と即時フィードバック | [2026-07-06](worklog/issue-102.md) |
| #103 | Issue #103 compose起動ノードの削除ボタン(バックログ追加レビュー・removableフラグ設計) | [2026-07-06](worklog/issue-103.md) |
| #106 | Issue #106 reth(EL)同士のP2Pエッジ未描画のバックログ追加(docsのみ)のレビュー | [2026-07-06](worklog/issue-106.md) |
| #95 | Issue #95 P2Pエッジと所有エッジの色相分離(NETWORK_COLORSからアンバー系を除去) | [2026-07-06](worklog/issue-95.md) |
| #113 | Issue #113 仮カード(ゴーストノード)の配置indexの重なり(バックログ登録・frontend実装) | [2026-07-06](worklog/issue-113.md) |
| #119 | Issue #119 定期更新のたびにノードカードが一瞬ちらつく(React Flowの再計測サイクル) | [2026-07-06](worklog/issue-119.md) |
| #121 | Issue #121 pnpm dev:upの古いdistビルド未検知のバックログ追加(docsのみ)のレビュー | [2026-07-06](worklog/issue-121.md) |
| #123-#126 | Issue #123/#124/#125/#126 UX・運用バックログ4件の登録(docsのみ)のレビュー | [2026-07-06](worklog/issue-123-126.md) |
| #126 | Issue #126 pnpm dev:down --dockerが動的追加コンテナを削除しない不具合の修正 | [2026-07-06](worklog/issue-126.md) |
| #124 | Issue #124 P2Pメッシュ形成の正常性を伝えるUX設計(凡例・エッジホバー・ブートノード明示) | [2026-07-06](worklog/issue-124.md) |
| #123 | Issue #123 ノード/ワークベンチ追加時の追加先・接続先の予告(UX設計) | [2026-07-06](worklog/issue-123.md) |
| #125 | Issue #125 ブロック伝播パルスが移動して見えない問題のUX設計(SMIL凍結の根本原因特定・CSS offset-path化・グリッド間隔) | [2026-07-06](worklog/issue-125.md) |
| #135 | Issue #135 eth_subscribe WebSocket切断時の自動再接続 | [2026-07-07](worklog/issue-135.md) |
| #129 | Issue #129 動的追加ワークベンチのRPCをロギングプロキシ経由にする | [2026-07-07](worklog/issue-129.md) |
| #143 | Issue #143 eth_subscribeのエラー応答を検知できない不具合の修正 | [2026-07-07](worklog/issue-143.md) |
| #139 | Issue #139 lighthouse起動時のweak subjectivity periodエラー対応(--ignore-ws-check) | [2026-07-07](worklog/issue-139.md) |
| #141 | Issue #141 reth(EL)同士のエッジにブロック伝播パルスが走らない(receivedAtの2キー記録設計) | [2026-07-07](worklog/issue-141.md) |
| #153 | Issue #153 beaconStableIdForExecutionのdocker composeプロジェクト・スコープ漏れ修正 | [2026-07-07](worklog/issue-153.md) |
| #148 | Issue #148 長時間停止後の再起動ハング(ハートビート+genesis自動再生成+サスペンドwatchdogの設計・実装) | [2026-07-07](worklog/issue-148.md) |
| #169 | Issue #169 C層拡張の用語データ(contract/deploy/abi/event-log/evm/token)をglossaryへ追加 | [2026-07-07](worklog/issue-169.md) |
| #158 | Issue #158 サンプルコントラクト(ChainvizToken/Counter)のFoundryプロジェクト追加 | [2026-07-07](worklog/issue-158.md) |
| #160 | Issue #160 eth_getBlockReceiptsの正規化を拡張しコントラクト作成とイベントログを取得する | [2026-07-07](worklog/issue-160.md) |
| #159 | Issue #159 コントラクトカタログ(catalog.json)と再生成スクリプト(build-catalog.sh)の追加 | [2026-07-07](worklog/issue-159.md) |
| #163 | Issue #163 runWorkbenchOperationコマンド(transfer/deployContract/callContract)を実装 | [2026-07-07](worklog/issue-163.md) |
| #161 | Issue #161 コントラクトカタログの読み込みとデプロイ検知・追跡(subscribeContracts) | [2026-07-07](worklog/issue-161.md) |
| #162 | Issue #162 カタログABIによる関数呼び出し・イベントログの復号(contractCall/contractEvents) | [2026-07-07](worklog/issue-162.md) |
| #164 | Issue #164 追跡中トークンコントラクトの残高ポーリング(WalletEntity.tokenBalances) | [2026-07-07](worklog/issue-164.md) |
| #165 | Issue #165 ContractEntityのカード表示とポップオーバー(未知のコントラクトの差別化・デプロイエッジ) | [2026-07-08](worklog/issue-165.md) |
| #166 | Issue #166 コントラクト呼び出し・イベントログの可視化(活動チップ列・tx確定時のアニメーション・tx チップ「意味」優先表示・WalletPopoverの呼び出し内容追記) | [2026-07-08](worklog/issue-166.md) |
| #167 | Issue #167 ワークベンチカードから定型操作(送金・デプロイ・コントラクト呼び出し)を実行するUI | [2026-07-08](worklog/issue-167.md) |
| #168 | Issue #168 ウォレットカードへのトークン残高表示(formatUnits一般化・ダングリングガード) | [2026-07-08](worklog/issue-168.md) |
| #184 | Issue #184 rethのPrometheusメトリクスを有効化(--metrics 0.0.0.0:9001) | [2026-07-08](worklog/issue-184.md) |
| #190 | Issue #190 D層用語データ(engine-api/el-cl-separation/staged-sync/txpool)をglossaryへ追加 | [2026-07-08](worklog/issue-190.md) |
| #185 | Issue #185 rethメトリクスの周期ポーリング・パース(Prometheusテキストパーサー・Engine API呼び出し検知・同期ステージ・txpool) | [2026-07-08](worklog/issue-185.md) |
| #186 | Issue #186 ノード内部状態(NodeInternals/drivesNodeId/nodeLinkActivity)のworld-state反映 | [2026-07-08](worklog/issue-186.md) |
| #187 | Issue #187 ノードカードの同期状態・ブロック高(syncStatus/blockHeight)をD層観測(rethのFinish checkpoint)から更新 | [2026-07-08](worklog/issue-187.md) |
| #188 | Issue #188 内部リンクエッジ(beacon→reth)の常設描画とnodeLinkActivityの活動パルス | [2026-07-08](worklog/issue-188.md) |
| #189 | Issue #189 ノードカード/ポップオーバーに同期ステージ・mempool内訳を表示 | [2026-07-08](worklog/issue-189.md) |
| #191 | Issue #191 D層のプロトコル層E2Eテスト(PROTO-D-01。internals/drivesNodeId/nodeLinkActivity)を追加 | [2026-07-08](worklog/issue-191.md) |
| - | 特定Issueに紐付かない記録(PLAN.md/CLAUDE.md更新等、Phase5設計メモ) | [2026-07-05〜2026-07-09](worklog/meta.md) |
| #197 | Issue #197 Playwright基盤の導入(playwright.config.ts・globalSetup・webServer・pnpm test:e2e:ui配線) | [2026-07-09](worklog/issue-197.md) |
| #198 | Issue #198 SCENARIOS.mdが参照するdata-testidをfrontendへ追加(接続バッジ・ツールバー・言語トグル・用語/インフラポップオーバー) | [2026-07-09](worklog/issue-198.md) |
| #199 | Issue #199 基本表示シナリオ(UI-CONN・UI-A・UI-B)のPlaywright実装 | [2026-07-09](worklog/issue-199.md) |
| #200 | Issue #200 操作シナリオ(UI-CMD)のPlaywright実装と移行済みWSテストの整理 | [2026-07-09](worklog/issue-200.md) |
| #228 | Issue #228 SCENARIOS.md棚卸しで削除し忘れていたa-b-layer.test.tsの移行済みWSテスト2件を削除 | [2026-07-09](worklog/issue-228.md) |
| #201 | Issue #201 C層シナリオ(UI-C: 送金・デプロイ・呼び出し・トークン残高・未知コントラクト)のPlaywright実装。実装中にWalletEntity.recentTxHashes未配線・forge createの--constructor-args空配列不具合(collector)・デプロイエッジのアドレス表記不一致(frontend)を発見し修正 | [2026-07-09](worklog/issue-201.md) |
| #202 | Issue #202 異常系・複数クライアントシナリオ(UI-ERR・UI-MULTI)のPlaywright実装と、移行済みWSテスト(reconnect.test.tsの2件)の削除。collectorプロセスの停止・再起動をプロセスをまたいで扱うcollector-registry.tsを追加 | [2026-07-09](worklog/issue-202.md) |
| #203 | Issue #203 D層UIシナリオ(UI-D-01〜03)のPlaywright実装。ステップ10の最終Issueで、これによりSCENARIOS.mdのUIシナリオが全件`済`になり完了条件を満たした | [2026-07-10](worklog/issue-203.md) |
| #209 | Issue #209 デプロイ/呼び出しフォームの引数にABI型（uint/address）ベースのクライアント側バリデーションを追加(frontend)し、forge/castの失敗stderrを既知パターンの要約へ変換するsummarizeOperationErrorを追加(collector) | [2026-07-10](worklog/issue-209.md) |
| #210 | Issue #210 ワークベンチに複数ウォレットが紐づいて見える件の原因調査。モックデータ(EOA+スマートアカウント)の意図した挙動と特定、コード修正不要 | [2026-07-10](worklog/issue-210.md) |
| #214 | Issue #214 validator(VC)とブートノード間の「P2P接続を確立中...」固着の原因調査・設計・実装。VCはP2P非参加なのに接続確立中エッジの対象に含めている設計上のミスマッチと特定し、`p2pRole`への`"none"`追加+collector/frontendの除外ロジックで解消 | [2026-07-10](worklog/issue-214.md) |
| #211ほか | Issue #211/#212/#213/#215/#218/#219 UX上の6課題を実環境で評価し、4つの実装単位(A:#215 役割可視化、B:#213+#219 操作説明、C:#211+#218 一覧と導線、D:#212 txライフサイクル)へ切り分けたUX設計。単位C(コントラクト一覧パネル・pendingデプロイラベル)を実装完了 | [2026-07-10](worklog/issue-211.md) |
| #229 | Issue #229 PROTO-CMD-01が長時間稼働スタックで失敗する件の原因調査・修正。EL間P2Pバックフィルの回帰ではなく、追いつき所要時間(稼働時間÷20)がテストの固定上限540秒を超えることが根本原因と特定し、合格条件を「headへの完全追従」から「最低進行量(300ブロック)の停滞なき進行」に変更 | [2026-07-10](worklog/issue-229.md) |
| #221 | Issue #221 ホバーポップオーバーがカードとの隙間を通過中に消える不具合の修正。開閉状態を共通フックuseHoverPopoverに切り出し、mouseleaveのみ短い遅延を挟むことで8箇所の対象コンポーネント全てに適用 | [2026-07-10](worklog/issue-221.md) |
| #216 | Issue #216 beacon/rethのペア追加制約についての設計判断。EL:CL=1:1がThe Merge以降の標準構成でありペア追加は意図的な設計と確認、現状維持と結論(コード変更なし。UX改善のみ#251として起票) | [2026-07-10](worklog/issue-216.md) |
| #217 | Issue #217 長文エラーでトースト通知のレイアウトが崩れる不具合を修正(flex itemのmin-width:auto問題が原因。.toast/.toast__messageにmin-width:0・overflow-wrap:anywhere・white-space:pre-wrap・max-height+overflow-yを追加) | [2026-07-10](worklog/issue-217.md) |
| #220 | Issue #220 ノード追加・ワークベンチ追加ボタンの連打防止。既存のゴースト(仮カード)有無から算出するpendingAddNode/pendingAddWorkbenchをボタンのdisabled属性に反映し、直前の追加が解決するまで再クリックできないようにした | [2026-07-10](worklog/issue-220.md) |
| #222 | Issue #222 ノード/ワークベンチ削除中の進行中フィードバック(半透明化+削除ボタン無効化+スピナー)を追加。既存のワークベンチ操作保留追跡(pendingOperationWorkbenchIds)と同じ設計で`pendingRemovalIds`を実装 | [2026-07-10](worklog/issue-222.md) |
| #254 | Issue #254 dev collector稼働中はpnpm test:e2eが起動不能な不具合を修正。startCollectorがCHAINVIZ_PROXY_PORTを子プロセスへ渡すようにし、detectLaunchStatusをWebSocket・ロギングプロキシ両方のlisteningログが揃うまで判定確定しないよう拡張 | [2026-07-11](worklog/issue-254.md) |
| #238 | Issue #238 長時間のUI層E2Eフルスイート実行中にcollectorがuncaughtExceptionでexitしカスケード失敗する不具合の原因調査・修正。eth-ws-client.tsのsubscribe()内でonResult(onHeader/onTxHash)の呼び出しがtry/catchで囲われておらず、例外が発生するとws内部の同期呼び出しスタックを経てプロセス全体を落としていた。onResult呼び出しをtry/catchで囲みonErrorへ転送するよう修正 | [2026-07-11](worklog/issue-238.md) |
| #235 | Issue #235 collector停止中のaddNode/addWorkbenchがゴースト消滅のみでエラートーストが出ない不具合を修正。`ChainvizClient.sendCommand`が未接続でも常にcommandIdを返していたのが根本原因で、未接続時は`undefined`を返すよう変更。あわせてゴーストの安全網タイムアウトでもcommandResult自体が届かなかった場合はエラートーストを出すようにした | [2026-07-11](worklog/issue-235.md) |
| #233 | Issue #233 UI-CMD系PlaywrightテストのafterAllクリーンアップが競合状態で無効化されうる不具合を修正。goto直後の即時count()判定・削除完了を待たないpage.closeという2つの競合状態への対処を`support/cleanup.ts`に集約し、commands-node.spec.ts/commands-workbench.spec.tsに適用。あわせてwallet-balance.spec.ts/token-balance.spec.tsの重複インライン実装とcatch範囲が広すぎる問題も解消 | [2026-07-11](worklog/issue-233.md) |
| #245 | Issue #245 カードのホバーポップオーバーが隣接カードの下に描画され読めない不具合を修正。React Flowの各ノードが独立したスタッキングコンテキストを持つことが原因と特定し、`interaction/PopoverPortal.tsx`（`createPortal`+rAFによるアンカー追従）を新設して8箇所のホバーポップオーバー全てをdocument.body直下へportal描画するよう変更 | [2026-07-11](worklog/issue-245.md) |
| #246 | Issue #246 isValidatorServiceがcomposeサービス名の部分一致で判定しており将来の別チェーンプロファイルで誤検出しうる問題を修正。判定材料をcom.chainviz.roleラベル(ROLE_LABEL)の厳密一致に変更し、名前に依存しない頑健な判定にした | [2026-07-11](worklog/issue-246.md) |
| #237 | Issue #237 operateボタンのaria-busy属性がブロック到達タイミング次第で欠落する不具合を修正。`App.tsx`のメモ化最適化により`operationPending`が`undefined`のまま渡ることがあるのが原因で、`InfraNodeCard.tsx`側で`aria-busy={operationPending ?? false}`と明示的にデフォルト値を与える形に修正(App.tsx側のメモ化ロジックは変更しない) | [2026-07-11](worklog/issue-237.md) |
| #232 | Issue #232 確定時のコントラクトへのパルス/フラッシュがアドレス表記の食い違いで発火しない不具合を修正。`contractCallPulseEdge.ts`の`buildContractCallPulseEdge`と`useContractSettlementEffects.ts`の事前チェックが単純な文字列一致でウォレットアドレスを判定していたのが原因(Issue #201のdeployEdge.ts修正と同型)。大文字小文字を無視した照合ヘルパー`addressCasing.ts`を新設し、3ファイル(deployEdge.ts含む)で共通利用するよう統一した | [2026-07-11](worklog/issue-232.md) |
| #236 | Issue #236 送金フォーム(TransferForm)の宛先にIssue #209の`isValidOperationArgValue("address", ...)`を再利用したクライアント側アドレス形式バリデーションを追加。不正な形式では送信ボタンを無効化し既存の`operation.arg.invalid.address`文言でインラインエラーを表示する | [2026-07-11](worklog/issue-236.md) |
| #258 | Issue #258 describeSyncStageがdescribeNodeRole(Issue #215)と同種のObject.prototype継承メンバ漏れ脆弱性を持つことを確認し修正。SYNC_STAGE_LABELSへのブラケットアクセス前にObject.hasOwnガードを追加、回帰テストを追加 | [2026-07-11](worklog/issue-258.md) |
| #244 | Issue #244 デプロイtxで発生したイベント(mintのTransfer等)が復号されず生チップ表示になる問題を修正。実機再現でカタログ登録(registerContractDeployment)がブロック取り込みより約45ms後着することを特定し、(A)handleBlockInclusion内でデプロイ検知をログ復号より先に行う順序修正と、(B)後着登録時に未照合デプロイtxの生ログを再復号・再配信する自己修復機構(追加RPCなし)を実装 | [2026-07-11](worklog/issue-244.md) |
| #251 | Issue #251 ノード追加ボタン付近に「reth+beaconのペアで追加される」理由の説明を追加。実機確認でペアの事実は#123のツールチップに既出と判明し、欠けていた「なぜペアか(The Merge以降の標準構成)」の一文とGlossaryTermアンカー(el-cl-separation)を既存ツールチップの2段目として実装。ネストホバーで外側ツールチップが閉じないことも実機確認済み | [2026-07-11](worklog/issue-251.md) |
| #264 | Issue #264 glossaryのlookup/parseにあった同種のプロトタイプ汚染的な穴(#258のレビューで指摘)を修正。GlossaryProvider.tsxのlookupにObject.hasOwnガードを追加、parse.tsのparseGlossaryYaml/mergeGlossariesをObject.create(null)ベースの構築に変更。回帰テストを追加 | [2026-07-11](worklog/issue-264.md) |
| #223 | Issue #223 packages/shared・collector・frontend・e2eにREADME.md(役割と境界・モジュール構成・実行/テスト)を新設し、ルートREADMEを現状に合わせて更新。モジュール構成の正を各パッケージREADMEへ移しARCHITECTURE.md §1の重複記載を参照に置き換え。「タスクのたびにREADMEを確認・更新する」運用ルールのCLAUDE.md向け提案文言も記録 | [2026-07-11](worklog/issue-223.md) |
| #243 | Issue #243 validator clientの同期状態が永久に「同期中」(blockHeight 0)と表示される問題の調査。Issue #215のnodeRole/showsSyncStateによる表示制御で既に解消済みであることを静的確認と実機(実collector+実ブラウザ)の両方で確認し、コード変更不要と判定。隣接のbeacon(CL)同期表示ギャップを#274として起票 | [2026-07-11](worklog/issue-243.md) |
| #224 | Issue #224 docs/CONCEPT.md・docs/ARCHITECTURE.mdにMermaid図解を計8つ追加(全体データフロー・A〜D層スタック・ロードマップ・エンティティ関連図・差分イベント2系統・WebSocketシーケンス・ChainAdapter境界・D層観測フロー)。全図をmermaid v11のparseで構文検証済み | [2026-07-11](worklog/issue-224.md) |
| #263 | Issue #263 削除ボタンのaria-busy(removalPending)にIssue #237と同種の属性欠落バグがあることを実際に再現確認し修正。`InfraNodeCard.tsx`の削除ボタンを`aria-busy={removalPending ?? false}`に変更(App.tsx側のメモ化ロジックは変更しない)。回帰テストとタイミング依存の遷移テストを追加し、UI-ERR-03のE2Eコメント/アサーションも修正後の実態に合わせて更新 | [2026-07-11](worklog/issue-263.md) |
| #270 | Issue #270 UI-CMD-01のaddNode成功判定がIssue #215のsubtitle形式変更に追従しておらず常に失敗する不具合を修正。`subtitle === "reth"`等の完全一致判定を、subtitle末尾がclientTypeと一致するかを見る正規表現ヘルパー`subtitleEndsWithClientType`に置き換え、横断確認で見つかった同種のリグレッション(infra-display.spec.ts UI-A-01)も合わせて修正。修正前後で実際にDocker+Playwrightを動かし再現・解消を確認 | [2026-07-11](worklog/issue-270.md) |
| #274 | Issue #274 CLノード(beacon)の同期状態が永久に「同期中」(blockHeight 0)と表示されるギャップ(§7.3)を解消。Beacon API `/eth/v1/node/syncing`をD層ループで観測しsyncStatus(自己申告3フラグ)とblockHeight(=head_slot)を埋める`BeaconSyncStatusCache`を追加(collector)。consensus役割の高さ行ラベルを「ヘッドスロット」+用語`slot`に切り替え(frontend)。shared型変更なし(コメント追記のみ)。追加RPCは`/eth/v1/node/syncing`のみ | [2026-07-11](worklog/issue-274.md) |
| #282 | Issue #282 fetchBeaconSyncingのhead_slotパースが空文字列/null/16進/指数表記等の非準拠値を`Number(...)`の緩い変換規則により静かに受理していた不具合を修正。10進整数文字列または非負整数のJSON数値のみを受理する`parseHeadSlot`を新設し、それ以外(欠落undefinedを含む)は同じ経路でthrowするよう統一(collector) | [2026-07-11](worklog/issue-282.md) |
| #285 | Issue #285 validatorがbeaconと結ばれず「浮いて見える」課題を解消。既存の`drivesNodeId`(駆動する側→される側の一般関係)を再利用しvalidator→beaconにも内部リンクエッジを描く(ARCHITECTURE.md §7.6.11)。collector側は`beaconStableIdForValidator`新設・`resolveDrivesNodeId`のフォールスルー化(composeサービス名による静的解決、beacon→rethと同方式)。frontend側は役割の組(validator→consensus)ごとにポップオーバー文言・活動セクション表示を切り替え、InfraPopoverの駆動元行を非対称フォールバック(validatorのみ新表現、それ以外は既存表現を維持し行を隠さない)で一般化。shared型は構造変更なし(docstring一般化のみ)。実機QAでキャンバス描画・ポップオーバー文言・既存beacon→reth表示への非退行を確認済み | [2026-07-11](worklog/issue-285.md) |
| #286 | Issue #286 長時間稼働スタックの短時間再起動でgenesisが古いまま再利用されbeaconが追いつき不能になる問題を修正。再生成判定の入力を「停止時間」から「genesis年齢(=再構築必要量)」に置き換え、稼働中かどうかはハートビートmtimeの前進をサンプリング観測して実測判別する方式で実装(`generate-genesis.sh`・`docker-compose.yml`・README、環境変数`GENESIS_DOWNTIME_RESET_SEC`→`GENESIS_MAX_REBUILD_GAP_SEC`に改名)。実機検証で修正前の再現・修正後の解消、#56/#148の既存保護の回帰無しを確認済み | [2026-07-11](worklog/issue-286.md) |
| #287 | Issue #287 fetchConsensusPeerNodesが失敗ノード(Beacon API問い合わせ失敗)をログ無しで無言除外していた不具合を修正。EL側(fetchExecutionPeerNodes)と対称なconsole.errorを追加し、Beacon APIがハングし続ける状況での大量ログ化を避けるため連続失敗回数ベースの間引き(1回目は必ずログ、以降20回に1回)を実装。修正前後で実際にモックタイムアウトを再現しログの有無を確認済み | [2026-07-11](worklog/issue-287.md) |
| #288 | Issue #288 P2P接続エッジが1回のBeacon APIタイムアウトで即座に消え表示がちらつく問題の設計。collector側でノード単位の観測キャッシュ(PeerObservationCache)を持ち、連続失敗が猶予(3 tick、回数ベース)以内なら直前の成功観測を代用するヒステリシスを採用。shared/frontend変更なし。#287の失敗カウントは新クラスへ統合(ログ挙動は不変) | [2026-07-11](worklog/issue-288.md) |
| #293 | Issue #293 動的に追加したワークベンチでdeployContract(forge create)が常に「No contract found」で失敗する不具合を修正。`EthereumNodeLifecycle.workbenchSpec()`にサンプルコントラクトの Foundry プロジェクト(`profiles/ethereum/contracts`)を`/contracts`へbind mountする`binds`エントリを追加(静的ワークベンチと同じマウント先。`workbench-operations.ts`の`CONTRACTS_MOUNT_PATH`定数を再利用)。`docker-compose.yml`の静的ワークベンチ定義は変更なし。実機で修正前の再現(`/contracts`不在によるforge create失敗)と修正後の解消(bind mount付与・デプロイ成功)を確認済み | [2026-07-12](worklog/issue-293.md) |
| #295 | Issue #295 残高不足エラーのwei生数値表示をETH単位へ変換。変換ロジックはsharedへ共通化せずcollector側(`adapters/ethereum/ether-display.ts`新設)に軽量実装(sharedは型定義のみのパッケージであり、wei/ETH/decimals=18はChainAdapter境界内に閉じるべき語彙のため)。表示は小数最大6桁切り捨て(丸めない)・末尾ゼロ削り(最低1桁)。shared型変更なし・frontend作業なし。影響はinsufficientFundsパターンのみと確認済み。実機QAで送金失敗時のETH単位表示・退行なしを確認済み | [2026-07-12](worklog/issue-295.md) |
| #296 | Issue #296 フォーク(一時的な分岐)の色分け表現を実装。既存の`NodeEntity.headBlockHash`(常に空文字列のプレースホルダだった)を器とし、既存のnewHeads購読からアダプタ内`HeadTipCache`経由で埋める(追加RPCゼロ・shared構造変更なし、JSDoc明文化のみ)。フロントの`detectForkGroups`がparentHashの祖先関係比較(Union-Find)により「伝播ラグ」と「本物のフォーク」を区別し、ノードカードを色分け表示。収束すると色が消える。ARCHITECTURE.md §9参照。実機QAで正常時の色分け無し・モックシナリオでの色分け・収束表示を確認済み | [2026-07-12](worklog/issue-296.md) |
| #298 | Issue #298 ブロックが連なって積み上がっていく様子を視覚表現。チェーン全体で1本の常設「チェーンリボン」(直近8タイル+落下・着地・発光アニメーション+ホバーで親ハッシュ連結の強調+ホバー連動ハイライト)をキャンバス内カードとして追加。collector側はWorldStateStoreにブロック番号ベースの保持窓(BLOCK_RETENTION=32)を追加。shared型変更なし。3回の差し戻し(ホバー中の表示窓前進によるハイライト消失・テスト検出力不足・e2eのビューポート問題)を経てすべて解消、`useFrozenRibbonTiles`によるホバー中の表示窓凍結とe2eのFit View操作追加で対応。ARCHITECTURE.md §10参照。実機QAで基本表示・ホバー連動・e2e(UI-B-05/UI-B-06)green化を確認済み | [2026-07-12](worklog/issue-298.md) |
| #301 | Issue #301 `subscribeBlocks`が起動時に一度だけ対象を列挙しaddNodeで追加したノードにnewHeads購読が張られない問題の設計。`subscribePeers`/`subscribeNodeInternals`と同じsetTimeout周期ループへ変更するが、WSは長寿命接続のため毎tick張り直さず、`stableId`キーの購読レジストリで対象集合の差分だけを開閉する「リコンサイル」方式を採用。二重購読はレジストリのキー存在で防止、`receivedAtKeys`/IP変化には`signature`(wsUrl+receivedAtKeys)比較で張り直しで追従、個々のWS再接続は既存Issue #135実装に委ねる。removeNodeノードの購読close漏れ(死コンテナへの無期限再接続)も同時解消。shared/frontend変更なし・collector単独。`subscribeTransactions`の同型ギャップは影響小のため別Issue推奨(統括確認待ち)。ARCHITECTURE.md §4/§9.5参照 | [2026-07-13](worklog/issue-301.md) |
| #299 | Issue #299 A〜D層が同一キャンバスに共存し読み取りにくい課題への対応。UX設計(既定の全層表示を維持したまま選択層以外を薄くする「レイヤーレンズ」)に続けて実装。ツールバー直下に単一選択のレイヤーチップバー(すべて/A/B/C/D)を新設し、`entities/canvasLayers.ts`の判定関数がカード・エッジのdim対象を算出、`className`への修飾クラス付与+CSSの`:hover`復帰で表示を切り替える。ゴーストカード・接続予定/確立中エッジ・新着発光中カードはレンズ対象外(#102/#220の教訓を維持)。ヘッダー副題「(A層)」を「(A層〜D層)」に修正、7種のポップオーバー見出しに層バッジを追加、用語`visualization-layers`を追加。shared/collector変更なし(frontendのみ)。実機QAでレイヤー切り替え・#102/#220再発防止(HUD/ゴースト/接続確立中エッジの対象外化)を確認済み | [2026-07-12](worklog/issue-299.md) |
| #303 | Issue #303 WorldStateStoreのTransactionEntity無制限蓄積対策。設計(ARCHITECTURE.md §10.4)どおり2系統の保持窓をcollectorに実装。included/failed tx(blockHashあり)は`applyTransaction`の入口ガード(対応blockがstoreに無ければ捨てる)+`applyBlock`の窓落ちblockに紐づくtxの退去(同一差分)で有界化。pending tx(blockHashなし)はblock eviction対象外とし、件数上限`PENDING_TX_RETENTION=256`(挿入順evict)で有界化。`index.ts`は新設`hasTransaction`で入口ガード後の取り込み有無を判定し、取り込んだ場合のみ`linkTransactionToWallets`を呼ぶよう配線変更。shared型変更・frontend変更なし。ユニットテスト(`store-transaction-retention.test.ts`)追加、実機(docker compose)で送金操作によるtx取り込み・block退去連動のtx退去を確認済み | [2026-07-13](worklog/issue-303.md) |
| #309 | Issue #309 3346行・84テストケースに肥大化していた`peer-block-adapter.test.ts`(11個のdescribeが同居)を分割。共有fixtureヘルパー(`clientFrom`/`controllableWsClient`/`stubRpcClient`等)を`test-helpers/`配下へ関心事ごとに6ファイルへ切り出し、describe単位で7ファイル(`peer-poll.test.ts`/`peer-subscribe.test.ts`/`block-subscribe.test.ts`/`transaction-subscribe.test.ts`/`contract-subscribe.test.ts`/`node-internals.test.ts`/`adapter-sync-status.test.ts`)へ分割。ロジック・アサーション変更は無し(移動のみ)、分割前後でテスト総数84件の一致を確認。元ファイルは削除 | [2026-07-13](worklog/issue-309.md) |
| #325 | Issue #325 dev-up.shがdist鮮度の警告のみでpnpm buildを自動実行しない件の起票と`docs/PLAN.md`バックログ追記のレビュー(合格。Issue本文の現状説明が`scripts/dev-up.sh`の実コード・Issue #121の設計意図と一致、PLAN.md追記のフォーマット一貫性、lint/build/test全通過を確認。実装着手は後日) | [2026-07-15](worklog/issue-325.md) |
| #327 | Issue #327 UI全体に透明感・グラデーションを取り入れる要望の起票・PLAN.mdバックログ追記のレビューと、UX/ビジュアルデザイン設計(「静かな夜のガラス」方針。すりガラスはオーバーレイ/ポップオーバー限定・カードは縦グラデーション+透過でbackdrop-filter不使用、背景に淡い色光のグラデーション、Issue #32の視認性水準をWCAG検算で維持。Playwrightで現状撮影+提案CSSの一時注入プロトタイプ検証済み。ライトモード新設はスコープ外) | [2026-07-15〜2026-07-16](worklog/issue-327.md) |
| #328 | Issue #328 ドラッグ中のWebSocket更新で位置がずれる不具合の起票と`docs/PLAN.md`バックログ追記のレビュー(合格。推測原因を未確認と明示しchainviz-detective先行の進め方が妥当、PLAN.md追記のフォーマット一貫性、lint/build/test全通過を確認。実装着手は後日) | [2026-07-15](worklog/issue-328.md) |
| #330 | Issue #330 mempool(未承認tx)全体を俯瞰できるビューを実装。既存データのみで成立(shared型変更なし・collector変更なし): `TransactionEntity`のstatus=pending抽出(ネットワーク集約・C層)を上段、`NodeEntity.internals.mempool`のノード別pending/queued(D層)を下段に束ねた常設ミニパネル(`ContractListPanel`と同型、0件でも常設表示)をfrontendに追加。行クリックで送信元ウォレットカードへパン、アドレス表記のcasing差異は`buildLowerCaseIndex`で吸収(レビューで1回差し戻し・修正済み)。ノード選択式・#317のタブ機構先行実装は不採用。ARCHITECTURE.md §11、実機QAで実データのcasing差異ケースを含め確認済み | [2026-07-16](worklog/issue-330.md) |
| #319 | Issue #319 ウォレットtx履歴の各行にnonce値を表示。`TransactionEntity.nonce?: number`をsharedに追加(0はfalsyでも意味ある観測値・省略=情報なし)。collector側はpending検知時の`eth_getTransactionByHash`から観測(receiptにはnonceが無いため取り込みのみ観測のtxは省略。Issue #86の「ブロックあたりRPCを増やさない」方針を維持)、frontend側は`WalletPopoverTxItem`に`walletAddress` propを追加し送信tx限定(`tx.from`が自ウォレットと大文字小文字無視で一致)でhash直後・statusチップ前に「nonce n」を表示。Issue #320(スクロール)とは行の中身/一覧コンテナで責務分割し#319先行。ARCHITECTURE.md §2/§6.12参照 | [2026-07-16](worklog/issue-319.md) |
| #334 | Issue #334 removeWorkbenchがaddWorkbenchで追加したワークベンチにも「追加されていない」エラーを返すことがある不具合の起票と、Issue #330(mempool俯瞰ビュー。起票時に追記を失念)と併せた`docs/PLAN.md`バックログ追記のレビュー(合格。#334のエラーメッセージ引用がnode-lifecycle.tsの実装と一致、#330本文の実装参照・PLAN.md追記の現状記述が実状と一致、フォーマット一貫性、lint/build/test全通過を確認。#330のworklogはissue-330-mempool-viewブランチ側に存在するため本ブランチでは作成せず本ファイルに記録。実装着手は後日) | [2026-07-16](worklog/issue-334.md) |
| #322 | Issue #322 slot timeを現実のEthereum値(12秒)に戻す設計(designer)。インジケータ部分を#343へ分割。values.envの3変数変更・genesis再生成は既存環境でdown -vが1回必要(values.env変更の自動検知は作らない)・#286閾値は変更不要・E2Eは修正必須2箇所(docker.tsの6秒観測窓、node-internals.specの15秒パルス待ち)+slot time出所のvalues.env読み取りへの一元化・collector側はコメント更新のみ。開発用の短縮プリセットは設けない | [2026-07-16](worklog/issue-322.md) |
| #343 | Issue #343 ブロック生成タイミングのインジケータ設計(designer。#322から分割)。フロント側導出のみで実現(shared/collector変更なし): BlockEntity.timestampの差分GCDで生成間隔・位相を導出し、チェーンリボンカードのヘッダにカウントダウン+進捗を表示。導出不成立時は非表示、interval×3で停滞表示。collectorがbeacon APIからSECONDS_PER_SLOTを取る案は不採用(理由はworklog §1) | [2026-07-16](worklog/issue-343.md) |
| #320 | Issue #320 ウォレットtx履歴のスクロール対応(frontend側)。`WalletNodeData`に`popoverTransactions`(全件解決)を新設し、カード面のチップ用`transactions`(`DEFAULT_RECENT_TX_LIMIT`=6件)とポップオーバー用を分離。`WalletPopover`のtx一覧に`.wallet-popover__tx-list`(`max-height: 220px`・`overflow-y: auto`・細スクロールバー常時表示)を追加し全件描画、見出しに新規i18nキー`wallet.recentTxCount`(`format()`で件数埋め込み)を表示。モックモード用に`mockData.ts`のAlice tx履歴上限を6→20件(`MOCK_ALICE_RECENT_TX_LIMIT`)に引き上げ。collector側の保持件数拡張は別ブランチ`issue-320-tx-history-scroll`で並行実装中で、本ブランチは未合流(`packages/frontend/`のみの変更) | [2026-07-16](worklog/issue-320.md) |
| #341 | Issue #341 英語モードでp2p-legendの凡例文が日英混在になる不具合の起票と`docs/PLAN.md`バックログ追記のレビュー(条件付き差し戻し。不具合の実在はビルド済み`i18n.js`の実測で確認済み。ただしレビュー中に根本原因を特定: `messages.ts`の`legend.hint.suffix`の意図的な空文字en訳と`i18n.ts`の`pickLocale`の「空文字=値なし→jaへフォールバック」仕様の衝突であり、Issue本文の「英訳に日本語断片が保存されている」推測・「glossary/またはmessages.tsのどちらか」という切り分け記述は不正確なため更新を要請。フォーマット一貫性は問題なし。実装着手は後日)、および修正方針の設計(designer。案A'を採用: `translate()`のみ「空文字は意図的な値」として尊重しフォールバックしない仕様に変更、`pickLocale()`はglossaryデータ不備への防御として現行の空文字フォールバックを維持。根拠は「コードは型で全言語必須・データは不備がありうる」という信頼度の境界。ARCHITECTURE.md §5.1に解決規則を明記。shared型変更なし、実装はfrontendの3ファイル: i18n.ts・i18n.test.ts・PeerNetworkLegend.test.tsx) | [2026-07-16〜2026-07-17](worklog/issue-341.md) |
| #322 | Issue #322 slot timeを12秒に戻す変更に伴うE2Eテスト・collectorコメントの追従(TypeScript側)。slot timeの出所を`values.env`のパーサ`helpers/slot-time.ts`に一元化し、`SLOT_DURATION_SECONDS=2`の重複定義2箇所を撤去。slot依存の待ち時間(docker.tsの進行観測窓・p2p-graph/chain-ribbonのブロック待ち・node-internalsの2回目パルス待ち15秒・OPERATION_EFFECT_TIMEOUT・playwrightのテスト単位タイムアウト)を`SLOT_DURATION_MS`から動的導出。collector側はreth-metrics-tracker/sync-statusの2秒前提コメントを12秒前提へ更新(ロジック変更なし)。node-env側(values.env・genesis)は別ブランチで並行実装、後で統括がcherry-pickで合流 | [2026-07-16](worklog/issue-322.md) |
| #346 | Issue #346 UI層E2Eテストの一部が実.hover()依存・描画安定性不足でflakyになりうる件。起票・実装(UI-C-04/UI-D-03のdispatchHover化+portal対応locator、UI-ERR-02のIssue #235追随)・テスト強化・レビュー・QA。UI-CMD-07のみ原因不明のままIssue #373として分割し、#373の本質修正(fitViewタイミング競合解消)取り込み後にクリーンスタックで3回連続安定合格を確認して解消。UI-C-06のETH_RPC_URLハードコード問題を副次的に発見しIssue #381として分割 | [2026-07-16〜2026-07-18](worklog/issue-346.md) |
| #321 | Issue #321 デプロイされたコントラクトのソースコードを直接見れるようにする。カタログ(catalog.json)に`source`(fileName/language/code)を同梱し`ContractEntity.sourceCode?`(shared)へcollectorが転記、右ドックの汎用サイドパネル機構(`side-panel/`。`SidePanelView`判別共用体+`useSidePanel`+シェル`SidePanel`+振り分け`SidePanelHost`。#313/#317がkind追加だけで相乗り可能)とコントラクトソースビュー(`ContractSourceView.tsx`)を新設して表示。未知コントラクトは「バイトコードからソースは復元できない」を明示。シンタックスハイライトは自前の軽量トークナイザ(`chain-profiles/ethereum/sourceTokenizer.ts`。純関数、Prism/Shiki等は不採用)。`ContractCard`に「ソースコードを見る」ボタンを追加。`ContractPopover`の`withAbiAnchor`を`glossary/withTermAnchor.tsx`へ汎用化して再利用。ARCHITECTURE.md §12新設 | [2026-07-16](worklog/issue-321.md) |
| #315 | Issue #315 ERC-721(NFT)の所有関係を可視化する設計(designer)。所有台帳はコントラクト側に持つ: `ContractEntity.nft?`(symbolメタ)+`nftTokens?`(`NftToken { tokenId, ownerAddress }`配列)をsharedへ先行実装(DiffEvent/プロトコル変更なし)。collector観測はTransferイベント畳み込みではなく`totalSupply`+`ownerOf`のeth_callポーリング(再起動で狂わないステートレス方式)。サンプルはChainvizNFT(EIP-721完全準拠でない学習用サブセット。burnなし+1始まり連番採番=「tokenId 1〜totalSupply」が列挙の前提条件)。フロントはエッジを張らずカード2視点(コントラクト=台帳/ウォレット=保有)。ARCHITECTURE.md §13新設 | [2026-07-17](worklog/issue-315.md) |
| #313 | Issue #313 用語集パネルのUX設計(ux)。Issue #321の汎用サイドパネル機構へ`{kind:"glossary"; termKey?}`で相乗り(shared変更なし)。開閉トリガーはヘッダーの「用語集」ボタン(トグル)+全`GlossaryTerm`のクリック(該当用語を選択状態で開く)。パネルは検索(ja/en名・key・現在言語の定義の部分一致)+層グループ(YAML記載順維持)+単一展開アコーディオン。レイヤーチップでレイヤーレンズ(#299)連動、関連用語チップでパネル内ジャンプ。ポップオーバーは共存させ6行クランプ+「クリックで用語集を開く」フッター+関連用語の生キー表示を用語名に修正。個別要素へのパン・出典逆引き・チェーン横断はスコープ外。実測でリボンのポップオーバー内インタラクションが約200msで閉じて成立しない問題を確認(別Issue候補として統括へ報告) | [2026-07-17](worklog/issue-313.md) |
| #351 | Issue #351 チェーンリボンの「親ブロック」行ホバー強調が実質使えない(ホバーが約200msで閉じる)。起票・PLAN.mdバックログ追記のレビュー(合格)に続きUX設計(ux)を実施。実測で再現(穏やかな移動では行到達前に消滅・素早く到達して強調が点灯しても離脱起点約200msで閉じる・閉じる瞬間に強調が固着する二次バグも発見)し、原因はリボンだけがポップオーバーをアンカーのReactツリー子ではなく兄弟(Fragment)として描く逸脱(他の全ポップオーバーはポータルへのイベント伝播でポップオーバー上のホバー維持が無償に効く)と特定。遅延クローズ拡大・クリック固定表示は却下し「既存パターンへの合流(タイルの子として描く)+表示窓凍結条件の拡張(issue-298既知の残課題も解消)+強調寿命≤ポップオーバー寿命」を設計、実装・テスト強化・レビューを経て1回目のQAで実Docker環境の回帰(親ブロック行ホバー中はホバー中タイル自身も同時に強調される二重表示、UI-B-05のtoHaveCount(1)と矛盾)を発見。UX設計の単数強調の意図に立ち返り、実装ロジック側(自分自身の親ブロック行をホバーしている間は自己強調を抑制)を修正して二重強調を解消し、e2eは表示窓位置に依存しない識別ベースの検証に変更。再レビュー合格、2回目のQAで実DOM上「強調されるのは親タイル1つだけ」を確認し合格。副次的に発見したUI-B-06の併走時flakyは#351非依存の既存課題としてIssue #388へ分離 | [2026-07-17〜2026-07-18](worklog/issue-351.md) |
| #388 | Issue #388 UI-B-06(chain-ribbon.spec.ts)がUI-B-05との併走時に間欠的にflakyになる件の起票と`docs/PLAN.md`バックログ追記。Issue #351の最終QA検証中にchainviz-qaが偶発的に観測。#351のコード変更には起因せず、対象ブロックが表示窓から流れ出るまでの時間との既存由来のタイミング競合(issue-298.mdに既出)が併走時の負荷で顕在化しやすくなると考えられる。実装着手は後日 | [2026-07-18](worklog/issue-388.md) |
| #352 | Issue #352 ノード間通信ログにRPC呼び出しのレスポンス(成否・所要時間)を追加する。起票と`docs/PLAN.md`バックログ追記のレビュー(合格)に続き、designerによる設計を実施: ロギングプロキシがレスポンスも観測し`OperationEdge`にoptionalの`outcome: "ok"\|"error"`/`durationMs`を載せる(shared型変更は設計時に実装済み)。観測イベントの発行をレスポンス受領後へ移す(1呼び出し=1イベントを維持)、所要時間はリクエスト受領完了→レスポンス受領完了(バッチは全要素で共有)、成否判定(JSON-RPCのerrorフィールド等)はプロキシに閉じ判定不能は省略、表示は操作エントリ2行目に成否+所要時間を既存色で追記(パルス側は変更なし)と決定。collector/frontendは並行着手可 | [2026-07-17〜2026-07-18](worklog/issue-352.md) |
| #317 | Issue #317 ノード間のリクエスト・レスポンスを時系列ログとして監視する「通信ログ」パネルのUX設計(ux)。ブラウザ別タブではなく#321のサイドパネル機構へ`{ kind: "commsLog" }`で相乗り。第1弾はフロントのみ(shared/collector変更なし): 既存DiffEvent(operationObserved・nodeLinkActivity・block receivedAt増分・tx status遷移・PeerEdge増減・環境変化)から6カテゴリのエントリを導出、新しいものが上・500件リングバッファ・カテゴリ/ノードの表示フィルタ・カテゴリ色は既存エッジ色を再利用。P2P伝播は「受信」の語で記録し送信経路を断定しない。レスポンス(成否・所要時間)の観測は第2弾として分離を推奨(shared型変更を伴うため統括・designerの判断待ち) | [2026-07-17](worklog/issue-317.md) |
| #357 | Issue #357 docker compose down -v後もEOA(ウォレット)が削除されずに残る件の原因調査(detective)・設計(designer)・実装(collector)・テスト強化(tester)・レビュー(reviewer)・QA検証。根本原因: collectorはホスト上の長寿命プロセスでdown -vの影響を受けず、チェーンリセット(genesis変更)を検知してC層エンティティ(wallet/contract)をパージする仕組みが無かった(walletはワークベンチ消滅時にowner=nullで残す意図的仕様のため、チェーン破棄後も残留)。修正: genesisハッシュの変化(実際に異なるハッシュを観測できたときのみ判定、観測失敗はリセットの証拠にしない)を検知する`ChainResetWatcher`を新設し、検知時にContractTracker等の各トラッカー/キャッシュと`WorldStateStore`のwallet/contract/block/transactionを`entityRemoved`でパージ、`maxObservedBlockNumber`もリセット。`EthereumNodeLifecycle`のwallet-index採番レジストリは意図的にパージしない(Dockerの実態を映すため)。QAが実Dockerで`down -v`→`up`を実行し、同一プロセスでのパージ・NftTrackerのエラーログ解消・wallet ポップオーバー表示中のentityRemoved受信でクラッシュしないことを実機確認。副次問題(managedコンテナがdown -vで削除されない)は#359として分離 | [2026-07-17](worklog/issue-357.md) |
| #359 | Issue #359 addNode/addWorkbenchで作成したmanagedコンテナがdocker compose down -vでも削除されない件の起票レビューと実装(node-env)。根本原因を実機特定: `com.docker.compose.config-hash`ラベルが無いコンテナはproject/serviceラベルが正しくてもDocker Compose自体から一切認識されず、`--remove-orphans`を付けても孤児として検出されない。`node-lifecycle.ts`のaddNode/addWorkbenchが作るコンテナにこのラベル(値は固定プレースホルダー)を追加し、`docker compose down -v --remove-orphans`で完全に片付くことを実機確認(修正前後の差分を実際のコード・実Dockerで再現・解消確認)。READMEとdocker-compose.ymlの片付け手順も`--remove-orphans`必須に更新 | [2026-07-17](worklog/issue-359.md) |
| #362 | Issue #362 サイドパネル(コントラクトソース表示・用語集表示)の幅をリサイズできるようにする。起票・PLAN.mdバックログ追記のレビュー(合格)に続き設計(永続化する・`chainviz.sidePanel.width.v1`新設・既定420px/最小300px/最大90vw・kind共通1値)。実装(永続化ロジック・ドラッグ/キーボード操作フック・role="separator"+aria属性)・テスト強化(境界値・ドラッグ割り込み)・レビュー(ARCHITECTURE.mdの軽微な記述不一致を1回差し戻し後解消)・QA(実Docker環境でドラッグ・キーボード操作・クランプ・永続化を確認)を経てマージ完了。QA中に発見した軽微なUX上の粗さ(右ボタンドラッグに反応・テキスト選択抑止なし)はIssue #391へ分離 | [2026-07-17〜2026-07-18](worklog/issue-362.md) |
| #364 | Issue #364 サンプルコントラクトのトークンシンボル(CVZ等)がSolidityの定数でハードコードされておりデプロイ時に変更できない件の起票と`docs/PLAN.md`バックログ追記のレビュー(合格。Issue本文とPLAN.md追記が過不足なく一致、参照事実(ChainvizToken.solの`symbol = "CVZ"`定数と`initialSupply`のみのコンストラクタ、ChainvizNFT.solの`symbol = "CVN"`、catalog.json等のCVZ依存箇所)の実在、フォーマット一貫性、コミット粒度、lint/build/test全通過を確認。実装着手は後日、引数化か表記変更かは着手時に設計判断)、および設計(designer。案B「命名変更のみ」を採用: `CVZ`→`CVZDEMO`・`CVN`→`CVNDEMO`。コンストラクタ引数化はカタログ=単一の真実の情報源の前提を崩しcollectorにオンチェーンメタデータ読み取りの新規機構が必要になるため範囲外とし将来Issueに分離。shared型変更不要。影響範囲の全ファイル一覧と実装分担・コミット分割案をworklogに記録)。node-env/frontend実装・統括による表記統一補完・テスト強化・レビューを経てマージ完了(PR #384) | [2026-07-17〜2026-07-18](worklog/issue-364.md) |
| #366 | Issue #366 追加ワークベンチの命名が静的ワークベンチと衝突する(コンテナ名409・stableId重複による操作の誤配送)件の起票と`docs/PLAN.md`バックログ追記のレビュー(合格。Issue本文とPLAN.md追記が過不足なく一致、参照事実(meta.mdのdetective調査記録、node-lifecycle.tsのworkbenchSeq採番320行目・コンテナ名生成641行目・uniqueWorkbenchService 705行目・findWorkbenchContainer 566行目)の実在、フォーマット一貫性、コミット粒度、lint/build/test全通過を確認。実装着手は後日、静的ワークベンチを含む実在コンテナとの衝突回避の実現方法は着手時に設計判断) | [2026-07-17](worklog/issue-366.md) |
| #369 | Issue #369 collectorのcomposeProjectが"chainviz-ethereum"にハードコードされており環境変数で上書きできない件の起票と`docs/PLAN.md`バックログのIssueリンク付与のレビュー(合格。以前からPLAN.mdに記載されていたがIssue化されずに残っていた項目に統括が起票・リンク付与。Issue本文とPLAN.md項目が過不足なく一致、フォーマット一貫性、lint/build/test全通過を確認。同一コミットのIssue #353バックログ追記漏れ修正もあわせて確認(記録はissue-313.md)。実装着手は後日、実現方法は着手時に設計判断) | [2026-07-17](worklog/issue-369.md) |
| #371 | Issue #371 i18n translate()にObject.prototype由来キー(toString等)への防御が無い件の起票・レビューに続き、frontendが`translate()`に既存の`format()`と同様の`hasOwnProperty`ガードを追加して実装。修正前に`translate("toString", "ja")`等が`undefined`を返す契約違反を実際に再現し、修正後に解消することを確認。回帰テストも同様に修正前で失敗・修正後で成功することを確認した上で追加 | [2026-07-17〜2026-07-18](worklog/issue-371.md) |
| #373 | Issue #373 UI-CMD-07: ワークベンチ削除ボタンがE2E上でstableにならないことがある件の起票(Issue #346から分割)・レビュー・原因調査(detective)・設計(designer)・実装(frontend)・テスト強化・レビュー・QA検証(差し戻し1回含む)。Docker非依存の隔離合成環境(偽collector+実フロント+実spec)で原報告と同一の失敗(102秒タイムアウト・aria-busy=false・同じコールログ)を再現し根本原因を特定: 初期fitViewがsnapshot到着前の「空のチェーンリボン1枚」に対して発火してzoom=maxZoom(2)に確定し、後から現れたカード(e2e-ui-alice等)がビューポート外に置かれ、React Flowはスクロール不能のためPlaywrightのclickが「element is outside of the viewport」を永久リトライしていた(「stableにならない」はログ集約行の誤読)。修正: `fitView` propをやめ「最初のsnapshot反映+全ノード計測完了後」に`fitView({maxZoom:1})`を1回だけ呼ぶ遅延初期フィット(ARCHITECTURE.md §14)。e2e側はロード後に追加されたカードをクリックするシナリオ(UI-MULTI-01・cleanup安全網)にControlsのフィットボタンを押す`fitCanvasView`ヘルパーを追加したが、1回目のQAで対象カードが計測完了前にフィットが発火し視野外へ押し出される回帰(UI-MULTI-01 4/4失敗)を発見。対象がビューポート内に完全に収まるまで再試行する堅牢化で解消し、2回目のQAで単独・負荷有りいずれも安定合格を確認 | [2026-07-17〜2026-07-18](worklog/issue-373.md) |
| #377 | Issue #377 用語集パネルのフォントサイズを変更できるようにする件の起票と`docs/PLAN.md`バックログ追記のレビュー(合格。ユーザーからの要望。Issue本文とPLAN.md追記が過不足なく一致、参照事実(用語集パネル実装済み(#313)、layout/layoutStore.ts、SidePanel.tsx/SidePanelHost.tsxの共通シェル構成、類似要望#362がOPEN)の実在、フォーマット一貫性、コミット粒度、lint/build/test全通過を確認。実装着手は後日、UI形状・永続化要否・適用範囲は着手時に設計判断) | [2026-07-18](worklog/issue-377.md) |
| #381 | Issue #381 workbenchのETH_RPC_URLがdev collectorプロキシ(4001)に固定でUI E2E単独実行時に到達できない件の起票と`docs/PLAN.md`バックログ追記のレビュー(合格。Issue #346の最終QA検証中にchainviz-qaが偶発的に観測。Issue本文とPLAN.md追記が過不足なく一致、参照事実(docker-compose.ymlのETH_RPC_URL固定値、E2E collectorのポート4125/4126)の実在、フォーマット一貫性、コミット粒度、lint/build/test全通過を確認。実装着手は後日、まずchainviz-designerによる設計を先行) | [2026-07-18](worklog/issue-381.md) |
| #353 | Issue #353 GlossaryTermのキーボード操作(Space)でpreventDefaultが呼ばれずページスクロールし得る件の実装(frontend)。`role="button"`の`<span>`はネイティブ`<button>`と異なりSpaceキーの既定スクロールを自動抑止しないため、`onKeyDown`のインラインハンドラで`openPanel`呼び出し前に`event.preventDefault()`を追加(クリックには不要なため`openPanel`本体には入れない)。修正前のコードで`fireEvent.keyDown`の戻り値(dispatchEventの戻り値)が`true`(未キャンセル)のまま問題が再現すること、修正後に`false`になることを確認してから進めた | [2026-07-18](worklog/issue-353.md) |
| #385 | Issue #385 addWorkbench(createAndStart)でcontainer.start()失敗時に作成済みコンテナがorphanとして残留する件の起票と`docs/PLAN.md`バックログ追記。Issue #369の最終QA検証中にchainviz-qaが偶発的に観測。addNodeは事前にネットワーク存在確認をするため発生しないが、addWorkbenchにはこの事前チェックが無い。エラー自体は握りつぶさず伝播するが作りかけのコンテナが残留する。実装着手は後日 | [2026-07-18](worklog/issue-385.md) |
| #391 | Issue #391 サイドパネルのリサイズハンドルが右ボタンドラッグに反応しテキスト選択も抑止されない件の起票と`docs/PLAN.md`バックログ追記、および実装(frontend)。起票時の内容: Issue #362の最終QA検証中にchainviz-qaが実ブラウザ操作で確認。handlePointerDownがevent.buttonを未チェックのため右ボタンドラッグでもリサイズが開始し、resizing中にuser-select抑止も無い。実装: `handlePointerDown`に`event.button !== 0`のガードを追加して左ボタンのみリサイズを開始するようにし、`resizing`状態のときルート要素に`side-panel--resizing`修飾クラスを足してパネル配下の`user-select`をドラッグ中だけ止めるCSSを追加。いずれも修正前のコードで回帰テストが実際に失敗することを確認してから修正し、修正後に解消することを確認 | [2026-07-18](worklog/issue-391.md) |
