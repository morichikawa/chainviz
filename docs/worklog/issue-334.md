# Issue #334 removeWorkbenchがaddWorkbenchで追加したワークベンチにも「追加されていない」エラーを返すことがある

### 2026-07-16 Issue #330・#334 起票とバックログ追記のレビュー

- 担当: reviewer
- ブランチ: docs-issue-330-334-backlog(docs/PLAN.md のみのステージ済み・
  未コミット変更をレビュー。実装着手は後日)
- 内容: Issue #334 の起票内容、Issue #330 の起票時に失念していた
  `docs/PLAN.md` バックログ節への追記(2項目)をレビューした。
  結果は**合格**
- 確認したこと(Issue #334):
  - Issue本文が引用するエラーメッセージ "was not added via addWorkbench
    and cannot be removed" が実装
    (`packages/collector/src/adapters/ethereum/node-lifecycle.ts` 469行目)
    に実在し、対象パッケージ(`packages/collector`)・collectorラベルとも
    実装の所在と一致する
  - 「再現手順未調査・偶発的な観測」と明示したうえで chainviz-detective
    による原因調査を先行させる進め方は、原因未調査の不具合に対する
    既存の運用(Issue #328 と同型)と一貫しており妥当
- 確認したこと(Issue #330):
  - Issue本文が引用する実装参照はいずれも実コードと一致する:
    `TransactionEntity.status` の `"pending"`(entities.ts 349行目)、
    `PENDING_TX_RETENTION = 256`(store.ts 82行目)、
    `NodeInternals.mempool`(entities.ts 51-56行目)、InfraPopover.tsx の
    txpool 表示(242行目からのブロック)。ARCHITECTURE.md の既知ギャップ
    指摘「mempool は用語解説にあるが実数がどこにも出ない」も実在する
    (本文の 1398行目 という参照は起票時点の main では正確だったことを
    reflog で確認した。その後 #319 の設計追記により現在は 1450行目に
    移動している。Issue本文の行番号参照は起票時点のスナップショット
    なので修正は不要と判断)
  - PLAN.md 追記の括弧書き「設計完了・実装はレビュー指摘の修正中」は
    `issue-330-mempool-view` ブランチの実状(設計 docs・frontend 実装・
    テスト強化まで完了、レビューで fromIsWallet の表記照合バグを差し戻し中)
    と一致する
- 確認したこと(共通):
  - `docs/PLAN.md` の追記2項目はバックログ節の既存項目とフォーマットが
    一貫している(未チェックのチェックボックス+タイトル行、6スペース
    インデントの括弧書き補足、Issueリンク行、節末尾への追加)。タイトルは
    GitHub 上の Issue タイトルと一致
  - docsのみの変更だが規定どおり `pnpm lint` / `pnpm build` / `pnpm test`
    をリポジトリ全体で実行し、全件通過(テスト計3809件: shared 64 /
    e2e 158 / collector 1458 / frontend 2129)を確認した
- 決定事項・注意点:
  - Issue #330 の作業記録(`docs/worklog/issue-330.md`)は
    `issue-330-mempool-view` ブランチ上に既に存在するため、本ブランチには
    あえて作成しない(両ブランチで同名ファイルを新規作成すると main への
    マージ時に add/add コンフリクトになるため)。本レビューの #330 分の
    記録は本ファイルにまとめた
  - PLAN.md の #330 の項目行は、`issue-330-mempool-view` ブランチのマージ時
    にチェックボックス更新の対象になる。本ブランチを先に main へマージ
    しないと #330 側の PR がチェックを付ける行が存在しないため、マージ
    順序は本ブランチが先(統括への申し送り)
  - 軽微な指摘(非ブロッキング): Issue #334 は不具合報告だが `bug` ラベルが
    付いていない(collector のみ)。#303 は `bug`+`collector` の前例がある
    一方、#328 も `frontend` のみで慣行は揺れている。統括の判断で `bug` を
    付与するとよい
