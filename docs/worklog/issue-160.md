# Issue #160 eth_getBlockReceiptsの正規化を拡張しコントラクト作成とイベントログを取得する

### 2026-07-07 Issue #160 実装

- 担当: collector
- ブランチ: issue-160-receipts-decode
- 内容: 新Phase4（C層拡張）の最初の実装ステップとして、`eth_getBlockReceipts`
  の正規化（`eth-rpc-client.ts`）を拡張し、コントラクト作成の検知と
  イベントログ（未復号）の取得ができるようにした。`docs/ARCHITECTURE.md`
  の設計方針（「ブロックあたりのRPC呼び出し回数は増やさない。Issue #86の
  方針を維持」「`subscribeTransactions`が既に呼んでいる
  `eth_getBlockReceipts`の正規化を拡張して実現する」）に沿って実装した。
  追加のRPC呼び出しは発生しない（既存の1ブロック1回の`eth_getBlockReceipts`
  呼び出しの中で追加情報も取得する）。
- 実装内容:
  - `eth-rpc-client.ts`:
    - `RpcTransactionReceipt`に`contractAddress: string | null`（コントラクト
      作成tx以外はnull）と`logs: RpcLog[]`（未復号の生イベントログ）を追加。
    - 新しい`RpcLog`インターフェース（`address` / `topics` / `data`）を追加。
    - `normalizeReceipt`を拡張し、receiptの`contractAddress`フィールドが
      文字列でなければ（欠落・null・不正型いずれも）nullへ倒す。`logs`
      フィールドは配列でなければ空配列へ倒し、各要素は`normalizeLog`で
      個別に検証・不正なものは除外する（1件のノイズでログ全体を諦めない、
      既存の`normalizeReceipt`のフォールバック方針と揃えた）。
    - イベント名・引数への復号（ABIによる`decodeEventLog`相当）はこの層
      では行わない。復号はチェーンプロファイルのコントラクトカタログを
      要するため後続Issue #162の責務とし、ここでは生データを保持する
      土台を作ることに留めた。
  - `transactions.ts`:
    - `TxInclusionDetail`に`contractAddress?: string | null`を追加
      （省略時はnullと同じ扱い）。
    - `TransactionLifecycleTracker.recordInclusion`で、非nullの
      `contractAddress`を`TransactionEntity.createdContractAddress`へ
      マッピングする。一度確定した作成先アドレスはブロックが変わらない
      限り変化しないため、以後の重複通知（別ノードからの同一ブロック
      通知等）で`contractAddress`が省略されても、既存の値を保持する
      （`from`/`to`の扱いと同じフォールバックパターン）。
      `createdContractAddress`が無い場合はフィールド自体を省略する
      （`TransactionEntity`の他の任意フィールドと同様、値が無いことと
      フィールドが存在しないことを区別しない）。
  - `index.ts`（`handleBlockInclusion`）:
    - `getBlockReceipts`が返す`receipts`から`contractAddress`を
      `TxInclusionDetail`へ渡すよう1行追加した。
    - `receipts`配列自体（`logs`を含む）は`handleBlockInclusion`の
      スコープ内で既に取得済みのため、後続Issue #162の復号ロジックは
      同じ`receipts`をこの関数内でそのまま使える設計にした（追加の
      内部ストア・プロパゲーションは設けていない。ARCHITECTURE.mdの
      「イベントログの復号はreceiptのlogsをカタログのABIで復号する」
      という記述が、receiptsを直接扱う前提であることと整合させた）。
- テスト:
  - `eth-rpc-client.test.ts`: 既存の全`getBlockReceipts`関連テスト
    （15件）の期待値に`contractAddress: null` / `logs: []`を追加し
    後方互換性（フィールドが無い入力でも安全に正規化されること）を
    確認した上で、新規に以下を追加（11件）。
    - `contractAddress`が非nullで正しく反映されるケース、通常txで
      nullになるケース、非文字列値を防御的にnullへ倒すケース。
    - `logs`が正しく正規化されるケース、`logs`フィールド欠落・非配列
      で空配列にフォールバックするケース、不正な個別ログエントリを
      除外しつつ有効なものは残すケース、`topics`内の非文字列要素を
      個別に除外するケース。
  - `transactions.test.ts`: `recordInclusion`の`createdContractAddress`
    マッピングを4件追加（非null反映、通常tx時の省略、フィールド未指定
    時の省略、別ブロックへの付け替え通知でcontractAddressが省略されても
    既存値を保持すること）。
  - `peer-block-adapter.test.ts`: `EthereumAdapter.subscribeTransactions`
    経由のend-to-endテストを2件追加（デプロイtxが`pending`→`included`
    へ遷移する際に`createdContractAddress`が正しく載ること、通常txでは
    載らないこと）。`RawReceiptFixture`に`contractAddress` / `logs`の
    任意フィールドを追加した。
  - 回帰テストの実効性確認: `TransactionLifecycleTracker.recordInclusion`
    の`createdContractAddress`マッピングロジックを一時的に削除し、追加した
    `transactions.test.ts` / `peer-block-adapter.test.ts`のテスト
    （計3件）が実際に失敗することを確認してから元に戻した。
- 確認: `pnpm --filter @chainviz/collector build`・
  `pnpm --filter @chainviz/collector test`（733 tests）がいずれも
  green であることを確認した。
- 次の担当（Issue #161・#162）への注意点:
  - `RpcTransactionReceipt.logs`はチェーン非依存の`ContractEvent`とは
    異なり、`eth_getBlockReceipts`のlogsフィールドをほぼそのまま保持した
    アダプタ内部の型（`adapters/ethereum/`配下限定。world-stateには
    漏れない）。復号（`decodeEventLog`）はカタログのABIを要するため
    Issue #162の責務。
  - Issue #161（`subscribeContracts`・コントラクトカタログの読み込みと
    追跡）は、この`createdContractAddress`と`handleBlockInclusion`内の
    `receipts`（`logs`含む）を使って`ContractEntity`を生成・追跡する
    ことになる。`handleBlockInclusion`は`private`メソッドなので、
    `subscribeContracts`実装時にこのメソッドの構造を見直す必要が
    あるかもしれない（例えば`receipts`取得後の処理を、tx確定と
    コントラクト追跡の両方から呼べる形に分割する等）。今回はこの
    Issueの範囲を超えるため手を付けていない。
  - `docs/PLAN.md`ステップ8の該当チェックボックスを更新した。GitHub
    Issueのクローズはレビュー・QAを経たPRマージ時の自動クローズに
    委ねる（実装担当は`gh issue close`しない）。

### 2026-07-07 Issue #160 テスト強化

- 担当: tester
- ブランチ: issue-160-receipts-decode
- 内容: 実装担当が書いた基本テストに対し、エッジケース・異常系・境界値の
  観点でテストを追加した。実装コードは変更していない。
- 追加したテスト:
  - `eth-rpc-client.test.ts`（`contractAddress`ブロック、4件追加）:
    - ゼロアドレス（`0x0000...0000`）を非null文字列としてそのまま保持する
      こと（「作成なし」を表すnullとは区別する）。
    - EIP-55チェックサム付きの大文字小文字混在アドレスを、小文字化などの
      正規化をせず受け取った表記のまま保持すること（checksumを壊さない）。
    - `contractAddress`と非nullの`to`が両方入った矛盾レシートでも、一方を
      落とす防御をせず両者をそのまま通すこと（観測データを歪めない）。
  - `eth-rpc-client.test.ts`（`logs`ブロック、5件追加）:
    - `topics`が空配列の匿名イベントログを、topics欠落（破棄）と区別して
      保持すること。
    - `topics`が全要素非文字列でも、ログ自体は保持し`topics`を空配列に
      畳むこと。
    - `address`が数値型のログ、`data`が数値型のログをそれぞれ個別に破棄
      しつつ、型の正しいログを残すこと（レシート全体をクラッシュさせない）。
    - 500件の大きな`logs`配列を、件数上限による切り捨てなしに順序を保って
      全件正規化すること。
  - `transactions.test.ts`（`createdContractAddress`ブロック、3件追加）:
    - ゼロアドレスの`contractAddress`は truthy な文字列なので
      `createdContractAddress`として載ること。
    - 空文字の`contractAddress`は falsy なので省略扱いになること
      （空文字を作成先アドレスとして流さない防御）。
    - 一度確定した後に別の非null値で通知された場合、新しい値で上書き
      されること（特性化テスト。後述の注記も参照）。
- 回帰テストの実効性確認: 追加した`transactions.test.ts`の空文字ケース・
  ゼロアドレスケースが、`recordInclusion`のフォールバック条件を意図的に
  改変すると実際に失敗することを確認してから元に戻した。
- 確認: `pnpm --filter @chainviz/collector test`（743 tests）・
  `pnpm --filter @chainviz/collector build`・`pnpm -r build`がいずれも
  green であることを確認した。
- 実装への注記（バグではないが設計判断として記録）:
  - `createdContractAddress`の不変性は「後続通知で`contractAddress`が
    省略された場合に既存値を保持する」ところまでで、後続通知が別の非null
    値を持つ場合は新しい値で上書きされる（`tx.contractAddress ?? existing`
    の評価順による）。`contractAddress`はsender+nonceから決まり同一txでは
    変化しないため、異なる値が来ること自体が本来あり得ず、現時点では
    どちらの挙動でも実害はない。現状の実挙動を特性化テストとして固定した。
    厳密な不変性（先に確定した値を優先）を保証したい場合は
    `existing?.createdContractAddress ?? tx.contractAddress`に変える余地が
    あるが、今回は実装を変更していない。

### 2026-07-07 Issue #160 レビュー

- 担当: reviewer
- 判定: **合格**
- 確認内容:
  - RPC呼び出し回数: `getBlockReceipts`（1ブロック1回）の正規化拡張のみで、
    追加のRPC呼び出しは無い。`index.ts`の差分はマッピング1行とコメントのみ。
    `docs/ARCHITECTURE.md`の`subscribeContracts`設計（「ブロックあたりの
    RPC回数は増やさない。Issue #86の方針を維持」）と整合。
  - ChainAdapter境界: `RpcLog`（未復号の生ログ）は`adapters/ethereum/`内に
    閉じており、world-stateへは漏れていない。`packages/shared`の
    `TransactionEntity.createdContractAddress` / `ContractEvent`は
    チェーン非依存の語彙で、既にmainに存在する型（本ブランチでのshared
    変更なし）。ARCHITECTURE.mdのスキーマ定義とも一致。
  - 後方互換性: `normalizeReceipt`の既存フィールドの挙動は不変。新規
    フィールドは欠落・不正時に安全側（null / 空配列）へ倒す。
    `TxInclusionDetail.contractAddress`は省略可能で既存呼び出し元を
    壊さない。既存テスト全件（更新済み）を含め全パッケージのテストが通る。
  - testerの申し送り（後続の非null値による上書き）: バグではないと判断。
    同一txハッシュならcontractAddressは決定論的に同一で、異なる値が来る
    こと自体がRPC側の矛盾したデータを前提とする。現状の「最新の観測を
    信頼する」挙動は本プロジェクトの「観測データを歪めない」方針とも
    整合し、特性化テストで挙動が固定されているため現状のままでよい。
    評価順の反転（先勝ち）は不要。
    - 補足（理論上のエッジ、対処不要）: 後続の重複通知が空文字の
      `contractAddress`を持つ場合、`tx.contractAddress ?? existing`の
      評価で空文字が採用され、既存の`createdContractAddress`が新しい
      entityから落ちる。同一txで「実アドレス→空文字」と返るRPCは現実には
      存在しないため指摘に留める（Issue #162でreceiptsを再度触る際に
      気に留めておく程度でよい）。
  - `handleBlockInclusion`がprivateである点: Issue #160の完了条件
    （正規化拡張）には影響しない。構造の見直し（tx確定とコントラクト追跡の
    両方から使える形への分割等）は`subscribeContracts`の要件が確定する
    Issue #161で行うのが適切。CLAUDE.mdの「先のPhaseのための先回り実装を
    しない」原則からも、今回手を付けなかった判断は正しい。
  - エラー握りつぶし: なし。`handleBlockInclusion`のcatchは具体的な
    エラーをログし、処理済みマークを外して再試行可能にしている（既存実装、
    今回の変更で劣化なし）。正規化のフォールバック（null/空配列）は
    いずれも理由がコメントで明記されている。
  - 環境依存の固定値: 新規の決め打ち定数なし。
  - テストの質: 実装担当・testerともに回帰テストの実効性（意図的に壊すと
    失敗すること）を確認済みと記録されており、追加テストは異常系
    （非文字列・非配列・個別ログの破棄）・境界値（ゼロアドレス・空文字・
    空topics・500件のログ）を実質的にカバーしている。実装の詳細をなぞる
    だけの無意味なテストは見当たらない。
  - `pnpm lint` / `pnpm build` / `pnpm test` 全て成功
    （shared 40 / e2e 34 / collector 743 / frontend 791 tests）。
- 統括への申し送り:
  - 本ブランチは未コミット（`git log main..HEAD`が空）。コミット時は
    「1つの変更内容 = 1コミット」に従い、少なくとも
    (1) collector実装＋実装担当のテスト（feat）、
    (2) testerの強化テスト（test）、
    (3) docs更新（PLAN.md / WORKLOG.md / worklog、docs）
    の粒度で分けること。

### 2026-07-07 Issue #160 QA検証

- 担当: qa
- 判定: **合格**
- 検証環境: 本物の稼働スタックには触れず、独立プロジェクト名
  `chainviz-qa160` で `profiles/ethereum/docker-compose.yml` を
  `docker compose -p chainviz-qa160 up -d` により起動した（genesis + reth1/2 +
  beacon1/2 + validator1/2 + workbench）。PoSプライベートネットが正常に
  ブロックを生成し続けることを確認（検証中に 0x9 → 0x77 へ進行）。
- 検証手順と結果:
  - collectorをホスト上で `node packages/collector/dist/index.js`
    （`CHAINVIZ_ETHEREUM_PROFILE_DIR` をこのworktreeのprofiles/ethereumに
    指定）で起動。WebSocketサーバー（4000）・ロギングプロキシ（4001）が
    正常に待ち受け、collectorログにエラー・警告は一切出なかった。
  - WebSocketクライアント（ws://localhost:4000）を直接接続し、snapshotと
    diffを観測した。
  - workbenchコンテナ内で最小のコントラクト作成txを実行
    （`cast send --create 0x60016000f3`、mnemonicはvalues.env由来）。
    receiptの `contractAddress` は
    `0x47f8f0074d99234a080d84915de4e96b04bdb4d7`、`to` は null。
  - collectorが配信したTransactionEntityで、当該deploy tx
    （hash `0x8d4645…a852`）が `pending` → `included` へ遷移し、included時の
    patchに `createdContractAddress: 0x47f8f0074d99234a080d84915de4e96b04bdb4d7`
    が含まれることを確認した。receiptのcontractAddressと完全に一致。
  - 比較のため通常の送金tx（hash `0x9f2742…e0a7`、`to`=0x…dead）も実行。
    こちらも `pending` → `included` へ遷移し、included patchに
    `createdContractAddress` が付かない（コントラクト作成ではないため省略）
    ことを確認した。
  - snapshotにblockエンティティが81件、それぞれ `receivedAt` に複数キー
    （CL/ELエッジ）が載っており、ブロック伝播の観測が壊れていないことを
    確認した。txライフサイクル（pending→included）とブロック伝播は
    いずれも既存どおり機能している。
  - `pnpm lint && pnpm build && pnpm test` を独立に実行し全て成功
    （collector 743 / frontend 791 tests ほか、exit 0）。
- 完了条件の充足:
  - コントラクト作成txを含むブロックで
    `TransactionEntity.createdContractAddress` に作成先アドレスが正しく
    反映される: 満たす。
  - 既存のtxライフサイクル・ブロック伝播に影響がない: 満たす。
- 後片付け: `docker compose -p chainviz-qa160 down -v` でコンテナ・ネット
  ワーク・ボリュームを全削除。collector/WebSocketクライアントのプロセスも
  停止し、ポート4000/4001が解放されていることを確認した。
