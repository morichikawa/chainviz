### 2026-07-11 Issue #287 fetchConsensusPeerNodesが失敗ノードをログ無しで無言除外している

#### 設計メモ（着手前）

- 担当: collector
- ブランチ: issue-287-peer-poll-error-log

**現状の問題点**

`packages/collector/src/adapters/ethereum/index.ts` の
`fetchConsensusPeerNodes`（CL/Beacon API 側のピア問い合わせ）は、個々の
ノードへの問い合わせ失敗（タイムアウト等）を `catch { return null; }` で
何もログせずに握りつぶしている。

一方、対称の位置にある `fetchExecutionPeerNodes`（EL/reth 側）は同じ形の
`catch` 節で `console.error` により `stableId` と実際のエラーを記録して
いる（Issue #274 の調査(chainviz-detective)が指摘した非対称。CLAUDE.md
「エラーを握りつぶすコードを見逃さない」に抵触する）。

**修正方針**

1. `fetchConsensusPeerNodes` の `catch` 節に、EL 側と対称な
   `console.error("[ethereum] consensus peer poll failed for <stableId>:", err)`
   を追加する。
2. ログ頻度への配慮: `subscribePeers` は既定 3000ms 間隔で
   `pollPeersOnce`（内部で `fetchConsensusPeerNodes` を含む）を呼び直す
   ループになっており、Beacon API がハングし続けるような状況では
   同一ノードに対して毎 tick 同内容の失敗ログが延々と出続けうる（今回の
   Issue の発端となった調査対象の状況そのもの）。これを避けるため、
   ノード（stableId）ごとに**連続失敗回数**を保持し、
   - 1 回目の失敗（直前は成功していた、または初回）は必ずログする
   - それ以降は N 回に 1 回だけ間引いてログする（「まだ失敗し続けている」
     ことが分かる程度の頻度は残す）
   - 成功したらカウントをリセットする
   という単純な間引きを行う。
   - 間引きの周期は「経過時間」ではなく「連続失敗回数」で数える。
     `peerPollIntervalMs` はコンストラクタ引数で変更可能なため、時間
     ベースの固定値（例: ○○秒に1回）にすると間隔設定を変えた瞬間に
     成立しなくなる（CLAUDE.md
     「今この瞬間に観測できる状態に依存した固定値をロジックに埋め込まない」
     に抵触する）。回数ベースにすればポーリング間隔が変わっても
     相対的な頻度（何 tick に 1 回か）は保たれる。
   - 対象ノード集合（`targets`）に含まれなくなった stableId
     （removeNode 等でノードが消えた場合）はカウントを破棄し、
     Map が無制限に肥大化しないようにする。既存の `trackedNodeInternalsIds`
     （同ファイル内、D層ループ）と同じ「毎 tick 現在の対象集合と突き合わせて
     不要になったキーを捨てる」方式を踏襲する。
3. EL 側（`fetchExecutionPeerNodes`）は今回のスコープ外（対称にする対象は
   ログの有無のみで、EL 側に同じ間引きを遡って入れることは本Issueでは
   行わない。必要であれば別Issueとして切り出す）。
4. Issue #288（P2Pエッジ表示のちらつき対策）は本Issueの後続であり、
   エッジ表示側の挙動変更（ヒステリシス等）は今回含めない。

**テスト方針**

- `peer-block-adapter.test.ts` の既存テスト
  `"keeps other beacon nodes when one fails to respond"` は現状
  `console.error` をモックしていない（呼ばれない前提）。ログを追加すると
  このテストの実行中に実際に `console.error` が呼ばれるようになるため、
  EL 側の対応するテスト
  （`"keeps other execution nodes when one fails to respond"`）と同様に
  `vi.spyOn(console, "error")` でモックし、ログ内容（`stableId` を含む
  文言・`Error` オブジェクト）を検証するアサーションを追加する。
- 新規に以下を確認するテストを追加する。
  - 連続失敗時に 1 回目はログするが、間引き対象の回（例: 2〜N-1 回目）は
    ログしないこと。
  - 間引き周期の N 回目には再びログすること。
  - 失敗後に成功すると、次に失敗したときにまた 1 回目としてログされる
    （カウントがリセットされる）こと。
  - 対象ノード集合から外れた（次回ポーリングで targets に含まれない）
    stableId のカウントが破棄されること（Map肥大化防止の確認。直接
    Map を覗けないため、一度別の stableId として現れ直しても「1 回目」
    としてログされることで間接的に確認する）。

#### 実施内容（完了報告）

- 担当: collector
- ブランチ: issue-287-peer-poll-error-log

**変更内容**

- `packages/collector/src/adapters/ethereum/index.ts`
  - `fetchConsensusPeerNodes` の `catch` 節に、EL 側の
    `fetchExecutionPeerNodes` と対称な `console.error` を追加した。
    出力内容は `[ethereum] consensus peer poll failed for <stableId>` +
    連続失敗回数（2回目以降のみ付記）+ 実際のエラーオブジェクト。
  - 連続失敗時のログ間引きとして、`stableId` ごとの連続失敗回数を
    `consensusPeerFailureCounts`（Map）に保持し、1 回目は必ずログ、以降は
    `CONSENSUS_PEER_POLL_FAILURE_LOG_INTERVAL`（20）回に 1 回だけログする
    ようにした。成功したエントリは削除し、次に失敗したときは再び
    「1 回目」として扱う。
  - `fetchConsensusPeerNodes` の呼び出し冒頭で、今回の `targets` に
    含まれなくなった stableId のカウントを Map から取り除く
    （`pruneConsensusPeerFailureCounts`）。既存の
    `trackedNodeInternalsIds`（D層ループ）と同じ「毎 tick 現在の対象集合と
    突き合わせる」方式で、ノード削除時に Map が無制限に肥大化しないように
    した。
  - `CONSENSUS_PEER_POLL_FAILURE_LOG_INTERVAL` はテストから参照できるよう
    `export` している。

**修正前後の実機確認**

- 修正前のコードを一時的に `git stash` で退避し、Beacon API への問い合わせが
  常に失敗するモック `HttpClient` を使って `pollPeersOnce()` を呼んだところ
  `console.error` は 1 度も呼ばれないことを確認した（不具合の再現）。
- `git stash pop` で修正後のコードに戻し、同じ条件で `pollPeersOnce()` を
  呼んだところ、`[ethereum] consensus peer poll failed for
  chainviz-ethereum/beacon1:` というログが 1 回出力されることを確認した
  （修正の効果を確認）。

**テスト**

- `packages/collector/src/adapters/ethereum/peer-block-adapter.test.ts`
  - `"keeps other beacon nodes when one fails to respond"` を
    `console.error` のモック・アサーション付きに更新し、EL 側の対応する
    既存テストと対称な検証にした（テスト名も Issue 番号を明記する形に変更）。
  - `"still delivers EL edges when every CL Beacon API call fails (layer
    isolation)"` は CL 側の全ノードが失敗するため、新しいログ出力で
    テスト実行中に未モックの `console.error` が呼ばれるようになった。
    既存の他のテストと同様に `vi.spyOn(console, "error")` でモックする形に
    更新した（アサーション内容自体は変更なし）。
- `packages/collector/src/adapters/ethereum/consensus-peer-poll-failure-log.test.ts`
  （新規）
  - 連続失敗時のログ間引き（Issue #287 の主眼）に関心を絞った専用ファイルと
    して新設した。`peer-block-adapter.test.ts` が既に約3000行と大きいため、
    これ以上の肥大化を避ける目的で分割した（CLAUDE.md「テストは関心事ごとの
    分割を都度検討する」）。
  - 1 回目の失敗はログ・2回目以降N-1回目まで抑制・N回目に再度ログ、の
    3ケースを1テストで検証。
  - 失敗→成功→失敗でカウントがリセットされ、再び「1回目」としてログされる
    ことを検証。
  - ノードが観測対象から消えた（removeNode相当）場合にカウントが破棄され、
    再度観測に現れたときに「1回目」としてログされる（Map肥大化防止の間接
    確認）ことを検証。
- `pnpm --filter @chainviz/collector build` / `pnpm --filter @chainviz/collector
  test`（1257件全件成功）/ `pnpm lint` をすべて実行し、通過を確認した。

**決定事項・注意点**

- EL 側（`fetchExecutionPeerNodes`）には今回のログ間引きを遡って追加して
  いない。EL 側は既存の無条件ログのままで、これは設計メモどおり本Issueの
  スコープ外という判断（対称にする対象はログの有無のみ）。EL 側でも同様の
  連続失敗ログ量が問題になる場合は別Issueとして切り出すこと。
- 間引きの周期（20回に1回）は `peerPollIntervalMs`（既定3000ms、
  コンストラクタ引数で変更可能）に依存しない回数ベースの固定値。
  タイムアウト（`createFetchHttpClient` の既定3000ms）と合わせて1周期が
  数秒〜十数秒程度になる想定のもとでは、20回で数分に1回程度のリマインド
  ログになる（前提が崩れる=ポーリング間隔やタイムアウトを大きく変える
  場合でも、回数ベースなので相対頻度自体は保たれる）。
- Issue #288（P2Pエッジ表示のちらつき対策）は本Issueと同じ
  `fetchConsensusPeerNodes` に関わるため、本Issueのマージ後に着手すること
  （エッジ表示側の挙動変更は今回含めていない）。
