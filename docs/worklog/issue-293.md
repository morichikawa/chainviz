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
