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
