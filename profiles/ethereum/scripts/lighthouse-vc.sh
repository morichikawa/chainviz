#!/bin/sh
# lighthouse validator client(バリデーター)起動スクリプト。
#
# 環境変数:
#   KEYS_DIR       このノードが担当するバリデーター鍵のディレクトリ
#                  (例 /genesis/keys/node0。keys/ と secrets/ を含む)
#   BEACON_NODE    接続先 beacon node の HTTP API(例 http://beacon1:5052)
#   FEE_RECIPIENT  ブロック提案時の手数料受取アドレス
#
# genesis 共有ボリュームは read-only なので、鍵を書き込み可能な datadir へ
# 複製してから起動する(slashing protection DB もそこに置かれる)。
set -e

echo "[validator] データディレクトリを初期化"
rm -rf /data/*
mkdir -p /data/validators /data/secrets
cp -r "${KEYS_DIR}/keys/." /data/validators/
cp -r "${KEYS_DIR}/secrets/." /data/secrets/

echo "[validator] 起動(接続先: ${BEACON_NODE})"
exec lighthouse vc \
  --testnet-dir /genesis/metadata \
  --datadir /data \
  --beacon-nodes "${BEACON_NODE}" \
  --init-slashing-protection \
  --suggested-fee-recipient "${FEE_RECIPIENT}"
