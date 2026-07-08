# Issue #184 作業記録

### 2026-07-08 Issue #184 reth Prometheusメトリクス有効化(node-env)

- 担当: node-env
- ブランチ: issue-184-reth-metrics

#### 設計メモ(実装前)

`docs/ARCHITECTURE.md` §7.1・§7.2 で決定済みの内容に従う。この Issue の
スコープは「メトリクスを露出させる」ところまでで、パース・collector 側の
実装は Issue #185 に分離されている。

- **ポート割り当て**: `--metrics 0.0.0.0:9001` を使う。既存の reth 起動
  オプションで使用中のポートは `8545`(HTTP-RPC)/`8546`(WS-RPC)/
  `8551`(authrpc/Engine API)/`30303`(devp2p)であり、`9001` は衝突しない。
  ARCHITECTURE.md §7.2 で候補として挙げられているポートをそのまま採用する。
- **反映箇所**: `profiles/ethereum/scripts/reth-node.sh` の `COMMON`(boot/peer
  共通の起動オプション文字列)に追記する。boot ノード・peer ノードのどちらの
  `exec reth node $COMMON ...` 経路でも展開されるため、1 箇所の変更で
  compose 起動ノード(reth1/reth2)・`addNode` の動的追加ノードの両方に効く
  (`node-lifecycle.ts` は同じ `reth-node.sh` を `:ro` で bind mount して
  entrypoint に使う設計であり、スクリプト自体には手を入れていない)。
- **collector からの到達経路(host への ports 公開は不要)**: 既存の
  `EXECUTION_RPC_PORT` (8545) と同様に、collector は
  `targets.ts` が Docker 観測(`docker inspect` 由来の `obs.ip`、コンテナの
  Docker ネットワーク上の固定 IP)から組み立てた
  `http://<コンテナIP>:<ポート>` へ直接到達する設計になっている
  (`beacon-api.ts` の `BEACON_API_PORT` = 5052 も同様の使われ方)。collector
  はホスト上のプロセスだが、Linux の Docker ブリッジネットワークはホストから
  コンテナ IP へ直接ルーティングできるため、host 側の `ports:` 公開が無くても
  疎通する(`8551`(authrpc)も同様に `ports:` 未公開のまま運用されている前例が
  ある)。
  - よって `docker-compose.yml` の `ports:` にメトリクスポートを追加する
    **必要はない**と判断する。collector (Issue #185) は `obs.ip:9001` を直接
    叩く。
  - ただし人間が手元で `curl` して疎通確認する用途(このタスクの実機確認、
    および将来のデバッグ)は、ホスト公開が無くてもワークベンチコンテナ
    (同じ `chain` ネットワークに参加済み)から `curl http://reth1:9001/metrics`
    のようにサービス名で到達できるため、ホスト公開が無くても検証手段はある。
    この方針で host `ports:` は追加しない。
- **確認事項**: 実装後、独立した合成環境(別 compose プロジェクト名)で
  `docker compose up` し、workbench コンテナから `reth1`/`reth2` 双方の
  `:9001/metrics` に到達できること、`addNode` 相当(reth-node.sh を直接
  同条件で起動したコンテナ)でも同様に到達できることを確認する。

#### 実装

- `profiles/ethereum/scripts/reth-node.sh` の `COMMON`(boot/peer 共通起動
  オプション)に `--metrics 0.0.0.0:9001` を追加。あわせて、なぜこのポートで
  ホスト公開しないかをスクリプト内コメントに明記した。
- `profiles/ethereum/docker-compose.yml` は変更していない。上記設計メモの
  とおり、collector はコンテナ IP へ直接到達する設計であり、host 側
  `ports:` の公開は不要と判断したため。

#### 実機確認

独立した合成環境(`docker compose -p chainviz-eth-test184 up -d`。本物の
稼働中スタックには触れていない)で以下を確認した。

1. `docker compose ps` で reth1・reth2 双方のコンテナに `9001/tcp` が
   現れる(host 側には公開されない、`EXPOSE` のみ)ことを確認。
2. reth1・reth2 それぞれのコンテナ IP(`172.28.1.1` / `172.28.1.2`、
   `docker inspect` で取得)に対しホストから直接
   `curl http://<ip>:9001/metrics` を実行し、Prometheus テキスト形式の
   メトリクス(`reth_sync_checkpoint` / `reth_transaction_pool_*` /
   `reth_engine_rpc_new_payload_v4` 等、7.2 で候補に挙がっていたメトリクス
   群を含む)が返ることを確認した。これは collector が実際に使う経路
   (Docker 観測から得たコンテナ IP への直接アクセス)そのものである。
   なお `workbench` コンテナ(`ghcr.io/foundry-rs/foundry`)には
   `curl`/`wget` が入っておらず、ワークベンチ内からの疎通確認はできな
   かった(ワークベンチはユーザー操作用であり、メトリクス疎通確認の
   経路としては想定していない。collector 自身の到達経路をホストから
   直接検証する方が本来の確認になる)。
   `docker compose ps` で `8545`(JSON-RPC)も同様にホストへ `-p 8545:8545`
   で公開されており、ワークベンチ内の `cast block-number` が正常に動作する
   ことも確認し、既存機能への影響が無いことを合わせて確認した。
3. `addNode` の動的追加ノードを模して(`node-lifecycle.ts` の
   `rethSpec` と同条件: `RETH_ROLE=peer`、genesis/elpeer ボリュームを
   `:ro` マウント、同じ `reth-node.sh` を bind mount、`ports`/`exposedPorts`
   の指定なし)、同じ合成環境のネットワークに `docker run` で
   reth3(`172.28.1.3`)を追加起動した。ログで P2P 接続・Engine API
   ハンドラ初期化を確認したのち、`curl http://172.28.1.3:9001/metrics`
   でメトリクスが取得できることを確認した。これにより、host 側の
   `ports:`/`exposedPorts` の宣言の有無に関わらず(Docker のブリッジ
   ネットワーク上のコンテナ間到達性は `EXPOSE`/`ports:` の宣言に依存しない
   ため)、compose 起動ノードと addNode 動的追加ノードの両方で
   `reth-node.sh` 1 箇所の変更がそのまま効くことを確認した。
4. 確認後、`docker compose -p chainviz-eth-test184 down -v` および
   手動起動した reth3 コンテナ・ボリュームを削除し、合成環境を完全に
   片付けた(残存コンテナ・ボリューム無しを確認済み)。

#### 次の担当への注意点

- Issue #185(collector 側のパース実装)は `http://<containerIp>:9001/metrics`
  を直接叩けばよい(host 側の公開は不要)。`targets.ts` に
  `EXECUTION_RPC_PORT` / `BEACON_API_PORT` と同様の定数
  (例 `EXECUTION_METRICS_PORT = 9001`)を追加し、`obs.ip` から URL を
  組み立てる流儀に合わせるとよい。
- `node-lifecycle.ts` の `RETH_EXPOSED_PORTS`(`packages/collector/src/adapters/ethereum/node-lifecycle.ts`)
  は `[8545, 8546, ENGINE_PORT, 30303]` のままで 9001 を含めていないが、
  実機確認のとおりこのリストは Docker の `ExposedPorts` メタデータ
  (ドキュメント目的の宣言)にすぎず、ブリッジネットワーク上のコンテナ間
  到達性には影響しない。ただし `docker inspect`/`docker ps` の見た目を
  他ポートと揃えたい場合は collector 側の実装時に 9001 を追加してもよい
  (機能的な必須事項ではない)。

### 2026-07-08 Issue #184 レビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-184-reth-metrics
- 内容: `--metrics 0.0.0.0:9001` 追加の静的レビュー。指摘1件(軽微、
  コメントの記述誤り)で差し戻し。それ以外は問題なし
- 確認結果:
  - **ポート割り当て**: reth コンテナ内で使用中のポートは
    8545(HTTP-RPC)/8546(WS-RPC)/8551(authrpc)/30303(devp2p)で、9001 は
    衝突しない。lighthouse の 9000(P2P)/5052(Beacon API)は別コンテナ
    (別ネットワーク名前空間・別IP)であり衝突の余地がない。ホストへは
    8545/5052 のみ公開(既存・変更なし)で、9001 は非公開。
    `docs/ARCHITECTURE.md` §7.2 の指定ポートと一致
  - **compose起動・動的追加の両対応**: `COMMON` は boot(`exec reth node
    $COMMON --p2p-secret-key ...`)・peer(`exec reth node $COMMON
    --trusted-peers ...`)の両経路で展開される。動的追加ノードは
    `node-lifecycle.ts` が同じ `reth-node.sh` を `:ro` bind mount して
    entrypoint に使う(581行・593行)ため、1箇所の変更で両方に効く。
    §7.2 の設計と整合
  - **記述スタイル**: 既存の「理由 + Issue/worklog 参照を日本語コメントで
    残す」流儀(Issue #148 のハートビート節など)に合致。挿入位置
    (`--port 30303` の直後、`--color never` の前)も自然
  - **セキュリティ**: `0.0.0.0` バインドは既存の `--http.addr` /
    `--ws.addr` / `--authrpc.addr`、lighthouse の `--http-address` と
    同じ扱い。隔離された Docker ブリッジネットワーク上のローカル devnet
    であり、ホスト公開もしないため問題なし
  - **実機確認の内容**: 独立 compose プロジェクトでの検証、collector が
    実際に使う経路(コンテナIP直アクセス)での reth1/reth2 の確認、
    `node-lifecycle.ts` の `rethSpec` と同条件での動的追加ノード確認、
    既存機能(8545 公開・cast)への影響確認、環境の後片付け、と網羅的。
    workbench コンテナに curl が無く内部からの疎通確認ができなかった点も
    正直に記録されており妥当
  - **ビルド・テスト**: `pnpm lint` / `pnpm build` / `pnpm test` 全通過
    (shared 58 / e2e 34 / collector 944 / frontend 1205)。本 Issue は
    シェルスクリプトのみの変更で TypeScript ロジックを含まないため、
    ユニットテスト追加義務の対象外
- 指摘(差し戻し・軽微):
  1. `reth-node.sh` 51〜56行の新コメント「collector は authrpc(8551)と
     同じく Docker 観測から得たコンテナ IP へ直接到達する」は不正確。
     8551 へコンテナIPで到達するのは lighthouse(CL)であり
     (`node-lifecycle.ts` 613行の `EXECUTION_ENDPOINT`)、collector 自身は
     8551 に触れない。collector がコンテナIPへ直接到達する既存の前例は
     JSON-RPC(8545、`EXECUTION_RPC_PORT`)と Beacon API(5052、
     `BEACON_API_PORT`)で、§7.2 も「Beacon API 5052 と同じく」と明記して
     いる。Issue #185 の実装者が読むコメントなので、比較対象を
     Beacon API(5052)/JSON-RPC(8545)に修正するか、「authrpc(8551)と同様に
     ホストへは公開せず、collector は JSON-RPC(8545)・Beacon API(5052)と
     同じくコンテナIPへ直接到達する」のように主語を分けて書き直すこと
- 決定事項・注意点: 変更は未コミット。コミット時は「1つの変更内容 =
  1コミット」に従い、`reth-node.sh` の変更(feat)と docs 更新(docs)を
  分けること

### 2026-07-08 Issue #184 再レビュー(reviewer、差し戻し対応の確認)

- 担当: reviewer
- ブランチ: issue-184-reth-metrics
- 内容: 前回指摘1件(`reth-node.sh` のコメントの記述誤り)の修正を確認。
  **合格**
- 確認結果:
  - 修正後のコメント(51〜57行)は「8551(authrpc)はホスト非公開の前例」
    「collector は JSON-RPC(8545)・Beacon API(5052)と同じく Docker 観測から
    得たコンテナ IP へ直接到達する」と主語を分けて書き直されており、
    前回指摘した修正案のとおり。以下の事実と一致することを再確認した:
    - `packages/collector/src/adapters/ethereum/targets.ts` が
      `http://${obs.ip}:${EXECUTION_RPC_PORT}`(8545)・
      `http://${obs.ip}:${BEACON_API_PORT}`(5052)を組み立てており、
      collector がコンテナ IP へ直接到達する既存の前例はこの2つ
    - `profiles/ethereum/docker-compose.yml` に 8551 の `ports:` 公開は
      無く(コンテナ間の `EXECUTION_ENDPOINT` 参照のみ)、「8551 も
      ホスト非公開」は正しい
    - `docs/ARCHITECTURE.md` §7.2「ポートはホストへ公開しない(collector は
      Beacon API 5052 と同じくコンテナ IP へ直接到達する)」と整合
  - `pnpm lint` / `pnpm build` / `pnpm test` 全通過を再確認
    (frontend 1205 テストを含む全パッケージ成功)
- 注意点(前回から継続): 変更は未コミット。コミット時は
  `reth-node.sh` の変更(feat)と docs 更新(docs)を分けること

### 2026-07-08 Issue #184 QA検証(qa)

- 担当: qa
- ブランチ: issue-184-reth-metrics
- 判定: 合格

独立した合成環境(`docker compose -p chainviz-eth-qa184`。本物の稼働中
スタックには一切触れていない。開始時点で稼働中コンテナは0件)で、実装担当・
reviewerとは別に再現検証を行った。

検証手順と結果:

1. `docker compose -p chainviz-eth-qa184 up -d` でスタックを起動。
   `docker compose ps` で reth1・reth2 の両コンテナに `9001/tcp` が
   現れる(EXPOSEのみ)ことを確認。reth1 のホスト公開は `8545->8545` のみ、
   reth2 はホスト公開なし。9001 はホストへ公開されていない。
2. `docker inspect` で取得したコンテナIP(reth1=172.28.1.1、
   reth2=172.28.1.2)に対し、ホストから直接
   `curl http://<ip>:9001/metrics` を実行し、両ノードとも HTTP 200 で
   Prometheus テキスト形式のメトリクス(約8900行)が返ることを確認。これは
   collector(Issue #185)が実際に使う「Docker観測から得たコンテナIPへの
   直接アクセス」経路そのもの。
3. 取得メトリクスに完了条件のメトリクス群が含まれることを確認:
   reth1/reth2 とも `reth_sync_checkpoint`(15行)・`reth_transaction_pool_*`
   (47行)・Engine/consensus-engine 系(`reth_consensus_engine_beacon_*`、
   `reth_engine_rpc_*` 等、568行)を確認。
4. 既存RPCの動作確認: ワークベンチから `cast block-number
   --rpc-url http://reth1:8545` が成功し、値が 14→17 と進行することを
   確認(チェーンが進行し続けており、メトリクス追加によるRPCへの影響は
   ない)。
5. ホストのポート公開確認: `docker port` および `ss -ltn` で、ホストが
   listen しているのは 8545(と 5052)のみで、9001 はホストへ公開されて
   いないことを確認。
6. addNode相当の動的追加ノード: `node-lifecycle.ts` の `rethSpec` と
   同条件(RETH_ROLE=peer、genesis/elpeer を `:ro` マウント、同じ
   `reth-node.sh` を bind mount、ports/exposedPorts 指定なし)で reth3
   (172.28.1.3)を同ネットワークに `docker run` で追加。`9001/tcp` が
   EXPOSE され(ホスト公開なし)、`curl http://172.28.1.3:9001/metrics`
   が HTTP 200 でメトリクス(約8300行、`reth_transaction_pool_*` 47行・
   engine系 512行を含む)を返すことを確認。1箇所の `reth-node.sh` 変更が
   動的追加ノードにも効くことを確認した。
   - なお reth3 単体は latest_block=0 のまま追従しなかった(connected_peers
     は2まで到達)。これは簡易再現でCL(beacon)相手を省いたため、EL単体では
     Engine API による前進が起きないことによるもので、reth3 の
     `reth_sync_checkpoint` が空だったのも同期パイプライン未実行のため。
     いずれも #184 のスコープ(メトリクスエンドポイントの公開)とは無関係で、
     メトリクス公開自体は正常に機能している。
7. 後片付け: reth3 を `docker rm -f`、スタックを
   `docker compose -p chainviz-eth-qa184 down -v` で撤去。残存コンテナ・
   ボリューム・ネットワークが無いことを確認した。

完了条件はすべて満たしている(compose起動ノード・動的追加ノードとも
9001でメトリクス公開、対象メトリクス含有、既存RPC無影響、ホストへ非公開)。
