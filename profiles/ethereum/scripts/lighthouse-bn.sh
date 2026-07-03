#!/bin/sh
# lighthouse beacon node(合意クライアント / CL)起動スクリプト。
#
# 環境変数:
#   ENR_ADDRESS         このノードの ENR に載せる IP(docker 固定 IP)
#   EXECUTION_ENDPOINT  対になる reth の Engine API(例 http://reth1:8551)
#   BEACON_ROLE         "boot"  = bootnode。自分の ENR を共有ボリュームに書き出す
#                       "peer"  = 上記 ENR を bootnode として起動する
#
# CL の P2P bootstrap は「boot ノードが起動時に生成した ENR を共有ボリューム
# 経由で peer ノードへ渡す」方式で行う。ノードイメージに HTTP クライアントが
# 無いため、lighthouse が書き出す enr.dat をファイルとして受け渡す。
set -e
# COMMON を単語分割で引数へ展開する際に、'*'(--http-allow-origin の値)が
# カレントディレクトリのファイル名に glob 展開されないよう glob を無効化する。
set -f

echo "[beacon] データディレクトリを初期化"
rm -rf /data/*
mkdir -p /data

BOOT_ENR_FILE=/clpeer/boot.enr

COMMON="--testnet-dir /genesis/metadata \
  --datadir /data \
  --execution-endpoint ${EXECUTION_ENDPOINT} \
  --execution-jwt /genesis/jwt/jwtsecret \
  --http --http-address 0.0.0.0 --http-port 5052 --http-allow-origin * \
  --listen-address 0.0.0.0 --port 9000 \
  --enr-address ${ENR_ADDRESS} --enr-udp-port 9000 --enr-tcp-port 9000 \
  --subscribe-all-subnets \
  --disable-packet-filter \
  --allow-insecure-genesis-sync"

if [ "$BEACON_ROLE" = "boot" ]; then
  # 古い ENR を消し、lighthouse が新しい enr.dat を書いたら共有ボリュームへ複製
  rm -f "$BOOT_ENR_FILE"
  (
    until [ -f /data/beacon/network/enr.dat ]; do sleep 1; done
    cp /data/beacon/network/enr.dat "$BOOT_ENR_FILE"
    echo "[beacon] bootnode ENR を公開: $(cat "$BOOT_ENR_FILE")"
  ) &
  echo "[beacon] bootnode として起動"
  exec lighthouse bn $COMMON
else
  echo "[beacon] bootnode ENR を待機"
  until [ -f "$BOOT_ENR_FILE" ]; do sleep 1; done
  BOOT_ENR="$(cat "$BOOT_ENR_FILE")"
  echo "[beacon] bootnode ENR を取得: $BOOT_ENR"
  exec lighthouse bn $COMMON --boot-nodes "$BOOT_ENR"
fi
