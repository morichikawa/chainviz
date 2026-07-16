### 2026-07-16 Issue #346 UI層E2Eテストの一部が実.hover()依存・描画安定性不足でflakyになりうる（起票・バックログ追記のレビュー）

- 担当: reviewer
- ブランチ: docs-issue-346-backlog
- 内容: Issue #322のQA検証中にchainviz-qaが発見した既存のE2Eテスト脆さの
  Issue起票と、`docs/PLAN.md` バックログへの追記（docsのみの変更）のレビュー。
  - Issue #346本文とQA報告（`docs/worklog/issue-322.md` のQA記録）の照合:
    個別再現した4テスト（UI-C-04/UI-CMD-07/UI-ERR-02/UI-D-03）の失敗内容・
    UI-B-06をクロステスト汚染の誤検出として対象外にした判断・
    「slot time非依存の既存脆さ」という切り分け・期待する対応
    （dispatchHoverへの寄せ、UI-CMD-07のstable調査、UI-ERR-02の検出経路
    確認）のいずれもQA報告と一致し、過不足なし
  - Issue本文が参照する事実の実在確認: `dispatchHover` は
    `packages/e2e/src/ui/support/interactions.ts` に実在、UI-D-02は
    `packages/e2e/src/ui/node-internals.spec.ts` に実在し実.hover()を
    使わない代替手段の参考例という記述は正確
  - `docs/PLAN.md` の追記フォーマットは直前の #341 項目と一貫
    （チェックボックス+6スペースインデントの補足+Issueリンク行）。
    配置（バックログ節末尾・「## 運用ルール」の直前）も適切
  - `pnpm lint` / `pnpm build` / `pnpm test` 全通過を確認
- 決定事項・注意点:
  - レビュー結果は合格。コード変更を伴わないためCLAUDE.mdの例外規定に
    基づきchainviz-qaは省略可
  - QA報告は「それぞれ別Issue(frontend/e2e)」を推奨していたが、共通の
    根（実.hover()依存・描画安定性）を持つため1 Issueにまとめた統括の
    判断は妥当。着手時に原因が独立と判明したら分割すればよい
  - ラベルは bug + frontend。リポジトリに `e2e` ラベルは存在せず、
    Issue本文に対象パッケージ（`packages/e2e`）が明記されているため
    frontend で問題ない
  - 実装着手は後日。着手時は UI-CMD-07 について Issue #328
    （preserveDraggingState）との関連調査から入るのがよい
