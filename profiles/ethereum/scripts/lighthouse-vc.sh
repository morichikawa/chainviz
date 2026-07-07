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

# --- watchdog(Issue #148: 長時間停止からの自動復旧) ---
#
# validator はハートビートの書き出し・poison マーカーの書き出しは行わない
# (generate-genesis.sh の再生成判断は reth-node.sh / lighthouse-bn.sh が
# 書く /heartbeat だけを見るため、validator の生存有無は判断に影響しない)。
# しかし validator 自体はサスペンド後に自己停止させる必要がある。これを
# 怠ると、レジューム後に beacon だけが self-stop → 次の up で genesis が
# 再生成された際、止まらず生き残った validator が古い
# genesis_validators_root のまま署名を続けてしまい、チェーンが不健全に
# なる(docs/worklog/issue-148.md「3-3」)。
# しきい値の根拠は同ドキュメント「3-4」参照(reth-node.sh 等と共通)。
HEARTBEAT_INTERVAL_SEC="${HEARTBEAT_INTERVAL_SEC:-10}"
GENESIS_SUSPEND_DETECT_SEC="${GENESIS_SUSPEND_DETECT_SEC:-600}"
(
  prev="$(date +%s)"
  while true; do
    sleep "$HEARTBEAT_INTERVAL_SEC"
    now="$(date +%s)"
    delta=$(( now - prev ))
    if [ "$delta" -gt "$GENESIS_SUSPEND_DETECT_SEC" ]; then
      echo "[validator-watchdog] ${delta}秒の空白を検知(閾値 ${GENESIS_SUSPEND_DETECT_SEC}秒)。サスペンドと判断し自ノードを停止する"
      kill -TERM 1
      exit 0
    fi
    prev="$now"
  done
) &

echo "[validator] 起動(接続先: ${BEACON_NODE})"
exec lighthouse vc \
  --testnet-dir /genesis/metadata \
  --datadir /data \
  --beacon-nodes "${BEACON_NODE}" \
  --init-slashing-protection \
  --suggested-fee-recipient "${FEE_RECIPIENT}"
