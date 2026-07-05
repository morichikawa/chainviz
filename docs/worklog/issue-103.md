# Issue #103 作業記録

### 2026-07-06 Issue #103 compose起動ノードの削除ボタン改善のバックログ追加(docsのみ)をレビュー

- 担当: reviewer
- ブランチ: docs-plan-add-103-backlog
- 内容: `docs/PLAN.md` のバックログセクションに Issue #103(compose起動
  ノードの削除ボタンを押すと必ずエラーになる)を未着手項目 `[ ]` として
  追加する変更(コミット 8deb73e、PLAN.md のみ 3 行追加)をレビューし、
  合格と判定した
- 確認結果:
  - GitHub Issue #103 は OPEN。タイトル「compose起動ノードの削除ボタンを
    押すと必ずエラーになる(UIで防げていない)」が PLAN.md の記載と一致。
    ラベルは frontend
  - Issue 本文の前提が実装と一致することを確認した。
    `packages/collector/src/adapters/ethereum/node-lifecycle.ts` の
    `removeNode` は `addNode`(および起動時のラベル回収)で登録された
    ノードのみ削除でき、未登録なら
    `node <id> was not added via addNode and cannot be removed` を投げる。
    一方 `packages/frontend/src/entities/InfraNodeCard.tsx` は全ノード
    カードに無条件で削除(×)ボタンを表示しており、Issue の指摘どおり
  - 対応方針(`NodeEntity` に `removable: boolean` を追加し collector 側で
    設定、フロントは表示を出し分け)は境界原則と整合する。`removable` は
    チェーン非依存の語彙であり、フロントが Docker/ノードに直接触れず
    ワールドステート経由で判断できるため筋が良い。`packages/shared` の
    型変更を伴う旨も Issue 本文に明記済み
  - 既存バックログ項目と同じ書式(未解決は `[ ]`、Issue リンク併記)に
    揃っている。コミットは 1 件で関心事も 1 つ
  - `pnpm lint` 通過(exit 0)。docs のみの変更のため build/test への影響なし
- 決定事項・注意点: 実装時は `chainviz-reviewer` 経由で `packages/shared`
  の型変更を調整すること(Issue 本文にも記載あり)。ワークベンチは全て
  `addWorkbench` 経由で作られるため `removable` 相当のフィールドは
  `NodeEntity` 側だけで足りる見込み
