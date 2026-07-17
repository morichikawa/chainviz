### 2026-07-17 Issue #362 サイドパネル(コントラクトソース表示・用語集表示)の幅をリサイズできるようにする（起票・バックログ追記のレビュー）

- 担当: reviewer
- ブランチ: docs-issue-362-backlog
- 内容: ユーザーからの要望で起票したIssue #362と、`docs/PLAN.md`
  バックログへの追記（docsのみの変更）のレビュー。
  - Issue #362本文と`docs/PLAN.md`追記の照合: 要望の出所（ユーザーからの
    要望）・現状（幅固定、ARCHITECTURE.md §12.2に「400px目安」と記載）・
    論点（ドラッグリサイズハンドル・幅の永続化要否・最小/最大幅）・
    共通シェル(`SidePanel.tsx`)で全kind一括対応できる見込み、のいずれも
    一致。Issue本文にある詳細（永続化を既存の`layout/layoutStore.ts`
    (Issue #15)に載せるかセッション限りにするか、対象パッケージが
    `packages/frontend`であること）はPLAN.md側では要約により省略されて
    いるが、バックログ項目は要約で足りるため過不足なしと判断
  - 追記が参照する事実の実在確認: `docs/ARCHITECTURE.md` §12.2
    （2536行目）に「幅は 400px 目安（実装時に実測で確定してよい）」の
    記載が実在。実装上も `packages/frontend/src/styles.css` の
    `.side-panel` が `width: 420px`（`max-width: 90vw`）の固定幅であり、
    「現状は幅固定」の記述は実装と整合（420pxは「400px目安・実測で確定
    してよい」の範囲内）。`packages/frontend/src/side-panel/SidePanel.tsx`
    と `contractSource`/`glossary`/`commsLog` の3 kindも実在
  - `docs/PLAN.md` の追記フォーマットは直前の #359 項目と一貫
    （チェックボックス+6スペースインデントの補足+Issueリンク行）。
    配置（バックログ節末尾・「## 運用ルール」の直前）も適切
  - コミット粒度: `git log main..HEAD` は1コミット（PLAN.md追記のみ）で
    1変更1コミットの規約に適合。Conventional Commits形式も適合
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過を確認
    （shared 74 / collector 1563 / e2e 171 / frontend 2592テスト）
- 決定事項・注意点:
  - レビュー結果は合格。コード変更を伴わないためCLAUDE.mdの例外規定に
    基づきchainviz-qaは省略可
  - 実装着手は後日。着手時はリサイズハンドルの実装方法・幅の永続化要否・
    最小/最大幅の範囲を設計判断する（`docs/ARCHITECTURE.md` §12.2の
    「幅は400px目安」の記述も、リサイズ可能化にあわせて更新が必要になる
    見込み）
