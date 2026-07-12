# Issue #301 subscribeBlocks が動的追加ノードに newHeads 購読を張らない

### 2026-07-13 Issue #301 設計メモ（実装着手前）
- 担当: designer（設計 想）
- ブランチ: issue-301-subscribe-blocks-dynamic-nodes
- 対象: `packages/collector/src/adapters/ethereum/`（collector のみ）

## 背景・問題

`EthereumAdapter.subscribeBlocks`（`index.ts`）は起動時に一度だけ
`this.poller.pollOnce()` → `executionTargets(observations)` で対象ノードを
列挙し、各ノードへ永続 WebSocket（`eth_subscribe(newHeads)`）を張っている。
このため addNode コマンドでキャンバスから動的に追加したノードには
newHeads 購読が張られない。影響:

- Issue #25（ブロック伝播パルス）: 動的追加ノードに受信時刻が乗らない。
- Issue #296（フォーク色分け）: 動的追加ノードの `headBlockHash` が空文字列
  （未観測）のままで色分け対象外になる。#296 は「未観測=縮退」で受容済み
  だが、根本のギャップは未解消だった。
- 併せて、現状は removeNode したノードの購読が `dispose()` まで close されず、
  死んだコンテナへ 2 秒間隔で無期限に再接続を試み続ける（`eth-ws-client.ts`
  の内部再接続。ログが出続ける潜在リーク）。本 Issue で同時に解消する。

## 既存パターンの調査結果

collector には「Docker 観測から対象を列挙して観測する」購読が 2 系統ある。

1. **周期ポーリング系**（`subscribePeers` / `subscribeNodeInternals`）:
   setTimeout ループで毎 tick `poller.pollOnce()` を呼び直し、その時点の
   対象集合に対して観測する。HTTP request/response なのでノードの増減に
   自然に追従する。`subscribeNodeInternals` は `trackedNodeInternalsIds`
   （前 tick の stableId 集合）と突き合わせ、消えたノードのキャッシュを
   `forgetNode()` で後始末している。
2. **永続 WebSocket 系**（`subscribeBlocks` / `subscribeTransactions`）:
   起動時に一度だけ列挙し、各ノードへ張った WS 購読を配列に貯める。WS は
   長寿命の接続なので毎 tick 張り直さない。切断時の再接続は `eth-ws-client.ts`
   の `subscribe()` 内部（Issue #135）が担う。**動的ノード追従の仕組みは無い**
   ＝これが本 Issue のギャップ。

`subscribeTransactions` も同じ「一度だけ列挙」構造で同じギャップを持つが、
影響は限定的（詳細は後述）。本 Issue のスコープは `subscribeBlocks`。

## 設計方針: 周期リコンサイル（開いたら維持、差分だけ開閉）

`subscribeBlocks` を「一度だけ列挙」から「周期リコンサイルループ」へ変更する。
`subscribePeers` / `subscribeNodeInternals` と同じ setTimeout ループにするが、
**毎 tick 張り直すのではなく、対象集合の差分だけを開閉する**点が異なる
（WS は長寿命接続で、毎 tick の張り直しは無駄なため）。

各 tick:
1. `poller.pollOnce()` → `executionTargets(observations)` で現在の対象を列挙。
2. 購読レジストリ（`stableId` → 購読）と突き合わせ、
   - レジストリに無い `stableId` → 新規に `subscribeNewHeads` を開いて登録。
   - レジストリにあるが今回の対象に無い `stableId` → `close()` して削除。
   - レジストリにあり `signature` が変わった `stableId` → close して開き直す
     （後述）。

### なぜ addNode/removeNode への割り込みではなく周期ループか

- addNode コマンド完了時点では、作成したコンテナがまだ Docker 観測に IP 付き
  で現れていない・reth の WS ポートが listen していないことがある。コマンド
  フローに購読開始を割り込ませると「まだ届かないノードへ購読を試みて失敗」
  というタイミング依存になる。周期ループなら次 tick 以降で自然に拾える。
- removeNode も同様に、コンテナ消滅が観測へ反映されたタイミングで購読を
  close できる。
- 既存の `subscribeNodeInternals` が同じ理由で周期ループを採っており
  （「毎 tick で Docker 観測を取り直すため addNode/removeNode で execution
  ノードが増減しても追従する」）、パターンを揃えられる。

### 二重購読の防止

購読レジストリを `stableId` キーの Map にし、既にキーがあれば新規購読を
開かない。これで同一ノードへの二重購読を構造的に防ぐ。

### signature による張り直し（receivedAtKeys の陳腐化対策）

`executionTargets` が返す `receivedAtKeys` は、対応する beacon の有無で
`[beacon, self]` / `[self]` と変わる。newHeads コールバックはこのキー群を
クロージャに捕捉するため、`stableId` だけをキーにすると捕捉した値が古いまま
になりうる。addNode は reth/beacon を同時作成するが、tick のタイミング次第で
「reth だけ先に観測 → `[self]` で購読 → 次 tick で beacon が観測される」が
起こる。これに追従するため、購読レジストリには購読と併せて `signature`
（`wsUrl` + `receivedAtKeys` を連結した文字列）を保持し、同じ `stableId`
でも signature が変われば close して張り直す。これは IP 変更（`wsUrl` 変化）
にも同時に対応する（固定 IP 帯運用では稀だが無償で頑健になる）。

### WebSocket の生存確認・エラーハンドリング（Issue #135 との整合）

- 個々の WS 購読の切断→再接続（コンテナ再作成など）は従来どおり
  `eth-ws-client.ts` の `subscribe()` 内部が無期限に担う。リコンサイルは
  「ノードが観測に居る限り購読を維持し、居なくなったら close する」だけを
  扱い、内部再接続には干渉しない。
- `close()` は `closedByCaller=true` を立てて内部再接続タイマーも止めるので、
  removeNode 時にリコンサイルが close すれば死んだコンテナへの再接続ループが
  確実に止まる（現状の潜在リークの解消）。
- newHeads の `onError` は従来どおりログのみ（購読 1 本の異常として握って
  継続）。onError が来ても購読レジストリからは外さない（内部再接続に任せる）。

## 実装の想定構成（collector 実装担当へ）

`packages/collector/src/adapters/ethereum/` 内で完結する。

1. **リコンサイラを 1 ファイル 1 責務で新設**（推奨）:
   `ws-subscription-reconciler.ts`（+ `ws-subscription-reconciler.test.ts`）。
   `stableId` キーで `{ signature, subscription }` を保持し、
   - `reconcile(targets, signatureOf, open)`: 新規 open / 消滅 close /
     signature 変化で close→open。
   - `closeAll()`: dispose 用に全 close。
   `Subscription`（`eth-ws-client.ts`）にのみ依存する汎用クラスにしておくと、
   後述の `subscribeTransactions` 移行や他アダプタでも再利用できる。テストは
   フェイクの `open`／フェイク `Subscription` で「新規・消滅・signature 変化・
   二重防止・closeAll」を検証できる（実 WS 不要）。
2. **`index.ts` の `subscribeBlocks` をループ化**:
   `subscribeNodeInternals` と同型に、`blockLoopRunning` / `blockTimer` を
   持ち、`blockTick` が毎 tick `executionTargets` を取り直してリコンサイラを
   回す。`open(target)` の中身は現状の newHeads コールバック
   （`blockTracker.record` + `headTipCache.recordHead` + `onBlock`）をそのまま
   使う。既存の `blockSubscriptions: NewHeadsSubscription[]` はリコンサイラに
   置き換える。
3. **リコンサイル間隔の定数**: `BLOCK_SUBSCRIPTION_RECONCILE_INTERVAL_MS`
   のような定数を新設し、`deps` で上書き可能にする（テスト用）。既定は
   `PEER_POLL_INTERVAL_MS` / `NODE_INTERNALS_POLL_INTERVAL_MS` と同じ 3000ms
   を推奨。根拠（CLAUDE.md「観測状態に依存した固定値を埋め込まない」への
   対応）: この値は「新規/削除ノードを何秒以内に購読へ反映するか」の応答性
   だけを決め、他ループと同じ責務・同じ応答性でよい。値が成立する前提は
   他の Docker 再ポーリングループと同一なので、コメントで既存定数と同根で
   ある旨を明記すれば足りる。
4. **`dispose()`**: `blockLoopRunning=false` + `clearTimeout(blockTimer)` +
   `reconciler.closeAll()` に置き換える。

## 決定事項

- **shared 型変更なし**。`ChainAdapter.subscribeBlocks` のシグネチャ
  （`(onBlock) => Promise<void>`）は不変。リコンサイルは `EthereumAdapter`
  内部の実装詳細。`subscribeNodeInternals` が既に「async だが実体は setTimeout
  ループを起動して即 resolve」なので、`subscribeBlocks` も同じ形にできる。
- **frontend 変更なし**。配信される差分（`store.applyBlock`）は同一。
  frontend は届いたブロック・tip をノードによらず扱うため影響しない。
- **collector 単独で完結**。node-env の変更も不要。
- 個々の WS の再接続は既存の Issue #135 実装に委ね、本 Issue では作らない。

## 未確定・統括に確認したい点

- **`subscribeTransactions` を本 Issue で一緒に直すか**（方向性の分岐）。
  推奨は「本 Issue は `subscribeBlocks` に絞り、`subscribeTransactions` は
  別 Issue（新設したリコンサイラを再利用）」。理由:
  - Issue #301 のスコープが `subscribeBlocks` であり、CLAUDE.md の「先回り
    実装をしない」に沿う。
  - `subscribeTransactions` のギャップは影響が小さい: ブロック取り込み検知は
    `processedBlocks` で全ノード横断に重複排除され、共有チェーン上の正準
    ブロックはどの既存ノードにも届くため、新規ノードが無くても検知できる。
    pending tx（mempool）も P2P でゴシップされ既存ノードの mempool に乗る。
  - リコンサイラを汎用に作っておけば移行は軽微。
  一緒に直す判断もありうる（機構が共通なため）。統括の判断を仰ぐ。

### 2026-07-13 実装着手前の方針確認メモ（実装担当）

- 担当: collector（収集 悟）
- 統括の判断: `subscribeTransactions` は今回のスコープに含めない
  （設計メモの推奨どおり）。本 Issue は `subscribeBlocks` のみ対応する。
- 設計メモ・`docs/ARCHITECTURE.md`（§4 `subscribeBlocks`、§9.5）を読んだ
  うえでの実装方針は設計メモの記述どおりで変更なし。要点を実装ファイル
  構成に落とすと以下のとおり:
  1. `packages/collector/src/adapters/ethereum/ws-subscription-reconciler.ts`
     を新設。`Subscription`（`eth-ws-client.ts`）にのみ依存する汎用クラス
     `WsSubscriptionReconciler<Target>` とする。コンストラクタに
     `signatureOf: (target: Target) => string` と
     `open: (target: Target) => Subscription` を受け取り、
     `reconcile(targets: Target[], keyOf: (target: Target) => string): void`
     で新規 open・消滅 close・signature 変化時の close→open を行う。
     `closeAll(): void` も持つ。`Target` はジェネリクスにして
     `ExecutionTarget` に依存させない（`subscribeTransactions` 移行時の
     再利用を見込む設計メモの方針どおり）。
  2. `index.ts` の `subscribeBlocks` を `subscribeNodeInternals` と同型の
     ループ（`blockLoopRunning` / `blockTimer` / `blockTick`）に変更し、
     `blockSubscriptions: NewHeadsSubscription[]` フィールドを
     `blockReconciler: WsSubscriptionReconciler<ExecutionTarget>` に置き換える。
     `open(target)` の中身（newHeads コールバック本体）は現状の実装を
     そのまま使う。
  3. `BLOCK_SUBSCRIPTION_RECONCILE_INTERVAL_MS`（既定 3000ms、
     `PEER_POLL_INTERVAL_MS` / `NODE_INTERNALS_POLL_INTERVAL_MS` と同根）を
     `EthereumAdapterDeps` 経由でテストから上書き可能にする。
  4. `dispose()` の `for (const sub of this.blockSubscriptions) sub.close()`
     を `this.blockReconciler.closeAll()` + ループ停止に置き換える。
  5. テストは `ws-subscription-reconciler.test.ts`
     （フェイク `open`／フェイク `Subscription` で新規・消滅・signature
     変化・二重防止・closeAll を検証。実 WS 不要）と、
     `index.test.ts` 側に「addNode 相当（対象追加）で購読が開く」
     「対象消滅で close される」ケースを追加する想定。

### 2026-07-13 実装結果

- 担当: collector（収集 悟）
- 実装は上記の方針どおり。差分:
  - `packages/collector/src/adapters/ethereum/ws-subscription-reconciler.ts`
    （新設）: `WsSubscriptionReconciler<Target>`。`keyOf` / `signatureOf` /
    `open` を受け取り、`reconcile(targets)` で新規 open・消滅 close・
    signature 変化時の close→open を行う。`closeAll()` は dispose 用。
    `Subscription`（`eth-ws-client.ts`）にのみ依存し、`ExecutionTarget` 等
    特定の型には依存しない汎用実装（`subscribeTransactions` 等での再利用を
    見込む）。
  - `packages/collector/src/adapters/ethereum/index.ts`:
    `subscribeBlocks` を `blockLoopRunning` / `blockTimer` / `blockTick` の
    周期ループへ変更。ループ本体は毎 tick `executionTargets(observations)`
    を取り直し `blockReconciler.reconcile(targets)` を呼ぶだけ。newHeads
    コールバック本体（`blockTracker.record` + `headTipCache.recordHead` +
    `onBlock` 呼び出し）は `blockReconciler` の `open` として1箇所にまとめ、
    `onBlock` は `subscribeTransactions` の `onTx` と同じ「フィールドに
    保持してクロージャから最新値を参照する」流儀にした。
    `BLOCK_SUBSCRIPTION_RECONCILE_INTERVAL_MS`（既定 3000ms）を新設し
    `EthereumAdapterDeps.blockSubscriptionReconcileIntervalMs` で上書き
    可能にした。`dispose()` は `blockReconciler.closeAll()` を呼ぶよう変更。
  - **設計からの変更点1点**: `subscribeNodeInternals` は初回 tick も
    fire-and-forget（呼び出し元は完了を待たない）だが、`subscribeBlocks`
    は初回 tick の完了だけ `await` する実装にした。既存の同期テスト
    （`head-block-hash.test.ts`・`peer-block-adapter.test.ts` の
    `subscribeBlocks` 系）が「`await adapter.subscribeBlocks(...)` の直後に
    `ws.emit(...)` すれば届く」という、購読が返り値解決時点で確立済みで
    あることを前提にしていたため、後方互換のためにこの挙動をそのまま
    維持した。2 回目以降のリコンサイルは `subscribeNodeInternals` と同じく
    setTimeout 経由で非同期に回る。理由と挙動の違いはコード内コメント・
    本ファイルの双方に明記した。
  - テスト:
    - `ws-subscription-reconciler.test.ts`（新設）: 新規・二重防止・
      追加ノードの並行 open・消滅時 close・signature 変化での
      close→reopen・closeAll・closeAll 後の reconcile が再オープンしない
      こと、を検証。
    - `peer-block-adapter.test.ts`: 既存の `subscribeBlocks` describe
      内のテストに `adapter.dispose()` を追加（周期ループ化により real
      timer が残ると次のテストへ影響しうるため）。新規
      describe「`subscribeBlocks` dynamic node tracking (Issue #301)」で
      `vi.useFakeTimers()` を使い、addNode 相当（対象追加で購読が開く）・
      removeNode 相当（対象消滅で close される。dispose 前に close される
      ことを直接確認＝潜在リーク解消の確認）・signature 不変時に
      張り直さないこと・beacon 出現による signature 変化での張り直し（機能
      的に receivedAt のキー変化も確認）・二重ループ防止（idempotent）、の
      5 ケースを追加。
    - `mutableClientFrom`（`peer-block-adapter.test.ts` に新設）と
      `controllableWsClient` の `close()` 修正（close 済みハンドラを
      `headHandlers` から実際に取り除く。実 WS の close 後は通知が届かない
      挙動へ寄せた。張り直しテストで新旧ハンドラが両方発火してしまう
      不具合を修正するために必要だった）。
  - `pnpm --filter @chainviz/collector build` / `test` とも成功
    （1392 tests）。
- **実機検証（docker compose up -d + 実際の addNode/removeNode コマンド）**:
  `profiles/ethereum` のスタックを起動し、collector を実プロセスとして
  起動、WebSocket 経由で `addNode`（chainProfile: "ethereum"）コマンドを
  送信。動的に追加された execution ノード（`chainviz-ethereum/reth3`）が
  スナップショット・diff に現れた約 1 秒後にはブロック伝播パルス
  （`entityAdded`/`entityUpdated` の block の `receivedAt` に当該ノードの
  id が乗る）が実際に届くことを確認した。続けて `removeNode` を送信し、
  対象ノードの newHeads 購読が「死んだコンテナへ再接続を試み続けて
  ログが出続ける」ことなく、1 回だけの close ログ（接続確立前に close
  したことによる ws ライブラリ由来の無害なログ）で収まり、以降 15 秒以上
  待っても再接続の試行ログが増えないことを確認した（修正前に存在した
  「removeNode 後に死んだコンテナへ無期限再接続を試み続ける」潜在リークの
  解消を実測で確認）。
- 統括への申し送り: `subscribeTransactions` の同型ギャップは今回のスコープ
  外（統括の判断どおり）。将来対応する場合は本 Issue で新設した
  `WsSubscriptionReconciler` をそのまま再利用できる見込み。

### 2026-07-13 テスト強化

- 担当: tester（試験 学）
- 実装担当の基本テスト（ハッピーパス中心）に対し、エッジケース・境界値・
  異常系のテストを追加した。実装は変更していない。
- `ws-subscription-reconciler.test.ts` に「WsSubscriptionReconciler edge
  cases (Issue #301)」describe を追加（9 ケース）:
  - 空の対象集合を空レジストリに対して reconcile しても何もしない（0 件境界）。
  - 複数対象が同一 tick で同時に出現したとき全件を open する。
  - 複数対象が同一 tick で同時に消滅したとき全件を close する。
  - 1 tick 内で「維持 + 消滅 + signature 変化 + 新規」が同時に起きたときの
    整合性（張り直し対象だけ close→open され、維持対象は触られない）。
  - 消滅後に同一キーが再出現したら新規購読として開き直す。
  - `closeAll` 後に同一対象が再度 reconcile されれば新規として開かれる
    （`closeAll` はレジストリを空にするだけで以後の reconcile を止めない）。
  - signature 変化は 1 回だけ張り直し、その後は安定していれば張り直さない。
  - 集合として同じでも順序違いの key 配列は別 signature として扱われる
    （`signatureOf` が安定した文字列を返すべきという呼び出し側の契約を固定。
    `executionTargets` の `receivedAtKeys` が常に `[beacon, self]` /
    `[self]` の決定的順序であることが signature 安定性の前提であり、この
    順序が非決定になると毎 tick 張り直す回帰を検出できる）。
  - `open` が例外を投げた場合の現在の挙動を固定（reconcile はそのまま
    例外を伝播させ、それより前に open 済みの購読はレジストリに残る。
    `index.ts` の `blockTick` が try/catch で受けて次 tick で再試行するため
    自己修復する）。
- `peer-block-adapter.test.ts` の「subscribeBlocks dynamic node tracking
  (Issue #301)」describe に統合レベルの境界ケースを追加（6 ケース）:
  - 初回 tick のみ await する後方互換仕様の境界: 関数解決後に現れたノードは
    マイクロタスクを流すだけ（`advanceTimersByTimeAsync(0)`）では拾われず、
    リコンサイル間隔経過後にのみ購読される（fire-and-forget の確認）。
  - 同一 tick で複数ノードが同時に出現したとき全件購読する。
  - 同一 tick でノード入れ替え（一方が消え他方が現れる）が起きたときの
    close/open。
  - removeNode 後、以降の tick で対象に現れない限り二度と subscribe されない
    （潜在リーク解消の回帰テスト。close は 1 回きり）。
  - removeNode 後に同一 stableId が再出現したら新しい購読を開く。
  - ノードを順に増設しても既存ノードの購読は張り直さず新規だけ開く
    （既存購読への非干渉）。
- 追加したテストが実際に元の実装の不具合を検出できることを、意図的な
  ミューテーションで確認した:
  - リコンサイラの signature 変化ブランチを無効化 → signature 関連 4 ケース
    が失敗。
  - リコンサイラの消滅時 close ループを削除 → remove / reappear 系 8 ケース
    が失敗。
  いずれも元に戻してから全テスト green を確認した。
- `pnpm --filter @chainviz/collector build` / `test`（1407 tests）・
  `pnpm lint` とも成功。
- 申し送り: `peer-block-adapter.test.ts` は 3300 行超と肥大化している
  （Issue #301 以前からの共有テスト基盤で、pollPeers / subscribeBlocks /
  subscribeTransactions などが同居）。1 ファイル 1 責務の観点では
  fixture ヘルパー（`controllableWsClient` / `mutableClientFrom` /
  各 `*Fixture`）を共有モジュールへ切り出したうえで describe 単位に
  分割するのが望ましいが、pollPeers/subscribeTransactions を含む広範囲の
  移動を伴い破壊リスクが高いため、本 Issue のスコープ外の follow-up
  として別途対応するのが妥当。今回は既存の Issue #301 describe に追記する
  形に留めた。
