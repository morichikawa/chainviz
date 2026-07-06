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
