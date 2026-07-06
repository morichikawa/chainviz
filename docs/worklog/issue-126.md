### 2026-07-06 Issue #126 pnpm dev:down --dockerが動的追加コンテナを削除しない不具合の修正
- 担当: node-env
- ブランチ: issue-126-cleanup-dynamic-containers
- 内容:
  - `scripts/dev-down.sh --docker` は従来 `docker compose down` を呼ぶだけで、
    docker-compose.yml に定義されたサービス(reth1/reth2/beacon1/beacon2/
    validator1/validator2/workbench)しか対象にしていなかった。collector が
    `addNode`/`addWorkbench` で動的に作成したコンテナ(reth3、beacon3、任意名の
    ワークベンチ等)は compose 定義に存在しないため対象外となり、削除されずに
    残り続けていた。
  - `scripts/dev-down.sh` に `compose_project_name`(`docker compose config
    --format json` の `name` フィールドから、実際にdocker composeが使う
    プロジェクト名を取得する。値をスクリプトにハードコードせず、
    `COMPOSE_PROJECT_NAME` 環境変数や `-p` 指定による上書きも含めて
    docker compose自身の解決結果を単一の情報源とする)と
    `cleanup_dynamic_containers`(`com.chainviz.managed=true` かつ対象
    プロジェクトの `com.docker.compose.project` ラベルを持つ残存コンテナを
    `docker ps -a --filter` で検出し `docker rm -f` する)を追加した。
  - `cleanup_dynamic_containers` は `docker compose down` より**前**に呼ぶ。
    動的追加コンテナは compose のネットワークに接続されたままのため、先に
    削除しておかないと「ネットワークに接続中のエンドポイントが残っている」
    状態になり、`docker compose down` 側のネットワーク削除自体が
    `Resource is still in use` エラーで失敗しうることを実機検証で確認した
    (下記「決定事項・注意点」参照)。
  - 動的追加コンテナは専用ボリュームを持たず、既存の共有ボリューム
    (genesis/clpeer/elpeer)を読み取り専用でbind mountするのみ
    (`packages/collector/src/adapters/ethereum/node-lifecycle.ts` 参照)。その
    ため今回の対応はコンテナ削除のみで、ボリューム削除は追加不要と判断した
    (ボリューム自体の削除は既存どおり `docker compose down -v` の役割のまま)。
- 決定事項・注意点:
  - プロジェクト名の取得に `jq` を使わず `node -e` でJSONを厳密にパースする
    実装にした。開発環境には `jq` が入っていない前提で(実機で確認)、node は
    このリポジトリの必須依存のため常に利用できる。
  - `packages/collector/src/adapters/ethereum/node-lifecycle.ts` の
    `DEFAULTS.composeProject` は `"chainviz-ethereum"` に固定されており
    (env で上書きされない)、`profiles/ethereum/docker-compose.yml` の
    トップレベル `name: chainviz-ethereum` と常に一致する。この2箇所が
    将来ズレると動的追加コンテナのラベルと `dev-down.sh` の検出対象が
    食い違うため、どちらかを変更する際はもう片方も確認すること。
  - 実機検証は本番の `profiles/ethereum`(reth/lighthouseイメージ)を直接
    使わず、同じロジックを同じプロジェクト構成(名前・ラベル体系)で再現した
    軽量な合成 docker-compose(alpineイメージ、独立したproject名・subnet)を
    一時的に組み、次の3パターンを確認した:
    1. 修正前の挙動の再現: 合成composeを起動した状態で `com.chainviz.managed=
       true` ラベル付きダミーコンテナ(reth3相当)を手動で追加し、素の
       `docker compose down` を実行 → ダミーコンテナが削除されず残り、かつ
       ネットワーク削除も `Resource is still in use` で失敗することを確認
       (Issue本文の報告どおりの不具合を再現できた)。
    2. 修正後の `dev-down.sh --docker` を同じ残存状態に対して実行 →
       ダミーコンテナ・compose定義コンテナ・ネットワークがすべて削除され
       クリーンな状態になることを確認。
    3. 動的追加コンテナが存在しない通常時に `dev-down.sh --docker` を実行
       しても既存の動作(compose定義コンテナ・ネットワークの削除)が壊れて
       いないことを確認(回帰確認)。
  - 検証中の事故: 実機確認の初期段階で、`profiles/ethereum` の本物の
    docker-compose.yml に対して誤って `COMPOSE_PROJECT_NAME` の上書きを
    付け忘れたまま `docker compose down` を実行してしまい、既に稼働していた
    共有の `chainviz-ethereum` プロジェクト(本worktreeとは別ディレクトリで
    稼働中だった環境)のコンテナ・ネットワークを誤って削除してしまった
    (ボリュームは `-v` を付けていないため無事だった)。その後同スタックは
    (本担当以外の手により)`docker compose up -d` で復旧し、ブロック生成も
    継続していることを確認した。全worktreeの `profiles/ethereum/
    docker-compose.yml` は `name: chainviz-ethereum` を共有しているため、
    どのworktreeから `docker compose down/up` を実行しても同じ実体に対する
    操作になる。以降の実機検証はすべて本物のプロジェクトに触れない合成
    composeで行った。次にこの種の検証を行う担当は、本物の
    `profiles/ethereum` に対して `docker compose down`(プロジェクト名の
    上書きなし)を実行する前に、他worktree・他セッションが同じ
    `chainviz-ethereum` プロジェクトを使用中でないか必ず確認すること。

### 2026-07-06 Issue #126 レビュー(chainviz-reviewer、1回目: 差し戻し)
- 担当: reviewer
- 確認した内容:
  - `compose_project_name` はプロジェクト名をハードコードせず
    `docker compose config --format json` の `name` フィールドを単一の
    情報源としている。`COMPOSE_PROJECT_NAME` 環境変数による上書きも
    正しく反映されることを読み取り専用コマンドで実地確認した
    (通常時 `chainviz-ethereum`、上書き時は上書き値が返る)。
  - ラベルフィルタ(`com.chainviz.managed=true` +
    `com.docker.compose.project=<プロジェクト名>`)は
    `packages/collector/src/adapters/ethereum/labels.ts` の
    `MANAGED_LABEL` / `COMPOSE_PROJECT_LABEL` および
    `node-lifecycle.ts` が動的追加コンテナに付与するラベル
    (`MANAGED_LABEL: "true"`, `COMPOSE_PROJECT_LABEL: cfg.composeProject`)
    と一致している。
  - 実行順序(動的コンテナ削除 → `docker compose down`)の理由
    (ネットワーク削除の `Resource is still in use` 回避)はコメント・
    worklogに明記され、合成composeでの実機検証記録もある。`-v` の
    パススルー(ボリューム削除)は従来どおりで壊れていない。
  - `pnpm lint` / `pnpm build` / `pnpm test`(539件)すべて成功。
    シェルスクリプトはlint対象外(eslintのみ)のため `bash -n` で構文
    確認した。シェルスクリプトのみの変更でありユニットテスト追加は
    対象外と判断。
  - コミット粒度は2コミット(実装 / docs)で適切。Conventional Commits
    形式も遵守。
- 差し戻し理由(要修正):
  1. `cleanup_dynamic_containers` 内の
     `containers="$(docker ps -a --filter ...)"` が `docker ps` 自体の
     失敗を検知していない。`set -e` なしのスクリプトのため、docker
     デーモン停止・権限不足等で `docker ps` が失敗すると `$containers`
     が空になり、「動的追加コンテナは残っていません」という誤った成功
     メッセージを出して正常終了(return 0)してしまう。CLAUDE.md
     「エラーを握りつぶすコードを見逃さない」の『失敗しているのに
     ok相当を返す』パターンに該当。コマンド置換の終了コードを確認し、
     失敗時は `FAILED=1` でエラー報告すること。
- 推奨(必須ではない):
  2. `compose_project_name` の `docker compose config ... 2>/dev/null` は
     失敗時にdocker側の具体的なエラー内容を捨てて汎用メッセージに
     すり替えている。stderrを通す・失敗時のみ表示する等の対応、あるいは
     抑止する理由(成功時のWARNノイズ回避等)のコメント明記が望ましい。

### 2026-07-06 Issue #126 レビュー(chainviz-reviewer、2回目: 合格)
- 担当: reviewer
- 確認した内容:
  1. 差し戻し理由(docker ps失敗の握りつぶし)の解消: コミット8b9e156で
     `containers="$(docker ps -a ...)"` が `if ! containers="$(...)"` の
     形に変更され、失敗時はエラーメッセージ(手動確認用のコマンド例つき)を
     stderrへ出力し `FAILED=1` を立てて `return 1` する。修正後のロジックを
     偽のdockerコマンド(compose configは成功・psは失敗を返す)で単体実行し、
     `return_code=1 FAILED=1` となり誤った成功報告が起きないことを
     レビュー側でも独立に再確認した。
  2. 推奨事項への対応: `compose_project_name` の `2>/dev/null` に
     「正常時にも出うるWARN(未使用envの警告等)がエラー判定に混入しないよう
     抑止し、実際の失敗は終了コードで検知する」という理由コメントが追記
     された。CLAUDE.md「意図的に例外を握りつぶす場合は理由をコメントで
     残す」に沿っており適切。
  3. `pnpm lint` / `pnpm build` / `pnpm test`(539件)すべて成功。
     `bash -n scripts/dev-down.sh` で構文確認も実施。
  4. origin/mainへのrebase後、`git diff origin/main..HEAD` の差分は
     `scripts/dev-down.sh` と docs(PLAN.md / WORKLOG.md /
     worklog/issue-126.md)のみで、前回見えていた `.claude/agents/` 等の
     見かけ上の削除は解消済み。merge-baseはorigin/mainと一致。
  5. コミット粒度は3コミット(実装 / docs / レビュー指摘対応のfix)で
     1変更1コミットを維持。Conventional Commits形式も遵守。
- 判定: 合格。push/PR作成/マージは統括に委ねる。
