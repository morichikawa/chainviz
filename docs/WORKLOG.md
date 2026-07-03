# chainviz 作業記録

各タスクの完了時に、担当したエージェントが追記する記録。
`docs/PLAN.md` のチェックボックスは「どこまで進んだか」を示すだけなので、
「何を・なぜ・どう実施したか」「実装中に判明した注意点」はこちらに残す。
commit ログとあわせて読むことで、後から経緯を追えるようにする。

この記録は平易で正確な日本語で書く(担当エージェントのペルソナの口調は
使わない)。

## 記入フォーマット

```
### YYYY-MM-DD Issue #<番号> <タイトル>
- 担当: <collector | frontend | node-env | reviewer | qa>
- ブランチ: issue-<番号>-<スラッグ>
- 内容: 何を実装・変更したか
- 決定事項・注意点: 実装中に判明した仕様の詳細、次の担当が知っておくべきこと
```

## 記録

### 2026-07-04 Issue #1・#2・#3 Ethereum プロファイルのノード環境
- 担当: node-env
- ブランチ: issue-1-genesis-pos-net
- 内容: `profiles/ethereum/` にノード環境テンプレート一式を作成した。
  - `values.env` … genesis 生成設定（実質的な genesis 設定ファイル）。
    CHAIN_ID=1337、バリデーター 64、slot time 2 秒、Electra まで有効・Fulu 以降
    無効、EL プリマイン 8 アカウント。
  - `docker-compose.yml` … reth(EL)+ lighthouse(CL beacon + validator)を
    2 ノード、Foundry ワークベンチ 1 つ、genesis 生成サービス。
  - `scripts/` … 各コンテナの起動スクリプト（genesis 生成、reth、beacon、
    validator）。
- 決定事項・注意点:
  - **genesis は静的コミットせず起動時に生成する**。genesis.json / genesis.ssz は
    生成時刻を埋め込むため、古い時刻でコミットすると lighthouse が過去/未来
    スロットの計算で破綻する。`genesis` サービスが `docker compose up` のたびに
    現在時刻で生成し直し、共有ボリューム `genesis` に置く。全ノードがこれを
    マウントして共有する（CONCEPT「genesis を静的ファイルとしてマウント共有」に
    対応。共有ボリュームの中身がその実体）。
  - genesis 生成は `ethpandaops/ethereum-genesis-generator` を採用（EL/CL 両方の
    genesis と各種予備コントラクトを一括生成でき、Kurtosis と同じ実績のある
    経路）。バリデーター鍵は同イメージ同梱の `eth2-val-tools` で mnemonic から
    導出し、ノード数ぶんに分割する。
  - **ノードのデータディレクトリも起動時に毎回初期化する**。genesis が毎回
    変わるため、古い chain データが残ると genesis 不一致で起動できない。
    各起動スクリプトが `rm -rf` してから init/start する。したがって `up` の
    たびにまっさらな chain で始まる（devnet として想定どおり）。
  - **CL の P2P bootstrap**: reth/lighthouse のイメージには curl 等の HTTP
    クライアントが無いため、runtime の API 取得は使えない。代わりに beacon1 が
    lighthouse の書き出す enr.dat を共有ボリューム `clpeer` へコピーし、beacon2 が
    それを `--boot-nodes` に渡す方式にした。ENR に載せる IP は docker の固定 IP
    （`--enr-address`）。これで 2 ノードが単一 chain として合意する。
  - **EL(reth)同士の P2P は未接続**。ブロックは CL が Engine API で各 EL に渡す
    ため両 EL の canonical chain は一致する（起動テストで両 reth の head hash 一致を
    確認済み）。mempool の相互伝播が要る Phase 3 で追加する。ロギングプロキシも
    Phase 3。
  - シェルの落とし穴: `--http-allow-origin *` を変数経由で unquoted 展開すると
    `*` がコンテナのルート直下に glob 展開されて不正な引数（boot 等）が混入する。
    beacon 起動スクリプトで `set -f`（glob 無効）を入れて回避した。
  - 起動確認（node-env 自己確認。最終合否は qa 担当）: `docker compose up` で
    ブロックが約 2 秒ごとに進行、finality も epoch 3 まで到達、両 reth の head 一致、
    ワークベンチから `cast chain-id / block-number / balance / send`（プリマイン
    アカウントから送金し status 0x1・残高反映）まで確認した。
  - ワークベンチの送金鍵はチェーンと同じ mnemonic。導出パスが Foundry 既定と
    同じなのでプリマインアカウントをそのまま使える。

### 2026-07-04 Issue #1・#2・#3 レビュー（Ethereum プロファイルのノード環境）
- 担当: reviewer
- ブランチ: issue-1-genesis-pos-net
- 内容: `profiles/ethereum/` 一式と `docs/PLAN.md`・`docs/WORKLOG.md` の変更を
  静的レビューした。境界の遵守（packages/* 無変更、フロント・collector への
  チェーン固有ロジックの漏れなし）、チェーンプロファイルの独立性（新規
  ディレクトリ追加のみ）、ARCHITECTURE.md §4 のテンプレート配置、CONCEPT.md の
  決定事項（slot time 2 秒、reth + lighthouse の PoS、Foundry ワークベンチ×1、
  ロギングプロキシの Phase 3 送り）との整合を確認。結果は条件付き合格
  （実装の差し戻しなし。下記 2 点の対応を推奨）。
- 決定事項・注意点:
  - **CONCEPT.md との齟齬（要 docs 更新）**: CONCEPT.md「新規ノード追加時の
    P2P 参加方法」は「genesis は静的ファイルとしてマウント共有」としているが、
    実装は「起動時に生成して共有ボリュームで共有」。生成時刻を埋め込む genesis の
    性質上、実装側が正しい。sync-docs の観点で CONCEPT.md の該当決定事項の
    文言を実態（起動時生成 + 共有ボリューム）に合わせて更新すべき。
  - **mnemonic の二重管理（修正推奨）**: docker-compose.yml の `ETH_MNEMONIC` に
    ハードコードした mnemonic は、generator イメージ（`:master` タグ）内
    `/defaults/defaults.env` の `EL_AND_CL_MNEMONIC` 既定値との一致に依存している。
    イメージ更新で既定値が変わると、プリマインとワークベンチ鍵が静かに食い違う。
    `values.env` で `EL_AND_CL_MNEMONIC` を明示的に export し出所を一本化すべき。
  - イメージタグがすべて `latest` / `master`。特に genesis-generator は
    `/work/entrypoint.sh` 等のイメージ内部パスにも依存しており、タグ変動の
    影響を最も受けやすい。再現性のためピン留めを検討（必須とはしない）。
  - #1〜#3 を 1 ブランチ・1 PR にまとめる運用は CLAUDE.md「Issue ごとに
    ブランチを切る」からの逸脱だが、不可分な作業である旨が PLAN.md に
    明記されており妥当と判断。
  - 動作面（ブロック進行・finality・cast 疎通）の最終合否は qa 担当に委ねる。

### 2026-07-04 Issue #4・#5 検証（Ethereum プロファイルのノード環境）
- 担当: qa
- ブランチ: issue-1-genesis-pos-net
- 内容: `profiles/ethereum/` を実際に `docker compose up` して、ステップ2の
  完了条件（Issue #4・#5）を実機で検証した。結果は両 Issue とも合格。
  検証後 `docker compose down -v` で環境（コンテナ・ボリューム・ネットワーク）を
  完全に後片付け済み。
- 検証環境: Docker 29.1.3 / Docker Compose 2.40.3（Linux WSL2）。イメージは
  すべて `latest` / `master` タグを当日 pull した状態。
- Issue #4（起動・ブロック進行）: 合格。
  - `genesis` サービスが起動時に genesis を生成し exit 0 で正常終了。ログで
    バリデーター鍵 64 個を 2 ノードに 32 個ずつ分割生成しているのを確認。
    データボリュームは毎回まっさらから生成される仕様どおりに動作。
  - ブロックが約 2 秒ごとに継続進行することを確認（block-number を複数回
    サンプリングし単調増加: 8→10→13→15→17、その後も 40→74→109→153 と継続）。
  - 両 EL（reth1/reth2）が同一 head hash・同一 block-number で一致。CL の P2P が
    接続され（beacon peer_count=1 = 相互接続）単一チェーンとして合意している。
  - finality: 起動直後は epoch 1 が justify されず finalized_epoch=0 のままだったが、
    これは起動時の peer 接続待ちによる初回のみの遅延。epoch が進むと
    current_justified が epoch 2→3 と連続 justify され、finalized も epoch 2 まで
    前進することを beacon API（`/eth/v1/beacon/states/head/finality_checkpoints`）で
    確認。finality は正常に機能している。完了条件（ブロック進行）には影響なし。
- Issue #5（ワークベンチからの cast RPC 疎通）: 合格。
  - workbench コンテナ内で compose 設定の `ETH_RPC_URL=http://reth1:8545` に対し
    `cast chain-id`=1337、`cast block-number`（進行中の値）、
    `cast rpc web3_clientVersion`=reth/v2.3.0、`cast gas-price` が正常応答。
  - プリマインアカウント（mnemonic index 0）の残高照会 `cast balance --ether`=
    1000000000 ether を確認。
  - `cast send`（プリマインから fee recipient へ 1 ether 送金）が status=0x1 で
    採掘され、受取アドレス残高が 0 → 1.000000000000021000 ether（送金分＋ブロック
    提案報酬）に反映されることを確認。
- 差し戻し: なし。ステップ2の完了条件を満たしているため Issue #4・#5 はクローズ可。
  reviewer が挙げた docs 更新（CONCEPT.md の genesis 記述）・mnemonic 二重管理・
  タグピン留めは動作に影響しないため本検証の合否とは独立（別途対応判断）。

### 2026-07-04 Issue #1 レビュー対応（mnemonic の出所を values.env に一本化）
- 担当: node-env
- ブランチ: issue-1-genesis-pos-net
- 内容: reviewer が挙げた「mnemonic の二重管理」を修正した。
  - `values.env` に `export EL_AND_CL_MNEMONIC="..."` を明示的に追加し、mnemonic の
    出所をこのファイル1箇所に一本化した。値は generator イメージ
    （`ethpandaops/ethereum-genesis-generator:master`）の `/defaults/defaults.env`
    の既定値と同一の文字列を明示指定（既存のプリマインアドレス・バリデーター鍵を
    変えないため）。
  - `docker-compose.yml` のワークベンチから、ハードコードしていた `ETH_MNEMONIC`
    環境変数を削除し、代わりに `env_file: ./values.env` で同じ mnemonic を読み込む
    形に変更した。`ETH_RPC_URL` は従来どおり `environment:` に残す。
  - `README.md` の cast 例を `$ETH_MNEMONIC` → `$EL_AND_CL_MNEMONIC` に更新。
- 決定事項・注意点:
  - **なぜ env_file か**: ワークベンチへの値の渡し方として、entrypoint で
    `. values.env` して再 export する案も検討したが、`docker compose exec` は
    entrypoint プロセスの実行時 export を引き継がない（新プロセスがコンテナの
    設定 env を継承する）ため、対話 shell の `$ENV` 経由でしか値が渡らず
    非対話の `exec sh -c 'cast ...'`（QA や自動化が使う）で空になる。`env_file` は
    コンテナの設定 env に入るため対話・非対話どちらの exec でも確実に参照できる。
    これを実機で確認した上で env_file を採用した。
  - env_file は values.env の全変数（CHAIN_ID や SLOT_DURATION 等の genesis 用
    変数）もワークベンチ env に載せるが、cast / forge はこれらを参照しないため
    無害。ワークベンチが参照するのは `ETH_RPC_URL` と `EL_AND_CL_MNEMONIC` のみ。
  - 生成側（genesis サービス）は従来どおり generate-genesis.sh が
    `. /config/values.env` でシェル source する経路。明示 export により
    イメージ既定値への暗黙依存が解消され、バリデーター鍵導出・EL プリマインとも
    values.env の値を使う。
  - 再確認: 修正後に `docker compose up` → ブロック進行（block-number 9→12）、
    `cast chain-id`=1337、プリマイン index 0 残高=10 億 ETH、
    `cast send --mnemonic "$EL_AND_CL_MNEMONIC"` で送金し受取残高反映まで
    非対話 exec で確認。`docker compose down -v` で後片付け済み。

### 2026-07-04 Issue #7・#8・#9 A層（インフラ可視化）の collector 実装
- 担当: collector
- ブランチ: issue-7-collector-a-layer
- 内容: `packages/collector/` に A 層（コンテナ・プロセス・リソース）の
  観察パイプラインを実装した。ARCHITECTURE.md §1 のドメイン単位のフォルダ構成に
  沿って以下を追加。
  - `docker/` … Docker Engine API のポーリング。`types.ts` で dockerode を薄く
    抽象化した `DockerClient` インターフェースと観測値の型を定義。`observe.ts` は
    生レスポンス→観測値の純粋変換（安定 ID 算出・IP/ポート抽出・top のプロセス
    解析・CPU%/メモリ MB 計算）。`poller.ts` の `DockerPoller.pollOnce()` が
    `/containers/json`→各コンテナの `/top`・`/stats` を集約。`dockerode-client.ts`
    が実 dockerode を `DockerClient` へ橋渡し。
  - `adapters/ethereum/` … ChainAdapter 実装。`classify.ts` に reth/lighthouse/
    foundry 等の Ethereum 固有の判定を閉じ込め、`index.ts` の `EthereumAdapter`
    が観測値を `NodeEntity`/`WorkbenchEntity` へ正規化。`subscribePeers`/
    `subscribeChainEvents` は B/C 層で実装するため no-op スタブ。
  - `world-state/` … `diff.ts`（前回比較で `DiffEvent[]` を生成する純粋関数 +
    エンティティ安定キー抽出 `entityId`）と `store.ts`（インメモリ store。
    `applyInfra` は infra 系のみ差分対象にし、他層のエンティティは残す）。
  - `server/` … `CollectorServer`（ws）。接続時に `snapshot` を1回、以後
    `broadcastDiff` で `diff` を配信。プロトコルは shared の `ServerMessage`/
    `ClientMessage` に準拠。
  - `index.ts` … dockerode→poller→adapter→store→server を配線し、3 秒間隔
    （`POLL_INTERVAL_MS`）でポーリング→差分配信するループ。直接実行時のみ起動。
  - vitest を各モジュールに追加（計 63 ケース。ハッピーパス＋異常系・境界値）。
- 決定事項・注意点:
  - **安定識別子（InfraEntity.id）**: docker compose の
    `com.docker.compose.project`/`service` ラベルから `project/service` を生成し、
    無ければコンテナ名、それも無ければコンテナ ID にフォールバック。コンテナ ID は
    再起動で変わるため最終手段（ARCHITECTURE.md §2 の要求）。実 Docker で
    `cvtest/reth1` のようにコンテナ ID 非依存の ID になることを確認済み。
  - **ChainAdapter 境界**: reth/lighthouse/foundry 等のチェーン固有語彙は
    `adapters/ethereum/classify.ts` に限定。`docker/` 配下と world-state の
    スキーマはチェーン非依存に保った。
  - **A 層のプレースホルダ**: `NodeEntity` の `syncStatus`/`blockHeight`/
    `headBlockHash` は A 層では取得しないため `syncing`/`0`/`""` を入れる。
    これらは B/C 層（RPC 購読）で埋める。
  - **top/stats の異常系**: 一覧取得後にコンテナが消える等で個別の top/stats が
    失敗しても、そのコンテナだけ空プロセス・ゼロリソースにフォールバックし
    収集全体は落とさない設計（ユニットテストで担保）。
  - **CPU%**: docker 標準式（cpuDelta/systemDelta × onlineCpus × 100）。差分が
    取れない初回や負値は 0。メモリはページキャッシュ分を差し引いた MB。
  - **操作コマンド（addNode 等）は未実装**。プロトコル準拠のため受信時に
    `commandResult ok:false`（未実装）を返すだけにした。実装はステップ 4 以降。
  - **依存追加とビルド設定**: `dockerode`・`ws`（+ 型）を collector に追加。
    dockerode が引く SSH トランスポート用ネイティブ依存（cpu-features・ssh2・
    protobufjs）はローカルソケット接続では不要なため、`pnpm-workspace.yaml` の
    `allowBuilds` でこれらを `false`（ビルドしない）に設定した。プレースホルダ
    （"set this to true or false"）のままだと `pnpm install` が
    `ERR_PNPM_IGNORED_BUILDS` で失敗し build/test の事前チェックを通せないため。
  - 実機確認: reth/lighthouse/foundry/busybox イメージのコンテナを compose 風
    ラベル付きで起動し、`EthereumAdapter.pollInfra()`→`store.applyInfra()` を実行。
    node/workbench の分類、published+exposed ポート収集、IP 解決、初回 3 件の
    `entityAdded`、安定した 2 回目ポーリングで差分空、を確認。確認後コンテナ・
    ネットワークは削除済み。
  - `pnpm build`・`pnpm test`・`pnpm lint` を全パッケージで通ることを確認。

### 2026-07-04 Issue #7・#8・#9 A層 collector のテスト強化（異常系・境界値）
- 担当: テスト強化（試験学）
- ブランチ: issue-7-collector-a-layer
- 内容: 既存の 63 ケース（ハッピーパス中心）に対し、異常系・境界値・想定外
  シーケンスのテストを追加した（63→118 ケース）。実装コードは変更していない。
  - `docker/observe.test.ts` … 空文字ラベルでの安定 ID フォールバック、
    空/undefined の IP をスキップして次の非空を選ぶ挙動、Ports 欠落、
    PrivatePort 採用、Titles/Processes 欠落時の parseTopProcesses、CMD 列より
    行が短い場合、online_cpus=0、precpu 欠落、丸め、cache 欠落など。
  - `docker/poller.test.ts` … top と stats が同時失敗しても観測を落とさない、
    listContainers 自体の失敗が pollOnce まで伝播する、安定 ID が重複する
    2 コンテナを両方返す（重複排除は上位に委ねる）。
  - `adapters/ethereum/classify.test.ts` … 大文字小文字を無視した判定、
    node/tool 両方の語が出た場合に workbench 判定が優先されること、compose
    サービス名からのクライアント種別判定、判別材料ゼロ時の node フォールバック。
  - `adapters/ethereum/index.test.ts` … top が空でもイメージから clientType を
    保ちつつ代表プロセスは unknown、クライアント種別に一致しない場合の先頭
    プロセス採用、安定 ID が無い場合のコンテナ ID 使用、poller 失敗の伝播。
  - `world-state/diff.test.ts` … add/update が remove より前に来る順序保証、
    両入力空、next/prev の重複 ID 畳み込み（後勝ち・単一イベント化）、多数
    フィールド同時変更、kind 固有フィールド（label）のみの変更。
  - `world-state/store.test.ts` … 消えたエンティティが同じ ID で戻ると
    entityUpdated ではなく entityAdded になること（entityRemoved 後の再出現）、
    1 回の poll に重複 ID があると後勝ちで 1 件に畳まれること、複数 poll に
    またがる更新の蓄積、getSnapshot の返り値配列を外部で変更しても内部が
    汚染されないこと。
  - `server/websocket-server.test.ts` … 複数クライアントへの同報、状態変化後に
    接続したクライアントが最新スナップショットを受け取ること、1 クライアント
    切断後も残りへ配信継続、command 以外の整形式メッセージ・JSON プリミティブ
    （null/数値/文字列）を無視、listen 前の broadcastDiff/close が例外を投げない。
  - `index.test.ts`（新規）… ポーリングループのテスト。初回即時実行と差分配信、
    interval ごとの再スケジュール（fake timers）、stop() 後の停止、poll 失敗時に
    onError 通報しつつループ継続、前回未完了時に次回がスケジュールされない
    （非重複）、変化なし時に空差分を転送、entities 欠落時に空観測として扱う。
- 決定事項・注意点:
  - **潜在バグ（collector へ差し戻し候補）**: `classify.ts` の `WORKBENCH_TOOLS`
    は部分一致（`includesAny`）で判定するため、`"cast"` が `"broadcast"` の部分
    文字列にマッチする。ノードのプロセス/イメージ名に "broadcast" 等が含まれると
    ワークベンチと誤分類される。同様に `"forge"`→"forged" 等の誤検知リスクあり。
    再現: `classifyContainer` に image/process で "broadcast" を含む観測を渡すと
    `kind: "workbench"` が返る。対策案は語境界を見る／既知トークンの完全一致に
    する等。現状の挙動をテストで固定はしていない（バグを固定化しないため）。
  - ポーリングループの「前回未完了時スキップ」は、実装が「await 完了後に次回を
    setTimeout する」方式のため、正確には「前回が完了するまで次回を予約しない」
    挙動。解決しない poll を与えても pollInfra が 1 回しか呼ばれないことで担保した。
  - store の `applyInfra` が非 infra エンティティ（wallet 等）を残すロジックは、
    現状 wallet を注入する公開 API がないためユニットテストでは直接検証できない。
    B/C 層実装時にテストを追加する余地として残す。
  - `pnpm build`・`pnpm test`（118 passed）・`eslint`・`prettier --check` を
    collector で通ることを確認。

### 2026-07-04 Issue #7 classify.ts の部分一致誤分類バグ修正
- 担当: collector
- ブランチ: issue-7-collector-a-layer
- 内容: `adapters/ethereum/classify.ts` のワークベンチ／クライアント判定が
  部分文字列一致（`includesAny`）だったため、"broadcast" に含まれる "cast"、
  "forged" に含まれる "forge" などにマッチし、ノードをワークベンチと誤分類
  していた（試験学からの差し戻し）。判定を単語境界ベースに変更した。
  - `includesAny` を `findWord` に置き換え、needle ごとに `\b<needle>\b`
    （大文字小文字無視）の正規表現でマッチさせる。イメージ名・サービス名で
    使われる区切り文字（`/ : - .` 空白）はいずれも `\b` 境界として扱われる
    ため、"geth-mainnet" の "geth" や "ghcr.io/.../reth:latest" の "reth"、
    "foundry" イメージ上の "cast" プロセスは従来どおり正しく検出される。
  - `classify.test.ts` に回帰テストを追加:「broadcast を含む process/service は
    workbench に誤分類されない」「forged は forge に一致しない」「区切り文字を
    挟んだツール語（foundry イメージパス・cast プロセス）は workbench として
    検出される」の3ケース。
- 決定事項・注意点:
  - `\b` は `[A-Za-z0-9_]` を単語構成文字とみなすため、アンダースコア区切り
    （例: `reth_node`）は境界にならず一致しない点に注意。現状のイメージ名・
    サービス名・プロセス名では `-`/`/`/`:`/`.` 区切りが使われており実害はないが、
    将来アンダースコア区切りのトークンを判定対象にする場合は境界定義の見直しが要る。
  - `pnpm build`・`pnpm test`（121 passed）が collector で通ることを確認。

### 2026-07-04 Issue #7・#8・#9 A層 collector 実装のレビュー（静的整合性）
- 担当: reviewer
- ブランチ: issue-7-collector-a-layer
- 内容: collector の A 層実装（Docker ポーリング・ワールドステート正規化・
  WebSocket 配信）と、テスト強化・classify.ts のバグ修正を静的にレビューした。
  結果は**合格**（差し戻しなし）。
  - 境界の遵守: チェーン固有語彙（reth/lighthouse/foundry 等）は
    `adapters/ethereum/` に閉じている。`docker/` 配下は Docker 共通の語彙のみで
    チェーン非依存。`packages/shared`・`frontend` への変更はなし（lockfile 除く）。
  - ARCHITECTURE.md との整合: §1 のフォルダ構成（docker/ adapters/ world-state/
    server/）、§2 の安定識別子要求（コンテナ ID 非依存）、§3 のプロトコル
    （接続時 snapshot 1回→以後 diff、command は commandResult で応答）に準拠。
    `proxy/`・`commands/` が無いのは後続 Phase の範囲なので問題ない
    （先回り実装をしない原則にも合致）。
  - CONCEPT.md との整合: ポーリング間隔 3 秒（CONCEPT の決定事項）を
    `POLL_INTERVAL_MS` で反映。
  - テストの質: 121 ケースを確認。異常系（top/stats 個別失敗、daemon 到達不能、
    不正 JSON、切断後の同報継続）・境界値（online_cpus=0、空 Titles、重複安定 ID、
    削除後再出現）をカバーし、classify の部分一致バグの回帰テスト
    （broadcast/forged）も実装の修正と対応している。実装をなぞるだけの
    無意味なテストは見当たらない。
  - `pnpm-workspace.yaml` の `allowBuilds`: cpu-features / ssh2 / protobufjs は
    いずれも dockerode 経由の推移的依存であることを `pnpm why` で確認。
    ローカルソケット接続のみの用途でビルド不要とする判断は妥当。
  - `pnpm install --frozen-lockfile`・`pnpm lint`・`pnpm build`・`pnpm test`
    （shared 2 / collector 121 / frontend 1、全パス）をリポジトリ全体で確認。
- 決定事項・注意点（いずれも軽微・非ブロッキング）:
  - `pnpm-workspace.yaml` のコメントと本 WORKLOG の前エントリで protobufjs を
    「SSH トランスポート用ネイティブ依存」と説明しているが、protobufjs は
    @grpc/proto-loader 経由の gRPC 系依存で、ネイティブビルドではなく
    postinstall スクリプトを持つだけ。ビルド不要の判断自体は正しいが、
    コメントの由来説明はやや不正確（次に触るときに直せばよい）。
  - `index.ts` の `startPollingLoop` の第1引数が具象型 `EthereumAdapter` に
    なっている。使うのは `pollInfra` のみなので、shared の `ChainAdapter` 型で
    受けるほうがチェーンプロファイル独立の意図に沿う。新チェーン追加時までに
    直せば十分。
  - `.claude/worktrees/` が未追跡で残っている。コミット時に含めないこと
    （`.gitignore` への追加を推奨）。
  - コミットは未実施のため、コミット粒度の確認は行っていない。コミット時に
    「1 変更 = 1 コミット」（実装 / テスト強化 / バグ修正 / 依存設定を分ける）を
    適用すること。

### 2026-07-04 Issue #7・#8・#9 A層 collector 実装の動作検証（SQA）
- 担当: qa
- ブランチ: issue-7-collector-a-layer
- 内容: collector の A 層実装（Docker ポーリング・ワールドステート正規化・
  WebSocket 配信）を実際に起動して検証した。結果は**合格**（差し戻しなし）。
  - `pnpm --filter @chainviz/collector build` が成功することを確認。
  - `main(port)` を任意ポート（4111）で起動し、WebSocket サーバーが listening
    になりポートが開くことを確認。
  - compose ラベル（project=qatest, service=node1/node2/foundry）付きの
    busybox コンテナ 3 個を立てた状態で、3 秒間隔ポーリングが Docker Engine
    API から実データを取得することを確認。スナップショットに実 IP
    （172.17.0.x）・resources（memMB=0.42）・process.name=sleep が反映され、
    stableId が compose ラベル由来（`qatest/node1` 等、コンテナ ID 非依存）で
    生成されていた。service=foundry のコンテナは classify で workbench に、
    それ以外は node に正しく分類された。
  - WebSocket クライアントで接続直後に snapshot が 1 回届くことを確認
    （ARCHITECTURE §3）。接続保持中に node2 を削除し node3 を追加したところ、
    次のポーリング周期で `entityAdded(qatest/node3)`・
    `entityRemoved(qatest/node2)` の 2 件を含む diff が配信された。resources に
    変化がない間は差分が飛ばない（round2 によるノイズ抑制）ことも確認。
  - 別クライアントで後から接続すると、その時点の最新状態（node2 削除・node3
    追加後）の snapshot が届き、store が周期ポーリングで最新化されていることを
    確認。
  - `command`（addWorkbench）を送ると `commandResult`（commandId 一致・
    ok=false・"command handling is not implemented yet"）が返ることを確認。
    操作系は後続 Phase の範囲であり、A 層時点でスタブ応答なのは仕様どおり。
- 決定事項・注意点:
  - 検証で使った busybox コンテナは node と分類され clientType が代表プロセス名
    "sleep" になる。実プロファイル（reth/lighthouse/foundry）では KNOWN_CLIENTS/
    WORKBENCH_TOOLS に一致するため、実環境での clientType/kind 判定はステップ 2 の
    ノード環境と合わせて別途確認する余地がある（本検証はダミーコンテナでの
    A 層パイプライン疎通の確認）。
  - テスト用コンテナ・起動した collector プロセスはいずれも後片付け済み。
  - PLAN.md ステップ 3 の collector 項目（#7〜#9）は qa/collector で担当が
    明示的に分かれていないため、collector が付けたチェックはそのままとする
    （本検証で完了条件を満たすことを確認済み）。
