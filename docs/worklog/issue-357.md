# Issue #357: docker compose down -v後もEOA(ウォレット)が削除されずに残る

### 2026-07-17 原因調査(detective)

- 担当: detective
- ブランチ: issue-357-eoa-not-cleared-on-down
- 内容: 「`docker compose down -v` してもEOA(ウォレット)が削除されず残る」
  というユーザー報告の原因を、実測に基づいて調査した。**根本原因を特定済み。
  コードの不具合ではなく設計上の未考慮ケース(チェーンリセット検知の欠如)が
  主因で、修正には設計判断が必要。**

## 観測した事実(すべて実測)

1. **調査開始時点で docker は完全に空だった**(`docker ps -a`・
   `docker volume ls`・`docker network ls` に chainviz 関連ゼロ)。
   つまりユーザーの `down -v` はコンテナ・ボリューム・ネットワークの
   破棄自体には成功していた。
2. **その状態でも collector プロセス(PID 181930)は 13:25 から生き続けて
   いた**(ポート 4000/4001 を保持。`/proc/181930/cwd` はワークツリー
   `.claude/worktrees/agent-a69885edca92581fe` = Issue #315 QA時に起動された
   もの)。ホスト上のプロセスなので `docker compose down` の影響を受けない。
3. スタックを `up` し直した直後、この collector の WebSocket スナップ
   ショットに **workbench 1 件に対して wallet が 4 件**存在した。うち 3 件は
   `ownerWorkbenchId: null` で、残高は旧チェーンの値のまま凍結
   (例: `1000000000002000000000000000` wei — プリマイン 1e27 に旧セッションの
   送金 2e15 が加算された値。新チェーンではあり得ない)。さらに新チェーンに
   存在しない contract(ChainvizNFT, 0x47f8f007…)も残っており、NftTracker が
   毎周期 `Cannot decode zero data ("0x")` エラーを出し続けていた
   (ログ 5MB 超)。
4. コードレベルの裏付け: `packages/collector/src/world-state/diff.ts` の
   `computeWalletDiff` は wallet の `entityRemoved` を一切発行しない。
   ワークベンチ消滅時は `ownerWorkbenchId: null` に更新するだけで、
   エンティティ自体は残す。これは意図的な仕様
   (`docs/ARCHITECTURE.md` L231「ワークベンチ削除後も null にして残す」。
   EOA はワークベンチを消してもチェーン上に存在し続けるため)。
5. **補助的な第2の問題(隔離環境で実証)**: collector が `addWorkbench` /
   `addNode` で作るコンテナは compose 互換ラベル
   (`com.docker.compose.project` 等)を持つが compose の管理下にはなく、
   `docker compose down -v` では削除されない。最小 compose プロジェクト
   (`det-orphan-test`)+同一ラベル構成のコンテナで再現したところ、
   `down -v` 後もコンテナは稼働し続け、ネットワーク削除も
   「Resource is still in use」で失敗した。`--remove-orphans` を付けても、
   `com.docker.compose.oneoff=False` ラベルを足しても削除されなかった
   (Docker Compose v2.40.3 / Engine 29.1.3)。
   ※今回のユーザーのケースでは down 前に managed コンテナが
   (removeWorkbench 経由等で)消えていたため docker 側は空だったが、
   managed コンテナが残ったまま `down -v` するとこの経路でも EOA が残る。

## 特定した根本原因

**collector はホスト上の長寿命プロセスであり `docker compose down -v` の
影響を受けないが、「チェーン自体が破棄された(genesis が変わった)」ことを
検知してワールドステートの C 層エンティティ(wallet / contract)をパージする
仕組みが存在しない。** wallet はワークベンチ消滅時に所有者を null にして
残す仕様(チェーンが生き続ける前提では正しい)のため、`down -v` →
`up`(新 genesis)後も旧チェーンの EOA・コントラクトがワールドステートに
残留し、フロントに表示され続ける。

加えて `EthereumNodeLifecycle` のメモリ上レジストリ(workbench の
wallet-index 採番)もリセットされないため、リセット後に作った新ワーク
ベンチが旧セッションと同じ導出インデックス(= 同じアドレス)を再利用し、
残留ゴーストウォレットが新ワークベンチに「再所有」されて状態が混ざる
副作用もある。

なお Issue 本文の他の仮説は棄却:
- ホスト側ファイルへのウォレット永続化 → 無い(collector の fs 書き込みは
  values.env 読み取り・catalog 読み取り・build マーカーのみ)
- wallet-derivation のキャッシュ参照 → 無い(mnemonic + ラベルからの純導出)
- frontend localStorage → レイアウト座標(`chainviz.layout.v1`)と言語設定
  のみでエンティティは持たない。表示側の問題ではない

## 再現手順(要約)

1. スタック `up` + collector 起動 → `addWorkbench` で EOA を作る
2. collector を動かしたまま `docker compose down -v` → `up`
3. collector のスナップショットに旧 EOA(owner=null)と旧 contract が
   残り続ける(実測で確認)

## 推奨される次のアクション

1. **chainviz-designer に設計を依頼**(主修正): チェーンリセット
   (genesis 変更)の検知方法(例: block 0 のハッシュ変化・ブロック番号の
   後退検知)と、検知時の C 層エンティティ(wallet / contract / NFT 台帳・
   NodeLifecycle レジストリ含む)のパージ方針を決める。実装は
   chainviz-collector。
2. **第2の問題(managed コンテナが down -v で消えない)**は別 Issue 化を
   推奨: `--remove-orphans` でも消えないことを実測済みのため、profiles の
   README への注意書きと、ラベルベースの掃除スクリプト
   (`docker rm -f $(docker ps -aq --filter label=com.chainviz.managed=true)`
   相当)の提供が候補(node-env + docs)。
3. 運用面: QA・e2e 作業で起動した collector プロセスが作業後も残留する
   (今回 4 時間半稼働)。検証系エージェントの後片付け徹底も再発防止に有効。

## 調査時の注意点

- 調査中、共有環境で別エージェントの e2e(comms-log.spec.ts)が同じ
  collector・スタックを使用中だったため、実スタックへの `down -v` は行わず、
  第2の問題は隔離した最小 compose プロジェクトで検証した(検証後に掃除済み)。
- 調査用に起動したスタック(profiles/ethereum)は e2e が使用中のため
  起動したままにしてある。

### 2026-07-17 Issue #357 チェーンリセット検知とパージの設計(designer)

- 担当: designer
- ブランチ: issue-357-eoa-not-cleared-on-down
- 内容: 上記調査結果を受けて、チェーンリセット(genesis 変更)の検知方法と
  検知時のパージ方針を設計した。`packages/shared` の型定義
  (`ChainAdapter.subscribeChainResets?`)を先行実装し、全パッケージの
  `pnpm build && pnpm test` が通ることを確認済み(shared 74 / collector
  1523 / e2e 171 / frontend 2460 全て pass)。設計の正式な記述は
  `docs/ARCHITECTURE.md` に反映済み(§2「例外: チェーンリセット時の
  パージ」、§4 `subscribeChainResets` の項)。以下は実装担当(collector)
  向けの要約と、ドキュメントに書ききれない実装上の指針。

#### 決定した設計(要約)

1. **検知方法 = block 0(genesis)ハッシュの変化**。アダプタ内の周期
   ポーリング(`subscribePeers` と同型の setTimeout ループ、間隔は既定
   3 秒・コンストラクタオプションで注入可能にしてテスト容易性を確保)で、
   到達可能な Execution ノード 1 台から `eth_getBlockByNumber(0x0)` の
   ハッシュを取得し、前回観測値と比較する。
   - 初回観測はキャッシュを埋めるだけ。**異なるハッシュを実際に観測できた
     ときだけ**リセット判定(観測失敗=欠測はリセットの証拠にしない。
     Issue #288 と同じ原則)
   - ブロック番号の後退検知は不採用(addNode 追いつき中の過去ブロック
     流入と区別できない)。genesis ハッシュは `generate-genesis.sh` が
     生成のたびに `date +%s` を焼き込むため `down -v`→`up` で必ず変わる
     ことを確認済み
2. **パージ範囲(store)**: 新メソッド `WorldStateStore.
   purgeChainDerivedState()` が kind ∈ {wallet, contract, block,
   transaction} の全エンティティを削除し、通常の `entityRemoved` の配列と
   して返す。**あわせて `maxObservedBlockNumber` を undefined に戻す**
   (戻さないと新チェーンのブロック 1〜N が旧チェーン基準の保持窓
   `BLOCK_RETENTION` に弾かれて取り込めない。これ自体が第2の不具合に
   なるので必須)。node/workbench・PeerEdge は削除しない(A層/B層の毎 tick
   照合で自己修復するため)。
3. **パージ範囲(アダプタ内部キャッシュ)**: 新メソッド `EthereumAdapter.
   resetChainDerivedState()` でクリアする。対象: ContractTracker
   (contracts + pendingCatalogKeys。**最重要**。残すと WalletTracker /
   NftTracker が旧チェーンのトークン・NFT アドレスをポーリングし続けて
   エラーを出し続ける=今回実測されたログ 5MB 超の直接原因)、
   TransactionLifecycleTracker、BlockPropagationTracker、HeadTipCache、
   NodeSyncStatusCache / BeaconSyncStatusCache、デプロイ tx 生ログ保持
   バッファ(Issue #244 の再復号用)。ピア観測キャッシュ(Issue #288)は
   次回成功観測で上書きされるためクリア必須ではない(実装担当の裁量)。
4. **DiffEvent は追加しない**。パージは既存 `entityRemoved` の連発で表現
   する。フロントの `applyDiff`(`frontend/src/world-state/store.ts` L83)
   は entityRemoved を kind 非依存で処理するためフロント実装は不要。
   エンティティ数は保持窓(block 32 / pending tx 256 / included tx は
   block 連動 / wallet・contract は少数)で有界なのでイベント量も問題ない。
5. **`EthereumNodeLifecycle` のレジストリ(wallet-index 採番)はパージ
   しない**。レジストリは「managed コンテナの実在」を映すもので、真実の
   情報源は Docker ラベル(Issue #65)。チェーンリセットはコンテナの消滅を
   意味しない(調査どおり managed コンテナは `down -v` を生き延び得る)。
   調査記録にある「ゴーストウォレットの再所有」の副作用は、ゴースト
   エンティティ自体を store からパージすることで解消する(同じ導出
   インデックス=同じアドレスの再利用は mnemonic 由来の正しい挙動で、
   パージ後は新チェーンの観測から正しく作り直される)。
6. **UI 通知は追加しない**(旧カードの消滅+ブロック番号の巻き戻りで視覚的
   に伝わる。必要と判断されたら UX 設計を経て揮発性イベントとして別 Issue
   で追加できる形を保つ)。

#### 実装分担と配線(collector のみ。frontend / node-env 作業なし)

- 新規ファイル `packages/collector/src/adapters/ethereum/
  chain-reset-watcher.ts`(+ テスト): genesis ハッシュの観測・比較ロジック。
  1ファイル1責務のため、ループ・キャッシュ・判定をここに閉じ、RPC 到達は
  既存の `eth-rpc-client.ts` / `targets.ts`(`executionTargets`)を使う
- `adapters/ethereum/index.ts`: `subscribeChainResets(onReset)` の実装
  (watcher の起動)と `resetChainDerivedState()` の追加。各トラッカー/
  キャッシュクラスに `reset()`(名称は既存慣習に合わせて可)を追加
- `world-state/store.ts`: `purgeChainDerivedState()` の追加
- `index.ts`(main): 配線。順序は (1) `adapter.resetChainDerivedState()`
  → (2) `store.purgeChainDerivedState()` → (3) `server.broadcastDiff(...)`。
  アダプタのキャッシュを先にクリアするのは、パージ直後の tick で旧
  アドレスの再ポーリング・旧エンティティの再投入が走らないようにするため

#### 実装担当が前提にしてよいこと / 実装時に判断してよいこと

- 前提: shared の `subscribeChainResets?(onReset: () => void): void` は
  実装済み(本設計でコミット)。省略可メソッドなので他アダプタへの影響なし
- 前提: フロントは無変更で追従する(entityRemoved の一般処理)
- 裁量: watcher を専用ループにするか既存ループへ相乗りさせるか(推奨は
  `subscribePeers` と同型の専用ループ)、問い合わせ先ノードの選び方
  (到達可能な最初の 1 台でよい。全ノードは同一 genesis を共有する前提)、
  ピア観測キャッシュをクリアするか
- テスト観点(tester への引き継ぎ含む): 初回観測でリセットしない/ハッシュ
  変化でリセットする/観測失敗でリセットしない/パージ後に block 番号 1 の
  `applyBlock` が受理される(maxObservedBlockNumber リセットの回帰)/
  パージが node・workbench・エッジを残す
- QA 観点: 実際に collector を動かしたまま `docker compose down -v` →
  `up` し、(1) 旧 wallet/contract がパージされる、(2) NftTracker のエラー
  ログが止まる、(3) 新規 addWorkbench のウォレットが正常に観測される、
  (4) フロントで開いたままのポップオーバー(wallet/contract)がパージ時に
  クラッシュしない(フロントが wallet の entityRemoved を受けるのは今回が
  初)ことを確認する

### 2026-07-17 collector 実装: 設計メモ

- 担当: collector
- ブランチ: issue-357-eoa-not-cleared-on-down
- 実装着手前に、上記 designer の設計を踏まえた実装方針を以下にまとめる。

#### データフロー

```
EthereumAdapter.subscribeChainResets(onReset)
  -> ChainResetWatcher.subscribe(onReset)（新規、3秒周期ループ）
       tick ごとに observeOnce():
         poller.pollOnce() -> executionRpcUrls(observations)
         -> 先頭から順に fetchGenesisHash(rpc, url) を試す
         -> 全滅なら undefined（欠測。前回値を維持し onReset を呼ばない）
       前回値と異なるハッシュを実際に観測できた時だけ onReset() を呼ぶ

collector 本体（index.ts の main）:
  adapter.subscribeChainResets(() => {
    adapter.resetChainDerivedState();   // (1) アダプタ内部キャッシュをクリア
    const diff = store.purgeChainDerivedState(); // (2) store をパージ
    server.broadcastDiff(diff);          // (3) entityRemoved を配信
  });
```

#### 主要な関数構成

- 新規 `chain-reset-watcher.ts`: `ChainResetWatcher` クラス。
  `WalletTracker`/`NftTracker`（collector 本体で直接インスタンス化される
  独立トラッカー）と同型で、自前の `subscribe`/`dispose`/周期ループを持つ。
  `executionRpcUrls`（`targets.ts`）で候補 URL を得て、先頭から順に
  `fetchGenesisHash`（`eth-rpc-client.ts` に新規追加）を試す
  「到達可能な最初の1台でよい」実装は `WalletTracker.fetchWalletState` と
  同じ「順に try、成功したら即返す」パターンを踏襲する。
- `EthereumAdapter`（`index.ts`）: コンストラクタで `chainResetWatcher`
  フィールドを生成（`this.poller`/`this.ethRpc` を渡す）。
  `subscribeChainResets(onReset)` は起動を委譲するだけ。
  `resetChainDerivedState()` は `contractTracker`/`txTracker`/
  `blockTracker`/`headTipCache`/`syncStatusCache`/`beaconSyncStatusCache`
  の `reset()`（各クラスに新規追加）と、アダプタ自身が持つ
  `processedBlocks`/`undecodedDeployLogs` の `clear()` を呼ぶ。
  `dispose()` にも `chainResetWatcher.dispose()` を追加する。
- `store.ts`: `WorldStateStore.purgeChainDerivedState()` を新規追加。
  既存の `evictBlocksBelow`（`applyBlock` 内、保持窓からの退去処理）と
  同じ「対象エンティティを走査して `entityRemoved` を作り `applyEvent`
  する」パターンを踏襲する。あわせて `maxObservedBlockNumber` を
  `undefined` に戻す。

#### 既存パターンとの対応

- 周期ループの起動・停止（`running`/`timer`/`dispose`）は
  `WalletTracker.subscribe`/`NftTracker` と同型。
- 到達可能ノードへの順次フォールバックは `WalletTracker.fetchWalletState`
  と同型。
- 各トラッカー/キャッシュへの `reset()` 追加は、既存の
  `NodeSyncStatusCache.forgetNode`/`HeadTipCache.prune`（対象集合との
  突き合わせでエントリを破棄する）と同じ「後始末メソッドを持つ」流儀の
  延長線上（ただし今回は「全消し」なので対象集合との突き合わせは不要）。
- `store.purgeChainDerivedState()` は `evictBlocksBelow` と同じ
  「走査 → `entityRemoved` 生成 → `applyEvent` → 差分配列を返す」構造。

#### テスト方針

- `chain-reset-watcher.test.ts`（新規）: `observeOnce`（到達可能ノードから
  取得・フォールバック・全滅時 undefined）と `subscribe`（初回はキャッシュ
  埋めのみ・ハッシュ変化で onReset・観測失敗で onReset を呼ばない・dispose
  で停止・二重 subscribe 無視）を検証。
- `fetch-genesis-hash.test.ts`（新規）: `eth-rpc-client.test.ts` が既に
  1493 行と大きいため、新規関数は専用ファイルに分離する
  （CLAUDE.md のテストファイル分割方針）。
- `store-chain-reset-purge.test.ts`（新規）: `store.test.ts`
  （841行）から分離。パージ対象/対象外の kind・`entityRemoved` イベント・
  `maxObservedBlockNumber` リセットの回帰（新チェーンの block 1 が
  保持窓に弾かれないこと）を検証。
- `EthereumAdapter.resetChainDerivedState()`・`subscribeChainResets()`
  自体の配線（各トラッカーの `reset()` が実際に呼ばれること）は
  `index.ts`（main の配線）と `EthereumAdapter` 内部の呼び出しであり、
  各トラッカーの `reset()` 自体は既存の `*.test.ts`（`contracts.test.ts`
  等）に単体テストとして追加する。

### 2026-07-17 collector 実装完了

- 担当: collector
- ブランチ: issue-357-eoa-not-cleared-on-down
- 内容: 上記設計メモどおりに実装した。

#### 実装したファイル

- 新規 `packages/collector/src/adapters/ethereum/chain-reset-watcher.ts`:
  `ChainResetWatcher` クラス。genesis ハッシュの周期観測・キャッシュ・
  リセット判定を持つ。
- `packages/collector/src/adapters/ethereum/eth-rpc-client.ts`:
  `fetchGenesisHash(rpc, rpcUrl)` を追加
  （`eth_getBlockByNumber(0x0, false)` の結果から hash を取り出す）。
- `packages/collector/src/adapters/ethereum/index.ts`
  （`EthereumAdapter`）: `chainResetWatcher` フィールド・
  `subscribeChainResets(onReset)`・`resetChainDerivedState()` を追加。
  `dispose()` に `chainResetWatcher.dispose()` を追加。
- `packages/collector/src/adapters/ethereum/contracts.ts`
  （`ContractTracker`）・`transactions.ts`
  （`TransactionLifecycleTracker`）・`blocks.ts`
  （`BlockPropagationTracker`）・`head-tip-cache.ts`（`HeadTipCache`）・
  `sync-status.ts`（`NodeSyncStatusCache`）・`beacon-sync-status.ts`
  （`BeaconSyncStatusCache`）: それぞれに `reset()` を追加。
- `packages/collector/src/world-state/store.ts`
  （`WorldStateStore`）: `purgeChainDerivedState()` を追加
  （wallet/contract/block/transaction を `entityRemoved` として削除し、
  `maxObservedBlockNumber` を `undefined` に戻す）。
- `packages/collector/src/index.ts`（main の配線）:
  `adapter.subscribeChainResets(...)` を追加し、
  `resetChainDerivedState()` → `store.purgeChainDerivedState()` →
  `server.broadcastDiff(diff)` の順で呼ぶ。

#### 設計からの変更点・実装時の判断

- `executionRpcUrls`（`targets.ts`）を使った（設計メモで例示された
  `executionTargets` ではない）。`executionRpcUrls` は「チェーン全体の
  状態をどの Execution ノードに聞いても同じなので、呼び出し側は先頭から
  順に到達できたものを1つ使えばよい」という、今回の genesis ハッシュ
  取得とまったく同じ用途のために既に用意されていた関数
  （`WalletTracker.pollOnce` が同じ目的で使用済み）。`executionTargets`
  が返す `ExecutionTarget`（wsUrl・receivedAtKeys 等）は今回不要な
  情報を含むため使わなかった。
- ピア観測キャッシュ（`consensusPeerObservations`）は設計メモの
  「実装担当の裁量」どおりクリアしないことにした。次回成功観測で
  上書きされ、`CONSENSUS_PEER_OBSERVATION_GRACE_TICKS`（既定3）の猶予も
  数tickで自然に解消するため、恒久的な副作用にはならない。

#### テストファイルの分割

- 既存の `eth-rpc-client.test.ts`（1493行）・`store.test.ts`（841行）へ
  追記せず、新規関心事として `fetch-genesis-hash.test.ts`・
  `store-chain-reset-purge.test.ts` に分離した（設計メモどおり）。
- `chain-reset-watcher.test.ts` を新規追加。`observeOnce`（到達可能ノード
  からの取得・フォールバック・全滅時 undefined）と `subscribe`（初回は
  キャッシュ埋めのみで onReset を呼ばない・ハッシュ変化で onReset・
  観測失敗で onReset を呼ばない・dispose で停止・二重 subscribe の
  無視）を検証。

#### 確認結果

- `pnpm --filter @chainviz/collector build`: 成功。
- `pnpm --filter @chainviz/collector test`: 全 1544 件成功
  （実装前 1523 件 + 新規 21 件）。
- `pnpm build`（全パッケージ）: shared/collector/frontend/e2e すべて成功。
- `npx eslint packages/collector/src`: エラーなし。

#### 次の担当（tester/reviewer/QA）への申し送り

- `docs/PLAN.md` のチェックボックスは完了に更新済み（実装担当は Issue を
  自分ではクローズしない。PR の `Closes #357` によるマージ時の自動
  クローズに委ねる）。
- QA 検証時は上記「QA 観点」（このファイル冒頭の designer セクション）
  どおり、実際に `docker compose down -v` → `up` して確認すること。
  特に NftTracker のエラーログが止まることと、フロントの
  wallet/contract ポップオーバーが開いたまま `entityRemoved` を受けても
  クラッシュしないこと（フロントが wallet の `entityRemoved` を受けるのは
  今回が初めて）は実機でしか確認できない。
- `EthereumNodeLifecycle` の wallet-index 採番レジストリは設計判断どおり
  意図的にパージしていない（今回の変更範囲外）。

### 2026-07-17 テスト強化（tester）

- 担当: tester
- ブランチ: issue-357-eoa-not-cleared-on-down
- 内容: 実装担当が書いた基本テスト（ハッピーパス中心）に対し、異常系・
  境界値・時系列の観点でユニットテストを追加した。実装コードは変更して
  いない。1ファイル1責務の方針に沿い、関心事ごとに新規ファイルへ分けた。

#### 追加したテスト

- 新規 `chain-reset-watcher-transitions.test.ts`（4件）: `ChainResetWatcher`
  の複数 tick にまたがる観測列の遷移を固定した。既存 `chain-reset-watcher.test.ts`
  は 1 段の判定（初回はキャッシュ埋め・変化で onReset・単発の欠測で誤検知
  しない）を見ているが、こちらは列としての振る舞いを見る。
  - 一時的な RPC 接続断（欠測）を挟んで同じ genesis に復帰しても onReset を
    呼ばない（依頼観点1: genesis が一瞬観測できなくなる状況での誤検知防止）
  - 欠測を挟んで別 genesis を観測したときはリセットを取りこぼさない
  - down -v→up を立て続けに繰り返すと変化のたびに1回ずつ onReset を呼び、
    変化しない tick では呼ばない（依頼観点4: 連続リセット）
  - コールドスタートで最初の数 tick が欠測でも、最初に観測できたハッシュは
    キャッシュ埋めでしかなくリセット扱いにならない（境界値）
- 新規 `adapter-chain-reset.test.ts`（5件）: `EthereumAdapter` のチェーン
  リセット配線を固定した（トラッカー単体の `reset()` は各 `*.test.ts` が
  既に固定済みのため、ここは「アダプタが確かにそれらを呼ぶ」配線に絞る）。
  - `resetChainDerivedState()` がトークンコントラクトの追跡を消し、
    `trackedTokenContractAddresses()` が空になること（依頼観点3: ContractTracker
    がクリアされず NftTracker/WalletTracker が旧アドレスをポーリングし続ける
    再発の防止を、内部状態を覗ける公開メソッド経由で行動ベースに固定）
  - リセット後は同一アドレスの再デプロイが新規として再検知される（旧チェーン
    のゴーストが残らない）
  - 何も追跡していない状態で呼んでも例外を投げない（冪等・安全）
  - `subscribeChainResets(onReset)` が genesis ハッシュ変化で onReset を呼び、
    `dispose()` 後は変化しても呼ばれない（配線と後始末）
- `store-chain-reset-purge.test.ts` に1件追加: パージ後に同じアドレスの
  ウォレットを再観測すると、旧チェーンの残高・nonce を引き継がず素の状態で
  `entityAdded` される回帰テスト（依頼観点5: wallet-index 採番レジストリを
  意図的にパージしない設計のもとでも、ゴーストの「再所有」が起きないことを
  store 側の観測可能な振る舞いとして固定）。

#### 確認結果

- `npx eslint packages/collector`: エラーなし。
- `pnpm --filter @chainviz/collector build`: 成功。
- `pnpm --filter @chainviz/collector test`: 全 1563 件成功（追加した 10 件を
  含む）。

#### 発見した問題

- 実装のバグは見つからなかった。特に依頼観点1（欠測を挟む復帰での誤検知）・
  観点3（ContractTracker のクリア）は、追加したテストがいずれも期待どおり
  緑になることで、実装が「観測失敗をリセットの証拠として扱わない」原則と
  配線順序を正しく守っていることを確認した。

### 2026-07-17 レビュー（reviewer）

- 担当: reviewer
- ブランチ: issue-357-eoa-not-cleared-on-down
- 判定: **合格**（指摘なし。差し戻し不要）

#### 確認した内容

1. **shared の型変更**: `ChainAdapter.subscribeChainResets?(onReset)` は
   設計どおり省略可メソッドとして追加されている。型定義・doc コメントとも
   チェーン固有語彙を境界に出していない（Ethereum の genesis 変化への言及は
   コメント内の例示のみで、シグネチャ・スキーマには現れない）。DiffEvent を
   追加せず `entityRemoved` の連発で表現する判断は、frontend の `applyDiff`
   （`packages/frontend/src/world-state/store.ts`）が `entityRemoved` を
   kind 非依存で `delete entities[event.id]` する実装であることを確認し、
   フロント無変更で追従できることを裏付けた。
2. **エラーの握りつぶし・固定値**: `ChainResetWatcher.observeOnce` の
   ノード単位の catch は「次のノードへフォールバック」という意図コメント付き。
   全ノード到達不能時の undefined（無ログ）は「欠測をリセットの証拠にしない」
   設計そのものであり、`down -v` 中に3秒ごとのエラーログを出さないための
   意図的な挙動としてクラス doc・ARCHITECTURE.md に明記済み。tick 全体の
   catch は `console.error` でログを出す。`fetchGenesisHash` は異常形状を
   URL 込みの具体的メッセージで throw しており握りつぶしなし。3秒周期は
   環境状態に依存しない値で、`CHAIN_RESET_POLL_INTERVAL_MS` として定数化・
   テスト用に注入可能。「genesis は `down -v`→`up` で必ず変わる」前提は
   コード上のコメントと本 worklog の両方に明記されており、
   `profiles/ethereum/scripts/generate-genesis.sh` L194
   （`GENESIS_TIMESTAMP="$(date +%s)"`）で実際に成立することを確認した。
3. **`executionRpcUrls` への逸脱**: 妥当。`targets.ts` の doc コメントが
   「チェーン全体の状態はどの Execution ノードに聞いても同じなので先頭から
   順に1つ使えばよい」というまさに今回の用途を想定しており、
   `executionTargets` の返す wsUrl 等は不要な情報だった。
4. **配線順序**: `adapter.resetChainDerivedState()` →
   `store.purgeChainDerivedState()` → `server.broadcastDiff(diff)` は、
   既存の「アダプタ/観測 → store 適用 → broadcastDiff」パターン
   （subscribeContracts / subscribeBlocks 等）と一貫。アダプタ側を先に
   クリアする理由（パージ直後の tick での旧アドレス再ポーリング防止）も
   コード上のコメントに明記されている。
5. **wallet-index レジストリを残す判断の docs 反映**: ARCHITECTURE.md §2
   「例外: チェーンリセット時のパージ」にパージしないもの（node/workbench・
   PeerEdge・ライフサイクルレジストリ）とその理由（真実の情報源は Docker
   ラベル、チェーンリセット≠コンテナ消滅）が正しく記述されている。§4 の
   `subscribeChainResets` の項も実装（検知手段・欠測の扱い・処理順序・
   フロント無変更）と一致。あわせて WalletTracker / NftTracker が
   per-address のキャッシュを持たず毎 tick `getTokenContractAddresses` 等の
   コールバック経由で ContractTracker から取得する無状態設計であることを
   実装から確認し、「ContractTracker の reset で十分」という設計主張の
   裏も取った。
6. **テストの質**: 追加テストはすべて内部実装をなぞらず観測可能な振る舞いを
   固定している。特に (a) 欠測を挟んで同一 genesis に復帰しても onReset を
   呼ばない/別 genesis なら取りこぼさない時系列テスト、(b) reset 後に同一
   アドレスの再デプロイ・同一 hash の再 pending が新規として受理される
   （reset 前は仕様上無視される）逆向きの検証、(c) パージ後の block 番号 1
   受理（`maxObservedBlockNumber` リセットの回帰）、(d) パージ後のウォレット
   再観測が旧残高を引き継がない検証は、壊れた実装なら赤くなる意味のある
   テストになっている。
7. **ビルド・lint・テスト**: `pnpm lint` / `pnpm build` / `pnpm test` を
   リポジトリ全体で実行し全通過（shared 74 / e2e 171 / collector 1563 /
   frontend 2460）。
8. **コミット粒度**: `git log main..HEAD` の15コミットはいずれも単一の
   関心事（shared 型 / RPC ヘルパー / watcher / トラッカー reset / store
   パージ / アダプタ配線 / エントリポイント配線 / テスト3件 / docs）に
   分かれており、規約どおり。

#### QA への申し送り

- 実装担当の申し送りどおり、実機での `down -v` → `up` 検証（NftTracker の
  エラーログ停止、フロントの wallet/contract ポップオーバーが開いたまま
  `entityRemoved` を受けてもクラッシュしないこと）は静的レビューでは
  確認できないため QA で必ず確認すること。

### 2026-07-17 QA検証（qa）

- 担当: qa
- ブランチ: issue-357-eoa-not-cleared-on-down
- 判定: **合格**（完了条件を満たす。差し戻し不要）

実際に collector を起動したまま `docker compose down -v` → `up`（新 genesis）を
行い、チェーンリセット検知とパージの実挙動を検証した。検証で立てた collector・
frontend・WebSocket 記録クライアント・Docker スタックは検証後にすべて片付けた
（他 Issue が使用中の共有スタックは無かった。開始時に存在した 2 時間前起動の
スタックは本 Issue の調査で残されたもので、collector 未接続・ポート 4000/4001
空きを確認済み）。

#### 手順と結果

1. **元のユーザー報告の再現確認（collector 再起動なしでのパージ）**
   - リセット前の状態を作成: 既定ワークベンチのウォレット + `addWorkbench`
     で 2 つ目のウォレット + `ChainvizNFT` をデプロイ。スナップショットに
     wallet 2 件・contract 1 件・block（〜586）・transaction 1 件を確認。
   - リセット前 genesis ハッシュ `0x06b999ba…`。`down -v` → orphan の managed
     コンテナ削除 → `up` 後、新 genesis ハッシュ `0xb8912dfd…`（変化）。
   - collector プロセス（同一 PID・再起動なし）が新 genesis を検知し、新チェーン
     到達から約 3 秒後（3 秒周期の ChainResetWatcher 想定どおり）に wallet 2 件・
     contract 1 件・block/transaction 群を **同一タイムスタンプで一括
     `entityRemoved`** でパージした。旧チェーンの残高で凍結されたゴースト
     ウォレット・旧 NFT コントラクトが消えることを実測で確認。
   - パージ後スナップショット: 新チェーンの head=8 に対し collector も maxBlock=8
     （block 1〜8 を受理）。`maxObservedBlockNumber` リセットの回帰が効いており、
     新チェーンの低いブロック番号が保持窓に弾かれずに取り込まれている。ウォレット
     残高も旧凍結値ではなく素の 1e27 プリマインで、パージ後のクリーンな再観測を
     確認。

2. **レビュー担当の申し送り事項1（NftTracker のエラーログ）**
   - リセット後に発生した NftTracker の `Cannot decode zero data ("0x")` は
     **1 回のみ**（新チェーン到達直後・パージ前の一瞬。旧 NFT アドレスが新チェーン
     に存在しないため）。パージ以降はゼロ。20 秒待機しても collector ログの行数・
     nft poll 失敗件数とも一切増えず、旧不具合の「5MB 超まで継続」する現象は
     解消。down 中の `no reachable execution RPC endpoint` はチェーン停止中の
     一過性エラーで想定内。

3. **レビュー担当の申し送り事項2（wallet ポップオーバーを開いたままのクラッシュ）**
   - frontend（vite）を実際にブラウザ（Playwright + chromium）で開き、wallet
     カードにホバーして `WalletPopover` を表示した状態で `down -v` → `up` を実行。
   - wallet の `entityRemoved` がポップオーバー表示中にフロントへ到達し、対象の
     wallet カードは DOM から正常に消えた。**`pageerror` は 0 件（React クラッシュ
     なし）**、ページは生存・応答可能（`document.readyState === "complete"`）。
     フロントが wallet の `entityRemoved` を受けるのは今回が初のケースだが、
     問題なく処理された。唯一のコンソールエラーは favicon.ico の 404（既定の
     ブラウザ挙動）で本件と無関係。

4. **新チェーンでの観測再開（パージで壊れていないこと）**
   - パージ後、新チェーンで `addWorkbench`（qa-bob）と `ChainvizNFT` の再デプロイ
     を実行。新ウォレット（素の 1e27 残高）・新 NFT コントラクト（新アドレス）・
     新 transaction・ブロック進行をいずれも正常に観測。新 NFT に対する NftTracker
     エラーは発生せず、トラッカー群がリセット後も正しく機能することを確認。
   - 続けて 2 回目の `down -v` → `up`（ポップオーバー検証時）でも同様にパージ →
     再観測が正しく動作し、連続リセットでも破綻しないことを確認。

#### 完了条件との照合

`docs/PLAN.md` の Issue #357 項目（genesis ハッシュ変化を検知する
ChainResetWatcher を追加し、検知時にアダプタ内部キャッシュとワールドステートの
wallet/contract/block/transaction をパージする）の完了条件を、実機で満たすことを
確認した。`EthereumNodeLifecycle` の wallet-index 採番レジストリを意図的に
パージしない設計判断も、リセット後の新規 addWorkbench が正常動作することから
問題ないことを確認した。

#### 補足（本 Issue の範囲外・別 Issue 相当）

- collector が `addWorkbench`/`addNode` で作る managed コンテナは `down -v`
  （`--remove-orphans` 付きでも）で削除されず、`chainviz-ethereum_chain`
  ネットワークを「still in use」で残す現象を今回も実測（detective が指摘した
  「第2の問題」）。本 Issue（collector 側のチェーンリセット検知・パージ）の
  範囲外で、別 Issue 化が妥当。QA では検証を進めるため `com.chainviz.managed=true`
  ラベルのコンテナを手動削除してから `up` した。
