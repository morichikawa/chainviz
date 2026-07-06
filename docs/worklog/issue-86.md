# Issue #86 txライフサイクルにfailedステータスを実装する

### 2026-07-06 Issue #86 failedステータス実装の設計

- 担当: 設計
- ブランチ: issue-86-tx-failed-status
- 内容: tx が「ブロックに取り込まれたが実行に失敗した（receipt の status が
  0x0）」ことを検知し、`TransactionEntity.status` に `failed` を載せるための
  設計。receipt 取得の方式（RPC 呼び出し回数への影響）と、
  `TransactionLifecycleTracker` への遷移追加の方針を決めた。コードの実装は
  collector 担当への引き継ぎとし、この時点ではドキュメント更新のみ。
- 決定事項・注意点:
  - **`packages/shared` の型変更は不要**。`TransactionEntity.status` は
    Issue #76 の時点で既に `"pending" | "included" | "failed"` として定義
    済み。frontend 側も対応済みで変更不要（`detectTxSettlements` が
    pending → included / failed の両方を「確定」として扱い、
    `WalletPopover` に failed 用ラベル、`i18n/messages.ts` に
    `tx.status.failed`（失敗 / Failed）が既にある）。
  - **receipt 取得は tx ごとの `eth_getTransactionReceipt` ではなく、
    ブロック単位の `eth_getBlockReceipts`（execution-apis 標準メソッド、
    reth がサポート）を 1 ブロックにつき 1 回呼ぶ**。さらに、receipt には
    transactionHash / from / to / status がすべて含まれるため、
    `handleBlockInclusion` が現在使っている
    `eth_getBlockByHash(fullTx=true)` をこの 1 呼び出しで**置き換える**。
    結果、RPC 呼び出し回数は現状（1 ブロック 1 回）から**増えない**。
    tx ごとの receipt 取得（ブロック内 tx 数ぶんの追加 RPC）や JSON-RPC
    バッチ（`EthRpcClient` トランスポートの拡張が必要）は採らない。
  - status の解釈: receipt の `status` が `"0x0"` のときだけ失敗
    （succeeded=false）とし、`"0x1"`・欠落・不正値は成功扱いにする
    （証拠なしに failed 表示をしない保守的判断。status 欠落は
    pre-Byzantium の receipt 形式で、本プロファイルの devnet では
    実際には起きない）。
  - `eth-rpc-client.ts` は world-state の語彙（`"included"` 等）を
    持ち込まない現状の分離を保ち、`succeeded: boolean` で返す。
    boolean → `"included" | "failed"` へのマッピングはアダプタ
    （`index.ts` の `handleBlockInclusion`）で行う。
  - `TransactionLifecycleTracker.recordInclusion` は
    「blockHash + 確定ステータス付き tx 一覧」を受け取る形へ一般化する。
    スキップ条件も「既に同じ blockHash・同じ status で記録済み」へ
    一般化することで、pending → failed・未追跡 → failed（直接 failed）・
    別ノードからの同一ブロック再通知のスキップ・reorg 時の blockHash
    付け替えがすべて既存構造の自然な拡張でカバーできる。
    `recordPending` は変更不要（既知 tx を巻き戻さない既存ガードが
    failed → pending の逆行も防ぐ）。failed の tx にも `blockHash` を
    セットする（ブロックには取り込まれているため）。
  - 未追跡のまま直接 failed になった tx は、フロントの確定フラッシュ演出
    （`detectTxSettlements`）の対象外（prev が pending でないため）。
    これは未追跡 → included と同じ既存挙動であり、今回は変えない。
  - `eth_getBlockReceipts` は未知ブロックで `null` を返す想定。既存の
    `getBlockByHash` と同じく「null なら processedBlocks のマークを外して
    後続ノードの通知で再試行」という機構をそのまま流用する。空ブロックは
    空配列が返る（ブロックは存在するのでマークは維持）。
  - この置き換えで `getBlockByHash` / `RpcBlock` / `RawBlock` は未使用に
    なるため削除する（dead code を残さない）。`normalizeTransaction` は
    `getTransactionByHash` が使うので残す。
  - 前提条件（実装時に最初に確認）: ethereum プロファイルの EL は reth
    （`ghcr.io/paradigmxyz/reth:latest`）であり、`eth_getBlockReceipts` を
    サポートする。設計時点ではスタックが停止していて実測できなかったため、
    実装着手時に稼働スタックへ
    `curl -s -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_getBlockReceipts","params":["latest"]}' http://<reth>:8545`
    で応答（from/to/status/transactionHash の存在）を確認してから進める。
  - QA 向けの failed tx 再現レシピ: ワークベンチから
    `cast send --create 0xfe`（先頭が INVALID オペコードのデプロイコード）
    を送ると「取り込まれたが実行失敗（status 0x0）」の tx が作れる。

### 2026-07-06 Issue #86 failedステータス実装

- 担当: collector
- ブランチ: issue-86-tx-failed-status
- 内容: 設計フェーズの決定に沿って、tx がブロックに取り込まれたが実行に
  失敗した場合に `TransactionEntity.status` を `"failed"` にする実装を行った。
- 実測確認（実装着手前に実施）:
  - `profiles/ethereum` のスタックが起動済みだったが、`genesis` ボリューム
    が約13時間前の古いものを再利用しており、`beacon1`/`beacon2` が
    weak subjectivity check で起動に失敗していた（設計フェーズの想定通り、
    devnet の genesis は使い捨てで再利用不可）。`docker compose down -v`
    でボリュームを破棄し `docker compose up -d` でジェネシスから作り直して
    復旧した。
  - ワークベンチから `cast send --rpc-url http://reth1:8545 ...` で
    reth1 に直接 tx を送り（通常送金 tx と `--gas-limit 100000 --create 0xfe`
    の失敗 tx の両方）、それぞれのブロックハッシュに対して
    `curl -X POST -d '{"method":"eth_getBlockReceipts","params":["<blockHash>"]}'`
    を実行。receipt に `transactionHash` / `from` / `to` / `status`
    がすべて含まれること、成功 tx は `status:"0x1"`、失敗 tx は
    `status:"0x0"`、`to` はコントラクト作成時 `null`、未知ブロックは
    `result:null` になることを確認した（設計時点の想定と完全に一致）。
- 実装内容:
  - `eth-rpc-client.ts`: `getBlockByHash` / `RpcBlock` / `RawBlock` を削除し、
    `getBlockReceipts(rpc, rpcUrl, blockHash)` と `RpcTransactionReceipt`
    （`transactionHash` / `from` / `to` / `succeeded: boolean`）を新設。
    生の receipt の `status` フィールドは `normalizeReceipt` 内で
    `"0x0"` のときだけ `succeeded: false`、それ以外（`"0x1"`・欠落・不正値）
    は `succeeded: true` に正規化する。`normalizeTransaction` /
    `getTransactionByHash` は変更なし（`handlePendingTx` が引き続き使う）。
  - `transactions.ts`: `TxInclusionDetail`（`TxDetail` に
    `status: "included" | "failed"` を追加した型）を新設し、
    `recordInclusion(blockHash, txs: TxInclusionDetail[])` へ一般化した。
    スキップ条件を「同一 blockHash かつ同一 status で記録済み」に変更し、
    failed の tx にも `blockHash` をセットするようにした。
    `recordPending` は無変更（既存の「追跡済みなら巻き戻さない」ガードが
    failed → pending の逆行防止にもそのまま効く）。
  - `index.ts`: `handleBlockInclusion` を `getBlockReceipts` ベースに
    書き換え、`succeeded` を `"included"`/`"failed"` へマッピングしてから
    `recordInclusion` に渡すようにした。未知ブロック（null）時の
    「processedBlocks からマークを外して後続ノードの通知で再試行する」
    既存の再試行機構は変更していない。
- テスト:
  - `eth-rpc-client.test.ts`: `getBlockReceipts` の正規化（status→succeeded
    のマッピング、欠落・不正値のフォールバック、空ブロック、未知ブロック、
    不正 receipt エントリの除去）を追加。
  - `transactions.test.ts`: `recordInclusion` に failed 系のケース
    （pending→failed、未追跡→直接 failed、同一 blockHash 内での
    included→failed の再遷移、pending への巻き戻し防止が failed でも
    効くこと）を追加。
  - `peer-block-adapter.test.ts`: `stubRpcClient` が返すデータを
    「正規化前の生 JSON-RPC 形状」（`status: "0x1"/"0x0"` の hex 文字列）に
    修正した上で、`subscribeTransactions` の failed 系シナリオ
    （pending→failed への遷移）を追加。既存の #76 由来の再試行回帰テスト
    （初回 fetch が null / 例外を返しても後続ノードの通知で回復する）は
    `eth_getBlockReceipts` ベースの形に書き換えた上でそのまま維持した。
  - 回帰テストの有効性確認: `index.ts` の `succeeded ? "included" : "failed"`
    を一時的に常に `"included"` へ書き換えて、追加した failed 系テストが
    実際に落ちることを確認してから元に戻した。
- 実機（実際のスタック）での確認:
  - collector を起動し、WebSocket 接続でスナップショット・差分イベントを
    受信するスクリプトで監視した状態で、ワークベンチから通常送金 tx と
    `cast send --create 0xfe` の失敗 tx を送信。前者は
    `pending → included`、後者は `pending → failed`（両方とも正しい
    `blockHash` 付き）の diff イベントが実際に配信されることを確認した。
- 次の担当への注意点:
  - `profiles/ethereum` の genesis はプロジェクト名固定（`chainviz-ethereum`）
    のため、Docker ホストを共有する複数 worktree/セッション間で
    コンテナ・ボリュームが衝突しうる。スタックが古い genesis のまま
    weak subjectivity で落ちている場合は `docker compose down -v` からの
    `up -d` で作り直す必要がある（実データの保持は前提にしていない
    使い捨て devnet なので安全）。
  - QA での再現手順は設計フェーズのメモ通り
    `cast send --create 0xfe`（`--gas-limit` を明示しないと `cast send` が
    ガス見積もり段階でエラーになり tx が送信されないので注意。
    `cast send --private-key <key> --gas-limit 100000 --create 0xfe`）。

### 2026-07-06 Issue #86 テスト強化（異常系・境界値）

- 担当: テスト強化
- ブランチ: issue-86-tx-failed-status
- 内容: collector 実装担当が書いた基本テストに対し、failed ステータス導入に
  伴う異常系・境界値・振り分けの観点でユニットテストを追加した。実装コードは
  変更していない（テストの追加のみ）。追加は 15 件。
  - `eth-rpc-client.test.ts`（getBlockReceipts / normalizeReceipt、8件追加）:
    - `from` 欠落の receipt は捨てられ、誤って failed 表示に倒れないこと。
    - `to` 欠落・非文字列はいずれも null に正規化されること。
    - `status` が null / 数値 0 / `"0x00"` のいずれでも succeeded 扱いに
      なること（失敗判定は文字列 `"0x0"` の完全一致のみ、という保守的挙動の
      境界確認。証拠なしに failed に倒さない）。
    - result が非配列オブジェクト・スカラ値のとき null を返すこと（未知
      ブロックと同じ安全側の扱い）。
    - success / failed / 不正 receipt が混在するブロックを、順序を保ったまま
      不正分だけ落として正しく正規化すること。
  - `transactions.test.ts`（TransactionLifecycleTracker、4件追加）:
    - 同一ブロックに included と failed が混在（既知 pending・未知 tx 双方）
      する場合の振り分け。
    - 同一ブロックでの failed → included のステータス変化も再通知されること
      （既存の included → failed の逆方向）。
    - 空ブロック（tx 0 件）では空配列を返すこと。
    - 同一ブロック内に同一ハッシュが同一 status で重複しても 1 回だけ通知
      されること。
  - `peer-block-adapter.test.ts`（EthereumAdapter.subscribeTransactions、3件追加）:
    - success + failed 混在ブロックを getBlockReceipts + recordInclusion 経由で
      end-to-end に included / failed へ振り分けること。
    - transactionHash 欠落の不正 receipt が混じっても、正常な tx だけが通知
      されること。
    - pending 通知を取りこぼした失敗 tx を、ブロックの receipt から直接
      failed として通知すること（未知ハッシュの failed 経路）。
- 確認: `pnpm lint && pnpm build && pnpm test` を全パッケージで実行し通過
  （collector 522 tests / frontend 411 tests、いずれも green）。
- 観点ごとの結論（依頼された 5 点）:
  1. 不正な receipt（status 欠落・不正値、transactionHash/from 欠落）は
     すべて安全側（included 扱い、または receipt 自体を skip）に倒れており、
     証拠なしに failed 表示にならないことを確認した。
  2. 同一ブロックの success / failed 混在は RPC 正規化層・トラッカー層・
     アダプタ層の 3 段すべてで正しく振り分けられる。
  3. 「同一 blockHash かつ同一 status」のスキップ条件は、status が変われば
     included ⇔ failed 双方向で再通知され、変わらなければスキップされる。
  4. ブロック取得が null / 例外の場合の #76 由来リトライ機構は、failed 判定
     追加後も既存テストで維持されている（変更なし）。
  5. 未知の tx ハッシュ（included/failed として報告されたが pending 未記録）は
     ブロックの from/to を使って直接追加される経路を included・failed 双方で
     確認した。
- 補足（バグではない設計上のメモ）: 失敗判定は receipt.status の文字列
  `"0x0"` 完全一致のみで、`"0x00"` などゼロ相当の別表記は succeeded に
  倒れる。これは「証拠なしに failed 表示をしない」保守的方針と整合しており
  実害はない（devnet の reth は `"0x0"` を返す）。将来 status 表記の揺れる
  クライアントに対応する場合はここを見直す余地がある、という記録に留める。

### 2026-07-06 Issue #86 静的レビュー（合格）

- 担当: レビュー
- ブランチ: issue-86-tx-failed-status
- 結果: **合格**。指摘事項なし（下記の軽微なメモのみ）。
- 確認内容:
  - RPC 呼び出し回数: `handleBlockInclusion` は `processedBlocks` ガード下で
    `eth_getBlockReceipts` を 1 ブロック 1 回だけ呼んでおり、置き換え前の
    `eth_getBlockByHash` 1 回から増えていない（tx ごとの receipt 取得なし）。
    設計時の主張どおり。
  - status 判定: `"0x0"` 完全一致のみ failed とする実装をコード・コメント・
    テストで確認。JSON-RPC の QUANTITY エンコーディング（先頭ゼロなし）に
    従う reth は `"0x0"`/`"0x1"` を返すことが collector 担当の実測
    （curl での確認記録）と整合しており、完全一致で問題ない。
  - #76 由来のリトライ機構: null 時・例外時とも `processedBlocks` から
    マークを外す挙動は無変更。回帰テスト 2 件（null 版・例外版）は
    `eth_getBlockReceipts` の形状に書き換えられた上で維持されている。
  - `recordInclusion` のスキップ条件（同一 blockHash かつ同一 status）:
    included→included の重複通知スキップ、reorg 時の blockHash 付け替え
    再通知、status 変化（included⇔failed 双方向）の再通知がすべて
    テストでカバーされている。
  - テストの実効性（レビュー担当自身の変異確認）:
    (1) `normalizeReceipt` の failed 判定を常に succeeded=true へ変異
    → 5 テストが失敗を検出。(2) スキップ条件から status 比較を除去
    → 2 テストが失敗を検出。いずれも復元後 green（collector 522 /
    frontend 411）。
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過。
  - 境界の遵守: 変更は `adapters/ethereum/` 配下に閉じており、
    `packages/shared` / frontend に `eth_getBlockReceipts` 等の
    チェーン固有語彙の漏れなし。`eth-rpc-client.ts` は `succeeded: boolean`
    で返し、world-state の語彙（included/failed）へのマッピングは
    アダプタ側で行う分離も設計どおり。
  - docs: `docs/ARCHITECTURE.md` の `subscribeTransactions` 記述が実装と
    一致。`docs/PLAN.md` チェック・`docs/WORKLOG.md` 索引も更新済み。
  - コミット粒度: 7 コミットとも単一の関心事（設計 docs / RPC ヘルパー /
    トラッカー / アダプタ切り替え / 実装 docs / テスト強化 / テスト docs）
    に分かれており良好。
- 軽微なメモ（差し戻し不要）:
  - `normalizeReceipt` は不正 receipt をログなしで捨てるため、万一
    不正形状が来るとその tx は pending のまま残る。既存の
    `normalizeTransaction` と同じ安全側パターンで実害はないが、将来
    別クライアント対応時にはデバッグログの追加を検討する余地がある。
  - `docs/WORKLOG.md` の #86 索引行が「…の設計」のままだが、ファイルは
    実装・テスト強化まで含む（表記のみの些事）。

### 2026-07-06 Issue #86 動作検証（合格）

- 担当: 検証（QA）
- ブランチ: issue-86-tx-failed-status
- 結果: **合格**。docs/PLAN.md バックログ #86 の完了条件を実環境で満たすことを確認した。
- 検証環境: `profiles/ethereum` のスタック（reth ×2 + lighthouse beacon/validator ×2 +
  workbench）が稼働中で、ホスト公開ポート 8545 で `eth_blockNumber` が 0x49c → 0x49e と
  進行していることを確認（チェーンは正常に前進）。ビルド済みの collector 本体を
  `node packages/collector/dist/index.js` で起動（WebSocket 4000 / ロギングプロキシ 4001）。
  ワークベンチの `ETH_RPC_URL` は `http://host.docker.internal:4001`（起動した collector の
  ロギングプロキシ）を指しており、ワークベンチからの tx は実際にプロキシ経由で reth に
  到達している。WebSocket クライアントでスナップショット + 差分を監視した。
- 検証1（通常送金 tx: pending → included）:
  - ワークベンチから `cast send --mnemonic ... --mnemonic-index 0 <A1> --value 1ether` を送信。
    receipt は status 1 (success) / blockNumber 1269 / blockHash 0xdad4610a... / txHash 0xec420687...。
  - collector の配信: `entityAdded`（tx 0xec420687... status=pending, blockHash なし）→
    `entityUpdated`（{"status":"included","blockHash":"0xdad4610a..."}）を受信。receipt の
    blockHash と一致。想定どおり pending → included（blockHash 付き）へ遷移した。
- 検証2（実行失敗 tx: pending → failed）:
  - ワークベンチから `cast send --mnemonic ... --mnemonic-index 0 --gas-limit 100000 --create 0xfe`
    を送信（先頭 INVALID オペコード）。receipt は status 0 (failed) / blockNumber 1281 /
    blockHash 0xead7230e... / txHash 0x5c704f89...。
  - collector の配信: `entityAdded`（tx 0x5c704f89... status=pending, blockHash なし）→
    `entityUpdated`（{"status":"failed","blockHash":"0xead7230e..."}）を受信。receipt の
    blockHash と一致。想定どおり pending → failed（blockHash 付き）へ遷移した。取り込まれた
    が実行失敗した tx が failed として区別されることを実データで確認。
  - なお genesis 衝突は発生せず（スタックは有効な genesis で稼働中だったため
    `docker compose down -v` は不要だった）。
- 検証3（静的チェック）: `pnpm lint && pnpm build && pnpm test` を全パッケージで実行し
  exit 0（collector 522 tests / frontend 411 tests、いずれも green）。
- collector ログにエラー・例外・unhandledRejection は無し。tx 送信中も poll 失敗や
  subscription 失敗のログは出ていない。
- 結論: 完了条件（通常 tx が pending→included、失敗 tx が pending→failed、いずれも
  blockHash 付きで実環境の collector から差分配信される）を満たす。差し戻し無し。
