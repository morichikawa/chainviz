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
#
# --ignore-ws-check(Issue #139):
#   このスクリプトは起動のたびに /data を初期化して genesis からやり直すため
#   (下記参照)、genesis 生成時刻から実時間で weak subjectivity period
#   (このプロファイルの設定では概算 4.6 時間。256 epoch という mainnet
#   プリセット固定値 + わずかな churn 猶予を、slot time 2 秒で秒数換算した値)
#   を超えて `docker compose up -d` すると、lighthouse が
#   "the current head state is outside the weak subjectivity period" という
#   CRIT で起動を拒否する(長時間の PC シャットダウン・スリープ後に再起動
#   しようとした場合など)。chainviz は外部非公開の使い捨てローカル学習用
#   環境であり、long range attack のリスクは実質的に無関係なため、この
#   安全チェックを意図的に無効化する。既知のリスク・トレードオフ、および
#   このフラグだけでは救えないケース(genesis からの経過時間が長すぎる場合、
#   起動はするがブロック生成が再開しないまま高 CPU 負荷でハングし続ける
#   ことを実機検証で確認済み)は docs/worklog/issue-139.md を参照。
set -e
# COMMON を単語分割で引数へ展開する際に、'*'(--http-allow-origin の値)が
# カレントディレクトリのファイル名に glob 展開されないよう glob を無効化する。
set -f

echo "[beacon] データディレクトリを初期化"
# /data はボリュームマウントなしで起動される場合(chainvizのaddNodeで動的に
# 追加するコンテナなど)は存在しないことがあるため、find の前に作成しておく
# (mkdir -p は既存でも無害)。
# set -f 下では '/data/*' が glob 展開されず、リテラルの '*' を消そうとして
# 実データが残る。glob に依存しない find で、隠しファイル(lighthouse の
# *.lock 等)も含めて確実に初期化する。
mkdir -p /data
find /data -mindepth 1 -delete

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
  --allow-insecure-genesis-sync \
  --ignore-ws-check"

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
