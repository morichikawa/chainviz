# Issue #185 作業記録

### 2026-07-08 Issue #185 rethメトリクスの周期ポーリング・パース(collector)

- 担当: collector
- ブランチ: issue-185-metrics-poll-parse

#### 設計メモ(実装前)

`docs/ARCHITECTURE.md` §7.2〜§7.3 の決定事項に従う。本Issueのスコープは
「取得・パース」のみで、`NodeEntity.internals` への反映・`nodeLinkActivity`
の配信・`drivesNodeId` の解決は Issue #186 で行う(このIssueでは
`EthereumAdapter.subscribeNodeInternals` の実装・配線は行わない)。

##### 実環境での実測結果(実装前に確認)

独立した合成環境(`profiles/ethereum` を `docker compose up` して起動。
本物の稼働中スタックには触れていない)で reth1/reth2 の
`http://<コンテナIP>:9001/metrics` を実際に `curl` して確認した。

- **同期ステージ**: `reth_sync_checkpoint{stage="Headers"} <block>` のような
  ゲージが、`docs/ARCHITECTURE.md` §7.6.7 の表に載っている11ステージに加え
  `MerkleUnwind` / `Prune` / `PruneSenderRecovery` / `Era` を含む計15種類で
  観測できた。
  - **重要な発見**: `reth_sync_checkpoint{stage=...}` が `/metrics` レスポンス
    中に現れる**順序は、スクレイプのたびに変わる**(同一プロセスに対して
    数秒間隔で2回 `curl` しただけで順序が入れ替わることを実機で確認済み。
    reth 内部の HashMap 相当のイテレーション順とみられ、決定的なパイプライン
    実行順ではない)。`docs/ARCHITECTURE.md` §7.6.5 は「`syncStages` の配列順
    (クライアントが公開するステージ順 = パイプラインの実行順)で全件を
    1行ずつ出す」というフロント側の表示方針を前提にしているが、**生の
    メトリクステキストの出現順にはその意味が無い**ことが判明した。このため
    collector側で既知のパイプライン順(§7.6.7の表の11ステージ)に基づいて
    ソートし、表に無い未知のステージ名はアルファベット順で末尾に追加する
    ことで、`syncStages` 配列の順序そのものに意味を持たせることにした
    (詳細は `reth-metrics.ts` のコメント参照)。フロント実装(#186 以降)は
    「collectorが返す配列順=パイプライン順(の近似)」を前提にしてよいが、
    生テキストの出現順に依存する設計にしないよう申し送る。
  - もう1点、§7.2 が実測確認を求めていた「`reth_sync_checkpoint` が
    追従運転中(Engine API駆動)にも進むか」について、稼働中の reth1
    (バックフィル対象ではなく通常運転中)で `Finish` の checkpoint が
    約10秒間に 21 → 27 と進むことを確認した。つまり**通常運転中(EngineAPI
    駆動)にも `reth_sync_checkpoint` は進む**。§7.3 の
    `syncStatus`/`blockHeight` の情報源選定(Issue #187)に使える実測結果
    として申し送る。
- **txpool**: `reth_transaction_pool_pending_pool_transactions`(ゲージ)が
  pending、`reth_transaction_pool_queued_pool_transactions`(ゲージ)が
  queued に対応することを確認した(ARCHITECTURE.md の候補どおり)。
- **Engine API呼び出し**: 当初 ARCHITECTURE.md が候補に挙げていた
  `engine_newPayload*` / `engine_forkchoiceUpdated*` という名前の直接の
  メトリクスは存在しない。代わりに以下の2系統が見つかった:
  1. `reth_consensus_engine_beacon_new_payload_messages` /
     `reth_consensus_engine_beacon_forkchoice_updated_messages`
     (counter。バージョン非区別の集計値)
  2. `reth_engine_rpc_<method>_v<N>`(`summary` 型。例:
     `reth_engine_rpc_new_payload_v4` / `reth_engine_rpc_fork_choice_updated_v3` /
     `reth_engine_rpc_get_payload_v4` など)。`summary` は Prometheus の
     慣例どおり `<name>_count`(呼び出し回数の累積値)と `<name>_sum`
     (所要時間の累積合計、秒)のペアを伴う。**この `# HELP` コメント文に
     `Latency for \`engine_newPayloadV4\`` のように実際のバージョン付き
     JSON-RPC メソッド名がバッククォートで埋め込まれている**ことを確認した。
  → ARCHITECTURE.md §7.2 が明記する「バージョン付きメソッド名
  `engine_newPayloadV4` 等は生の値のまま載せ」という設計にそのまま合致するのは
  (2)のほうなので、こちらを採用する。HELPコメントからバッククォート内の
  `engine_...` を抽出してそのまま `InternalCallStats.method` に使う(方式(1)は
  バージョンを区別できず、方式(2)と重複計上になるため使わない)。
  `_count` を呼び出し回数の累積カウンタ、`_sum` を所要時間の累積秒として扱い、
  差分(前回スクレイプとの差)から `count` と `latencyMs`(区間平均)を求める。
  `reth_engine_rpc_*` のうち `_v<N>` 命名でない・HELPからメソッド名を抽出
  できないもの(例: blob関連の一部)は対象外として読み捨てる。

##### 実装方針

1ファイルが大きくならないよう、関心ごとに以下のファイルへ分割する
(`packages/collector/src/adapters/ethereum/` 配下)。

- `prom-text-parser.ts`: Prometheus テキスト形式の**汎用**パーサー。
  `# HELP` / `# TYPE` コメントとサンプル行(ラベル付き/無し、`+Inf`/`-Inf`/
  `NaN` を含む)を読み、`{ samples: Map<metric名, {labels, value}[]>, help:
  Map<family名, help文字列>, type: Map<family名, type文字列> }` を返す。
  reth/Ethereum固有の語彙は一切持たない(他チェーンのPrometheus出力にも
  転用できる)。
- `reth-metrics.ts`: reth固有の解釈ロジック(純粋関数)。`ParsedMetrics` を
  受け取り、`syncStages`(§7.6.7の順で並べ替え済み)・`mempool`・
  `engineCalls`(累積値のRawEngineCallCounter[])を返す。ここまでは状態を
  持たない(同じ入力に対し常に同じ出力)。
- `reth-metrics-tracker.ts`: 状態を持つ差分計算(`RethMetricsTracker`)。
  ノードID×メソッド名ごとに前回の累積値を保持し、今回値との差分を
  `InternalCallStats[]` として返す。差分が負(カウンタリセット。ノード
  再起動を意味する)の場合は増分=現在値として扱う(§7.2の決定どおり)。
  初回観測(そのノード×メソッドの前回値が無い)はベースラインの記録のみ
  行い、何も出力しない(collector起動時点で既にノードが稼働していた場合に
  「起動からの累積値」を「この1回のスクレイプ間隔の増分」として誤配信
  しないため。通常のPrometheusカウンタのレート変換と同じ考え方)。
- `reth-metrics-client.ts`: HTTPで生テキストを取得するIOの境界
  (`RethMetricsClient.getText(url)`)。`http-client.ts` の `HttpClient`
  (JSON専用)とは別インターフェースにする。理由: `HttpClient` は複数の
  既存テスト(`beacon-api.test.ts` 等)がオブジェクトリテラルで
  `HttpClient` 型を満たしており、`getJson` 以外のメソッドを追加すると
  それらの型を全て書き換える必要が生じ、本Issueと無関係な差分が広がる
  ため。既存の `docker/dockerode-client.ts` / `eth-rpc-client.ts` と同じ
  「IO境界ごとに専用インターフェースを切る」流儀に合わせた。ここに
  `EXECUTION_METRICS_PORT = 9001` を定義する(`beacon-api.ts` が
  `BEACON_API_PORT` を持つのと同じ配置。`targets.ts` がこれを import して
  対象列挙に使う)。
- `reth-node-internals.ts`: 上記を束ねるオーケストレーション層。ノード1件分
  について「取得→パース→解釈→差分計算」を1回実行し、
  `{ internals?: NodeInternals; calls: InternalCallStats[] }` を返す
  (`internals` は `syncStages`/`mempool` の両方が無ければ省略)。取得・
  パースに失敗した場合は具体的なエラー内容をログに残して `undefined` を
  返す(縮退動作。呼び出し側=#186はこのノードの今回分の観測をスキップ
  する)。ここで `NODE_INTERNALS_POLL_INTERVAL_MS = 3000` を定義する
  (実際の `setInterval` ループの配線は#186が行うが、値の根拠は本Issueの
  スコープなのでここに置く)。
  - **この定数値の前提条件**(CLAUDE.md「今この瞬間に観測できる状態に
    依存した固定値を埋め込まない」への対応): この 3000ms は
    `PEER_POLL_INTERVAL_MS` / `WALLET_POLL_INTERVAL_MS` と同じ「チェーンの
    進行状態に依存しないサンプリング周期」であり、チェーンが長時間稼働
    してブロック高やカウンタの絶対値が増えても壊れない(§7.2の設計どおり、
    増分ベースの観測なので絶対値の大小に依存しない)。前提となるのは
    「genesisのslot time(既定2秒)に対してスクレイプ間隔3秒が同程度の
    オーダーであること」で、slot timeを大きく変更する場合はこの値も
    見直しが必要(`docs/ARCHITECTURE.md` §7.2 に明記済みの前提をそのまま
    引き継ぐ)。
- `targets.ts` に `ExecutionMetricsTarget`(`{ stableId, metricsUrl }`)と
  `executionMetricsTargets(observations)` を追加する。既存の
  `executionRpcUrls` / `executionPeerTargets` と同じ選別基準(EL クライアント
  かつ IP 取得済み)。

##### 縮退動作の方針

- `syncStages`: `reth_sync_checkpoint` のサンプルが1つも無ければ空配列を
  返す(呼び出し側で「フィールド省略」に変換)。
- `mempool`: pending/queued のどちらか一方でも欠けていれば `undefined`
  (中途半端な値を返さない)。
- `engineCalls`: `_count` が読めないメソッドは個別に読み捨てる(ログは
  出さない。将来 reth が blob 系等の summary を増やしても壊れないための
  想定内の読み捨てであり、エラーではないため)。
- **完全な取得・パース失敗**(HTTP到達不能・タイムアウト・レスポンスが
  Prometheusテキストとして解釈できない等)は、対象の `stableId` と実際の
  エラー内容を `console.error` でログしたうえで `undefined` を返す
  (CLAUDE.md「エラーを握りつぶすコードを見逃さない」への対応。汎用文言に
  すり替えない)。

#### 実装

設計メモどおり、`packages/collector/src/adapters/ethereum/` 配下に以下の
ファイルを追加した。既存の `EthereumAdapter.subscribeNodeInternals` の実装・
配線、`NodeEntity.internals` へのworld-state反映、`drivesNodeId` の解決は
本Issueでは行っていない（Issue #186のスコープ）。

- `prom-text-parser.ts`: Prometheus テキスト形式の汎用パーサー
  (`parsePrometheusText`)。`# HELP` / `# TYPE` コメントとサンプル行
  （ラベル付き/無し、`+Inf`/`-Inf`/`NaN`、クォート内エスケープ）を読む。
  1行の不正で全体を諦めず、その行だけ読み捨てて継続する。値トークンは
  10進数の正規表現に一致する場合のみ数値化し、一致しない場合は当該サンプルを
  読み捨てる(`NaN` という正規のトークン自体は「値が読めなかった」場合と
  区別して保持する)。
- `reth-metrics.ts`: reth固有の解釈ロジック(純粋関数)。
  - `parseSyncStages`: `reth_sync_checkpoint{stage=...}` を読み、既知の
    パイプライン順(§7.6.7の表の11ステージ)で並べ替え、未知のステージ名は
    アルファベット順で末尾に追加する。
  - `parseMempool`: pending/queuedのどちらか一方でも欠けていれば undefined。
  - `parseEngineCallCounters`: `reth_engine_rpc_*`(summary型)のうち、
    HELPコメントからバッククォート付き`engine_...`メソッド名を抽出できた
    ものだけを対象に、`_count`/`_sum`の累積値を返す。
- `reth-metrics-tracker.ts`: `RethMetricsTracker`(状態を持つ差分計算)。
  ノードID×メソッド名ごとに前回の累積値を保持し、`InternalCallStats[]`を
  返す。初回観測はベースラインのみ記録し出力しない。カウンタリセット
  (今回値<前回値)は増分=今回値として扱う。`NODE_INTERNALS_POLL_INTERVAL_MS`
  (3000ms)をここに定義した。
- `reth-metrics-client.ts`: `RethMetricsClient`(HTTP GETで生テキストを返す
  IO境界)と`createFetchRethMetricsClient`。`EXECUTION_METRICS_PORT`(9001)を
  ここに定義(`beacon-api.ts`の`BEACON_API_PORT`と同じ配置パターン)。
- `reth-node-internals.ts`: 上記を束ねるオーケストレーション層
  (`pollRethNodeInternals`)。取得・パースに失敗、またはレスポンスから
  1件もサンプルを読めなかった場合は対象のstableIdと実際のエラー内容を
  `console.error`に残し`undefined`を返す。
- `targets.ts`: `ExecutionMetricsTarget`型と`executionMetricsTargets()`を
  追加(既存の`executionRpcUrls`/`executionPeerTargets`と同じ選別基準)。

各ファイルに対応するユニットテストを同じ変更の中で追加した
(`prom-text-parser.test.ts`・`reth-metrics.test.ts`・
`reth-metrics-tracker.test.ts`・`reth-metrics-client.test.ts`・
`reth-node-internals.test.ts`・`targets.test.ts`への追加)。

`pnpm --filter @chainviz/collector build` / `pnpm --filter @chainviz/collector test`
がいずれも成功することを確認した(997テスト全通過)。

#### 次の担当(Issue #186)への注意点

- `pollRethNodeInternals(client, target, tracker)` を execution ノードごとに
  周期呼び出しし、戻り値の `internals` を `NodeEntity.internals` へ、`calls`
  を(`drivesNodeId`から`fromNodeId`を解決したうえで)`NodeLinkActivity`として
  配信する想定。`RethMetricsTracker`・`RethMetricsClient`はノード横断で1つ
  ずつ使い回すこと(ノードごとに新規作成すると初回観測ベースラインの意味が
  無くなる)。
- ノード削除時は`RethMetricsTracker.forgetNode(stableId)`を呼ぶこと
  (削除済みノードの前回値が残っても実害は小さいが、後始末のために用意した)。
- `executionMetricsTargets(observations)`(targets.ts)で対象ノードを列挙する。
- 同期ステージの配列順は「collectorが既知のパイプライン順に並べ替えた順」
  であり、生のメトリクステキストの出現順ではない(実測で判明。上記
  「実環境での実測結果」参照)。フロント実装時にこの前提を壊さないこと。
- `reth_sync_checkpoint`が追従運転中にも進むことを実測で確認済み。
  Issue #187(syncStatus/blockHeightの情報源選定)の判断に使ってよい。
- `docs/ARCHITECTURE.md` §7.2.1 に実装時確定のメトリクス名を追記した。

#### テスト強化(tester)

実装担当が書いた基本テスト(ハッピーパス中心)に対し、異常系・境界値・
部分縮退の観点でユニットテストを追加した(実装コードは変更していない)。
collector のテストは 997 → 1026 に増加し全通過、`pnpm --filter
@chainviz/collector build` と `pnpm -r build` も成功する。

- `prom-text-parser.test.ts`: HELP/TYPE のみでサンプルが無いレスポンス、
  値トークン末尾のタイムスタンプの読み飛ばし、小数・負数・指数表記、
  空ラベル(`{}`)、CRLF 行末、値トークンの無いメタ行の読み捨て、
  HELP/TYPE の重複宣言(後勝ち)、ラベル値が未クォートの乱れた行の後続継続。
- `reth-metrics.test.ts`: 空 stage ラベルの読み捨て、checkpoint が非有限値
  (+Inf/NaN)の読み捨て、既知・未知ステージ混在集合を 2 通りの入力順で
  パースしても並べ替え結果が一致する順序非依存の決定性、全ステージ未知時の
  アルファベット順、mempool 値が非有限のとき丸ごと省略、pending/queued が
  0 のときは有効な mempool として保持、engine `_count` が非有限のファミリー
  読み捨て、`_sum` が非有限でも count は保持し sumSeconds のみ省略。
- `reth-metrics-tracker.test.ts`: 2 回目以降に初めて現れたメソッドは
  ベースライン扱い、欠測ポーリングを挟んでもベースラインを保持し再出現時に
  正しい差分を出す、リセットがちょうど 0 に着地したとき無出力、count 増加
  下で sumSeconds が減った場合の latencyMs 省略、sumSeconds が前回あり
  今回なしの latencyMs 省略、3 連続ポーリングの差分累積。
- `reth-metrics-client.test.ts`: 404 レスポンスの例外、fetch 自体の
  ネットワーク例外(ECONNREFUSED 相当)の伝播、成功後にタイムアウト相当の
  時間が経過してもタイマ解除済みで副作用が無いこと。
- `reth-node-internals.test.ts`: mempool 欠落時に syncStages を保持、
  syncStages 欠落時に mempool を保持、mempool が半欠(pending のみ)のとき
  mempool を省き syncStages を保持する部分縮退、engine call が 1 件も
  抽出できなくても internals は正常に返ること。

実装のバグと判断した箇所は無い(縮退動作・差分計算・並べ替えの決定性は
いずれも設計メモどおりに機能していることを確認した)。


#### 静的レビュー(reviewer)

実装・テスト・docsを静的に確認し、加えて依頼に基づき独立した合成環境
(`profiles/ethereum` を `docker compose up`、検証後 `down -v` で破棄)で
実装担当の実測主張を再現確認した。判定は**合格**(下記の軽微な申し送りあり)。

- **実測の再確認**: reth1 の `/metrics` を数秒間隔で2回スクレイプし、
  `reth_sync_checkpoint{stage=...}` の出現順序がスクレイプごとに入れ替わる
  こと、ステージが計15種(既知11 + Era/MerkleUnwind/Prune/PruneSenderRecovery)
  であること、Engine API呼び出しが `reth_engine_rpc_<method>_v<N>`(summary)
  として存在し `# HELP` にバッククォート付きメソッド名
  (`Latency for \`engine_newPayloadV4\`` 等)が埋め込まれていること、
  txpool の pending/queued ゲージ名、通常運転中に `Finish` checkpoint が
  単調に進む(実測で約2分間に24→81)ことを、いずれも worklog の記載どおり
  追認した。
- **実装をビルド済み dist 経由で実データに通す確認**も実施: 2回のスクレイプ
  (生テキストの出現順は異なる)から `parseSyncStages` が同一順序の配列を
  返すこと(順序非依存の決定性)、`parseEngineCallCounters` +
  `RethMetricsTracker` の2回目観測で妥当な増分
  (例: engine_newPayloadV4 count=3, latencyMs≈1.3)が得られること、
  初回観測がベースラインのみで空配列になることを確認した。
- **境界の遵守**: Prometheus/reth 固有の語彙は `adapters/ethereum/` 配下に
  閉じており、`packages/shared` は本ブランチで無変更(既存の
  NodeInternals/SyncStageProgress/InternalCallStats をそのまま使用)。
  `InternalCallStats.method` に生のメソッド名を載せるのは shared 側の
  ドキュメント化済みの契約どおり。
- **ファイル分割**: パーサー(汎用)/reth解釈(純粋関数)/差分計算(状態)/
  HTTP IO/オーケストレーションの5分割は責務が明確で、過剰とは判断しない。
- **固定値**: `NODE_INTERNALS_POLL_INTERVAL_MS` は前提条件(slot time 2秒
  との相対関係、増分ベースで絶対値に依存しない)がコードコメントと worklog
  の両方に明記されている。`EXECUTION_METRICS_PORT=9001` は Issue #184 で
  プロファイル側(`reth-node.sh` の `--metrics 0.0.0.0:9001`)が固定した値
  への参照であり妥当。
- **エラーハンドリング**: HTTP失敗・パース失敗・サンプル0件の各経路で
  stableId と実際のエラー内容を `console.error` に残して undefined を返す。
  個別フィールドの読み捨てが「想定内の縮退でありログを出さない」理由も
  コメントで説明されており、握りつぶしに該当しない。
- **テストの質**: 異常系・境界値(NaN/+Inf、カウンタリセット、欠測を挟んだ
  ベースライン保持、部分縮退、タイムアウトの abort)まで実装の振る舞いを
  固定しており、壊れたコードでも通る類のテストは見当たらない。
- **ビルド・テスト**: リポジトリ全体で `pnpm lint` / `pnpm build` /
  `pnpm test` すべて成功(collector 1026 / shared 58 / frontend 1205)。

軽微な申し送り(差し戻し不要):

1. **ブランチのベースが古い**(c95e454 = Issue #190 マージ前)。
   `docs/WORKLOG.md` の索引は main 側の #190 行と同じ位置に #185 行を
   追加しているため、マージ時に衝突する見込み。PR 前に main を取り込んで
   解消すること(PLAN.md の #190 チェックは three-way merge で main 側が
   生きるため実害なし)。
2. `RethNodeInternalsTarget`(reth-node-internals.ts)と
   `ExecutionMetricsTarget`(targets.ts)が構造的に同一。#186 で配線する際、
   どちらかに寄せる(targets.ts 側を import する)ことを検討してよい。
3. `createFetchRethMetricsClient` の既定タイムアウト 3000ms には前提の
   コメントが無い(同一 Docker ネットワーク内へのスクレイプでポーリング
   間隔と同値、という前提)。チェーンの進行状態に依存する値ではないため
   合格判定は妨げないが、#186 の配線時にコメントを添えるとよい。
4. `NodeLinkActivity.calls` の配列順には契約が無く、`parseEngineCallCounters`
   の出力順は生テキストの HELP 出現順(非決定的)に依存する。フロントで
   呼び出し一覧を表示する場合(#188)は表示側でソートすること。

#### QA検証(qa)

独立した合成環境(`docker compose -p chainviz-qa185 up -d`。本物の稼働中
スタックには一切触れず、検証後に `down -v` で破棄)で reth1/reth2 を起動し、
チェーンがブロックを生成している状態(block 32→51 まで進行を確認)で
ビルド済み dist の `pollRethNodeInternals` を実データに通して検証した。
判定は合格。

- エントリポイント関数の実データ検証: 稼働中 reth1 の
  `http://<コンテナIP>:9001/metrics` に対し `createFetchRethMetricsClient` +
  `RethMetricsTracker` を使って `pollRethNodeInternals` を2回呼び出した。
  - 1回目(ベースライン): `internals` あり、`syncStages` 15件、
    `mempool = {pending:0, queued:0}`、`calls` は空配列(初回はベースライン
    のみ記録し出力しない設計どおり)。
  - 6秒後の2回目: `syncStages` はパイプライン順(Headers..Finish の11段の
    あとに Era/MerkleUnwind/Prune/PruneSenderRecovery)で15件、全ステージの
    checkpoint が 48→51 へ進行。`mempool` 取得可。Engine API 呼び出し統計は
    `engine_forkchoiceUpdatedV3`(count=5, latencyMs≈0.18)・
    `engine_newPayloadV4`(count=3, latencyMs≈1.10)・
    `engine_getPayloadV4`(count=1, latencyMs≈0.28)の3件が区間増分として
    得られた。Engine API呼び出し統計・同期ステージ・txpool のいずれも
    実ノードから正しくパースされることを確認した。
- 縮退動作(取得失敗でも落ちない): 到達不能ポート
  (`127.0.0.1:59999`、ECONNREFUSED)と、200以外を返す実HTTPエンドポイント
  (reth JSON-RPC ポート 8545、405 応答)の双方で、例外で落ちず
  `console.error` に stableId と実エラー内容を残して `undefined` を返す
  ことを確認した。
- 既存機能への影響: リポジトリ全体で `pnpm lint && pnpm build &&
  pnpm test` を独立実行し全て成功(collector/shared/frontend とも通過、
  frontend 1205テスト等)。
- 検証で作成した一時スクリプトは削除済み。docker スタックは `down -v` で
  破棄済み(残存コンテナ・ボリューム・ネットワーク無しを確認)。
- 補足: 本ブランチでは PLAN.md の #185 チェックボックスが QA 実施前に
  既に `[x]` になっていた(通常は QA が付ける手順)。QA 合格を確認済みの
  ため状態としては正しい。

