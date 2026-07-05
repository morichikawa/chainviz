# Ethereum チェーンプロファイル — ノード環境テンプレート

`docs/CONCEPT.md`「技術候補 > ノード環境」で決定した構成に沿った、
genesis 共有の PoS プライベートネット。実行層(reth)+ 合意層(lighthouse)を
2 ノード立て、Foundry ワークベンチを同じ Docker ネットワークに接続する。

これはチェーンプロファイル 3 点セット(`docs/ARCHITECTURE.md` §4)のうち
「ノード環境テンプレート」にあたる。ChainAdapter・フロント表現セットは
別パッケージで担当する。

## 構成

| サービス     | 役割                                        | イメージ |
| ------------ | ------------------------------------------- | -------- |
| `genesis`    | genesis 一式を生成して終了(初回のみ。以降は再利用) | ethpandaops/ethereum-genesis-generator |
| `reth1/2`    | 実行クライアント(EL)                       | ghcr.io/paradigmxyz/reth |
| `beacon1/2`  | 合意クライアント(CL, beacon node)         | sigp/lighthouse |
| `validator1/2` | バリデーター(ブロック提案・投票)         | sigp/lighthouse |
| `workbench`  | ユーザー操作マシン(cast / forge)          | ghcr.io/foundry-rs/foundry |

- `reth1 + beacon1 + validator1` で 1 ノード、`reth2 + beacon2 + validator2` で
  もう 1 ノード。各ノードは自分の EL を Engine API 経由で駆動する。
- バリデーター 64 個を 2 ノードに 32 個ずつ分割。両ノードがブロックを提案する。
- slot time は 2 秒(`values.env` で設定)。ブロックは約 2 秒ごとに進む。
- genesis 時点で Electra(Prague)まで有効。Fulu(PeerDAS)以降は無効。

## 使い方

```sh
cd profiles/ethereum
docker compose up          # 起動(全サービスをまとめて上げること)
docker compose logs -f     # ログ追尾
docker compose down -v     # 停止 + genesis / chain データ破棄
```

起動後 `GENESIS_DELAY`(既定 20 秒)+ 数スロットでブロックが進み始める。

- ホストからの JSON-RPC: `http://localhost:8545`(reth1)
- ホストからの Beacon API: `http://localhost:5052`(beacon1)

### 一部のサービスだけを再起動するとき(Issue #43)

`reth-node.sh` / `lighthouse-bn.sh` は起動のたびにデータディレクトリを
初期化して genesis からやり直す設計になっている(後述「genesis の扱い」)。
このため **`docker compose restart beacon1 beacon2` のように beacon(CL)だけを
再起動してはいけない**。CL は genesis からやり直す一方、再起動していない
reth(EL)は既存のブロックデータを保持したまま先行してしまい、EL/CL の
ヘッドが乖離して `Exec engine unable to produce payload: engine is likely
syncing` が継続し、チェーンが完全に停止する(自己回復しない)。

ボリュームを維持したまま一部のサービスを再起動したい場合は、必ず
`reth<N> beacon<N> validator<N>`(ノード単位)をセットで再起動すること。
`scripts/restart-node.sh` はこれを楽に行うためのヘルパー(ホスト側で使う
運用スクリプトで、コンテナにはマウントしない):

```sh
./scripts/restart-node.sh 1        # reth1 beacon1 validator1 をまとめて再起動
./scripts/restart-node.sh 1 2      # 両ノードをまとめて再起動(既に停止済みの
                                    # 場合の復旧にはこちらが必要)
```

ノード単位でまとめて再起動すれば、EL/CL 双方が同じ genesis からやり直した
状態になり、後述の EL/CL 間 P2P 再同期によって自動的に追従を再開する
(片方のノードだけ再起動しても、もう片方が稼働中であれば P2P 経由で
バックフィルされて復旧する。実機で確認済み)。

最も確実なのは `docker compose down`(-v なし)→ `up` で全サービスを
再作成することで、`scripts/restart-node.sh` は「ノード群の一部だけを
手早く再起動したい」場合の補助という位置づけ。

### ワークベンチから RPC を叩く

```sh
docker compose exec workbench sh
# 以下はコンテナ内。ETH_RPC_URL は compose、mnemonic(EL_AND_CL_MNEMONIC)は
# values.env を env_file で読み込み済み
cast chain-id
cast block-number
cast balance $(cast wallet address --mnemonic "$EL_AND_CL_MNEMONIC" --mnemonic-index 0) --ether
# 送金(プリマイン済みアカウントから)
cast send --mnemonic "$EL_AND_CL_MNEMONIC" --mnemonic-index 0 \
  --value 1ether 0x8943545177806ED17B9F23F0a21ee5948eCaa776
```

`workbench` はチェーンと同じ mnemonic を持ち、そこから導出した 8 アカウントが
genesis でプリマインされている(導出パスは Foundry 既定と同じ
`m/44'/60'/0'/0/N`)。

`ETH_RPC_URL` は reth1 直接ではなく **ロギングプロキシ経由**(`http://host.docker.internal:4001`)
を指す(後述「ワークベンチの RPC 観測(ロギングプロキシ)」)。**プロキシは
collector プロセスがホスト上のポート 4001 で提供する**ため、上記の `cast`
コマンドを成功させるには collector(のプロキシ)がホスト側で起動している
必要がある。起動していない場合、ワークベンチからの RPC は
`Connection refused`(host:4001)で失敗する。

## genesis の扱い

genesis.json(EL)と genesis.ssz / config.yaml(CL)は **生成時刻を埋め込む**
ため、静的ファイルとしてコミットせず、`genesis` サービスが起動時に現在時刻で
生成する。生成の入力(= 実質的な「genesis 設定ファイル」)は次の 2 つ:

- `values.env` — バリデーター数・slot time・フォークスケジュール等の設定
- `scripts/generate-genesis.sh` — 生成手順(EL/CL genesis + バリデーター鍵)

生成物は `genesis` という共有ボリュームに置かれ、全ノードがマウントして
共有する。これは `docs/CONCEPT.md`「新規ノード追加時の P2P 参加方法」で
言う「genesis はノード環境テンプレートの静的ファイルをマウントして共有」に
対応する(共有ボリュームの中身がその静的ファイルの実体)。

### 冪等性(Issue #56)

genesis の生成は **共有ボリュームに対して初回だけ** 行う。`generate-genesis.sh`
は生成完了時に共有ボリュームへマーカー(`/data/.genesis-complete`)を残し、
次回以降はそれを検出して再生成をスキップする。これにより、既にスタックが
稼働中の状態で `docker compose up -d` を再実行しても genesis が新しい
タイムスタンプで上書きされず、既存ノードと genesis ハッシュが食い違う事故
(EL 間 P2P ハンドシェイク失敗)を防ぐ。あとから追加したノードも既存ノードと
同一の genesis で init される。

まっさらな chain で始めたいときは `docker compose down -v` で共有ボリュームを
破棄する。マーカーごと消えるため、次回起動時に genesis が再生成される。

生成が途中で失敗した場合はマーカーが書かれないため、次回起動時にやり直しに
なる(半端な生成物のまま起動することはない)。

冪等になったのは共有ボリューム上の genesis ファイル自体であり、**各ノードの
データディレクトリは従来どおり起動のたびに初期化される**(`reth-node.sh`等の
`rm -rf /data/*`相当の処理は変わらない)。また`docker compose down`(`-v`を
付けない場合)は共有ボリュームを残すため、`up`し直しても同じタイムスタンプの
genesisがそのまま使われる。

## P2P 接続について

- **CL(合意層)の P2P は接続済み**。`beacon1` が bootnode として自分の ENR を
  共有ボリューム(`clpeer`)へ書き出し、`beacon2` がそれを読んで接続する。
  これにより 2 ノードが単一の chain として合意する(片方だけだと fork する)。
- **EL(reth)同士の P2P も接続済み**。CL と同じファイル共有方式で、`reth1` が
  bootnode として自分の enode を共有ボリューム(`elpeer`)へ書き出し、`reth2`
  以降がそれを読んで `--trusted-peers` / `--bootnodes` で接続する。これにより
  チェーン進行後に参加した新規 reth が、既存ノードから欠けている履歴ブロックを
  devp2p でバックフィルできる(CL の Engine API は最新ヘッドしか渡さないため、
  祖先ブロックを持たない新規ノードは EL 間 P2P が無いと追従できない)。
  - `reth1` の enode は決定的にするため、`reth-node.sh` に固定の p2p 秘密鍵と
    そこから導出した公開鍵を定数として持たせている(使い捨て devnet 用の値。
    `RETH_ROLE=boot` のノードだけがこの鍵を使う)。
  - 副作用として EL 間の tx gossip(pending tx の相互伝播)も同時に有効になる。
    reth ではブロック同期だけを分離して有効化できないため許容している。

## ワークベンチの RPC 観測(ロギングプロキシ)

ワークベンチの RPC 呼び出しを可視化するため、ワークベンチは reth1 を直接
叩かず **ロギングプロキシ経由** で接続する(`docs/CONCEPT.md`「ユーザー操作
マシン(ワークベンチ)の投影」の決定)。プロキシは受け取った RPC 呼び出しを
ログに残しつつ、そのまま reth1 へ転送する。

- **プロキシの実体は collector プロセス**。collector がホスト上のポート 4001 で
  待ち受ける(collector 本体の WebSocket サーバーは 4000 番、プロキシは
  4001 番)。プロキシ自体の実装は collector 側の担当
  ([#79](https://github.com/morichikawa/chainviz/issues/79))であり、この
  プロファイルは接続先を向けるだけ。
- **コンテナからホストへの到達経路**: プロキシはコンテナではなくホスト上の
  プロセスなので、ワークベンチコンテナからは Docker ネットワーク内の名前解決
  では届かない。`docker-compose.yml` の workbench に
  `extra_hosts: ["host.docker.internal:host-gateway"]` を付け、
  `ETH_RPC_URL=http://host.docker.internal:4001` を指す。`host-gateway` は
  Docker 20.10+ の機能で、`host.docker.internal` をホスト IP(Docker Engine の
  デフォルトブリッジのゲートウェイ、通常 `172.17.0.1`)へ解決する。Linux の
  Docker Engine でも機能することをこの環境で `cast chain-id` の疎通により
  実測確認済み。
  - 代替として `chain` ネットワーク(`172.28.0.0/16`)のゲートウェイ IP
    `172.28.0.1` を直接指す方法もあるが、サブネット定義に依存して壊れやすい
    ため、サブネットに依存しない `host.docker.internal` を採用している。
- **前提**: プロキシは collector が提供するため、ワークベンチからの RPC を
  成功させるには collector(のプロキシ)がホスト側で起動している必要がある。
  起動していない場合は `Connection refused`(host:4001)になる。`profiles`
  単体で `docker compose up` してもワークベンチの `cast` は collector
  なしでは通らない点に注意(チェーン自体は起動・進行する)。

## ノードを増やすには(2 → 3)

1. `values.env` の `NODE_COUNT` を 3 にする(バリデーター鍵が 3 分割される)。
2. `docker-compose.yml` に `reth3 / beacon3 / validator3` を追加する。
   - `reth3` は `reth2` と同じく `RETH_ROLE: peer` で enode を共有ボリューム
     (`elpeer`)から読む。`elpeer:/elpeer:ro` をマウントし、`RETH_P2P_IP` に
     自分の固定 IP を渡す。
   - `beacon3` は `beacon2` と同じく `BEACON_ROLE: peer` で ENR を共有ボリューム
     から読む。`validator3` は `KEYS_DIR: /genesis/keys/node2` を指す。
3. 固定 IP(`ENR_ADDRESS` / `RETH_P2P_IP`)が既存ノードと重複しないよう割り当てる。
