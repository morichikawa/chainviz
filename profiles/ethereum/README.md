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
| `genesis`    | genesis 一式を生成して終了(1 回だけ実行)  | ethpandaops/ethereum-genesis-generator |
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

## genesis の扱い

genesis.json(EL)と genesis.ssz / config.yaml(CL)は **生成時刻を埋め込む**
ため、静的ファイルとしてコミットせず、`docker compose up` のたびに `genesis`
サービスが現在時刻で生成し直す。生成の入力(= 実質的な「genesis 設定
ファイル」)は次の 2 つ:

- `values.env` — バリデーター数・slot time・フォークスケジュール等の設定
- `scripts/generate-genesis.sh` — 生成手順(EL/CL genesis + バリデーター鍵)

生成物は `genesis` という共有ボリュームに置かれ、全ノードがマウントして
共有する。これは `docs/CONCEPT.md`「新規ノード追加時の P2P 参加方法」で
言う「genesis はノード環境テンプレートの静的ファイルをマウントして共有」に
対応する(共有ボリュームの中身がその静的ファイルの実体)。

ノードのデータディレクトリも起動時に毎回初期化する。つまり `up` するたびに
まっさらな chain で始まる(devnet として想定どおりの挙動)。

## P2P 接続について

- **CL(合意層)の P2P は接続済み**。`beacon1` が bootnode として自分の ENR を
  共有ボリューム(`clpeer`)へ書き出し、`beacon2` がそれを読んで接続する。
  これにより 2 ノードが単一の chain として合意する(片方だけだと fork する)。
- **EL(reth)同士の P2P はこの段階では張っていない**。ブロックは CL が
  Engine API 経由で各 EL に渡すため、両 EL の canonical chain は一致する。
  mempool の相互伝播(pending tx の gossip)が必要になる Phase 3 で追加する。

## この段階で意図的に入れていないもの

- **ロギングプロキシ**(ワークベンチ RPC 観測用): `docs/PLAN.md` の方針どおり
  Phase 3 で collector 側と合わせて追加する。現状ワークベンチは reth1 の RPC を
  直接叩く。
- **EL 間の tx gossip**: 上記のとおり Phase 3 で追加。

## ノードを増やすには(2 → 3)

1. `values.env` の `NODE_COUNT` を 3 にする(バリデーター鍵が 3 分割される)。
2. `docker-compose.yml` に `reth3 / beacon3 / validator3` を追加する。
   `beacon3` は `beacon2` と同じく `BEACON_ROLE: peer` で ENR を共有ボリューム
   から読む。`validator3` は `KEYS_DIR: /genesis/keys/node2` を指す。
3. 固定 IP(`ENR_ADDRESS`)が既存ノードと重複しないよう割り当てる。
