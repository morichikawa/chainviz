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

#### 実装記録（collector、2026-07-10）

- 担当: collector
- ブランチ: `issue-229-investigate-backfill-stall`（同ブランチで継続）
- 内容: PROTO-CMD-01（`packages/e2e/src/commands.test.ts`）の合格条件を、
  「既存ノードの head への完全追従」から「開始高さから一定ブロック数以上、
  停滞なく進行すること」に変更した。

対応した変更:

1. `packages/e2e/src/helpers/catch-up.ts` に以下を追加した（既存の
   `waitForBlockCatchUp` / `CatchUpMonitor` / `catchUpTimeoutMs` は変更せず
   そのまま利用する形にした）。
   - `resolveCatchUpTarget({ startHeight, headHeight, minProgressBlocks })`:
     目標高さを `min(headHeight, startHeight + minProgressBlocks)` で決める
     純粋関数。head までの距離が `minProgressBlocks` 以上ある場合は目標が
     head から独立した固定値になり、稼働時間（＝head までの距離）に
     テスト所要時間が比例しなくなる。head までの距離がそれ未満の場合は
     従来どおり head 到達にフォールバックする。
   - `waitForMinBlockProgress(getHeight, { minProgressBlocks, headHeight, ... })`:
     `resolveCatchUpTarget` で目標を決めたうえで既存の
     `waitForBlockCatchUp` を呼ぶラッパー。停止検出（stallTimeoutMs、既定
     45 秒）は `waitForBlockCatchUp` のロジックをそのまま使うため変更なし。
   - `waitForBlockCatchUp` の `WaitForCatchUpOptions` に `startHeight?: number`
     を追加し、`waitForMinBlockProgress` が目標算出用に測った高さを
     内部で再利用（RPC の二重呼び出しを避ける）できるようにした。
2. `packages/e2e/src/commands.test.ts` の PROTO-CMD-01 を
   `waitForBlockCatchUp` から `waitForMinBlockProgress` に切り替え、
   `MIN_PROGRESS_BLOCKS = 300` を新設した。この値が成立する前提
   （CLAUDE.md の運用ルールにより、固定値を導入する場合はコード上の
   コメントと本ファイルの両方に明記する）:
   - 想定バックフィル速度は保守的に 5 ブロック/秒
     （`waitForMinBlockProgress` の既定 `ratePerSec`）。300 ブロックなら
     動的タイムアウトは `30_000ms + 300/5*1000 = 60_000ms` →
     下限 `120_000ms`（2分）に丸められ、vitest の it タイムアウト
     （`CATCH_UP_TEST_TIMEOUT_MS = 600_000ms`）を大きく下回る。
   - EL 間 P2P（履歴バックフィル）の回帰（#44/#46）が起きた場合、追加
     ノードの高さは低い値のまま完全に停止するため、300 ブロックに到達
     するまで待つ前に stall 検出（既定 45 秒）で先に失敗する。したがって
     `MIN_PROGRESS_BLOCKS` の大小は回帰の検出力そのものには影響しない。
   - レビュー留意点1（既存前提「チェーンが十分進んでいないと EL 間 P2P
     無しでも追従してしまう」を新しい合格条件でも成立させる）は、
     `resolveCatchUpTarget` が head までの距離不足時に目標を head へ
     フォールバックする形で維持した。この場合は EL 間 P2P の回帰を確実に
     検出できる保証がない点も既存コメントのまま引き継いでいる（新しい
     制約ではなく、従来の「head 到達」方式でも同じ理由で成立しなかった
     既存の限界）。
3. ユニットテストは既存の `catch-up.unit.test.ts`（`waitForBlockCatchUp`
   本体の関心事）を変更せず、新しいロジック専用に
   `packages/e2e/src/helpers/catch-up-min-progress.unit.test.ts` を新規
   作成した（CLAUDE.md のテストファイル分割の原則に従い、関心事ごとに
   ファイルを分けた）。`resolveCatchUpTarget` の境界値（head までの距離が
   ちょうど `minProgressBlocks` の場合など）と、`waitForMinBlockProgress`
   が「head が遠くても固定進行量で完了する」「head が近ければ head
   到達で完了する」「stall した場合は目標に関係なく速やかに失敗する」
   ことを検証している。

再現確認（修正前後の両方を実際にコードを動かして確認）:

- detective が実測した数値（`docs/worklog/issue-229.md` 冒頭参照:
  start height ≈95、head/target 9285、追いつき速度 ≈10 ブロック/秒、
  一度も stall せず）を模した合成クロック・合成 `getHeight` を作り、
  修正前の `waitForBlockCatchUp(getHeight, 9285, { maxTimeoutMs: 540_000
  既定 })` と修正後の `waitForMinBlockProgress(getHeight, { minProgressBlocks:
  300, headHeight: 9285 })` を実際に実行して比較した（一時的な
  `*.unit.test.ts` を作って `pnpm vitest run` で実行し、確認後に削除。
  リポジトリには残していない）。
  - 修正前: 540,000ms で全体タイムアウトに達し
    `全体タイムアウト 540000ms 超過 (高さ 5495 / ターゲット 9285, 経過
    540000ms)` で失敗。detective の実測失敗
    （`高さ 5439 / ターゲット 9285, 経過 541011ms`）とほぼ一致し、
    修正前の状態が実際に長時間稼働スタック相当のデータで失敗することを
    確認した。
  - 修正後: 30,000ms で完了し、結果は 395（= 開始高さ 95 + 300）。
    head（9285）まで待たずに、固定の進行量で完了することを確認した。
  - 実際の docker スタック（作業時点で稼働中だったものは起動17分程度で
    「長時間稼働」再現には短すぎた）を数時間稼働させての再現は本タスクの
    時間内では行っていない。CLAUDE.md の運用ルールが明示的に許容する
    「chainviz-detective が残したログ・実測データを参考に妥当性を判断
    する」代替手段として、上記の実測値ベースの再現で妥当性を確認した。
  - 回帰検出力の維持については、`catch-up-min-progress.unit.test.ts` の
    「高さが停止したままだと、目標に関わらず stall 検出で速やかに失敗
    する」テストで、`headHeight: 9285`（実際のギャップに近い値）を
    指定しても高さが 0 のまま動かない場合は 45 秒程度で失敗することを
    確認した。実際に docker 上で EL 間 P2P のフラグを外して再現する
    実機検証は行っていない（既存コメントに「reth-node.sh の該当フラグを
    外して実際に失敗することを確認済み」とあるとおり、この検証済みの
    事実自体は本変更で変えていないロジック（stall 検出）に依存して
    いるため、成立は維持されると判断した）。

品質ゲート: `pnpm build` / `pnpm lint` / `pnpm test`（e2e パッケージ
84件・monorepo 全体 2886件）すべて通過。

次の担当者への注意点:

- `MIN_PROGRESS_BLOCKS`（300）や `ratePerSec`（既定 5）を変更する場合は、
  上記の前提（動的タイムアウトが vitest の it タイムアウトを大きく
  下回ること）を保てるか確認すること。
- 副次的問題（dev collector 稼働中に `pnpm test:e2e` が起動できない件）は
  このタスクの範囲外。既に Issue #254 として起票済み（今回新規の起票は
  行っていない）。

#### テスト強化記録（tester、2026-07-11）

- 担当: tester（テスト強化）
- ブランチ: `issue-229-investigate-backfill-stall`（同ブランチで継続）
- 内容: 実装担当が追加した `resolveCatchUpTarget` / `waitForMinBlockProgress`
  の基本テスト（`catch-up-min-progress.unit.test.ts`、正常系中心）に対し、
  異常系・境界値・退化ケースの観点でテストを追加した。実装は変更していない。

追加したテストファイル: `packages/e2e/src/helpers/catch-up-min-progress.edge.unit.test.ts`
（新規、13 ケース）。既存の正常系ファイルは関心事を分けるため触らず、
退化・異常入力・回帰検出力に絞った別ファイルとして作成した（CLAUDE.md の
テストファイル分割の原則）。`pnpm test` が拾う命名にするため
`*.edge.unit.test.ts` とした（`vitest.unit.config.ts` の include は
`src/**/*.unit.test.ts`）。

追加した観点:

1. `resolveCatchUpTarget` の退化・異常入力:
   - `headHeight < startHeight`（異常観測）で target が headHeight に丸められる
   - `headHeight === startHeight` で target = startHeight（進行量ゼロ）
   - `minProgressBlocks === 0` で target = min(headHeight, startHeight)
   - `minProgressBlocks` が負で target が startHeight を下回る
   - `minProgressBlocks` が巨大でも target は headHeight で頭打ち
   - `startHeight + minProgressBlocks` がちょうど headHeight に一致（startHeight
     が 0 でない境界）
2. `waitForMinBlockProgress` で target <= startHeight になる退化ケースの特性化:
   `minProgressBlocks` が 0/負、または `headHeight <= startHeight` のとき、
   初回観測で即座に到達扱いになり、高さが完全停止していても停止検出が
   働かず即時成功してしまうことを明文化した（実運用の
   `MIN_PROGRESS_BLOCKS=300` では起きないが、値が退化すると回帰検出力を
   失うという前提の可視化）。
3. 停止検出（#44/#46 相当の回帰）の検出力を、既存テストの「高さ 0 固定」
   以外の現実的な停止パターンでも確認:
   - 非ゼロ高さで完全固定（head をオプティミスティックに渡されるが履歴を
     埋められない状態）
   - 途中まで進んでから凍結（部分バックフィル後に停止。停止判定が
     「最大高さの非更新時間」で行われることの裏取り）
   - head フォールバック時（head が近い）でも高さ 0 固定なら停止検出が働く
4. RPC が最後まで到達不能な場合に、ハングせず全体タイムアウト
   （`RPC 到達不能`）で失敗すること。

品質ゲート: `packages/e2e` で `pnpm build`（tsc --noEmit）通過、
`pnpm test`（ユニット 97 件、うち新規 13 件）全通過。

次の担当者への申し送り（実装のバグではないが留意点）:

- `resolveCatchUpTarget` は `Math.min(headHeight, startHeight + minProgressBlocks)`
  であり、`minProgressBlocks <= 0` や `headHeight <= startHeight` のとき
  target が startHeight 以下になる。この状態で `waitForMinBlockProgress` を
  呼ぶと初回観測で即時成功し、停止検出（回帰検出）が一切働かない。現状の
  `MIN_PROGRESS_BLOCKS=300`・正常な head 観測では問題ないが、値を変える／
  head 観測が不安定になる場合は「進行を全く検証しないまま合格」する
  フットガンがあることを 2. のテストで特性化してある。差し戻すほどの
  不具合ではないと判断したため実装は変更していない。

#### レビュー記録（chainviz-reviewer、2026-07-11、実装・テスト強化分）

- 対象: コミット `ec97931`（ヘルパー追加）/ `d724122`（PROTO-CMD-01 変更）/
  `da6a79e`（docs）/ `3352e38`（テスト強化）
- 判定: **合格**

確認した内容:

1. **根本原因への対処**: 目標高さを `min(headHeight, startHeight +
   minProgressBlocks)` にしたことで、動的タイムアウト算出の gap が常に
   300 以下に有界化され（下限 120 秒に丸まる）、テスト所要時間が稼働時間
   から構造的に独立した。`maxTimeoutMs=540_000` が動的算出を無効化する
   矛盾も「gap が有界になった」ことで実質解消。タイムアウトを延ばすだけの
   表面的な回避ではない
2. **固定値の前提の明記**: `MIN_PROGRESS_BLOCKS=300` の成立前提
   （保守的レート 5 ブロック/秒で動的タイムアウトが it タイムアウトを
   大きく下回ること、回帰時は stall 検出が先に効くため値の大小が検出力に
   影響しないこと、head フォールバック時の既存の限界）は
   `commands.test.ts` 冒頭コメントと本 worklog の両方に明記されており、
   CLAUDE.md の運用ルールを満たす。`CATCH_UP_TEST_TIMEOUT_MS=600_000` も
   内側のタイムアウトが有界化されたことで純粋な安全網になった
3. **tester 申し送りのフットガン**（`minProgressBlocks<=0` や
   `headHeight<=startHeight` で進行検証なしに即成功）: 唯一の呼び出し元は
   定数 300 を渡し、`headHeight > 0` を事前に expect で確認済み、追加直後の
   ノードの開始高さは head より十分低い。退化挙動は edge テストで特性化
   されている。「差し戻すほどではない」判断は妥当
4. **既存ロジックとの整合**: `waitForBlockCatchUp` / `CatchUpMonitor` /
   `catchUpTimeoutMs` は無変更（`WaitForCatchUpOptions` への optional
   `startHeight` 追加のみで後方互換）。既存 `catch-up.unit.test.ts` は
   無変更のまま通過。`waitForBlockCatchUp` の直接呼び出しは PROTO-CMD-01
   以外に存在せず、他テストへの影響なし
5. **テストの質**: 正常系・境界（ちょうど一致）・退化入力・停止パターン
   3 種（非ゼロ固定、進行後凍結、head フォールバック時）・RPC 到達不能を
   カバー。合成クロックで実時間に依存せず、結果値と経過時間（stall なら
   45 秒前後、固定進行なら head 到達所要時間より大幅に短い）という外形で
   検証しており、実装詳細の写経になっていない
6. **品質ゲート**: `pnpm build` / `pnpm lint` / `pnpm test`
   （shared 59・e2e 97・collector 1137・frontend 1606 = 計 2899 件）全通過
7. **コミット粒度**: ヘルパー追加（feat）→ テスト変更（fix）→ docs →
   テスト強化（test）の 4 コミットで、1 変更 1 コミット・Conventional
   Commits に準拠

指摘（いずれも非ブロッキング）:

- `docs/WORKLOG.md` の #229 索引行が調査時点の「コード修正なし」のまま
  実装後に更新されていなかった → レビュー時に更新した（別コミット）
- 分岐後に main が進んでおり、マージ時に `docs/WORKLOG.md`（索引末尾への
  追記同士）が競合する（`git merge-tree` で確認済み。両方の行を残せば
  よい。`docs/PLAN.md` は auto-merge 可能）。統括はマージ時に解消すること
- `waitForMinBlockProgress` 内の startHeight 測定の `catch` → 0 フォール
  バックに理由コメントが無い（`waitForBlockCatchUp` 側の同パターンには
  ある）。失敗を成功にすり替えるものではなく（0 フォールバックは gap を
  大きく見積もる安全側で、RPC 不達が続けばタイムアウト時に lastError が
  表出する）、挙動は edge テストで文書化済みのため差し戻しはしないが、
  次にこのファイルを触る際に一言コメントを足すことを推奨する
- 残存リスク: Issue 報告の「高さ 0 のまま 46 秒 stall」（起動レイテンシ
  仮説）は未再現のため今回は対応していない（detective の任意項目 2）。
  `CatchUpMonitor` は RPC 到達不能の時間を stall に数えないため、再発する
  のは「RPC が応答を返し始めた後に高さが 45 秒凍結する」場合のみ。再発
  したら別途対応する
