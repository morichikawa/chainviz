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
実 Docker 前提の E2E テスト本体(`a-b-layer.test.ts` / `commands.test.ts`)は
`test:e2e` が指す `vitest.config.ts` 側で `**/*.unit.test.ts` を exclude
することで住み分け、`test:e2e` としてのみ実行されるようにしている。

### 前提条件

- Docker と `docker compose` が使えること。
- collector をビルド済みであること(E2E は collector を子プロセスとして
  `packages/collector/dist/index.js` から起動する)。事前に `pnpm build`
  を実行しておく。
- collector は Docker のブリッジネットワーク上のコンテナ IP
  (`172.28.0.0/16`)へ直接到達する。ホストからこれらの IP へ到達できる
  環境が必要(Linux / WSL2 の標準的な Docker では到達可能)。
- ポート `4123`(E2E 用の collector 待ち受けポート)が空いていること。

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
