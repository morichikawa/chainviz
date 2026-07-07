# Issue #161 コントラクトカタログの読み込みとデプロイ検知・追跡

### 2026-07-07 Issue #161 実装

- 担当: collector
- ブランチ: issue-161-contract-deploy-detection
- 内容: 新Phase4（C層拡張）の一部として、`ChainAdapter.subscribeContracts` を
  実装し、`profiles/ethereum/contracts/catalog.json` の読み込み・コントラクト
  デプロイ検知・カタログ照合を行い、`ContractEntity` をワールドステートへ配信
  できるようにした。`docs/ARCHITECTURE.md` §4 の設計（追加の購読・ポーリングを
  設けず `subscribeTransactions` が既に呼んでいる `eth_getBlockReceipts` の
  結果を使い回す）に厳密に従っている。

- 実装内容:
  - `packages/collector/src/adapters/ethereum/catalog.ts`（新規）:
    - `profiles/ethereum/contracts/catalog.json` を読み込む
      `readContractCatalog(profileDir, log?)`。既存の `readProfileMnemonic`
      （`mnemonic.ts`）と同じ profileDir 解決の考え方に合わせた。
    - ファイルが無い・読めない・JSON として不正・トップレベルがオブジェクト
      でない・個々のエントリが `name`/`abi` を持たない、のいずれの失敗でも
      例外を投げず、**その場で具体的な理由（ファイルパス・実際の例外/値）を
      ログに残した上で** 該当部分だけ縮退させる（個別エントリ不正はその
      エントリだけスキップ、それ以外は catalog 全体を `undefined` にする）。
      `readProfileMnemonic` は失敗時に理由を返さず単に `undefined` を返す
      設計だったが、CLAUDE.md「エラーを握りつぶさない」の指示に従い、今回は
      読み込み地点で具体的なログを出す形にした（`log` はテスト用に差し替え
      可能、既定は `console.error`）。
    - `CatalogEntry`（`name` / `abi: unknown[]` / `token?`）と
      `ContractCatalog`（キー→`CatalogEntry`）を定義。**ABI はこのファイルと
      呼び出し元（アダプタ配下）でのみ保持し、ワールドステートには一切出さない**
      （ChainAdapter 境界）。
  - `packages/collector/src/adapters/ethereum/contracts.ts`（新規）:
    - `ContractTracker`。receipt から得たコントラクト作成の最小情報
      （address / deployerAddress / createdByTxHash）を `ContractEntity` へ
      正規化しつつ、カタログとの照合を行う純粋なクラス。
    - `recordDeployment(deployment)`: 初出のアドレスなら `ContractEntity` を
      生成して返す。既に追跡済み（同一ブロックの重複通知等）なら `null`。
      デプロイ検知より前に `registerDeployment` で登録済みのカタログキーが
      あれば、その場で `name`/`catalogKey`/`token` を埋めて返す。
    - `registerDeployment(address, contractKey)`:
      `runWorkbenchOperation(deployContract)`（Issue #163、未実装）がデプロイ
      実行後に呼ぶ想定の公開 API。デプロイ検知がまだなら登録を保留し
      （`pendingCatalogKeys`）、既に「未知のコントラクト」として追跡済みなら
      その場でカタログ情報を埋めた更新後のエンティティを返す（呼び出し側は
      これを `onContract` へ渡し `entityUpdated` として配信できる）。指定
      された `contractKey` がカタログに存在しない場合は何もせず警告ログを残す
      （呼び出し側のバグの可能性があるため、黙って無視しない）。
    - 手動 `forge create` 等、登録の無いデプロイは「未知のコントラクト」
      （address のみ）のまま。バイトコード照合による特定は行わない
      （ARCHITECTURE.md の決定: 必須にしない）。
  - `packages/collector/src/adapters/ethereum/index.ts`:
    - `EthereumAdapterDeps` に `catalog?: ContractCatalog` を追加し、
      コンストラクタで `ContractTracker` を生成する。
    - `subscribeContracts(onContract)`: 専用の購読は張らず、コールバックを
      保持するだけ（`Promise<void>` を返すのはインターフェースの形に合わせる
      ためで非同期処理は発生しない）。実際のブロック取り込み検知は
      `subscribeTransactions` が張る newHeads 購読（`handleBlockInclusion`）を
      共有する。**このため `subscribeContracts` を呼んでも
      `subscribeTransactions` が呼ばれていない限り何も配信されない**
      （Ethereum プロファイル固有の実装上の依存関係。コメントで明記した）。
    - `handleBlockInclusion` の最後に `detectContractDeployments(receipts)` を
      追加。既に取得済みの `receipts`（Issue #160 で `contractAddress`/`logs`
      を持つよう拡張済み）から `contractAddress` が非 null の tx を
      コントラクト作成として検知し、`ContractTracker.recordDeployment` →
      （初出なら）`onContract` へ渡す。追加の RPC 呼び出しは発生しない。
    - `registerContractDeployment(address, contractKey)`:
      `ChainAdapter` インターフェースには含めない `EthereumAdapter` 固有の
      拡張 API（`dispose()` 等と同様の位置づけ）。`ContractTracker.
      registerDeployment` に委譲し、更新後のエンティティが返れば
      `onContract` を呼ぶ。
  - `packages/collector/src/world-state/store.ts`:
    - `applyContract(contract: ContractEntity): DiffEvent[]` を追加。
      block/transaction 用の `applyHashKeyed` を `applyKeyed` に一般化し
      （`entityId()` で block=hash / transaction=hash / contract=address を
      判別）、3種で共用する。
  - `packages/collector/src/index.ts`（main）:
    - `readContractCatalog(profileDir)` を呼び、結果を
      `EthereumAdapter` の `catalog` deps へ渡す。
    - `adapter.subscribeContracts(...)` を配線し、受け取った
      `ContractEntity` を `store.applyContract` → `server.broadcastDiff` する
      （`subscribeTransactions` の配線と対の位置に置き、依存関係を
      コードの並びでも示した）。

- 決定事項・注意点（次の担当・レビューが知っておくべきこと）:
  - **`contractKey` の大文字小文字規約を PascalCase に統一した**（QA からの
    申し送り事項の解消）。`profiles/ethereum/contracts/catalog.json` の
    トップレベルキーは Solidity のコントラクト名そのまま（`ChainvizToken`,
    `Counter`）であり、`packages/shared` の `protocol/index.test.ts` /
    `world-state/entities.test.ts` にあった kebab-case の例（
    `chainviz-token`）は実態と乖離していたため、両テストの例文字列を
    `ChainvizToken` へ修正した。`contractKey`/`catalogKey` の型自体は
    `string` のままで **型定義（`packages/shared` のインターフェース）は
    変更していない**。実装（`ContractTracker`）はキーの大文字小文字を
    関知せず、カタログの実際のキーと一致するかだけを見るため、今後
    catalog.json の生成規約が変わった場合もこの合わせ込みだけで追従できる。
  - **`subscribeContracts` は `subscribeTransactions` に依存する設計**。
    ARCHITECTURE.md の「追加の購読・ポーリングを設けない」という指示を
    そのまま実装した結果。将来 Bitcoin 等コントラクト概念を持たないチェーンの
    アダプタでは `subscribeContracts` 自体を実装しない（interface が
    `subscribeContracts?` で optional なのはこのため）。
  - **Issue #163（`runWorkbenchOperation` の実コマンド処理）はまだ未実装**。
    今回追加した `registerContractDeployment` は #163 が呼び出す想定の
    公開 API として用意したが、呼び出し元（`CommandHandler` /
    `NodeLifecycle`）は本 Issue の範囲外なのでまだどこからも呼ばれていない。
    #163 実装時は、`forge create` 実行後に判明したデプロイ先アドレスと、
    コマンドで指定された `contractKey`（catalog.json のキーと一致させる
    こと）を渡して呼び出す想定。呼び出しタイミング（デプロイ検知の前後
    どちらでも良い）は `ContractTracker` 側で吸収済み。
  - `ContractTracker` の内部 Map（`contracts`）にはコントラクトの登場が
    追跡され続け、明示的な eviction を設けていない。これは `ContractEntity`
    がチェーン側の状態として削除されない設計（ARCHITECTURE.md §2）に合わせた
    意図的な判断で、`processedBlocks`/`TransactionLifecycleTracker` のような
    高頻度・揮発性のデータとは性質が異なる（学習用途のデプロイ回数は少ない
    ため、無制限成長がメモリ上の実害になりにくい）。
  - `readContractCatalog` は `readProfileMnemonic` と異なり、失敗時に
    具体的なログをその場で出す設計にした（CLAUDE.md の要求に応じた強化）。
    今後 `readProfileMnemonic` 側も同様に強化する余地があるが、本 Issue の
    範囲外のため着手していない。

- テスト:
  - `catalog.test.ts`（新規、5件）: 正常系（複数エントリ・token 有無）、
    ファイル不在・不正 JSON・トップレベルが配列・個別エントリ不正のそれぞれで
    具体的なログが出て安全に縮退することを確認。
  - `contracts.test.ts`（新規、9件）: 未知コントラクトの生成、重複通知の
    無視、カタログキー事前登録→検知時の適用、検知後のカタログキー登録に
    よる更新、存在しないキー・カタログ未読み込み時の安全な無視（警告ログ
    込み）を確認。
  - `world-state/store.test.ts`: `applyContract` の describe を追加
    （entityAdded / entityUpdated（変化分のみ）/ 無変化時の空配列 / 複数
    アドレスの独立追跡 / 他エンティティ種別との分離）。
  - `adapters/ethereum/peer-block-adapter.test.ts`: `subscribeContracts` の
    describe を追加。カタログ未登録時の未知コントラクト配信、事前登録・
    事後登録の両方でカタログ情報が適用されること、通常 tx では配信されない
    こと、複数ノードからの同一ブロック重複通知でも1回だけ配信されること、
    `subscribeContracts` 未呼び出しでも例外にならないことを確認。
  - `packages/shared`: `protocol/index.test.ts` / `world-state/
    entities.test.ts` のカタログキー例文字列を PascalCase に修正（型変更は
    無し）。
  - `pnpm --filter @chainviz/collector build`・
    `pnpm --filter @chainviz/collector test`・`pnpm -r build` で確認済み
    （全パッケージ・既存テストとも成功）。
