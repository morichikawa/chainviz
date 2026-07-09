# 開発ルール

## コミットメッセージ規約

このリポジトリは [Conventional Commits](https://www.conventionalcommits.org/) 形式を
`commit-msg` フックで強制しています。

```
<type>(<scope>): <説明>
```

`type` は以下のいずれか: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`,
`perf`, `build`, `ci`, `revert`

例:

```
feat: ノードカードのホバー詳細表示を追加
fix(collector): ピア情報ポーリングの多重起動を修正
docs: CONCEPT.mdのロードマップを更新
```

## 初回セットアップ

このリポジトリをクローンした直後は、フックの場所(`.git/config`)がまだ
`.githooks/` を指していないため、以下を一度だけ実行する。

```sh
git config core.hooksPath .githooks
```

`core.hooksPath` はgitがバージョン管理しない設定(`.git/config`内)のため、
クローンごとに実行が必要。

## ブランチ運用

`main` 上で直接作業しない。GitHub Issue 1つにつきブランチを1つ切る。

```
issue-<番号>-<内容を表す短い英語スラッグ>
# 例: issue-1-genesis-pos-net
```

作業内容は1つの変更ごとにコミットを分ける(異なる関心事を1コミットに
まとめない)。作業が終わったら PR を作成し、本文に `Closes #<番号>` を
含めて Issue と連動させる。レビューを経てから `main` にマージする
(squash はせず、分けたコミットの履歴を保持する)。

## CI

GitHub Actions は使わない(private リポジトリでの Actions 利用料を避ける
ため)。代わりに `pre-push` フック(`.githooks/pre-push`。上記の
`core.hooksPath` 設定で有効化される)が `git push` のたびにローカルで

```sh
pnpm lint && pnpm build && pnpm test
```

を自動実行し、失敗すると push 自体が中止される。

## E2E(結合)テスト

`pnpm test`(= `pnpm -r test`)で走るユニットテストとは別に、実環境
(Docker のノード群 + 実 collector)に対する E2E テストを `packages/e2e` に
置いている。ユニットテストでは検出できない実環境特有の不具合(例:
EL 間 P2P が無効で追加ノードがブロックに追従しない)を捕まえるためのもの。

E2E テストは実 Docker を必要とし数分かかるため、pre-push フックが実行する
`pnpm test` には**含めない**。`packages/e2e` は `test` スクリプトを持つが、
`vitest.unit.config.ts`(include が `src/**/*.unit.test.ts` のみ)を指す
ことで、Docker 非依存の純粋ロジックのユニットテスト(追従待ちのタイムアウト
算出・進捗停止検出などを合成クロックで検証する)だけを対象にしている。
実 Docker 前提の E2E テスト本体(`a-b-layer.test.ts` / `commands.test.ts` /
`error-paths.test.ts`)は `test:e2e` が指す `vitest.config.ts` 側で
`**/*.unit.test.ts` を exclude することで住み分け、`test:e2e` としてのみ
実行されるようにしている。

### 前提条件

- Docker と `docker compose` が使えること。
- collector をビルド済みであること(E2E は collector を子プロセスとして
  `packages/collector/dist/index.js` から起動する)。事前に `pnpm build`
  を実行しておく。
- collector は Docker のブリッジネットワーク上のコンテナ IP
  (`172.28.0.0/16`)へ直接到達する。ホストからこれらの IP へ到達できる
  環境が必要(Linux / WSL2 の標準的な Docker では到達可能)。
- ポート `4123`(E2E 用の collector 待ち受けポート)が空いていること。
- **`pnpm test:e2e` は同時に複数実行できない**(別ブランチ・別 worktree
  からでも同様)。同一の `profiles/ethereum` スタックとポート `4123` を
  奪い合うと、片方の collector が終了した瞬間にもう片方が
  `websocket is not open` でタイムアウトする、という紛らわしい不安定
  挙動を引き起こす(Issue #58 のレビューで実際に発生・特定した)。これを
  防ぐため、`test:e2e` は実行開始時にホスト単位の排他ロック
  (`os.tmpdir()/chainviz-test-e2e.lock`。worktree ごとにパスが変わらない
  ようリポジトリ外の固定パスに置く)を取得する(`vitest` の
  `globalSetup`、実装は `packages/e2e/src/helpers/e2e-lock.ts`)。
  後から実行した側はロックを取得できず、**先行実行の PID・ホスト名・
  開始時刻を含む明確なエラーで即座に失敗する**(タイムアウトを待たされ
  ない)。先行プロセスが実際には終了しているのにロックファイルが残って
  いる場合(異常終了時など)は、次回実行時に保持プロセスの生死を確認し
  自動的に stale ロックとして削除・再取得するが、解消しない場合は
  ロックファイルを手動で削除する。
  また `packages/e2e/src/helpers/collector.ts` の `startCollector` は、
  子プロセス自身の標準出力に出る `[collector] WebSocket server
  listening on port <port>` ログ(または `EADDRINUSE` によるクラッシュ)
  だけを起動判定の根拠にしており、単に「ポートに接続できるか」だけでは
  判定しない。これにより、万一ロックをすり抜けて同時実行された場合でも、
  自分の子プロセスが `EADDRINUSE` で即死したのに他プロセスの collector
  へ誤接続する、という Issue #64 の不具合を防ぐ。

### 実行方法

```sh
pnpm build        # collector を含む全パッケージをビルド
pnpm test:e2e     # = pnpm --filter @chainviz/e2e test:e2e
```

ハーネスは `profiles/ethereum` のスタックを起動する。**既にスタックが
起動しチェーンが進行していればそれをそのまま再利用する**(停止中のときだけ
`docker compose up -d` する)。稼働中に `docker compose up -d` を呼ぶと
genesis 生成ワンショットが再実行されて共有 genesis が作り直され、以後
`addNode` で追加するノードが既存ノードと genesis 不一致になって EL の
P2P に失敗するため、再利用時はあえて `up -d` を呼ばない設計にしている。

### 実行時間の目安

- 初回でスタックを新規起動する場合、genesis 生成とチェーン進行開始の待ちで
  数分かかる。
- スタックが既に稼働している場合、全体で 2〜3 分程度。`addNode` で追加した
  ノードが既存チェーンへ履歴バックフィルして追従する検証に最も時間がかかる
  (チェーンが十分進んでいるほど、バックフィルすべき履歴が長くなる)。

## UI 層 E2E（Playwright）テスト

`packages/e2e` の E2E テストは、上記のプロトコル層(vitest + `ws`)に加えて
UI 層(Playwright + chromium。frontend を実際に操作する)を持つ。二層構成の
設計は `docs/ARCHITECTURE.md` §8 を参照。

### 前提条件

- 上記プロトコル層 E2E の前提条件(Docker・collector のビルド済みdist・
  ポートの空き)に加えて、Playwright の chromium ブラウザ本体と、それを
  動かすためのシステムライブラリ(`libnspr4` / `libnss3` / `libasound2` 等)
  が必要。**初回のみ**以下を実行する。

  ```sh
  pnpm --filter @chainviz/e2e exec playwright install chromium
  sudo pnpm --filter @chainviz/e2e exec playwright install-deps chromium
  ```

  (`install-deps` は apt 等でシステムパッケージを追加するため `sudo` が
  必要。既に必要なライブラリが入っている環境では省略できる。)
- ポート `4125`(UI 層専用の collector 待ち受けポート)・`5275`(UI 層専用の
  vite dev server)が空いていること。これらはプロトコル層 E2E が使う
  `4123`・既存の dev 用 `4000`/`5173` とは別の値なので、同時に手元で
  `pnpm dev:up` を動かしていても衝突しない。
- `pnpm test:e2e:ui` もプロトコル層と同じ排他ロック
  (`os.tmpdir()/chainviz-test-e2e.lock`)を共用するため、`pnpm test:e2e`
  と同時に複数実行できない(別 worktree・別ブランチからでも同様)。

### 実行方法

```sh
pnpm build           # collector・frontend を含む全パッケージをビルド
pnpm test:e2e:ui     # = pnpm --filter @chainviz/e2e test:e2e:ui
```

`globalSetup` が Docker スタックの起動確認(既存スタックがあれば再利用)と
UI 層専用ポートでの collector 起動を行い、`webServer` が `vite dev`
(UI 層専用ポート)を起動したうえで chromium から frontend を操作する。
終了後は collector の停止・ロック解放のみ行い、Docker スタックは
(プロトコル層 E2E と同様)残置する。

## 手動で動かして触ってみる

E2E テストとは別に、実際に画面を見ながら触ってみたいときは
`pnpm dev:up` / `pnpm dev:down`(`scripts/dev-up.sh` /
`scripts/dev-down.sh`)で `profiles/ethereum` の Docker スタック・
collector・frontend(vite dev server)をまとめて起動・停止できる。

```sh
pnpm build      # 初回、またはcollectorのコードを変更した後は必須
pnpm dev:up     # Docker + collector + frontend をまとめて起動
# ブラウザで表示されたURL(既定 http://localhost:5173)を開く
pnpm dev:down   # collector・frontendのみ停止(Dockerスタックは残す)
```

- Docker スタックは(`test:e2e` と同様)既に起動していればそのまま再利用し、
  停止中のときだけ `docker compose up -d` する。
- `pnpm dev:down` は既定では Docker スタックを止めない(チェーンの進行状態を
  保つため)。まとめて止めたい場合は `pnpm dev:down -- --docker`
  (chain データも破棄するなら `pnpm dev:down -- --docker -v`)。
- 既定ポートは collector が `4000`(ロギングプロキシは `4001`)、frontend が
  `5173`。環境変数 `CHAINVIZ_COLLECTOR_PORT` / `CHAINVIZ_PROXY_PORT` /
  `CHAINVIZ_FRONTEND_PORT` で変更できる。
- リモート開発環境(VS Code の Remote/WSL 等)でブラウザから直接アクセスする
  場合、frontend のポートだけでなく **collector のポート(既定 `4000`)も
  ポート転送の対象に追加する必要がある**。転送し忘れると、画面自体は表示
  されるのに WebSocket 接続だけ失敗する(`ERR_CONNECTION_REFUSED`)ため
  分かりにくい。転送済みのはずなのに繋がらない場合は、一度転送設定を
  削除して張り直すか、`CHAINVIZ_COLLECTOR_PORT` で別のポート番号に変えて
  試すと切り分けやすい。
