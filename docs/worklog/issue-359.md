### 2026-07-17 Issue #359 addNode/addWorkbenchで作成したmanagedコンテナがdocker compose down -vでも削除されない（起票・バックログ追記のレビュー）

- 担当: reviewer
- ブランチ: docs-issue-359-backlog
- 内容: Issue #357（down -v後もEOAが残る）の原因調査中に
  chainviz-detectiveが副次的に発見した問題のIssue起票と、
  `docs/PLAN.md` バックログへの追記（docsのみの変更）のレビュー。
  - Issue #359本文と`docs/PLAN.md`追記の照合: 発見の経緯（Issue #357の
    調査中にchainviz-detectiveが副次的に発見）・実証方法（隔離した最小
    composeプロジェクト、Compose v2.40.3 / Engine 29.1.3）・
    `--remove-orphans`付きでも削除されないこと・対応候補（README注記+
    ラベルベースの掃除スクリプト）・対象パッケージ（profiles/ =
    chainviz-node-env + docs）のいずれも一致。Issue本文にある詳細
    （`oneoff=False`ラベルでも削除されない、ネットワーク削除が
    "Resource is still in use"で失敗する）はPLAN.md側では要約により
    省略されているが、バックログ項目は要約で足りるため過不足なしと判断
  - Issue本文が参照する事実の実在確認: 調査記録
    `docs/worklog/issue-357.md` は未マージのブランチ
    `issue-357-eoa-not-cleared-on-down` 上に実在し、managedコンテナが
    `down -v` を生き延びる実測（`--remove-orphans`・`oneoff=False`とも
    効果なし、ネットワーク削除失敗）と、「第2の問題は別Issue化を推奨」
    という記述（ラベルフィルタでの`docker rm -f`掃除コマンド案を含む）が
    実在する。追記の記述はこの調査記録と整合
  - `docs/PLAN.md` の追記フォーマットは直前の #352 項目・#351 項目と一貫
    （チェックボックス+6スペースインデントの補足+Issueリンク行）。
    配置（バックログ節末尾・「## 運用ルール」の直前）も適切
  - コミット粒度: `git log main..HEAD` は1コミット（PLAN.md追記のみ）で
    1変更1コミットの規約に適合。Conventional Commits形式も適合
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過を確認
    （frontend 174ファイル2460テスト含む）
- 決定事項・注意点:
  - レビュー結果は合格。コード変更を伴わないためCLAUDE.mdの例外規定に
    基づきchainviz-qaは省略可
  - `docs/worklog/issue-357.md` はレビュー時点でmain未マージ
    （ブランチ `issue-357-eoa-not-cleared-on-down` 上）。Issue #359の
    本文が同ファイルを「参考」として参照しているため、#357 のPRが先に
    マージされれば参照は成立する。万一 #359 に先へ着手する場合は
    当該ブランチ上の記録を参照すること
  - 実装着手は後日。具体的な実現方法（README注記+掃除スクリプト等）は
    着手時に設計判断が必要
