#!/bin/sh
# reth(実行クライアント / EL)起動スクリプト。
# genesis 共有ボリュームから genesis.json と jwtsecret を読み、
# データディレクトリを作り直して(毎回まっさらな chain で起動)ノードを立てる。
#
# 環境変数:
#   RETH_ROLE     "boot" = bootnode。自分の enode を共有ボリュームへ書き出す
#                 それ以外(未設定含む) = peer。上記 enode を読んで接続する
#   RETH_P2P_IP   このノードが devp2p で広告する IP(docker 固定 IP)。
#                 boot は必須(広告 enode に載る)。peer は任意
#                 (未設定なら外向き接続のみで動く)
#
# EL(reth)同士は devp2p(RLPx)で接続する。ブロックは合意層(lighthouse)が
# Engine API で各 EL に渡すが、チェーン進行後に新規参加した EL は過去ブロックを
# 持たないため engine_newPayload を実行できない。そこで EL 間 P2P を張り、
# 新規ノードが既存ノードから履歴ブロックをバックフィルできるようにする。
# 副作用として EL 間の tx gossip も有効になる(reth ではブロック同期だけを
# 分離して有効化できないため)。
#
# bootstrap は CL(lighthouse-bn.sh)と同じファイル共有方式で行う。boot ノードは
# 自分の enode を共有ボリューム(/elpeer)へ書き出し、peer ノードはそれを読んで
# --trusted-peers / --bootnodes に渡す。ノードイメージに HTTP クライアントが
# 無く admin_nodeInfo を RPC 越しに取得できないため、enode をファイルで受け渡す。
#
# boot ノードの enode は決定的にする(peer が exec を保ったまま enode を
# 構築・待受できるようにするため)。boot は固定の p2p 秘密鍵を使い、そこから
# 導出される公開鍵(= enode の pubkey 部)を定数として持つ。これは使い捨て
# devnet 用の値であり、values.env の mnemonic 等と同様に固定値でよい。
# 秘密鍵を変えた場合は下記 pubkey も再導出して更新すること
# (reth node --dev --p2p-secret-key <鍵> --nat extip:<IP> のログに出る enode)。
set -e

# boot ノードの固定 p2p 秘密鍵と、そこから決定的に導出される enode 公開鍵。
RETH_BOOT_P2P_KEY="2222222222222222222222222222222222222222222222222222222222222222"
RETH_BOOT_PUBKEY="466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f276728176c3c6431f8eeda4538dc37c865e2784f3a9e77d044f33e407797e1278a"

BOOT_ENODE_FILE=/elpeer/boot.enode

echo "[reth] データディレクトリを初期化"
rm -rf /data/*
reth init --chain /genesis/metadata/genesis.json --datadir /data

# 広告 IP(指定があれば nat extip として渡す)
NAT_OPT=""
if [ -n "$RETH_P2P_IP" ]; then
  NAT_OPT="--nat extip:${RETH_P2P_IP}"
fi

# 共通の起動オプション。'*'(cors/origins の値)が glob 展開されないよう無効化する。
set -f
COMMON="--chain /genesis/metadata/genesis.json \
  --datadir /data \
  --http --http.addr 0.0.0.0 --http.port 8545 \
  --http.api eth,net,web3,txpool,admin,debug \
  --http.corsdomain * \
  --ws --ws.addr 0.0.0.0 --ws.port 8546 \
  --ws.api eth,net,web3,txpool \
  --ws.origins * \
  --authrpc.addr 0.0.0.0 --authrpc.port 8551 \
  --authrpc.jwtsecret /genesis/jwt/jwtsecret \
  --port 30303 \
  --color never \
  ${NAT_OPT}"

if [ "$RETH_ROLE" = "boot" ]; then
  if [ -z "$RETH_P2P_IP" ]; then
    echo "[reth] boot ノードには RETH_P2P_IP が必須" >&2
    exit 1
  fi
  # 固定鍵を書き出し、決定的な enode を共有ボリュームへ公開してから起動する。
  printf '%s' "$RETH_BOOT_P2P_KEY" > /data/p2p-secret
  BOOT_ENODE="enode://${RETH_BOOT_PUBKEY}@${RETH_P2P_IP}:30303"
  mkdir -p /elpeer
  printf '%s' "$BOOT_ENODE" > "$BOOT_ENODE_FILE"
  echo "[reth] bootnode enode を公開: $BOOT_ENODE"
  echo "[reth] bootnode として起動"
  exec reth node $COMMON --p2p-secret-key /data/p2p-secret
else
  echo "[reth] bootnode enode を待機"
  until [ -f "$BOOT_ENODE_FILE" ]; do sleep 1; done
  BOOT_ENODE="$(cat "$BOOT_ENODE_FILE")"
  echo "[reth] bootnode enode を取得: $BOOT_ENODE"
  echo "[reth] peer として起動"
  exec reth node $COMMON \
    --trusted-peers "$BOOT_ENODE" \
    --bootnodes "$BOOT_ENODE"
fi
