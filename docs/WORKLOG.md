# chainviz 作業記録

各タスクの完了時に、担当したエージェントが追記する記録。
`docs/PLAN.md` のチェックボックスは「どこまで進んだか」を示すだけなので、
「何を・なぜ・どう実施したか」「実装中に判明した注意点」はこちらに残す。
commit ログとあわせて読むことで、後から経緯を追えるようにする。

この記録は平易で正確な日本語で書く(担当エージェントのペルソナの口調は
使わない)。

## 記入フォーマット

```
### YYYY-MM-DD Issue #<番号> <タイトル>
- 担当: <collector | frontend | node-env | reviewer | qa>
- ブランチ: issue-<番号>-<スラッグ>
- 内容: 何を実装・変更したか
- 決定事項・注意点: 実装中に判明した仕様の詳細、次の担当が知っておくべきこと
```

## 記録

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

### 2026-07-05 PR #75 PLAN.mdの#32チェック漏れ修正のレビュー(reviewer)

- 担当: reviewer
- ブランチ: docs-plan-checkbox-fix
- 内容: `docs/PLAN.md` バックログの「ダークモードのUI視認性を改善する」
  (#32)を `[x]` に付け替える1行のみの変更をレビューした。結果は合格。
  - Issue #32 は CLOSED、対応PR #72(`issue-32-dark-mode-contrast`)は
    2026-07-04 に MERGED であり、マージコミット `505823b` と実装コミット
    `887c2c1` が `origin/main` の祖先に含まれることを `git merge-base
    --is-ancestor` で確認した。チェック付与は事実と整合する。
  - 記法は既存のチェック済み項目(#43)と同一形式で、Issueリンク行も
    維持されている。
  - 変更は Markdown 1行のみで TypeScript パッケージに影響しないため、
    `pnpm build`/`pnpm lint`/`pnpm test` の結果は main と同一
    (pre-push フックで検証済み)。
  - コミットは1件(`89b504c`)で1変更1コミットの規約に適合。
- 決定事項・注意点: ブランチ名が `issue-<番号>-<スラッグ>` 形式でないが、
  本修正は #32 のクローズ時のチェック漏れの後始末であり、対応する新規
  Issue が存在しないため許容とした。

### 2026-07-04 Issue #64 E2Eポート衝突修正のQA検証(qa)

- 担当: qa
- ブランチ: issue-64-e2e-port-collision
- 内容: `ps aux | grep vitest`で他worktreeの同時実行が無いことを確認した
  うえで、実際に2つのターミナルから`pnpm test:e2e`を同時実行した。1本目は
  ロックを取得し全21テスト成功(約171秒)。2本目はロック取得に失敗し、
  約1秒で明確なエラー(先行実行のPID・ホスト名・開始時刻・ロックパスを
  含む)により即座に失敗した(60秒タイムアウトを待たされない)。1本目
  完了後、ロックファイル(`/tmp/chainviz-test-e2e.lock`)が正しく削除
  されていることを確認した。
- 決定事項・注意点: `pnpm lint`/`pnpm build`/`pnpm test`(collector 330・
  frontend 301・e2eユニット34)も全通過。`docs/CONTRIBUTING.md`の記述は
  実装と一致。差し戻しなし。

### 2026-07-04 Issue #64 レビュー指摘4点の対応確認(reviewer 再レビュー)

- 担当: reviewer
- ブランチ: issue-64-e2e-port-collision
- 内容: 前回レビューの推奨4点への collector 担当の対応を静的に再確認した。
  結果は合格。
  - `collector.ts` の `waitForOwnProcessToListen` が `"exit"` から
    `"close"` に変更されている(登録・解除とも)ことを確認。stdio flush
    保証の理由コメントも適切。`stop()` 側の `"exit"` 監視は stdio に
    依存しない後片付け用途なのでそのままで問題なし。
  - `e2e-lock.ts` に `formatStaleRetryExhaustedError` が追加され、stale
    回収リトライ上限到達時にこちらを投げるようになった(解析不能経路の
    `formatUnparsableLockError` と文言が区別される)。ユニットテストで
    「解析できませんでした」を含まないことまで検証されている。
  - `e2e-lock.unit.test.ts` のテスト名 typo(「フィールード」)が修正済み。
  - `docs/WORKLOG.md` の #64 実装記録が「新しいものが上」の並びに従って
    冒頭側へ移動済み。
  - `pnpm lint` / `pnpm build` / `pnpm test`(shared 2・collector 330・
    frontend 301・e2e ユニット 34)の全通過を確認した。
- 決定事項・注意点:
  - `pnpm test:e2e` の実機実行(ポート衝突の同時実行再現)は未実施。
    chainviz-qa の実機検証に引き継ぐ。
  - 未コミットのまま。コミット時は前回指摘どおり関心事ごとの分割を守ること。

### 2026-07-04 Issue #64 test:e2e同時実行対策のレビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-64-e2e-port-collision
- 内容: collector担当によるIssue #64対応(起動判定の実ログベース化・
  ホスト単位排他ロック・回帰テスト・CONTRIBUTING.md更新)を静的レビュー
  した。結果は合格(軽微な推奨事項あり、下記)。
  - `detectLaunchStatus` の判定文字列が collector 本体の実ログと一致する
    ことを確認した(`packages/collector/src/index.ts` の
    `[collector] WebSocket server listening on port <port>` と
    `[collector] fatal:`。EADDRINUSE は `CollectorServer.listen` の
    reject が `main().catch` に伝播して stderr に出る経路を確認)。
  - 回帰テスト `collector-port-collision.test.ts` は旧実装(`canConnect`)
    だと2つ目の `startCollector` が先発collectorへの接続成功で誤って
    resolve し `rejects.toThrow` が失敗する構造であり、「修正前のバグを
    実際に検出できるテスト」という報告と整合する(実装の詳細をなぞる
    だけの無意味なテストではない)。
  - `e2e-lock.ts` のエラー握りつぶし箇所(unlink競合・readIfExists)は
    いずれも理由コメント付きで安全側に倒しており問題なし。stale回収の
    稀な競合が残る点は本人がWORKLOGに明記済みで許容範囲と判断。
  - `pnpm lint` / `pnpm build` / `pnpm test`(collector 330・frontend 301・
    e2eユニット33)の全通過を確認した。`packages/shared` の変更は無し。
    境界侵犯・チェーン固有語彙の漏れも無し。CONTRIBUTING.md の記述は
    実装と一致。
- 決定事項・注意点(コミット前の推奨対応):
  - `collector.ts` の `waitForOwnProcessToListen` が `exit` イベントで
    判定しているが、Node の `exit` は stdio の flush 完了を保証しない
    ため、稀に EADDRINUSE の stderr 到着前に `crashed`(ログ不完全)と
    誤判定し、回帰テストの `/EADDRINUSE|同時に複数実行/` 照合が flake
    する可能性がある。`close` イベント(stdio クローズ後に発火)への
    変更を推奨。
  - `e2e-lock.ts` の stale 回収リトライ上限到達時に
    `formatUnparsableLockError`(「解析できませんでした」)を投げるが、
    この経路は解析はできている(競合が続いた)ため文言が実態と合わない。
  - `e2e-lock.unit.test.ts` のテスト名 typo(「フィールード」)。
  - #64 の実装記録がWORKLOG末尾に追記されているが、直近の記録は
    新しいものを上に置く並びになっているため、冒頭側への移動を推奨。
  - 未コミットのため、コミット時は関心事ごとの分割(起動判定+回帰
    テスト / 排他ロック+globalSetup配線+ユニットテスト / docs)を守る
    こと。
  - `pnpm test:e2e` の実機実行は行っていない(chainviz-qa の担当)。

### 2026-07-04 Issue #64 test:e2e 複数worktree同時実行時のcollectorポート奪い合い対策(collector)

- 担当: collector
- ブランチ: issue-64-e2e-port-collision
- 内容:
  - `packages/e2e/src/helpers/collector.ts` の `startCollector` を、
    「ポートに接続できるか」ではなく「自分が起動した子プロセス自身が
    実際にそのポートを listen したか」で起動成功を判定する方式に変更した。
    判定ロジックは純粋関数として `packages/e2e/src/helpers/
    collector-launch.ts` に分離し(`detectLaunchStatus` / `portInUseMessage` /
    `crashedMessage`)、子プロセスの標準出力・標準エラーの蓄積ログに
    `[collector] WebSocket server listening on port <port>` が出れば
    `listening`、`EADDRINUSE` を含めば `portInUse`、それ以外で終了して
    いれば `crashed` と判定する。`portInUse` はポーリングでタイムアウトを
    待たせず即座に明確なエラー(別プロセスとの同時実行の可能性を明記)で
    失敗させる。旧実装が使っていた WebSocket 接続確認(`canConnect`)は
    削除した(別プロセスが同じポートで listen 済みだと、自分の子プロセスが
    EADDRINUSE で即死していても誤って「起動できた」と判定してしまう根本
    原因だったため)。
  - ホスト単位の排他ロックを追加した(`packages/e2e/src/helpers/
    e2e-lock.ts`)。`os.tmpdir()` 配下の固定パス
    (`chainviz-test-e2e.lock`。worktree ごとに異なるリポジトリ絶対パスに
    依存せず、同一ホスト・同一ユーザーであれば worktree をまたいで共有
    される)にロックファイルを作り、PID・ホスト名・取得時刻を記録する。
    既に他プロセスが保持しており、かつそのプロセスが生きていれば
    (`process.kill(pid, 0)` で確認)、PID・ホスト名・開始時刻を含む明確な
    エラーで即座に失敗する。保持プロセスが既に死んでいる(stale)場合は
    安全とみなして削除のうえ取得し直す。この排他ロックは `vitest` の
    `globalSetup`(`packages/e2e/src/helpers/global-setup.ts`。
    `vitest.config.ts` に配線)経由で `test:e2e` 実行全体(全テストファイル
    共通)に対して1回だけ取得・解放する。collector 起動判定の修正だけでは
    「2つの test:e2e が同時に docker compose スタックを操作し合う」問題
    までは防げないため、実行そのものを先着1本に制限する狙い。
  - `docs/CONTRIBUTING.md` の「test:e2eは同時に複数実行しない」という
    注意書きを、実装した排他ロックの挙動(先着が勝ち、後着は明確なエラーで
    即座に失敗する。stale ロックの自動回収)に合わせて更新した。
  - 回帰テスト `packages/e2e/src/collector-port-collision.test.ts` を
    追加した。実際に同じポートへ collector を2つ起動させ、2つ目が
    `EADDRINUSE` 系のエラーで(30秒のタイムアウトを待たず)数百ms程度で
    即座に失敗すること、1つ目の起動には影響しないことを確認する。
    このテストが実際に元の不具合を検出できることを、修正前のコード
    (`canConnect` ベース)に一時的に戻して実行し、2つ目の `startCollector`
    が誤って `resolve` してしまう(＝バグの再現)ことを確認したうえで、
    修正後のコードに戻して再度パスすることを確認済み。
  - 上記2ファイルの純粋ロジック部分(`collector-launch.ts` /
    `e2e-lock.ts`)にはそれぞれ `*.unit.test.ts` を追加し、`pnpm test`
    (docker 不要)で高速に検証できるようにした。実 fs を使うロックの
    テストは一意の一時ディレクトリを使い、実行中の本物のロックパス
    (`os.tmpdir()` 固定パス)には触れないようにしている。
- 動作確認:
  - `pnpm build` / `pnpm --filter @chainviz/e2e build`(tsc --noEmit)/
    `pnpm test`(collector・e2eの新規ユニットテストを含め全て成功)を確認。
  - 実際に2つの `pnpm test:e2e` を同時実行し、1本目は通常どおり
    (実docker chain + 実collectorで)全20テスト成功、2本目は
    globalSetup 内のロック取得で0.6秒程度で失敗し、1本目のPID・ホスト名・
    開始時刻を含むエラーメッセージが出ることを確認した。1本目終了後は
    ロックファイルが自動的に削除されていることも確認した。
  - 検証は実行前に `ps aux | grep vitest` で他の vitest プロセスが動いて
    いないことを確認してから行った。
- 決定事項・注意点:
  - `packages/shared` の型変更は不要だった。
  - ロックファイルのパスはリポジトリ内ではなく `os.tmpdir()` の固定名に
    した。worktree ごとに `repoRoot` が異なるため、リポジトリ内パスだと
    worktree をまたいだ排他ができない。同一ホスト・同一ユーザーの前提が
    崩れる環境(例: 各 worktree が別コンテナ/別ホストで動く CI)では
    このロックは機能しない点に注意(現状の運用ではホスト共有が前提)。
  - stale ロックの自動回収は「同時に2プロセスが同時に stale と判断し
    削除→再作成し合う」極めて稀な競合を完全には排除していない(通常の
    開発ワークフローでは許容範囲と判断した)。
  - このIssueは Issue #58 のレビュー中に発覚した不具合で、docs/PLAN.md の
    既存チェックボックスには対応しない(Issue #63 と同様の扱い)。そのため
    PLAN.md の変更は行っていない。
  - コミット・push・PR作成は行っていない(統括の指示により、
    chainviz-reviewer・chainviz-qa を経てからまとめて実施する)。
### 2026-07-04 Issue #43 QA検証(qa)

- 担当: qa
- ブランチ: issue-43-beacon-restart-divergence
- 内容: `restart-node.sh`追加とREADME追記(node-env、reviewer合格済み)を
  実機で検証した。結果は合格。バックログ項目でありPLANの専用チェックボックスは
  無い(node-envが該当行を[x]済み)。
- 検証手順と結果:
  1. `docker compose down -v && up -d`でクリーン起動。7サービスすべてrunning、
     ブロックが約2秒に1つ進行、`cast chain-id`=1337・`cast client`(reth
     v2.3.0)でRPC疎通を確認。
  2. 問題再現: `docker compose restart beacon1 beacon2`(beacon単独再起動)で
     block=24のまま60秒以上完全停止。beacon1ログに`Exec engine unable to
     produce payload`/`PayloadIdUnavailable`(the engine is likely syncing)が
     継続することを確認。想定どおりの再現。
  3. 停止状態からの復旧: `./scripts/restart-node.sh 1 2`でノード単位再起動を
     実行し、チェーンがgenesisから進行を再開(block=24超え)することを確認。
  4. 軽量な自己回復の実効性(レビュー指摘): healthy状態(block=36)から
     `./scripts/restart-node.sh 1`でノード1のみ再起動しノード2は稼働継続。
     reth2は一度も停止せず進行継続(37→100超)、reth1はgenesisから再同期して
     着実にブロックを取り込み追従再開。項目2の完全停止とは明確に異なり、
     もう片方を止めずに自己回復することを確認。
     - 補足(非ブロッキング): 再起動したreth1はP2P再同期のラグで先行ノードに
       約32ブロック遅れで安定追従する(reth本来のステージド同期の挙動)。
       停止ではなく着実に取り込み続けており不具合ではない。
  5. エラーハンドリング: 引数なし・`abc`・混在`1 x`・空文字`''`・小数`1.5`の
     いずれも、stderrへ明確なエラーメッセージを出しexit=1で終了。サイレントに
     無反応になることはない。混在ケースは検証段階で全引数を弾くため、
     正しい引数側(node1)を部分的に再起動しない安全な設計であることも確認。
  6. `pnpm lint` / `pnpm build` / `pnpm test`(collector 330・frontend 301、
     すべて成功)。
- 検証後、`profiles/ethereum`をクリーンな`docker compose down -v && up -d`済みの
  状態に戻した(ブロック進行を再確認済み)。

### 2026-07-04 Issue #43 レビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-43-beacon-restart-divergence
- 内容: node-env の対応(restart-node.sh 追加 + README 追記)を静的レビュー
  した。結果は合格。
  - 方針判断: reth 側の自動回復ロジックを見送り、誤操作を構造的に防ぐ
    運用スクリプト + ドキュメント整備に留めた判断は、「先回り実装をしない」
    方針・過剰な作り込みを避ける方針に照らして妥当。ノード番号のみを
    受け付けて reth/beacon/validator の3点セットに機械的に展開する設計は、
    beacon 単独再起動という誤操作自体を不可能にしており適切。
  - スクリプト実装: `set -e`・引数の数字検証(空文字/非数字は stderr へ
    エラーを出して exit 1)・`exec docker compose restart` による終了コードの
    素通し、いずれもエラーの握りつぶしなし。展開する `$services` は数字
    検証済みの値のみで構成されるため、意図的な単語分割も安全。
  - README 追記: reth-node.sh(`rm -rf /data/*`)・lighthouse-bn.sh
    (`find /data -mindepth 1 -delete`)の実際の初期化処理と記述が一致。
    参照している「genesis の扱い」「P2P 接続について」の各節も実在する。
  - `pnpm lint` / `pnpm build` / `pnpm test`(301 tests)すべて成功。
    TypeScript パッケージへの変更はなくテスト追加義務の対象外。
    docs/ARCHITECTURE.md はプロファイル内スクリプトを列挙していないため
    齟齬なし。
- 決定事項・注意点(いずれも非ブロッキングの申し送り):
  - スクリプトは compose 定義済みサービス(reth1/2 等、または README の
    手順で compose に追記した reth3 以降)専用。collector の addNode で
    動的に追加したフォロワーノード(compose サービスではなく validator も
    持たない)には使えないが、その場合 `docker compose restart` が
    "no such service" で明示的に失敗するため事故にはならない。
  - スクリプトは profiles/ethereum をカレントディレクトリとして実行する
    前提(ヘッダコメント・README に明記済み)。別ディレクトリから実行した
    場合も compose が設定ファイル未発見のエラーで明示的に失敗する。
  - コミット時は「feat: スクリプト追加 + README 追記」と「docs: PLAN/
    WORKLOG 更新」を分ける想定でよい。

### 2026-07-04 Issue #43 beacon単独再起動によるEL/CL乖離への対応(node-env)

- 担当: node-env
- ブランチ: issue-43-beacon-restart-divergence
- 内容: `profiles/ethereum`で実機再現・検証した結果、以下の対応を行った。
  - `profiles/ethereum/scripts/restart-node.sh`を追加した。ノード番号を
    引数に取り、対応する`reth<N> beacon<N> validator<N>`をまとめて
    `docker compose restart`するホスト側の運用スクリプト(コンテナには
    マウントしない)。beaconだけを再起動する誤操作を防ぐため、素の
    サービス名ではなくノード番号を受け取り、reth/beacon/validatorの
    3点セットへ機械的に展開する設計にした。
  - `profiles/ethereum/README.md`に「一部のサービスだけを再起動するとき」
    節を追加し、beacon単独再起動が禁止である理由・上記スクリプトの
    使い方・最終手段としての`down`→`up`を明記した。
- 検討過程: `reth-node.sh`/`lighthouse-bn.sh`のいずれも起動のたびに
  データディレクトリを初期化してgenesisからやり直す設計になっており、
  これは新規ノード追加(addNode)を含む本プロファイル全体の前提になっている。
  そのため「reth側でsyncing検知時に自動回復動作を行う」という案(選択肢1)は、
  正常系(単に同期に時間がかかっている状態)との区別が難しく、下手に自動で
  データ初期化等を行うと別の事故を誘発しかねないため見送った。「対応しない」
  という判断(選択肢3)も検討したが、実機確認で新たに次の点が判明したため、
  軽量な運用スクリプトを追加する方が実利があると判断した:
  - reth+beaconを**ノード単位でセットにして**再起動すれば、既存の
    EL/CL間P2P(Issue #44)による自動バックフィルで自己回復する
    (もう片方のノードを止めずに済む)。これは`down`→`up`より遥かに
    軽量な復旧手段であり、既存ドキュメント(WORKLOG Issue #41)には
    このノード単位再起動が有効という情報が無かった。
  - README.mdにはこの問題・回避策が一切記載されておらず(WORKLOGにのみ
    記録されていた)、運用者向けドキュメントとして不十分だった。
- 実機確認:
  - クリーンな`docker compose up -d`後、`docker compose restart
    beacon1 beacon2`で問題を再現した(`cast block-number`が60秒以上
    停止し続け、beaconログに`Exec engine unable to produce payload:
    the engine is likely syncing`相当のエラー`PayloadIdUnavailable`が
    継続することを確認)。
  - ノード群6サービスをまとめて再起動(`reth1 reth2 beacon1 beacon2
    validator1 validator2`)すると復旧することを確認(既存ドキュメント
    どおり)。
  - 片方のノード(`reth1 beacon1 validator1`、または`reth2 beacon2`のみ)
    だけを再起動し、もう片方は動かしたままにした場合も、EL/CL間P2Pに
    よるバックフィルで数十秒以内に自己回復することを確認(beacon2の
    ログで`finalized_epoch`が進み`exec_hash`が`verified`になることで
    追従再開を確認)。
  - `restart-node.sh`を実際に使い、`beacon1 beacon2`単独再起動で停止させた
    状態から`./scripts/restart-node.sh 1 2`で復旧することを確認した。
    引数なし・数字以外を渡した場合にエラーメッセージを出して終了する
    ことも確認した。
  - 最後にクリーンな`docker compose down -v && up -d`でも従来どおり
    起動・進行・`cast`疎通することを確認した。
- 決定事項・注意点: `reth-node.sh`/`lighthouse-bn.sh`自体には手を入れて
  いない(コンテナ起動時の初期化ロジックは変更なし)。`restart-node.sh`は
  host側のみで完結する追加ファイルであり、既存の compose 構成・
  ノード追加(addNode)フローには影響しない。
### 2026-07-04 Issue #65 起動時のmanagedコンテナ回収とレジストリ再構築のQA検証(qa)

- 担当: qa
- ブランチ: issue-65-managed-recovery
- 内容: 実環境(profiles/ethereumをdocker compose upで起動)と実collector
  (dist/index.js)を用いて、クラッシュ後の回収シナリオを実機で検証した。
  手順: (1)collector起動→addNodeでreth3+beacon3ペアを作成(managedラベル
  付与を確認)、(2)collectorのnodeプロセスをkill -9で強制終了(クラッシュ
  模擬。managedコンテナはプロセス消滅後も存続することを確認)、(3)collector
  再起動、(4)再起動後のプロセスでremoveNode("chainviz-ethereum/reth3")を
  実行し成功(ok:true)。単一のremoveNodeでreth3・beacon3の両方が削除され、
  ペアとして回収されていたことを確認した。修正前はメモリ上レジストリに
  無いため拒否されるシナリオであり、回収処理が機能していることを確認した。
  既存のcompose起動ノード(reth1/reth2/beacon1/beacon2/validator類/workbench)は
  回収・削除処理の影響を受けず全て稼働継続していた。
  uncaughtException方針の変更は、dist実物のinstallProcessSafetyNetを
  読み込む独立スクリプトで検証: unhandledRejectionはログ出力後もプロセス
  継続、uncaughtExceptionはログ出力後にprocess.exit(1)で終了することを
  実際の終了コード=1で確認した。
  静的確認として `pnpm lint`(exit 0)、`pnpm build`(exit 0)、
  `pnpm test`(collector 350件・frontend 301件ほか全パス, exit 0)も確認した。
- 判定: 合格。Issue #65の期待動作(クラッシュ後の回収、回収ノードの削除可能、
  既存ノードへの非影響、uncaughtException時のプロセス終了)をすべて実機で満たす。
- 決定事項・注意点: 本Issueはdocs/PLAN.mdのチェックボックスに紐づかないため
  PLAN.mdへのチェック付与は不要。検証後はテスト用コンテナをremoveNodeで削除
  済みで、profiles/ethereumは`docker compose down -v`でクリーンな状態へ戻し、
  collectorプロセスも停止した。検証開始時、profiles/ethereumは起動しておらず
  (コンテナ0個)、本検証のためにQA側で起動した点に留意。
### 2026-07-04 Issue #68 WebSocket接続ごとのerrorリスナー(qa)

- 担当: qa
- ブランチ: issue-68-ws-error-listener
- 内容:
  - 実装を実際に動かして検証した。このIssueはdocs/PLAN.mdのチェック
    ボックスに紐づかないため、実動作をもって合否を判定した。合格と判断。
  - 静的確認: `pnpm lint` / `pnpm build` / `pnpm test` すべて通過
    (collector 333件・frontend 301件、websocket-server.test.ts 20件)。
  - 動作確認: ビルド済みdistのCollectorServerを実際に起動し、意図的に
    installProcessSafetyNet()を張らない状態(errorリスナーが無ければ
    未処理'error'でプロセスがクラッシュする条件)で以下を確認した。
    (1) クライアントAが接続しスナップショットを受信。生ソケットに不正な
    (マスクなし)WebSocketフレームを注入してサーバー側にソケットエラー
    (WS_ERR_EXPECTED_MASK)を発生させた。(2) onConnectionのerrorリスナー
    が発火し、`[collector] websocket connection error:`として発生源つきで
    ログに残った。(3) collectorプロセスは同一pidのまま生存し続けた。
    (4) その後に別のクライアントBを接続し、commandを送ると
    commandResult(ok:true)が正常に返り、1接続のエラーが他接続に影響
    しないことを確認した。
  - 反証確認: 同じ不正フレーム注入を、onConnectionでerrorリスナーを
    張らない素のWebSocketServer(修正前の状態を模擬)に対して行うと、
    未処理'error'イベントでプロセスがクラッシュ(exit 1)することを確認。
    本修正が実際に必要な問題を塞いでいることを裏付けた。
- 決定事項・注意点:
  - TCPの単純なRST(resetAndDestroy)ではサーバー側で'error'が発火せず
    (クリーンなclose扱いになる)ログに残らなかった。ソケットレベルの
    'error'を確実に起こすには不正フレーム注入が有効だった。手動での
    再現時の参考として記録する。
  - 検証に使った一時スクリプトは削除済み。ワークツリーはクリーン。

### 2026-07-04 Issue #68 WebSocket接続ごとのerrorリスナー(reviewer)

- 担当: reviewer
- ブランチ: issue-68-ws-error-listener
- 内容:
  - Issue #68(接続単位のerrorリスナー追加、listen()後のwssエラー監視、
    ServerLogger注入)の静的レビューを実施。`pnpm lint` / `pnpm build` /
    `pnpm test`(collector 333・frontend 301、websocket-server.test.ts は
    20件)すべて通過。合格と判断した。
  - 接続単位のリスナー: `onConnection` 冒頭で `ws.on("error", ...)` を
    張り、発生源つきでログに残す。握りつぶしではなくエラー本体を
    ログへ渡しており、#63 の安全網(installProcessSafetyNet)を
    「どのハンドラにも紐づかない背景エラーの最後の砦」に保つ設計意図
    (#59 レビュー時の指摘)と整合する。
  - listen() の付け替え: `once("error", reject)` → listening 発火時に
    同期的に removeListener + 恒久ログハンドラへ切り替えるため、
    エラーが未監視になる時間窓は存在しない。listening 前のエラーは
    従来どおり reject される。
  - ServerLogger 注入: `(message, detail)` 形式で
    installProcessSafetyNet の log 引数・startPollingLoop の onError と
    同じ既存パターン。省略時 console.error のオプショナル引数で
    呼び出し側(index.ts)の変更も不要。shared の型変更なしは妥当。
  - テストの質: 3件とも壊れたコードで落ちることを確認した。
    (1) リスナー未登録なら emit("error") が EventEmitter 規約で throw
    して失敗する。(2) 片方の接続のエラー後も他クライアントへの
    broadcastDiff が届くことを検証。(3) 旧実装(once の reject が残る)
    では throw しないがログに残らないため `logged.toContain` で失敗する。
    3件目が「reject 済み promise への握りつぶし」を正しく判別できている。
- 決定事項・注意点:
  - 非ブロッカーの推奨: listen() の起動時エラー経路(ポート衝突で
    reject)は今回の付け替えで構造が変わったが、対応するテストが
    従来から存在しない。同一ポートで2回 listen して reject を確認する
    テストの追加を chainviz-tester に推奨する。
  - テストが private フィールド `wss` へキャストでアクセスしている点は、
    サーバー側ソケットに error を注入する手段が他にないため許容。
  - 変更は未コミット。実装とテストは同一の関心事なので1コミットで
    まとめてよい(CLAUDE.md「テストは同じ変更の中で書く」)。

### 2026-07-04 Issue #59 E2E再接続シナリオのQA検証(qa)

- 担当: qa
- ブランチ: issue-59-e2e-reconnect
- 内容: 実環境(profiles/ethereum、稼働中)+実collectorに対し
  `pnpm test:e2e`を実行し、全20件(既存15件+新規5件)成功を確認した。
  再接続時のスナップショット整合性、追加ワークベンチの削除、複数
  クライアント同時接続時の差分配信、接続直後のコマンド取りこぼし無し、
  未接続クライアントへのsendCommand即時拒否、いずれも実データで確認。
  `pnpm lint && pnpm build && pnpm test`(pre-pushフック対象)にE2Eが
  混入しないことも確認。実行前に他worktreeでのtest:e2e同時実行が無い
  ことを確認済み(#64のポート奪い合い回避)。
- 決定事項・注意点: `docs/PLAN.md`の#58・#59チェックボックスに重複・
  欠落が無いことを確認した。差し戻しなし。

### 2026-07-04 Issue #59 E2E再接続シナリオのレビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-59-e2e-reconnect
- 内容:
  - Issue #59(E2E再接続シナリオ)の静的レビューを実施。`pnpm lint` /
    `pnpm build` / `pnpm test`(shared 2・collector 330・frontend 301・
    e2e 14 件)はすべて通過。実行前に `ps aux` で他 worktree の vitest
    同時実行がないことを確認した(#64 のポート奪い合い回避)。
  - `reconnect.test.ts` の5シナリオ、および `ws-client.ts` の
    `connect()` での `snapshotReceived` リセット修正を確認。リセットの
    影響範囲は `connect()` 内の「最初の snapshot」判定のみで、他の
    呼び出し箇所(harness.ts)は接続1回のため影響なし。再接続時は
    `applySnapshot` がエンティティ/エッジの Map をクリアするため古い
    状態も残らない。修正は妥当と判断した。
  - テストの質: シナリオ1(再接続後スナップショット整合性)は修正前の
    ヘルパーではタイムアウトで失敗する(壊れたコードで通らない)こと、
    シナリオ2(複数クライアント差分配信)は送信者だけに差分を返す誤実装
    では B 側の waitForState が失敗することを確認。待機はすべて
    タイムアウト上限つきポーリングで、環境の現在値への決め打ち依存なし。
- 決定事項・注意点:
  - **個別接続の error リスナー欠如(collector からの報告)は「直すべき」と
    判断**。理由: (1) `installProcessSafetyNet` のコメント自身が安全網を
    「どのハンドラにも紐づかない背景の非同期エラーだけを受け止める最後の
    砦」と定義しており、発生源が特定できている接続ソケットの error を
    恒常的に安全網へ流すのはこの設計意図と矛盾する。(2) error リスナー
    未登録のまま throw → uncaughtException で受けると、ws 内部の
    クリーンアップ処理を含む呼び出しスタックが中断され、ソケットの
    後始末が不完全になり得る(長時間稼働の collector でのリーク要因)。
    (3) `CollectorServer` の健全性が index.ts のグローバルハンドラに
    暗黙依存する見えない結合になっており、安全網のないユニットテスト
    実行時は ECONNRESET 等でテストワーカーごと落ちるフレークの芽になる。
    ただしサイレント握りつぶしではなく実害も未発生のため #59 の合否には
    影響させない。`onConnection` での `ws.on("error", ...)` によるログ
    出力+対応ユニットテストを、本ブランチとは別の関心事として収集悟に
    依頼する(あわせて `listen()` 後の wss 自体の error が `once` のみで
    listening 後は未監視である同種の点も確認を推奨)。
  - 軽微な指摘(非ブロッカー): シナリオ「追加したワークベンチを削除でき、
    観測から消える」は再接続とは無関係の後片付けの test 化で
    commands.test.ts と重複気味(後片付けの成否を明示検証する意図として
    許容)。「未接続クライアントへの sendCommand 拒否」は collector では
    なくテストヘルパーの契約の検証(ヘルパーがサイレント無視しない保証
    として許容)。
  - 既存問題の発見: `ws-client.ts` は複合キーの区切りにリテラルの NUL
    文字を含んでおり、git が binary 扱いにして diff がレビューできない。
    今回の変更由来ではないが、`"\u0000"` エスケープへの置換を別途推奨。
  - まだ未コミットのため、コミット時は「ヘルパー修正」「テスト追加」
    「docs 更新」の関心事ごとにコミットを分けること。

### 2026-07-04 Issue #59 E2E に再接続・複数クライアントシナリオを追加(collector)

- 担当: collector
- ブランチ: issue-59-e2e-reconnect
- 内容:
  - `packages/e2e/src/reconnect.test.ts` を新規追加(テスト5件)。
    - 再接続時のスナップショット整合性: クライアントを接続→切断し、切断中に
      別経路(共有クライアント)で addWorkbench した変更が、同一クライアントの
      再接続後の新しいスナップショットに反映されることを確認する(古い状態の
      まま止まらないこと)。続けて removeWorkbench で消えることも確認。
    - 複数クライアント同時接続時の差分配信: クライアント A・B を同時接続し、
      A が送った addNode の entityAdded 差分が B にも配信され、B が送った
      removeNode の entityRemoved 差分が A にも配信されることを確認する。
    - 接続シーケンスのタイミング異常系: WebSocket open 直後(snapshot 受信を
      待たず)に最初のフレームとしてコマンドを送っても取りこぼされず
      commandResult が返ること、および未接続クライアントへの sendCommand が
      サイレント無視されず即座に拒否されることを確認する。
  - `packages/e2e/src/helpers/ws-client.ts` の `connect()` を修正。接続のたびに
    `snapshotReceived` をリセットするようにした。従来は 2 回目以降の connect()
    が「最初の snapshot」判定に永久に一致せず解決しなかったため、同一
    クライアントインスタンスでの切断→再接続が表現できなかった。
- 決定事項・注意点:
  - 再接続テストの操作にはワークベンチを使った。差分/スナップショットの生成
    経路はコマンド種別に依らず共通であり、addNode/removeNode 固有の実データ
    追従は commands.test.ts が別途検証しているため。複数クライアント差分配信
    テストは指示どおり addNode/removeNode で検証した。
  - 実行結果: `pnpm test:e2e` は全 20 件(既存 15 + 新規 5)成功(所要
    約499秒)。実行前に `ps aux | grep vitest` で他プロセスの同時実行が
    ないことを確認(#64 のポート4123奪い合い回避)。e2e のユニットテスト
    (`pnpm --filter @chainviz/e2e test`)も 14 件成功。
  - エラーハンドリング握りつぶし調査(websocket-server.ts / ws-client.ts):
    握りつぶしによる実害は確認されなかった。詳細は下記のとおり。
    - `onMessage` の JSON.parse 失敗時 return・非 command type の無視は
      仕様どおり(不正フレームには返信しない)で、error-paths.test.ts が
      「不正フレーム後も後続コマンドを処理できる」ことを検証済み。
    - `ws.on("message", (data) => void this.onMessage(...))` は onMessage が
      reject した場合に unhandled rejection になりうるが、現状の
      CommandHandler.handle() は全例外を捕捉して commandResult(ok:false) を
      返すため reject しない。仮に reject しても index.ts の
      installProcessSafetyNet(#63) がログに残してプロセスを維持するため、
      サイレントには消えない。
    - 個々の接続 ws に error リスナーが張られていない(onConnection)。ソケット
      レベルの error は上記の安全網(uncaughtException)がログに残して受け止め
      るため、サイレント握りつぶしにもクラッシュにもならない。潜在的な設計の
      改善余地(接続単位の error ハンドラ)ではあるが、実害がなく判断に迷う
      ため今回は変更せず報告に留めた。

### 2026-07-04 Issue #63 コンテナ削除競合対策の実機検証(qa)

- 担当: qa
- ブランチ: issue-63-teardown-race
- 内容:
  - 実 Docker(profiles/ethereum の稼働中スタック)+ ビルド済み collector を
    子プロセスとして起動し、実際に動かして 409 競合の解消を検証した。
  - 静的確認: `pnpm lint`(クリーン)/ `pnpm build`(全4パッケージ成功)/
    `pnpm test`(collector 329・frontend 301 すべて通過)。
  - E2E: `pnpm test:e2e` 全9テスト成功(所要 約302秒)。他 worktree で
    vitest/test:e2e が動いていないことを事前に確認してから実行(#64 の
    ポート奪い合い回避)。最重要の「追加 reth が既存チェーンへブロック追従」
    (約244秒)も含め合格。
  - 409 競合の直接再現: addWorkbench / addNode で作成したコンテナに対し、
    同一 workbenchId / nodeId への removeWorkbench / removeNode を6並行で送信。
    修正後はいずれも全6件 ok:true を返した。collector ログには対象コンテナ
    ごとに「removal already in progress; treating as removed」warn が
    (勝者1を除く)5件ずつ出ており、良性の 409 が成功相当に畳まれていることを
    実ログで確認。unhandledRejection / uncaughtException のログは出ず、
    テスト中も collector プロセスは生存し続けた。
- 決定事項・注意点:
  - removeNode は consensus(beacon)→ execution(reth)の2コンテナを順に削除する
    ため、6並行 removeNode では beacon・reth の各コンテナで5件ずつ 409 が畳まれる
    (計3コンテナ分の warn を確認)。同一 ID への並行削除は node-lifecycle が
    findIndex→await の間に同じ containerId を捕捉するため、同一コンテナへ複数の
    remove が重なる = 本 Issue が想定する競合を確実に再現できる。
  - 検証後、テスト用に追加した managed コンテナはスクリプト内の
    removeNode/removeWorkbench ですべて削除され、`com.chainviz.managed=true` の
    残存は0件。profiles/ethereum の compose スタックは検証前から稼働していた状態を
    維持している(停止していない)。
  - 本 Issue は docs/PLAN.md のチェックボックスに紐づかないため、チェックの付与は
    なし。実機での 409 解消・E2E 安定動作をもって合格と判断した。

### 2026-07-04 Issue #63 コンテナ削除競合対策のレビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-63-teardown-race
- 内容:
  - collector の修正(409「削除進行中」の成功相当化 + プロセス安全網)を静的レビュー。
    `pnpm lint` / `pnpm build` / `pnpm test`(collector 329・frontend 301)すべて通過を確認。
    実環境での動作検証(E2E含む)は qa に委ねる。
  - 409 ハンドリング: `isRemovalInProgress` は statusCode 409 かつメッセージが
    「removal of container ... is already in progress」の場合だけを成功相当に畳み、
    無関係な 409 は従来どおり伝播させる実装であることを確認。仮に Docker 側の
    メッセージ文言が将来変わっても「修正前の挙動(ok:false)に戻るだけ」で安全側に
    倒れる点も良い。対応するユニットテストは正常系(warn ログ含む)・無関係 409 の
    伝播の両方をカバーしており、修正前のコードでは失敗する意味のあるテストになっている。
  - CommandHandler が全コマンド経路で例外を commandResult(ok:false) に変換している
    こと、node-lifecycle が「削除成功後に登録を外す」順序で再実行安全であることも
    合わせて確認した。
- 決定事項・注意点:
  - `installProcessSafetyNet` が uncaughtException 後もプロセスを維持する設計は、
    「監視・自動再起動が無く、プロセス消滅 = managed コンテナ全孤児化」という現状の
    制約下では**暫定策として妥当**と判断する。Node.js の一般的な推奨(uncaughtException
    後は再起動)から外れることは実装コメント・WORKLOG に明記されており、握りつぶしでは
    なく必ずログに残す実装になっている。ただしこれは恒久策ではない。
  - 恒久策として「collector 起動時に `com.chainviz.managed` ラベルで既存 managed
    コンテナを回収してレジストリを再構築する」をバックログ Issue 化することを推奨する
    (ラベルは既に全 managed コンテナへ付与済みで実現可能。collector 再起動で追加ノードが
    UI から削除不能になる既存の問題も同時に解消する)。回収の仕組みが入った後は、
    uncaughtException の方針を「ログ + 終了(fail-fast)」へ見直すべきである。
    ファイルベースの永続レジストリ案は、Docker 側の実態(ラベル)と二重管理になるため
    ラベル回収方式を推す。
  - コミットはレビュー時点で未実施。「1変更1コミット」に従い、(1) 409 ハンドリング
    (dockerode-operations + 対応テスト2ファイル)、(2) プロセス安全網(index.ts + テスト)、
    (3) docs(WORKLOG) の3コミットに分けること。

### 2026-07-04 Issue #63 コンテナ削除競合(HTTP 409)によるクラッシュと孤児蓄積の対策(collector)

- 担当: collector
- ブランチ: issue-63-teardown-race
- 内容:
  - `stopAndRemove`(dockerode-operations.ts)で、`remove({force:true})` が
    HTTP 409「removal of container ... is already in progress」を返した場合を
    成功相当として扱うようにした。既存の 404(削除済み)扱いに `isRemovalInProgress`
    による 409 判定を追加し、進行中である旨を `console.warn` に残したうえで
    正常終了させる。メッセージが「削除進行中」でない 409 は良性の競合ではない
    ため従来どおり例外を伝播させる。
  - collector プロセス起動時に安全網(`installProcessSafetyNet`, index.ts)を張り、
    どのハンドラにも紐づかない背景の非同期エラー(`unhandledRejection` /
    `uncaughtException`)でプロセス全体が落ちないようにした。検知した内容は
    必ずログに残す(握りつぶさない)。collector は managed コンテナの参照を
    メモリ上のレジストリだけで保持しているため、プロセスが落ちると作成済み
    コンテナがすべて孤児になる。この連鎖を断つのが目的。
  - 対応するユニットテストを追加(409 を成功相当に扱う/無関係な 409 は伝播
    させる/安全網が例外内容をログしプロセスを落とさない、など)。
- 原因の切り分け:
  - 現象を実 Docker で再現。稼働中の profiles/ethereum に対し collector を起動し、
    同一 workbenchId へ removeWorkbench を 4 本同時送信すると、修正前は 3 本が
    409(「removal of container ... is already in progress」)で ok:false を返して
    いた(削除自体は別の 1 本が完了させるため、本来はすべて成功扱いにできる)。
    修正後は 4 本とも ok:true になることを確認した。
  - CommandHandler は addNode/removeNode/addWorkbench/removeWorkbench の全経路で
    例外を try/catch し commandResult(ok:false) へ変換しており、コマンド経路から
    409 がそのまま未捕捉で漏れる箇所は無いことを確認した。したがって 409 は
    まず「本来消えるコンテナに対する不要なコマンド失敗」を生む問題であり、
    これを発生源(stopAndRemove)で成功相当に畳むのが主対策。
  - E2E を連続実行した際に一度だけ collector の WebSocket が切れる(プロセスが
    落ちる)不安定さを観測したが、同条件を単体で確定再現することはできなかった。
    背景の非同期エラー(Docker/WS ソケットで状態遷移中に遅れて発火する類)が
    プロセスを落とし得るため、上記の安全網で「落とさずログに残す」方針を採った。
    これは長時間稼働するデータ収集プロセスとして、1 コマンドの失敗より孤児の
    連鎖蓄積の方が被害が大きいという判断による。
- 検証:
  - collector パッケージ: `pnpm build` / `pnpm test`(329 tests)通過。`pnpm lint` 通過。
  - `pnpm test:e2e` を連続 3 回(back-to-back を含む)実行し、いずれも 9/9 通過。
    back-to-back 実行後に managed ラベルの孤児コンテナが残っていないことも確認。
- 注意点・申し送り:
  - `installProcessSafetyNet` は `uncaughtException` も含めてプロセスを維持する
    設計にしている。一般には uncaughtException 後は状態不整合の懸念から再起動が
    推奨されるが、本 collector には監視・再起動の仕組みが無く、落ちると managed
    コンテナが即孤児化する。ここは「落ちるより維持してログを残す」を選んだ判断で
    あり、方針の是非はレビューで議論の余地がある。
  - より根本的には、collector が作成した managed コンテナを永続レジストリ化する、
    もしくは起動時に `com.chainviz.managed` ラベルで既存コンテナを回収する仕組みが
    あれば、プロセス再起動時の孤児化そのものを無くせる(本 Issue の範囲外。別途
    バックログ化を推奨)。

### 2026-07-04 Issue #56 genesis 冪等化のレビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-56-genesis-idempotent
- 内容: 構築初による genesis サービスの冪等化(完了マーカー方式)を静的に
  レビューした。結果は合格。
  - 完了マーカーの設計を確認。`set -e` の下で全生成処理が成功した最後にのみ
    `touch` するため、途中失敗した実行はマーカーを残さず次回やり直しになる。
    マーカー検出は破壊的な `rm -rf` より前に行われるため、稼働中スタックへの
    `up -d` 再実行で共有ボリューム上の genesis が消される瞬間が無いことも確認。
  - マーカー検出時の `exit 0` はエラーの握りつぶしではなく意図した冪等動作で
    あり、スキップした旨と作り直し手順(`down -v`)をログに明示している。
  - マーカーは名前付きボリューム内(`/data/.genesis-complete`)にあるため、
    `docker compose down -v` でボリュームごと消え、クリーン起動時の再生成
    挙動は保たれている。
  - `docker-compose.yml` / `values.env` / `README.md` の記述が新挙動と一致
    することを確認。E2E ハーネス(`packages/e2e/src/helpers/docker.ts`)の
    変更はコメントのみでロジック変更なし(ユニットテスト追加は不要)。
  - `pnpm lint` / `pnpm build` / `pnpm test`(24ファイル301テスト他)全通過。
    `sh -n` によるスクリプトの構文確認も通過。
- 決定事項・注意点:
  - 軽微な指摘(非ブロッキング): 旧 README の「ノードのデータディレクトリも
    起動時に毎回初期化する」の一文が削除されたが、この挙動自体は
    reth-node.sh / lighthouse-bn.sh / lighthouse-vc.sh で変わらず残っている
    (WORKLOG には記録済み)。README の「冪等性」節に、ノードの datadir は
    従来どおり起動のたびに初期化されること、`down`(-v なし)+`up` では旧
    タイムスタンプの genesis が再利用されることを一言補足するとよい。
  - まだ未コミットのため、コミット時は「1つの変更内容 = 1コミット」に従い、
    少なくとも修正本体(profiles/ 一式 + e2e コメント)と docs
    (PLAN/WORKLOG)を分けること。

### 2026-07-04 Issue #56 genesis サービスの冪等化

- 担当: node-env
- ブランチ: issue-56-genesis-idempotent
- 内容: 稼働中スタックに `docker compose up -d` を再実行すると genesis
  サービスが再走し、`GENESIS_TIMESTAMP` を現在時刻で振り直して共有ボリューム
  上の genesis を上書きしてしまう問題を修正した。上書き後に addNode で新規
  ノードを追加すると、そのノードだけ新しい genesis で init され、既存ノードと
  genesis ハッシュが食い違って EL 間 P2P ハンドシェイクに失敗しブロックへ
  追従できなくなっていた(ステップ6のE2E実装中に発見)。
  - `profiles/ethereum/scripts/generate-genesis.sh` を冪等化した。生成完了時に
    共有ボリュームへ完了マーカー `/data/.genesis-complete` を `touch` し、
    スクリプト冒頭でこのマーカーの存在を確認して、あれば再生成せず `exit 0`
    する。`docker compose down -v` でボリュームを破棄すればマーカーごと消えて
    次回起動時に再生成されるため、クリーン起動の挙動は保たれる。
  - マーカーは生成処理がすべて成功した最後にだけ書く。途中失敗した実行は
    マーカーを残さないため、次回起動時に半端な生成物のままではなくやり直しに
    なる。
  - 挙動変更に合わせて `docker-compose.yml` / `values.env` / `README.md` の
    「起動のたびに再生成する」旨の記述を「初回のみ生成し以降は再利用(冪等)」に
    更新した。README には「冪等性(Issue #56)」節を追加。
  - E2E ハーネス(`packages/e2e/src/helpers/docker.ts`)の「稼働中は up -d を
    呼ばない」回避策のコメントが、根本原因が未修正である前提の記述だったため、
    冪等化済みである旨に更新した。再利用ロジック自体は再生成+同期コストの
    回避として有用なので変更していない。
- 確認結果:
  - `docker compose down -v && up -d` でクリーン起動し、genesis が生成され
    完了マーカーが付き、チェーンが進行(cast で chain-id=1337、ブロックが
    4→7 と増加、reth2 も追従)することを確認。
  - 稼働中に `up -d` を再実行し、genesis サービスがマーカーを検出して
    「再生成せず終了する」ログを出し、genesis.json / genesis.ssz の
    タイムスタンプ・sha256 が変化しないこと(冪等)を確認。
  - 上記の再実行後に reth+beacon の peer ペアを手動追加し、同一 genesis で
    init されて P2P 接続し(peers=1)、既存チェーンにバックフィル追従して
    reth1 と同一の head 高・同一のブロックハッシュに揃うことを確認(修正前は
    ここで失敗していた)。
  - `pnpm test:e2e` を実行し全9件成功(addNode を含む)。
- 決定事項・注意点:
  - genesis の冪等化により、共有ボリュームが存在する限り genesis は初回作成の
    ものが使い続けられる。設定(`values.env`)やフォークスケジュールを変えて
    作り直したいときは `docker compose down -v` が必須になる(README に明記)。
  - reth-node.sh / lighthouse-bn.sh はこれまで通り起動のたびにデータ
    ディレクトリを初期化する。今回は genesis 生成のみを冪等化した。共有
    genesis が固定されたことで、コンテナ再起動時の再 init も常に同一 genesis に
    対して行われるようになった。
### 2026-07-04 PR #60 ステップ6へのE2E拡張シナリオ(#58・#59)追記のレビュー

- 担当: reviewer
- ブランチ: docs-step6-e2e-expansion
- 内容: docs/PLAN.md ステップ6セクションへの追記(1コミット・9行の
  docs変更)を静的レビューした。結果は合格。
  - 追加された2つのチェックボックスの文言が Issue #58(異常系シナリオ:
    不正なchainProfile・存在しないID・不正なコマンド)・#59(再接続
    シナリオ: 切断→再接続後のスナップショット整合性)のタイトル・本文と
    一致していることを確認した。
  - 両 Issue とも milestone 5(ステップ6)に紐づいており、PLAN.md 上の
    記載位置(ステップ6セクション末尾)と整合する。ラベル collector も
    既存のE2E関連 Issue(#51〜#54)の前例と一致する。
  - 「上記の完了後、...以下を追加する」という但し書きにより、達成済みの
    ステップ6完了条件(チェック済み4項目)と追加分が明確に区別されており、
    矛盾はない。着手順(異常系→再接続)の明記も Issue #59 本文の経緯と
    一致する。
  - コミットは1つ(docsのみ)で Conventional Commits 形式に従っており、
    粒度も適切。
- 決定事項・注意点: Issue #58 には PLAN.md のチェックボックス文言に
  現れない作業(addWorkbench のラベル重複時の挙動確認、collector 側の
  エラー握りつぶし箇所の調査・報告)も含まれる。着手時は Issue 本文を
  正として作業すること。

### 2026-07-04 Issue #51-#54 E2E結合テストの再検証(qa)

- 担当: qa
- ブランチ: issue-51-e2e-scaffold
- 内容: 追従待ちを動的タイムアウト+進捗停止検出(catch-up.ts)に置き換えた
  後のステップ6全体を実環境で再検証した。前回の不合格(固定120秒タイム
  アウトで長く進んだチェーンでは確実に失敗)が解消されているかを確認する
  のが主眼。
  - 検証環境: `profiles/ethereum`のスタックが約2時間継続稼働。検証開始
    時点のチェーン高は2875ブロック(前回不合格時の1900超をさらに上回る)。
  - `pnpm test:e2e`を実行し全9件が成功(a-b-layer 3件 + commands 6件)。
    最重要のブロック追従テスト(addNodeした reth が既存チェーンに追従)は
    高さ2875に対し約280秒(280412ms)で合格。動的タイムアウトの内部上限
    540秒・itタイムアウト600秒に対し十分な余裕があり、現在のチェーン高に
    応じた妥当な時間で完了することを確認した。全体所要は約5分44秒。
  - `pnpm lint && pnpm build && pnpm test`(pre-pushフックと同一)は約5.7秒で
    完了。実Docker前提のテスト(a-b-layer.test.ts / commands.test.ts)は
    実行されず、`pnpm -r test`にE2Eが混入しないことを確認した。
  - `pnpm --filter @chainviz/e2e test`単体では`catch-up.unit.test.ts`の
    14件のみが実行されることを確認した(vitest.unit.config.tsのinclude)。
  - `docs/CONTRIBUTING.md`のE2E記述と実装の一致を確認: 待ち受けポート4123
    (collector.ts の startCollector 既定値・CHAINVIZ_COLLECTOR_PORT で注入)、
    稼働中スタックを再利用し up -d を呼ばない挙動(docker.ts ensureChainRunning)、
    unit/e2e の設定分離、前提条件(事前 pnpm build・ブリッジネットワーク到達)
    のいずれも記述どおり。
- 決定事項・注意点: ステップ6の完了条件(実環境でA層・B層・ステップ5操作
  コマンドが自動検証され、pre-pushフック対象にE2Eが混入しない)を満たす。
  合格と判定。検証後、collector子プロセス(ポート4123)・addNodeで追加した
  ノード/ワークベンチの残骸がないこと、元のcompose 7コンテナのみが残る
  クリーンな状態を確認した。前回WORKLOG(#53)にある「上限540秒を超える
  長時間稼働ではタイムアウトしうる」点は今回の2875ブロック(約280秒)では
  問題にならなかったが、既知の制約として引き続き有効。

### 2026-07-04 Issue #58 再々レビュー（CONTRIBUTING.md 差し戻し対応の確認）

- 担当: reviewer
- ブランチ: issue-58-e2e-error-paths
- 内容: 前回レビューの差し戻し1点と再発防止の推奨事項への対応（統括による
  修正）を再レビューした。結果は合格。
  - 差し戻し対応: docs/CONTRIBUTING.md の E2E テスト本体の列挙に
    `error-paths.test.ts` が追記された。`packages/e2e/src/` の実ファイル
    構成、`vitest.config.ts`（include: `src/**/*.test.ts`、exclude:
    `**/*.unit.test.ts`）とも一致することを確認した。
  - 推奨事項対応: CONTRIBUTING.md「前提条件」に「`pnpm test:e2e` は同時に
    複数実行しない」の注意書きが追加された。記述内容（`profiles/ethereum`
    スタックとポート 4123 の共有、`websocket is not open` でのタイムアウト
    という症状、Issue #58 のレビューで特定した経緯）は前回レビューでの
    調査結果・実装（`helpers/collector.ts` の port 4123）と正確に一致する。
  - 恒久対応として Issue #64 が起票済みであることを確認した。本文は
    前回レビューで提案した2案（startCollector の子プロセス所有確認 /
    ホスト単位の flock 排他）と発覚の経緯を正確に記録している。
  - `pnpm lint` は成功（前回レビューからの差分は docs のみで、build/test は
    前回レビューで全パッケージ通過を確認済み）。
- 決定事項・注意点:
  - 任意の改善提案（差し戻しではない）: CONTRIBUTING.md の注意書きは
    Issue #58 のみを参照しているが、恒久対応の追跡先である Issue #64 への
    言及もあると、将来この運用制約を撤廃してよいか判断しやすくなる。
  - 静的レビューとしての差し戻し事項は無し。次は chainviz-qa の検証へ。
  - コミットはまだ無い（意図どおり）。

### 2026-07-04 Issue #58 再レビュー（差し戻し対応の確認とE2E flaky調査）

- 担当: reviewer
- ブランチ: issue-58-e2e-error-paths
- 内容: 前回指摘2点の修正確認と、フルスイート実行時に報告された
  removeWorkbench の60秒タイムアウト（flaky）の原因調査。
  - 修正(1) node-lifecycle.ts の addNode 後始末: `.catch(() => {})` →
    try/catch + `console.error` + 元の beacon エラーを優先して再 throw、
    理由コメントつき。指摘どおりで適切。追加されたユニットテスト
    （後始末も失敗した場合に元のエラーが伝播・後始末の試行・ログ出力まで
    検証）も質は良好。collector 324 テスト。
  - 修正(2) error-paths.test.ts のコメント: 「待機は不要（commandResult は
    CommandHandler が addNode の完了を await した後に返る）」という記述に
    修正済み。websocket-server.ts / handler.ts の実装と一致することを確認した。
  - `pnpm lint` / `pnpm build` / `pnpm test` は全パッケージ通過。
  - `pnpm test:e2e` フルスイートを3回実行。隔離状態（他のテストランなし・
    ポート4123空き）での2回は15件全通過（removeWorkbench は15秒前後で完了）。
    3回目は commands.test.ts の4件が "websocket is not open" で失敗したが、
    docker events とプロセス観測により、**別ワークツリーの E2E ランが同時
    実行されていたことによる干渉**と特定した（調査中に wt-issue56 / wt-issue63
    の `pnpm test:e2e` + collector プロセスの同時稼働を実際に観測）。
- 決定事項・注意点（flaky の真因と再発防止）:
  - E2E ハーネスはホスト上で単一の Docker プロジェクト（chainviz-ethereum）と
    固定ポート4123を共有するが、排他制御が無い。さらに startCollector の
    `canConnect` は「誰かが4123で応答するか」しか見ないため、別ランの
    collector が既に4123を占有していると、自分の collector 子プロセスが
    EADDRINUSE で即死しても**他人の collector に接続してテストが進行**して
    しまう。その状態で相手のランが終了して collector を kill すると、
    こちらの sendCommand は返信を永遠に待って60秒タイムアウトする。
    収集悟が観測した removeWorkbench のタイムアウトはこれで説明でき、
    「docker 負荷による無関係な flaky」ではなく実在の構造的問題。
    残骸コンテナ `chainviz-ethereum-e2e-alice-2-2`（`-2` 付き service 名は
    同一 collector プロセス内で e2e-alice が登録済みのときのみ採番される＝
    2つのランが1つの collector を共有した動かぬ証拠）も観測した。
  - ただしこれは #51-#54 で作られたハーネスの既存設計の問題であり、#58 の
    変更自体の欠陥ではない。隔離実行では2回連続全通過しており #58 は合格。
    再発防止は別 Issue として起票し、(a) スイート全体をホスト上のロック
    ファイル（flock 等）で排他する、(b) startCollector を「自分の子プロセス
    がポートを所有していること」の確認（例: 子プロセスの listening ログ行を
    待つ）に変える、のいずれか/両方を行うこと。CONTRIBUTING.md にも
    「E2E スイートはホストごとに同時に1つだけ実行する」制約を明記すること。
  - 軽微な差し戻し1点: docs/CONTRIBUTING.md の「E2E テスト本体
    (`a-b-layer.test.ts` / `commands.test.ts`)」という列挙に、本 Issue で
    追加した `error-paths.test.ts` が含まれていない。コミット前に追記すること。

### 2026-07-04 Issue #58 レビュー（E2E異常系シナリオ）

- 担当: reviewer
- ブランチ: issue-58-e2e-error-paths
- 内容: `error-paths.test.ts`(6シナリオ)とヘルパー追加(`countProjectContainers` /
  `sendRaw` / `isOpen`)の静的レビュー。`pnpm lint` / `pnpm build` / `pnpm test` は
  全パッケージ通過(collector 323 / frontend 301)。
  - テストの質は良好。エラーメッセージの具体性(`/bitcoin/` の照合で汎用メッセージ
    へのすり替えを検出できる)・コンテナ数不変・不正フレーム送信後の接続維持と
    後続コマンド処理・collector プロセス生存(exitCode null)まで検証しており、
    「壊れたコードでも通るテスト」にはなっていない。不正フレームの commandId
    "bad-cmd" はクライアントの `e2e-<n>` 連番と衝突しないため、後続 sendCommand
    の返信と取り違える競合も無い。commands.test.ts(ハッピーパス)との住み分けも妥当。
  - 握りつぶし3件の判断:
    - (1) `dockerode-operations.ts` `stopAndRemove` の `container.stop()` 全 catch
      → **記録に留めて可**。意図のコメントがあり、後続の `remove({force:true})` が
      実行中コンテナも強制削除しつつ非404エラーを伝播するため、真の失敗は
      remove 側で表面化する(事後条件は担保されている)。任意の改善として catch を
      304/404 に絞る余地はある。
    - (2) `node-lifecycle.ts` `addNode` の後始末 `.catch(() => {})` → **要修正**。
      後始末が失敗すると孤立 reth がA層観測でキャンバスに表示されるのに
      `this.nodes` 未登録のため removeNode で消せない「見えるが消せない」状態に
      なり、その痕跡がどこにも残らない。既存慣行
      (`console.error("[ethereum] ...", err)`)でログを出し、元の beacon エラーを
      優先して再 throw する(後始末エラーに差し替えない)理由をコメントに残すこと
      (CLAUDE.md「品質ゲートを骨抜きにしない運用ルール」)。あわせて「後始末も
      失敗した場合に元の beacon エラーが伝播する」ことのユニットテストを推奨
      (現状は後始末が成功するケースのみテストされている)。
    - (3) `websocket-server.ts` `onMessage` の不正メッセージ黙殺 → **記録に留めて
      可**。不正 JSON 側には理由コメントがあり、挙動自体が今回の E2E で仕様として
      固定された。フロント側バグの調査性向上のための warn ログ追加は後日の
      改善候補とする。
  - その他の指摘: `error-paths.test.ts` の addNode 異常系にある「少し待ってから
    数え直しても増えていないことを確認する」というコメントは、実コードに待機が
    無く実態と不一致。commandResult は CommandHandler が `addNode` の完了を
    await した後に返るため待機自体は不要であり、コメント側を実態に合わせて
    修正すること。
- 決定事項・注意点: 上記(2)のログ追加とテストコメント修正の2点で collector に
  差し戻し。未コミットのため、コミット分割(test(e2e) のヘルパー+テスト /
  collector のログ修正 / docs 更新)にも留意すること。

### 2026-07-04 Issue #58 E2Eテストに異常系シナリオを追加する

- 担当: collector
- ブランチ: issue-58-e2e-error-paths
- 内容: 既存E2E(commands.test.ts)がハッピーパス中心だったため、操作コマンドと
  WebSocketプロトコルの異常系を検証する`packages/e2e/src/error-paths.test.ts`を
  新設した。検証シナリオは以下の6件。
  - addNodeに未対応のchainProfile("bitcoin")を指定 → ok:falseかつエラー
    メッセージにプロファイル名が含まれること、さらにプロジェクトのコンテナ数が
    変化しない(コンテナが一切作られない)ことを確認。コンテナ計数は
    `com.docker.compose.project=chainviz-ethereum`ラベルで絞った`docker ps -a`で行う
    (helpers/docker.tsに`countProjectContainers`を追加)。
  - removeNodeに存在しないnodeId → ok:false。
  - removeWorkbenchに存在しないworkbenchId → ok:false。
  - addWorkbenchでラベル重複 → 拒否ではなく一意化して成功する実挙動を先に
    確認した上でテスト化。同ラベルで2回追加すると2つ目は`<label>-2`のIDで
    別ワークベンチとして共存する(EthereumNodeLifecycle.uniqueWorkbenchService)。
  - 不正JSON・type欠落・未知type・空command本体をWebSocketで送信しても接続が
    切れずcollectorプロセスも落ちず、直後に正常なコマンドを処理できること。
    生フレーム送信のためhelpers/ws-client.tsに`sendRaw`と`isOpen`を追加した。
  - `pnpm test:e2e`で全15件(既存9件+新規6件)が成功することを確認した。
- 決定事項・注意点:
  - エラーハンドリングの握りつぶし調査を実施。CommandHandlerは例外を握りつぶさず
    実際のエラーメッセージ付きでok:falseに変換しており(汎用メッセージへの
    すり替えなし)、エラー時にok:trueを返す箇所は無いことを確認した。
  - 借りの残るコード(バグではないが留意点):
    (1) dockerode-operations.tsのstopAndRemoveで`container.stop()`の例外を
    ログ無しで握りつぶす。「既に停止/不在」を意図した処理だが、真の停止失敗も
    覆い隠す。ただし後続のremoveが非404エラーを伝播するため実害は限定的。
    (2) node-lifecycle.tsのaddNodeでbeacon起動失敗時のreth後始末
    `stopAndRemove(reth.id).catch(() => {})`が後始末失敗をログ無しで握りつぶす
    (孤立コンテナが残っても気づけない。ただし元のbeaconエラーは再throwされok:false)。
    (3) websocket-server.tsのonMessageが不正JSON・非commandメッセージを
    ログ無しで黙って破棄する(仕様どおりだがフロント側のバグが不可視)。
    いずれも明確なバグとは言えず設計判断の範疇のため、本Issueでは修正せず記録に留めた。

### 2026-07-04 Issue #53 E2Eテストの追従待ちタイムアウトを動的算出に変更

- 担当: collector
- ブランチ: issue-51-e2e-scaffold
- 内容: chainviz-qaの検証で、addNodeのブロック追従待ちが固定タイムアウト
  (120秒)のため、稼働時間が延びてチェーンが長く進行した環境(バックフィル
  すべき履歴が長い)では確実に失敗することが判明した(#44/#46のような
  実際の回帰ではなく、E2Eテスト自体の設計不備)。
  - 新規`packages/e2e/src/helpers/catch-up.ts`: 待ち開始時点の高さの差分
    (gap)から保守的なバックフィル速度(5ブロック/秒。実測9〜10に対し安全
    マージン)で動的にタイムアウトを算出する`catchUpTimeoutMs()`と、
    観測した最大高さが一定時間(45秒)更新されなければ停止と判定する
    `CatchUpMonitor`を組み合わせた`waitForBlockCatchUp()`を実装。
  - `commands.test.ts`の追従待ちをこれに差し替え。
  - Docker非依存の純粋ロジックとして`catch-up.unit.test.ts`(14ケース)を
    追加し、`packages/e2e`に`test`スクリプトを新設。`vitest.config.ts`の
    excludeで`*.unit.test.ts`をtest:e2e(実Docker前提)の対象から外し、
    逆に`vitest.unit.config.ts`のincludeで`test`スクリプトの対象を
    `*.unit.test.ts`のみに絞ることで、`pnpm -r test`(pre-pushフック対象)
    には実Docker前提のテストが混入しないようにした。
- 決定事項・注意点: 実機で、稼働時間約1時間・チェーン高1900ブロック超の
  環境において、旧設計なら確実に失敗する条件(追従に220秒要した)で
  新設計が正しく機能することを確認した。上限540秒を超える長時間稼働
  (連続稼働 約2.7時間超相当)では健全でもタイムアウトしうるため、
  長時間運用時はスタック再作成で回避する。

### 2026-07-04 Issue #34 追加ノードの EL P2P 対応(elpeer)の再レビュー

- 担当: reviewer
- ブランチ: issue-34-add-remove-node
- 内容: Issue #44(EL 間 P2P)・#46(lighthouse-bn.sh 修正)の main マージを
  受けて collector が行った追随変更(`rethSpec` への `RETH_ROLE=peer` /
  `RETH_P2P_IP` 付与、`elpeer` ボリュームの ro マウント、
  `EthereumNodeLifecycleConfig` への `elpeerVolume` 追加)を静的レビューした。
  - `reth-node.sh`(RETH_ROLE の解釈・`/elpeer/boot.enode` の待機)および
    docker-compose.yml の reth2(peer)の構成と一致しており、#44 レビュー時に
    連携事項として挙げた 3 点(RETH_ROLE / RETH_P2P_IP / elpeer:ro)を
    過不足なく満たす。beaconSpec の clpeer(BEACON_ROLE=peer + ro マウント)
    パターンとも一貫している。
  - ボリューム既定値 `chainviz-ethereum_elpeer` は compose プロジェクト名
    (`name: chainviz-ethereum`)から導出される実名と一致する。
  - `node-lifecycle.test.ts` に elpeer マウント・RETH_ROLE・RETH_P2P_IP の
    assertion が追加されており妥当。`pnpm lint` / `pnpm build` / `pnpm test`
    はリポジトリ全体で成功(collector 319 件・frontend 231 件)。
  - 前回レビューの残件(addWorkbench のラベル重複、レジストリのインメモリ性、
    resolveProfileDir のテスト不足)への新たな影響なし。removeNode の
    部分失敗対応(前回修正済み)にも変更なし。docs(CONCEPT.md のファイル共有
    方式の記述・ARCHITECTURE.md §3 の Command 型)との齟齬なし。
- 決定事項・注意点:
  - WORKLOG の collector エントリ(#34)に「追加ノードのブロック追従の
    エンドツーエンド確認まではできなかった」という記述が残っているが、
    今回の追随変更後に collector 担当が実機でブロック追従(reth1 と歩調一致)を
    確認済みであり、この記述は古い。コミット前に collector 担当が elpeer
    追随変更と実機確認結果のエントリを追記(または既存エントリを更新)すること。

### 2026-07-04 Issue #46 lighthouse-bn.shの/data初期化順序を修正

- 担当: node-env
- ブランチ: issue-46-lighthouse-mkdir-order
- 内容: ステップ5(#34: addNode実装)のcollector担当が、addNodeで動的に
  追加するbeaconコンテナ(/dataボリュームをマウントしない)で
  `find: '/data': No such file or directory`によるクラッシュを発見した。
  Issue #41の修正で`find /data -mindepth 1 -delete`の後に
  `mkdir -p /data`を置いていたため、ボリューム未マウント時に`find`が
  `/data`不在で即座に失敗していた。`mkdir -p /data`を`find`より前に
  実行するよう順序を入れ替えた(mkdir -pは既存でも無害)。
- 決定事項・注意点: 実機で確認済み。`/data`ボリュームを一切マウントせず
  `docker run`でbeaconコンテナ(BEACON_ROLE=peer)を起動したところ、
  修正前はクラッシュしていたが修正後は正常に進行した。既存の
  compose起動beacon1/2(ボリュームマウントあり)の挙動には影響しない。

### 2026-07-04 Issue #46 レビュー（lighthouse-bn.sh の /data 初期化順序）

- 担当: reviewer
- ブランチ: issue-46-lighthouse-mkdir-order
- 内容: `mkdir -p /data` を `find /data -mindepth 1 -delete` より前に
  移動する修正（1行の並べ替え）の静的レビュー。
  - 順序の妥当性: `mkdir -p` は冪等（既存ディレクトリでも成功する）ため、
    ボリュームをマウントする compose 起動の beacon1/2 には無影響。
    ボリューム無しの動的コンテナでは find 実行前に /data が確実に存在
    するようになり、Issue #46 の原因（find が /data 不在で即失敗）を
    解消する。ロジックとして問題なし
  - 周辺スクリプトの同種問題: reth-node.sh / lighthouse-vc.sh の
    `rm -rf /data/*` は glob 有効な位置で実行され、/data 不在でも
    `rm -f` 相当で失敗しないため、同じクラッシュは起きない（対応不要）
  - `sh -n` で profiles/ethereum/scripts/ の全スクリプトの構文を確認、
    docs/ARCHITECTURE.md との齟齬なし、コミットは1変更1コミットで
    Conventional Commits 準拠、`Closes #46` あり
- 決定事項・注意点: **条件付き差し戻し**。lighthouse-bn.sh に追記された
  コメントの「ボリュームmarshalなし」は「ボリュームマウントなし」の誤記。
  意味が通らないため修正が必要（修正はコメント1語のみで、既存コミットへの
  amend で足りる粒度）。修正後、このブランチの実装側 WORKLOG エントリの
  追記も必要。

### 2026-07-04 Issue #44 レビュー（reth(EL)同士の P2P 同期）

- 担当: reviewer
- ブランチ: issue-44-el-p2p-sync
- 内容: node-env による EL 間 P2P 有効化（下記エントリ）の静的レビュー。
  - 固定 p2p 秘密鍵（`0x2222...22`）から導出された公開鍵定数
    `466d7f...278a` を secp256k1 演算で独立に検算し、一致を確認した。
    enode の形式（`enode://<非圧縮公開鍵64バイト>@IP:30303`）は devp2p の
    標準仕様であり、reth の内部実装に依存した推測ではない。
  - シェル構文（`sh -n`）、`pnpm lint` / `pnpm build` / `pnpm test` の全通過を
    確認した（TypeScript への影響なし）。
  - WORKLOG 追記時に既存エントリ（Issue #1・#2・#3）の見出しが誤って
    削除されていたため復元した。
- 決定事項・注意点:
  - **collector（#34 addNode）側の追随が必要**: 新しい `reth-node.sh` は
    `RETH_ROLE` 未設定（= peer）のとき `/elpeer/boot.enode` の出現を無限に
    待つ。`issue-34-add-remove-node` ブランチの `EthereumNodeLifecycle.rethSpec`
    は現状 `elpeer` をマウントしておらず、#44 マージ後そのままだと addNode で
    起動した reth は永久に待機して起動しない。#34 側で `elpeer:ro` マウントと
    `RETH_P2P_IP` の付与を追加すること（本エントリの連携事項どおり）。
  - `docs/CONCEPT.md` の決定事項（新規ノードの bootnode 情報を
    `admin_nodeInfo` のポーリング結果から取り出して起動コマンドに渡す方式）と
    実装（共有ボリューム経由の決定的 enode ファイル方式）がズレている。
    B層の実装が Beacon API ベースになった経緯もあわせて、CONCEPT.md の
    該当 2 箇所（アーキテクチャ案・検討事項）の更新が必要。
  - `docs/PLAN.md` ステップ 4 冒頭の「reth(EL)同士のP2Pは…まだ繋いでいない
    （Phase 3で追加予定）」も現在形の記述として実態とズレるため、#44 で
    追加済みである旨に更新するのが望ましい。
  - boot（reth1）停止時の耐障害性（peer 同士の相互接続など）は入れていないが、
    reth1 は compose 管理のバリデーター付きノードで removeNode の対象外
    （ステップ 5 完了条件）であり、先回り実装をしない方針に照らして妥当と
    判断した。enode が決定的なため、ボリュームに残る `boot.enode` は reth1
    再起動後も常に有効という利点もある。

### 2026-07-04 Issue #44 reth(EL)同士の P2P 同期を有効化
- 担当: node-env
- ブランチ: issue-44-el-p2p-sync
- 内容: `reth-node.sh` が `--disable-discovery` で EL 間 P2P を完全に無効化して
  いたため、チェーン進行後に参加した新規 reth が履歴ブロックを取得できず
  ブロック高 0 のまま追従できない問題を修正した。EL 間で devp2p(RLPx)接続を
  張り、新規ノードが既存ノードから履歴をバックフィルできるようにした。
  - `reth-node.sh` を CL(`lighthouse-bn.sh`)と同じファイル共有方式に書き換えた。
    `RETH_ROLE=boot` のノードが自分の enode を共有ボリューム(`elpeer`)の
    `/elpeer/boot.enode` へ書き出し、`RETH_ROLE=peer`(未設定含む)のノードが
    それを読んで `--trusted-peers` / `--bootnodes` で接続する。
  - `docker-compose.yml`: 共有ボリューム `elpeer` を追加。`reth1` を
    `RETH_ROLE=boot`(`elpeer` を rw マウント)、`reth2` を `RETH_ROLE=peer`
    (`elpeer:ro`)にし、双方に `RETH_P2P_IP`(広告 IP)を設定した。
  - `README.md` の P2P 節を実態に合わせて更新。
- 決定事項・注意点:
  - **boot ノードの enode を決定的にした**。ノードイメージに HTTP クライアントが
    無く `admin_nodeInfo` を RPC で取得できない。かつ peer が `exec` を保ったまま
    enode を待ち受けられるようにするため、boot ノードは固定の p2p 秘密鍵を使い、
    そこから決定的に導出される公開鍵(enode の pubkey 部)を `reth-node.sh` に
    定数として持たせている。boot はこの公開鍵と自分の IP から enode 文字列を
    自前で構築して共有ファイルへ書く(ログのパース不要、`exec` を維持できる)。
    使い捨て devnet 用の値であり、`values.env` の mnemonic 同様に固定でよい。
    秘密鍵を変えた場合はコメントの手順で公開鍵を再導出すること。
  - `--nat extip:<IP>` を指定して reth が正しい IP を広告するようにした
    (未指定だと enode が 127.0.0.1 になる)。boot は必須、peer は任意。
  - 副作用として EL 間の tx gossip(本来 Phase 3 想定)も同時に有効になる。
    reth ではブロック同期だけを分離して ON/OFF できないため、今回のユーザー
    指示により許容している。
  - 実機確認: `docker compose down -v && up -d` で reth1/reth2 が `peers=1` で
    接続しチェーンが進行(workbench から `cast chain-id`=1337、`block-number`
    正常)。チェーンが 41 まで進んだ後に新規 `reth3`+`beacon3` を `docker run`
    で追加したところ、reth3 は即座に履歴をバックフィルしてヘッドに追従した
    (block 5・30 のハッシュが reth1 と完全一致、以降ヘッドと同期して進行)。
  - **collector(addNode)側への連携事項**: addNode で reth を追加する際は、
    その reth コンテナに次を与えれば boot(reth1)から自動でバックフィル・追従
    できる。
    - 環境変数 `RETH_ROLE=peer`(省略時も peer 扱い)。
    - 環境変数 `RETH_P2P_IP=<割り当てた固定 IP>`(省略可。省略時は外向き接続
      のみで動く。他ノードからも dial 可能にしたいなら指定する)。
    - 共有ボリューム `<compose プロジェクト名>_elpeer` を `/elpeer` に **ro**
      マウント(compose 既定のプロジェクト名は `chainviz-ethereum` なので
      `chainviz-ethereum_elpeer`)。
    - 既存どおり `<プロジェクト名>_genesis` を `/genesis:ro`、`reth-node.sh` を
      `/scripts/reth-node.sh:ro` にマウントし、同じネットワークに接続する。
    - 対になる beacon も同様に `BEACON_ROLE=peer` + `clpeer` の ro マウントで
      追加する(reth が Engine API で FCU を受け取ってバックフィルを開始する
      ために CL も必要)。
### 2026-07-04 Issue #41 lighthouse-bn.sh の set -f が /data 初期化の glob 展開を無効化する不具合
- 担当: node-env
- ブランチ: issue-41-lighthouse-bn-glob-init
- 内容: `profiles/ethereum/scripts/lighthouse-bn.sh` で `set -f`(glob 無効化)が
  `rm -rf /data/*` より前に実行されており、`/data/*` が glob 展開されず
  リテラルの `*` を消そうとしていた(実データが残る)。`set -f` は後段の
  `$COMMON` 単語分割時に `--http-allow-origin *` の `*` が glob 展開されるのを
  防ぐために必要で単純に外せないため、初期化を glob 非依存の
  `find /data -mindepth 1 -delete` に置き換えた(隠しファイルも含めて確実に消える)。
- 確認範囲: 他スクリプト(`reth-node.sh` / `lighthouse-vc.sh` /
  `generate-genesis.sh`)は `set -f` を使っておらず同種の不具合なし。修正対象は
  `lighthouse-bn.sh` のみ。
- 動作確認:
  - `docker compose down -v && up -d` のクリーン起動でブロックが進行
    (chain-id 1337 / reth v2.3.0、workbench から `cast` で RPC 疎通確認)。
  - ボリュームを維持したまま beacon を再起動すると、修正前は初期化が空振りして
    weak-subjectivity で起動失敗していたが、修正後は `[beacon] データディレクトリ
    を初期化` が有効に働き、beacon はクラッシュせず再起動する(新しい ENR を
    再発行=データが実際に消えていることを確認)。
- 注意点(#41 とは別の既知の癖。今回の修正対象外):
  - beacon だけを再起動すると CL は genesis からやり直す一方、reth は
    データを保持したまま先行するため EL/CL が乖離し、beacon 自体は正常でも
    ブロック生成が止まる。ボリューム維持のまま再開したい場合は
    ノード群(reth1/reth2/beacon1/beacon2/validator1/validator2)をまとめて
    再起動すると、各 datadir が既存 genesis から作り直されて進行を再開する
    (実機で確認済み)。
  - `docker compose restart`(全体)や停止中でない reth を伴わない再起動では、
    genesis サービスが再実行されて jwtsecret が再生成されるため、reth が
    古い jwtsecret のままだと Engine API が 401 になりチェーンが停止する。
    この構成は genesis を毎回作り直す前提のため、確実な再起動は
    `down`→`up`(フル recreate)で行う。
### 2026-07-04 Issue #34・#35・#36 ノード/ワークベンチ追加・削除の静的レビュー(reviewer)
- 担当: reviewer
- ブランチ: issue-34-add-remove-node
- 内容: collector 側実装(#34・#35・#36)とテスト強化の静的レビューを実施した。
  境界の遵守・観測側コードとの整合・テストの質を確認し、tester が報告した
  removeNode の設計上の穴を修正した。
  - **レビュー結果(問題なしと確認した点)**:
    - ChainAdapter 境界: コンテナ構成の知識(イメージ・IP 帯・ボリューム・
      環境変数)は `adapters/ethereum/node-lifecycle.ts` に閉じており、
      `commands/`・`server/`・`docker/operations.ts` はチェーン非依存の語彙のみ。
      `packages/shared` の変更は不要(Command 型は設計フェーズ定義のままで
      docs/ARCHITECTURE.md §3 と一致)という判断も妥当。
    - compose 互換ラベル(project/service=reth<n>/beacon<n>)は observe.ts の
      `computeStableId`、targets.ts の `serviceNodeKey`(reth3/beacon3 → "3")、
      classify.ts の判定と整合する。IP 採番(172.28.1.n / 172.28.2.n、n>=3)は
      compose の固定 IP・ゲートウェイと衝突しない。
    - beacon の起動環境変数(BEACON_ROLE=peer / ENR_ADDRESS /
      EXECUTION_ENDPOINT)・ボリューム名・ネットワーク名は
      profiles/ethereum/docker-compose.yml と一致。
    - 循環依存なし。lint / build / test はリポジトリ全体で成功。
      tester 追加分のテストは異常系・境界値を実質的に検証しており妥当。
  - **修正(tester 指摘の removeNode の穴)**: `removeNode` がレジストリから
    先に splice してから削除する実装だと、consensus の削除失敗時に execution
    コンテナが孤立して再試行不能になり、実装コメント(再試行できるよう先に
    登録を外す)とも矛盾していた。以下のとおり修正した。
    - `node-lifecycle.ts`: removeNode / removeWorkbench とも「削除がすべて
      成功してから登録を外す」順序に変更。失敗時は登録が残るため同じ ID で
      再実行してリトライできる。
    - `dockerode-operations.ts`: `stopAndRemove` が remove の 404(既に削除
      済み)を成功扱いするよう修正。`operations.ts` の契約「既に停止・削除
      済みでも失敗しない」と実装が食い違っており、部分失敗後のリトライで
      削除済みコンテナへの再 stopAndRemove が永久に失敗する経路が残るため。
    - テスト 4 件追加(リトライで削除を完遂できること×ノード/ワークベンチ、
      途中失敗後の残り削除、remove 404 の成功扱い)。collector 315 → 319 件。
- 決定事項・注意点:
  - **軽微な指摘(今回は未修正。後続で対応を検討)**:
    1. addWorkbench のラベルが compose の既存 service 名と同じ場合
       (空ラベルの既定値 "workbench" が該当)、初回はコンテナ名衝突で失敗
       するが、リトライすると連番付きの名前で作成に成功し、compose 側
       ワークベンチと同じ安定 ID(chainviz-ethereum/workbench)が重複し得る。
       ラベルの一意化がレジスト済みワークベンチとの比較のみで、実際に
       動いているコンテナ(compose 起動分・collector 再起動前の追加分)を
       考慮していないため。フロント(#37)のラベル入力仕様と合わせて対応したい。
    2. 追加ノード/ワークベンチのレジストリはインメモリのため、collector を
       再起動すると追加済みコンテナが削除不能になる(removeNode がエラーを
       返す)。当面の制約として QA・フロント担当は把握しておくこと。
    3. `index.ts` の `resolveProfileDir`(環境変数上書き+パス導出)に対応する
       ユニットテストが無い。

### 2026-07-04 Issue #34・#35・#36 キャンバスからのノード/ワークベンチ追加・削除(collector側)
- 担当: collector
- ブランチ: issue-34-add-remove-node
- 内容: フロントからの操作コマンド(addNode / removeNode / addWorkbench /
  removeWorkbench)を collector が実処理するよう実装した。従来
  `websocket-server.ts` の onMessage はどのコマンドにも未実装エラーを返す
  スタブだったのを、コマンドディスパッチ層と Ethereum 固有のノード
  ライフサイクル層に配線した。
  - `packages/collector/src/docker/operations.ts` … コンテナのライフサイクル
    操作(作成起動・停止削除・ネットワークの使用中 IP 照会)のチェーン非依存な
    抽象 `DockerOperations`。観測用の `DockerClient`(types.ts)とは別の関心事
    として分離した。
  - `packages/collector/src/docker/dockerode-operations.ts` … 上記を dockerode で
    実装。`ContainerSpec` → dockerode の createContainer 引数への変換
    (`toCreateOptions`)、network.inspect() からの使用中 IP 収集
    (`collectNetworkIps`)を含む。dockerode 依存はこのファイルに閉じ込める。
  - `packages/collector/src/commands/lifecycle.ts` … コマンドが最終的に呼ぶ
    チェーン非依存のポート `NodeLifecycle` と結果型 `CommandResult`。
  - `packages/collector/src/commands/handler.ts` … `CommandHandler`。Command を
    NodeLifecycle の各操作へディスパッチし、例外を commandResult のエラーへ変換
    する(handle 自体は throw しない)。
  - `packages/collector/src/adapters/ethereum/node-lifecycle.ts` …
    `EthereumNodeLifecycle`。reth / lighthouse beacon / Foundry ワークベンチの
    コンテナ構成(イメージ・エントリポイント・環境変数・ボリューム・IP 帯)という
    Ethereum 固有の知識をここに閉じ込める。新規ノードは「バリデーターなしの
    フォロワー reth + beacon ペア」として追加し、追加したコンテナを内部レジストリ
    で管理する。
  - `websocket-server.ts` を `CommandProcessor` を受け取ってコマンドを
    ディスパッチするよう変更。`index.ts` で dockerode の DockerOperations →
    EthereumNodeLifecycle → CommandHandler → CollectorServer を配線。
- 決定事項・注意点:
  - **追加コンテナには compose 互換ラベル(project=chainviz-ethereum,
    service=reth&lt;n&gt;/beacon&lt;n&gt;)を付ける**。これにより観測側の
    `computeStableId` が既存ノードと同じ `chainviz-ethereum/&lt;service&gt;` 形式の
    安定 ID を割り当て、ネットワークのグルーピング・ピアエッジ・ブロック伝播の
    対応付け(targets.ts の役割プレフィックス剥がし)が既存ノードと同様に機能する。
    reth と beacon で同じ番号 n を共有することで両者が同じ論理ノードとして
    対応付く。追加識別用に `com.chainviz.managed=true` と `com.chainviz.role` も
    付与する。
  - **IP 採番**: reth は 172.28.1.n、beacon は 172.28.2.n(n>=3。1,2 は compose の
    ノードが使用済み)。addNode 時に network.inspect() で使用中 IP を取得し、
    両帯で同じ n が空いている最小の番号を選ぶ。既存 reth1/reth2/beacon1/beacon2 の
    慣習(README「ノードを増やすには」)に合わせた。
  - **removeNode の保護**: collector が addNode で作成したコンテナ(内部レジストリ
    にあるもの)だけ削除できる。compose 起動のバリデーター付きノード
    (reth1/reth2/beacon1/beacon2 等)への removeNode はエラーを返す。ノードは
    reth+beacon ペア単位で管理し、どちらの安定 ID を指定しても両方削除する。
  - **ワークベンチのラベル**: addWorkbench の label をそのまま compose service
    ラベルに使い、WorkbenchEntity.label に反映させる。同名が既に管理下にある
    場合は `-2`, `-3` を付けて一意化する。mnemonic は profiles/ethereum/values.env の
    EL_AND_CL_MNEMONIC を読み込んで環境変数に注入する(単一の出所を保つ)。
  - **profiles/ethereum 側の変更は不要だった**。reth-node.sh / lighthouse-bn.sh は
    環境変数だけで駆動する汎用スクリプトのため、collector が dockerode で
    そのまま bind mount して起動できた。`packages/shared` の型変更も不要。
  - コマンドは docs/ARCHITECTURE.md §3 のとおりワールドステートを直接書き換えず、
    実際の反映は後続のポーリング差分で届く。
  - **実機確認**: 実環境に対し WebSocket 経由で全コマンドを実行し検証した。
    addNode で reth3(172.28.1.3)+ beacon3(172.28.2.3)が正しいラベル・
    マウント・環境変数で起動(reth3 は RPC 稼働、beacon3 は新 genesis の正しい
    スロットから起動)。removeNode は compose の reth1 を保護(エラー)し、追加した
    ペアを両方削除。addWorkbench は Foundry コンテナを起動し `cast chain-id`=1337・
    `cast wallet address`(mnemonic 注入)が成功、removeWorkbench で削除できた。
  - **既知の環境問題(collector 範囲外・node-env へ要連携。解消済み)**:
    当初 `profiles/ethereum/scripts/lighthouse-bn.sh` の `set -f`(noglob)に
    起因するデータ初期化不具合(Issue #41)により、今回の実機確認時点では
    既存ネットワークが合意できず追加ノードのブロック追従のエンドツーエンド
    確認まではできなかった。また、EL(reth)同士の P2P がそもそも無効化
    されていたため(`--disable-discovery`)、チェーンが既に進行した後に
    参加する reth は過去のブロックをバックフィルする手段が無く、ブロック
    高 0 のまま停止する根本的な問題があった(chainviz-qa の統合検証で発覚)。
    node-env 側で EL 間 P2P を有効化(Issue #44)し、collector 側も
    `rethSpec` に `RETH_ROLE=peer`・`RETH_P2P_IP`・`elpeer` ボリューム
    マウントを追加して追随した結果、**実機でチェーン進行中(block 41 相当)に
    追加した reth+beacon ペアが履歴をバックフィルし、既存 reth と完全に
    歩調を合わせて追従することを確認した**(関連する `/data` 未マウント時の
    lighthouse-bn.sh クラッシュも Issue #46 で解消済み)。

### 2026-07-04 Issue #34・#35・#36 ノード/ワークベンチ追加・削除のテスト強化(tester)
- 担当: tester
- ブランチ: issue-34-add-remove-node
- 内容: collector 側実装(#34・#35・#36)の基本ユニットテストに対し、異常系・
  境界値・想定外シーケンスの観点でテストを追加した。実装コードは変更していない。
  テスト件数は 273 → 315(collector パッケージ)。
  - `docker/dockerode-operations.test.ts`: 空ポート配列で ExposedPorts を省くこと、
    labels/binds 未指定時の扱い、静的 IP なしでもエンドポイントが張られること、
    `collectNetworkIps` が空文字/欠損 IPv4Address をスキップすること、CIDR なしの
    素の IP をそのまま返すこと、複数 IPAM config からの Gateway 収集、
    `usedNetworkIps` の空ネットワーク・inspect 失敗の伝播、`stopAndRemove` の
    remove 失敗が伝播すること。
  - `adapters/ethereum/node-lifecycle.test.ts`: `parseMnemonic` の単一引用符/
    引用符なし/インデント/複数行/空値/別名変数、`allocateNodeIndex` の境界
    (254 まで埋まった場合・全枠使用時 undefined・execution/consensus 片側のみ
    使用中の扱い)、reth 作成自体が失敗した場合にロールバックも登録もしないこと、
    addNode 失敗時に index を消費せず再試行で同じ index を再利用できること、
    空きスロットなしで throw し何も作成しないこと、usedNetworkIps 由来の使用中
    IP を回避すること、同一 nodeId への二重 removeNode を拒否すること、未知 ID・
    名前がプレフィックス一致するだけの ID(reth / reth30)を誤削除しないこと、
    removeNode の stopAndRemove 失敗が伝播すること、空/空白ラベルの既定 service、
    ワークベンチのコンテナ名が seq で一意になること、二重 removeWorkbench の拒否、
    ラベル解放後の再利用、空レジストリでの removeWorkbench 拒否、values.env が
    読めない場合に mnemonic を省くこと・読める場合に注入すること。
  - `commands/handler.test.ts`: 不明 action 名がエラーに載ること、action 無しで
    "(none)"、不明 action で lifecycle を一切呼ばないこと、Error 以外の throw 値の
    文字列化。
  - `server/websocket-server.test.ts`: 同一 commandId の 2 コマンドがどちらも
    処理され id がエコーされること(重複排除しない)、command フィールド欠落の
    command envelope でも id をエコーして返すこと、配列ペイロードの無視。
- 決定事項・注意点:
  - **removeNode の部分失敗時のリーク(要確認・collector へ差し戻し候補)**:
    `removeNode` はレジストリから先に splice してから consensus → execution の
    順に `stopAndRemove` する。consensus の削除が throw すると execution は削除
    されず、かつレジストリからは既に外れているため removeNode 経由で再試行でき
    ない(execution コンテナが孤立する)。実装コメントは「片方の削除が失敗しても
    再試行できるよう先に登録を外す」と述べているが、外した後は再試行手段が無い
    ため意図と挙動が食い違う。dockerode 実装の `stopAndRemove` は stop 失敗を
    握りつぶし force remove するため実際に throw する頻度は低いが、設計上の穴
    として collector 担当へ確認を依頼したい。今回は現挙動(失敗が伝播すること)を
    テストで固定するに留め、実装は変更していない。

### 2026-07-04 Issue #1・#2・#3 Ethereum プロファイルのノード環境

- 担当: node-env
- ブランチ: issue-1-genesis-pos-net
- 内容: `profiles/ethereum/` にノード環境テンプレート一式を作成した。
  - `values.env` … genesis 生成設定（実質的な genesis 設定ファイル）。
    CHAIN_ID=1337、バリデーター 64、slot time 2 秒、Electra まで有効・Fulu 以降
    無効、EL プリマイン 8 アカウント。
  - `docker-compose.yml` … reth(EL)+ lighthouse(CL beacon + validator)を
    2 ノード、Foundry ワークベンチ 1 つ、genesis 生成サービス。
  - `scripts/` … 各コンテナの起動スクリプト（genesis 生成、reth、beacon、
    validator）。
- 決定事項・注意点:
  - **genesis は静的コミットせず起動時に生成する**。genesis.json / genesis.ssz は
    生成時刻を埋め込むため、古い時刻でコミットすると lighthouse が過去/未来
    スロットの計算で破綻する。`genesis` サービスが `docker compose up` のたびに
    現在時刻で生成し直し、共有ボリューム `genesis` に置く。全ノードがこれを
    マウントして共有する（CONCEPT「genesis を静的ファイルとしてマウント共有」に
    対応。共有ボリュームの中身がその実体）。
  - genesis 生成は `ethpandaops/ethereum-genesis-generator` を採用（EL/CL 両方の
    genesis と各種予備コントラクトを一括生成でき、Kurtosis と同じ実績のある
    経路）。バリデーター鍵は同イメージ同梱の `eth2-val-tools` で mnemonic から
    導出し、ノード数ぶんに分割する。
  - **ノードのデータディレクトリも起動時に毎回初期化する**。genesis が毎回
    変わるため、古い chain データが残ると genesis 不一致で起動できない。
    各起動スクリプトが `rm -rf` してから init/start する。したがって `up` の
    たびにまっさらな chain で始まる（devnet として想定どおり）。
  - **CL の P2P bootstrap**: reth/lighthouse のイメージには curl 等の HTTP
    クライアントが無いため、runtime の API 取得は使えない。代わりに beacon1 が
    lighthouse の書き出す enr.dat を共有ボリューム `clpeer` へコピーし、beacon2 が
    それを `--boot-nodes` に渡す方式にした。ENR に載せる IP は docker の固定 IP
    （`--enr-address`）。これで 2 ノードが単一 chain として合意する。
  - **EL(reth)同士の P2P は未接続**。ブロックは CL が Engine API で各 EL に渡す
    ため両 EL の canonical chain は一致する（起動テストで両 reth の head hash 一致を
    確認済み）。mempool の相互伝播が要る Phase 3 で追加する。ロギングプロキシも
    Phase 3。
  - シェルの落とし穴: `--http-allow-origin *` を変数経由で unquoted 展開すると
    `*` がコンテナのルート直下に glob 展開されて不正な引数（boot 等）が混入する。
    beacon 起動スクリプトで `set -f`（glob 無効）を入れて回避した。
  - 起動確認（node-env 自己確認。最終合否は qa 担当）: `docker compose up` で
    ブロックが約 2 秒ごとに進行、finality も epoch 3 まで到達、両 reth の head 一致、
    ワークベンチから `cast chain-id / block-number / balance / send`（プリマイン
    アカウントから送金し status 0x1・残高反映）まで確認した。
  - ワークベンチの送金鍵はチェーンと同じ mnemonic。導出パスが Foundry 既定と
    同じなのでプリマインアカウントをそのまま使える。

### 2026-07-04 Issue #1・#2・#3 レビュー（Ethereum プロファイルのノード環境）
- 担当: reviewer
- ブランチ: issue-1-genesis-pos-net
- 内容: `profiles/ethereum/` 一式と `docs/PLAN.md`・`docs/WORKLOG.md` の変更を
  静的レビューした。境界の遵守（packages/* 無変更、フロント・collector への
  チェーン固有ロジックの漏れなし）、チェーンプロファイルの独立性（新規
  ディレクトリ追加のみ）、ARCHITECTURE.md §4 のテンプレート配置、CONCEPT.md の
  決定事項（slot time 2 秒、reth + lighthouse の PoS、Foundry ワークベンチ×1、
  ロギングプロキシの Phase 3 送り）との整合を確認。結果は条件付き合格
  （実装の差し戻しなし。下記 2 点の対応を推奨）。
- 決定事項・注意点:
  - **CONCEPT.md との齟齬（要 docs 更新）**: CONCEPT.md「新規ノード追加時の
    P2P 参加方法」は「genesis は静的ファイルとしてマウント共有」としているが、
    実装は「起動時に生成して共有ボリュームで共有」。生成時刻を埋め込む genesis の
    性質上、実装側が正しい。sync-docs の観点で CONCEPT.md の該当決定事項の
    文言を実態（起動時生成 + 共有ボリューム）に合わせて更新すべき。
  - **mnemonic の二重管理（修正推奨）**: docker-compose.yml の `ETH_MNEMONIC` に
    ハードコードした mnemonic は、generator イメージ（`:master` タグ）内
    `/defaults/defaults.env` の `EL_AND_CL_MNEMONIC` 既定値との一致に依存している。
    イメージ更新で既定値が変わると、プリマインとワークベンチ鍵が静かに食い違う。
    `values.env` で `EL_AND_CL_MNEMONIC` を明示的に export し出所を一本化すべき。
  - イメージタグがすべて `latest` / `master`。特に genesis-generator は
    `/work/entrypoint.sh` 等のイメージ内部パスにも依存しており、タグ変動の
    影響を最も受けやすい。再現性のためピン留めを検討（必須とはしない）。
  - #1〜#3 を 1 ブランチ・1 PR にまとめる運用は CLAUDE.md「Issue ごとに
    ブランチを切る」からの逸脱だが、不可分な作業である旨が PLAN.md に
    明記されており妥当と判断。
  - 動作面（ブロック進行・finality・cast 疎通）の最終合否は qa 担当に委ねる。

### 2026-07-04 Issue #4・#5 検証（Ethereum プロファイルのノード環境）
- 担当: qa
- ブランチ: issue-1-genesis-pos-net
- 内容: `profiles/ethereum/` を実際に `docker compose up` して、ステップ2の
  完了条件（Issue #4・#5）を実機で検証した。結果は両 Issue とも合格。
  検証後 `docker compose down -v` で環境（コンテナ・ボリューム・ネットワーク）を
  完全に後片付け済み。
- 検証環境: Docker 29.1.3 / Docker Compose 2.40.3（Linux WSL2）。イメージは
  すべて `latest` / `master` タグを当日 pull した状態。
- Issue #4（起動・ブロック進行）: 合格。
  - `genesis` サービスが起動時に genesis を生成し exit 0 で正常終了。ログで
    バリデーター鍵 64 個を 2 ノードに 32 個ずつ分割生成しているのを確認。
    データボリュームは毎回まっさらから生成される仕様どおりに動作。
  - ブロックが約 2 秒ごとに継続進行することを確認（block-number を複数回
    サンプリングし単調増加: 8→10→13→15→17、その後も 40→74→109→153 と継続）。
  - 両 EL（reth1/reth2）が同一 head hash・同一 block-number で一致。CL の P2P が
    接続され（beacon peer_count=1 = 相互接続）単一チェーンとして合意している。
  - finality: 起動直後は epoch 1 が justify されず finalized_epoch=0 のままだったが、
    これは起動時の peer 接続待ちによる初回のみの遅延。epoch が進むと
    current_justified が epoch 2→3 と連続 justify され、finalized も epoch 2 まで
    前進することを beacon API（`/eth/v1/beacon/states/head/finality_checkpoints`）で
    確認。finality は正常に機能している。完了条件（ブロック進行）には影響なし。
- Issue #5（ワークベンチからの cast RPC 疎通）: 合格。
  - workbench コンテナ内で compose 設定の `ETH_RPC_URL=http://reth1:8545` に対し
    `cast chain-id`=1337、`cast block-number`（進行中の値）、
    `cast rpc web3_clientVersion`=reth/v2.3.0、`cast gas-price` が正常応答。
  - プリマインアカウント（mnemonic index 0）の残高照会 `cast balance --ether`=
    1000000000 ether を確認。
  - `cast send`（プリマインから fee recipient へ 1 ether 送金）が status=0x1 で
    採掘され、受取アドレス残高が 0 → 1.000000000000021000 ether（送金分＋ブロック
    提案報酬）に反映されることを確認。
- 差し戻し: なし。ステップ2の完了条件を満たしているため Issue #4・#5 はクローズ可。
  reviewer が挙げた docs 更新（CONCEPT.md の genesis 記述）・mnemonic 二重管理・
  タグピン留めは動作に影響しないため本検証の合否とは独立（別途対応判断）。

### 2026-07-04 Issue #10〜#16 Phase 1 フロントエンド（A層インフラ可視化）
- 担当: frontend
- ブランチ: issue-10-frontend-a-layer
- 内容: `packages/frontend/` に A層（コンテナのカード表示）の UI 一式を実装した。
  collector 経由の WebSocket（スナップショット + 差分）だけを見る設計を守り、
  Docker やノードには一切直接触れない。
  - ビルド基盤: フロントを React アプリ化した。React 19 + React Flow
    (`@xyflow/react`) + Vite を導入。`build` は従来どおり `tsc -b`（型チェック +
    宣言出力）、`build:web` に `vite build`（出力は `dist-web/`）を分けた。
    テストは vitest（jsdom 環境）。
  - `canvas/Canvas.tsx` … React Flow による無限キャンバス（ズーム/パン/ドラッグ、
    Background/Controls/MiniMap）。ドラッグ完了で位置を永続化する。[#10]
  - `entities/` … `infraNode.ts`（ワールドステート → React Flow ノードへの純変換。
    node/workbench のみ対象、containerName をキーに保存位置を引く、未保存は
    既定グリッド）、`InfraNodeCard.tsx`（カード本体）、`InfraPopover.tsx`
    （ホバー詳細: IP・ポート・プロセス・CPU/メモリ・クライアント種別・同期状態・
    ブロック高）。[#11][#12]
  - `glossary/` … インライン用語解説。`GlossaryTerm.tsx` は点線下線 + ホバー/
    フォーカスで定義ポップオーバー（未登録用語は下線なしのプレーン表示）。
    `parse.ts` は用語 YAML を `{ja,en}` 検証つきで Glossary に変換。[#13]
  - `glossary/ethereum/terms/a-infra.yaml` … A層の用語データ（container /
    port-mapping / el-client / cl-client / workbench）。ARCHITECTURE.md §5 の
    スキーマ（`{ja,en}` 形式・layer・relatedTerms）。[#14]
  - `layout/layoutStore.ts` … レイアウトの localStorage 永続化。キーは安定識別子
    （containerName）を使い、Docker コンテナ ID には依存しない。壊れた JSON・
    不正な座標は捨てて空マップにフォールバック。[#15]
  - `i18n/` … ja/en 切り替え。デフォルト日本語、`LanguageToggle` で画面隅から
    いつでも切り替え、選択言語は localStorage に永続化。UI 文言・用語とも
    `{ja,en}` 形式。[#16]
  - `websocket/` … `packages/shared` の protocol 型に従うクライアント。
    `client.ts`（snapshot/diff/commandResult を振り分け、操作コマンド送信）、
    `messages.ts`（受信テキストの検証パース・コマンド直列化）、`mockData.ts`
    （collector 未起動でも動くモッククライアント）。`VITE_COLLECTOR_URL` 未設定
    時はモックで起動する。
- 決定事項・注意点:
  - **用語データの取り込み方**: 用語の正となる置き場所は repo ルートの
    `glossary/`（パッケージ外）。Vite の alias `@glossary` + `?raw` インポートで
    ビルド時に YAML テキストを取り込み、`parseGlossaryYaml` でパースする
    （`glossary/data.ts`）。tsc は `*.yaml?raw` の ambient 宣言
    （`src/vite-env.d.ts`）で解決を短絡させる。テストは `parse.ts` を直接叩き、
    実ファイルを fs で読んで検証する（App/データ層に依存しない）。
  - **エンティティの安定 ID**: `DiffEvent` の entityUpdated/entityRemoved は
    `id: string` を前提にするが、共有スキーマ上 node/workbench 以外
    （wallet/block/tx/…）は共通の `id` フィールドを持たない。フロント側の
    `entityId()` で種別ごとに `id` / `address` / `hash` へ解決して吸収した
    （共有型は変更していない）。将来 C層以降でこの前提を詰める際、shared 側で
    エンティティ ID の統一表現を検討する余地がある（reviewer と要調整）。
  - **jsdom の制約**: この vitest/jsdom 構成では `localStorage` グローバルと
    file スキームの `import.meta.url` が使えない。前者は永続化 API を
    注入可能インターフェース（`KeyValueStorage`）にし、実行時は
    `platform/storage.ts` の `getBrowserStorage()` が localStorage 不在時に
    メモリ実装へフォールバックする形で回避。後者はテストで cwd から
    リポジトリルートの glossary を上方向探索して解決している。
  - 状態管理・データ変換・WebSocket クライアントなどロジック部分には vitest の
    ユニットテストを付けた（異常系・境界値含む）。純粋な見た目部分を除き、
    frontend 全体で 70 テスト。`pnpm --filter @chainviz/frontend build` /
    `test`、`vite build`、`eslint packages/frontend/src` が通ることを確認済み。
  - スコープは A層（コンテナのカード表示・ホバー詳細）まで。B層以降（ピア接続
    エッジ、ブロック伝播アニメーション等）は範囲外で未実装。

### 2026-07-04 Issue #1 レビュー対応（mnemonic の出所を values.env に一本化）
- 担当: node-env
- ブランチ: issue-1-genesis-pos-net
- 内容: reviewer が挙げた「mnemonic の二重管理」を修正した。
  - `values.env` に `export EL_AND_CL_MNEMONIC="..."` を明示的に追加し、mnemonic の
    出所をこのファイル1箇所に一本化した。値は generator イメージ
    （`ethpandaops/ethereum-genesis-generator:master`）の `/defaults/defaults.env`
    の既定値と同一の文字列を明示指定（既存のプリマインアドレス・バリデーター鍵を
    変えないため）。
  - `docker-compose.yml` のワークベンチから、ハードコードしていた `ETH_MNEMONIC`
    環境変数を削除し、代わりに `env_file: ./values.env` で同じ mnemonic を読み込む
    形に変更した。`ETH_RPC_URL` は従来どおり `environment:` に残す。
  - `README.md` の cast 例を `$ETH_MNEMONIC` → `$EL_AND_CL_MNEMONIC` に更新。
- 決定事項・注意点:
  - **なぜ env_file か**: ワークベンチへの値の渡し方として、entrypoint で
    `. values.env` して再 export する案も検討したが、`docker compose exec` は
    entrypoint プロセスの実行時 export を引き継がない（新プロセスがコンテナの
    設定 env を継承する）ため、対話 shell の `$ENV` 経由でしか値が渡らず
    非対話の `exec sh -c 'cast ...'`（QA や自動化が使う）で空になる。`env_file` は
    コンテナの設定 env に入るため対話・非対話どちらの exec でも確実に参照できる。
    これを実機で確認した上で env_file を採用した。
  - env_file は values.env の全変数（CHAIN_ID や SLOT_DURATION 等の genesis 用
    変数）もワークベンチ env に載せるが、cast / forge はこれらを参照しないため
    無害。ワークベンチが参照するのは `ETH_RPC_URL` と `EL_AND_CL_MNEMONIC` のみ。
  - 生成側（genesis サービス）は従来どおり generate-genesis.sh が
    `. /config/values.env` でシェル source する経路。明示 export により
    イメージ既定値への暗黙依存が解消され、バリデーター鍵導出・EL プリマインとも
    values.env の値を使う。
  - 再確認: 修正後に `docker compose up` → ブロック進行（block-number 9→12）、
    `cast chain-id`=1337、プリマイン index 0 残高=10 億 ETH、
    `cast send --mnemonic "$EL_AND_CL_MNEMONIC"` で送金し受取残高反映まで
    非対話 exec で確認。`docker compose down -v` で後片付け済み。

### 2026-07-04 Issue #10〜#16 frontend A層のテスト強化
- 担当: tester
- ブランチ: issue-10-frontend-a-layer
- 内容: frontend（描画担当）が実装と同時に書いた基本テスト（70件）に対し、
  異常系・境界値・想定外シーケンスの観点でテストを追加した（合計118件）。
  実装コードは変更していない。追加した観点は以下。
  - websocket/client: error イベントでの disconnected 遷移、disconnect 後の
    再 connect で新しい socket を開くこと、サーバー主導の close 後の再接続、
    未接続での sendCommand が例外を投げず id を返すこと、未接続での
    disconnect が no-op であること、ok:true の commandResult の error が
    undefined になること、diff payload が配列でない場合の無視。
  - world-state/store: 同一バッチ内で entityRemoved 後に entityUpdated が
    来ても復活しないこと（ARCHITECTURE.md §2）、add→update / add→remove の
    同一バッチ適用、連続 patch のマージと非対象フィールドの保持、
    ワークベンチ削除時のウォレット存続と ownerWorkbenchId の null 化、
    同一 id の entityAdded による上書き、空 store への remove、
    複数エッジからの対象 1 件のみ削除、逆方向エッジを別物として扱うこと。
  - layout/layoutStore: 0・負の座標の保持（境界値）、Infinity 座標の除外、
    値が null/配列のエントリの除外、保存 position からの余分プロパティ除去、
    壊れた既存ストレージからの復旧書き込み。
  - glossary/parse: 言語値が非文字列/name が文字列のエントリのスキップ、
    値が null のエントリのスキップ、前後空白のトリム、relatedTerms からの
    非文字列除去、layer が誤った型のときの空文字デフォルト、
    mergeGlossaries の同一キー上書きと引数なし。
  - i18n: 未知メッセージキーでキー文字列を返すこと、デフォルト言語が無くても
    要求言語を返すこと、両方無いときの空文字。
  - websocket/messages: 数値 JSON・snapshot payload が null/欠落・type 無しで
    null を返すこと、空配列 diff の受理、全コマンド種別の round-trip。
  - entities/infraNode: 空入力、グリッドの行折り返し、保存位置とグリッドの
    混在（ソート後 index 基準）、カスタムグリッド設定、id の辞書順ソート。
  - websocket/mockData: 接続中の二重 connect で snapshot を再送しないこと、
    disconnect/connect サイクルでの snapshot 再送、未接続 disconnect で
    状態変化を通知しないこと、負の intervalMs でタイマーを起動しないこと、
    二重 disconnect の安全性。
- 決定事項・注意点（実装担当への差し戻し候補となる指摘 2 件）:
  - **i18n `pickLocale` の空文字フォールバック不整合**: docstring は「対象言語の
    値が空/未定義ならデフォルト言語へフォールバックする」とあるが、実装は
    `localized[lang] ?? localized[DEFAULT_LANGUAGE] ?? ""` で `??` を使うため、
    値が空文字 `""` のときフォールバックせず `""` を返す。例:
    `pickLocale({ ja: "こんにちは", en: "" }, "en")` は "こんにちは" が期待だが
    実際は "" を返す。glossary/parse は値をトリムのみで空を弾かないため、
    空文字の翻訳が入りうる現実的な経路がある。実装 or docstring のどちらを
    正とするか frontend 担当の判断が必要なため、この挙動を固定するテストは
    追加していない。
  - **layout `saveLayout` / `saveNodePosition` の書き込み時例外**: `loadLayout`
    は壊れた JSON 等でも例外を投げない防御的設計だが、書き込み側は
    `storage.setItem` の例外（localStorage の容量超過 QuotaExceededError 等）を
    捕捉していない。ドラッグ完了時の保存で容量超過が起きるとハンドラごと
    例外が伝播する。読み取り側と同様に握りつぶす（または呼び出し側で捕捉する）
    のが望ましいと考えられるが、望ましい挙動の確定が必要なため、こちらも
    挙動を固定するテストは追加していない。
- 検証: `pnpm --filter @chainviz/frontend build`・`test`（118 件 pass）・
  追加テストファイルの eslint がいずれも通ることを確認済み。

### 2026-07-04 Issue #10〜#16 frontend A層 tester 指摘バグ 2 件の修正
- 担当: frontend
- ブランチ: issue-10-frontend-a-layer
- 内容: chainviz-tester がレビュー前に報告した 2 件の挙動不整合を修正した。
  いずれも前回の WORKLOG に「挙動の確定が必要」として記録されていたもの。
  - i18n `pickLocale` の空文字フォールバック: docstring（対象言語の値が
    空/未定義ならデフォルト言語へフォールバック）に実装を合わせた。従来の
    `localized[lang] ?? localized[DEFAULT_LANGUAGE] ?? ""` は `??` のため空文字
    `""` でフォールバックしなかった。空文字も「値なし」として扱うよう
    `value !== undefined && value !== ""` の判定に変更した。glossary/parse が値を
    トリムのみで空を弾かないため、空文字翻訳が入りうる現実的な経路がある。
    `packages/frontend/src/i18n/i18n.ts`。
  - layout `saveLayout` / `saveNodePosition` の書き込み時例外: `loadLayout`
    が壊れた JSON でも例外を投げない防御的設計であるのと対称に、書き込み側も
    `storage.setItem` の例外（localStorage 容量超過 QuotaExceededError 等）を
    try/catch で握りつぶし `console.warn` でログに残すだけにした。ドラッグ完了時
    の保存で容量超過が起きても呼び出し元へ例外が伝播しない。`saveNodePosition`
    は `saveLayout` 経由なので同時に保護される。
    `packages/frontend/src/layout/layoutStore.ts`。
  - 各挙動を固定するテストを追加した。i18n は要求言語が空文字のときデフォルトへ
    フォールバックすること・両方空のときは空文字を返すこと、layout は
    `saveLayout` / `saveNodePosition` が setItem の例外を投げず握りつぶすこと
    （`saveNodePosition` は例外時も更新後マップを返す）を確認する。
- 決定事項・注意点:
  - `pnpm --filter @chainviz/frontend build`・`test`（122 件 pass）が通ることを
    確認済み。

### 2026-07-04 Issue #10〜#16 frontend A層のレビュー
- 担当: reviewer
- ブランチ: issue-10-frontend-a-layer
- 内容: frontend A層実装（React Flow キャンバス、カード表示、ホバーポップ
  オーバー、用語解説インライン表示、A層用語データ、レイアウト永続化、
  UI 言語切替）と tester によるテスト強化を静的にレビューした。
  結果は**合格（差し戻しなし）**。軽微な指摘 3 件は下記のとおり
  （マージ前の対応推奨 2 件、申し送り 1 件）。
- 確認した内容:
  - 境界の遵守: frontend は Docker・ノード API に一切触れていない。通信は
    `packages/shared` の protocol 型（snapshot/diff/commandResult/command）に
    従う WebSocket クライアントのみ。`eth_getLogs` のようなチェーン固有の
    RPC 語彙の漏れなし。
  - 命名・用語: 可視化階層は「A層 / Layer A」で統一。UI 文言・用語データとも
    `{ja, en}` 形式。デフォルト日本語・画面隅トグルは CONCEPT.md の記述どおり。
  - レイアウト永続化: キーは `containerName`（安定識別子）。Docker コンテナ ID
    には依存していない（PLAN #15 の条件を満たす）。壊れた JSON・不正座標・
    書き込み例外への防御も確認。
  - glossary: データは repo ルート `glossary/`（コード分離の原則どおり）、
    スキーマは ARCHITECTURE.md §5 に一致。パーサは壊れたエントリを
    読み飛ばす防御的実装。
  - ビルド・lint・テスト: リポジトリ全体で `pnpm lint` / `pnpm build` /
    `pnpm test` すべて通過（frontend 122 件）。eslint が `.tsx` 11 ファイルを
    実際に対象としていることも確認した。
  - テストの質: store の差分適用（同一バッチ内の remove→update 非復活、
    イミュータビリティ、逆方向エッジの区別）、client の異常系（不正 JSON、
    サーバー主導 close 後の再接続、未接続での操作）、layoutStore の境界値
    （0・負・Infinity 座標、setItem 例外）、GlossaryTerm の未登録用語・言語
    切替など、実装の詳細をなぞるだけでない挙動ベースのテストになっている。
- 判断: `DiffEvent`（entityUpdated/entityRemoved の `id: string`）と
  wallet/block/tx が `id` フィールドを持たない件について、**現時点で
  `packages/shared` の型変更は不要**とする。理由: (1) Phase 1 の差分対象は
  node/workbench のみで、両者は `id` を持つため実害がない。(2) 全エンティティ
  への `id` 追加は ARCHITECTURE.md §2 の自然キー設計を崩し、collector 側の
  変更も要する先回り実装になる。ただし frontend の `entityId()`（wallet/
  contract→address、block/tx/userOp→hash）は collector と共有すべき
  プロトコル規約なので、**Phase 3（C層）着手時に entityId 相当のヘルパを
  `packages/shared` へ移し、ARCHITECTURE.md §2 に id 規約を明記すること**を
  条件として申し送る。
- 指摘（軽微・差し戻し対象外）:
  1. **ARCHITECTURE.md §1 と実装の構成差分（マージ前の更新推奨）**:
     frontend 実装には `app/`（App シェル・クライアント解決）、`platform/`
     （storage 抽象）、`world-state/`（snapshot/diff の畳み込み）が増えたが、
     §1 のフォルダ構成に記載がない（§1 の `websocket/` の説明にある
     「スナップショット/差分の反映」は実際には `world-state/` が担う）。
     sync-docs の観点で §1 を実装に合わせて更新すること。
  2. **WORKLOG.md のフォーマット逸脱（マージ前の修正推奨）**: 本ファイルの
     「## 2026-07-04 描画麗 (frontend): tester 指摘バグ 2 件の修正」の
     エントリが、規定の `### YYYY-MM-DD Issue #<番号> <タイトル>` +
     `担当:`/`ブランチ:` 箇条書きの形式でなく、見出しレベルも `##` で
     「## 記録」セクションと同格になっている。ペルソナ名は見出しに使わない。
  3. **`clientGlossaryKey` の置き場所（申し送り）**: `entities/InfraPopover.tsx`
     の `clientGlossaryKey()` が reth/geth/lighthouse/prysm という Ethereum
     固有のクライアント名を汎用コンポーネント側にハードコードしている。
     未知値は "container" にフォールバックするため現時点の動作に問題は
     ないが、第2チェーン追加時にこの関数へ分岐を足す形になると
     「既存プロファイルのコードに手を入れない」原則に反する。
     `packages/frontend/src/chain-profiles/ethereum/` を作る際（遅くとも
     Phase 6 の Bitcoin 対応時）にこのマッピングをそちらへ移すこと。

### 2026-07-04 Issue #10〜#16 frontend A層の実機検証
- 担当: qa
- ブランチ: issue-10-frontend-a-layer
- 内容: frontend A層実装（React Flow キャンバス、カード表示、ホバー
  ポップオーバー、用語解説インライン表示、A層用語データ、レイアウト
  localStorage 永続化、UI 言語切替）を実際にブラウザで動かして検証した。
  結果は**合格**。docs/PLAN.md ステップ3 frontend 側（#10〜#16）の完了条件と
  CONCEPT.md「体験イメージ」「用語解説」の記述どおりに動作することを確認した。
- 検証方法:
  - `pnpm --filter @chainviz/frontend build`（tsc -b）成功。
    `build:web`（vite build）も成功し dist-web を生成（js 434KB / css 18.8KB）。
    ユニットテスト 122 件すべて pass。
  - `vite` 開発サーバー（モッククライアント。`websocket/mockData.ts` の
    snapshot を使用）を起動し、Playwright（chromium headless）で実際に
    操作して確認。確認項目は 16 項目すべて pass。
- 確認した挙動:
  - 無限キャンバス（React Flow）上に reth×2・lighthouse×1・workbench の
    4 カードが表示される。
  - カードにホバーすると IP（172.20.0.x）・ポート・プロセス（reth node /
    lighthouse bn / foundry）・CPU%・メモリ MB・クライアント種別・同期状態・
    ブロック高のポップオーバーが出る。
  - ポップオーバー内の「ポート」「クライアント」やカードの種別ラベル
    （ノード/ワークベンチ）など用語解説対象の語にホバーすると、glossary の
    定義（例: コンテナの定義文）と関連用語がポップオーバー表示される。
  - UI 言語切替ボタンで ja→en に切り替わり、タイトル・カードラベル・接続
    ステータスなど画面全体の表示言語が変わる。切替結果は localStorage
    （`chainviz.lang`）に保存される。
  - カードをドラッグすると位置が localStorage（`chainviz.layout.v1`）に
    保存され、キーは安定識別子 containerName（コンテナ ID ではない）。
    リロード後も保存値が残り、カードが同じ位置（transform 一致）に復元される。
  - 実行中にコンソールエラーなし。
- 注意点:
  - 検証環境には日本語フォントが無く、スクリーンショット上では日本語が
    豆腐（□）で表示されるが、テキスト内容自体は DOM 上正しく（innerText で
    確認済み）、アプリ側の不具合ではない。
  - Playwright 実行のため chromium と不足システムライブラリ
    （libnspr4 等）をスクラッチパッドにローカル展開して使用した。リポジトリ
    には何も追加していない。
  - モックデータの edges は空のためピア接続エッジは描画されないが、これは
    Phase 2（B層）の対象であり A層の完了条件には含まれない。

### 2026-07-04 Issue #7・#8・#9 A層（インフラ可視化）の collector 実装
- 担当: collector
- ブランチ: issue-7-collector-a-layer
- 内容: `packages/collector/` に A 層（コンテナ・プロセス・リソース）の
  観察パイプラインを実装した。ARCHITECTURE.md §1 のドメイン単位のフォルダ構成に
  沿って以下を追加。
  - `docker/` … Docker Engine API のポーリング。`types.ts` で dockerode を薄く
    抽象化した `DockerClient` インターフェースと観測値の型を定義。`observe.ts` は
    生レスポンス→観測値の純粋変換（安定 ID 算出・IP/ポート抽出・top のプロセス
    解析・CPU%/メモリ MB 計算）。`poller.ts` の `DockerPoller.pollOnce()` が
    `/containers/json`→各コンテナの `/top`・`/stats` を集約。`dockerode-client.ts`
    が実 dockerode を `DockerClient` へ橋渡し。
  - `adapters/ethereum/` … ChainAdapter 実装。`classify.ts` に reth/lighthouse/
    foundry 等の Ethereum 固有の判定を閉じ込め、`index.ts` の `EthereumAdapter`
    が観測値を `NodeEntity`/`WorkbenchEntity` へ正規化。`subscribePeers`/
    `subscribeChainEvents` は B/C 層で実装するため no-op スタブ。
  - `world-state/` … `diff.ts`（前回比較で `DiffEvent[]` を生成する純粋関数 +
    エンティティ安定キー抽出 `entityId`）と `store.ts`（インメモリ store。
    `applyInfra` は infra 系のみ差分対象にし、他層のエンティティは残す）。
  - `server/` … `CollectorServer`（ws）。接続時に `snapshot` を1回、以後
    `broadcastDiff` で `diff` を配信。プロトコルは shared の `ServerMessage`/
    `ClientMessage` に準拠。
  - `index.ts` … dockerode→poller→adapter→store→server を配線し、3 秒間隔
    （`POLL_INTERVAL_MS`）でポーリング→差分配信するループ。直接実行時のみ起動。
  - vitest を各モジュールに追加（計 63 ケース。ハッピーパス＋異常系・境界値）。
- 決定事項・注意点:
  - **安定識別子（InfraEntity.id）**: docker compose の
    `com.docker.compose.project`/`service` ラベルから `project/service` を生成し、
    無ければコンテナ名、それも無ければコンテナ ID にフォールバック。コンテナ ID は
    再起動で変わるため最終手段（ARCHITECTURE.md §2 の要求）。実 Docker で
    `cvtest/reth1` のようにコンテナ ID 非依存の ID になることを確認済み。
  - **ChainAdapter 境界**: reth/lighthouse/foundry 等のチェーン固有語彙は
    `adapters/ethereum/classify.ts` に限定。`docker/` 配下と world-state の
    スキーマはチェーン非依存に保った。
  - **A 層のプレースホルダ**: `NodeEntity` の `syncStatus`/`blockHeight`/
    `headBlockHash` は A 層では取得しないため `syncing`/`0`/`""` を入れる。
    これらは B/C 層（RPC 購読）で埋める。
  - **top/stats の異常系**: 一覧取得後にコンテナが消える等で個別の top/stats が
    失敗しても、そのコンテナだけ空プロセス・ゼロリソースにフォールバックし
    収集全体は落とさない設計（ユニットテストで担保）。
  - **CPU%**: docker 標準式（cpuDelta/systemDelta × onlineCpus × 100）。差分が
    取れない初回や負値は 0。メモリはページキャッシュ分を差し引いた MB。
  - **操作コマンド（addNode 等）は未実装**。プロトコル準拠のため受信時に
    `commandResult ok:false`（未実装）を返すだけにした。実装はステップ 4 以降。
  - **依存追加とビルド設定**: `dockerode`・`ws`（+ 型）を collector に追加。
    dockerode が引く SSH トランスポート用ネイティブ依存（cpu-features・ssh2・
    protobufjs）はローカルソケット接続では不要なため、`pnpm-workspace.yaml` の
    `allowBuilds` でこれらを `false`（ビルドしない）に設定した。プレースホルダ
    （"set this to true or false"）のままだと `pnpm install` が
    `ERR_PNPM_IGNORED_BUILDS` で失敗し build/test の事前チェックを通せないため。
  - 実機確認: reth/lighthouse/foundry/busybox イメージのコンテナを compose 風
    ラベル付きで起動し、`EthereumAdapter.pollInfra()`→`store.applyInfra()` を実行。
    node/workbench の分類、published+exposed ポート収集、IP 解決、初回 3 件の
    `entityAdded`、安定した 2 回目ポーリングで差分空、を確認。確認後コンテナ・
    ネットワークは削除済み。
  - `pnpm build`・`pnpm test`・`pnpm lint` を全パッケージで通ることを確認。

### 2026-07-04 Issue #7・#8・#9 A層 collector のテスト強化（異常系・境界値）
- 担当: テスト強化（試験学）
- ブランチ: issue-7-collector-a-layer
- 内容: 既存の 63 ケース（ハッピーパス中心）に対し、異常系・境界値・想定外
  シーケンスのテストを追加した（63→118 ケース）。実装コードは変更していない。
  - `docker/observe.test.ts` … 空文字ラベルでの安定 ID フォールバック、
    空/undefined の IP をスキップして次の非空を選ぶ挙動、Ports 欠落、
    PrivatePort 採用、Titles/Processes 欠落時の parseTopProcesses、CMD 列より
    行が短い場合、online_cpus=0、precpu 欠落、丸め、cache 欠落など。
  - `docker/poller.test.ts` … top と stats が同時失敗しても観測を落とさない、
    listContainers 自体の失敗が pollOnce まで伝播する、安定 ID が重複する
    2 コンテナを両方返す（重複排除は上位に委ねる）。
  - `adapters/ethereum/classify.test.ts` … 大文字小文字を無視した判定、
    node/tool 両方の語が出た場合に workbench 判定が優先されること、compose
    サービス名からのクライアント種別判定、判別材料ゼロ時の node フォールバック。
  - `adapters/ethereum/index.test.ts` … top が空でもイメージから clientType を
    保ちつつ代表プロセスは unknown、クライアント種別に一致しない場合の先頭
    プロセス採用、安定 ID が無い場合のコンテナ ID 使用、poller 失敗の伝播。
  - `world-state/diff.test.ts` … add/update が remove より前に来る順序保証、
    両入力空、next/prev の重複 ID 畳み込み（後勝ち・単一イベント化）、多数
    フィールド同時変更、kind 固有フィールド（label）のみの変更。
  - `world-state/store.test.ts` … 消えたエンティティが同じ ID で戻ると
    entityUpdated ではなく entityAdded になること（entityRemoved 後の再出現）、
    1 回の poll に重複 ID があると後勝ちで 1 件に畳まれること、複数 poll に
    またがる更新の蓄積、getSnapshot の返り値配列を外部で変更しても内部が
    汚染されないこと。
  - `server/websocket-server.test.ts` … 複数クライアントへの同報、状態変化後に
    接続したクライアントが最新スナップショットを受け取ること、1 クライアント
    切断後も残りへ配信継続、command 以外の整形式メッセージ・JSON プリミティブ
    （null/数値/文字列）を無視、listen 前の broadcastDiff/close が例外を投げない。
  - `index.test.ts`（新規）… ポーリングループのテスト。初回即時実行と差分配信、
    interval ごとの再スケジュール（fake timers）、stop() 後の停止、poll 失敗時に
    onError 通報しつつループ継続、前回未完了時に次回がスケジュールされない
    （非重複）、変化なし時に空差分を転送、entities 欠落時に空観測として扱う。
- 決定事項・注意点:
  - **潜在バグ（collector へ差し戻し候補）**: `classify.ts` の `WORKBENCH_TOOLS`
    は部分一致（`includesAny`）で判定するため、`"cast"` が `"broadcast"` の部分
    文字列にマッチする。ノードのプロセス/イメージ名に "broadcast" 等が含まれると
    ワークベンチと誤分類される。同様に `"forge"`→"forged" 等の誤検知リスクあり。
    再現: `classifyContainer` に image/process で "broadcast" を含む観測を渡すと
    `kind: "workbench"` が返る。対策案は語境界を見る／既知トークンの完全一致に
    する等。現状の挙動をテストで固定はしていない（バグを固定化しないため）。
  - ポーリングループの「前回未完了時スキップ」は、実装が「await 完了後に次回を
    setTimeout する」方式のため、正確には「前回が完了するまで次回を予約しない」
    挙動。解決しない poll を与えても pollInfra が 1 回しか呼ばれないことで担保した。
  - store の `applyInfra` が非 infra エンティティ（wallet 等）を残すロジックは、
    現状 wallet を注入する公開 API がないためユニットテストでは直接検証できない。
    B/C 層実装時にテストを追加する余地として残す。
  - `pnpm build`・`pnpm test`（118 passed）・`eslint`・`prettier --check` を
    collector で通ることを確認。

### 2026-07-04 Issue #7 classify.ts の部分一致誤分類バグ修正
- 担当: collector
- ブランチ: issue-7-collector-a-layer
- 内容: `adapters/ethereum/classify.ts` のワークベンチ／クライアント判定が
  部分文字列一致（`includesAny`）だったため、"broadcast" に含まれる "cast"、
  "forged" に含まれる "forge" などにマッチし、ノードをワークベンチと誤分類
  していた（試験学からの差し戻し）。判定を単語境界ベースに変更した。
  - `includesAny` を `findWord` に置き換え、needle ごとに `\b<needle>\b`
    （大文字小文字無視）の正規表現でマッチさせる。イメージ名・サービス名で
    使われる区切り文字（`/ : - .` 空白）はいずれも `\b` 境界として扱われる
    ため、"geth-mainnet" の "geth" や "ghcr.io/.../reth:latest" の "reth"、
    "foundry" イメージ上の "cast" プロセスは従来どおり正しく検出される。
  - `classify.test.ts` に回帰テストを追加:「broadcast を含む process/service は
    workbench に誤分類されない」「forged は forge に一致しない」「区切り文字を
    挟んだツール語（foundry イメージパス・cast プロセス）は workbench として
    検出される」の3ケース。
- 決定事項・注意点:
  - `\b` は `[A-Za-z0-9_]` を単語構成文字とみなすため、アンダースコア区切り
    （例: `reth_node`）は境界にならず一致しない点に注意。現状のイメージ名・
    サービス名・プロセス名では `-`/`/`/`:`/`.` 区切りが使われており実害はないが、
    将来アンダースコア区切りのトークンを判定対象にする場合は境界定義の見直しが要る。
  - `pnpm build`・`pnpm test`（121 passed）が collector で通ることを確認。

### 2026-07-04 Issue #7・#8・#9 A層 collector 実装のレビュー（静的整合性）
- 担当: reviewer
- ブランチ: issue-7-collector-a-layer
- 内容: collector の A 層実装（Docker ポーリング・ワールドステート正規化・
  WebSocket 配信）と、テスト強化・classify.ts のバグ修正を静的にレビューした。
  結果は**合格**（差し戻しなし）。
  - 境界の遵守: チェーン固有語彙（reth/lighthouse/foundry 等）は
    `adapters/ethereum/` に閉じている。`docker/` 配下は Docker 共通の語彙のみで
    チェーン非依存。`packages/shared`・`frontend` への変更はなし（lockfile 除く）。
  - ARCHITECTURE.md との整合: §1 のフォルダ構成（docker/ adapters/ world-state/
    server/）、§2 の安定識別子要求（コンテナ ID 非依存）、§3 のプロトコル
    （接続時 snapshot 1回→以後 diff、command は commandResult で応答）に準拠。
    `proxy/`・`commands/` が無いのは後続 Phase の範囲なので問題ない
    （先回り実装をしない原則にも合致）。
  - CONCEPT.md との整合: ポーリング間隔 3 秒（CONCEPT の決定事項）を
    `POLL_INTERVAL_MS` で反映。
  - テストの質: 121 ケースを確認。異常系（top/stats 個別失敗、daemon 到達不能、
    不正 JSON、切断後の同報継続）・境界値（online_cpus=0、空 Titles、重複安定 ID、
    削除後再出現）をカバーし、classify の部分一致バグの回帰テスト
    （broadcast/forged）も実装の修正と対応している。実装をなぞるだけの
    無意味なテストは見当たらない。
  - `pnpm-workspace.yaml` の `allowBuilds`: cpu-features / ssh2 / protobufjs は
    いずれも dockerode 経由の推移的依存であることを `pnpm why` で確認。
    ローカルソケット接続のみの用途でビルド不要とする判断は妥当。
  - `pnpm install --frozen-lockfile`・`pnpm lint`・`pnpm build`・`pnpm test`
    （shared 2 / collector 121 / frontend 1、全パス）をリポジトリ全体で確認。
- 決定事項・注意点（いずれも軽微・非ブロッキング）:
  - `pnpm-workspace.yaml` のコメントと本 WORKLOG の前エントリで protobufjs を
    「SSH トランスポート用ネイティブ依存」と説明しているが、protobufjs は
    @grpc/proto-loader 経由の gRPC 系依存で、ネイティブビルドではなく
    postinstall スクリプトを持つだけ。ビルド不要の判断自体は正しいが、
    コメントの由来説明はやや不正確（次に触るときに直せばよい）。
  - `index.ts` の `startPollingLoop` の第1引数が具象型 `EthereumAdapter` に
    なっている。使うのは `pollInfra` のみなので、shared の `ChainAdapter` 型で
    受けるほうがチェーンプロファイル独立の意図に沿う。新チェーン追加時までに
    直せば十分。
  - `.claude/worktrees/` が未追跡で残っている。コミット時に含めないこと
    （`.gitignore` への追加を推奨）。
  - コミットは未実施のため、コミット粒度の確認は行っていない。コミット時に
    「1 変更 = 1 コミット」（実装 / テスト強化 / バグ修正 / 依存設定を分ける）を
    適用すること。

### 2026-07-04 Issue #7・#8・#9 A層 collector 実装の動作検証（SQA）
- 担当: qa
- ブランチ: issue-7-collector-a-layer
- 内容: collector の A 層実装（Docker ポーリング・ワールドステート正規化・
  WebSocket 配信）を実際に起動して検証した。結果は**合格**（差し戻しなし）。
  - `pnpm --filter @chainviz/collector build` が成功することを確認。
  - `main(port)` を任意ポート（4111）で起動し、WebSocket サーバーが listening
    になりポートが開くことを確認。
  - compose ラベル（project=qatest, service=node1/node2/foundry）付きの
    busybox コンテナ 3 個を立てた状態で、3 秒間隔ポーリングが Docker Engine
    API から実データを取得することを確認。スナップショットに実 IP
    （172.17.0.x）・resources（memMB=0.42）・process.name=sleep が反映され、
    stableId が compose ラベル由来（`qatest/node1` 等、コンテナ ID 非依存）で
    生成されていた。service=foundry のコンテナは classify で workbench に、
    それ以外は node に正しく分類された。
  - WebSocket クライアントで接続直後に snapshot が 1 回届くことを確認
    （ARCHITECTURE §3）。接続保持中に node2 を削除し node3 を追加したところ、
    次のポーリング周期で `entityAdded(qatest/node3)`・
    `entityRemoved(qatest/node2)` の 2 件を含む diff が配信された。resources に
    変化がない間は差分が飛ばない（round2 によるノイズ抑制）ことも確認。
  - 別クライアントで後から接続すると、その時点の最新状態（node2 削除・node3
    追加後）の snapshot が届き、store が周期ポーリングで最新化されていることを
    確認。
  - `command`（addWorkbench）を送ると `commandResult`（commandId 一致・
    ok=false・"command handling is not implemented yet"）が返ることを確認。
    操作系は後続 Phase の範囲であり、A 層時点でスタブ応答なのは仕様どおり。
- 決定事項・注意点:
  - 検証で使った busybox コンテナは node と分類され clientType が代表プロセス名
    "sleep" になる。実プロファイル（reth/lighthouse/foundry）では KNOWN_CLIENTS/
    WORKBENCH_TOOLS に一致するため、実環境での clientType/kind 判定はステップ 2 の
    ノード環境と合わせて別途確認する余地がある（本検証はダミーコンテナでの
    A 層パイプライン疎通の確認）。
  - テスト用コンテナ・起動した collector プロセスはいずれも後片付け済み。
  - PLAN.md ステップ 3 の collector 項目（#7〜#9）は qa/collector で担当が
    明示的に分かれていないため、collector が付けたチェックはそのままとする
    （本検証で完了条件を満たすことを確認済み）。

### 2026-07-04 Issue #10 storage.test.ts のフォールバック検証を環境非依存に修正
- 担当: tester
- ブランチ: issue-10-frontend-a-layer
- 内容: `packages/frontend/src/platform/storage.test.ts` が特定環境で 1 件
  失敗していた問題を修正した。
  - 旧テストは「jsdom 環境では localStorage が未定義なのでメモリフォールバックが
    使われ、インスタンス間で共有されない」という前提だった。しかし
    `vite.config.ts` が jsdom に url を与えている（localStorage を使えるように
    する意図的な設定）ため、Node の experimental localStorage が有効な環境や
    テスト全体を通しての初期化順によっては実際の localStorage が返り、状態が
    共有されて 2 つ目のテスト（`expected '1' to be null`）が落ちていた。
  - テストを書き換え、各ケースの `beforeEach` で `globalThis.localStorage` を
    `Object.defineProperty` で明示的に差し替える方式にした。`afterEach` で元の
    ディスクリプタを復元する。これにより実行環境の localStorage 有無に依存せず、
    「使える localStorage があるときはそれを共有して使う」「無いときはメモリ
    フォールバックが返りインスタンス間で共有しない」の両分岐を決定的に検証する。
  - 追加観点として「localStorage へのアクセスが例外を投げる場合（プライベート
    モード相当）もフォールバックへ切り替わる」ケースを追加（`isUsable()` の
    try/catch 経路の検証）。テスト数は 2 → 5 に増加。
- 決定事項・注意点:
  - 実装（`storage.ts`）は変更していない。テストの前提が実装の設計意図
    （`isUsable()` が実際に使える storage を検出したら使う）とずれていたのが
    原因で、テスト側を実装に合わせた。
  - 検証は `pnpm --filter @chainviz/frontend build` と `test` が通ることに加え、
    global localStorage を注入する setupFiles（旧テストが必ず落ちる条件）付きの
    一時 vitest 設定でも 5 件全通過することを確認した。

### 2026-07-04 Issue #22・#23・#24 B層（P2P ピア接続グラフ）のフロント描画
- 担当: frontend
- ブランチ: issue-22-frontend-peer-edges
- 内容: B層として、ノードカードのあいだに P2P ピア接続を「紐」（React Flow
  エッジ）として描画する仕組みを実装した。collector 側（#19-21）は未完成の
  ため、`packages/frontend/src/websocket/mockData.ts` に PeerEdge のサンプルを
  載せて実装・確認した。
  - #22: world-state store（`world-state/store.ts`）は既に `applySnapshot` /
    `applyDiff` で PeerEdge（edgeAdded / edgeRemoved）を受信・保持していた
    （既存実装）。エッジ配列を取り出す `listEdges(state)` アクセサを
    `listEntities` と対にして追加し、テストを足した。
  - #23: `entities/peerEdge.ts` を新設。`peerEdgesToFlowEdges(edges, presentNodeIds)`
    が PeerEdge を React Flow の Edge に変換する。`fromNodeId` / `toNodeId` は
    インフラエンティティの安定 ID（= React Flow ノードの id）に対応する。
    端点が両方カードとして存在する紐だけを描き（宙ぶらりんの紐を避ける）、
    P2P は無向なので同一 networkId・同一ペアは向きが逆でも 1 本にまとめる。
    エッジをカードに留めるため `InfraNodeCard` に source / target の Handle を
    追加した（CSS で不可視化）。`Canvas` は edges を受け取り、ノードと同じく
    ローカル state + `onEdgesChange` で保持する。`App` が state のエッジと
    現在のノード id からエッジを算出して Canvas に渡す。
  - #24: `networkId` 単位のグルーピング。`networkIdColor(networkId)` で
    networkId から決定的に色を選び、エッジの stroke と className に反映する。
    `groupEdgesByNetwork` で networkId ごとに集計できる。現状の Ethereum
    プロファイル 1 つでは networkId は 1 種類（`1337`、profiles/ethereum の
    CHAIN_ID と一致）のため既定のスナップショットの見た目には差が出ないが、
    将来の複数チェーン比較（Phase 6 以降）に備えて仕組みを用意した。
  - glossary: B層向けの用語ファイル `glossary/ethereum/terms/b-network.yaml`
    を追加（p2p / peer / discovery / gossip、layer: b-network）。`glossary/data.ts`
    でマージして読み込む。
- 決定事項・注意点:
  - `packages/shared` の型変更は不要だった。PeerEdge / DiffEvent（edgeAdded /
    edgeRemoved）は既に定義済み。
  - モックデータは、既定の `createMockSnapshot()` は実環境どおり networkId
    1 種類（reth-node-1 ⇄ reth-node-2 の 1 本）にとどめ、実環境の見た目に
    影響しないようにした。#24 のグルーピングを目視・テストで確認するための
    2 ネットワークのサンプルは別関数 `createMultiNetworkMockSnapshot()` として
    切り出し、既定の App では使わない。
  - #25（ブロック伝播パルスアニメーション）は今回のスコープ外。collector 側の
    ブロックタイミングデータ（#20-21）が固まってから別途着手する。
  - 検証: `pnpm --filter @chainviz/frontend build` / `test`（145 件全通過）/
    `eslint packages/frontend/src` がいずれも通ることを確認した。実データとの
    疎通確認は collector 側完成後に qa が行う。

### 2026-07-04 Issue #22・#23・#24 B層描画のテスト強化（異常系・境界値）
- 担当: tester
- ブランチ: issue-22-frontend-peer-edges
- 内容: 実装担当が書いた基本テストに、エッジケース・異常系・境界値のテストを
  追加した（実装コードは変更していない）。テスト件数は 145 → 171（+26）。
  - `entities/peerEdge.test.ts`:
    - `networkIdColor`: 空文字列・特殊文字（日本語/中国語/空白/タブ）・
      500 件の networkId でいずれもパレット範囲内の色を返すことを確認。
    - `networkClassToken`: 空文字列・全文字が不正な場合・既に安全な
      ハイフン/アンダースコアの保持。
    - `peerEdgesToFlowEdges`: 空配列、present が空、source 側端点の欠落、
      両端点の欠落、完全重複エッジの排除、1 バッチ内で自己ループ・宙ぶらりん・
      有効エッジが混在する場合の選別、逆向き × 別 networkId が別の紐になること、
      並べ替え後も data.networkId が元の値を保つこと、className だけが
      サニタイズされ id キーには生の networkId が使われること、
      クラストークンが衝突する networkId 同士を別扱いすること。
    - `groupEdgesByNetwork`: 同一 networkId の複数エッジが 1 バケットに
      まとまること、data 欠落エッジが空文字バケットへ落ちること。
  - `world-state/store.test.ts`（edgeAdded / edgeRemoved の差分適用）:
    - edgeAdded が入力配列を破壊しないこと、edgeRemoved の逆向き指定では
      一致しないこと、edgeRemoved が同一ペアの複数 networkId エッジを
      まとめて消すこと、edgeAdded の重複判定が networkId を無視すること、
      エッジとエンティティのイベント混在バッチ、別バッチでの追加→削除。
    - `listEdges`: 最後のエッジ削除後に空配列へ戻ること。
  - `websocket/mockData.test.ts`: `createMultiNetworkMockSnapshot()` を
    描画変換（peerEdgesToFlowEdges → groupEdgesByNetwork）まで通し、
    宙ぶらりんが出ず 2 グループに分かれることの結合テストを追加。
- 決定事項・注意点:
  - 差分プロトコル上、`edgeRemoved` は networkId を持たない
    （`DiffEvent` の定義）。store 側の edgeAdded 重複判定も (from, to) のみで
    networkId を見ないため、同一ペアで networkId 違いの 2 本目は追加されない。
    一方、描画側 `peerEdgesToFlowEdges` は networkId 違いを別の紐として扱う。
    この非対称性は、同一ノードペアが複数ネットワークで同時にピア接続する
    という稀なケースでのみ表面化する既知の制約として、store 側にテストと
    コメントで記録した（現状の実環境では networkId は 1 種類のため実害なし）。
  - 検証: `pnpm --filter @chainviz/frontend test`（171 件全通過）/ `build` /
    追加した 3 ファイルへの `eslint` がいずれも通ることを確認した。
### 2026-07-04 Issue #19・#20・#21 Phase 2 collector（B層 P2Pグラフのデータ収集）
- 担当: collector
- ブランチ: issue-19-peer-edges-lighthouse
- 内容: `packages/collector/` に B層（P2Pグラフ）のデータ収集を実装した。
  A層と同じく collector が唯一の集約点として振る舞い、Ethereum 固有の語彙
  （Beacon API・eth_subscribe・reth/lighthouse・ポート番号）は
  `adapters/ethereum/` の内側に閉じ込め、共通層（world-state/）には PeerEdge /
  BlockEntity のチェーン非依存な型でしか出さない。
  - **#19 ピア接続 → PeerEdge**: lighthouse beacon の Beacon API を周期
    ポーリングして接続関係を PeerEdge へ正規化する。
    - `adapters/ethereum/http-client.ts` … GET 専用の JSON HTTP クライアント抽象
      （`HttpClient`）と fetch 実装。IO 境界なのでモック可能にし本体はテスト対象外
      （dockerode-client.ts と同じ扱い）。
    - `adapters/ethereum/beacon-api.ts` … `GET /eth/v1/node/identity`（自ノードの
      peer_id）と `GET /eth/v1/node/peers?state=connected`（接続中ピアの peer_id）を
      叩く。Beacon API のパス・レスポンス形状はここに閉じる。`BEACON_API_PORT=5052`。
    - `adapters/ethereum/targets.ts` … Docker の観測値から到達先を決める。ビーコン
      対象は「consensus クライアント（lighthouse 等）かつ compose サービス名に
      `beacon` を含む」もの。**validator コンテナは同じ lighthouse クライアントだが
      Beacon API を持たない**ため、サービス名で除外するのが要点（classify.ts の
      detectClientType は beacon/validator を区別できない）。
    - `adapters/ethereum/peers.ts` … `toPeerEdges()`。全ノードの peer_id → 安定識別子
      （NodeEntity.id）対応表を作り、接続先 peer_id を安定識別子へ解決してエッジ化。
      観測対象外ピアは落とし、自己ループを除外し、A→B と B→A は無向エッジ 1 本に
      畳む（from/to は安定 ID 昇順に正規化）。peer_id はワールドステートに漏らさない。
    - networkId は安定識別子の project 部分から `<project>-consensus` を導く
      （例: `chainviz-ethereum-consensus`）。frontend #24 のネットワーク単位
      グルーピング用。将来 Phase 3 で EL 間 P2P を足すときに consensus/execution を
      別ネットワークとして区別できるよう suffix を付けてある。
  - **#20 ブロック受信時刻の記録**: 各 reth(EL) の eth_subscribe(newHeads) を購読し、
    collector がブロックを受信した実時刻をノード単位で記録する。
    - `adapters/ethereum/eth-ws-client.ts` … WS JSON-RPC クライアント抽象
      （`EthWsClient`）と ws 実装。eth_subscribe / eth_subscription の語彙はここに閉じる。
      IO 境界なのでモック可能。EL の WS ポートは `EXECUTION_WS_PORT=8546`。
    - `adapters/ethereum/blocks.ts` … `BlockPropagationTracker`。ブロックハッシュを
      キーに、どのノードがいつ受信したかを `receivedAt: Record<nodeId, epochMs>` へ
      マージしていく純粋トラッカー。同一ノードの再通知では最初の受信時刻を保持
      （波の起点を安定させる）。newHeads ヘッダの hex（number/timestamp）を数値化。
      保持数の上限（既定 200、超過で古いブロックから eviction）でメモリを抑える。
  - **#21 world-state store 経由の配信**:
    - `world-state/diff.ts` … `computeEdgeDiff()` と `edgeKey()` を追加。エッジの
      同一性は from/to/networkId の 3 つ組で判定し、追加は edgeAdded、消滅は
      edgeRemoved（shared の型どおり from/to のみ載せる）。エッジには「更新」概念を
      設けない（差異＝別エッジ）。ブロックは既存 computeDiff にそのまま乗る
      （hash キーのエンティティ）。
    - `world-state/store.ts` … `applyPeers(edges)` と `applyBlock(block)` を追加し、
      `applyEvent` の edgeAdded/edgeRemoved を「A層では扱わない」スキップから実装へ
      置き換えた。applyPeers は前回エッジ集合との差分を計算・適用。applyBlock は
      当該ブロックだけを差分計算し他エンティティ・エッジには触れない。
    - `index.ts` … main() で `adapter.subscribePeers(...)`（差分を applyPeers →
      broadcast）と `adapter.subscribeBlocks(...)`（applyBlock → broadcast）を配線。
    - `adapters/ethereum/index.ts` … `pollPeersOnce()`（1 巡ポーリングして PeerEdge[]）、
      `subscribePeers()`（自己スケジューリングの周期ループ。startPollingLoop と同じ
      重複実行防止）、`subscribeBlocks()`（EL ノードを列挙し各ノードへ永続 WS 購読）、
      `dispose()`（ループ停止・購読 close）を実装。http/ws クライアントと時刻ソースは
      コンストラクタから注入可能（既定は実装、テストでモック）。
- 決定事項・注意点:
  - **shared の型変更は不要**だった。PeerEdge・BlockEntity・DiffEvent の
    edgeAdded/edgeRemoved・BlockEntity.receivedAt はすべて既存定義のまま使えた。
  - **ChainAdapter インターフェースには subscribeBlocks が無い**。ブロック伝播は
    B層だが、shared の ChainAdapter は subscribePeers（B層）と subscribeChainEvents
    （C層 Phase 3）しか持たない。ブロック受信時刻の購読は EthereumAdapter の
    具象メソッド `subscribeBlocks()` として追加した（index.ts は具象型を参照して
    いるので shared 変更なしで済む）。将来 shared に B層のブロック購読を正式に
    加えるか要検討（reviewer と調整の余地）。
  - **receivedAt のマージは adapter 側で行う**。computeDiff の patch はトップレベル
    フィールド単位の置換なので、ノードごとに別々の receivedAt を投げると上書きで
    消えてしまう。BlockPropagationTracker が hash 単位でマージ済みの完全な
    receivedAt を毎回投げ、store はそれを丸ごと反映する形にした。
  - **collector はホストで直接動き、Docker ブリッジ上のコンテナ内部 IP に到達
    できる**前提。Beacon API（5052）も reth WS（8546）もホスト非公開ポートだが
    `http://<内部IP>:5052` / `ws://<内部IP>:8546` で直接叩ける。到達先 IP・ポートは
    Docker 観測値から組み立てる。
  - **subscribeBlocks は起動時に一度だけ EL ノードを列挙して永続 WS を張る**。
    ノード再起動で IP が変わった場合の再購読は未対応（Phase 2 デモの範囲では
    ノードは安定している前提）。必要になれば周期再列挙を足す。
  - テスト: 純粋ロジック（peers / blocks / targets / beacon-api / diff の edge /
    store の applyPeers・applyBlock）と adapter の pollPeersOnce・subscribePeers・
    subscribeBlocks をモック（HttpClient / EthWsClient / DockerPoller）で単体化。
    collector 全体で 180 テスト pass、`pnpm --filter @chainviz/collector build` /
    `test` 通過。加えて起動中の `profiles/ethereum` に対する実機スモークで、
    beacon1↔beacon2 の PeerEdge 検出と、12 ブロックすべてで reth1/reth2 両方の
    receivedAt が数 ms 差で記録されることを確認した。

### 2026-07-04 Issue #19・#20・#21 B層 collector 実装のテスト強化（異常系・境界値）
- 担当: tester
- ブランチ: issue-19-peer-edges-lighthouse
- 内容: collector 実装担当が書いた基本テスト（ハッピーパス中心、180件）に対し、
  異常系・境界値・想定外入力の観点でユニットテストを追加した（新機能の実装は
  行っていない）。collector 全体で 180 → 213 テストに増加し、build / test /
  該当ファイルの lint がすべて通ることを確認した。
  - `http-client.test.ts`（新規）: 実装担当が「IO 境界のためテスト対象外」と
    していた `createFetchHttpClient` を、グローバル fetch をスタブして検証。
    2xx で JSON を返す / 4xx・5xx で status 付きエラーを投げる / JSON パース失敗を
    伝播する / タイムアウトで AbortController が発火する / 期限内に解決した
    リクエストは abort しない、をカバー。
  - `beacon-api.test.ts`: `data` が null のケース、全ピア disconnected、
    peer_id が空文字列・非文字列（数値/null）のフィルタ、fetchConnectedPeerIds の
    エラー伝播を追加。
  - `targets.test.ts`: compose サービスラベルが無い lighthouse の除外、
    サービス名の大文字小文字非依存（"BEACON1"）、"beacon" を含むが execution
    クライアントの紛らわしいコンテナの除外、project prefix を持たない stableId
    からの networkId 導出、空観測セット、ラベル無しでも execution ノードを
    選ぶことを追加。
  - `peers.test.ts`: 空入力、networkId が報告元ノード由来であること、自己参照が
    実ピアに混在した場合の自己ループ除外、同一 peer_id を複数ノードが名乗った
    場合の後勝ち解決を追加。
  - `blocks.test.ts`: parseHexNumber の大文字 hex・bare "0x"、eviction 上限
    ちょうど（追い出し無し）、maxBlocks=1、既定 200 件境界、ノードが逆順時刻で
    報告してもノードごとに最初の受信時刻を保つケースを追加。
  - `diff.test.ts`（computeEdgeDiff）: from/to を入れ替えたエッジが別物として
    扱われること（無向化は生成側の責務）、入力の重複エッジが edgeKey で畳まれる
    ことを追加。
  - `store.test.ts`: 同一ブロック再適用で差分が出ないこと、receivedAt を 3 回に
    分けて追記したとき patch が receivedAt のみになること、applyPeers のエッジ
    churn がブロックエンティティを消さないことを追加。
- 決定事項・注意点:
  - **潜在バグ（collector へ差し戻し候補）**: 同一 from/to ペアで networkId
    だけが異なるエッジの遷移で、エッジが誤って消える。`edgeRemoved` イベントは
    shared スキーマ上 from/to のみを持ち（networkId を落とす）、store.applyEvent
    の edgeRemoved が from/to 一致で全エッジを削除するため。computeEdgeDiff は
    edgeAdded を先に emit するので、`applyPeers([net-a])` 後に
    `applyPeers([net-b])`（同一ペア）を適用すると、edgeAdded(net-b) の直後に
    edgeRemoved(from,to) が net-b ごと削除し、エッジが 0 本になる（本来 net-b が
    残るべき）。実運用では toPeerEdges が from/to ペア単位で dedup し、
    networkId はペアに対し決定的（`<project>-consensus`）なので、この遷移は
    project 名が変わるなどの稀ケースでのみ発生し、次ポーリングで自己回復する
    軽微な一過性の不整合。ただし diff/store の契約としては誤りなので、
    edgeRemoved に networkId を持たせる（shared 型変更 → reviewer 調整）か、
    store で edgeKey 一致による削除に変える修正を推奨。今回は再現テストのみ
    確認し、実装は変更していない（テストにも buggy 挙動を固定化しないよう
    エンコードしていない）。

### 2026-07-04 Issue #19〜#21 B層 collector 実装のレビューと edgeRemoved 型の修正
- 担当: reviewer
- ブランチ: issue-19-peer-edges-lighthouse
- 内容: collector 実装（#19〜#21）と tester のテスト強化を静的レビューした。
  ChainAdapter 境界（Beacon API・eth_subscribe・reth/lighthouse・ポート番号と
  いった Ethereum 固有語彙が `adapters/ethereum/` の内側に閉じ、world-state /
  shared にはチェーン非依存の型しか出ていない）、1ファイル1責務、循環依存
  なし、既存プロファイルへの分岐追加なし、をいずれも問題なしと確認。
  `pnpm lint` / `pnpm build` / `pnpm test` の全通過も確認した
  （collector 214・frontend 125・shared 全通過）。
- 修正（tester 報告の networkId バグへの対応）:
  - `packages/shared/src/events/index.ts` の `edgeRemoved` に
    `networkId: string` を必須フィールドとして追加した。エッジの同一性キーは
    from/to/networkId の 3 つ組（collector の `edgeKey()` と同義）なのに、
    削除イベントだけがキーの一部（networkId）を欠いており、同一ペア別
    networkId のエッジを巻き込んで消す契約上の欠陥だったため。frontend
    （#22）がこのイベントを消費し始める前の今が最小コストで直せる時点と判断。
  - `packages/collector/src/world-state/diff.ts` … `computeEdgeDiff()` が
    edgeRemoved に networkId を載せるよう修正。
  - `packages/collector/src/world-state/store.ts` … `applyEvent()` の
    edgeRemoved 処理を from/to/networkId の 3 条件一致に修正。
  - collector のテスト期待値を更新し、tester 報告の再現手順
    （`applyPeers([net-a])` → 同一ペアで `applyPeers([net-b])` でエッジが
    0 本になる）を退行防止テストとして `store.test.ts` に追加（213→214）。
  - `packages/frontend/src/world-state/store.test.ts` の edgeRemoved リテラル
    3 箇所に networkId を追記した（**型互換のための機械的変更のみ**。frontend
    の `applyDiff` が edgeRemoved / edgeAdded の一致判定に networkId を
    使っていない同種の問題は残っており、issue-22 ブランチ側で対応すること）。
  - `docs/ARCHITECTURE.md` §2 の DiffEvent スニペットを実装に同期した。
- 判断事項:
  - `subscribeBlocks()` を ChainAdapter インターフェースへ載せず
    EthereumAdapter の具象メソッドとした実装は**妥当**と判断。現状プロファイル
    は 1 つで、`index.ts` は具象型を配線しており、先回りのインターフェース
    拡張は CLAUDE.md「先の Phase のための先回り実装をしない」に反する。
    2 つ目のチェーンプロファイル追加（Phase 6）の際に `subscribeBlocks` /
    `dispose` の ChainAdapter への昇格を再検討する。
- 注意点（差し戻しはしないが後続で扱うべき事項）:
  - `WorldStateStore` はブロックエンティティを無制限に蓄積する
    （`BlockPropagationTracker` は 200 件で eviction するが store 側に上限が
    ない）。長時間運用でスナップショットとメモリが際限なく成長するため、
    store 側にもブロック保持上限を入れる後続 Issue を推奨。
  - `eth-ws-client` に再接続処理はなく、`subscribeBlocks` の対象列挙も起動時
    1 回のみ（collector の記録どおり。Phase 2 デモの範囲では許容）。

### 2026-07-04 Issue #19・#20・#21 B層P2Pグラフ（collector）実機検証
- 担当: qa
- ブランチ: issue-19-peer-edges-lighthouse
- 内容: 未コミットの collector 実装（Beacon API ポーリングによる PeerEdge 正規化、
  reth の eth_subscribe(newHeads) 購読によるブロック受信時刻記録、world-state
  store 経由の WebSocket 配信）を実環境で動かして検証した。
  - `profiles/ethereum` の全コンテナ起動を確認（reth1/reth2/beacon1/beacon2/
    validator1/validator2/workbench）。ホストから各コンテナIP経由で Beacon API
    (5052) と reth HTTP(8545) に到達可能なことを確認した。
  - `pnpm --filter @chainviz/collector build` および全体 `pnpm build` 成功。
  - `packages/collector/dist/index.js` を起動し、ポート4000で待ち受け・エラー
    ログなしを確認。
  - WebSocket クライアントで接続し、初回スナップショットの `edges` に
    beacon1↔beacon2 の PeerEdge（networkId=chainviz-ethereum-consensus）が
    含まれることを確認。
  - ブロック伝播タイミング: スナップショットの各 BlockEntity.receivedAt に
    reth1・reth2 両方の stableId がキーとして記録され、15ブロックすべてで
    2ノード分・3〜6ms の意味のある差分を持ち、先着ノードが reth1/reth2 で
    入れ替わる実データになっていることを確認。
  - `docker stop chainviz-ethereum-beacon2-1` で edgeRemoved が配信され、
    `docker start` で edgeAdded が再配信されることを確認。ピア消失中も
    collector はエラーを出さずグレースフルに継続した。
  - `pnpm lint && pnpm build && pnpm test` 全通過（collector 214 / frontend 125）。
- 判定: ステップ4のうち collector 側が担う完了条件「ノード同士がP2Pエッジで
  繋がる」「ブロック伝播タイミングの実データが取れている」を満たす。#19・#20・#21
  合格。frontend側統合（#22-25）は別ブランチで進行中のため対象外。
- 注意点: WORKLOG に既記載の後続事項（store側のブロック保持上限、
  eth-ws-client の再接続なし・購読対象の起動時1回列挙）は Phase 2 デモ範囲では
  許容と判断。検証上の問題は検出しなかった。

### 2026-07-04 Issue #22・#23・#24 B層フロント描画のレビューとエッジ一致判定の修正
- 担当: reviewer
- ブランチ: issue-22-frontend-peer-edges
- 内容: frontend 実装（#22-24）と tester のテスト強化を静的レビューし、
  collector 側レビュー（#19-21）から申し送りされていた「frontend store の
  エッジ一致判定が networkId を見ない」問題を修正した。
  - `packages/frontend/src/world-state/store.ts` … `applyDiff` の
    edgeAdded / edgeRemoved の一致判定を fromNodeId / toNodeId / networkId の
    3 条件一致に修正（collector 側 `world-state/diff.ts` の `edgeKey()` と
    同じ同一性キー。ARCHITECTURE.md §2 の DiffEvent 定義と整合）。
  - `packages/frontend/src/world-state/store.test.ts` … tester が「現状挙動」
    として固定していた 2 テスト（edgeRemoved が同一ペアの全 networkId を
    巻き込んで消す / edgeAdded の重複判定が networkId を無視する）を、
    修正後の正しい契約（networkId 一致のみ削除 / networkId 違いは別エッジ
    として両方保持）のテストに書き換えた。networkId 違いの edgeRemoved では
    何も消えず参照が保たれる負のケースを 1 件追加（frontend 171→172 件）。
    型必須化により networkId を欠いていた edgeRemoved リテラル 4 箇所も補完。
  - 描画側 `entities/peerEdge.ts` の「networkId 違いは別の紐として 2 本描く」
    設計と store 側の保持ルールが一致することを確認した（従来は store が
    2 本目を落とすため描画に届かない非対称があった。今回の修正で解消）。
- レビュー結果（修正以外は指摘なし）:
  - 境界の遵守: frontend は Docker / ノード API に触れておらず、チェーン固有の
    RPC 語彙の漏れもない（`reth` / `lighthouse` は shared の `clientType` の
    データ値であり許容）。循環依存なし（madge で確認）。
  - glossary: `glossary/ethereum/terms/b-network.yaml` は ARCHITECTURE.md §5 の
    スキーマ（name/definition の {ja, en}、layer、relatedTerms）に整合。
    relatedTerms の参照先はすべて同ファイル内に存在する。
  - テストの質: tester 追加分（peerEdge の特殊文字 networkId・端点欠落・
    クラストークン衝突、mockData→描画変換の結合テスト等）は異常系・境界値を
    実質的に検証しており妥当。
  - `pnpm lint` / `pnpm build` / `pnpm test` 全通過
    （shared 39 / collector 214 / frontend 172）。
- 決定事項・注意点:
  - **main マージ直後の時点では `pnpm build` が通らない状態だった**
    （collector 側 PR #26 で `DiffEvent.edgeRemoved` の networkId が必須化
    されたのに対し、当ブランチの store.test.ts のリテラル 4 箇所が未追随）。
    今回の修正で解消したが、マージコンフリクト解消時はコンフリクトの有無に
    かかわらずルートで build まで回して確認すること。
  - feat コミット（8afaf21）に実装・テスト・glossary データ追加が同居している。
    A層では用語データを別 Issue（#14）にしていた前例があり、粒度としては
    分けるのが望ましかったが、B層は glossary 用の Issue が無く機能の一部と
    して追加された経緯のため許容と判断（履歴の書き換えはしない）。
  - 本修正はレビュー担当が直接実装した。shared の型変更（PR #26）が起点の
    契約整合の後始末であり、統括からの明示的な依頼に基づく例外的な対応。

### 2026-07-04 Issue #22・#23・#24 B層フロント描画（P2Pエッジ・グルーピング）実機検証
- 担当: qa
- ブランチ: issue-22-frontend-peer-edges
- 内容: reviewer の静的レビュー（networkId 一致判定の修正）まで反映済みの
  状態で、frontend を実際に起動して以下を検証した。判定はステップ4の
  完了条件のうち frontend が担う「ノード同士が P2P エッジで繋がる」
  「ネットワーク単位でグルーピングされる」の 2 点（#25 のパルスアニメーションは
  スコープ外）。
  - モック起動（`createMockSnapshot`）: Playwright でキャンバスを描画確認。
    reth-node-1 ↔ reth-node-2 の間にピアエッジが 1 本描画され、lighthouse-1 /
    workbench-alice には紐が付かない（宙ぶらりんの紐なし）ことを確認。
    エッジの class に networkId トークン（`peer-edge--net-1337`）が付き、
    stroke 色が networkId 由来の色になっていることを確認。
  - マルチネットワーク（`createMultiNetworkMockSnapshot` を流す一時エントリを
    作成して確認・確認後に削除）: networkId `1337`（黄 #f5b544）と `2337`
    （紫 #c77dff）の 2 本のエッジが別色で描画され、networkId 単位で
    見分けられることを確認。
  - 実 collector との統合: `profiles/ethereum` 稼働中の Docker に対し main
    ブランチの collector を起動（ポート 4000）、当 frontend ブランチを
    `VITE_COLLECTOR_URL=ws://localhost:4000` で起動。ノード 7 個（beacon1/2、
    reth1/2、validator1/2、workbench）が表示され、beacon1 ↔ beacon2 の間に
    ピアエッジ 1 本（networkId=`chainviz-ethereum-consensus`）が描画される
    ことを確認。ノードをドラッグするとエッジが端点に追従して曲線を描くことも
    確認した。ブラウザコンソール・ページエラーは 0 件。
  - `pnpm lint` / `pnpm build` / `pnpm test` 全通過（shared 39 / collector 214 /
    frontend 172）。
- 判定: #22・#23・#24 の完了条件を満たす。合格。
- 決定事項・注意点:
  - collector が配信する PeerEdge の `fromNodeId` / `toNodeId` は NodeEntity.id
    （例: `chainviz-ethereum/beacon1`）と一致しており、frontend の
    `peerEdgesToFlowEdges` が要求する「両端点が描画中ノードとして存在する紐だけ
    描く」条件を満たす。実データでの端点解決に問題はない。
  - 実環境の networkId は現状 1 種類（`chainviz-ethereum-consensus`）のため、
    複数ネットワークの色分けは実データでは再現できずモックで確認した。これは
    ARCHITECTURE / 実装の想定どおり。

### 2026-07-04 Issue #25 ブロック伝播パルスアニメーションの実装
- 担当: frontend
- ブランチ: issue-25-block-propagation-pulse
- 内容: collector が記録するブロックの受信実時刻（`BlockEntity.receivedAt`）を
  もとに、P2P エッジ上をパルス（光の点）が伝播していくアニメーションを実装した。
  - `packages/frontend/src/entities/blockPulse.ts` … タイミング計算の純粋関数群。
    `computeBlockPulses(block, edges)` が受信時刻差からエッジ単位のパルス区間
    （出発点/到達点・進行方向・波の起点 t0 からの出発遅延・所要時間）を算出する。
    `waveOriginTime` / `latestReceiptTime` / `isFreshBlock`、および描画中パルスを
    エッジの `data.pulses` へひも付ける `attachPulsesToEdges` もここに置く。
  - `packages/frontend/src/entities/useBlockPulses.ts` … world-state のブロック
    集合を監視し、新しい伝播区間を検知して実時間へスケジューリングするフック。
    純粋計算（blockPulse.ts）と React/タイマー側の責務を分離している。
  - `packages/frontend/src/entities/PeerPropagationEdge.tsx` … `data.pulses` を
    SVG の `animateMotion` でエッジ上に走らせる React Flow カスタムエッジ。
    通常時は `BaseEdge` で紐を1本描くだけ。
  - `peerEdge.ts` に `EdgePulse` 型と `PEER_EDGE_TYPE` を追加し、
    `peerEdgesToFlowEdges` の出力に `type: "peer"` を付与。Canvas に edgeTypes を
    登録。App でブロックを抽出→`useBlockPulses`→`attachPulsesToEdges`→Canvas と
    つないだ。styles.css にパルスの発光スタイルを追加。
- 決定事項・注意点:
  - **最低表示時間フロア（`MIN_PULSE_DURATION_MS = 450`）**: 実環境ではノード間の
    受信差が数 ms しかなく、そのままでは瞬間移動になり波に見えない。docs/CONCEPT.md
    の方針に従い、演出の誇張ではなく「実差分が知覚不能なときの UX 上の最低表示
    時間」としてフロアを設けた。実差分がフロアより大きければ実データの差分を
    そのまま使う（tc netem で実遅延が数百 ms 単位になれば実データが支配する）。
    フロアはあくまで下限で、上限キャップは設けていない（実データを尊重する）。
  - **伝播方向の決め方**: 各エッジについて receivedAt の早い側を出発点・遅い側を
    到達点とする。エッジは端点を [小, 大]（source=小, target=大）に正規化して
    いるため、大側が先に受信した場合は `reverse=true` として animateMotion を
    逆走させる。片側しか受信していないエッジは方向が確定しないためパルスを
    描かない。
  - **波のスタッガーの2経路**: 差分がノードごとに逐次届く場合は、collector から
    届くタイミングそのものが実際の伝播スタッガーになる。複数ノード分の受信が
    1回の差分にまとまって届く場合は、各区間の `startDelayMs`（波の起点 t0 からの
    出発遅延）を使ってブラウザ側でスタッガーを再現する（ブロック初回検知時の
    ブラウザ時刻を波の起点にアンカーする）。
  - **鮮度ガード（`DEFAULT_FRESHNESS_MS = 6000`）**: 再接続時のスナップショットに
    含まれる過去ブロックを一斉に光らせないよう、最新受信時刻が現在から 6 秒以内の
    ブロックだけをアニメーション対象にする。現在の block 集合から消えたハッシュの
    アンカー/既知エッジはフックが掃除する（メモリ肥大の防止）。
  - **`packages/shared` の型変更は不要だった**。`BlockEntity.receivedAt` が既に
    ノード安定ID→受信実時刻の Record を持っており、そのまま使えた。
  - テスト: `blockPulse.test.ts`（純粋関数のタイミング計算・方向・フロア・
    startDelay・attach）と `useBlockPulses.test.tsx`（fake timers による
    スケジューリング・重複排除・鮮度ガード・除去）を追加。frontend 全体で
    207 tests 通過、`pnpm build` も通過。
  - これでステップ4（Phase 2 B層）の全 Issue（#19〜#25）が完了。完了条件
    「ノード同士が P2P エッジで繋がり、ネットワーク単位でグルーピングされ、
    ブロック伝播タイミングで実データに基づくパルスがエッジ上を伝わる」を満たす。

### 2026-07-04 Issue #25 ブロック伝播パルスのテスト強化
- 担当: tester
- ブランチ: issue-25-block-propagation-pulse
- 内容: 実装担当が書いた基本テストに対し、異常系・境界値・特殊遷移の観点で
  ユニットテストを追加した（新機能の実装・ロジック変更はしていない）。
  frontend 全体で 207 → 229 tests（+22）に増え、全件通過・`pnpm build` 通過を確認。
  - `blockPulse.test.ts`（+17）:
    - `waveOriginTime` / `latestReceiptTime`: 負の epoch オフセット、単一受信、
      NaN 混入時の挙動（min/max が NaN に汚染されることの特性テスト）。
    - `isFreshBlock`: 鮮度境界の等値（ちょうど 6000ms は fresh／inclusive）、
      `maxAgeMs=0`、判定が `block.timestamp` ではなく受信時刻のみを見ること、
      NaN 受信を安全側（stale）に倒すこと。
    - `computeBlockPulses`: 受信ノード同士を繋ぐエッジが無いケース、対象外エッジ
      混在時に対象のみ抽出、波に無関係な受信ノードの無視、フロア境界の等値・
      直下、逆走エッジでの startDelay 併用、負の epoch、NaN 直接呼び出し時の
      durationMs=NaN（防御が無いことの特性テスト）。
    - `attachPulsesToEdges`: 存在しないエッジ向けパルスの破棄と参照維持、
      別ブロック由来のパルスが同一エッジに同居するケース。
  - `useBlockPulses.test.tsx`（+5, fake timers）:
    - 別ハッシュの 2 ブロックが同一エッジ上で同時にパルスを走らせるケース、
      ブロックが store から消えて再登場した際に掃除済みで再スケジュールされること、
      アンマウント時に保留タイマーが片付き後続の setState が起きないこと、
      NaN 受信ブロックが鮮度ガードで弾かれること、
      ブロック更新後にエッジが届いても再計算しない設計上の制約（deps=[blocks]）。
- 決定事項・注意点:
  - **NaN 受信の扱いは 2 段階**: `isFreshBlock` が NaN を含むブロックを stale と
    判定するため、`useBlockPulses` 経由ではパルス計算に到達せず安全。一方で
    `computeBlockPulses` を純粋関数として直接呼ぶと NaN が `durationMs` へ伝播し、
    `animateMotion` の `dur` が `"NaNms"` になりうる。現状 collector は `Date.now()`
    由来のため実害は無いが、純粋関数側にサニタイズが無い点は堅牢性の改善余地
    として frontend 担当に共有（バグではなく防御の未実装。今回は実装は変更せず
    特性テストで挙動を固定するに留めた）。
  - 既存テスト・実装ロジックは一切変更していない。

### 2026-07-04 Issue #25 ブロック伝播パルスの静的レビュー（NaN サニタイズ修正を含む）
- 担当: reviewer
- ブランチ: issue-25-block-propagation-pulse
- 内容: Issue #25 の実装（frontend）とテスト強化（tester）を静的にレビューした。
  - 設計整合: 最低表示時間フロア（450ms）は「実データの相対順序・比率を尊重し、
    実差分がフロアを超えればそのまま使う」実装になっており、docs/CONCEPT.md
    「ブロック伝播のリアルタイム表現」の方針（演出として誇張しない・実データに
    基づく波）と矛盾しない。上限キャップを設けず tc netem 導入時に実データが
    支配する点も CONCEPT.md の決定事項どおり。
  - 境界: frontend は `BlockEntity.receivedAt`（チェーン非依存スキーマ）だけを
    参照しており、Docker / ノード API への直接アクセスやチェーン固有語彙の
    ロジックへの漏れはない。責務分離（純粋計算 blockPulse.ts / スケジューリング
    useBlockPulses.ts / 描画 PeerPropagationEdge.tsx）も適切で、循環依存なし。
  - `packages/shared` の型変更不要の判断は妥当（`receivedAt:
    Record<nodeId, epoch ms>` が既に必要十分）。
  - tester 申し送りの NaN 問題は「修正すべき」と判断し、レビューの一環として
    blockPulse.ts に反映した: 有限数でない受信時刻（NaN / ±Infinity）を
    「未受信」として扱う（`finiteReceiptTimes` ヘルパーを追加し
    `waveOriginTime` / `latestReceiptTime` が非有限値を無視、
    `computeBlockPulses` が非有限値の端点を持つエッジをスキップ）。
    純粋関数を直接呼んでも `dur="NaNms"` が生成されなくなり、壊れた受信値が
    1つあっても健全なエッジの波は描かれ続ける（優雅な劣化）。
    挙動変更に伴い特性テスト3件を新契約のテストに置き換え、
    latestReceiptTime の非有限値・部分的破損時の波継続の2件を追加
    （frontend 229 → 231 tests）。なお `isFreshBlock` は
    「有限な受信が1つでも鮮度ウィンドウ内なら fresh」に変わるが、
    非有限値側のエッジは computeBlockPulses が弾くため安全性は保たれる。
  - blockPulse.ts のコメントにあったチェーン固有語彙「newHeads」を
    「ブロック受信実時刻」に改めた（ChainAdapter 境界の語彙規約に合わせる。
    コメントのみで動作変更なし）。
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過を確認
    （collector 214 / frontend 231）。
- 決定事項・注意点:
  - まだ未コミット。コミット時は関心事ごとに分けること（実装 / テスト強化 /
    レビュー修正、少なくとも3コミット。docs 更新の扱いは規約に従う）。
  - 動作検証（実際にパルスが波として見えるか、再接続時に過去ブロックが
    光らないか）は chainviz-qa に委ねる。

### 2026-07-04 Issue #28 reth(EL)のブロック受信時刻をbeacon(CL)のstableIdへ対応付け（テスト強化）
- 担当: tester
- ブランチ: issue-25-block-propagation-pulse
- 内容: collector 側 #28 実装（`targets.ts` の `serviceNodeKey` /
  `beaconStableIdForExecution` / `ExecutionTarget.receivedAtKey`、
  `index.ts` の `subscribeBlocks` が `receivedAtKey` で記録）に対し、
  異常系・境界値・クロス汚染の観点でユニットテストを追加した
  （collector 221 → 233 tests）。実装コードは変更していない。
  - `targets.test.ts`（+9）:
    - `executionTargets`: 対応 beacon を持つ reth と持たない reth の混在で
      後者が自身の stableId にフォールバックしクロス汚染しないこと、全 reth が
      フォールバックする構成、非 reth（geth）でも beacon へ対応付くこと。
    - `beaconStableIdForExecution`: サフィックス無し reth が番号付き beacon を
      誤って掴まないこと、役割プレフィックスの大文字小文字非依存な剥離、
      数字以外のノード群キー（reth-a / beacon-a）での一致、observations 空配列、
      サービスラベル欠落の beacon 候補を飛ばすこと、同一ノード群キーの beacon が
      複数（別プロジェクト）ある場合は観測順で最初を返すこと。
  - `peer-block-adapter.test.ts`（+3、`gethFixture` 追加）:
    - beacon 皆無の EL only 構成で各 reth 自身のキーに束ねられること、
      beacon 対応 reth と非対応 reth が 1 ブロックの receivedAt に混在すること、
      2 つの execution（reth1 / geth1、ノード群キーがともに "1"）が同一 beacon に
      対応付く場合に receivedAt が 1 キーへ畳まれ初回受信時刻のみ残ること。
- 決定事項・注意点:
  - `beaconStableIdForExecution` はノード群キー（サービス名から役割プレフィックス
    を剥がした残り）だけで対応を取り、stableId のプロジェクト接頭辞を見ない。
    このため別プロジェクトに同名 beacon サービス（例: `beacon1`）が同時に存在
    すると観測順で最初にヒットした beacon を返す（クロスプロジェクト対応の
    可能性）。単一チェーンプロファイル運用では問題にならないが、複数プロファイル
    を同時に観測する構成を将来入れる場合は要注意。現時点ではバグではなく
    仕様上の制約として特性テストで挙動を固定した。
  - 同様に、ノード群キーが衝突する 2 つの execution（reth1 と geth1 など）が
    同一 beacon に対応付くと、`BlockPropagationTracker` のキーごと初回優先と
    相まって receivedAt が 1 キーに畳まれ片方のノードの受信時刻が失われる。
    通常構成（1 ノード群 = 1 EL + 1 beacon）では発生しないが、記録キーが
    論理ノード単位である以上の粒度差が生じる点を明示するテストを残した。
  - まだ未コミット。frontend 側 #25 の未コミット変更とは独立。
  - build（tsc -b）・collector 全 233 tests 通過を確認済み。

### 2026-07-04 Issue #28 reth→beacon ID対応付け修正の静的レビュー（#25との統合整合確認を含む）
- 担当: reviewer
- ブランチ: issue-25-block-propagation-pulse
- 内容: collector 側 #28 修正（`targets.ts` の `serviceNodeKey` /
  `beaconStableIdForExecution` / `ExecutionTarget.receivedAtKey`、`index.ts` の
  `subscribeBlocks`）と、tester の強化テストを静的にレビューした。コードの
  変更はしていない（本レビューでの修正なし）。
  - **境界の遵守**: reth/beacon の対応付け（compose サービス名から役割
    プレフィックスを剥がすノード群キーの導出を含む）は Ethereum 固有の知識
    として `adapters/ethereum/targets.ts` の中に閉じている。`packages/shared`
    や frontend にチェーン固有語彙の漏れはない。`BlockEntity.receivedAt` の
    キーは beacon の stableId（= NodeEntity.id）になり、ARCHITECTURE.md §2 の
    「`Record<nodeId, epoch ms>`」の記述とも引き続き整合する（docs 更新不要）。
  - **#25 との統合整合**: frontend の `computeBlockPulses` は
    `receivedAt[edge.source]` / `receivedAt[edge.target]` を引く。PeerEdge の
    端点は `peers.ts` が beacon の stableId で生成しており、#28 により
    receivedAt のキーも同じ beacon stableId に揃うため、ID 空間が一致し
    パルス算出が成立する。フォールバック時（対応 beacon 不在）は reth 自身の
    stableId になるが、これも NodeEntity.id であり型・スキーマ上の矛盾はない
    （その場合エッジ端点と一致せずパルスが出ないだけで、安全側に倒れる）。
  - **プロファイル整合**: `profiles/ethereum/docker-compose.yml` のサービス名
    （reth1/beacon1/validator1、reth2/beacon2/validator2）に対しノード群キー
    導出が正しく機能することをテストで確認済み。
  - **テストの質**: targets.test.ts（+9）・peer-block-adapter.test.ts（+3）は
    フォールバック・クロス汚染防止・大文字小文字・非数値キー・ラベル欠落・
    観測順依存などの異常系/境界値を実挙動ベースで検証しており、実装を
    なぞるだけの無意味なテストはない。
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過
    （collector 233 / frontend 231）。
- 決定事項・注意点:
  - tester 申し送りの 2 点は、現 Phase（単一 Ethereum プロファイル運用）の
    スコープでは**許容**と判断した:
    1. クロスプロジェクト対応の可能性（別プロジェクトの同名 beacon を観測順で
       掴む）は、そもそも DockerPoller がホスト上の全コンテナを無差別に観測して
       おり、プロジェクトによるスコープ制御は `beaconStableIdForExecution` 単独
       ではなく collector 全体の課題。この関数だけ直しても複数プロファイル同時
       観測は成立しないため、先回り修正はせず特性テストで挙動を固定した現状を
       是とする。複数プロファイル観測（Phase 6 以降など）に着手する際は、
       stableId のプロジェクト接頭辞（または compose project ラベル）の一致を
       条件に加えること。
    2. ノード群キーが衝突する 2 つの EL が同一 beacon に対応付くケース
       （receivedAt が 1 キーに畳まれる）は、想定構成（1 論理ノード = 1 EL +
       1 beacon）では発生しない。特性テストで挙動が固定されており許容。
  - まだ未コミット。コミット時は関心事ごとに分けること（少なくとも
    #25 実装 / #25 テスト強化 / #25 レビュー修正（NaN サニタイズ）/
    #28 collector 修正 / #28 テスト強化 の 5 つ。WORKLOG の追記は対応する
    変更のコミットに含めてよい）。
  - 実際にパルスが beacon 端点間で描画されるかの動作検証は chainviz-qa に
    委ねる。

### 2026-07-04 Issue #25・#28 ブロック伝播パルスの動作再検証（合格）
- 担当: qa
- ブランチ: issue-25-block-propagation-pulse
- 内容: #28（reth→beacon の stableId 対応付け修正）を取り込んだ状態で、
  前回不合格だった #25（ブロック伝播パルス）の実環境動作を再検証した。
  判定は合格。ステップ4（Phase 2 B層）の完了条件を全体として満たすことを確認した。
  - 前提: `profiles/ethereum` は起動中でチェーンが進行中（block 4168→4170 を
    cast で確認）。
  - collector をビルドしポート4000で起動、WebSocket クライアントで接続して
    配信内容を確認:
    - block エンティティの `receivedAt` のキーが
      `chainviz-ethereum/beacon1` / `chainviz-ethereum/beacon2`（beacon の
      stableId）になっていることを確認。前回は reth の stableId になっており
      PeerEdge 端点と交わらずパルスが描画されなかった。#28 の修正で解消。
    - snapshot payload の `edges` に
      `{kind:"peer", fromNodeId:"chainviz-ethereum/beacon1",
      toNodeId:"chainviz-ethereum/beacon2", networkId:"chainviz-ethereum-consensus"}`
      が1本あり、端点が `receivedAt` のキーと一致（ID空間が交わる）ことを確認。
    - 両 beacon の受信時刻に実データ由来の差（例: 505036ms vs 505040ms）があり、
      伝播タイミングの差分としてパルスに反映できる状態であることを確認。
  - このブランチの frontend を `VITE_COLLECTOR_URL=ws://localhost:4000` で起動し、
    Playwright（Chromium）でブラウザ相当の動作を検証:
    - beacon1↔beacon2 を結ぶ P2P エッジ1本が描画される
      （edge id: `peer-...::beacon1::beacon2`）。
    - 新しいブロックが到達するたびに `animateMotion` 付きの `<circle>`（r=4,
      dur=450ms）がエッジ上に出現し、ブロック間では消える挙動を繰り返し観測
      （約15秒の観察で複数回のパルス発生を確認）。circle の画面座標が
      エッジ上で変化しており、パルスがパスに沿って移動していることを確認。
    - コンソールエラーは favicon の 404 が1件のみで、response リスナーでは
      再現せず機能に影響なし。
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過
    （collector 233 / frontend 231）。
- 決定事項・注意点:
  - beacon1 と beacon2 のカードがデフォルトレイアウトで隣接配置されるため、
    両者を結ぶエッジが短く（画面上で約13px）、パルスの移動距離は視覚的に
    小さい。パルス機能自体は正しく動作しており、これはノード配置（キャンバス
    上でドラッグして離せる）に依存する見た目の問題。将来デフォルト配置を
    調整するとより見やすくなる。
  - 検証後、起動した collector / vite プロセスは停止しクリーンな状態に戻した。

### 2026-07-04 Issue #37・#38・#39 キャンバスからのノード/ワークベンチ追加・削除（frontend）
- 担当: frontend
- ブランチ: issue-37-frontend-add-remove-ui
- 内容: ステップ5の frontend 側3件（追加ボタン UI・カード削除ボタン・失敗時
  エラー表示）を実装した。collector 側（#34〜#36）は並行して実装中のため、
  操作コマンドの送信配線と mock でのシミュレーションまでを担当した。
  - 操作コマンド送信の土台:
    - `world-state/useWorldState.ts` を拡張し、接続中クライアントを ref に保持して
      `sendCommand(command)` を返すようにした。`onCommandResult` ハンドラも
      受け取れるようにし、毎レンダーで参照が変わっても再接続しないよう ref 経由で
      最新を呼ぶ。
    - `commands/useCommands.ts` … `useWorldState` を内包し、コマンド発行アクション
      （addNode / addWorkbench / removeNode / removeWorkbench）・送信コマンドの
      pending 追跡・`commandResult(ok:false)` 時のトースト通知を組み合わせるフック。
      送信時に commandId をキーに command を pending へ記録し、失敗結果が返ったら
      どの操作が失敗したかを添えて通知する。
    - `commands/commandMessages.ts` … 純粋関数。ワークベンチ名の正規化
      （`resolveWorkbenchLabel`、空なら既定ラベル `workbench`）と、失敗時文言の
      組み立て（`describeCommandError`、i18n の定型文 + collector からの error 文字列）。
    - `commands/CommandActionsContext.tsx` … React Flow のカスタムノード
      （InfraNodeCard）はキャンバス内部に描画され props を渡しにくいため、削除
      アクションを context 経由で配る。
  - #37 追加ボタン: `canvas/CanvasToolbar.tsx` をキャンバス左上に重ねて配置。
    ノード追加ボタンと、ラベル入力欄つきワークベンチ追加フォームを持つ。
    プロファイルは現状 Ethereum 1種のみのため選択 UI は置かず、addNode は
    `chainProfile: "ethereum"` 固定。
  - #38 削除ボタン: `entities/InfraNodeCard.tsx` のヘッダ右端に×ボタンを追加。
    node なら removeNode、workbench なら removeWorkbench を送る。React Flow の
    ドラッグ開始を拾わないよう `nodrag` クラスと onPointerDown の伝播停止を付けた。
    バリデーターノードの削除不可判定はフロントでは行わず、collector が返す
    エラー（#39 の経路）で表現する。
  - #39 エラー表示: `notifications/`（`notificationStore.ts` 純粋ロジック、
    `useNotifications.ts` フック、`Toast.tsx` UI）でトースト通知の仕組みを用意し、
    #37・#38 共通で使う。トーストは画面右下に積まれ手動で閉じられる。
  - i18n: 追加・削除ボタン、入力欄プレースホルダ、トースト関連、コマンド失敗
    メッセージ（種別ごと + 汎用フォールバック）を `i18n/messages.ts` に ja/en で追加。
  - mock: collector 未完成のため `websocket/mockData.ts` の `createMockClient` に
    コマンド結果のシミュレーションを追加。addNode/addWorkbench は entityAdded diff を
    流して ok:true、removeNode/removeWorkbench は存在すれば entityRemoved で ok:true、
    初期スナップショットのノード（reth-node-1/2・lighthouse-1＝バリデーター相当）は
    削除不可で ok:false を返す。これで collector なしでも成功・失敗双方の見た目を
    確認できる。結果は pending 登録後に返るよう常に非同期（既定は queueMicrotask、
    `commandLatencyMs` 指定時は setTimeout）で resolve する。
- 決定事項・注意点:
  - `packages/shared` の型変更は不要だった。`Command` 型は設計済みのものを
    そのまま利用。
  - `sendCommand` は未接続（unmount 後など）だと undefined を返す。useCommands は
    undefined のとき pending へ記録しないため、結果の来ないコマンドが宙に残らない。
  - トーストは現状 error 種別のみ使用。将来 info/success を足せるよう
    `NotificationKind` を持たせてある。自動消滅は未実装（手動クローズのみ）。
  - mock の削除不可ノード判定は実環境の完了条件（compose 起動のバリデーターは
    削除不可）を模したもの。実際の可否判定は collector 側（#35）が担う。
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過（frontend 265 tests）。

### 2026-07-04 Issue #37・#38・#39 テスト強化（エッジケース・異常系・境界値）
- 担当: tester
- ブランチ: issue-37-frontend-add-remove-ui
- 内容: frontend 実装担当が書いた基本テスト（265 tests）に、異常系・境界値の
  観点でユニットテストを追加した（新機能の実装は行わず、テストのみ追加。
  301 tests）。実装コードは変更していない。
  - `commands/commandMessages.test.ts`: `resolveWorkbenchLabel` にタブ/改行の
    空白扱い、語間空白の保持、特殊文字・絵文字の保持、超長文字列の非切り詰めを
    追加。`describeCommandError` に command 不明でも詳細を付す挙動、空文字列
    error を欠落と同等に扱う挙動、詳細前後の空白トリムを追加。
  - `notifications/notificationStore.test.ts`: 同一メッセージを別 id で複数
    保持、200 件連続追加の順序・非破壊、同一 id 複数エントリの一括除去、空配列
    からの dismiss を追加。
  - `notifications/useNotifications.test.tsx`: 重複メッセージへの一意 id 付与、
    手動クローズ後に同内容の通知が来ても新 id で再表示、50 件バーストの id 一意性、
    notify/dismiss の参照安定、未知 id dismiss の no-op を追加。
  - `commands/useCommands.test.tsx`: 同一 commandResult の二重到達（2 回目は
    command 不明の汎用文言）、成功後に遅れて届く失敗結果、未送信 commandId の
    結果を無視、同一アクション連打時の各コマンド独立追跡、結果未到達時の無通知を
    追加。setup に `resolveById` ヘルパを追加。
  - `canvas/CanvasToolbar.test.tsx`: 空白のみラベルの未トリム通過、特殊文字・
    絵文字ラベルの素通し、フォーム submit（Enter 相当）での送信、追加ボタン連打時
    の二重送信ガード無し（クリックごとに 1 発行）、ツールバーから remove 系を
    呼ばないことを追加。
  - `entities/InfraNodeCard.test.tsx`: 削除ボタンの nodrag クラス付与、pointerdown
    が祖先（React Flow ノードラッパ相当）へ伝播しないこと、syncing ノードでも削除
    ボタンが機能すること、連打時の二重送信ガード無しを追加。
  - `websocket/mockData.test.ts`: 未存在 nodeId 削除の拒否、ワークベンチの追加→
    削除ラウンドトリップ、混在追加バーストの entity id 一意性・初期 id との非衝突、
    command id の単調増加、`commandLatencyMs` 遅延中の切断で保留タイマー破棄・
    結果非到達、遅延経過後の結果到達を追加。
- 決定事項・注意点:
  - 実装のバグは検出されなかった。追加した観点はいずれも既存実装で期待どおりに
    通過した。
  - 追加・削除ボタンの二重送信防止は UI 側では行われない仕様（クリックごとに
    コマンドを 1 発行）であることをテストで明文化した。将来 pending 中の
    ボタン無効化を入れる場合はこれらのテストを更新する必要がある。
  - `pnpm lint` / `pnpm --filter @chainviz/frontend build` / 同 test すべて通過
    （frontend 301 tests）。

### 2026-07-04 Issue #37・#38・#39 静的レビュー（frontend 追加・削除 UI）
- 担当: reviewer
- ブランチ: issue-37-frontend-add-remove-ui
- 内容: frontend のステップ5実装（#37 追加ボタン UI / #38 カード削除ボタン /
  #39 コマンド失敗時のエラー表示）と tester のテスト強化（265→301 tests）を
  静的にレビューした。
  - 境界の遵守: フロントは Docker/ノード API に触れておらず、操作はすべて
    shared の `Command` 型（既存の protocol 定義）を WebSocket クライアント
    経由で送る形になっている。チェーン固有語彙（`eth_getLogs` 等）の漏れなし。
    `DEFAULT_CHAIN_PROFILE = "ethereum"` はプロファイル識別子であり RPC 語彙
    ではないため問題ない（プロファイルが増えた時点で選択 UI に置き換える
    前提のハードコード。コメントにも明記済み）。
  - `packages/shared` の型変更は不要という判断は妥当。`Command` /
    `ServerMessage` / `ClientMessage` はステップ0の設計時に定義済みで、
    今回の実装はそれをそのまま消費している。
  - モジュール構成: `commands/`（純粋ロジック・フック・context の3分割）、
    `notifications/`（store・フック・UI の3分割）とも1ファイル1責務を守って
    おり、循環依存なし。`index.ts` の再エクスポートも純粋ロジックのみで方針
    どおり。
  - i18n: 追加文言はすべて `messages.ts` に `{ja, en}` で追加されており
    既存の仕組みに沿っている。
  - テストの質: tester 追加分（二重到達する commandResult、成功後の遅延失敗、
    未送信 commandId、連打、空白のみ/絵文字/超長ラベル、mock の遅延タイマー
    破棄など）は異常系・境界値を実質的に検証しており、実装をなぞるだけの
    無意味なテストは見当たらない。
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過
    （frontend 301 tests）を確認。
  - docs 齟齬の修正: `docs/ARCHITECTURE.md` §1 の frontend フォルダ一覧に
    新設の `commands/` と `notifications/` が載っていなかったため追記した
    （このレビューでの唯一の修正）。
- 決定事項・注意点:
  - 「二重送信防止を UI 側で行わない」設計は現時点で許容と判断した。追加
    ボタンの連打は「複数追加したい」という正当な操作と区別できず、pending 中
    のボタン無効化は複雑さに見合わない。ただし削除ボタンは、collector の反映
    （entityRemoved の diff）が届くまで数秒カードが残るため、その間の再クリック
    が「not found」エラートーストになり得る。実環境でこれが紛らわしいと判明
    したら「削除 pending 中はそのカードの削除ボタンを無効化する」改善を検討
    する（現状のテストは連打=複数発行を明文化済みなので、その際はテストも更新）。
  - 実 WebSocket クライアント（`websocket/client.ts`）の `sendCommand` は
    ソケット未接続でも commandId を返すため、未接続時に送ったコマンドは
    pending に残り結果が来ない（トーストも出ない）。mock では起きない経路
    だが、collector 接続後の実環境で接続断中の操作 UX を改善する余地がある
    （将来課題。今回の完了条件には影響しない）。
  - コミットはまだ行っていない。コミット時は関心事ごと（コマンド送信の土台 /
    #37 ツールバー / #38 削除ボタン / #39 通知 / mock 拡張 / テスト強化 /
    docs）に分割すること。
### 2026-07-04 ステップ5(#34-#39) 追加・削除機能の最終統合QA検証

- 担当: qa
- ブランチ: collector=issue-34-add-remove-node / frontend=issue-37-frontend-add-remove-ui
- 内容: Issue #44(EL間P2P有効化)・#46(lighthouse-bn.sh修正)main反映後の
  ステップ5全体を、起動中の profiles/ethereum 実環境に対して再検証した。
  前回不合格だった「追加rethがブロックに追従しない」問題の解消を含め、
  完了条件をすべて満たすことを確認した。合格。
  - collector を `pnpm --filter @chainviz/collector build` 後にポート4000で
    起動し、フロントと同一の WebSocket プロトコル(snapshot/diff/command/
    commandResult)でライフサイクル操作を実行して検証した。
  - addNode: commandResult ok を約0.6秒で受信。数秒後の差分で reth3
    (172.28.1.3)・beacon3(172.28.2.3)がエンティティとして出現し、
    consensus ネットワークに新エッジ beacon1→beacon3 が張られた。
  - ブロック追従(前回の不合格箇所): ワークベンチから
    `cast block-number --rpc-url http://172.28.1.3:8545` で reth3 を直接叩き、
    287→319→383→430→433 と履歴をバックフィルして先頭へ追いつき、以後
    reth1 と同一高(441==441, 444==444)を維持することを確認。EL間P2P
    (elpeer 経由の boot enode 接続 + RETH_ROLE=peer)が機能している。
  - removeNode(追加ノード): nodeId `chainviz-ethereum/reth3` を指定して
    ok。数秒後に reth3・beacon3 の両方がキャンバス(エンティティ)から消えた。
  - removeNode(既存composeノード): nodeId `chainviz-ethereum/reth1` は
    ok:false、error="node ... was not added via addNode and cannot be removed"
    を返し、reth1 は残存。既存バリデーター付きノードは削除できないこと確認。
  - addWorkbench/removeWorkbench: Foundry コンテナ
    (chainviz-ethereum-qa-wb-1)が追加・削除でき、削除後に managed ラベルの
    コンテナが残らないことを確認。
  - フロント側: コマンド送信コード(commands/)が
    {action:addNode,chainProfile:"ethereum"} 等プロトコルと一致し、削除ボタンは
    entity.id を渡す。vite を `VITE_COLLECTOR_URL=ws://localhost:4000` で起動し、
    index.html および main.tsx/App.tsx/CanvasToolbar.tsx が HTTP 200 で変換・
    配信されることを確認(当環境にヘッドレスブラウザが無いためクリック操作の
    ブラウザ実測は不可。UI挙動はユニットテスト301件通過と実プロトコル疎通で担保)。
  - `pnpm lint && pnpm build && pnpm test` は両ワークツリーで成功
    (collector側: collector 319 / frontend 231、frontend側: frontend 301)。
- 決定事項・注意点:
  - PLAN.md ステップ5のフロント項目 #37-#39 のチェックは、frontend ブランチが
    未コミット・未マージのため未着。frontend PR マージ時にチェックを付ける。
  - 検証後、起動した collector / vite プロセスを停止し、追加した
    reth3/beacon3/qa-wb コンテナを削除してクリーンな状態に戻した。

### 2026-07-04 Issue #51-#54 E2E(結合)テストの導入(packages/e2e)

- 担当: collector
- ブランチ: issue-51-e2e-scaffold
- 内容:
  - 新規ワークスペースパッケージ `packages/e2e` を追加。実 Docker + 実
    collector に対する結合テストを置く。`pnpm-workspace.yaml` の
    `packages/*` に自動で含まれる。ルート `tsconfig.json` の references には
    追加しない(e2e はビルド対象ではなくテスト実行専用。型検査は
    `tsc --noEmit` を `typecheck` スクリプトとして分離)。
  - ヘルパー群(`src/helpers/`):
    - `docker.ts`: `profiles/ethereum` を起動しチェーン進行開始まで待つ。
      **既に稼働中で進行していればそのまま再利用し、停止中のときだけ
      `docker compose up -d` する**設計(理由は下記「決定事項」)。
    - `collector.ts`: collector を子プロセス(`node packages/collector/
      dist/index.js`)として起動し、テスト終了時に `process.kill()` で停止。
      main() を同一プロセスで import しない(後片付けが確実にできないため。
      #51 の指示)。ポートは `CHAINVIZ_COLLECTOR_PORT` で 4123 を渡す。
    - `ws-client.ts`: `@chainviz/shared` の型だけを使う軽量 WebSocket
      クライアント。snapshot/diff を畳み込んでクライアント側ワールド
      ステートを再構築し、command 送信と commandResult 待ちを提供する。
      `@chainviz/frontend` には依存しない(#51 の指示)。
    - `rpc.ts`: Ethereum の JSON-RPC(eth_blockNumber 等)を直接叩く。
      チェーン固有の検証ロジックは e2e パッケージ内に閉じ込め、collector
      本体には手を入れていない。
  - テスト:
    - `a-b-layer.test.ts`(#52): 接続時スナップショットに reth1/2・beacon1/2・
      validator1/2・workbench が正しい kind/clientType で載ること、beacon1↔
      beacon2 の PeerEdge、あるブロックの receivedAt に複数ノードの受信時刻が
      非ゼロの差で載ること。
    - `commands.test.ts`(#53): addNode→ok:true→reth+beacon ペア出現、
      **追加した reth の JSON-RPC を直接叩いてブロック追従を確認**、
      removeNode(既存 compose ノードは ok:false で拒否 / 追加ノードは削除可)、
      addWorkbench/removeWorkbench。
  - collector 本体への変更は最小限で、`resolvePort()`(環境変数
    `CHAINVIZ_COLLECTOR_PORT` で待ち受けポートを差し替え可能にする)を追加し
    ユニットテストも追加した。既存 dev collector とポート衝突しないため。
  - 配線(#54): ルート `package.json` に
    `"test:e2e": "pnpm --filter @chainviz/e2e test:e2e"` を追加。
    `packages/e2e` は `test` スクリプトを持たないため `pnpm -r test`
    (pre-push フックの対象)からは自動でスキップされる(実際に確認済み)。
    `docs/CONTRIBUTING.md` に前提条件・実行方法・実行時間の目安を追記。
- 決定事項・注意点:
  - **genesis 再生成の落とし穴(重要)**: `profiles/ethereum` の genesis は
    ワンショットサービスで、`generate-genesis.sh` が `GENESIS_TIMESTAMP` を
    現在時刻で埋めるため、`docker compose up -d` のたびに毎回異なる genesis を
    共有ボリュームへ作り直す。稼働中のスタックに対して `up -d` を呼ぶと、
    走り続けている reth1/2 は古い genesis のままだが共有ボリュームだけが
    新しい genesis に置き換わる。この状態で `addNode` すると、新規 reth が
    「別の genesis」で init してしまい既存ノードと genesis ハッシュが食い違い、
    EL の P2P ハンドシェイクに失敗してブロックに追従できない。E2E ハーネスの
    docker ヘルパーは、既に健全に稼働しているスタックには `up -d` を呼ばず
    再利用することでこれを回避している。**運用上の含意**: chainviz の通常の
    起動フロー(`docker compose up` を一度きり)では問題ないが、稼働中に
    `docker compose up -d` を再実行すると以後の addNode が壊れる。これは
    node-env 側の潜在的な脆さであり、必要なら別途対処を検討する(このタスクの
    範囲では変更していない)。
  - **回帰検出の確認(#53)**: `reth-node.sh` の peer 分岐から
    `--trusted-peers`/`--bootnodes` を一時的に外して EL 間 P2P を壊し、
    追加ノードがブロックに追従できず block-following テストがタイムアウトで
    失敗することを実際に確認した(確認後スクリプトは元に戻し、sha1 一致を
    検証済み)。この過程で判明した重要な性質: チェーンが genesis 直後でごく
    短い(数十〜百ブロック程度)場合、CL が EL へブロックを順番に渡すため
    EL 間 P2P が無くても Engine API のみで追従してしまい、回帰が表面化しない。
    十分に進んだチェーン(数百ブロック)では CL がオプティミスティックに head を
    渡すため EL のバックフィルが必要になり、そこで初めて回帰が確実に検出できる。
    継続稼働するスタックを再利用する本ハーネスの通常運用ではこの条件を満たす。
  - E2E は実 Docker とブリッジネットワークのコンテナ IP(172.28.0.0/16)への
    ホストからの到達性を前提とする(collector がコンテナ IP へ直接接続する
    ため)。Linux/WSL2 の標準 Docker では到達可能。
  - 実行結果: A/B 層 3 件・操作コマンド 6 件の計 9 件すべて healthy 環境で
    成功。所要は稼働中スタック再利用で 2〜3 分程度。

### 2026-07-04 Issue #51-#54 E2E(結合)テスト導入のレビュー

- 担当: reviewer
- ブランチ: issue-51-e2e-scaffold
- 内容: packages/e2e 新設(#51〜#53)・test:e2e 配線(#54)・collector の
  `resolvePort()` 追加を静的レビューし、ビルド・lint・テスト・E2E 本体を
  実行して確認した。
  - `pnpm lint` / `pnpm build` / `pnpm test` はすべて成功。`pnpm -r build` /
    `pnpm -r test` とも「Scope: 4 of 5」で packages/e2e が自動スキップされ、
    エラーにならないことを実行して確認した(shared 2 / collector 323 /
    frontend 301 件)。pre-push フックに E2E が混入しないという完了条件を
    満たす。
  - `pnpm test:e2e` を稼働中スタックに対して実行し、9 件(A/B 層 3 件 +
    操作コマンド 6 件)すべて成功(141 秒)。終了後にポート 4123 の解放・
    追加コンテナの残骸なし・compose の 7 サービスが元のまま稼働中である
    ことを確認した。
  - 境界の遵守: `eth_blockNumber` 等のチェーン固有語彙は
    `packages/e2e/src/helpers/rpc.ts` に閉じており、collector の
    `adapters/ethereum/` には変更なし。ws-client は `@chainviz/shared` の
    型のみに依存し frontend を参照しない。shared の型変更は不要
    (既存の Command / ServerMessage / エンティティ型で完結)という判断は
    妥当。
  - collector 子プロセス起動(dist/index.js + SIGTERM、5 秒後 SIGKILL
    フォールバック)は、main() が停止手段を返さない制約への対応として
    妥当。`resolvePort()` は直接実行パスのみに作用し `main()` の既定値
    (DEFAULT_PORT)を変えない最小限の変更で、異常系(未設定・空白・
    非数値・負値)のユニットテストも揃っている。
  - テストの質: removeNode の拒否(既存 compose ノード)という異常系を含み、
    ブロック追従テストは EL 間 P2P を壊すと実際に失敗することが確認済み
    (#44/#46 の回帰検出として有効)。
- 決定事項・注意点(実装担当への指摘。マージ前に対応すること):
  1. (要修正) `docs/ARCHITECTURE.md` §1 のリポジトリ構成図に
     `packages/e2e` が載っていない。1 行追記して docs と実装を同期する。
  2. (推奨) packages/e2e の型検査(`typecheck` スクリプト)がどこにも
     配線されておらず、vitest は型検査をしないため e2e の型崩れは
     pre-push で検出されない。`"build": "tsc --noEmit"` を
     packages/e2e/package.json に追加すれば `pnpm -r build` に自然に乗る
     (Docker 不要・高速のため完了条件に抵触しない)。
  3. (軽微) ws-client.ts の close() 内
     `for (const timer of this.pending.values()) void timer;` は何もしない
     死にコード。保留コマンドの setTimeout は close 後も発火する。整理を
     推奨。
  4. (軽微・記録のみ) helpers/collector.ts は collector が即死した場合、
     waitFor が例外を「未達」として再試行するため失敗確定まで最大 30 秒
     かかる(失敗時メッセージにログは含まれるので調査は可能)。
  5. (軽微・記録のみ) resolvePort は parseInt の性質上 "80abc" を 80 と
     解釈し、65535 超の値も通す(listen 時にエラーになる)。フォールバック
     設計としては許容範囲。
  - コミットはまだ無い。コミット時は関心事ごとに分けること(例:
    collector の resolvePort / e2e 土台 #51 / A・B 層テスト #52 /
    コマンドテスト #53 / test:e2e 配線 + CONTRIBUTING #54 /
    PLAN・WORKLOG の docs 更新)。

### 2026-07-04 Issue #51-#54 E2E(結合)テスト導入の再レビュー

- 担当: reviewer
- ブランチ: issue-51-e2e-scaffold
- 内容: 前回レビューの指摘 1〜3 への対応(collector 担当による修正)を
  再レビューした。結果は合格。
  - 指摘 1(要修正): `docs/ARCHITECTURE.md` §1 の構成図に
    `e2e/  # E2E 結合テスト(collector を実 Docker と疎通させて検証)` の
    1 行が追記されており、実装と同期した。
  - 指摘 2(推奨): `packages/e2e/package.json` に `"build": "tsc --noEmit"`
    が追加され、`pnpm -r build` の実行で e2e の型検査が走ることを確認した
    (「Scope: 4 of 5」→ build は e2e を含む 4 パッケージで実行)。`test`
    スクリプトは追加されていないため、`pnpm -r test` からの除外(E2E が
    pre-push に混入しない完了条件)は維持されている。CONTRIBUTING.md の
    「packages/e2e は test スクリプトを持たない」という記述とも整合。
  - 指摘 3(軽微): ws-client.ts の close() から死にコード
    (`for (const timer of this.pending.values()) void timer;`)が削除され、
    `this.pending.clear()` のみの素直な実装になった。
  - `pnpm lint` / `pnpm build` / `pnpm test`(pre-push フックと同一)を
    自分でも実行し、すべて成功(collector 323 / frontend 301 件)。
  - 指摘 4・5 は前回記録のとおり「記録のみ」であり対応不要。
- 決定事項・注意点:
  - コミットはまだ無い(意図どおり)。コミット時は前回記録した関心事ごとの
    分割に従うこと。この後 chainviz-qa の実機検証に進む。

### 2026-07-04 Issue #51-#54 E2E(結合)テスト導入の実機検証(不合格)

- 担当: qa
- ブランチ: issue-51-e2e-scaffold
- 内容: 実 Docker(profiles/ethereum、稼働中スタックを再利用)+ 実 collector
  に対し `pnpm test:e2e` を実行し、ステップ6の完了条件を検証した。
- 結果: 不合格。9 件中 8 件成功、1 件失敗。
  - 失敗テスト: commands.test.ts >
    「addNode > 最重要: 追加した reth が既存チェーンにブロック追従する
    (0 のままにならない)」。
    `timed out after 120000ms waiting for added reth to reach block height 1491`。
  - 切り分け: これは #44/#46 の回帰(EL 間 P2P 無効でブロックに追従しない)
    ではない。手動で addNode を実行し追加 reth(reth3, 172.28.1.3)の
    ブロック高を時系列で観測したところ、履歴バックフィルは正常に機能し、
    約 150 秒で target(1616)に追いついた(CAUGHT UP)。追従機能そのものは
    実環境で正しく動いている。
  - 失敗の原因: テストの追従待ちタイムアウトが 120 秒固定
    (commands.test.ts の `timeoutMs: 120_000`)である一方、バックフィルの
    実測速度は約 9〜10 ブロック/秒、チェーンの成長は約 0.5 ブロック/秒。
    チェーンが約 1500 ブロック以上進んだ状態では追いつくまで約 150 秒以上
    かかり、120 秒では間に合わない。観測では t=120s 時点で追加ノードは
    1309、target は 1616 でまだ大きく届いていなかった。
  - ハーネスは稼働中スタックを再利用する設計(docker.ts / CONTRIBUTING.md)
    で、テスト自身のコメントも「チェーンが十分進んでいるほどバックフィル
    履歴が長くなる」と認めているにもかかわらず、待ち時間を固定値にして
    いる。稼働時間が延びるほど確実に失敗する構造で、一過性のフレークでは
    ない(手動再現でも 120 秒では届かないことを確認)。
  - 完了条件「ステップ5の操作コマンドが自動検証され」に対し、最重要の
    addNode ブロック追従検証が長時間稼働(=ハーネスが想定する主運用)の
    スタックで安定して通らず、`pnpm test:e2e` が exit 1 になる。
- 合格した項目:
  - A 層・B 層テスト(a-b-layer.test.ts、スナップショット 7 エンティティ・
    beacon 間 PeerEdge・ブロック伝播タイミングの時間差)は全て成功。
  - コマンドテストのうち addNode 出現・removeNode 保護・追加ノード削除・
    addWorkbench/removeWorkbench は成功。
  - `pnpm lint && pnpm build && pnpm test`(pre-push フックと同一)は
    lint 約 1.9s / build 約 1.7s / test 約 3.9s の合計 8 秒程度で完了し、
    E2E テストは混入していない(collector 323 / frontend 301 件のみ)。
    e2e は `test` スクリプトを持たず `pnpm -r test` から除外される
    完了条件の後半は満たされている。
  - CONTRIBUTING.md 記載の実行方法(`pnpm build` → `pnpm test:e2e`)は
    記載どおりに動作し、コマンド配線・前提条件の記述は正確。
- 差し戻し先: collector(packages/e2e の追従待ちタイムアウト設計)。
  対応案としては、追従待ちタイムアウトをチェーン深さに応じて動的に
  伸ばす、または backfill 進捗が止まっていないこと(高さが単調増加して
  いること)を基準に判定するなど、長時間稼働スタックでも安定して通る
  設計へ変更する。
- クリーンアップ: 手動検証で追加した reth3/beacon3 は removeNode で削除
  済み(残存なし)。手動起動した collector プロセス(port 4123)は停止済み。
  Docker スタックは検証前から稼働していた 7 コンテナ + genesis(Exited)の
  状態に戻している。

### 2026-07-04 Issue #51-#54 addNode 追従待ちの動的タイムアウト化のレビュー

- 担当: reviewer
- ブランチ: issue-51-e2e-scaffold
- 内容: qa の不合格指摘(追従待ちが固定 120 秒でチェーンが長く進んだ環境では
  確実に失敗する)への collector 担当の修正(`packages/e2e/src/helpers/
  catch-up.ts` 新設・`commands.test.ts` の差し替え・ユニットテスト 14 件・
  e2e パッケージへの `test` スクリプト追加)を再レビューした。実装・テスト
  分離は合格。ただし docs に軽微な差し戻し 2 点あり(下記)。
  - **`test` / `test:e2e` の分離(最優先確認事項)**: `pnpm -r test` を実行し、
    全体 3.8 秒で完了・collector 323 / frontend 301 / e2e 14 件(catch-up.
    unit.test.ts のみ)の構成であることを確認した。`vitest.unit.config.ts`
    は include が `src/**/*.unit.test.ts` のみ、`vitest.config.ts`(test:e2e)
    は `**/*.unit.test.ts` を exclude しており、実 Docker 前提の
    a-b-layer.test.ts / commands.test.ts が pre-push フック(`pnpm test`)に
    混入しないことを実行ログで確認した。前回合格時の「e2e は test スクリプト
    を持たない」前提は変わったが、分離自体は正しく機能している。
  - `pnpm lint` / `pnpm build` も成功(e2e の `tsc --noEmit` 型検査を含む)。
  - ロジックの妥当性: `catchUpTimeoutMs` は実測 9〜10 ブロック/秒に対し
    保守的な 5 ブロック/秒でタイムアウトを算出し、下限 120s・ベース 30s・
    上限 540s(vitest の it タイムアウト 600s より先に内部エラーを出すため)
    という構成は妥当。`CatchUpMonitor` の停止検出は「観測最大高さが 45 秒
    更新されない」基準で、初回観測を進捗扱いにする(初期値 -1)ことで RPC
    起動待ちを停止と誤判定しない設計も妥当。`waitForBlockCatchUp` は
    getHeight の例外を「観測なし」として停止判定から除外し、全体タイム
    アウトのみで見張る扱いも適切。
  - テストの質: 14 件は到達・停止・動的タイムアウト・RPC 一時到達不能から
    の復帰・負の gap・パラメータ指定・初回観測遅延をカバーする。特に
    「停止時は 120s を待たず失敗する(clock < 120_000)」「gap 2000 では
    固定 120s を超えて待てる(clock > 120_000)」のアサーションは、停止検出
    の削除や固定タイムアウトへの退行で確実に落ちる意味のあるテストに
    なっている。
  - `pnpm test:e2e` を約 1 時間稼働中のスタック(qa の不合格条件と同等)に
    対して実行し、9 件全て成功(全体 283 秒)。最重要のブロック追従テストは
    220 秒を要しており、旧固定 120 秒では確実に失敗していた条件で動的
    タイムアウトが機能したことを実地で確認した。終了後、ポート 4123 の
    解放・追加コンテナの残骸なし・compose の 7 サービス継続稼働を確認。
- 決定事項・注意点(collector 担当への差し戻し。いずれも docs のみ):
  1. (要修正) `docs/CONTRIBUTING.md` の「packages/e2e は `test` スクリプトを
     持たず、`test:e2e` として分離している。`pnpm -r test` からは自動的に
     スキップされる」という記述が実装と食い違った。現在は `test` スクリプト
     があり docker 非依存の `*.unit.test.ts` のみを実行する。実態に合わせて
     書き直すこと。
  2. (要修正) 今回の修正(catch-up.ts 新設・commands.test.ts 差し替え)自体の
     WORKLOG 記録が無い。CLAUDE.md のルールに従い、collector 担当が作業
     記録を追記すること。
  3. (記録のみ) 全体タイムアウトの上限 540s により、スタックの連続稼働が
     非常に長くなる(実測レートで gap 約 5000 ブロック、稼働約 2.7 時間相当を
     超える)と、健全なバックフィルでもタイムアウトしうる。恒常的に長時間
     稼働させる運用ではスタックの再作成で回避する。
  4. (記録のみ) `waitForBlockCatchUp` の「RPC が一度も応答しないまま全体
     タイムアウト」経路のユニットテストが無い(カバレッジの軽微な穴。
     ブロッカーではない)。
  - コミットはまだ無い(意図どおり)。docs 2 点の対応後、前回記録した
    関心事ごとのコミット分割に従うこと。

### 2026-07-04 Issue #53 docs修正(CONTRIBUTING/WORKLOG)の再レビュー

- 担当: reviewer
- ブランチ: issue-51-e2e-scaffold
- 内容: 前回レビューの docs 指摘 2 点への対応(統括による修正)を再レビュー
  した。結果は 1 点差し戻し。
  - WORKLOG.md の Issue #53 作業記録(追従待ちの動的タイムアウト化): 合格。
    catch-up.ts の実装(既定値 5 ブロック/秒・ベース 30s・下限 120s・
    上限 540s・停止判定 45s)、ユニットテスト 14 件、vitest 2 設定の
    分離機構の説明、実機確認の数値(追従 220 秒・上限 540s ≒ 連続稼働
    約 2.7 時間相当)のいずれも実装・過去の検証記録と一致しており正確。
  - CONTRIBUTING.md の「E2E(結合)テスト」節: 分離の実態(`test` スクリプト
    あり・`*.unit.test.ts` のみ対象・E2E 本体は `test:e2e` のみ)は正しく
    なったが、**分離を実現している設定ファイルの帰属が誤っている**
    (要修正)。現在の記述は「E2E テスト本体は `vitest.config.ts` の
    exclude 設定で `test` スクリプトの対象から外し」だが、実際は逆で、
    `vitest.config.ts` の exclude は `*.unit.test.ts` を `test:e2e` から
    除外するもの。E2E 本体を `test` スクリプトから外しているのは、
    `test` スクリプトが `--config vitest.unit.config.ts` を使い、その
    include が `src/**/*.unit.test.ts` のみに絞られていること。
    WORKLOG 側の記述は正しいため、CONTRIBUTING が実装とも WORKLOG とも
    矛盾している。該当 1 文を WORKLOG と同じ説明(exclude は test:e2e 側、
    include は test 側)に直すこと。
  - `pnpm lint` / `pnpm build` / `pnpm test` は全て成功(docs のみの変更
    なので当然だが、pre-push フックと同一の確認として実行した)。
- 決定事項・注意点:
  - (記録のみ) 今回の Issue #53 記録は WORKLOG の先頭(「## 記録」直後)に
    置かれたが、関連する Issue #51-#54 の一連の記録はファイル末尾にある。
    ファイル全体の並び順が既に新旧混在しているため差し戻しにはしないが、
    経緯を追う際は両方を参照すること。
  - コミットはまだ無い(意図どおり)。

### 2026-07-04 Issue #53 docs修正(CONTRIBUTING.md 設定ファイル帰属)の再々レビュー

- 担当: reviewer
- ブランチ: issue-51-e2e-scaffold
- 内容: 前回レビューの指摘(CONTRIBUTING.md「E2E(結合)テスト」節における
  分離設定ファイルの帰属誤り)への対応を再レビューした。結果は合格。
  - 修正後の記述「`packages/e2e` は `test` スクリプトを持つが、
    `vitest.unit.config.ts`(include が `src/**/*.unit.test.ts` のみ)を
    指す」「E2E テスト本体は `test:e2e` が指す `vitest.config.ts` 側で
    `**/*.unit.test.ts` を exclude することで住み分け」は、
    `packages/e2e/package.json`(`test` = `vitest run --config
    vitest.unit.config.ts`、`test:e2e` = `vitest run`)、
    `vitest.unit.config.ts`(include: `src/**/*.unit.test.ts`)、
    `vitest.config.ts`(include: `src/**/*.test.ts`、exclude:
    `**/*.unit.test.ts`)の実装と正確に一致する。
  - 同節のその他の記述(ルート `pnpm test` = `pnpm -r test`、
    `pnpm test:e2e` = `pnpm --filter @chainviz/e2e test:e2e`、E2E 本体
    ファイル名 a-b-layer.test.ts / commands.test.ts、collector を
    `packages/collector/dist/index.js` から子プロセス起動、ポート 4123、
    ブリッジサブネット 172.28.0.0/16、稼働中スタック再利用時に `up -d` を
    呼ばない設計)も helpers(collector.ts / docker.ts / paths.ts)・
    compose 定義と突き合わせて一致を確認した。
  - `pnpm lint` / `pnpm build` / `pnpm test` は全て成功。
    `pnpm --filter @chainviz/e2e test` 単体でも catch-up.unit.test.ts の
    14 件のみが実行されることを確認(E2E 本体が混入しない)。
- 決定事項・注意点:
  - 静的レビューとしての差し戻し事項は無し。次は chainviz-qa の再検証へ。
  - コミットはまだ無い(意図どおり)。

### 2026-07-04 Issue #58 E2E異常系シナリオの実機検証(qa)

- 担当: qa
- ブランチ: issue-58-e2e-error-paths
- 内容:
  - 実 Docker(profiles/ethereum の稼働中スタック)+ ビルド済み collector を
    子プロセスとして起動し、異常系 E2E シナリオを実際に動かして検証した。
    実行前に他 worktree で vitest/test:e2e が動いていないことを ps で確認
    (#64 のポート奪い合い回避)。
  - 静的確認: `pnpm lint`(クリーン)/ `pnpm build`(全4パッケージ成功)/
    `pnpm test`(collector 330・frontend 301 すべて通過。E2E本体は混入せず)。
  - E2E: `pnpm test:e2e` 全15テスト成功(所要 約393秒)。内訳は既存9件
    (a-b-layer 3 + commands 6)+ 新規 error-paths.test.ts 6件。error-paths は
    addNode不正chainProfile拒否(コンテナ数不変)・存在しないnodeId/workbenchId
    のremove拒否・ラベル重複の一意化(-2付与)と両方の削除・不正フレーム
    (不正JSON/type欠落/未知type/空command)送信後も接続維持と後続コマンド
    処理・collector子プロセス非クラッシュ、を実プロセス境界越しに確認。
  - CONTRIBUTING.md の E2E テスト本体一覧(a-b-layer / commands /
    error-paths の3ファイル)と同時実行禁止の注意書きが実装と一致することを
    確認。
  - 後片付け: テスト作成の一時ノード/ワークベンチはテスト内で全削除済み。
    検証後に残存 vitest/collector プロセスなし、余分なコンテナなし、ポート
    4123 解放を確認。既存スタック7コンテナは検証前から稼働中のもので変更なし。
- 判定: 合格。ステップ6拡張分(異常系)の完了条件を満たす。
- 注意点: docs/PLAN.md 内で Issue #58 のチェックボックスが2箇所ある。
  ステップ6の当初リスト(既に [x])とその下の「上記の完了後...追加する」
  バックログ項目(現状 [ ] 未チェック)が同一 #58 を指しており重複している。
  実装は完了しているため、後者の未チェック項目の扱い(チェック付与か重複
  解消か)は統括の判断が必要。

### 2026-07-04 Issue #32 ダークモードのUI視認性改善

- 担当: frontend
- ブランチ: issue-32-dark-mode-contrast
- 内容:
  - 実環境フィードバック「ダークモードのせいか見づらい」を受け、
    `packages/frontend/src/styles.css` と B層のP2Pエッジ関連コードの配色を
    調整した。事前調査として、`.cache/ms-playwright` にキャッシュ済みの
    Chromiumがあったが起動に必要な共有ライブラリ(libnspr4等)が環境に
    無かったため、`apt-get download` で該当debパッケージを取得して
    スクラッチパッドに展開し、`LD_LIBRARY_PATH` を通すことでPlaywright
    (chromium headless)を動かせるようにした上でモックデータ
    (`websocket/mockData.ts`)を描画したスクリーンショットで視認性を確認した
    (リポジトリには何も追加していない)。
  - WCAGの相対輝度式でコントラスト比を計算し、以下の問題点を特定・修正した。
    - カード・入力欄・ポップオーバーなどの輪郭線
      (`#33405a`、背景比1.77:1)がキャンバス背景に対しほぼ判別できず、
      カードの境界が曖昧だった。輪郭線を`#46577d`(背景比2.56:1)に上げ、
      `--border` / `--divider` の2段階のCSS変数として整理した。区切り線
      (`--divider`)には輪郭線の旧値である`#33405a`を流用したが、区切り線を
      使うヘッダー/ツールバーの変更前の色は`#2a3346`であり、実際には
      わずかに明るい`#33405a`に変わっている。
    - 補助テキスト色`--muted`(`#9aa6bd`、カード上比5.77:1)はWCAG AA
      (4.5:1)は満たしていたが余裕が小さかったため`#a9b5cc`
      (カード上比6.85:1)に上げた。
    - P2Pエッジ(紐)は`stroke-opacity: 0.7`を背景と合成した実効色で見ると、
      青(`#4f9dff`)・紫(`#c77dff`)が背景の紺色と近い色相のため合成後
      コントラスト比が約3.9:1まで下がり、他4色(5:1以上)より見えにくかった。
      青・紫のみ明度を上げ(`#7db8ff` / `#d59bff`)、`stroke-opacity`を
      0.85に、`strokeWidth`を1.5→2に引き上げた
      (`packages/frontend/src/entities/peerEdge.ts`)。
    - ブロック伝播パルス(`PeerPropagationEdge.tsx`)は元々コントラスト比
      16.55:1と高く問題は無かったが、エッジの太さ・不透明度を上げた影響で
      相対的に目立ちにくくなるのを避けるため、半径を4→5、
      `drop-shadow`のぼかし半径を拡大し、色をエッジの新しい青
      (`#6cb2ff`)に揃えた。
    - React FlowのControls/MiniMapが既定のライトテーマ(白背景)のまま
      描画され、アプリ全体のダーク配色から浮いて見えていたため、
      `<ReactFlow colorMode="dark">`を指定してライブラリ標準のダーク
      テーマ変数に切り替えた(`packages/frontend/src/canvas/Canvas.tsx`)。
      MiniMap/Controlsのパネル背景・アイコン色が実際に切り替わることを
      Playwrightで確認済み。
    - glossaryのインライン用語解説・ポップオーバーは元々のコントラスト比が
      6.85〜9台と十分高かったため文言・配色の変更はしていない
      (`--muted`変更により定義文の可読性はさらに上がる)。
  - カードのレイアウト・レイヤー構成・コンポーネント配置は変更していない
    (配色のみの調整)。
- 決定事項・注意点:
  - `NETWORK_COLORS`はテストで配列に含まれるかどうかのみ検証しており
    (`peerEdge.test.ts`)、具体的な16進値には依存していないため、パレット
    変更によるテスト破壊は無い。
  - 本変更は見た目(色・不透明度・線幅)のみでロジックの追加・変更は
    伴わないため、CLAUDE.mdの方針どおり新規ユニットテストは追加していない。
    既存の`pnpm lint` / `pnpm build` / `pnpm test`(frontend 301件)は
    全て通過を確認済み。
  - Playwright実行のため`apt-get download`したdebパッケージ・展開した
    共有ライブラリはすべてスクラッチパッド配下のみに置き、リポジトリには
    含めていない。

### 2026-07-04 Issue #32 ダークモードUI視認性改善のレビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-32-dark-mode-contrast
- 内容: frontend担当の配色調整(未コミットのワークツリー)を静的レビューした。
  - コントラスト比の検算: WCAG相対輝度式で全数値を再計算し、報告値と一致
    することを確認した(輪郭線1.77→2.56、--muted 5.77→6.85(カード背景
    --panel-2基準で妥当)、P2Pエッジ青3.87→6.72・紫3.95→6.60、パルス
    16.55)。変更なしとされた他4色もstroke-opacity 0.85適用後は6.2:1以上。
  - `peerEdge.test.ts`は`NETWORK_COLORS`への包含と`networkIdColor`との
    一致のみを検証しており16進値の直書きは無い。線幅・半径・不透明度を
    直書きしたテストも無く、パレット変更によるテスト破壊は無い。
  - `colorMode="dark"`は`@xyflow/react` v12の正規API。アプリ側に
    Controls/MiniMapのカスタムCSSは無く競合しない。カードはカスタム
    ノード型、エッジ色はインラインstyle指定のためダークテーマ変数の
    影響を受けない。
  - 差分は色・不透明度・半径・線幅・テーマ指定のみでロジック変更は無く、
    新規テスト省略の判断はCLAUDE.mdの方針と整合する。
  - `pnpm lint` / `pnpm build` / `pnpm test`(frontend 301件・collector
    330件ほか)全通過。docs/ARCHITECTURE.md・CONCEPT.mdに配色への言及は
    無く齟齬なし。境界違反・チェーン固有語彙の漏れ・エラー握りつぶしなし。
- 決定事項・注意点: 合格。ただし軽微な指摘が2点あり、対応は統括の判断に
  委ねる(いずれもコントラスト改善の結論には影響しない)。
  1. `colorMode="dark"`の副作用として、`.react-flow.dark`が
     `--xy-background-color-default: #141414`を定義し`<Background />`が
     キャンバス全面をこの色で塗る(ライト時はtransparentでアプリの
     `--bg #0f1420`が透けていた)。エッジの実背景は#141414に変わるが
     検算の結論は不変(青6.70・紫6.61・輪郭線2.56、両背景の輝度差は
     1.00:1)。一方で`peerEdge.ts`・`styles.css`のコメントは「背景
     (--bg #0f1420)の上に描かれる」と記しており実態とずれる。
     `<Background bgColor="var(--bg)" />`でアプリの紺色に揃えるか、
     コメントを実態に合わせて修正するのが望ましい。
  2. WORKLOGの「ヘッダー/ツールバーの区切り線は現状の#33405aを再利用」
     という記述について、当該箇所の変更前の色は#2a3346であり、実際には
     わずかに明るく変化している(値としての#33405a再利用は事実)。
     記述の正確性の観点で補足しておく。

### 2026-07-04 Issue #32 ダークモードUI視認性改善のQA検証(qa)

- 担当: qa
- ブランチ: issue-32-dark-mode-contrast
- 内容: 未コミットのワークツリーを実際に動かして検証した。frontendを
  `pnpm dev`(モックモード、VITE_COLLECTOR_URL未設定で`mockData.ts`を描画)で
  起動し、スクラッチパッドに残っていたPlaywright(chromium headless、
  LD_LIBRARY_PATH経由)でスクリーンショットを取得・DOMの算出値を検証した。
  - CSS変数の実値をブラウザ上で確認: `--bg #0f1420` / `--border #46577d` /
    `--divider #33405a` / `--muted #a9b5cc`。いずれも実装意図と一致。
  - キャンバス背景: `.react-flow__background`に`--xy-background-color-props:
    var(--bg)`がバインドされ、`colorMode="dark"`適用下でも背景色がアプリの
    紺色`#0f1420`になっていることを確認した。無彩色グレー(#141414)には
    なっておらず、レビュー指摘への`<Background bgColor="var(--bg)" />`対応が
    実際に効いている。スクリーンショット上も紺色で、変更前と色相が一致。
  - React Flowのクラスが`react-flow dark`となり、Controls/MiniMapが
    ダークテーマで描画されることを確認した。変更前(01-overview-before.png)は
    MiniMapが白背景・Controlsも明色でダークUIから浮いていたが、変更後は
    両方ともダーク背景に変わり統一されている(最も体感差の大きい改善)。
  - カード・ポップアップ・ツールバーの輪郭線が変更前より明瞭。ホバーで
    インフラポップオーバー(IP/ポート/プロセス/CPU/メモリ)、用語解説
    ポップオーバー(定義文・関連レイヤーのリンク)が正しく表示され、
    補助テキストも読み取れる。
  - P2Pエッジ: `stroke-opacity: 0.85` / `stroke-width: 2px`をDOMで確認。
    ブロック伝播パルスはモックがパルスのパイプライン(BlockEntityの受信
    時刻)に給餌しないため実描画は出ないが、`r=5`・`drop-shadow`拡大の
    変更はソース/DOM上で確認済み(collector実データ由来の要素)。
  - ブラウザのconsoleエラー・pageエラーはゼロ。
  - 静的確認として `pnpm lint`(exit 0)・`pnpm build`(exit 0)・
    `pnpm test`(frontend 301件・collector 330件ほか全パス)も再実行して通過。
- 判定: 合格。実際の画面で配色改善(輪郭線・補助テキスト・エッジ・
  Controls/MiniMapのダーク化)が確認でき、背景色も意図どおり`#0f1420`。
  本Issueはdocs/PLAN.mdのチェックボックスに紐づかないためPLAN.mdへの
  チェック付与は不要。
- 決定事項・注意点: headless chromiumに日本語フォントが無く、日本語文字が
  豆腐(□)表示になるが、これは検証環境のフォント欠落でありアプリの不具合では
  ない(配色・コントラストの検証には影響しない)。検証後はvite dev serverを
  停止し、クリーンな状態に戻した。
### 2026-07-04 Issue #65 起動時のmanagedコンテナ回収によるレジストリ再構築(collector)

- 担当: collector
- ブランチ: issue-65-managed-recovery
- 内容:
  - `DockerOperations`(docker/operations.ts)に、指定ラベル(すべて一致)を
    持つコンテナ一覧を停止中も含めて返す `listContainersByLabels` を追加した。
    ラベルの意味づけ(どのキーが何を表すか)はここでは扱わず、呼び出し側
    (ChainAdapter)が解釈する契約とし、Docker 共通語彙の範囲に留めた。
    dockerode 実装(dockerode-operations.ts)は `listContainers({ all: true,
    filters: { label: [...] } })` で実現した。
  - `EthereumNodeLifecycle`(adapters/ethereum/node-lifecycle.ts)に
    `recoverManagedContainers()` を追加した。`com.chainviz.managed=true`
    ラベルを持つコンテナを走査し、`com.chainviz.role`(execution/consensus/
    workbench)と `com.docker.compose.service`(reth<n>/beacon<n> の命名規則)
    から reth+beacon のペアやワークベンチを再構成し、`this.nodes`/
    `this.workbenches` を再構築する。ファイルベースの永続化は行わず、
    Docker側のラベルを単一の真実の情報源として扱う。
  - `ManagedNode` の `execution`/`consensus` を optional にした。通常の
    addNode では常にペアで作られるが、回収時には「片方だけ生き残っている」
    状態(例: removeNode が片方の削除に成功した直後に collector が落ちた
    場合)が現実に起こりうるため、片方だけでも登録して removeNode の
    再実行で後始末できるようにした。
  - `index.ts` の `main()` で、`CommandHandler` をワイヤリングする(=
    addNode/removeNode 等を受け付け始める)前に `recoverManagedContainers()`
    を呼ぶよう配線した。
  - 対応するユニットテストを追加した(dockerode-operations に
    `listContainersByLabels`/`toLabelFilters` のテスト、node-lifecycle に
    `parseNodeIndex` と `recoverManagedContainers` のテスト一式: ペア回収・
    ワークベンチ回収・片割れのみの回収・不正ラベル/インデックスのスキップ・
    project ラベル欠落時のフォールバック・回収後の addNode/addWorkbench との
    整合性)。
- `uncaughtException` 方針の見直し(Issue #63 からの引き継ぎ課題):
  - Issue #63 時点では「collector プロセスが落ちる = managed コンテナの参照が
    すべて失われ孤児化する」ことを理由に、`uncaughtException` も含めて
    「ログして継続する」方針を採っていた。今回の対応でその前提(プロセス
    消滅=全コンテナ孤児化)が解消したため、`uncaughtException` については
    Node 公式の指針(捕捉できなかった例外の後はプロセスの状態が不定であり、
    継続すべきではない)に戻し、ログを残したうえで `process.exit(1)` する
    よう `installProcessSafetyNet`(index.ts)を変更した。collector は
    `node dist/index.js` でホスト上に手動起動される開発・学習用ツールであり、
    自動再起動の仕組み(supervisor やコンテナの restart ポリシー)は用意して
    いない。したがって exit(1) 後は開発者が手動で再起動するまで停止した
    ままになるが、クラッシュはターミナルの終了とフロント側の切断表示で
    即座に可視化されるため、不定状態のプロセスが壊れた観測結果を配信し
    続けるよりは望ましい(開発ツールとして許容範囲)。再起動後は
    `recoverManagedContainers` が既存のノード/ワークベンチを回収するため
    実害はない。将来 supervisor 等の自動再起動を導入した場合も、この
    exit(1) はそのまま再起動の契機として機能する。
  - 一方 `unhandledRejection` は「await/catch し忘れた promise の失敗」で
    あることが多く、必ずしもプロセス全体の状態が破損しているとは限らない
    ため、従来どおりログして継続する方針を維持した。
  - `installProcessSafetyNet` にテスト用の `exit` 差し替え引数を追加し、
    実プロセスを終了させずに挙動を検証できるようにした。
- 実機検証: 稼働中の profiles/ethereum に対し、ビルド済み collector を
  一時ポート(4077)で起動し、addNode でノード追加 → commandResult(ok:true)
  → reth3/beacon3 コンテナ生成を確認 → プロセスを `kill -9` で強制終了
  (クラッシュを模擬)→ 同ポートで再起動 → removeNode(reth3)を送信し
  commandResult(ok:true)、実際に reth3/beacon3 コンテナが削除されている
  ことを確認した(修正前の挙動であれば「addNodeで追加されていない」で
  拒否されるはずのシナリオ)。既存 compose のノード(reth1/2, beacon1/2,
  validator1/2, workbench)には影響がないことも確認した。
- 検証: collector パッケージの `pnpm build` / `pnpm test`(349 tests)
  通過。ワークスペース全体の `pnpm build` / `pnpm lint` / `pnpm test`
  (collector 349 + frontend 301 + shared 2 + e2e 14 = 666 tests)通過。

### 2026-07-04 Issue #65 レビュー(chainviz-reviewer)

- 対象: issue-65-managed-recovery(未コミットのワークツリー)
- 静的確認: `pnpm build` / `pnpm lint` / `pnpm test` 全通過(collector 349 +
  frontend 301 + shared 2 + e2e ヘルパー 14 = 666 件)。`pnpm test:e2e` は
  Issue #64 の同時実行問題を避けるため実行していない(指示による)。
- 合格と評価した点:
  - ChainAdapter 境界: `listContainersByLabels` は Docker 共通語彙
    (ラベルの key/value・コンテナ id)のみを扱い、ラベルの意味づけ
    (`com.chainviz.managed` / `com.chainviz.role` / reth<n>・beacon<n> の
    命名規則)は ethereum アダプタ内に閉じている。shared / frontend への
    チェーン固有語彙の漏れなし。
  - `packages/shared` の型変更不要の判断は妥当(プロトコル・ワールド
    ステートのスキーマに変更がなく、回収は collector 内部の関心)。
  - `recoverManagedContainers` と既存ロジックの整合: 回収した index が
    `addNode` の takenIndexes に効くこと、回収済みワークベンチ名が
    `uniqueWorkbenchService` の退避に効くことがテストで実証されている。
    `ManagedNode.execution/consensus` の optional 化も「片割れだけ残る」
    実在する異常系への妥当な対応で、removeNode の再実行で後始末できる。
  - エラーの握りつぶしなし: 回収時のスキップは console.warn で残し、
    回収自体の失敗は main() の fatal 経路で exit(1) する(回収できないまま
    コマンド受付を始めると #65 以前の状態に戻るため fail-fast が正しい)。
  - uncaughtException の方針転換(ログ+exit(1))自体は妥当。Issue #63 で
    「継続」を選んだ唯一の根拠(プロセス消滅=全 managed コンテナ孤児化)が
    本対応で解消し、不定状態のプロセスが壊れた観測結果を配信し続ける
    リスクの方が停止より悪い。unhandledRejection を「ログして継続」に
    残す区別も合理的。
- 差し戻し(要修正)2点:
  1. supervisor 前提の記述が現状と不一致: リポジトリには collector の
     自動再起動機構が存在しない(compose に restart ポリシーなし、collector
     は `pnpm start`/`node dist/index.js` でホスト上に手動起動)。ログ文言
     「exiting so a supervisor can restart the collector」とコード内
     コメント・WORKLOG の「supervisor/コンテナの再起動ポリシーによる
     再起動を前提とする」は実在しない前提を書いている。方針自体は
     手動再起動でも成立する(exit は開発者に即座に見え、再起動後に回収が
     効く)ため、記述を「現状は手動再起動(開発ツールとして許容)。将来
     supervisor を導入しても安全」という事実に合わせて修正すること。
  2. 回収クエリのスコープが自分の書くラベルと非対称:
     `recoverManagedContainers` は `com.chainviz.managed=true` だけで
     フィルタしているが、この lifecycle が作るコンテナは必ず
     `com.docker.compose.project`(cfg.composeProject)も付けている。
     クエリに project ラベルを加えないと、(a) 将来の別チェーン
     プロファイルの lifecycle が同じ managed ラベルを使ったとき互いの
     コンテナを取り込む(チェーンプロファイル独立性の原則に反する)、
     (b) `?? this.cfg.composeProject` フォールバックが、project ラベルを
     持たない外来コンテナに `chainviz-ethereum/<service>` という stableId を
     捏造する。正規のコンテナには決して発火しないフォールバックであり、
     テスト「falls back to the configured composeProject...」はこの誤動作を
     仕様として固定してしまっている。クエリへ
     `[COMPOSE_PROJECT_LABEL]: this.cfg.composeProject` を追加し、
     フォールバックは削除(欠落時は warn してスキップ)、当該テストは
     新しい契約に合わせて書き換えること。
- 軽微(任意)の指摘:
  - `this.workbenchSeq = this.workbenches.length;` のコメント「既に使われて
    いる番号より後ろから採番を再開」は不正確(復元できるのは個数であって
    過去の最大番号ではない。以前に削除された分だけ番号が進んでいた場合、
    理論上は名前衝突しうる)。衝突しても createAndStart の失敗が
    commandResult(ok:false) で返るため実害は限定的だが、コメントは実挙動
    (個数から再開)に合わせて正すこと。
  - sync-docs 観点: docs/ARCHITECTURE.md「未確定のまま残す項目」の
    「再起動時の復元をどうするか」に対し、今回 managed レジストリについて
    「Docker ラベルを単一の真実の情報源とし起動時に回収する」方針が
    確定した。ARCHITECTURE.md への反映(追記)を推奨する。
  - コミット分割の指針(未コミットのため事前助言): 少なくとも
    uncaughtException の方針変更は managed コンテナ回収の実装とは別の
    関心事なので別コミットにすること(例: docker 操作の追加 / 回収
    ロジック+配線 / safety net 方針変更 / docs の 3〜4 分割)。
- 結論: 設計・境界・テストの質は良好。上記2点の修正(いずれもコメント・
  文言とクエリ条件の小規模修正)を反映のうえ再確認とする。

### 2026-07-04 Issue #65 レビュー指摘への対応(collector)

- 担当: collector
- ブランチ: issue-65-managed-recovery
- 対応した指摘(chainviz-reviewer の差し戻し2点 + 軽微指摘):
  1. 存在しない supervisor 前提の記述を実態に合わせて修正した。
     collector は `node dist/index.js` で手動起動される開発・学習用ツールで
     あり自動再起動機構は無いため、`installProcessSafetyNet`(index.ts)の
     uncaughtException ログ文言を
     「exiting (restart the collector manually to resume)」に変更し、
     同関数の doc コメントと WORKLOG の記述も「手動再起動(開発ツールとして
     許容)。クラッシュは端末終了とフロントの切断表示で即座に可視化され、
     再起動後は recoverManagedContainers が状態を復元する。将来 supervisor を
     導入しても exit(1) はそのまま再起動契機として機能する」という事実に
     合わせて書き換えた。index.test.ts のテスト名からも supervisor の記述を
     除いた(挙動の検証内容は不変)。
  2. 回収クエリのスコープ漏れを修正した。`recoverManagedContainers()` の
     `listContainersByLabels` フィルタに
     `[COMPOSE_PROJECT_LABEL]: this.cfg.composeProject` を追加し、別チェーン
     プロファイルの lifecycle が同じ managed ラベルを使っても互いの
     コンテナを取り込まないようにした(チェーンプロファイル独立性)。
     あわせて `toManagedContainer` の `?? this.cfg.composeProject`
     フォールバックを削除し、project ラベルが欠落しているコンテナは warn して
     スキップするようにした(欠落時に安定 ID を捏造しない)。既存テスト
     「falls back to the configured composeProject when the project label is
     absent」は誤った挙動を仕様化していたため、新しい契約(project ラベル
     欠落時はスキップされ removeNode が拒否される)を検証するテストへ
     書き換えた。
  - 軽微: `workbenchSeq = this.workbenches.length` のコメントを、復元できる
     のは過去の最大番号ではなく現存する個数である旨(および衝突時は
     createAndStart 失敗で commandResult(ok:false) として返るため実害が
     限定的である旨)に正した。
  - 軽微(sync-docs): docs/ARCHITECTURE.md「未確定のまま残す項目」の
     「再起動時の復元をどうするか」に、managed レジストリについて
     「Docker のラベルを単一の真実の情報源とし起動時に回収する」方針が
     確定した旨を追記した。
- 検証: collector パッケージの `pnpm build` / `pnpm test` 通過。ワーク
  スペース全体の `pnpm lint` / `pnpm build` / `pnpm test` 通過。

### 2026-07-04 Issue #65 再レビュー(chainviz-reviewer)

- 対象: issue-65-managed-recovery(未コミットのワークツリー、差し戻し対応後)
- 静的確認: `pnpm lint` / `pnpm build` / `pnpm test` 全通過(collector 349 +
  frontend 301 + shared 2 + e2e ヘルパー 14 = 666 件)。`pnpm test:e2e` は
  指示により実行していない。
- 差し戻し2点の確認結果:
  1. supervisor 前提の記述: ログ文言が「exiting (restart the collector
     manually to resume)」へ、doc コメント・WORKLOG が「手動再起動を前提と
     した開発ツール。将来 supervisor を導入しても exit(1) はそのまま機能」
     という事実に修正済み。uncaughtException で exit(1) すること・
     unhandledRejection では exit しないことの両方がテストで固定され、
     旧挙動(継続)ではテストが落ちることを確認した。適切。
  2. 回収クエリのスコープ: `recoverManagedContainers()` のフィルタに
     `com.docker.compose.project`(cfg.composeProject)が追加され、
     `toManagedContainer` のフォールバックは削除、project ラベル欠落時は
     warn してスキップに変更済み。書き換えられたテスト(欠落コンテナは
     登録されず removeNode が拒否される)は、旧コード(フォールバック有り)
     では removeNode が成功して落ちるため、新契約を実効的に固定している。
     適切。
  - 軽微指摘(workbenchSeq コメントの実挙動への修正、ARCHITECTURE.md
    「未確定のまま残す項目」への方針確定の追記)も対応済みを確認した。
- 残指摘(小・要対応): クエリスコープ修正のうち「フィルタに project ラベルを
  含める」側がテストで固定されていない。node-lifecycle.test.ts の fakeOps は
  `listContainersByLabels` の引数を無視して managedContainers を返すため、
  実装のフィルタを `{ [MANAGED_LABEL]: "true" }` だけに戻しても(= 別チェーン
  プロファイルのコンテナを取り込む元の欠陥が再発しても)全 666 テストが通って
  しまう。recoverManagedContainers のテストのいずれかに
  `expect(ops.listContainersByLabels).toHaveBeenCalledWith({
  "com.chainviz.managed": "true", "com.docker.compose.project":
  "chainviz-ethereum" })` 相当のアサーション(1件)を追加すること。
- 結論: 差し戻し2点の修正は適切。上記アサーション1件の追加をもって合格とする
  (実装コードの変更は不要、テスト1行の追加のみ)。

### 2026-07-05 PR #85 ステップ7(Phase3実装 — C層)のPLAN.md追記のレビュー(reviewer)

- 担当: reviewer
- ブランチ: docs-step7-plan
- 内容: `docs/PLAN.md` へステップ7を追記する1コミットのdocs変更を
  レビューした。結果は合格。
  - 9個のチェックボックスの文言がIssue #76〜#84のタイトルと完全に一致
    し、担当区分(collector: #76/#77/#79/#80、node-env: #78、frontend:
    #81〜#84)もIssueのラベルと整合することを`gh issue view`で確認した。
    全IssueがOPENでmilestone 6に紐づいている(open 9件)。
  - 冒頭のCONCEPT.md Phase 3引用は原文(ロードマップ3項)と一致。
    ステップ8以降のリストからPhase 3の行が除去され、Phase 4〜8が
    正しく繰り下がっている。
  - `pnpm lint` / `pnpm build` / `pnpm test`(collector 353件、
    frontend 301件)がすべて通ることを確認した。
  - コミットは1件で「1変更=1コミット」の規約に適合。
- 決定事項・注意点:
  - CONCEPT.mdのC層定義には「コントラクト呼び出しやイベントログの
    可視化」が含まれるが、ステップ7では範囲外と明記されている
    (先回り実装をしない方針に沿った意図的なスコープ判断)。CONCEPT.md
    ロードマップの「C層 完成」という表現とは厳密には差分があるため、
    C層の残項目に着手する際に別途スコープすること。
  - Issue #81本文はtxのstatusに「failed」を含むが、collector側の
    Issue #76は「pending→included」までしか言及していない。failedの
    データ源をどうするかは実装着手時にcollector/frontend間で調整が
    必要。
  - コミットメッセージ本文の「バックログのPhase3項目」は、正確には
    PLAN.mdの「ステップ7以降(概要のみ)」セクションの項目を指す
    (PLAN.mdには別に「バックログ」セクションがあるため紛らわしい)。
    履歴改変は不要だが、記録として残す。
