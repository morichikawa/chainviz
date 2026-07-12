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
| #299 | Issue #299 A〜D層が同一キャンバスに共存し読み取りにくい課題への対応。UX設計(既定の全層表示を維持したまま選択層以外を薄くする「レイヤーレンズ」)に続けて実装。ツールバー直下に単一選択のレイヤーチップバー(すべて/A/B/C/D)を新設し、`entities/canvasLayers.ts`の判定関数がカード・エッジのdim対象を算出、`className`への修飾クラス付与+CSSの`:hover`復帰で表示を切り替える。ゴーストカード・接続予定/確立中エッジ・新着発光中カードはレンズ対象外(#102/#220の教訓を維持)。ヘッダー副題「(A層)」を「(A層〜D層)」に修正、6種のポップオーバー見出しに層バッジを追加、用語`visualization-layers`を追加。shared/collector変更なし(frontendのみ)。Playwrightで実画面のレイヤー切り替えを確認済み | [2026-07-12](worklog/issue-299.md) |
