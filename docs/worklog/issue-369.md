# Issue #369 collectorのcomposeProjectが"chainviz-ethereum"にハードコードされており環境変数で上書きできない

### 2026-07-17 Issue #369 起票とバックログのIssueリンク付与のレビュー

- 担当: reviewer
- ブランチ: docs-issue-369-and-353-backlog
- 内容: `docs/PLAN.md` のバックログに以前から記載されていたが GitHub
  Issue 化されずに残っていた項目(collector の composeProject が
  "chainviz-ethereum" にハードコードされ環境変数での上書き口が無く、
  QA 検証時に独立した合成環境でワークベンチ経由の操作
  (runWorkbenchOperation 等)を検証できない)について、統括が新規に
  Issue #369 を起票し、既存のバックログ項目にリンクと経緯の補足
  (Issue 化されずに残っていた旨・2026-07-17 に Issue 化した旨)を
  追記した。その内容をレビューした。
- レビュー結果: 合格
  - Issue #369 本文と PLAN.md の項目(573行目付近)が過不足なく一致
    (ハードコード箇所・上書き口が無いこと・QA 検証への影響・
    対象パッケージ collector)
  - 追記フォーマットが既存バックログ項目(チェックボックス行+括弧書きの
    補足+末尾の Issue リンク行)と一貫
  - 同一コミットで行われた Issue #353 のバックログ追記漏れの修正も
    あわせて確認(詳細は docs/worklog/issue-313.md の追記を参照)。
    「バックログの記載漏れ修正」という単一の関心事であり、1コミットに
    まとまっていることは妥当と判断
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過
- 決定事項・注意点:
  - 本 Issue の実装(環境変数での上書き口の追加など具体的な実現方法)は
    未着手。着手時に設計判断が必要(Issue 本文にも明記あり)
  - docs 配下のみの変更のため、CLAUDE.md の例外規定に基づき
    chainviz-qa は省略(reviewer 合格のみ)
