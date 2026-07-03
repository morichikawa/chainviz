#!/bin/sh
# reth(実行クライアント / EL)起動スクリプト。
# genesis 共有ボリュームから genesis.json と jwtsecret を読み、
# データディレクトリを作り直して(毎回まっさらな chain で起動)ノードを立てる。
#
# ブロックは合意層(lighthouse)が Engine API 経由で渡すため、この段階では
# EL 同士の P2P(tx gossip)は張らない。mempool の相互伝播が要る Phase 3 で
# 追加する。
set -e

echo "[reth] データディレクトリを初期化"
rm -rf /data/*
reth init --chain /genesis/metadata/genesis.json --datadir /data

echo "[reth] ノード起動"
exec reth node \
  --chain /genesis/metadata/genesis.json \
  --datadir /data \
  --http --http.addr 0.0.0.0 --http.port 8545 \
  --http.api "eth,net,web3,txpool,admin,debug" \
  --http.corsdomain "*" \
  --ws --ws.addr 0.0.0.0 --ws.port 8546 \
  --ws.api "eth,net,web3,txpool" \
  --ws.origins "*" \
  --authrpc.addr 0.0.0.0 --authrpc.port 8551 \
  --authrpc.jwtsecret /genesis/jwt/jwtsecret \
  --port 30303 \
  --disable-discovery \
  --color never
