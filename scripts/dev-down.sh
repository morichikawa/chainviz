#!/usr/bin/env bash
# scripts/dev-up.sh が起動したcollector・frontendを停止する。
# Dockerスタックはデフォルトでは止めない(チェーンの進行状態を保持するため)。
# 明示的に --docker を渡した場合のみ docker compose down する(-v で
# genesis/chainデータごと破棄。docker compose自体の挙動に合わせる)。
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE_DIR="$ROOT_DIR/profiles/ethereum"
PID_DIR="$ROOT_DIR/.dev-pids"

FAILED=0

stop_process() {
  local name="$1"
  local pidfile="$PID_DIR/$name.pid"
  if [ ! -f "$pidfile" ]; then
    echo "==> $name: 記録された起動プロセスがありません(dev-up.sh経由で起動していない?)"
    return 0
  fi
  local pid
  pid="$(cat "$pidfile")"
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "==> $name: プロセス(pid $pid)は既に終了しています"
    rm -f "$pidfile"
    return 0
  fi
  echo "==> $name (pid $pid) を停止します"
  kill "$pid" 2>/dev/null || true
  for _ in 1 2 3 4 5; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "    応答が無いため強制終了します"
    kill -9 "$pid" 2>/dev/null || true
    sleep 1
  fi
  # SIGKILL後も生存していれば(EPERM・Dステート等)、成功を装わずpidファイルを
  # 残したままエラー報告する(CLAUDE.md「失敗を握りつぶさない」)。
  if kill -0 "$pid" 2>/dev/null; then
    echo "エラー: $name (pid $pid) を停止できませんでした。手動で確認してください(ps -p $pid)。" >&2
    FAILED=1
    return 1
  fi
  rm -f "$pidfile"
}

stop_process frontend
stop_process collector

if [ "${1:-}" = "--docker" ]; then
  echo "==> profiles/ethereum のDockerスタックを停止します"
  if ! cd "$PROFILE_DIR"; then
    echo "エラー: $PROFILE_DIR に移動できませんでした。" >&2
    FAILED=1
  elif [ "${2:-}" = "-v" ]; then
    docker compose down -v || FAILED=1
  else
    docker compose down || FAILED=1
  fi
else
  echo "==> Dockerスタックはそのままにしています(停止するには: $0 --docker [-v])"
fi

exit "$FAILED"
