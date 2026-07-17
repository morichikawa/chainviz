### 2026-07-17 Issue #366 追加ワークベンチの命名が静的ワークベンチと衝突する(コンテナ名409・stableId重複による操作の誤配送)（起票・バックログ追記のレビュー）

- 担当: reviewer
- ブランチ: docs-issue-366-backlog
- 内容: ユーザーが実際のワークベンチ追加・送金操作で遭遇した不具合を
  chainviz-detectiveが原因調査した結果を元に起票したIssue #366の、
  `docs/PLAN.md` バックログ節への追記（docsのみの変更）のレビュー。
  - Issue #366本文と`docs/PLAN.md`追記の照合: 症状（addWorkbenchの
    409 Conflict・transferの誤配送によるrevert）・出所（ユーザー操作中に
    遭遇、chainviz-detectiveが原因調査済み）・根本原因（静的(compose由来)
    ワークベンチがlifecycleのレジストリから不可視なのに、コンテナ名
    `<project>-workbench-1`とservice名"workbench"を占有している）・
    再現条件（フレッシュ起動後の初回addWorkbenchで確実に発生）・応急対処
    （追加時に既定以外のラベルを付ける）のいずれも一致。バックログ項目は
    要約で足りるため、Issue本文の詳細（行番号・再現ログ・証拠）が
    PLAN.md側に無いのは過不足なしと判断
  - Issue本文が参照する事実の実在確認:
    - chainviz-detectiveの調査記録は`docs/worklog/meta.md`に実在
      （main上のコミット62b33ce。本ブランチは分岐点c1fe67fがその直前の
      ため未取り込みだが、マージ後は揃う。ファイルが別なのでコンフリクト
      もしない）
    - `packages/collector/src/adapters/ethereum/node-lifecycle.ts`の
      該当ロジックはIssue本文の行番号どおり実在: 320行目
      `this.workbenchSeq = this.workbenches.length;`（managedのみの
      個数から採番再開）、641行目
      コンテナ名生成 `${this.cfg.composeProject}-${slug(service)}-${++this.workbenchSeq}`
      （失敗時もseqが進む）、705行目
      `uniqueWorkbenchService()`（メモリ上のレジストリとしか照合しない）、
      566行目`findWorkbenchContainer()`（composeプロジェクト内をservice
      ラベルで走査し先勝ちで返す）
  - `docs/PLAN.md`の追記フォーマットは直前の#364項目等と一貫
    （チェックボックス+6スペースインデントの補足+Issueリンク行）。
    配置（バックログ節末尾・「## 運用ルール」の直前）も適切
  - コミット粒度: `git log main..HEAD`は1コミット（PLAN.md追記のみ）で
    1変更1コミットの規約に適合。Conventional Commits形式も適合
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過を確認
    （frontend 198ファイル2592テスト含む）
- 決定事項・注意点:
  - レビュー結果は合格。コード変更を伴わないためCLAUDE.mdの例外規定に
    基づきchainviz-qaは省略可
  - 実装着手は後日（対象は`packages/collector`のnode-lifecycle.ts）。
    コンテナ名採番・service名一意化の両方で「Docker上の実在コンテナ
    （managedラベルの無い静的ワークベンチを含む）」を考慮する方向だが、
    具体的な実現方法は着手時に設計判断が必要
  - 修正時の回帰確認手順は`docs/worklog/meta.md`のdetective記録に
    記載済み（managed 0件で起動→既定ラベルでaddWorkbench→409にならず、
    stableIdが`chainviz-ethereum/workbench`と重複せず、操作が正しい
    walletIndexで実行されること）
