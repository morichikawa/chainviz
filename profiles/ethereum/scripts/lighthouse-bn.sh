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
# --ignore-ws-check(Issue #139、Issue #148 で前提が変わった点に注意):
#   このスクリプトは起動のたびに /data を初期化して genesis からやり直すため
#   (下記参照)、genesis 生成時刻から実時間で weak subjectivity period
#   (このプロファイルの設定では概算 4.6 時間。256 epoch という mainnet
#   プリセット固定値 + わずかな churn 猶予を、slot time 2 秒で秒数換算した値)
#   を超えて `docker compose up -d` すると、lighthouse が
#   "the current head state is outside the weak subjectivity period" という
#   CRIT で起動を拒否する。chainviz は外部非公開の使い捨てローカル学習用
#   環境であり、long range attack のリスクは実質的に無関係なため、この
#   安全チェックを意図的に無効化する。
#
#   Issue #148 で generate-genesis.sh がスタック全体の長時間停止(既定10分
#   超)を検知して genesis を自動再生成するようになったため、通常の
#   `docker compose down` → `up` の流れではこの CRIT はほぼ発生しなくなった
#   (genesis 時刻が都度引き直されるため)。ただし `restart-node.sh` による
#   稼働中スタックへの単体ノード再起動では genesis サービスが走らず再生成
#   されないため、長時間稼働中のスタックに対しては従来どおり genesis が
#   古いままで CRIT になり得る。このフラグはそのパスの保険として維持する。
#
#   このフラグだけでは救えないケースも残る: genesis からの経過時間が長い
#   ほど、起動時に genesis から現在の slot まで空きスロットを再構築する
#   処理量が増える。この処理が実時間の slot 進行に追いつけないほど経過時間が
#   長いと、起動はするもののブロック生成が再開しないまま高 CPU 負荷で
#   ハングし続けることを実機検証で確認済み(docs/worklog/issue-139.md)。
#   Issue #148 の自動再生成はこのケースの発生条件(全ノードが10分以上停止)
#   を検知して genesis 時刻を引き直すことで回避する(docs/worklog/issue-148.md)。
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

# --- ハートビート + watchdog(Issue #148: 長時間停止からの自動復旧) ---
#
# generate-genesis.sh が「スタック全体が停止していたか」を判定するための
# 生存信号を /heartbeat/<自分の識別名> に書き出し続ける。加えて、稼働した
# まま PC がサスペンドした場合に自ノードを止める watchdog も兼ねる。
# しきい値の根拠は docs/worklog/issue-148.md「3-4. しきい値と、その前提」
# 参照:
#   HEARTBEAT_INTERVAL_SEC(既定10秒) — LIVE_THRESHOLD(60秒)の1/6。
#     touch のみなのでコストは無視できる
#   GENESIS_SUSPEND_DETECT_SEC(既定600秒) — 10秒間隔のループがこれだけ
#     止まるのはサスペンド/`docker pause` 以外にありえない(通常の
#     スケジューラのジッタは高々数秒)
#
# /heartbeat がマウントされていない場合(collector の addNode で動的追加
# されたコンテナは heartbeat ボリュームを持たない)は、ループをスキップした
# 旨を1行ログに出して続行する(set -e でコンテナが死なないようガードする)。
#
# ハートビートファイル名は判定(最新 mtime)に使うだけなので命名は自由だが、
# docker compose のデフォルトのコンテナホスト名はコンテナ再作成のたびに
# 変わる短い ID になり読みづらい(実機確認済み)。HEARTBEAT_NODE_NAME
# (docker-compose.yml で beacon1 等のサービス名を渡す)があればそちらを使い、
# 無ければ hostname にフォールバックする。
HEARTBEAT_DIR=/heartbeat
HEARTBEAT_INTERVAL_SEC="${HEARTBEAT_INTERVAL_SEC:-10}"
GENESIS_SUSPEND_DETECT_SEC="${GENESIS_SUSPEND_DETECT_SEC:-600}"

if [ -d "$HEARTBEAT_DIR" ] && [ -w "$HEARTBEAT_DIR" ]; then
  HEARTBEAT_FILE="${HEARTBEAT_DIR}/${HEARTBEAT_NODE_NAME:-$(hostname)}"
  (
    prev="$(date +%s)"
    while true; do
      touch "$HEARTBEAT_FILE" 2>/dev/null || true
      sleep "$HEARTBEAT_INTERVAL_SEC"
      now="$(date +%s)"
      delta=$(( now - prev ))
      if [ "$delta" -gt "$GENESIS_SUSPEND_DETECT_SEC" ]; then
        # サスペンドと判断。ハートビートは触らず stale なままにし、
        # poison マーカーだけを書いて自ノードを止める。次回 up 時に
        # generate-genesis.sh がこのマーカーを見て再生成する(3-3)。
        echo "[beacon-heartbeat] ${delta}秒の空白を検知(閾値 ${GENESIS_SUSPEND_DETECT_SEC}秒)。サスペンドと判断し自ノードを停止する"
        touch "${HEARTBEAT_DIR}/suspend-detected" 2>/dev/null || true
        kill -TERM 1
        exit 0
      fi
      prev="$now"
    done
  ) &
else
  echo "[beacon-heartbeat] ${HEARTBEAT_DIR} が無い/書き込めない(動的追加ノード等)ためハートビート/watchdogをスキップする"
fi

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
