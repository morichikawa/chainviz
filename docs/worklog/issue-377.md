# Issue #377 用語集パネルのフォントサイズを変更できるようにする

### 2026-07-18 Issue #377 起票とバックログ追記のレビュー

- 担当: reviewer
- ブランチ: docs-issue-377-backlog
- 内容: ユーザーからの要望を受けて統括が Issue #377 を起票し、
  `docs/PLAN.md` のバックログ節末尾(「## 運用ルール」の直前)に
  追記した。その内容をレビューした。
- レビュー結果: 合格
  - Issue #377 本文と PLAN.md の追記が過不足なく一致(ユーザーからの
    要望であること・フォントサイズ変更UIの要否・設定の永続化要否・
    他のサイドパネル(コントラクトソース表示・通信ログ)への適用範囲が
    論点であること・対象パッケージ frontend)
  - Issue 本文が参照する事実の実在確認: 用語集パネル(Issue #313、
    CLOSED)は実装済みで `SidePanelHost.glossary.test.tsx` 等が実在。
    レイアウト永続化の仕組み `packages/frontend/src/layout/layoutStore.ts`
    (Issue #15)も実在。サイドパネルの共通シェル
    `packages/frontend/src/side-panel/SidePanel.tsx` と kind ごとの
    振り分け(`SidePanelHost.tsx`)も実在し、類似要望として参照される
    Issue #362(サイドパネル幅リサイズ)は OPEN で記述どおり
  - 追記フォーマットは既存バックログ項目(チェックボックス行+括弧書きの
    補足+末尾の Issue リンク行)と一貫。配置(バックログ節末尾、
    「## 運用ルール」直前)も適切
  - コミット粒度: PLAN.md への追記のみの1コミット(dcac23f)で、
    Conventional Commits 形式(`docs:`)にも準拠
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過
    (frontend: 199ファイル2602テスト成功)
- 決定事項・注意点:
  - 実装着手は後日。UI の形(ボタン・スライダー等)・永続化の要否
    (layoutStore に載せるかセッション限りか)・用語集パネル単体か
    他のサイドパネルにも共通適用かは着手時に設計判断(Issue #362 の
    幅リサイズと同時に扱うと共通シェル側で一括対応できる可能性がある)
  - docs 配下のみの変更のため、CLAUDE.md の例外規定に基づき
    chainviz-qa は省略(reviewer 合格のみ)
