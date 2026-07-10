### 2026-07-10 Issue #229 PROTO-CMD-01 が長時間稼働スタックで失敗する件（調査記録）

- 担当: detective（原因究明）
- ブランチ: issue-229-investigate-backfill-stall
- 内容: 原因調査のみ（コード修正なし）。結論は「EL 間 P2P バックフィルの
  回帰ではない。追加ノードの追いつき所要時間がチェーン長（＝スタック
  稼働時間）に比例して伸びるのに対し、テスト側の時間予算に固定上限
  （540 秒）があるため、稼働約3時間を超えたスタックでは構造的に失敗する」。

#### 再現した症状（実測）

約5時間稼働・ブロック高 9285 の `chainviz-ethereum` スタックに対し、
worktree 上で `pnpm vitest run src/commands.test.ts`（PROTO-CMD-01 を含む）
を実行した。

- 失敗した。ただし Issue 本文の「stall（高さ 0 のまま 46 秒停止）」では
  なく、**全体タイムアウト**として失敗:
  `added reth to reach block height 9285: 全体タイムアウト 540000ms 超過
  (高さ 5439 / ターゲット 9285, 経過 541011ms)`
- 追加された reth（reth4）の高さを 2 秒間隔で外部から観測した結果:
  - コンテナ起動から約 2 秒後（20:51:01）には高さ 95 に到達し、以降
    テスト終了（20:59:57、高さ 5439 = 0x153f）まで**一度も停滞せず**進行。
    高さが更新されない最長の間隔は **5 秒**（stall 閾値 45 秒に遠く及ばない）
  - 追いつき速度は (5439−95)/536s ≒ **10.0 ブロック/秒** でほぼ一定
  - `net_peerCount` は全期間 0x1（boot の reth1 と接続済み）で、EL 間 P2P
    接続は正常
- 追加された beacon（beacon4）のログ・API 観測:
  - 起動 1.5 秒後に `Sync state updated old_state: Stalled,
    new_state: Syncing Finalized Chain` で CL 同期を開始
  - `Syncing peers: "1", distance: "8675 slots", speed: "8.00〜12.00
    slots/sec", est_time: "12〜18 mins"` — **CL の genesis からの
    forward sync が律速**で、完了見込みが最初から 12 分超だった
  - reth4 のログは `Received forkchoice updated message when syncing` の
    連続で、reth の高さは対の lighthouse の同期進行（約 3.2 秒ごとに
    1 epoch = 32 ブロック）にちょうど追随して進む

#### 検証した仮説と結果

1. **EL 間 P2P バックフィルが開始しない／機能しない（#44/#46 の回帰）**
   → **棄却**。追加 reth は起動直後から reth1 と P2P 接続し（peerCount=1）、
   高さは即座に・連続的に進行した。ブロックの取得自体は機能している。
2. **バックフィルは機能するが所要時間がテストの時間予算を超える**
   → **支持（根本原因）**。追いつきの実効速度は lighthouse（追加 beacon）の
   genesis からの forward sync 速度（実測 8〜12 slot/秒 ≒ 10 ブロック/秒）に
   律速される。reth は CL がオプティミスティックに進める head までしか
   進めないため、EL 間 P2P があっても CL 同期より速くは追いつけない。
   一方チェーンはスロット 2 秒で伸び続けるので、
   **追いつき所要時間 ≒ 進行済みブロック数 ÷ 10 ≒ 稼働秒数 ÷ 20**。
   - 稼働 3 時間（約 5400 ブロック）→ 約 9 分
   - 稼働 5 時間（約 9300 ブロック）→ 約 15.5 分
   これに対しテスト側の予算は `waitForBlockCatchUp` の
   `maxTimeoutMs = 540_000`（9 分）と vitest の
   `CATCH_UP_TEST_TIMEOUT_MS = 600_000`（10 分）。
   `catchUpTimeoutMs` は gap から動的に（保守的な 5 ブロック/秒で）全体
   タイムアウトを算出する設計（gap 9285 なら約 31 分）だが、直後に
   `maxTimeoutMs` の固定上限 540 秒で頭打ちにしており、**動的算出の意図が
   長いチェーンでは上限に食われて無効化されている**。稼働約 2.8 時間
   （高さ約 5000）を超えると構造的に必ず失敗する。Issue 報告の「3 時間・
   高さ約 6000 で失敗」と整合する。

#### Issue 報告の「高さ 0 のまま 46 秒 stall」との差異について

今回の実測では stall は一度も観測されず、失敗モードは全体タイムアウト
だった。報告された stall-at-0 は未再現。証拠不足のため断定はしないが、
最有力の説明は「追加 beacon の CL ピア接続〜最初のバッチ replay 開始までの
起動レイテンシが、フルスイート実行の高負荷下で 45 秒（stallTimeoutMs）を
超えた」という起動時のばらつき。今回の観測では起動→最初の高さ進行が
約 2 秒だったが、これが 45 秒を超えれば同じ根本原因が stall として現れる。
なお、仮に stall 判定を免れても上記の時間予算不足で結局失敗する状況
だったため、対応方針はどちらのモードでも変わらない。

補足: 追加 beacon の discv5 が boot ENR を `ENR banned by table filter`
と弾くログを観測した（接続自体は `--boot-nodes` の直接 dial で成立して
おり実害は未確認）。CL ピアが唯一この 1 本の接続に依存しているため、
この dial が失敗した場合に追加ノードが永久に同期を開始できない可能性は
残る（stall-at-0 の別候補。今回は検証環境を失ったため未検証）。

#### 調査中に判明した副次的な事実

- **dev collector 稼働中は `pnpm test:e2e` が起動できない**:
  e2e ハーネス（`packages/e2e/src/helpers/collector.ts` の
  `startCollector`）は `CHAINVIZ_COLLECTOR_PORT=4123` は渡すが
  `CHAINVIZ_PROXY_PORT` を渡さないため、子 collector が WS(4123) の
  listen 後にロギングプロキシ(4001)で dev collector と EADDRINUSE 衝突
  して即死し、テストは `connect ECONNREFUSED 127.0.0.1:4123` で落ちる。
  「listening on port 4123」ログ出力後に落ちるため、起動判定
  （`detectLaunchStatus`）もすり抜ける。別 Issue として起票する価値がある。
  （今回の調査では `CHAINVIZ_PROXY_PORT=4124` を付与して回避した）
- 今回のテスト実行の 2 件目の失敗（removeNode 拒否テストで reth1 が
  観測に無い）は、テスト終盤（20:59:57）に別プロセス（メイン作業
  ディレクトリ `/home/zoe/workspace/chainviz` からの docker compose
  操作）がスタックを再作成したことによる巻き添えで、テスト自体の
  不具合ではない。1 件目の計測はスタック再作成前に完了しており有効。

#### 次にどうすべきか（対応方針の提案。実装は本タスクの範囲外）

対象は主に **packages/e2e**（テスト側の前提の見直し）。必要なら
**profiles（node-env）** の改善も選択肢になる。

1. e2e 側（推奨・必須）: PROTO-CMD-01 の検証目標を「現在の head への完全
   追いつき」から、#44/#46 の回帰（高さ 0 のまま進まない）を検出できる
   最小の目標に見直す。例えば「開始高さから一定ブロック数（数百程度）
   以上、停滞なく進行すること」を合格条件にすれば、検証したい回帰は
   捕まえつつ実行時間がチェーン長に依存しなくなる。stall 検知
   （45 秒）は現状どおり残してよい。完全追いつきまで検証したい場合は
   `maxTimeoutMs` の固定上限と `catchUpTimeoutMs` の動的算出が矛盾して
   いる点の解消が必要（CLAUDE.md「観測できる状態に依存した固定値」の
   典型例）だが、その場合テスト実行時間が稼働時間に比例して伸びる
   ことは避けられない。
2. 起動レイテンシ由来の stall 誤検知対策（任意）: 「最初の進捗が観測
   されるまで」は stallTimeoutMs より長い猶予を認める（CL ピア接続＋
   初回バッチ replay の起動ばらつき吸収）。
3. node-env 側（任意・製品改善）: addNode で追加する beacon を
   `--checkpoint-sync-url http://<beacon1>:5052` でチェックポイント同期に
   すれば、CL の genesis からの replay が不要になり、追加ノードの
   追いつき時間がチェーン長に比例する現状そのもの（アプリの UX としても
   稼働時間に比例して addNode が遅くなる）を改善できる可能性がある。
   ただし reth 側の履歴バックフィル挙動を含めた実機検証が必要。
4. ハーネスのポート衝突（別 Issue 推奨）: `startCollector` に
   `CHAINVIZ_PROXY_PORT` も渡す（e2e）。

#### 観測に使った主なコマンド

- 追加 reth の高さ・ピア数: 2 秒間隔で `eth_blockNumber` / `net_peerCount`
  をコンテナ IP へ直接 curl
- 追加 beacon: `docker logs` と `/eth/v1/node/syncing` / `/eth/v1/node/peers`
- スタック再作成の検知: `docker ps -a`（CreatedAt）、コンテナの
  `com.docker.compose.project.working_dir` ラベル

#### レビュー記録（chainviz-reviewer、2026-07-10）

- 対象: ブランチ `issue-229-investigate-backfill-stall`（コミット 9510986、
  docs のみの変更 1 コミット。差分は本ファイル新規と `docs/WORKLOG.md`
  索引 1 行のみ）
- 判定: **合格**

確認した内容:

- **`maxTimeoutMs` が動的タイムアウトを無効化するという主張の裏取り**:
  `packages/e2e/src/helpers/catch-up.ts` を確認。`waitForBlockCatchUp` は
  既定 `maxTimeoutMs = 540_000`（142 行目）を持ち、158 行目で
  `overallTimeoutMs = Math.min(maxTimeoutMs, catchUpTimeoutMs({...}))` と
  しているため、gap が大きい場合に動的算出（gap 9285・rate 5 なら約 31.4 分）
  が固定上限 9 分で頭打ちになる。記述どおり。呼び出し側
  （`packages/e2e/src/commands.test.ts`）も `maxTimeoutMs` を上書きして
  おらず、vitest 側の `CATCH_UP_TEST_TIMEOUT_MS = 600_000` も記載どおり
- **数値の検算**: 追いつき実測 (5439−95)/536s ≒ 10.0 ブロック/秒、
  「稼働約 2.8 時間で構造的に失敗」（540s × 実効閉差速度 9.5 ブロック/秒
  ≒ gap 5130 ≒ 稼働 2.85 時間）、いずれも整合。Issue 報告の
  「3 時間・高さ約 6000 で失敗」とも矛盾しない
- **推奨対応が #44/#46 の回帰検出力を保つか**: EL 間 P2P が壊れた場合、
  追加ノードは CL からオプティミスティックに head を渡されるだけで履歴を
  バックフィルできず高さが停滞する（`commands.test.ts` のコメントに
  「reth-node.sh の該当フラグを外して実際に失敗することを確認済み」とある
  失敗モード）。推奨案は stall 検知（45 秒）を残す前提なので、この停滞は
  「数百ブロック進行」条件の待機中に stall として検出される。回帰検出力は
  維持されると判断。ただし既存コメントにある前提「チェーンが十分進んで
  いないと EL P2P 無しでも追従してしまう」は新しい合格条件でも変わらず
  必要なので、実装時にこの前提の扱い（前提チェックかコメント明記か）を
  引き継ぐこと。また「数百ブロック」という固定値を導入する際は、
  CLAUDE.md のルールに従い成立前提をコードコメントと worklog の両方に
  明記すること
- **副次的問題（dev collector 稼働中に e2e が起動不能）の裏取り**:
  `packages/e2e/src/helpers/collector.ts` の `startCollector` は
  `CHAINVIZ_COLLECTOR_PORT` のみ渡し `CHAINVIZ_PROXY_PORT` を渡さない。
  collector の `main()`（`packages/collector/src/index.ts`）は WS listen
  成功ログ（起動判定 `detectLaunchStatus` が見る文字列）を出した**後**に
  `startLoggingProxy(resolveProxyPort(), ...)` で 4001 を listen するため、
  「listening ログ出力後に EADDRINUSE で即死し起動判定をすり抜ける」という
  記述は実装と整合する。別 Issue 化の推奨は妥当
- **品質ゲート**: `pnpm lint` / `pnpm build` / `pnpm test`（1606 件）
  すべて通過
- **コミット粒度**: 1 コミット（調査記録の追記）で適切。ブランチの
  分岐点が main の最新より 1 コミット古い（`ab74f61` を含まない）が、
  差分は docs のみなのでマージに支障なし
