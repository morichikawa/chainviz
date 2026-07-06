# Issue #113 仮カード(ゴーストノード)の配置indexが、削除を挟むと重なることがある

### 2026-07-06 Issue #113 バックログ登録のレビュー

- 担当: reviewer
- ブランチ: docs-plan-add-113-backlog
- 内容: Issue #113 の起票と `docs/PLAN.md` バックログへの追加（コミット
  5717441、docs のみの変更）をレビューし、合格とした
- 確認したこと:
  - `gh issue view 113` で Issue が OPEN であり、タイトル
    「仮カード(ゴーストノード)の配置indexが、削除を挟むと重なることがある」
    が PLAN.md のバックログ記載と一致すること。`frontend` ラベル付与も適切
    （原因箇所が `packages/frontend/src/commands/useCommands.ts` のため）
  - Issue 本文が、Issue #102 の静的レビュー時に指摘した内容
    （`docs/worklog/issue-102.md` の 2026-07-06 静的レビュー記録。
    現時点では issue-102-add-ghost-node ブランチ上）を正確に反映している
    こと。具体的には:
    - 原因コードの記載（`index: infraCount + ghostSeqRef.current`）が
      issue-102-add-ghost-node ブランチの実装（コミット 83152de 時点の
      `useCommands.ts`）と一致する
    - 再現手順（entityAdded で infraCount=1 → addNode で index=1、seq→1 →
      entityRemoved で infraCount=0 → addNode で index=0+1=1 となり
      1枚目と同一セルに重なる）が、増分と減分が相殺するという指摘の
      メカニズムどおりである
    - 「ゴーストが消えても巻き戻さない（以後常に新しいセルへ置ける）」
      というコメントが過大な主張である点、影響が表示上の重なりのみで
      機能への実害が無い点、対応方針（配置 index を単調増加カウンタ単独に
      する）も、レビュー時の申し送りと一致する
  - `pnpm lint` がリポジトリ全体で通ること（exit 0）
  - コミットが 5717441 の1件のみで、docs のみの変更として関心事が
    混ざっていないこと
- 注記: Issue 本文が参照する `useCommands.ts` のコードは、レビュー時点では
  main 未マージの issue-102-add-ghost-node ブランチ上にある。#102 が
  マージされる前に本 Issue に着手しないこと（着手時は #102 マージ後の
  実装を前提にする）。
- QA について: docs のみの変更のため、統括の判断により chainviz-qa は
  省略（動かして検証する対象が無い）。
