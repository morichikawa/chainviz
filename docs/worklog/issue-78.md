# Issue #78 作業記録

### 2026-07-05 Issue #78 ワークベンチ接続先のプロキシ経由化の検証(qa)

- 担当: qa
- ブランチ: issue-78-workbench-proxy-network
- 内容: 実際に profiles/ethereum を起動した状態で、ワークベンチの接続先
  変更(ETH_RPC_URL のプロキシ経由化・extra_hosts 追加)を検証した。
- 検証手順と結果:
  1. 検証開始時、チェーンは既に起動済みだったが、稼働中の workbench
     コンテナは変更前の設定(ETH_RPC_URL=http://reth1:8545、extra_hosts
     無し)のままだった。新しい compose 設定を反映させるため
     `docker compose up -d --no-deps workbench` で workbench のみ再作成し、
     ETH_RPC_URL=http://host.docker.internal:4001 と
     ExtraHosts=[host.docker.internal:host-gateway] が反映されることを
     確認した(他サービスには影響させていない)。
  2. workbench コンテナ内で `getent hosts host.docker.internal` が
     172.17.0.1(ホストの docker0 ブリッジゲートウェイ)に解決されることを
     確認した。/etc/hosts にも host-gateway 由来のエントリが入っている。
  3. ホスト上のポート 4001 に、受け取った JSON-RPC を reth1(host:8545)へ
     転送する簡易フォワードプロキシ(Python、0.0.0.0 バインド)を立て、
     実プロキシを代替した。workbench から
     `cast chain-id --rpc-url $ETH_RPC_URL` が 1337、
     `cast block-number` が 415→418 と進行して応答し、プロキシログに
     eth_chainId / eth_blockNumber の転送が記録された。
     workbench コンテナ → host.docker.internal:4001 → プロキシ → reth1 の
     全経路の到達性を実証した。
  4. 既存のチェーン起動・ブロック進行が本変更で壊れていないことを確認した。
     全サービス(reth1/2, beacon1/2, validator1/2, workbench)が running、
     reth1 の直 RPC(host:8545)でブロックが 371→426→428 と進行、
     net_peerCount=0x1(reth2 接続)。workbench は受動的な sleep infinity
     コンテナで、接続先変更はチェーン本体に影響しない。
  5. `pnpm lint` / `pnpm build` / `pnpm test` すべて成功
     (shared 2 / e2e 34 / collector 353 / frontend 301、全 passed)。
  - 補足: テスト用プロキシ停止後、workbench からの `cast` は
     http://host.docker.internal:4001 への接続失敗になることも確認した。
     これは README/compose に明記されたとおりの挙動(プロキシ=collector が
     ホスト側で起動していないとワークベンチの RPC は通らない)であり、
     #79 でプロキシ実装がマージされれば解消する想定。
- 判定: 合格。ネットワーク到達性の実証と、既存チェーン起動機能への影響が
  無いことを確認した。PLAN.md #78 は既にチェック済みで、内容も妥当。
- 後片付け: テスト用プロキシは停止済み(ポート 4001 は解放)。再作成した
  workbench コンテナは新 compose 設定どおりの状態で残している。

### 2026-07-05 Issue #78 URL表記の差し戻し対応の最終レビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-78-workbench-proxy-network
- 内容: 前回の差し戻し指摘(ARCHITECTURE.md と docker-compose.yml の
  「reth1(`http://reth1:8545`)へ転送する」という事実誤りの URL 表記)への
  対応を最終確認した。両ファイルとも URL を削り「ホスト上のプロキシからの
  具体的な到達アドレスは Issue #79 で確定」という表現に改められている。
  ARCHITECTURE.md には「`reth1` というホスト名は Docker 内蔵 DNS で
  コンテナ内からしか解決できないため、ホスト上のプロキシは reth1 の
  コンテナ IP を用いる」という注記も追加されており、collector 既存実装
  (`node-lifecycle.ts` の `http://172.28.1.1:8545`)とも整合する。
  リポジトリ全体を `http://reth1:8545` で検索し、残存が `docs/WORKLOG.md`
  の経緯記録(変更前の値・指摘文の引用)のみであることを確認した。
  `docker compose config` は妥当、`pnpm lint` / `pnpm build` / `pnpm test`
  (shared 2 / e2e 34 / collector 353 / frontend 301)はすべて成功。
- 判定: 合格。qa の検証へ進んでよい。
- 注意点: ブランチはまだ未コミット。コミット時は「compose/README の
  接続先変更」「ARCHITECTURE.md の部分確定注記」など関心事ごとに
  コミットを分けること(1変更1コミット)。

### 2026-07-05 Issue #78 ARCHITECTURE.md追記の再レビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-78-workbench-proxy-network
- 内容: 前回の差し戻し指摘(ARCHITECTURE.md「未確定のまま残す項目」への
  部分確定注記の追記)への対応を再レビューした。追記は Issue #65 の先例と
  同じ形式で、collector 内蔵・ポート 4001(WS 本体は 4000)・
  host.docker.internal 経由という確定方針を記録しており、compose /
  README / collector 実装(DEFAULT_PORT = 4000)と整合する。
  `pnpm lint` / `pnpm build` / `pnpm test`(shared 2 / e2e 34 /
  collector 353 / frontend 301)はすべて成功。
- 判定: 条件付き合格(軽微な修正 1 点を差し戻し)。
  - 追記末尾の「プロキシは受け取った RPC をログに残しつつ
    reth1(`http://reth1:8545`)へ転送する」の URL 表記が不正確。
    プロキシはホスト上の collector プロセスであり、`reth1` という
    ホスト名は Docker の内蔵 DNS(コンテナ内)でしか解決できない。
    collector 自身も reth1 へはコンテナ IP(`node-lifecycle.ts` の
    `http://172.28.1.1:8545`)で到達している。このままだと #79 の
    実装者が `http://reth1:8545` を転送先として実装しかねないため、
    URL 部分を削るか「reth1 の RPC(ホスト上のプロキシからの具体的な
    到達アドレスは #79 で確定)」のような表現に改めること。
  - 同種の表記が `profiles/ethereum/docker-compose.yml` の environment
    コメント(「reth1(http://reth1:8545)へ転送する」)にもある。こちらは
    前回レビューで見落としていたもので、あわせて修正すること。

### 2026-07-05 Issue #78 ワークベンチ接続先のプロキシ経由化のレビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-78-workbench-proxy-network
- 内容: node-env 実装(compose の `ETH_RPC_URL` 変更・`extra_hosts` 追加・
  README 追記)を静的にレビューした。`pnpm lint` / `pnpm build` / `pnpm test`
  はすべて成功、`docker compose config` も妥当。TypeScript ロジックの変更は
  無いためユニットテスト追加義務の対象外。境界(フロントが Docker/ノードに
  触れない)・チェーンプロファイル独立性への影響なし。E2E テストはワーク
  ベンチをエンティティとして観測するだけで `cast` を実行しないため、
  プロキシ未起動でも影響しないことを確認した。
- 判定: 条件付き合格。以下 1 点の修正を差し戻し指摘とした。
  - `docs/ARCHITECTURE.md`「未確定のまま残す項目」に「ロギングプロキシの
    具体的な実装形態(別コンテナか collector 内蔵か)」が未確定のまま残って
    いるが、本変更で「collector 内蔵・ホスト上のプロセス・ポート 4001
    (WS 本体は 4000)」という前提が compose と README に確定事項として
    埋め込まれた。Issue #65 の先例と同様に「部分的に確定(Issue #78)」の
    注記を追記し、docs と実装の齟齬を解消すること。
- 決定事項・注意点(collector 担当 #79/#80 への申し送り):
  - `host.docker.internal` は Linux Engine では既定ブリッジのゲートウェイ
    (通常 172.17.0.1)に解決される。したがって **プロキシはループバック
    (127.0.0.1)のみにバインドしてはならない**。0.0.0.0 (または Docker
    ブリッジに届くインターフェース)で待ち受けること。README にはこの
    バインド要件が明記されていないため、#79 実装時に注意が必要。
  - collector の addWorkbench で動的に追加されるワークベンチは、現状
    `node-lifecycle.ts` の既定値 `ethRpcUrl: "http://172.28.1.1:8545"`
    (reth1 直結)のままで、かつ `ContainerSpec` に extra_hosts 相当の指定が
    無い。このままではキャンバスから追加したワークベンチの RPC だけが
    プロキシを迂回し、可視化対象から漏れる。#79/#80 の範囲で既定値の
    変更と到達経路(host-gateway 相当)の付与を行うこと。
  - プロキシのポート 4001 は compose に決め打ちで埋め込まれている。
    collector 本体の WS ポートが `CHAINVIZ_COLLECTOR_PORT` で可変である
    のと異なり、プロキシ側を可変にする場合は compose 側の値と同期が
    取れなくなるため、#79 では 4001 を既定値として固定するか、可変に
    するなら compose 側も env 置換(`${...:-4001}`)へ揃えること。
  - collector 未起動時にワークベンチの RPC が `Connection refused` に
    なる件は、README への記載で十分と判断した(compose 外のホスト
    プロセスへの依存はアーキテクチャ上の必然で、緩和策をプロファイル側に
    持ち込むと境界を崩すため)。#79 でプロキシ起動時に待ち受けアドレス・
    ポートを明示的にログ出力すると診断しやすくなる。


### 2026-07-05 Issue #78 ワークベンチの接続先をロギングプロキシ経由に変更する(node-env)

- 担当: node-env
- ブランチ: issue-78-workbench-proxy-network
- 内容: `profiles/ethereum/docker-compose.yml` の `workbench` サービスの
  `ETH_RPC_URL` を reth1 直接(`http://reth1:8545`)からロギングプロキシ経由
  (`http://host.docker.internal:4001`)へ変更した。プロキシは collector
  プロセスがホスト上のポート 4001 で提供する予定(collector 本体の
  WebSocket は 4000 番、プロキシは 4001 番。プロキシ実装自体は #79 で
  collector 側が担当)。あわせて README.md に「ワークベンチの RPC 観測
  (ロギングプロキシ)」節を追加し、接続先変更の理由・到達経路の仕組みを
  記載した。
- 到達経路の決定:
  - プロキシはコンテナではなくホスト上のプロセスなので、Docker ネットワーク
    内の名前解決では届かない。workbench に
    `extra_hosts: ["host.docker.internal:host-gateway"]` を付け、
    `host.docker.internal` をホスト IP に解決させる方式を採用した。
  - この環境(Ubuntu 24.04 WSL2 上の Docker Engine 29.1.3, ネイティブ
    Linux Engine)で `host.docker.internal` は Docker のデフォルトブリッジ
    ゲートウェイ `172.17.0.1` に解決され、コンテナからホストのポート 4001
    へ到達できることを実測で確認した。
  - 代替案として `chain` ネットワーク(`172.28.0.0/16`)のゲートウェイ IP
    `172.28.0.1` を直接指す方式も疎通することを確認したが、サブネット定義に
    依存して壊れやすいため、サブネット非依存の `host.docker.internal` を
    採用した。
- 動作確認:
  - まずホスト上のポート 4001 に簡易 JSON-RPC モックを立て、chain ネットワーク
    相当のカスタムブリッジ上の Foundry コンテナから
    `ETH_RPC_URL=http://host.docker.internal:4001` で `cast chain-id` が
    応答すること(コンテナ→ホスト到達)を確認した。
  - 次に `docker compose up` でチェーン全体を起動し、ホスト上のポート 4001 に
    reth1(ホスト公開 8545)へ転送する簡易フォワードプロキシを立てて実プロキシ
    を代替した。workbench から `cast chain-id` が 1337、`cast block-number`
    が 27→31 と進行、プリマインアカウントの残高取得も成功し、プロキシログに
    実際の転送が記録されることを確認した(workbench コンテナ →
    host.docker.internal:4001 → reth1 の全経路が通ること)。
- 決定事項・注意点:
  - `depends_on: reth1` は維持した。workbench の接続先はホスト上のプロキシに
    変わったが、プロキシの転送先である reth1(チェーン本体)が起動している
    必要は変わらないため。ただしプロキシ(collector)は compose 外のホスト
    プロセスなので compose の `depends_on` では待てない。collector の
    プロキシが起動していないと workbench の RPC は `Connection refused`
    (host:4001)になる。`profiles` 単体で `docker compose up` した場合、
    チェーン自体は起動・進行するが workbench の `cast` は collector 無しでは
    通らない点に注意。
  - 動作確認中、以前の実行で共有ボリュームに残っていた古い genesis が
    idempotency により再利用され、beacon が weak subjectivity period エラーで
    起動失敗した。これは本変更とは無関係の既存挙動で、`docker compose down -v`
    でボリュームを破棄して再起動すれば解消する。長期間放置した後に再起動する
    場合は `-v` でのクリーン起動が必要になる。

