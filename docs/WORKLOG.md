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
| - | 特定Issueに紐付かない記録(PLAN.md/CLAUDE.md更新等) | [2026-07-05〜2026-07-06](worklog/meta.md) |
