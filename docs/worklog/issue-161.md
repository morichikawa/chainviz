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

### 2026-07-07 追記: registerContractDeployment の呼び出し配線が欠落していた問題の修正

- 担当: collector
- ブランチ: issue-161-contract-deploy-detection（継続）
- 経緯: 本 Issue 実装時点（上記）では #163（`runWorkbenchOperation` の
  deployContract 実装）がまだ main に未マージだったため、
  `EthereumAdapter.registerContractDeployment` を呼び出す側を実装できず、
  コメントに「#163 が呼び出す想定」とだけ残して終えていた。その後 #163 が
  main にマージされ両方揃ったが、実際には統合されておらず、GUI の定型操作
  経由の `deployContract` を実行しても `registerContractDeployment` が
  一切呼ばれない状態のまま放置されていた。結果として、GUI からの
  ChainvizToken デプロイも手動 `forge create` と同じ「未知のコントラクト」
  表示になり、Phase4 の完了条件（定型操作でのデプロイ→コントラクトカード
  表示）を満たせていなかった。
- 修正内容:
  - `EthereumNodeLifecycleConfig` に任意のコールバック
    `onContractDeployed?: (address: string, contractKey: string) => void`
    を追加した。`EthereumNodeLifecycle` は `EthereumAdapter` を直接
    import・参照しない（両者は `index.ts` の `main()` で並行に組み立てて
    おり、相互 import すると循環依存になるため）。既存の依存注入パターン
    （コンストラクタで Docker 操作や RPC URL 等を受け取る形）に合わせ、
    コールバック注入のみで結合した。
  - `ResolvedConfig` の型は `Required<Omit<EthereumNodeLifecycleConfig,
    "onContractDeployed">>` とし、`onContractDeployed` は他の設定値と
    分離して別フィールドで保持するようにした（`DEFAULTS` に既定値を
    持たない任意コールバックのため、`Required<>` の対象に含めると
    型として成立しなくなる）。
  - `runWorkbenchOperation` で `deployContract` が成功し、
    `parseOperationOutcome` が `deployedAddress` を抽出できた場合に、
    `this.onContractDeployed?.(deployedAddress, operation.contractKey)`
    を呼ぶようにした。アドレスを抽出できなかった場合（forge の出力形式が
    想定と異なる等）は呼び出しをスキップするだけで、操作自体の成否判定
    （終了コード）には影響させない。
  - `packages/collector/src/index.ts` の `main()` で、`EthereumNodeLifecycle`
    構築時に `onContractDeployed: (address, contractKey) =>
    adapter.registerContractDeployment(address, contractKey)` を渡した。
    `adapter`（`EthereumAdapter`）と `lifecycle`（`EthereumNodeLifecycle`）
    は元々 `main()` 内で別々に構築されており、この配線だけで完結する
    （新規の相互参照や型変更は不要）。
  - `contractKey` の値そのものについて: `WorkbenchOperation` の
    `deployContract.contractKey` は現状 `forge create` の CONTRACT 引数
    としてそのまま使われる一方、`registerContractDeployment` /
    `ContractTracker.registerDeployment` はカタログキー
    （`catalog.json` のトップレベルキー。例: `"ChainvizToken"`）としてこの
    同じ値を照合に使う。両者が同じ文字列を指す前提（`WorkbenchOperation`
    のコメント「チェーンプロファイルのコントラクトカタログに載っている
    コントラクトのデプロイ」）に沿って実装したが、`forge create` の
    CONTRACT 引数がカタログキーのみ（パス無し）の形式で常に解決できるかは
    本修正の検証対象外（`workbench-operations.ts` 側の既存コメントが
    `"src/ChainvizToken.sol:ChainvizToken"` 形式を例示しており、実際の
    フロント側からどの形式で送られるかは要確認）。フロント側の定型操作の
    実装・QA時に、送られる `contractKey` の実際の値と `forge create` の
    解決可否を必ず確認すること。
- テスト:
  - `node-lifecycle.test.ts` に `onContractDeployed callback` の describe を
    追加（4件）: 成功した deployContract 後に正しい引数（address,
    contractKey）で呼ばれること、アドレスを抽出できない場合は呼ばれない
    こと、deployContract 以外の操作では呼ばれないこと、コールバック未設定
    でも例外にならないこと。
  - `contract-deploy-wiring.test.ts`（新規）: `EthereumNodeLifecycle` と
    `EthereumAdapter` を `index.ts` と同じ配線で実際に組み合わせ、
    「deployContract 実行 → onContractDeployed →
    registerContractDeployment → ContractEntity への catalogKey 反映」の
    一連の流れを end-to-end で検証する統合テスト。ブロック取り込み検知が
    デプロイ完了より先着・後着どちらの順序でも正しく合流することの両方を
    確認した。
  - `pnpm --filter @chainviz/collector build`・
    `pnpm --filter @chainviz/collector test` で確認済み（835件全て成功）。

## テスト強化（chainviz-tester）

実装担当が書いた基本テスト（ハッピーパス中心）に対し、異常系・境界値・
複雑な順序の観点でユニットテストを追加した（新機能の実装は行っていない）。

- `catalog.test.ts`（+12件）: 空の JSON オブジェクト `{}` は undefined では
  なく空カタログを返す（読み込み失敗との区別）、トップレベルが `null` /
  数値のときの縮退、空ファイル（parse 失敗）、エントリ値が `null` /
  文字列 / 数値のときのスキップ、`name` が文字列でない・`abi` が配列でない
  エントリのスキップ、複数の不正エントリが混在しても良いエントリを残すこと、
  `token` メタ情報が未検証のまま素通しされる現状の固定。
- `contracts.test.ts`（+5件）: 検知前に同一アドレスへ 2 回 registerDeployment
  した場合の後勝ち、pending 適用後の重複 recordDeployment が null を返すこと、
  pending キーが適用時に消費され別アドレスと取り違えないこと、カタログ照合
  済みコントラクトを別キーで再登録したときの挙動（後述の token 残留の限界
  含む）、空文字キーの縮退。
- `peer-block-adapter.test.ts`（+2件）: 1 ブロックに複数のデプロイ tx が
  含まれる場合にそれぞれ別 ContractEntity として配信されること、アダプタ層の
  registerContractDeployment に未知キーが渡っても配信せず例外も出さないこと。
- `contract-deploy-wiring.test.ts`（+1件）: 同一アドレスを照合済みの後に再度
  デプロイしても重複配信しないこと（tracker の「変化なし → null」経路の
  end-to-end 確認）。

`pnpm --filter @chainviz/collector test`（853件全て成功）・
`pnpm --filter @chainviz/collector build`・`pnpm -r build` で確認済み。

### テスト強化中に見つかった実装側の懸念（collector 担当への差し戻し候補）

1. アドレスの大文字小文字不一致でカタログ照合が失われうる（要確認・要修正）:
   `ContractTracker` は `contracts` / `pendingCatalogKeys` を生のアドレス
   文字列でキーにした Map で管理し、正規化しない。一方、
   `registerContractDeployment` に渡るアドレスは `forge create` の
   "Deployed to:" 行由来（EIP-55 チェックサム = 大小混在になりうる）、
   デプロイ検知側（`detectContractDeployments`）が使うアドレスは
   `eth_getBlockReceipts` の `contractAddress` 由来（reth では小文字）で、
   両者の表記が食い違うと Map のキーが一致せず、GUI からデプロイしても
   catalogKey が反映されず「未知のコントラクト」のままになる恐れがある。
   既存テストは全桁が数字の `0x2222...`／`0xnewcontract` 等、大小の差が
   出ないアドレスばかりでこの経路を通っていない。対応案としては
   `ContractTracker` の全アドレスキーを `toLowerCase()` で正規化する
   （recordDeployment / registerDeployment / get の入口で統一）のが安全。
   実チェーンでの casing を実測で確認したうえで修正すること。

2. `onContractDeployed` の例外が成功したデプロイを失敗に見せる:
   `runWorkbenchOperation` は deployContract 成功後に
   `this.onContractDeployed?.(...)` を try/catch なしで呼ぶため、コールバック
   （カタログ登録の後処理）が throw すると runWorkbenchOperation 全体が
   reject し、実際にはオンチェーンで成功しているデプロイが commandResult では
   失敗として返る。カタログ登録は best-effort の付随処理であり、
   parseOperationOutcome の抽出失敗を握って成功扱いにしている既存方針と
   合わせるなら、この呼び出しも try/catch で囲んで失敗をログするだけに留め、
   outcome は返すのが望ましい（過度な防御にはせず、必ずログは残す）。

3. （軽微）カタログ照合済みコントラクトをトークン無しの別キーで再登録すると
   前回の `token` が残留する: `applyCatalog` は既存エンティティへスプレッドで
   name/catalogKey/token を上書きするだけで、新キーに token が無い場合に
   既存の token を消さない。通常運用では起きない経路のため現状を
   `contracts.test.ts` で固定してあるが、token の切り替えを厳密にしたい場合は
   applyCatalog で token を明示的にクリアする必要がある。

## レビュー（chainviz-reviewer、2026-07-07）

判定: **差し戻し**（修正3点。うち2点はテスト強化時に報告された懸念の確定）。

### 実測による懸念1の確定（アドレスの casing 不一致）

tester 報告の懸念1を、使い捨ての reth dev ノード（`ghcr.io/paradigmxyz/reth`
を `node --dev` で起動）と foundry イメージの cast で実測して確認した:

- `cast` / `forge` が表示するアドレス: `0x5FbDB2315678afecb367f032d93F642f64180aa3`
  （EIP-55 チェックサム = 大小混在）。`forge create` の "Deployed to:" 行も
  同じ Display 実装なので大小混在になる
- 同じコントラクトの reth `eth_getBlockReceipts` 生レスポンスの
  `contractAddress`: `0x5fbdb2315678afecb367f032d93f642f64180aa3`（全小文字）

したがって GUI からの deployContract では、`registerContractDeployment` に
渡るアドレス（チェックサム表記）と `detectContractDeployments` が使う
アドレス（小文字）が **必ず** 食い違い、`ContractTracker` の Map キーが
一致しないため catalogKey が反映されない。#161/#163 統合の主目的が実環境で
機能しない不具合であり、修正必須。既存テストは大小の差が出ないアドレス
（`0x2222...` 等）のみでこの経路を検出できていない。

### 差し戻し内容（担当: chainviz-collector）

1. **[必須] `ContractTracker` のアドレスキーを小文字に正規化する**
   （`packages/collector/src/adapters/ethereum/contracts.ts`）。
   `recordDeployment` / `registerDeployment` / `get` の入口で
   `toLowerCase()` に統一する。ContractEntity.address は receipt 由来
   （小文字）を保つ現状で、tx.to（RPC 由来・小文字）とのフロント照合とも
   整合する。回帰テストとして、"Deployed to:" にチェックサム表記・receipt に
   小文字表記を使う実データ相当のケースを `contract-deploy-wiring.test.ts`
   等に追加し、修正前に失敗することを一度確認してから直すこと。
2. **[必須] `runWorkbenchOperation` の `onContractDeployed` 呼び出しを
   try/catch で囲む**（`node-lifecycle.ts`）。コールバック（カタログ登録と
   その先の配信）は best-effort の付随処理であり、throw するとオンチェーンで
   成功したデプロイが commandResult 上は失敗として GUI に返る。既存の
   parseOperationOutcome の方針（付随情報の欠落は成功扱い）と揃え、catch では
   具体的なエラー内容を console.error でログし（握りつぶし禁止）、outcome は
   そのまま返す。「コールバックが throw しても操作は成功として返り、エラーが
   ログされる」テストを追加すること。
3. **[必須] lint エラーの解消**: `contract-deploy-wiring.test.ts:121` の
   未使用引数 `_spec` で `pnpm lint` が失敗している（pre-push フックで push
   自体が止まる状態）。引数を削除するなどで解消すること。

### 合格と確認した点

- 境界の遵守: ABI は catalog.ts / アダプタ配下に閉じ、ContractEntity・
  world-state にはチェーン非依存の情報のみ。`eth_getBlockReceipts` 等の語彙も
  アダプタ内に留まる。shared の `ChainAdapter.subscribeContracts?` は省略可能で
  非 EVM チェーンの独立性も維持
- catalog.json 読み込み失敗時の縮退: ファイルパス・例外内容を具体的にログした
  うえで undefined を返し、デプロイ検知は継続する設計で「機能単位の縮退」
  （ARCHITECTURE §4）と一致。未知カタログキーも警告ログあり
- docs との齟齬なし（ARCHITECTURE §4 の2経路照合・RPC 回数を増やさない方針・
  カタログキー = Solidity コントラクト名の実データとも一致）
- 環境状態依存の決め打ち定数の追加なし
- テストの質: catalog の縮退 15 件・tracker の順序/境界 18 件・store の差分・
  配線の統合テストまで実質的な検証になっている（ただし上記のとおり casing の
  経路が未カバーだったため、回帰テスト追加を必須とする）
- `pnpm build` / `pnpm test` は全パッケージ合格（collector 853 件・
  frontend 791 件・shared 40 件・e2e 34 件）。`pnpm lint` のみ上記 3 で不合格
- 懸念3（別キー再登録時の token 残留）は通常運用で発生しない経路であり、
  現状固定のテストとコメントで記録済みのため今回は修正不要と判断

### コミット構成への注意（統括向け）

#163 統合の配線（node-lifecycle.ts / index.ts）と tester のテスト追加が
現在未コミットで作業ツリーに混在している。コミット時は「配線の feat」
「テスト強化の test」を別コミットに分けること（1変更1コミット）。

## 差し戻し対応（chainviz-collector、2026-07-07）

レビューの差し戻し3点を修正した。

### 1. アドレスの casing 不一致（`contracts.ts`）

`ContractTracker` の `recordDeployment` / `registerDeployment` / `get` の
入口でアドレスを `toLowerCase()` に正規化する `normalizeAddress()` を追加し、
Map キー（`contracts` / `pendingCatalogKeys`）と `ContractEntity.address` の
両方をこの正規化後の表記に統一した。`WalletEntity` 側の
`deriveWalletAddress`（EIP-55 チェックサム表記）は単一の決定的な生成元
（mnemonic 導出）しか持たないため casing が食い違う余地がなく、今回の問題
は起きない。一方コントラクトのアドレスは「`forge create` の
"Deployed to:" 出力（チェックサム表記）」と「reth の
`eth_getBlockReceipts` の `contractAddress`（小文字）」という2つの独立した
生成元が同一コントラクトについて異なる表記を返すため、正規化が必須だった。
小文字を選んだ理由は、tx.to 等ほかの RPC 由来アドレスも同様に小文字表記
であり、フロント側で他のアドレスフィールドと突き合わせる際の表記を揃える
ため。

回帰テストとして以下を追加し、修正前に失敗する（`ContractEntity` が
`undefined` のまま・`catalogKey` が反映されない）ことを確認してから修正した:
- `contracts.test.ts`: `ContractTracker address casing normalization` に
  3件（チェックサム表記で registerDeployment → 小文字表記で
  recordDeployment、その逆順、`get()` 自体の casing 正規化）
- `contract-deploy-wiring.test.ts`: 実測値そのもの
  （`0x5FbDB2315678afecb367f032d93F642f64180aa3` /
  `0x5fbdb2315678afecb367f032d93f642f64180aa3`）を使った end-to-end 統合
  テストを1件追加

既存の `peer-block-adapter.test.ts` の1件（`0xcontractA`/`0xcontractB` という
大小混在のダミーアドレスを使っていた）は、正規化により小文字で配信される
ようになったため期待値を `0xcontracta`/`0xcontractb` に更新した（casing の
検証を意図したテストではなく、たまたま大小混在のダミー値を使っていた
だけの既存テスト）。

### 2. `onContractDeployed` コールバックの例外処理（`node-lifecycle.ts`）

`runWorkbenchOperation` の `deployContract` 成功後の
`this.onContractDeployed?.(...)` 呼び出しを try/catch で囲んだ。
コールバックの呼び出し連鎖（`registerContractDeployment` → `onContract` →
`store.applyContract` → `server.broadcastDiff`）のどこかで例外が投げられても、
オンチェーンで既に成功しているデプロイを `commandResult` 上で失敗として
返さないようにするため。catch 節では具体的なエラー内容（アドレス・
contractKey・workbenchId を含む）を `console.error` でログしたうえで、
`outcome`（デプロイ成功の結果）はそのまま返す。`parseOperationOutcome` が
付随情報の抽出失敗を成功扱いにしている既存方針と揃えた。

`node-lifecycle.test.ts` に、コールバックが例外を投げても
`runWorkbenchOperation` の戻り値がデプロイ成功を示し、かつ
`console.error` が具体的なエラー内容と共に呼ばれることを確認するテストを
1件追加した。修正前（try/catch なし）ではこのテストが
`runWorkbenchOperation` 自体の reject で失敗することを確認してから修正した。

### 3. lint エラーの解消（`contract-deploy-wiring.test.ts`）

未使用の型付き引数 `_spec: ContainerSpec` を削除した（このプロジェクトの
ESLint 設定にはアンダースコア接頭辞を無視する `argsIgnorePattern` が無いため、
プレフィックスだけでは lint が通らない）。合わせて未使用になった
`ContainerSpec` の import も削除した。

### 確認済みコマンド

`pnpm lint`・`pnpm --filter @chainviz/collector build`・
`pnpm --filter @chainviz/collector test`（858件全て成功）に加え、
`pnpm -r build`・`pnpm -r test`（shared 40件・e2e 34件・collector 858件・
frontend 791件、全て成功）も確認済み。

## 再レビュー（chainviz-reviewer、2026-07-07）

差し戻し3点の対応を確認し、**合格**と判定した。

1. **アドレス casing 正規化**: `contracts.ts` の `normalizeAddress()`
   （`toLowerCase()`）を `recordDeployment` / `registerDeployment` / `get` の
   入口すべてに適用しており、Map キーと `ContractEntity.address` の表記が
   一本化されている。正規化の入口が `ContractTracker` の1箇所に閉じており、
   デプロイ検知経路（`detectContractDeployments` → `recordDeployment`）と
   GUI 定型操作経路（`onContractDeployed` → `registerContractDeployment` →
   `registerDeployment`）の両方がここを通るため、漏れがない（adapter /
   lifecycle 側に散在する正規化が無いことも grep で確認）。回帰テストは
   前回レビューで実測した表記そのもの（forge のチェックサム表記 `0x5FbDB…`
   と reth の小文字表記 `0x5fbdb…`）を使っており、登録先着・検知先着の
   両順序と `get()` をカバーする。実測した問題を正しく解消している
2. **`ContractEntity.address` を小文字で返す判断は妥当**:
   `docs/ARCHITECTURE.md` の TxEntity の記述（「フロントは to と
   ContractEntity.address の照合で『コントラクト宛て』を判定する」）に
   対し、`tx.to` は RPC 由来で小文字のため、小文字への統一はこの将来の
   照合とちょうど整合する。`WalletEntity`（チェックサム表記）は mnemonic
   導出という単一の生成元しか持たず、コントラクトアドレスと突き合わせる
   経路も現状無いため、混在は問題にならない。判断根拠が `normalizeAddress`
   の doc コメントと本 worklog の両方に記録されている点も適切
3. **`onContractDeployed` の try/catch は適切**: 囲む範囲がコールバック
   呼び出し1行に限定されており過度な防御になっていない。catch 節は
   アドレス・contractKey・workbenchId・エラー本体を `console.error` に
   残しており握りつぶしではない。「オンチェーンで成功済みのデプロイを
   付随処理の失敗で失敗扱いにしない」という判断は
   `parseOperationOutcome` の既存方針とも整合し、理由がコメントに明記
   されている。例外時も成功 outcome が返ることの回帰テストあり
4. **lint エラー解消**: `contract-deploy-wiring.test.ts` の未使用引数
   `_spec` と `ContainerSpec` import が削除済み。`pnpm lint` 合格
5. **品質ゲート**: リポジトリ全体で `pnpm lint` / `pnpm build` /
   `pnpm test` すべて合格（collector 858・frontend 791・shared 40・
   e2e 34、いずれも成功）

その他の確認: エラーの握りつぶし・環境状態依存の固定値の新規追加は無し。
チェーン固有語彙の shared/frontend への漏れも無し。

### 統括への申し送り（コミット構成）

作業ツリーには未コミットの変更として少なくとも3つの関心事が混在している:
(a) #163 統合の配線（node-lifecycle.ts / index.ts の feat）、
(b) chainviz-tester のテスト強化（catalog / contracts /
peer-block-adapter / wiring の test）、
(c) 差し戻し対応（casing 正規化 + try/catch + lint 修正の fix）。
「1つの変更内容 = 1コミット」に従い、コミット時にこれらを分けること。

## 最終検証（chainviz-qa、2026-07-07）

判定: **合格**。

### 検証方針の判断（統括による決定）

本Issueのカタログ照合ロジックは、GUI経由の実デプロイでも検証したいところだが、
collectorのcomposeプロジェクト名が`"chainviz-ethereum"`にハードコードされて
おり、環境変数での上書き口が無い。この名前で`docker compose up`すると、既存
の`chainviz-ethereum`系ボリューム（genesis / reth1data 等）が再利用され、
CLAUDE.mdの「独立した合成環境で行い、本物の稼働中環境には触れない」原則に
反するリスクがある。そのため本番と同じプロジェクト名でのライブ検証は行わず、
統合テスト＋casing両端のライブ実証で合格と判断した（選択肢2の採用）。

### 合格根拠

- **casing食い違いが実データで実証済み**: reviewerが使い捨てのreth dev
  ノード＋foundryのcastで実測し、`forge create`の"Deployed to:"がEIP-55
  チェックサム表記（`0x5FbDB2315678afecb367f032d93F642f64180aa3`）、rethの
  `eth_getBlockReceipts`の`contractAddress`が全小文字（`0x5fbdb2315678afecb367f032d93f642f64180aa3`）
  で返ることを確認済み。両者が必ず食い違うことがライブで裏付けられている。
- **統合テストが実配線をend-to-endで検証**: `contract-deploy-wiring.test.ts`
  が`EthereumNodeLifecycle.runWorkbenchOperation` → `onContractDeployed` →
  `EthereumAdapter.registerContractDeployment` → `ContractTracker`を
  `index.ts`と同じ配線で組み合わせ、reviewerの実測アドレスそのものを使って
  「casing違いにかかわらず同一コントラクトとして合流し`catalogKey`が反映
  される」ことを検証している。デプロイ検知先着・デプロイコマンド先着の両
  順序、および照合済み後の重複デプロイで再配信しないことも含む。この場で
  `pnpm --filter @chainviz/collector test contract-deploy-wiring`を実行し、
  4件すべてパスすることを確認した。
- **GUIコマンド経路の実機動作はIssue #163のQAで確認済み**: GUIの定型操作
  （`runWorkbenchOperation`経由の`deployContract`）が実際にdocker exec経由で
  `forge create`を実行し`deployedAddress`を返すことは#163で実機確認済み。
  本Issue #161はその後段のカタログ照合ロジックが焦点であり、それは上記の
  統合テストで十分に検証されている。

### 完了条件の充足

`docs/PLAN.md`のcollector項目「コントラクトカタログの読み込みとデプロイ検知・
追跡を実装しContractEntityをworld-stateへ配信する（subscribeContracts）」の
完了条件を満たしていると判断する。

### 申し送り（QA検証環境の制約）

上記の「合成環境で検証できない」制約自体はcollector側の改善課題として
`docs/PLAN.md`のバックログに記載した（composeプロジェクト名の環境変数
上書き口の追加）。今後、ワークベンチ経由操作をライブでQA検証する必要が
生じた際に着手する。
