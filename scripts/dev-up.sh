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
else
  echo "==> [2/4] ビルド済みのcollectorを再利用します(再ビルドしたい場合は pnpm build を先に実行してください)"
fi

check_not_already_running collector || exit 1

echo "==> [3/4] collectorを起動します(port $COLLECTOR_PORT, proxy $PROXY_PORT)"
CHAINVIZ_COLLECTOR_PORT="$COLLECTOR_PORT" CHAINVIZ_PROXY_PORT="$PROXY_PORT" \
  nohup node "$ROOT_DIR/packages/collector/dist/index.js" >"$PID_DIR/collector.log" 2>&1 &
echo $! >"$PID_DIR/collector.pid"
wait_for_port "$COLLECTOR_PORT" "collector" || {
  echo "collectorのログ: $PID_DIR/collector.log"
  exit 1
}

check_not_already_running frontend || exit 1

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
