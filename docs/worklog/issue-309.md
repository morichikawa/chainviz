# Issue #309 peer-block-adapter.test.ts の分割

## 設計メモ(着手前)

### 現状把握

`packages/collector/src/adapters/ethereum/peer-block-adapter.test.ts`(3346行、
84テストケース)に、以下11個の`describe`ブロックが同居している。

1. `EthereumAdapter.pollPeersOnce`
2. `EthereumAdapter.pollPeersOnce (EL / reth admin_peers)`
3. `EthereumAdapter.subscribePeers`
4. `EthereumAdapter.subscribeBlocks`
5. `EthereumAdapter.subscribeBlocks dynamic node tracking (Issue #301)`
6. `EthereumAdapter.subscribeTransactions`
7. `EthereumAdapter.subscribeContracts (Issue #161)`
8. `EthereumAdapter.trackedTokenContractAddresses (Issue #164)`
9. `EthereumAdapter.subscribeNodeInternals (Issue #186)`
10. `EthereumAdapter syncStatus/blockHeight from D層 (Issue #187)`
11. `EthereumAdapter syncStatus/blockHeight for CL (beacon) via Beacon API (Issue #274)`

ファイル冒頭(1〜404行目)に、これらのdescribeが共通で使うfixtureヘルパーが
定義されている。使用箇所を洗い出した結果は以下のとおり(○=使用):

| ヘルパー | 1,2 | 3 | 4,5 | 6 | 7,8 | 9 | 10,11 |
|---|---|---|---|---|---|---|---|
| `zeroStats` / `Fixture` / `clientFrom` / `beaconFixture` / `rethFixture` | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| `mutableClientFrom` | | | ○(5のみ) | | | | |
| `gethFixture` | | | ○(4のみ) | | | | |
| `beaconHttp` | ○ | ○ | | | | | ○ |
| `defaultBeaconSyncHttp` | | | | | | ○ | ○(10のみ) |
| `elRpcClient` / `enodeUrl` | ○(1のみ) | | | | | | |
| `queuedRethMetricsClient` / `rethMetricsText` | | | | | | ○ | ○(10のみ) |
| `rethMetricsTextWithFinish` | | | | | | | ○ |
| `controllableWsClient` / `header` | | | ○ | ○ | ○ | | |
| `RawReceiptFixture` / `stubRpcClient` / `flushAsync` | | | | ○ | ○ | | |
| `testCatalog` | | | | | ○(7,8のみ) | | |
| `nodeById`(10と11でそれぞれ同一実装を重複定義) | | | | | | | ○ |

### 分割方針

1. 共有fixtureヘルパーを関心事ごとに`test-helpers/`配下へ切り出す(1ファイル
   1責務の原則をテストヘルパーにも適用する):
   - `test-helpers/docker-fixtures.ts`: `zeroStats`, `Fixture`, `clientFrom`,
     `mutableClientFrom`, `beaconFixture`, `rethFixture`, `gethFixture`
   - `test-helpers/beacon-http-fixtures.ts`: `beaconHttp`,
     `defaultBeaconSyncHttp`(Beacon API向けHttpClientモック)
   - `test-helpers/el-rpc-fixtures.ts`: `elRpcClient`, `enodeUrl`(EL admin_*
     向けEthRpcClientモック)
   - `test-helpers/reth-metrics-fixtures.ts`: `queuedRethMetricsClient`,
     `rethMetricsText`, `rethMetricsTextWithFinish`
   - `test-helpers/ws-fixtures.ts`: `controllableWsClient`, `header`(newHeads/
     pendingTx向けEthWsClientモックとヘッダファクトリ)
   - `test-helpers/tx-rpc-fixtures.ts`: `RawReceiptFixture`, `stubRpcClient`,
     `flushAsync`(tx/receipt向けEthRpcClientモックと非同期フラッシュ)

   `testCatalog`はcontract-subscribe.test.ts内でのみ使うため共有化せず、
   そのファイルのローカル定数として残す。`nodeById`はsync-status.test.ts
   内で10・11の両方から使われ実装が同一なので、ファイル内で1つに集約する
   (重複削除であり、アサーション内容やロジックの変更ではない)。

2. describe単位で以下7ファイルへ分割する(既存の`head-tip-cache.test.ts`
   等と同じ`ethereum/`直下フラットな配置に倣う):
   - `peer-poll.test.ts` ← 1, 2
   - `peer-subscribe.test.ts` ← 3
   - `block-subscribe.test.ts` ← 4, 5
   - `transaction-subscribe.test.ts` ← 6
   - `contract-subscribe.test.ts` ← 7, 8
   - `node-internals.test.ts` ← 9
   - `adapter-sync-status.test.ts` ← 10, 11
     (`sync-status.test.ts` という名前は、`sync-status.ts`（NodeSyncStatusCache
     等）の既存ユニットテストファイルと衝突するため使わず、EthereumAdapter
     経由の結合的な検証であることを示す`adapter-sync-status.test.ts`とした)

3. 各分割ファイルは、使用するヘルパーのみを`test-helpers/`からimportする。
   ロジック・アサーションの変更は一切行わない(テストコードの移動のみ)。

4. 分割後、元の`peer-block-adapter.test.ts`は空になるため削除する。

5. 分割前後でテスト総数(84件)が一致することを`vitest run --reporter=verbose`
   の出力件数で確認する。

### コミット分割方針

- コミット1: 共有fixtureヘルパーを`test-helpers/`へ追加(この時点では
  まだどこからも参照されない純追加)
- コミット2: 7つの分割テストファイルを追加し、元の
  `peer-block-adapter.test.ts`を削除(実質的な移動)

## 実施結果

設計メモどおりに分割を実施した。分割後のファイルとテスト件数は以下の
とおり(`vitest run --reporter=verbose`で確認):

| ファイル | 行数 | テスト件数 |
|---|---|---|
| `peer-poll.test.ts` | 346 | 9 |
| `peer-subscribe.test.ts` | 86 | 3 |
| `block-subscribe.test.ts` | 506 | 18 |
| `transaction-subscribe.test.ts` | 598 | 17 |
| `contract-subscribe.test.ts` | 417 | 11 |
| `node-internals.test.ts` | 386 | 9 |
| `adapter-sync-status.test.ts` | 680 | 17 |
| 合計 | 3019 | **84** |

分割前の`peer-block-adapter.test.ts`(3346行・84件)と件数が一致することを
確認した(行数はヘルパー抽出とdescribe単位への分割によりファイル間で
import文が増えた分を含む合計のため単純な差分にはならない)。

共有ヘルパーは`test-helpers/`配下に6ファイルへ切り出した
(`docker-fixtures.ts` 111行, `beacon-http-fixtures.ts` 78行,
`el-rpc-fixtures.ts` 44行, `reth-metrics-fixtures.ts` 54行,
`ws-fixtures.ts` 81行, `tx-rpc-fixtures.ts` 60行)。

### 実装中に判明した注意点

- `sync-status.test.ts`という名前は、`sync-status.ts`（`NodeSyncStatusCache`
  等)の既存ユニットテストファイルと衝突するため使えなかった。
  `adapter-sync-status.test.ts`に変更した(設計メモにも反映済み)。着手前の
  洗い出しの時点ではこの衝突に気づいておらず、ファイル作成時にvitestの
  テスト総数が期待値からずれたことで発覚した。今後同種の分割作業をする際は、
  分割先のファイル名が既存ファイルと衝突していないか事前に`ls`で確認する
  ことを推奨する
- ヘルパー抽出の過程で`beaconHttp`の`getJson`から`vi.fn(...)`のラップを
  誤って落としてしまい、`getJson.mock.calls`を参照するテスト
  (`excludes the validator from Beacon API polling ...`)が失敗した。
  移動のみのはずの変更でも実際にテストを実行して検出し、元の実装
  (`vi.fn(async (url) => {...})`)に戻して解消した。ロジックそのものは
  変えていないが、モック関数のラップ漏れは動作の変化(spy呼び出し履歴が
  取れなくなる)につながるため、機械的な移動作業でも実行確認が必須で
  あることの実例として残す
- `nodeById`ヘルパーは元ファイルで`describe`ブロック内にそれぞれ同一実装が
  重複定義されていた。`adapter-sync-status.test.ts`では2つの`describe`が
  同一ファイルに同居するため、モジュールスコープに1つだけ定義する形に
  統合した(実装内容は変更していない、重複削除のみ)

## レビュー記録(chainviz-reviewer, 2026-07-13)

判定: 合格。

### 確認した内容

- **ロジック・アサーション不変(最重要)**: 元ファイル(main の
  `peer-block-adapter.test.ts`)を取り出し、新7ファイルの各 describe ブロック
  本体を空白正規化して機械比較した結果、11個の describe すべてが
  元と一致(バイト等価)。テストタイトルも81件の `it(` 呼び出しが完全一致。
  `it.each` 展開分を含む実行時テスト総数も84件で元と一致。
- **共有ヘルパー17個の同一性**: `zeroStats`/`Fixture`(clientFrom等)/
  `beaconFixture`/`rethFixture`/`gethFixture`/`mutableClientFrom`/
  `beaconHttp`/`defaultBeaconSyncHttp`/`elRpcClient`/`enodeUrl`/
  `queuedRethMetricsClient`/`rethMetricsText`/`rethMetricsTextWithFinish`/
  `controllableWsClient`/`header`/`stubRpcClient`/`flushAsync` の全定義を
  元の該当定義と正規化比較し、`export`付与と配置以外は全て一致。
- **バグ修正1(beaconHttp の getJson)**: 現行ヘルパーの getJson は
  `vi.fn(async (url) => {...}) as unknown as HttpClient["getJson"]` で、
  元実装と一致。`vi.fn(...)` ラップが復元されており、`mock.calls` を
  参照するテストが機能する。新しい挙動の持ち込みは無い。
- **バグ修正2(nodeById 重複排除)**: 元ファイルでは2つの describe 内に
  同一実装の nodeById が重複定義されていた(両者が完全一致であることを確認)。
  新 `adapter-sync-status.test.ts` ではモジュールスコープに1つだけ定義され、
  内容は元と同一。挙動を変えない純粋な重複削除。
- **testCatalog の移動**: 元はモジュールスコープで subscribeContracts/
  trackedTokenContractAddresses からのみ使用(6箇所)。新
  `contract-subscribe.test.ts` にローカル定数として1つ定義され、使用箇所も
  同じ6箇所・定義本体も一致。設計メモの「共有化しない」方針どおり。
- **循環依存・責務**: `test-helpers/` 配下6ファイル間の相互 import は無し。
  各ヘルパーは production source(型・定数)と vitest のみに依存する
  一方向依存で健全。
- **命名整合**: `adapter-sync-status.test.ts` は既存 `sync-status.test.ts`
  (NodeSyncStatusCache のテスト)との衝突回避として妥当。他の分割名も
  `ethereum/` 直下のフラット配置(`head-tip-cache.test.ts` 等)に倣っている。
  `test-helpers/` はリポジトリ初の共有テストヘルパー用ディレクトリだが、
  これまで共有ヘルパーの必要が無かっただけで、導入自体は妥当。
- **ビルド/lint/test**: `pnpm build`・`pnpm lint`・`pnpm test` すべて成功
  (collector 1439件、frontend 2120件を含むリポジトリ全体がグリーン)。
- **コミット粒度**: 3コミット。(1)ヘルパー純追加、(2)分割ファイル追加+
  元ファイル削除、(3)worklog。関心事が適切に分離され、Conventional Commits
  準拠。
- **docs 整合**: `docs/worklog/issue-309.md`・`docs/WORKLOG.md` 索引とも
  実装を正しく反映。本Issueはテストファイルの再構成のみで機能追加を
  伴わないため、`docs/PLAN.md` のチェックボックス対象外という判断は妥当。

### 補足(退行ではない既存挙動)

- collector の `tsconfig.json` は `include: ["src"]` のみで `.test.ts` を
  除外していないため、既存の `.test.ts` も含めてテストコードが `dist/` へ
  出力される。新 `test-helpers/*.ts` が `dist/` に出るのはこの既存挙動に
  沿ったもので、本Issueによる退行ではない(必要なら別Issueでビルド対象からの
  テスト除外を検討する余地はある)。

### QA(chainviz-qa)への助言

本変更はロジック・アサーションの変更を一切含まないテストファイルの
再構成であり、実機(docker compose 起動・collector/frontend 実行・
WebSocket 疎通)で新たに検証すべき動作は無い。QA の実質的な確認項目は、
対象ブランチ上で `pnpm build && pnpm lint && pnpm test` が通ること、
および分割後のテスト総数が84件で元(main)と一致することの確認に集約される。
実機起動を伴う通常のQA手順は本Issueでは適用対象が無い旨を記録しておく。

## QA検証記録(chainviz-qa, 2026-07-13)

判定: 合格。

本Issueはロジック・アサーションを変更しないテストファイルの再構成
(1ファイル→7ファイル+共有ヘルパー6ファイルへの分割)であり、レビュー担当が
全describeブロックのバイト等価性を検証済みのため、実機で新規に検証すべき
機能動作は無い。QAの実質は下記の確認に集約される。

### 確認内容

- **静的ゲート**: 対象ブランチ(`issue-309-peer-block-adapter-test-split`、
  作業ツリーはクリーン)で `pnpm build` / `pnpm lint` / `pnpm test` がいずれも
  成功。collector のテストは64ファイル・1439件すべてグリーン。
- **分割ファイルの存在**: 元の `peer-block-adapter.test.ts` は削除済み。
  分割先7ファイル(`peer-poll` / `peer-subscribe` / `block-subscribe` /
  `transaction-subscribe` / `contract-subscribe` / `node-internals` /
  `adapter-sync-status`)と `test-helpers/` 配下の共有ヘルパー6ファイルが
  存在する。
- **テスト総数の一致**: 分割先7ファイルのみを `vitest run --reporter=verbose`
  で実行し、84件(7ファイル)が通ることを確認。元ファイル(84件)と一致。
- **PLAN.md**: `docs/PLAN.md` に #309 に対応するチェックボックスは存在せず、
  「チェックボックス対象外」という実装・レビュー担当の判断どおりであることを
  確認した(QAが付けるべきチェックは無い)。

### 最小限の健全性確認(ビルド成果物の実動作)

テスト再構成という性質上、通常の実機起動を伴うQA手順は本Issueでは検証対象が
無いが、ビルド成果物が実際に動くことの最小確認として以下を実施した。

- 既に起動済みの ethereum ノード環境(reth1/2・beacon1/2・validator1/2・
  workbench の7コンテナ)に対し、ビルド済みの collector(`node dist/index.js`)
  を起動。`WebSocket server listening on port 4000` / `logging proxy listening
  on port 4001` のログを確認。
- WebSocket(`ws://127.0.0.1:4000`)へ接続し、初回スナップショット(chainType:
  ethereum、entities 40件=node 6・workbench 1・wallet 1・block 32)を受信。
  その後12秒間で27件の差分メッセージ(type: diff)が流れ、ブロックが進行し続けて
  いることを確認した。ビルド成果物が実データに対して正常動作することを確認。
- 検証後、collector プロセスを停止しポート4000/4001の解放を確認した。
