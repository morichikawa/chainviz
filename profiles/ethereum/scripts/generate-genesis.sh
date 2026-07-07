#!/bin/sh
# genesis 生成スクリプト(ethpandaops/ethereum-genesis-generator イメージ内で実行)
#
# EL(reth)用 genesis.json と CL(lighthouse)用 genesis.ssz / config.yaml、
# jwtsecret、バリデーター鍵を共有ボリューム /data に生成する。
# genesis 時刻を「現在時刻」で埋め込む。
#
# 冪等性: 共有ボリューム上に生成済みの genesis 一式が既に存在し、かつ
# スタックが稼働中だったと判断できる場合は、何もせずに終了する。稼働中
# スタックに `docker compose up -d` を再実行しても genesis サービスが再走
# して新しいタイムスタンプで上書きしてしまい、既存ノードと genesis
# ハッシュが食い違う事故を防ぐ(Issue #56)。
#
# 一方、全ノードが一定時間以上停止していた(PC のシャットダウン・サスペンド
# 等)と判断できる場合は、genesis を現在時刻で自動的に作り直す。genesis
# 生成時刻に対して実時間が進み続ける PoS チェーンの性質上、長い空白の後は
# 空き slot の再構築が実時間に追いつけずハングするため(詳細・しきい値の
# 根拠は docs/worklog/issue-148.md)。稼働中か停止していたかは、各ノードが
# 書き出す生存報告(`/heartbeat/<ノード名>` の更新時刻)で判定する。
#
# まっさらな chain で始めたい場合は `docker compose down -v` でボリュームごと
# 破棄すれば、次回起動時に再生成される(こちらは常に有効な手動リセット)。
set -e

GEN=/data/metadata
KEYS=/data/keys
# 生成完了を示すマーカー。生成処理の最後に書き出す。途中で失敗した実行は
# マーカーを残さないため、次回はやり直しになる(半端な生成物での起動を防ぐ)。
DONE_MARKER=/data/.genesis-complete

# --- 停止検知のしきい値(Issue #148) ---
# 根拠は docs/worklog/issue-148.md「3-4. しきい値と、その前提」参照。
# 環境変数で上書き可能(実機検証・QA で待ち時間を短縮するため)。
#   GENESIS_LIVE_THRESHOLD_SEC(既定 60秒):
#     直近この秒数以内に生存報告があれば「稼働中」とみなす。ハートビート
#     間隔(10秒)の6倍でジッタ耐性を持つ。誤判定(生きているのに stale
#     扱い)しても、失われるものが無い再生成が走るだけなので安全側。
#   GENESIS_DOWNTIME_RESET_SEC(既定 600秒 = 300 slot分):
#     これを超える空白は全ノード停止とみなし再生成する。#139 の QA 実測
#     (20 vCPU で 1350 slot を約90秒で追いつき、ハングは3200 slot以上での
#     み観測)を踏まえ、観測ハング点の1/10以下に取った安全側の値。
LIVE_THRESHOLD_SEC="${GENESIS_LIVE_THRESHOLD_SEC:-60}"
RESET_GRACE_SEC="${GENESIS_DOWNTIME_RESET_SEC:-600}"

HEARTBEAT_DIR=/heartbeat
POISON_MARKER_NAME=suspend-detected
POISON_MARKER="${HEARTBEAT_DIR}/${POISON_MARKER_NAME}"

# /heartbeat 配下(poison マーカーを除く)の最新更新時刻(epoch 秒、整数)を
# 出力する。対象が無ければ何も出力しない(呼び出し側で「生存報告なし」として
# 扱う)。generator イメージ(Debian)の GNU find/coreutils を前提にした実装
# (busybox 等の非 GNU 環境では動かないので流用時は要確認)。
latest_heartbeat_epoch() {
  [ -d "$HEARTBEAT_DIR" ] || return 0
  find "$HEARTBEAT_DIR" -mindepth 1 -maxdepth 1 -type f \
    ! -name "$POISON_MARKER_NAME" \
    -printf '%T@\n' 2>/dev/null | cut -d. -f1 | sort -rn | head -1
}

# 再生成するかどうかを判断し、理由を必ずログに出す(無言で分岐しない)。
# 戻り値: 0 = 再生成する / 1 = スキップする。
should_regenerate() {
  if [ ! -f "$DONE_MARKER" ]; then
    echo "[generate] 生成済みマーカー無し。初回生成として扱う。"
    return 0
  fi

  latest="$(latest_heartbeat_epoch)"
  now="$(date +%s)"
  if [ -z "$latest" ]; then
    age_sec=""
    age_desc="(不明: ハートビートファイルが1つも無い)"
  else
    age_sec=$(( now - latest ))
    age_desc="${age_sec}秒"
  fi

  if [ -f "$POISON_MARKER" ]; then
    # サスペンド watchdog(reth-node.sh / lighthouse-bn.sh)が書いた特例
    # マーカー。RESET_GRACE を待たず LIVE_THRESHOLD で再生成する(3-3)。
    if [ -z "$age_sec" ] || [ "$age_sec" -gt "$LIVE_THRESHOLD_SEC" ]; then
      echo "[generate] サスペンド検知マーカー(${POISON_MARKER})を検出。最新ハートビートの経過 ${age_desc} > LIVE_THRESHOLD(${LIVE_THRESHOLD_SEC}秒)。全ノード停止とみなし再生成する。"
      return 0
    fi
    echo "[generate] サスペンド検知マーカーはあるが、最新ハートビートの経過 ${age_desc} <= LIVE_THRESHOLD(${LIVE_THRESHOLD_SEC}秒)。まだ生存中のノードがあるとみなし再生成せずスキップする(警告: レジューム未完了のノードが残っている可能性)。"
    return 1
  fi

  if [ -z "$age_sec" ]; then
    echo "[generate] ハートビートファイルが1つも無く生存判定ができない。安全側として再生成する。"
    return 0
  fi

  if [ "$age_sec" -le "$LIVE_THRESHOLD_SEC" ]; then
    echo "[generate] 最新ハートビートの経過 ${age_desc} <= LIVE_THRESHOLD(${LIVE_THRESHOLD_SEC}秒)。生存ノードありとみなし再生成をスキップする(Issue #56 の保護)。"
    return 1
  fi

  if [ "$age_sec" -gt "$RESET_GRACE_SEC" ]; then
    echo "[generate] 最新ハートビートの経過 ${age_desc} > RESET_GRACE(${RESET_GRACE_SEC}秒)。全ノードが長時間停止していたとみなし再生成する。"
    return 0
  fi

  echo "[generate] 最新ハートビートの経過 ${age_desc} は LIVE_THRESHOLD(${LIVE_THRESHOLD_SEC}秒)超・RESET_GRACE(${RESET_GRACE_SEC}秒)以下。短時間の停止とみなし再生成をスキップする(空き slot の再構築はノード側に任せる。#139 で検証済みの領域)。"
  return 1
}

if ! should_regenerate; then
  echo "[generate] 既存の genesis を再利用する。作り直すには 'docker compose down -v' でボリュームを破棄すること。"
  exit 0
fi

echo "[generate] 前回の生成物を破棄"
rm -rf /data/metadata /data/jwt /data/keys /data/parsed "$DONE_MARKER"
# down -v 相当のクリーンさにするため、bootnode の enode/ENR 受け渡しと
# ハートビート(poison マーカー含む)も一掃する(genesis サービスの
# clpeer/elpeer/heartbeat マウントは docker-compose.yml で rw にしてある)。
rm -f /clpeer/boot.enr /elpeer/boot.enode
if [ -d "$HEARTBEAT_DIR" ]; then
  find "$HEARTBEAT_DIR" -mindepth 1 -delete 2>/dev/null || true
fi

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

# すべて成功したときだけ完了マーカーを書く。以降の起動はこのマーカーを見て
# 再生成をスキップする(冪等性)。
touch "$DONE_MARKER"
echo "[generate] 完了"
