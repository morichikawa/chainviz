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
