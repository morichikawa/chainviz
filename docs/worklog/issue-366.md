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

### 2026-07-17 実装 設計メモ（collector）

- 担当: collector
- ブランチ: issue-366-workbench-naming-collision

対象は `packages/collector/src/adapters/ethereum/node-lifecycle.ts` の2箇所。

**問題1: コンテナ名の409衝突**

`workbenchSpec()` は `${project}-${slug(service)}-${++this.workbenchSeq}` で
コンテナ名を組み立てるが、`workbenchSeq` の初期値は
`recoverManagedContainers()` が回収した managed ラベル付きコンテナの個数
（静的ワークベンチは含まれない）から決まる。事前に「実際に使われている
コンテナ名の一覧」を取得して突き合わせる方式（例: `docker.listContainers`
を project ラベルだけで走査し、コンテナ名を集めて既存集合と照合してから
採番する）も検討したが、以下の理由で不採用とした。

- Docker の `listContainers` はコンテナ名そのもの（`Names` フィールド）を
  返すが、現状の `DockerOperations.listContainersByLabels` はラベルのみを
  返す設計になっており、コンテナ名まで持ち回るには型を拡張する必要がある。
- 「事前に確認してから作成する」方式は TOCTOU（確認から作成までの間に
  別プロセス・別リクエストが同じ名前でコンテナを作る）競合に弱い。

代わりに、**Docker 自身の名前重複検出（409）をそのまま利用したリトライ**
方式を採る。

- `packages/collector/src/docker/operations.ts` に
  `ContainerNameConflictError`（コンテナ名の重複が原因での失敗であることを
  表す型）を追加する。dockerode の生のエラー形状（`statusCode`/`message`）を
  ChainAdapter 層（node-lifecycle.ts）に漏らさないための変換型で、
  `isRemovalInProgress`/`isNoSuchContainer`（既存の409/404判定ヘルパー）と
  同じ置き場所・同じ思想。
- `dockerode-operations.ts` の `createAndStart` が、dockerode からの生エラーが
  「名前重複」（409 かつ message に "already in use" を含む）と判定できた
  場合にこの型へ変換して re-throw する。
- `node-lifecycle.ts` の `addWorkbench` は、コンテナ作成が
  `ContainerNameConflictError` で失敗した場合、`workbenchSeq` を1つ進めて
  別の候補名で再試行する（最大試行回数はコード内に安全弁として定数で持つが、
  「今この瞬間の観測値」ではなく無限ループ防止のための余裕を持った上限であり、
  通常は1〜2回の再試行で解決する見込み）。これにより、静的ワークベンチの
  実在チェックを個別に行わなくても、Docker が実際に把握している状態と
  必ず整合する形で採番できる。TOCTOU競合にも強い（チェックと作成が同じ
  create 呼び出しの成否そのものになるため）。

**問題2: stableId重複による誤配送**

`uniqueWorkbenchService()` はメモリ上の `this.workbenches`（collector が
addWorkbench で作成し、かつプロセスが記憶している範囲）としか照合しない。
静的ワークベンチは managed ラベルを持たないため `recoverManagedContainers()`
で回収されず、`this.workbenches` に一切現れない。

`findWorkbenchContainer()` が既に採用している方式（compose project ラベル
だけで Docker 上の全コンテナを走査し、Docker のラベルを単一の真実の情報源と
扱う。Issue #65 の方針）を流用し、`uniqueWorkbenchService()` も
`listContainersByLabels({ [COMPOSE_PROJECT_LABEL]: composeProject })` の
結果（静的ワークベンチ・reth/beacon/validator・過去に回収し損ねた managed
コンテナ等すべてを含む）と `this.workbenches` の和集合を「使用済み
service名」として衝突判定する。非同期になるため `uniqueWorkbenchService`
を async 化し、呼び出し元 `addWorkbench` も await するよう変更する。

**回帰確認シナリオ（実装後に実機で確認する）**

1. 稼働中の `profiles/ethereum` スタック（静的ワークベンチ込み）に対し、
   collector をフレッシュ起動（managed コンテナ0件）した直後に既定ラベルで
   `addWorkbench` を実行し、409にならず成功すること。
2. 上記で作成されたワークベンチの stableId が静的ワークベンチの
   `chainviz-ethereum/workbench` と重複しないこと（例:
   `chainviz-ethereum/workbench-2`）。
3. 2. のワークベンチに対する `transfer` 等の操作が、静的ワークベンチではなく
   意図した（新規追加した）コンテナ・walletIndexで実行されること。
4. `removeWorkbench` が1回の呼び出しで正しく完了し、静的ワークベンチを
   道連れにしないこと。

いずれも修正前に実際に再現し、修正後に再現しないことを確認してから
完了とする（Issue #334はこの一連の不具合の派生症状として扱う）。

