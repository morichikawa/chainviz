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
