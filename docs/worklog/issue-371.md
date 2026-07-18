# Issue #371 i18n translate()にObject.prototype由来キー(toString等)への防御が無い

### 2026-07-17 Issue #371 起票とバックログ追記のレビュー

- 担当: reviewer
- ブランチ: docs-issue-371-backlog
- 内容: Issue #341(p2p-legendの日英混在)のレビュー中に見つかった軽微な
  堅牢性の指摘について、統括が Issue #371 を起票し `docs/PLAN.md` の
  バックログに追記した。その内容をレビューした。
- レビュー結果: 合格
  - Issue #371 本文と PLAN.md の追記が過不足なく一致(発見経緯が
    Issue #341 のレビュー中であること・型 `MessageKey` により通常の
    コードから到達不能であること・#341 以前からの既存挙動であること・
    既存の `format()` と同様の `hasOwnProperty` ガードを追加するという
    期待対応・対象パッケージ frontend)
  - Issue 本文が参照する事実の実在確認: `packages/frontend/src/i18n/i18n.ts`
    の `translate()` (57-61行)は `messages[key]` を無ガードで参照しており
    プロトタイプ由来キーで契約(未知キーはキー文字列を返す)が破れる。
    同ファイルの `format()` (75行)には
    `Object.prototype.hasOwnProperty.call()` ガードが実在。production
    コードで `translate()` を呼ぶのは
    `packages/frontend/src/i18n/LanguageProvider.tsx` の1箇所のみ、という
    記述も grep で確認し正確
  - 追記フォーマットは既存バックログ項目(チェックボックス行+括弧書きの
    補足+末尾の Issue リンク行)と一貫。配置(バックログ節末尾)も適切
  - コミット粒度: #371/#373 追記と #346 記載更新が1コミットに
    まとまっているが、いずれも「Issue #346 の対応で判明した事項の
    バックログ反映」という単一の関心事であり妥当と判断
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過
- 決定事項・注意点:
  - 実装着手は後日。`translate()` に `hasOwnProperty` ガードを追加する
    軽微な修正で、着手時は回帰テスト(プロトタイプ由来キーでキー文字列が
    返ること)もあわせて書く
  - docs 配下のみの変更のため、CLAUDE.md の例外規定に基づき
    chainviz-qa は省略(reviewer 合格のみ)
