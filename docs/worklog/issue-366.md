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

### 2026-07-17 実装記録（collector）

- 担当: collector
- ブランチ: issue-366-workbench-naming-collision

設計メモどおりに実装した。変更ファイル:

- `packages/collector/src/docker/operations.ts`:
  `ContainerNameConflictError` を追加。`createAndStart` の契約に
  「名前衝突時はこの型を投げる」ことを明記。
- `packages/collector/src/docker/dockerode-operations.ts`:
  `createAndStart` が dockerode の生エラー（409 かつ message に
  "already in use" を含む）を `ContainerNameConflictError` へ変換する。
  それ以外の失敗（イメージ不在等）はそのまま伝播させる。
- `packages/collector/src/adapters/ethereum/node-lifecycle.ts`:
  - `addWorkbench` からコンテナ作成部分を `createWorkbenchContainer`
    private メソッドへ切り出し、`ContainerNameConflictError` を捕捉して
    `workbenchSeq` を進めながら最大 `WORKBENCH_NAME_CONFLICT_RETRIES`
    (1000、無限ループ防止の安全弁であり環境観測値ではない旨をコメントに明記)
    回まで再試行するようにした。
  - `workbenchSpec` はコンテナ名の連番 `seq` を引数で受け取るよう変更し
    （従来は `++this.workbenchSeq` を内部でインクリメントしていた）、
    採番の決定をリトライループ側に一本化した。
  - `uniqueWorkbenchService` を async 化し、新設した
    `existingWorkbenchServiceNames()`（`listContainersByLabels` を
    compose project ラベルのみで呼び、静的ワークベンチ・reth/beacon/
    validator・回収済みでない managed コンテナ等を走査する）と
    `this.workbenches`（メモリ上のレジストリ）の和集合で衝突判定するよう
    変更した。
  - `recoverManagedContainers` 内の `workbenchSeq` 初期値に関するコメントを、
    「この値はあくまで開始点の見積もりであり、ズレていても
    createAndStart 側のリトライで解決する」という新しい前提に合わせて
    書き直した。

**実機での再現・修正確認**（`docker ps` の共有 `chainviz-ethereum` スタックは
他Issueの並行作業中(コンテナ増減あり)だったため使用せず、`/tmp` の
scratchpad に compose project名・サブネットを変えた隔離スタック
`issue366repro`(`profiles/ethereum` を複製し、host向けポート公開を除去)を
別途起動して確認した）:

1. 修正前のコードに対し、実際の dockerode を使うスクリプトで
   `recoverManagedContainers()` → `addWorkbench("")` を実行し、Issue本文と
   一致する409エラー（`The container name "/issue366repro-workbench-1" is
   already in use ...`）が実際に発生することを確認した。
2. 修正後、同じ操作が成功し、作成されたコンテナ名は
   `issue366repro-workbench-2-1`、service ラベルは `workbench-2`、stableId
   は `issue366repro/workbench-2` となり、静的ワークベンチ
   （`issue366repro/workbench`）と重複しないことを確認した。
3. 静的ワークベンチ・新規ワークベンチの双方へ `runWorkbenchOperation`
   (`transfer`) を実行し、異なる txHash（＝異なる送信元コンテナ・鍵）で
   実行されることを確認した（誤配送が起きていない）。
4. `removeWorkbench` を新規ワークベンチの stableId に対して1回呼び出すと
   正しく削除され、静的ワークベンチは道連れにならず操作可能なまま残った。

隔離スタックは確認後 `docker compose down -v` で片付け、他Issueが使っている
共有スタックには一切触れていない。

**テスト**:

- `packages/collector/src/docker/operations.test.ts`（新規）:
  `ContainerNameConflictError` の基本的な形状。
- `packages/collector/src/docker/dockerode-operations.test.ts`:
  `createAndStart` が実際の409エラー文言を `ContainerNameConflictError` へ
  変換すること・無関係な409やそれ以外の失敗は変換せず伝播させること・
  名前衝突時に `start()` を呼ばないことを追加。
- `packages/collector/src/adapters/ethereum/node-lifecycle-workbench-naming.test.ts`
  （新規。既存の `node-lifecycle.test.ts` が既に大きいため関心事ごとに
  分離）: コンテナ名の再試行（1回衝突・複数回連続衝突・再試行後も
  `workbenchSeq` が引き継がれる・再試行上限で打ち切る・名前衝突以外は
  即伝播する）と、stableId 重複の回避（Docker 上だけに存在する静的
  ワークベンチとの衝突回避、`recoverManagedContainers` からの一連の
  回帰シナリオ、`listContainersByLabels` の呼び出しラベルが managed 限定に
  なっていないこと）をカバーする。
- 既存の `node-lifecycle.test.ts` の workbench 関連テストは無修正で
  そのまま通ることを確認済み（`uniqueWorkbenchService`/`workbenchSpec` の
  シグネチャ変更は呼び出し元のみに閉じている）。

**確認結果**: `pnpm --filter @chainviz/collector build` /
`pnpm --filter @chainviz/collector test`（1577件）/ `pnpm lint`
（workspace全体）がすべて成功。`pnpm build`（workspace全体、shared/
collector/e2e/frontend）も成功。

**次の担当への申し送り**:

- `docs/PLAN.md` のIssue #366と #334の両方のチェックボックスを更新した
  （#334はchainviz-detectiveの調査により本Issueと同一原因の派生症状と
  判明済みのため、実装担当の判断で合わせてチェックした。Issueのクローズ
  自体はPRマージ時の自動クローズに委ねる。PR本文には
  `Closes #366` `Closes #334` の両方を含めること）。
- コンテナ名衝突の解消はリトライ方式（TOCTOUに強い）、service名/stableId
  重複の解消は都度のDocker問い合わせ方式（弱いTOCTOUが残るが、複数の
  addWorkbench呼び出しが完全同時に届く場合に限る低確率の残課題。
  websocket-server.ts の `onMessage` はメッセージ受信時に await せず
  `void` で呼んでいるため、理論上は完全同時到達がありうる。今回のIssueの
  根本原因〈静的ワークベンチとの決定的衝突〉とは別種のより一般的な
  並行性の課題であり、本Issueのスコープ外と判断した）。

### 2026-07-17 テスト強化（collector）

- 担当: tester
- ブランチ: issue-366-workbench-naming-collision

実装担当が書いた基本テスト（ハッピーパス＋主要な異常系）を土台に、
依頼された4つの重点観点について境界値・異常系のケースを追加した。
実装ロジックは変更していない。

追加したテストの観点:

- `packages/collector/src/docker/dockerode-operations.test.ts`（既存の
  `createDockerOperations` の 409 変換テスト群に追記。同一の関心事のため
  新規ファイルには分割せず隣接する既存 describe に追加）:
  - 409 以外（statusCode 500）で message に "already in use" を含む
    エラーを名前衝突へ誤変換しないこと（変換には 409 と message の両方が
    必要という契約の固定）。
  - statusCode 409 でも message が無いエラーは名前衝突と断定できず、元の
    エラーをそのまま伝播すること。
  - message の大小（"ALREADY IN USE"）が揺れても名前衝突として認識する
    こと（`/already in use/i`）。
  - createContainer が Error 以外（文字列）を投げても isNameConflict が
    typeof チェックで安全に false を返し、そのまま伝播すること。
- `packages/collector/src/adapters/ethereum/node-lifecycle-workbench-naming.test.ts`
  （実装担当が新設したファイルに、同じ関心事として追記）:
  - コンテナ名リトライの上限ちょうどの境界: 999 連続衝突の後、1000 回目
    （seq=1000）の試行で初めて成功すること（諦める側の既存テストと対で
    WORKBENCH_NAME_CONFLICT_RETRIES 回まで試行することを固定）。
  - Docker 上に静的ワークベンチが複数存在する場合（"workbench" と
    "workbench-2"）に、次に空いている suffix（"workbench-3"）まで進める
    こと。
  - service 名の一意化が「Docker 走査結果とメモリ上レジストリの和集合」で
    あることの核心: Docker 側に静的 "Alice" が居る状態で addWorkbench("Alice")
    を続けて2回呼ぶと "Alice-2" → "Alice-3" になること（メモリ側が効いて
    いないと2回目も "Alice-2" を再採番してしまう）。
  - service ラベルを持たない無関係な Docker コンテナが走査結果に混ざって
    いても、読み捨てて衝突集合に加えず既定名を使えること。
  - service 名の一意化のための Docker 問い合わせ（listContainersByLabels）
    自体が失敗した場合、衝突判定を省いて作成に突き進むのではなく、エラーを
    伝播して一切コンテナを作成しないこと。

確認結果:

- `pnpm --filter @chainviz/collector build` 成功。
- `pnpm --filter @chainviz/collector test` 成功（1586 件、テスト強化前の
  1577 件から +9 件）。
- `pnpm lint`（workspace 全体、eslint）成功。
- 既存テストはいずれも無修正で通過。実装ロジックの変更・実装バグの疑いは
  なし（申し送りにある弱い TOCTOU 競合は本 Issue のスコープ外として了解。
  今回追加したテストの範囲内でも新たな問題は検出されなかった）。

### 2026-07-17 レビュー（reviewer）

- 担当: reviewer
- ブランチ: issue-366-workbench-naming-collision
- 判定: **合格**（差し戻しなし。軽微な指摘2件は下記、対応任意）

確認した内容:

- `packages/shared` に変更が無いこと（`git diff origin/main...HEAD` の対象は
  collector と docs のみ）。設計どおり collector 内で完結している
- 境界の遵守: `ContainerNameConflictError` は `docker/operations.ts`
  （Docker 共通語彙の層）に置かれ、dockerode の生エラー形状
  （statusCode/message）を ChainAdapter 層に漏らさない変換型として機能
  している。既存の `isRemovalInProgress` 等と同じ置き場所・思想で一貫
- エラーの握りつぶしが無いこと: `createAndStart` の catch は名前衝突のみ
  変換し、それ以外は元のエラーをそのまま re-throw（コメントで明記）。
  `createWorkbenchContainer` の catch も `ContainerNameConflictError`
  以外は即伝播。`existingWorkbenchServiceNames` の Docker 問い合わせ失敗も
  伝播し、衝突判定を省いて作成に突き進まない（テストで固定済み）
- 固定値の前提条件: `WORKBENCH_NAME_CONFLICT_RETRIES`(1000) は「環境の
  観測値ではなく無限ループ防止の安全弁」である旨がコード上のコメントと
  本 worklog（設計メモ・実装記録）の両方に明記されており、CLAUDE.md の
  運用ルールを満たす。境界値（999衝突→1000回目成功 / 1000回全衝突→
  諦める）もテストで両側から固定されている
- Issue #334 を #366 の重複（派生症状）として扱う判断: detective の調査
  記録（docs/worklog/meta.md 2026-07-17 節）が、stableId 重複により
  同一 stableId のエンティティが GUI 上で静的ワークベンチのカードに
  隠れる・操作が別コンテナへ誤配送されることを実測で示しており、#334 の
  「addWorkbench で追加したはずのワークベンチに remove が『追加されて
  いない』を返す」症状はこの遮蔽・誤配送の機序で説明できる。#334 自体は
  当時の偶発観測で決定的再現はされていないが、stableId の一意化により
  この症状クラス自体が成立しなくなるため、重複扱いは妥当。万一 #366
  修正後に同症状が独立に再発した場合は別 Issue として再起票すればよい
- 既知の限定事項（addWorkbench 完全同時到達時の service 名重複という
  弱い TOCTOU）のスコープ外判断: 本 Issue の根本原因（静的ワークベンチ
  との決定的衝突）とは別種の一般的な並行性課題であり、worklog に発生
  条件（websocket-server の `void` 呼び出しによる理論上の同時到達）まで
  明記されている。スコープ外判断は妥当。コンテナ名側はリトライ方式に
  より TOCTOU 耐性がある
- テストコードの質: 和集合判定の核心（メモリ側が効かないと再採番する
  ケース）、無関係コンテナの読み捨て、managed 限定になっていないことの
  ラベル引数検証、409 変換の両側condition（409 かつ message の両方が
  必要）など、実装を壊すと確実に落ちる意味のあるケースで構成されている。
  新規テストファイルの分離（1ファイル1責務）も適切
- コミット粒度: 型変換層の追加 / lifecycle の修正 / docs / テスト強化
  2件がそれぞれ独立のコミットに分かれており、Conventional Commits 形式
  にも適合
- `pnpm lint` / `pnpm build`（shared/collector/e2e/frontend）/
  `pnpm test`（collector 1586 件・frontend 2592 件を含む全パッケージ）
  すべて通過

軽微な指摘（合否に影響なし。対応は任意）:

1. `dockerode-operations.test.ts` の「does not call start() when
   createContainer fails with a name conflict」は、`start` スパイが
   docker モックのどこにも接続されていない（createContainer が reject
   するためコンテナオブジェクト自体が存在せず、start は構造上呼び得ない）。
   `expect(start).not.toHaveBeenCalled()` は空虚に真となるアサーション。
   同テストの型変換アサーション自体は他テストと重複しており、削除しても
   カバレッジは落ちない
2. `node-lifecycle.test.ts` の fakeOps に追加された `conflictingNames`
   オプションは、同ファイル内のどのテストからも使われていない（実際に
   使うテストは新設の node-lifecycle-workbench-naming.test.ts 側にあり、
   そちらは独自の fakeOps を持つ）。未使用のヘルパー拡張として残っている

### 2026-07-17 QA検証（qa）

- 担当: qa
- ブランチ: issue-366-workbench-naming-collision
- 判定: 合格（完了条件を満たす）

共有Dockerスタック（chainviz-ethereum）は他Issue（#346）の残骸コンテナ
（beacon3/reth3/test-2/workbench-3）が稼働中で他作業の使用可能性があるため
触れず、`profiles/ethereum`を複製してcompose project名を`issue366qa`・
サブネットを172.29系へ変更し、ホストポート公開を除去した隔離スタックを
別途起動して検証した（実装担当・チームと同じ方針）。検証で追加したコンテナ・
ネットワーク・ボリュームは終了時に`docker compose down -v --remove-orphans`と
明示的な`docker rm`で全て撤去し、検証前後で共有スタックのコンテナ一覧が
完全に同一であることを確認済み（共有スタックには一切触れていない）。

検証は、ビルド済みのcollector実コード（`dist/adapters/ethereum/
node-lifecycle.js`・`dist/docker/dockerode-operations.js`）を実際の
dockerode経由で隔離スタックに対して駆動する使い捨てスクリプトで行った
（フレッシュなcollector状態を模すため`recoverManagedContainers()`を先に
実行。静的ワークベンチはmanagedラベルを持たないため回収されずmanaged 0件の
状態から開始）。

確認結果:

1. 元のユーザー報告の再現確認（409の解消）: 静的ワークベンチ
   （`issue366qa/workbench`、コンテナ名`issue366qa-workbench-1`）が存在する
   状態で既定ラベル（空文字）の`addWorkbench("")`を実行し、409を発生させずに
   成功した。作成された動的ワークベンチのservice名は`workbench-2`、stableIdは
   `issue366qa/workbench-2`となり、静的ワークベンチの`issue366qa/workbench`と
   重複しなかった。
2. コンテナ名409リトライ機構の実機動作: service名を持たないデコイコンテナ
   `issue366qa-Foo-1`を手動で作成して意図的に名前衝突を仕込み、
   `addWorkbench("Foo")`を実行したところ、`ContainerNameConflictError`を
   捕捉して連番を進め`issue366qa-Foo-2`として作成に成功した（症状1の
   リトライ経路が実Docker上で機能することを直接確認）。
3. 誤配送が起きないこと: 静的ワークベンチ（`issue366qa/workbench`）と新規
   ワークベンチ（`issue366qa/workbench-2`）の双方に対しtransferを実行し、
   送信元アドレスが静的=walletIndex 0（0x2BB7…）、新規=walletIndex 1
   （0xfCd9…）と異なることを、それぞれのtxHashから`cast tx <hash> from`で
   確認した。操作が別コンテナ・別鍵へ誤配送されていない。
4. removeWorkbenchの1回完了（Issue #334）: 新規ワークベンチのstableIdに対し
   `removeWorkbench`を1回呼び出すと正しく削除され、「追加されていない」
   エラーは発生しなかった。削除後も静的ワークベンチは残存し、transferが
   引き続き成功することを確認（道連れ削除なし）。
5. `docs/PLAN.md`の#366（追加ワークベンチの命名衝突）・#334
   （removeWorkbenchの誤エラー）の完了条件を満たす。両チェックボックスは
   実装担当が既に`[x]`済みのため据え置く。

統括からの追加確認（Issue #359との相互作用）:

- 空ラベル（既定）でのaddWorkbenchで、動的ワークベンチのservice名が静的
  ワークベンチの`workbench`と一致しないこと → 上記1で`workbench-2`となり
  一致しないことを確認済み。
- 本ブランチには#359のconfig-hashラベル付与の変更は含まれていない
  （`config-hash`への参照はpackages/配下に存在しない）ことを確認。
  参考として、本ブランチ（config-hash無し）の状態で動的ワークベンチ
  （`issue366qa-workbench-2-1`）が存在する状態のまま隔離スタックに
  `docker compose up -d`（--remove-orphans無し）を実行したところ、動的
  ワークベンチは同一コンテナIDのまま稼働継続し、再作成も削除もされなかった。
  ただしこれはconfig-hashラベルが無い状態での挙動であり、#359が動的
  ワークベンチにconfig-hashを付与した後の相互作用は本ブランチでは検証
  できない。**#359とのマージ後に統括側で再検証が必要**。
