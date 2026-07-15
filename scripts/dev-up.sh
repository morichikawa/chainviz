#!/usr/bin/env bash
# 手元でchainvizを触ってみるための一括起動スクリプト。
# profiles/ethereumのDockerスタック・collector・frontend(vite dev server)を
# まとめて起動する。停止は scripts/dev-down.sh を使う。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE_DIR="$ROOT_DIR/profiles/ethereum"
PID_DIR="$ROOT_DIR/.dev-pids"
mkdir -p "$PID_DIR"

COLLECTOR_PORT="${CHAINVIZ_COLLECTOR_PORT:-4000}"
PROXY_PORT="${CHAINVIZ_PROXY_PORT:-4001}"
FRONTEND_PORT="${CHAINVIZ_FRONTEND_PORT:-5173}"

wait_for_port() {
  local port="$1"
  local label="$2"
  local tries=30
  while ! (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; do
    tries=$((tries - 1))
    if [ "$tries" -le 0 ]; then
      echo "エラー: $label (port $port) が起動しませんでした。ログを確認してください。" >&2
      return 1
    fi
    sleep 1
  done
  exec 3>&- 2>/dev/null || true
}

# 二重起動ガード。既にdev-up.sh経由で起動中のプロセスがあれば、新規に
# 起動して古いPIDファイルを上書きする(旧プロセスが孤児化し、EADDRINUSEで
# 新プロセスは即死したのにwait_for_portは旧プロセスのポートを見て
# 「成功」と誤報告してしまう)前に検出して止める。
check_not_already_running() {
  local name="$1"
  local pidfile="$PID_DIR/$name.pid"
  if [ -f "$pidfile" ]; then
    local pid
    pid="$(cat "$pidfile")"
    if kill -0 "$pid" 2>/dev/null; then
      echo "エラー: $name は既にpid $pid で起動中です。先に pnpm dev:down を実行してください。" >&2
      return 1
    fi
  fi
}

check_not_already_running collector || exit 1
check_not_already_running frontend || exit 1

# collectorのdist/が現在のソースを反映しているかを判定する(Issue #121,
# 自動リビルドはIssue #325)。packages/collector/dist/.build-commit は
# pnpm build(packages/collectorのビルドスクリプト)実行時にgit commit hash
# とdirty状態を書き込むマーカーファイル。判定結果は終了ステータスで
# 呼び出し元に返す(このスクリプトは`set -euo pipefail`が有効なため、
# 呼び出し元は必ず`if check_build_freshness; then ... else ... fi`のように
# 条件式として呼び出すこと。裸で呼ぶと非0終了時にスクリプト自体が
# 即終了してしまう)。
#
# 終了ステータス:
#   0: dist/は最新(何もしなくてよい)。gitが使えず比較不能な場合も
#      従来通り「何もしない」として扱うため0を返す
#   1: マーカーのcommit hashが現在のHEADと不一致(distが古い可能性が高い)。
#      呼び出し元はこの場合のみ自動でpnpm buildを実行する
#   2: 警告はするが自動ビルドはしないその他のケース(マーカー不在、
#      マーカーの中身が壊れている、hashは一致するがdirtyビルド)。
#      いずれも「distが古い」と断定できない、または再ビルドしても
#      鮮度が変わらないケースであり、判断を呼び出し元(ユーザー)に委ねる。
#      理由の詳細はdocs/worklog/issue-325.mdの設計メモを参照
check_build_freshness() {
  local marker_file="$ROOT_DIR/packages/collector/dist/.build-commit"
  if [ ! -f "$marker_file" ]; then
    echo "    警告: ビルド情報が見つかりません($marker_file)。dist/がpnpm buildで作られたものか確認してください。" >&2
    return 2
  fi

  local current_hash
  current_hash="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || true)"
  if [ -z "$current_hash" ]; then
    # gitが使えない(通常想定しない)環境では比較できないので何もしない。
    return 0
  fi

  local marker_hash marker_dirty
  marker_hash="$(sed -n '1p' "$marker_file" 2>/dev/null || true)"
  marker_dirty="$(sed -n '2p' "$marker_file" 2>/dev/null || true)"

  if [ -z "$marker_hash" ]; then
    echo "    警告: ビルド情報($marker_file)の中身が壊れています。pnpm buildの再実行を検討してください。" >&2
    return 2
  fi

  if [ "$marker_hash" != "$current_hash" ]; then
    echo "    dist/が古いため pnpm build を自動的に再実行します(ビルド時: $marker_hash、現在: $current_hash)。" >&2
    return 1
  fi

  if [ "$marker_dirty" = "dirty" ]; then
    echo "    警告: dist/はcommit $marker_hash の時点でuncommittedな変更を含んだ状態でビルドされています。その後さらに変更していないか確認してください(再ビルドしても同じ差分が再度反映されるだけのため自動リビルドは行いません)。" >&2
    return 2
  fi

  return 0
}

echo "==> [1/4] profiles/ethereum のDockerスタックを確認"
cd "$PROFILE_DIR"
if [ -z "$(docker compose ps -q 2>/dev/null)" ]; then
  echo "    起動していないので docker compose up -d を実行します"
  docker compose up -d
else
  echo "    既に起動中のスタックを再利用します(docker compose up -dは実行しません)"
fi
cd "$ROOT_DIR"

if [ ! -f "$ROOT_DIR/packages/collector/dist/index.js" ]; then
  echo "==> [2/4] collectorが未ビルドなので pnpm build を実行します"
  pnpm build
elif check_build_freshness; then
  echo "==> [2/4] ビルド済みのcollectorを再利用します(dist/は最新です)"
else
  freshness_status=$?
  if [ "$freshness_status" -eq 1 ]; then
    echo "==> [2/4] collectorのdist/が古いため pnpm build を自動的に再実行します"
    pnpm build
  else
    echo "==> [2/4] ビルド済みのcollectorを再利用します(再ビルドしたい場合は pnpm build を先に実行してください)"
  fi
fi

echo "==> [3/4] collectorを起動します(port $COLLECTOR_PORT, proxy $PROXY_PORT)"
CHAINVIZ_COLLECTOR_PORT="$COLLECTOR_PORT" CHAINVIZ_PROXY_PORT="$PROXY_PORT" \
  nohup node "$ROOT_DIR/packages/collector/dist/index.js" >"$PID_DIR/collector.log" 2>&1 &
echo $! >"$PID_DIR/collector.pid"
wait_for_port "$COLLECTOR_PORT" "collector" || {
  echo "collectorのログ: $PID_DIR/collector.log"
  exit 1
}

echo "==> [4/4] frontend(vite dev server)を起動します(port $FRONTEND_PORT)"
VITE_COLLECTOR_URL="ws://127.0.0.1:$COLLECTOR_PORT" \
  nohup pnpm --filter @chainviz/frontend exec vite --port "$FRONTEND_PORT" \
  >"$PID_DIR/frontend.log" 2>&1 &
echo $! >"$PID_DIR/frontend.pid"
wait_for_port "$FRONTEND_PORT" "frontend" || {
  echo "frontendのログ: $PID_DIR/frontend.log"
  exit 1
}

cat <<EOF

chainviz が起動しました。

  frontend:  http://localhost:$FRONTEND_PORT
  collector: ws://127.0.0.1:$COLLECTOR_PORT (ログ: $PID_DIR/collector.log)

停止するには:
  pnpm dev:down
EOF
