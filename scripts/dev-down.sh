#!/usr/bin/env bash
# scripts/dev-up.sh が起動したcollector・frontendを停止する。
# Dockerスタックはデフォルトでは止めない(チェーンの進行状態を保持するため)。
# 明示的に --docker を渡した場合のみ docker compose down する(-v で
# genesis/chainデータごと破棄。docker compose自体の挙動に合わせる)。
#
# docker compose down は docker-compose.yml に定義されたサービス
# (reth1/reth2/beacon1/beacon2/validator1/validator2/workbench)しか対象に
# しない。collector が addNode/addWorkbench で動的に作成したコンテナ
# (reth3、beacon3、任意名のワークベンチ等)は compose 定義に存在しないため
# docker compose down だけでは削除されず残り続ける(Issue #126)。そのため
# --docker 指定時は、docker compose down に加えて com.chainviz.managed=true
# かつ対象プロジェクトの com.docker.compose.project ラベルを持つ残存
# コンテナも検出して削除する。
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE_DIR="$ROOT_DIR/profiles/ethereum"
PID_DIR="$ROOT_DIR/.dev-pids"

FAILED=0

# profiles/ethereum の docker-compose.yml (トップレベルの name: フィールド、
# もしくは COMPOSE_PROJECT_NAME 環境変数での上書き)から、実際に docker
# compose が使うプロジェクト名を取得する。値をスクリプトにハードコードせず、
# 常に docker compose 自身の解決結果を単一の情報源として使う
# (CLAUDE.md「固定値を決め打ちで埋め込まない」)。
# 呼び出し前提: カレントディレクトリが PROFILE_DIR であること。
compose_project_name() {
  local json
  # stderrを捨てているのは、docker compose configが正常時にも出しうる
  # WARN(未使用envの警告等)がここでのエラー判定に混入しないようにする
  # ため。実際の失敗は終了コード(|| return 1)で検知する。
  json="$(docker compose config --format json 2>/dev/null)" || return 1
  node -e '
    let data = "";
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => {
      try {
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed.name === "string" && parsed.name.length > 0) {
          process.stdout.write(parsed.name);
        } else {
          process.exit(1);
        }
      } catch {
        process.exit(1);
      }
    });
  ' <<<"$json"
}

# com.chainviz.managed=true かつ対象プロジェクトの com.docker.compose.project
# ラベルを持つ、compose定義に存在しない残存コンテナ(addNode/addWorkbench
# 由来)を検出して削除する。呼び出し前提: カレントディレクトリが
# PROFILE_DIR であること。動的追加コンテナは専用ボリュームを持たず、既存の
# 共有ボリューム(genesis/clpeer/elpeer)を読み取り専用でbind mountするのみ
# のため(packages/collector/src/adapters/ethereum/node-lifecycle.ts参照)、
# ボリューム削除は不要でコンテナ削除のみで後始末が完了する。
# docker compose down より先に呼ぶこと: 動的追加コンテナはcomposeの
# ネットワークに接続されたままのため、先に消しておかないと
# 「ネットワークに接続中のエンドポイントが残っている」状態になり
# docker compose down 側のネットワーク削除が失敗しうる。
cleanup_dynamic_containers() {
  local project
  if ! project="$(compose_project_name)"; then
    echo "エラー: docker composeプロジェクト名を取得できませんでした。動的追加コンテナの後始末をスキップします。" >&2
    FAILED=1
    return 1
  fi

  local containers
  if ! containers="$(docker ps -a \
    --filter "label=com.chainviz.managed=true" \
    --filter "label=com.docker.compose.project=$project" \
    --format '{{.Names}}')"; then
    echo "エラー: docker psの実行に失敗したため、動的追加コンテナの有無を確認できませんでした。手動で確認してください(docker ps -a --filter label=com.chainviz.managed=true)。" >&2
    FAILED=1
    return 1
  fi

  if [ -z "$containers" ]; then
    echo "==> 動的追加コンテナ(addNode/addWorkbench由来)は残っていません"
    return 0
  fi

  echo "==> 動的追加コンテナ(addNode/addWorkbench由来)の残存分を削除します:"
  echo "$containers" | sed 's/^/    /'
  if ! echo "$containers" | xargs docker rm -f >/dev/null; then
    echo "エラー: 一部の動的追加コンテナを削除できませんでした。手動で確認してください(docker ps -a --filter label=com.chainviz.managed=true)。" >&2
    FAILED=1
    return 1
  fi
}

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
  else
    cleanup_dynamic_containers
    if [ "${2:-}" = "-v" ]; then
      docker compose down -v || FAILED=1
    else
      docker compose down || FAILED=1
    fi
  fi
else
  echo "==> Dockerスタックはそのままにしています(停止するには: $0 --docker [-v])"
fi

exit "$FAILED"
