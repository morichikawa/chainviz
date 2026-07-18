# Issue #388 UI-B-06(chain-ribbon.spec.ts)がUI-B-05との併走時に間欠的にflakyになる

### 2026-07-18 Issue #388 起票の経緯

- 担当: 統括
- ブランチ: issue-388-ui-b06-flaky-backlog
- 内容: Issue #351の最終QA検証(docs/worklog/issue-351.mdの最終QA検証節)で
  chainviz-qaが偶発的に観測した既存のflaky問題をIssue化し、
  `docs/PLAN.md`のバックログ節末尾に追記した。
- 事実関係: `packages/e2e/src/ui/chain-ribbon.spec.ts`のUI-B-06は単独実行
  では3/3安定合格するが、UI-B-05との併走(同一ファイル内の連続実行)では
  round1・2で失敗しround3で合格するという間欠的なflakyが観測された。
  Issue #351のコード変更(`isReverseHighlighted`への`isDrivingParentHighlight`
  条件追加)はUI-B-06のテスト対象範囲(親ブロック行を見ない)に影響しない
  ことをQAがコードで確認済み。実態は、UI-B-06が「実送金→ブロック取り込み
  待ち→ホバー」を直列に行う構造上、対象ブロックが表示窓(直近8タイル)から
  流れ出るまでの時間との競合であり(docs/worklog/issue-298.mdに既出の課題)、
  併走時の負荷でこの競合を跨ぎやすくなる既存由来のタイミング依存と
  考えられる。

### 2026-07-18 Issue #388 起票・バックログ追記のレビュー

- 担当: reviewer
- ブランチ: issue-388-ui-b06-flaky-backlog
- 判定: **合格**
- Issue本文と`docs/PLAN.md`追記の一致、参照事実の実在確認
  (`packages/e2e/src/ui/chain-ribbon.spec.ts`のUI-B-05/UI-B-06、
  `docs/worklog/issue-298.md`のタイミング課題の記録、Issue #346の実在)、
  `docs/worklog/issue-388.md`とissue-351.mdの最終QA記録との整合性、
  `docs/WORKLOG.md`の#351行更新内容の整合性、コミット粒度、
  Conventional Commits形式、`pnpm lint && pnpm build && pnpm test`
  全パッケージ通過をすべて確認
- docs配下のみの変更のため、CLAUDE.mdの例外規定に基づきchainviz-qaは
  省略(reviewer合格のみ)
