# Issue #293: 動的ワークベンチの deployContract が No contract found で失敗する

## 設計メモ（着手前）

### 根本原因（Issue本文の統括調査を再確認）

- `EthereumNodeLifecycle.workbenchSpec()`（`node-lifecycle.ts`）が組み立てる
  `ContainerSpec` に `binds` が無い。そのため `addWorkbench` で作られる
  コンテナには `/contracts` が存在せず、`buildOperationCommand`
  （`workbench-operations.ts`）が組み立てる
  `forge create <contractKey> --root /contracts ...` が必ず失敗する。
- 静的ワークベンチ（`docker-compose.yml` の `workbench` サービス）は
  `volumes: - ./contracts:/contracts` で同じパスをマウントしており、
  こちらは問題なく動作している。

### 変更方針

- `rethSpec()` / `beaconSpec()` が `this.scriptPath()` で
  `profileDir/scripts/<name>` のホスト絶対パスを組み立てて `binds` に
  積んでいる既存パターンに倣い、`workbenchSpec()` にも
  `path.join(this.cfg.profileDir, "contracts")` を `/contracts` へ bind
  mount する `binds` エントリを追加する。
- マウント先のパス文字列は `workbench-operations.ts` が既に
  `CONTRACTS_MOUNT_PATH` という定数でエクスポートしているので、
  `node-lifecycle.ts` からその定数を import して使い、`"/contracts"` を
  ハードコードで重複させない（1箇所に真実の情報源を置く）。
- 読み取り専用にするか検討: `docker-compose.yml` 側の静的ワークベンチは
  `ro` を付けず読み書き可能でマウントしている（`forge create` はビルド
  成果物 `out/`・`cache/` をマウント先に書き戻す設計のため）。動的
  ワークベンチも同じ挙動に揃えるため `:ro` は付けない。
- `callContract`（`cast send`）は `--root` を使わずコントラクトのソース/
  ビルド成果物に依存しないため、この変更による影響はない（Issue本文の
  記載どおり）。

### 変更しない箇所

- `profiles/ethereum/docker-compose.yml` の静的 `workbench` サービス定義
  （既に正しく動作している）。
- `ContainerSpec` 型自体（`binds` フィールドは既存。追加の型変更は不要）。

### テスト方針

- `node-lifecycle.test.ts` の `EthereumNodeLifecycle workbench commands`
  describe ブロックに、`addWorkbench` が作る `ContainerSpec.binds` に
  `<profileDir>/contracts:/contracts` を含むケースを追加する。既存の
  `reth.binds` に対するアサーション（`addNode` のテスト）と同じ
  `toContain` パターンに倣う。

## 実装記録

- `workbenchSpec()` に `binds: [`${path.join(this.cfg.profileDir,
  "contracts")}:${CONTRACTS_MOUNT_PATH}`]` を追加した。
- `node-lifecycle.test.ts` に、`addWorkbench` が作るコンテナの `binds` に
  `<profileDir>/contracts:/contracts` が含まれることを確認するテストを
  追加した。
- 実機確認（`docker compose up -d` でスタック起動 → `addWorkbench` コマンド
  で動的ワークベンチを追加 → `deployContract` を実行）:
  - 修正前: 動的ワークベンチのコンテナに `/contracts` が存在せず
    `forge create` が `No contract found with the name` で失敗することを
    確認した。
  - 修正後: `docker inspect` で動的ワークベンチのコンテナに
    `profiles/ethereum/contracts` → `/contracts` の bind mount が付与
    されていることを確認し、`deployContract` 操作が成功することを確認
    した。
- `pnpm --filter @chainviz/collector build` / `test` が通ることを確認した。

## テスト強化（chainviz-tester）

実装担当が追加した基本テスト（`node-lifecycle.test.ts` の
「mounts the sample contracts project ...」1 件）に対し、エッジケース・
境界値・非退行の観点でテストを追加した。

- 追加先は新規ファイル `workbench-contracts-mount.test.ts`。
  `node-lifecycle.test.ts` が既に 1680 行・多数の関心事（parseMnemonic /
  allocateNodeIndex / addNode / removeNode / workbench commands /
  runWorkbenchOperation など）を抱えて肥大化しているため、Issue #293 の
  「/contracts の bind mount」という関心事だけを独立ファイルに切り出した
  （CLAUDE.md「1 ファイル 1 責務」をテストファイルにも適用）。既存の
  基本テストはそのまま残している。
- 追加した観点:
  - マウント元（source）が profileDir に完全追従すること（異なる絶対
    パス 2 種で検証。旧 profileDir の値が残留しないことも確認）。
    profileDir 末尾スラッシュが path.join で正規化され `//contracts` に
    ならない境界値も追加。
  - マウント先（target）が `CONTRACTS_MOUNT_PATH` と一致し、かつ
    deployContract が組み立てる `forge create --root <値>` と同一値である
    こと（両者が同じ定数を真実の情報源にしている前提を固定。これが
    食い違うのが #293 の不具合そのもの）。
  - 静的ワークベンチ（`docker-compose.yml` の `workbench` サービス）が
    `./contracts` をマウントする先と `CONTRACTS_MOUNT_PATH` が一致する
    こと（compose ファイルを読んで target を突き合わせ、定数がずれたら
    検出する）。
  - binds 追加が他フィールドを巻き添えにしていないこと（env / labels /
    networkName / image / entrypoint / extraHosts の非退行）。binds が
    ちょうど 1 件で `:ro` を付けていないこと（forge が out/・cache/ を
    書き戻すため read-only にできない設計上の制約を固定）。
  - addNode（reth/beacon）の ContainerSpec に /contracts マウントが
    誤って波及していないこと（関心の分離）。
- 追加テストが実際に不具合を検出できることを確認した。実装の `binds` を
  空配列に戻すと source/target 系 6 件が失敗し、`CONTRACTS_MOUNT_PATH` を
  別値にすると compose 突き合わせテストが失敗することを確認してから、
  実装を元へ戻した。
- `pnpm --filter @chainviz/collector build` / `test`（1309 件）/ 新規
  ファイルの lint が通ることを確認した。

## レビュー（chainviz-reviewer）

判定: **合格**。依頼された観点を順に確認した。

- **binds の形式と profileDir の解決**: `workbenchSpec()` の
  `binds: ["<contractsPath()>:<CONTRACTS_MOUNT_PATH>"]` は Docker Binds の
  `host:container` 形式として正しい。ホスト側パスは新設の私有ヘルパー
  `contractsPath()`（`path.join(this.cfg.profileDir, "contracts")`）で
  組み立てており、既存の `scriptPath()` と同じパターン。`profileDir` は
  本番では `resolveProfileDir()`（`index.ts`）が `path.resolve` で絶対パス
  として導出するため、reth/beacon の既存 binds と同じ前提で問題ない。
- **CONTRACTS_MOUNT_PATH の再利用**: `node-lifecycle.ts` は元々
  `workbench-operations.ts` から `buildOperationCommand` 等を import して
  おり、既存の依存辺に定数を1つ足しただけ。`workbench-operations.ts` 側の
  import は `@chainviz/shared` のみで、循環依存は生じていない。
- **`:ro` を付けない判断**: forge がビルド成果物（out/・cache/）を
  マウント先へ書き戻すこと、静的ワークベンチ（docker-compose.yml）も
  読み書き可能でマウントしており挙動を揃えることが、実装のコメントに
  明記されている。妥当。
- **静的ワークベンチ側**: `git diff main..HEAD -- profiles/` は空。
  `docker-compose.yml` の `workbench` サービスは `./contracts:/contracts`
  を既にマウントしており変更不要。意図どおり。
- **境界の遵守**: 変更は `ContainerSpec.binds`（`docker/operations.ts` の
  抽象）への値追加のみ。Docker Engine API への変換は既存の
  `dockerode-operations.ts`（`Binds: spec.binds`）が担っており、
  node-lifecycle が Docker API の詳細に触れていない。チェーン固有の語彙が
  shared / frontend に漏れる変更も無い。
- **エラー握りつぶし**: 追加コードに catch は無く、該当なし。
- **テストの質**: 基本テスト1件（node-lifecycle.test.ts）に加え、新規
  `workbench-contracts-mount.test.ts`（9件）が source の profileDir 追従・
  末尾スラッシュ正規化・target と `forge create --root` の一致・
  docker-compose.yml 実ファイルとの突き合わせ・非退行（他フィールド、
  `:ro` 無し、addNode への非波及）をカバーしている。tester が実装を
  意図的に壊してテストが失敗することを確認済み（worklog 記載）で、
  「壊れたコードでも通るテスト」にはなっていない。肥大化した
  node-lifecycle.test.ts に積み増さず新規ファイルへ切り出した判断も
  1ファイル1責務の方針に沿う。
- **ビルド・lint・テスト**: リポジトリ全体で `pnpm build` / `pnpm lint` /
  `pnpm test` がすべて成功（shared 62 / collector 1309 / e2e 158 /
  frontend 1925 件、新規9件を含む）。
- **コミット粒度**: fix → test（基本）→ docs → test（強化+その記録）の
  4コミット。いずれも Conventional Commits 準拠で、1コミット1関心事に
  なっている。fix コミットのメッセージ中の `Closes #293` は、CLAUDE.md が
  禁じているのは実装担当による `gh issue close` の手動実行であり、
  クローズ自体はレビュー・QA 後の main へのマージ時（PR 本文の Closes と
  同じタイミング）に発火するため、手続きの骨抜きにはならず問題ない。
- **docs**: worklog・PLAN.md（チェック+Issueリンク）・WORKLOG.md（索引1行）
  が実装内容を正しく反映している。ARCHITECTURE.md / CONCEPT.md の記述と
  矛盾する点は無い（既存の抽象・構成の範囲内の修正のため追記不要）。

軽微な備考（差し戻し不要）: compose 突き合わせテストの正規表現
`/-\s*\.\/contracts:(\S+)/` はファイル全体の最初のマッチを取るため、
将来別サービスが `./contracts` をマウントすると意図しない行に一致し得る。
現状は該当箇所が workbench のみで実害は無い。
