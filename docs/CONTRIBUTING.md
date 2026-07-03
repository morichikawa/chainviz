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
