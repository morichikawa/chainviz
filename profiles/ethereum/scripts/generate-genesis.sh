#!/bin/sh
# genesis 生成スクリプト(ethpandaops/ethereum-genesis-generator イメージ内で実行)
#
# EL(reth)用 genesis.json と CL(lighthouse)用 genesis.ssz / config.yaml、
# jwtsecret、バリデーター鍵を共有ボリューム /data に生成する。
# genesis 時刻を「現在時刻」で埋め込むため、docker compose 起動のたびに
# 前回分を破棄して作り直す(古い genesis 時刻での起動を防ぐ)。
set -e

GEN=/data/metadata
KEYS=/data/keys

echo "[generate] 前回の生成物を破棄"
rm -rf /data/metadata /data/jwt /data/keys /data/parsed

echo "[generate] EL + CL genesis を生成(genesis 時刻 = 現在時刻)"
export GENESIS_TIMESTAMP="$(date +%s)"
/work/entrypoint.sh all

# lighthouse の testnet-dir が要求するファイル名を用意する。
# generator は deposit_contract_block.txt を作るが lighthouse は
# deploy_block.txt を見る。boot_enr.yaml は空でよい(bootnode は
# 起動時に beacon ノード間で受け渡す。lighthouse-bn.sh を参照)。
cp "$GEN/deposit_contract_block.txt" "$GEN/deploy_block.txt"
echo "[]" > "$GEN/boot_enr.yaml"

# generator と同じ手順で mnemonic 等を解決する(defaults → values.env の順)。
. /defaults/defaults.env
[ -f /config/values.env ] && . /config/values.env

# NUMBER_OF_VALIDATORS 個のバリデーター鍵を NODE_COUNT ノードに均等分割し、
# node0, node1, ... 別ディレクトリに lighthouse 形式(keys/ + secrets/)で出力する。
NODE_COUNT="${NODE_COUNT:-1}"
TOTAL="${NUMBER_OF_VALIDATORS}"
PER=$(( TOTAL / NODE_COUNT ))

echo "[generate] バリデーター鍵を導出: 合計 ${TOTAL} を ${NODE_COUNT} ノードに分割(各 ${PER})"
i=0
while [ "$i" -lt "$NODE_COUNT" ]; do
  MIN=$(( i * PER ))
  if [ "$i" -eq $(( NODE_COUNT - 1 )) ]; then
    MAX="$TOTAL"          # 端数はすべて最終ノードへ
  else
    MAX=$(( MIN + PER ))
  fi
  echo "[generate]   node${i}: バリデーター ${MIN}..$(( MAX - 1 ))"
  eth2-val-tools keystores --insecure \
    --source-mnemonic "$EL_AND_CL_MNEMONIC" \
    --source-min "$MIN" --source-max "$MAX" \
    --out-loc "$KEYS/node${i}"
  i=$(( i + 1 ))
done

echo "[generate] 完了"
