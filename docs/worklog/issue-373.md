# Issue #373 UI-CMD-07: ワークベンチ削除ボタンがE2E上でstableにならないことがある(原因不明)

### 2026-07-17 Issue #373 起票(Issue #346からの分割)とバックログ追記のレビュー

- 担当: reviewer
- ブランチ: docs-issue-371-backlog
- 内容: Issue #346(UI層E2Eテストのflaky不具合)の対応中、UI-CMD-07 の
  「削除ボタンが stable にならない」事象だけが原因不明のまま再現できな
  かったため、統括が Issue #373 として分割起票し、`docs/PLAN.md` の
  バックログへ追記した。あわせて #346 の既存項目の記載を実際に判明した
  解決経緯で更新した。その内容をレビューした。
- レビュー結果: 合格
  - Issue #373 本文と PLAN.md の追記が過不足なく一致(#346 からの分割で
    あること・クリーンな環境で6回連続実行しても再現できなかったこと・
    preserveDraggingState(Issue #328)のコードレビューでも断定できる原因が
    見つからなかったこと・着手時は chainviz-detective による原因調査から
    始めること・クリーンな独立した合成環境が望ましいこと)
  - #346 の記載更新も裏付けを確認: chainviz-frontend の調査・実装記録が
    ブランチ `issue-346-e2e-hover-flakiness` 上の
    `docs/worklog/issue-346.md` に実在し、UI-C-04/UI-D-03 は Issue #245 の
    PopoverPortal 化で locator の子孫スコープが壊れていたことの発見と修正、
    UI-ERR-02 は Issue #235 の修正にテストが追随していなかったことの
    発見と修正、UI-CMD-07 の不再現と分割提案、のいずれも PLAN.md の
    更新文と一致
  - 追記フォーマットは既存バックログ項目と一貫。#346 のチェックボックスを
    未完了のまま残す判断(修正ブランチが未マージ・Issue も OPEN)も適切
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過
- 決定事項・注意点:
  - Issue #373 本文と本ブランチの PLAN.md が参照する
    `docs/worklog/issue-346.md` のフロントエンド調査記録は、本ブランチ
    ではなく `issue-346-e2e-hover-flakiness` ブランチにのみ存在する。
    main 上で参照が成立するのは同ブランチのマージ後
  - 本ブランチと `issue-346-e2e-hover-flakiness` は PLAN.md の #346 項目を
    それぞれ異なる文面で更新しており、後からマージする側でコンフリクトが
    発生する見込み。本ブランチの文面(#373 への分割まで反映)のほうが
    新しく正確なため、解消時はこちらを優先するのがよい
  - 実装(原因調査)着手は後日。着手時はまず chainviz-detective に依頼し、
    共有 Docker スタックの環境汚染の影響を避けるため独立した合成環境
    (Issue #369 の解決が前提になり得る)で行うことが望ましい
  - docs 配下のみの変更のため、CLAUDE.md の例外規定に基づき
    chainviz-qa は省略(reviewer 合格のみ)
