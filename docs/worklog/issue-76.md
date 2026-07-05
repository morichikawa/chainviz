# Issue #76 作業記録

### 2026-07-05 Issue #76 txライフサイクル追跡の実機検証(qa)

- 担当: qa
- ブランチ: issue-76-tx-lifecycle
- 内容: 実 Docker スタック(reth1/reth2 + beacon/validator + workbench)と実
  collector を起動し、Issue #76 の完了条件を実際に動かして検証した。
  - lint / build / test を全パッケージで実行し合格を確認した
    (shared 2 / collector 397 / frontend 301 / e2e unit 34、lint・build ともにエラーなし)。
  - workbench コンテナの Foundry cast で `cast send --async` により実トランザクションを
    5 件投入し(送信先はプリマインアカウント、rpc-url は reth1 コンテナIPを直接指定)、
    collector に生 WebSocket を接続して transaction エンティティの snapshot / diff を
    時系列で記録した。
  - 結果: 投入した 5 件すべてが `entityAdded` diff で status:"pending" として現れ、
    その後 `entityUpdated` diff で status:"included" かつ blockHash(64桁hex)付きへ
    遷移した。接続時点の snapshot に transaction は 0 件で、pending・included とも
    すべて diff 経由で届いており、WebSocket でフロントへ配信されることを確認した。
    同一ブロックに複数 tx が入るケース(2件が同一 blockHash)も正しく included 化された。
- 決定事項・注意点(次担当へ):
  - workbench のデフォルト RPC 接続先 `ETH_RPC_URL=host.docker.internal:4001` は
    ロギングプロキシ(Issue #78/#79、未実装)経由を想定しており、現時点ではホスト側
    4001 が未 listen のため cast はデフォルトでは疎通しない。検証では reth コンテナの
    JSON-RPC(8545)へ `--rpc-url` で直接向けた。プロキシ実装後にデフォルト経路での
    疎通を再確認するとよい。
  - 検証は一時的な e2e テストファイルで行い、検証後に削除した(コミットには含めない)。

### 2026-07-05 Issue #76 txライフサイクル追跡の死コード削除とコミット分割(collector)

- 担当: collector
- ブランチ: issue-76-tx-lifecycle
- 内容: 再レビュー合格後の後片付けとコミット整理を実施した。
  - reviewer による `ChainAdapter` 型変更(subscribeChainEvents 削除)で死コードと
    なった `adapters/ethereum/index.ts` 末尾の `subscribeChainEvents` no-op 実装と、
    それだけが使っていた `DiffEvent` import を削除した。
  - 未コミットだった全変更を関心事ごとに分割してコミットした:
    shared 型更新 / WSクライアントの newPendingTransactions 購読追加 /
    HTTP JSON-RPC クライアント追加 / tx tracker+adapter+targets+store の機能追加 /
    collector 配線 / docs 更新。
  - `pnpm lint` / `pnpm build` / `pnpm test` は全パッケージ通過を確認した。
- 決定事項・注意点(次担当へ):
  - Issue #77(issue-77-wallet-tracking)側でも独立に `eth-rpc-client.ts` が作られ、
    汎用 `call()` のみの互換性のない EthRpcClient になっている。両ブランチのマージ
    段階で、#77 の汎用 call() を共通トランスポートとして残し、#76 のドメイン固有
    メソッドをその上のヘルパーに再実装する統合が必要(このブランチ単体では未対応)。

### 2026-07-05 Issue #76 txライフサイクル追跡の再レビューとChainAdapter型更新(reviewer)

- 担当: reviewer
- ブランチ: issue-76-tx-lifecycle
- 内容: 前回差し戻し(要修正1件・軽微2件)への対応を再レビューした。結果は
  合格(ただしコミット前の軽微な後片付け1件あり。下記)。
  - 要修正(handleBlockInclusion)の対応を確認。`getBlockByHash` が null を
    返した場合・例外を投げた場合の両方で `processedBlocks.delete(blockHash)`
    が呼ばれ、後続ノードの同一ブロック通知で再試行できるようになった。
    回帰テスト2件が「意味のあるテスト」であることを、修正箇所
    (`processedBlocks.delete` 2箇所)を一時的に除去して該当2件だけが失敗する
    ことを実際に確認したうえで、原状復帰(md5一致)して検証した。
  - 軽微1(stale docstring)・軽微2(ARCHITECTURE.md §4)の対応も確認。
  - `pnpm lint` / `pnpm build` / `pnpm test` は全パッケージ通過
    (collector 397 / frontend 301 / shared 2)。
  - failed ステータスの後続 Issue #86 の起票を確認。
- `packages/shared` の `ChainAdapter` 型を更新した(reviewer 自身が実施):
  - `subscribeChainEvents(onEvent: DiffEvent)` を削除し、実装が採用した
    層ごとの型付きコールバック `subscribeBlocks` / `subscribeTransactions` を
    宣言する形にした。
  - 理由: ChainAdapter は「これを実装すれば collector の配線に載る」境界
    契約であり、collector の main が実際に呼ぶのは pollInfra /
    subscribePeers / subscribeBlocks / subscribeTransactions の4つ。
    subscribeChainEvents はどこからも呼ばれない no-op で、残すと新チェーンの
    Adapter 実装者が死んだメソッドを実装して型チェックは通るのに配線に
    載らない、という事故を招く。「先回り実装をしない」原則に従い、D層の
    購読口は Phase 4 の設計時に必要な形で追加する。
  - `docs/ARCHITECTURE.md` §4 の型スニペットと説明文も新しい型に合わせて
    更新した(自分の型変更に伴う整合の範囲)。
  - 型変更後も全パッケージの build / lint / test が通ることを確認済み。
- 差し戻し(軽微・コミット前に実施): `packages/collector/src/adapters/`
  `ethereum/index.ts` 末尾の `subscribeChainEvents` no-op 実装は、型から
  削除されたため完全な死コードになった。メソッドと、それだけが使っていた
  `DiffEvent` import を削除すること(削除しないと将来 lint の未使用検出や
  誤解の元になる)。
- 注意点(次担当へ):
  - 変更は未コミット。前回指摘したとおり、コミット時は関心事ごとに分ける
    こと(WSクライアントのリファクタ / RPCクライアント追加 / tracker+adapter+
    store の機能追加 / 配線 / shared 型更新 / docs 程度)。
  - 同一 pending tx を複数ノードが通知するとノード数分の
    `eth_getTransactionByHash` が飛ぶ点は前回同様、効率のみの問題として
    指摘に留める(正しさに影響なし)。

### 2026-07-05 Issue #76 txライフサイクル追跡のレビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-76-tx-lifecycle
- 内容: collector の tx ライフサイクル(pending→included)実装を静的
  レビューした。結果は差し戻し(要修正1件・軽微2件)。
  - 合格点: Ethereum 固有の語彙(eth_subscribe /
    eth_getTransactionByHash 等)は `adapters/ethereum/` に閉じており、
    共有層へはチェーン非依存の `TransactionEntity` のみが出ている。
    `packages/shared` の型変更が不要という判断も妥当(既存の
    `TransactionEntity` で表現できている)。テストは異常系(RPC失敗・
    タイムアウト・不正フレーム・reorg・eviction)まで揃っており質は高い。
    `pnpm lint`/`pnpm build`/`pnpm test` は全パッケージで通過。
  - 要修正: `EthereumAdapter.handleBlockInclusion` が
    `markBlockProcessed` を**取得成功の前に**確定させるため、
    `getBlockByHash` が失敗(タイムアウト等)または null を返すと、
    そのブロックは二度と処理されない(他ノードからの同一ブロック通知も
    processedBlocks で弾かれる)。結果として、そのブロックに入った tx が
    永久に pending 表示のまま残る。取得失敗・null の場合は
    `processedBlocks` から当該ハッシュを取り除き、後続の通知で再試行
    できるようにすべき。
  - 軽微1: `subscribeChainEvents` の docstring が「Phase 3 で実装する/
    未実装(B層の範囲外)」のままで、本変更(C層を `subscribeTransactions`
    で実装)後は誤解を招く。実態に合わせて更新する。
  - 軽微2: `docs/ARCHITECTURE.md` §4 の ChainAdapter は C層の入口を
    `subscribeChainEvents(onEvent: DiffEvent)` としているが、実装は
    層ごとの型付きコールバック(`subscribeBlocks`/`subscribeTransactions`)
    + store 側での差分計算に発展している(subscribeBlocks 導入時からの
    乖離)。本PRで docs を実装に合わせて更新するのが望ましい。
- 決定事項・注意点:
  - `status:"failed"` を今回スコープ外(receipt 取得が別経路)とした判断は
    妥当。ただしマージ前に後続 Issue を起票すること。
  - `maxTxs=1000` / `maxProcessedBlocks=500` の固定値はメモリ上限であり、
    超過時も「dedup を取りこぼして再取得・再emitが起きるだけ」で store 側の
    差分計算が重複を吸収するため、環境状態に依存して壊れる決め打ちには
    当たらないと判断した(eviction 後の再通知は entityUpdated の空差分に
    なることを確認済み)。
  - 同一 pending tx を複数ノードが通知するとノード数分の
    `eth_getTransactionByHash` が飛ぶ(tracker の dedup は取得後)。
    正しさに影響しない効率の問題なので今回は指摘のみ。
  - 変更は未コミット。コミット時は最低でも「WSクライアントの純粋関数
    切り出し(リファクタ)」「RPCクライアント追加」「tracker+adapter+store の
    機能追加」「配線」「docs」程度に関心事を分けること。

### 2026-07-05 Issue #76 reth WSでtxライフサイクル(pending→included)を追跡する(collector)

- 担当: collector
- ブランチ: issue-76-tx-lifecycle
- 内容: C層(生きているチェーン)のうち、tx のライフサイクル追跡を実装した。
  - `adapters/ethereum/eth-ws-client.ts` に `subscribePendingTransactions` を
    追加(既存の `subscribeNewHeads` と共通の `eth_subscribe` 配線に集約)。
    WS フレームの解釈を純粋関数 `parseSubscriptionResult` に切り出して
    テスト可能にした。
  - `adapters/ethereum/eth-rpc-client.ts` を新規追加。HTTP JSON-RPC(POST)で
    `eth_getTransactionByHash` / `eth_getBlockByHash(fullTx=true)` を叩き、
    tx の from/to やブロック内 tx 一覧を取得する。
  - `adapters/ethereum/transactions.ts` を新規追加。`TransactionLifecycleTracker`
    が tx ハッシュをキーに pending→included の状態遷移を差分として返す純粋
    ロジック(`blocks.ts` の `BlockPropagationTracker` と同じ設計)。
  - `EthereumAdapter.subscribeTransactions(onTx)` を追加。各 Execution ノードに
    newPendingTransactions と newHeads を購読し、pending 検知 → 詳細取得 →
    `recordPending`、ブロック取り込み → ブロック内 tx 突き合わせ →
    `recordInclusion` を行う。included 判定用のブロック取得は `processedBlocks`
    で 1 ブロック 1 回に絞る(同一ブロックが複数ノードから通知されるため)。
  - `world-state/store.ts` に `applyTransaction` を追加(block と同じくハッシュ
    キーの単一エンティティ取り込み。共通処理を `applyHashKeyed` に集約)。
  - `collector/src/index.ts` の main で `subscribeTransactions` を store・
    WebSocket 配信に配線した。
  - Ethereum 固有の RPC 語彙(eth_subscribe / eth_getTransactionByHash 等)は
    すべて `adapters/ethereum/` 内に閉じ込め、共通層へはチェーン非依存の
    `TransactionEntity` でのみ出している。
- 決定事項・注意点:
  - reth の `newPendingTransactions` は tx ハッシュのみを返す(実機確認済み)。
    from/to を埋めるには `eth_getTransactionByHash` の追加取得が必須。この
    ため WS 購読と HTTP JSON-RPC(reth の 8545)の両方を使う。`ExecutionTarget`
    に `rpcUrl`(http://IP:8545)を追加した。
  - newHeads は B層(subscribeBlocks、伝播タイミング用)でも購読しているが、
    層ごとに関心を分離するため C層は独自に newHeads を購読し、ブロック内 tx の
    突き合わせだけを行う(同一ノードへ B/C の 2 本 + pending の 1 本 = 計 3 本の
    WS を張る)。
  - `status:"failed"`(reverted 等)は今回のスコープ外。実装には
    `eth_getTransactionReceipt` の追加取得(receipt.status を見る)が必要で、
    別 Issue で扱うのが妥当と判断した。現状 included までを確実に追跡する。
  - 実機確認: `profiles/ethereum` 起動中にワークベンチから `cast send` を実行し、
    (1) tracker/RPC/WS クライアント直結の検証、(2) 実 collector + WebSocket
    経由の world-state 観測、の両方で pending(entityAdded)→ included
    (entityUpdated + blockHash)の遷移を確認した。
### 2026-07-05 Issue #76/#77 eth-rpc-client統合の実機検証(qa)
- 担当: qa
- ブランチ: issue-77-wallet-tracking
- 内容: mainマージ後のeth-rpc-client.ts統合(#77の汎用call()を共通
  トランスポートとして残し、#76のgetTransactionByHash/getBlockByHashを
  その上のヘルパー関数として再実装)について、#76(txライフサイクル追跡)と
  #77(ウォレット追跡)が統合後も同一collectorプロセスで両方動くことを
  実環境で検証した。結果は合格。
  - 検証環境: 稼働中の`profiles/ethereum`スタック(reth1/reth2+beacon+
    validator+workbench、CHAIN_ID=1337、slot 2秒)。このブランチで
    `pnpm build`したdist/index.jsをポート衝突回避のため
    CHAINVIZ_COLLECTOR_PORT=4005 / CHAINVIZ_PROXY_PORT=4006で起動。
    起動時のwallet無効化警告は出ず、mnemonicをvalues.envから読めている
    ことを確認。WebSocketクライアントでスナップショット・差分を購読した。
  - #77 ウォレット追跡: ワークベンチのwalletIdsが
    `0x2BB7DcEeB1964D1c2EdbCbB04Cd7893F6619d4c0`として導出され、これが
    `cast wallet address --mnemonic <values.env> --mnemonic-index 0`の
    出力と完全一致(BIP-44 m/44'/60'/0'/0/0)。スナップショットのWalletEntity
    のbalance=999999996499999954856129996 / nonce=6が、同時刻のcast balance /
    cast nonceの実チェーン値と一致することを確認。
  - #76 txライフサイクル: ワークベンチから`cast send`で1etherを送信すると、
    collectorがTransactionEntityをまずstatus=pending(from=ウォレット
    アドレス、to=送信先)で追加し、続いてstatus=included・blockHash付与へ
    更新する差分を配信した。これは統合で書き換えたgetTransactionByHash
    (pending詳細取得)とgetBlockByHash(ブロック内tx突き合わせ)の呼び出し
    経路が実際に機能していることを示す。
  - 同時動作: 上記2つは同一collectorプロセス(ポート4005)で並行して観測
    された。さらにtx送信後、同じウォレットのWalletEntityがbalance減少・
    nonce 6→7へ更新され、tx送信とウォレット状態更新が同一プロセス内で
    整合していることも確認した。
  - 静的ゲート: `pnpm lint && pnpm build && pnpm test`が全パッケージで通過
    (shared 2 / collector 483 / frontend 353、e2e含む)。
- 決定事項・注意点:
  - #76/#77はPLAN.md上すでに個別QA済みで[x]。今回は統合後の最終確認で
    あり、新たにチェックを付けるqa担当のPLAN項目は無い。
  - 検証は既存スタックが十分に進行した状態(ブロック高2100前後)で実施し、
    稼働時間に依存する固定値の破綻は観測されなかった。
