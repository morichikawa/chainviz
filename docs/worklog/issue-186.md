# Issue #186 作業記録

### 2026-07-08 Issue #186 ノード内部状態のworld-state反映(collector)

- 担当: collector
- ブランチ: issue-186-node-internals-worldstate

#### 設計メモ(実装前)

`docs/ARCHITECTURE.md` §7.3 の決定事項、および Issue #185
(`docs/worklog/issue-185.md`)の申し送りに従う。本Issueのスコープは
「Issue #185 が作った `pollRethNodeInternals` を実際に周期呼び出しし、
結果を world-state へ反映すること」。`NodeEntity.syncStatus`/`blockHeight`
の更新(Issue #187 の範囲)には手を入れない。

##### 1. `drivesNodeId` の解決方針

ARCHITECTURE §7.3 が指示するとおり、`drivesNodeId` は**独立した購読では
なく pollInfra(A層)の中で毎回解決する**(`WorkbenchEntity.rpcTargetNodeId`
と同じ「エンティティ生成後に観測全体から後付けで解決し、entities配列を
その場でパッチする」流儀)。

- 既存の `beaconStableIdForExecution(execution, observations)`
  (`targets.ts`。Issue #28/#153)は「execution コンテナ → 対になる beacon
  コンテナの stableId」という向きの解決。今回必要なのはその逆向き
  (「beacon コンテナ → 対になる execution コンテナの stableId」)。
- 両者はコアロジック(compose サービス名から役割プレフィックスを剥がした
  残りのキーが一致し、かつ同じ compose プロジェクトに属するコンテナを探す)
  が完全に同一で、探す相手側の役割(beacon 側 or execution 側)だけが違う。
  レビュー指摘(#185 の申し送り「構造重複」)と同種の重複を新たに作らない
  よう、`findPairedStableId(source, observations, isCandidateRole)` という
  private ヘルパーへ共通化し、`beaconStableIdForExecution` と新設の
  `executionStableIdForBeacon` はどちらもこのヘルパーを呼ぶだけにする。
- `executionStableIdForBeacon` は**呼び出し元がどんな種類のコンテナを
  渡しても安全**なように、関数内部で「source が本当に beacon 役か
  (`isBeaconService` かつ `CONSENSUS_CLIENTS` に属する node 種別)」を
  まず確認し、そうでなければ即 `undefined` を返す設計にする(呼び出し側
  = `pollInfra` は全 NodeEntity に対して機械的にこの関数を呼べばよく、
  「beacon かどうかの判定」を呼び出し側と関数側の二重管理にしない)。
  これにより、reth 自身や validator コンテナ(compose サービス名に
  "beacon" を含まないため `isBeaconService` が false)に対して呼んでも
  誤って自己参照や無関係な対応付けを返さない。
- `pollInfra` は `toEntity()` で entities を作った後、`observations` を
  stableId 引きの Map にし、各 `NodeEntity` について対応する
  `ContainerObservation` を引いて `executionStableIdForBeacon()` に渡す。
  解決できれば `entity.drivesNodeId` を設定、できなければ何もしない
  (省略 = 無し/不明。`rpcTargetNodeId` と同じ流儀)。

##### 2. `NodeInternals` の反映方法

- `store.ts` に `applyNodeInternals(nodeId: string, internals:
  NodeInternals): DiffEvent[]` を追加する。対象ノードが store に存在しない
  (削除済み・A層のポーリングをまだ経ていない等)場合は、既存の
  `applyKeyed` 系メソッドと違い「新規追加」という概念が無い
  (`NodeInternals` は既存 NodeEntity へのパッチ専用)ため、観測を捨てて
  `console.error` にログを残す(ARCHITECTURE §7.3
  「対象ノードが store に無い観測は捨ててログに残す」に対応。CLAUDE.md
  「エラーを握りつぶすコードを見逃さない」への配慮でもある)。
- 反映は `computeDiff([existing], [{ ...existing, internals }])` を使って
  既存の `entityUpdated` 差分計算をそのまま再利用する(`internals` 以外の
  フィールドは変化しないため、`fieldPatch` は `internals` のキーだけを
  拾う。同一内容の再送では diff が空になり entityUpdated は出ない)。

##### 3. `subscribeNodeInternals` の配線方針

`EthereumAdapter` に既存の `subscribePeers` と同型の「独立した
setTimeout ループ」を追加する(`nodeInternalsLoopRunning` /
`nodeInternalsTimer` というピア購読と対になるフィールド名にする)。

- 毎 tick で `this.poller.pollOnce()` を呼び直し、そのたびに
  `executionMetricsTargets(observations)` で対象 execution ノードを
  列挙し直す(addNode/removeNode で execution ノードが増減しても追従する。
  `subscribePeers` と同じ考え方)。
- Prometheus 取得・パース・差分計算は Issue #185 の
  `pollRethNodeInternals(client, target, tracker)` にそのまま委譲する。
  `RethMetricsClient` と `RethMetricsTracker` は worklog #185 の申し送り
  どおりノード横断で 1 つずつ使い回す(アダプタのインスタンスフィールドに
  保持し、tick ごとに作り直さない)。
- 各 execution ノードの結果について:
  - `result.internals` があれば `handlers.onInternals(target.stableId,
    internals)` を呼ぶ(このノードが drivesNodeId を持つ側=CLではなく
    観測対象そのもの=EL 側なので、そのまま `target.stableId` を使う)。
  - `result.calls` が空でなければ、対応する execution の
    `ContainerObservation` から `beaconStableIdForExecution()` で対になる
    beacon の stableId を解決し、`fromNodeId`(駆動する側=beacon) /
    `toNodeId`(駆動される側=execution 自身)として
    `handlers.onLinkActivity(...)` を呼ぶ。ARCHITECTURE §7.3
    「beacon↔EL の対応が解決できない間は配信せず、その旨をログに残す」
    どおり、解決できなければ `console.error` に残して配信をスキップする
    (黙って捨てない)。
- ノードが観測から消えた(execution ノードが削除された)場合は
  `RethMetricsTracker.forgetNode(stableId)` を呼ぶ(#185 の申し送り)。
  前回 tick で列挙した stableId 集合を保持しておき、今回列挙できなかった
  ものについて呼ぶ。
- `dispose()` にこのループの停止(`nodeInternalsLoopRunning = false` +
  タイマ解除)を追加する。

##### 4. 依存の注入

`EthereumAdapterDeps` に以下を追加する(テストでモックへ差し替えるため。
既存の `peerPollIntervalMs` と同じ流儀):

- `rethMetricsClient?: RethMetricsClient`(既定は
  `createFetchRethMetricsClient()`)
- `nodeInternalsPollIntervalMs?: number`(既定は Issue #185 が定義した
  `NODE_INTERNALS_POLL_INTERVAL_MS`)

`RethMetricsTracker` はテストでの差し替え対象にしない(状態を持つ差分
計算そのものが本Issueの検証対象であり、Issue #185 側で既にテスト済みの
実装をそのまま使う。差し替えの必要が生じた場合は追って検討する)。

##### 5. ファイル分割について

`EthereumAdapter` (index.ts) は既に600行超だが、`subscribeNodeInternals`
の追加分は `subscribePeers` と同程度の量(30〜40行)に収まる見込みで、
既存の B層ピア購読ロジックも同じファイルに同居している前例に合わせ、
新規ファイルへの切り出しはしない(既存の構成方針を踏襲)。
`targets.ts` への `executionStableIdForBeacon` 追加は既存関数と同じ
ファイル内に留める(既存の `beaconStableIdForExecution` と対になる公開
関数であり、分離すると `findPairedStableId` ヘルパーの共有が別ファイル
importになり見通しが悪くなるため)。

#### 実装

設計メモどおりに実装した。

- `targets.ts`: `findPairedStableId()` という private ヘルパーへ
  `beaconStableIdForExecution` の内部ロジックを切り出し、新設の
  `executionStableIdForBeacon(beacon, observations)` と共有した(関数ロジック
  の重複を新たに作らないための対応。なお `RethNodeInternalsTarget` と
  `ExecutionMetricsTarget` の Target 型の重複は、この対応では解消できて
  おらず、差し戻し対応で別途行った。後述参照)。
  `executionStableIdForBeacon` は source が beacon 役でなければ
  (`isBeaconService` かつ `CONSENSUS_CLIENTS` の node)即 `undefined` を
  返す自己防衛を入れている。
- `index.ts`(EthereumAdapter): `resolveDrivesNodeId()` を pollInfra に
  追加し、各 NodeEntity について対応する observation から
  `executionStableIdForBeacon()` を呼んで `drivesNodeId` をその場でパッチ
  する。`subscribeNodeInternals(handlers)` を追加し、`subscribePeers` と
  同型の独立した setTimeout ループとして実装した。`RethMetricsClient` /
  `RethMetricsTracker` はアダプタのインスタンスフィールドとして1つずつ
  保持し、tick ごとの `executionMetricsTargets()` の結果と前回列挙した
  stableId 集合を比較して消えたノードを `forgetNode()` する。
  `dispose()` にもこのループの停止処理を追加した。
  `createFetchRethMetricsClient` の既定タイムアウト(3000ms)に前提条件の
  コメントを追加した(Issue #185 レビューの軽微な申し送り3点目に対応。
  同一 Docker ネットワーク内へのスクレイプで、ポーリング間隔と同値という
  チェーンの進行状態に依存しない値であることを明記)。
- `store.ts`: `applyNodeInternals(nodeId, internals)` を追加。対象ノードが
  存在しない場合は `console.error` に残して `[]` を返す(観測を捨てる)。
- `main()`(collector本体の配線): `adapter.subscribeNodeInternals({
  onInternals, onLinkActivity })` を配線した。`onInternals` は
  `store.applyNodeInternals()` の結果を `broadcastDiff` する。
  `onLinkActivity` は `operationObserved` と同じく store に畳み込まず、
  `{ type: "nodeLinkActivity", activity }` をそのまま `broadcastDiff` する
  (ARCHITECTURE §7.3「store 反映なし・passthrough 配信」)。

追加したユニットテスト:

- `targets.test.ts`: `executionStableIdForBeacon` の基本ケース(対応する
  execution が見つかる/見つからない/validator には反応しない/execution
  自身に対しては undefined)。
- `index.test.ts` / `peer-block-adapter.test.ts`
  (`subscribeNodeInternals` は購読・購読解除の性質が強いので
  `peer-block-adapter.test.ts` 側に追加): `pollInfra` の drivesNodeId 解決
  (基本ケース)、`subscribeNodeInternals` の周期呼び出し・
  `onInternals`/`onLinkActivity` の呼び分け・beacon 未解決時のログ・
  dispose での停止・二重購読の冪等性。
- `store.test.ts`: `applyNodeInternals` の基本ケース(既存ノードへの反映、
  無変更時は diff 無し、未知ノードへの反映は捨ててログ)。

`pnpm --filter @chainviz/collector build` / `pnpm --filter @chainviz/collector
test`（1048テスト全通過）、および `pnpm -r build` / `pnpm -r test`
（shared/collector/frontend/e2e）・`pnpm lint` がいずれも成功することを
確認した。

#### 補足: pollInfraが未反映のままリロードした際の一時的な状態について

`drivesNodeId` は A 層（pollInfra）のポーリング周期でしか解決されないため、
`subscribeNodeInternals` のポーリング（`NODE_INTERNALS_POLL_INTERVAL_MS`、
同じく3秒間隔だが独立したタイマー）が先に internals を反映した直後、
まだ pollInfra 側が 1 巡していない極短い時間帯は「internals はあるが
drivesNodeId が無い」状態になりうる。両ループは非同期かつ独立しているため
これは意図した挙動で、フロント側は `drivesNodeId` 省略時に内部リンクの
表示を出さない側に倒す設計（ARCHITECTURE §7.4）で吸収される想定。次周期の
pollInfra で追いつくため、恒久的な不整合にはならない。

#### 次の担当（Issue #187/#188）への注意点

- `NodeEntity.syncStatus`/`blockHeight` の更新（本Issueのスコープ外）は
  Issue #187 で行う。本Issueで反映した `NodeEntity.internals.syncStages`
  （`reth_sync_checkpoint` 由来）がそのまま情報源候補になる
  （`docs/worklog/issue-185.md` の実測結果を参照）。
- `nodeLinkActivity` はフロントに未接続（配信のみ）。フロント側の購読・
  描画は Issue #188 の範囲。
- `EthereumAdapter` の `subscribeNodeInternals` は `subscribePeers` と同じく
  Docker 観測を毎 tick 取り直す設計にしたため、addNode/removeNode で
  execution ノードが増減しても追従する（動的追加ノードの D層観測もこの
  Issueで対応済み）。

### 2026-07-08 テスト強化（tester）

実装担当の基本テスト（ハッピーパス中心）に対し、異常系・境界値・複数ノード
環境の観点でユニットテストを追加した。実装コードには手を入れていない。

追加したテストと観点:

- `targets.test.ts`（`executionStableIdForBeacon`）:
  - 同一プロジェクト内に execution 候補が複数（reth1/reth2）あっても、beacon の
    ノード群キーに対応する 1 つだけを選び、相手を取り違えない。
  - 別 compose プロジェクトに同じノード群キーの execution があっても
    対応付けない（`findPairedStableId` のプロジェクトスコープの逆向き確認）。
  - observations が空配列のとき undefined を返す。
- `index.test.ts`（`pollInfra` の `drivesNodeId` 解決）:
  - 複数ノード環境（reth1+beacon1 / reth2+beacon2）で各 beacon が自分の
    execution に対応付き、ペアを取り違えず、execution 側は drivesNodeId を
    持たない。
  - 駆動元の beacon が削除された後、EL 側に古い drivesNodeId が残らない
    （pollInfra が毎回 observations から作り直すため）。
- `store.test.ts`（`applyNodeInternals`）:
  - internals フィールドは置き換え（マージではない）。以前の観測に
    syncStages があっても、mempool だけの後続観測で syncStages は残らない。
    これは ARCHITECTURE §7.3 の「internals フィールドのパッチ」の意図した
    挙動（`pollRethNodeInternals` が毎スクレイプで完結した NodeInternals を
    返す前提）で、バグではないため回帰テストとして固定した。
  - 空の NodeInternals（syncStages も mempool も観測できない縮退）で既存値が
    クリアされる（幽霊のように残らない）。
- `peer-block-adapter.test.ts`（`subscribeNodeInternals`）:
  - 同一 tick 内で 1 ノードの取得が失敗しても、並行処理される他ノードの
    観測はそのまま反映される（部分的な失敗が他ノードを巻き込まない）。
  - 複数の EL/CL ペアが同居する環境で、各 execution の呼び出し活動が
    それぞれ自分の beacon を fromNodeId として配信され、ペアを取り違えない。
  - ノードが観測から消えると `RethMetricsTracker.forgetNode()` で前回値が
    破棄され、再登場時はベースラインからやり直す（再起動でカウンタが
    巻き戻ったノードの再登場初回で誤った増分を配信しない）。

`pnpm --filter @chainviz/collector test`（1058 テスト全通過。既存 1048 +
新規 10）、`pnpm --filter @chainviz/collector build`、`pnpm -r build`
（shared/collector/frontend/e2e）がいずれも成功することを確認した。

#### レビュー(reviewer)

判定は**差し戻し(軽微・1点)**。以下の1点を除き、設計原則・ARCHITECTURE
§7.3 との整合・テストの質はいずれも問題なしと確認した。

差し戻し理由:

- **Issue #185 の軽微な申し送り「2点目」が未解消のまま、worklog 上は
  「対応した」と記録されている**。worklog issue-185.md の申し送り2点目は
  「`RethNodeInternalsTarget`(reth-node-internals.ts)と
  `ExecutionMetricsTarget`(targets.ts)が構造的に同一。どちらかに寄せる
  (targets.ts 側を import する)ことを検討してよい」という**Target 型の
  重複**の指摘だが、本 worklog の実装セクションは `findPairedStableId` への
  共通化(こちらは関数ロジックの重複を「新たに作らない」ための予防で、
  それ自体は適切)を「申し送り2点目に対応」と記述している。実際には
  `reth-node-internals.ts` は今も独自に `RethNodeInternalsTarget` を定義し、
  index.ts は構造的部分型の一致に依存して `ExecutionMetricsTarget` を
  渡している。型が2定義のまま乖離すると静かに壊れる(片側だけフィールドが
  増えても検出されない方向がある)ため、今回の配線を機に統合すること。
  修正指示:
  1. `reth-node-internals.ts` の `RethNodeInternalsTarget` を削除し、
     `targets.ts` の `ExecutionMetricsTarget` を import して使う
     (`RethNodeInternalsTarget` の参照は同ファイル内のみで、テストからの
     参照は無いことを確認済み。dist は再ビルドで追従する)。
  2. 本ファイル実装セクションの「構造重複の解消。Issue #185 レビューの
     軽微な申し送り2点目に対応」の記述を実態に合わせて修正する。

問題なしと確認した内容:

- **Issue #185 申し送り3点目(timeoutMs コメント)**: 解消済み。
  `createFetchRethMetricsClient` の既定 3000ms に前提条件(同一 Docker
  ネットワーク内へのスクレイプ・チェーン進行状態非依存・ポーリング間隔と
  同値で1間隔内に完了しなければ次で再試行)のコメントが追加されている。
- **drivesNodeId 解決ロジック**: `findPairedStableId` への共通化は妥当。
  `executionStableIdForBeacon` の自己防衛(`isConsensusBeaconNode` でない
  source は即 undefined)により pollInfra から全 NodeEntity へ機械的に
  呼べる。複数 EL/CL ペア・別 compose プロジェクト・validator 混在の
  取り違えは targets.test.ts / index.test.ts で網羅的に固定されている。
- **ChainAdapter 境界**: Prometheus・reth 固有の語彙は adapters/ethereum
  配下に閉じている。store・collector 本体(index.ts の main)・shared には
  チェーン固有語彙の漏れなし(`InternalCallStats.method` に生のメソッド名を
  載せるのは shared 側で文書化済みの契約どおり)。
- **applyNodeInternals の置き換え意味論**: tester の判断は正しい。
  ARCHITECTURE §7.3 の「internals フィールドのパッチ」はトップレベル
  フィールド単位の置き換えを意味し(fieldPatch は after に存在するキー
  だけを比較・置換する)、`pollRethNodeInternals` が毎スクレイプで完結した
  NodeInternals を返す前提と整合する。マージにすると観測できなくなった
  フィールドが幽霊のように残るため、置き換えが正しい。なお取得失敗時は
  `onInternals` 自体が呼ばれず既存値が保持される(最後の観測を維持)ことも
  §7.3 と矛盾しない。
- **エラーハンドリング**: 取得・パース失敗は pollRethNodeInternals が
  stableId と実エラーをログして undefined(ノード単位のスキップ)。同一
  tick 内の他ノードは巻き込まれない(テストで固定済み)。beacon 未解決時の
  nodeLinkActivity は §7.3 どおり「配信せずログに残す」。store に無い
  ノードへの internals は具体的な id をログして捨てる。ループ本体は
  catch してログし継続、main() の購読失敗も catch してログ。握りつぶしなし。
- **固定値**: ポーリング間隔 3000ms(tracker 側)・タイムアウト 3000ms
  (client 側)ともに前提条件がコードコメントに明記されており、チェーンの
  進行状態(稼働時間・ブロック高)に依存しない増分ベースの設計。
- **テストの質**: forgetNode 配線テストは「tracker が巻き戻り時に増分=
  今回値を配信する」仕様を踏まえると、配線が無い場合は 105→3 の巻き戻りで
  誤配信が起きてテストが失敗する構造になっており、意味のある検証。
  applyNodeInternals の未知ノード・非 node エンティティ・空 internals の
  境界も固定されている。
- **ビルド・テスト**: リポジトリ全体で `pnpm lint` / `pnpm build` /
  `pnpm test`(shared 58 / collector 1058 / frontend 1205 / e2e 34)すべて
  通過。packages/shared は本ブランチで無変更。
- **docs**: PLAN.md のチェック・WORKLOG.md 索引の1行追加とも適切。
  ARCHITECTURE.md は設計フェーズで §7.3 に本実装の記述が済んでおり齟齬なし。

補足(差し戻し対象外の観測メモ):

- store の fieldPatch は「after に存在するキーのみ比較」のため、beacon の
  ペア EL だけが削除された場合、beacon エンティティの古い `drivesNodeId` が
  store 内に残留しうる(pollInfra の新エンティティにキーが無くても削除
  パッチは出ない)。これは `rpcTargetNodeId` と同一の既存意味論であり、
  指す先の EL エンティティ自体は entityRemoved されるため、フロントの
  ダングリングガード(§7.4、#188 で実装)で吸収される。#188 実装時に
  ガードを省略しないこと。
- ブランチは未コミットのためコミット粒度は未確認。コミット時は1変更
  1コミット(targets の共通化+executionStableIdForBeacon / pollInfra の
  drivesNodeId / subscribeNodeInternals ループ / store の
  applyNodeInternals / main 配線 / docs、をそれぞれ対応するテストと共に)
  へ分けること。

### 2026-07-08 差し戻し対応

レビューで指摘された「`RethNodeInternalsTarget`(reth-node-internals.ts)と
`ExecutionMetricsTarget`(targets.ts)の Target 型の重複が未解消」に対応した。

- `reth-node-internals.ts` の `RethNodeInternalsTarget` 型定義を削除し、
  `targets.ts` から `ExecutionMetricsTarget` を import して
  `pollRethNodeInternals` の引数型として使うよう変更した。参照箇所は
  同ファイル内のみで、テストからの直接参照は無いことを確認済み
  (`reth-node-internals.test.ts` はこの型名を参照していない)。
- 上の「実装」セクションの記述のうち、`findPairedStableId` への共通化を
  「Issue #185 レビューの軽微な申し送り2点目に対応」としていた箇所を、
  実態(関数ロジックの重複防止であり、申し送りが指摘した Target 型の
  重複そのものへの対応ではなかった)に合わせて修正した。

`pnpm lint`、`pnpm --filter @chainviz/collector build`、
`pnpm --filter @chainviz/collector test`(39ファイル・1058テスト全通過)
がいずれも成功することを確認した。

#### 再レビュー(reviewer)

判定は**合格**。前回差し戻した1点の対応を確認した。

- **Target 型の重複解消**: `reth-node-internals.ts` の独自型
  `RethNodeInternalsTarget` が削除され、`targets.ts` の
  `ExecutionMetricsTarget` を `import type` で参照するよう変更されている。
  `RethNodeInternalsTarget` の残存参照は src 配下に無し(dist の残存は
  生成物で、再ビルドで追従することを確認済み)。`targets.ts` は
  `reth-node-internals.ts` を import していないため循環依存も無い。
- **worklog の記述修正**: 「実装」セクションの `findPairedStableId` への
  共通化に関する記述が、実態(関数ロジックの重複防止であり、申し送り
  2点目の Target 型重複への対応ではない)に合わせて修正されている。
- **既存テスト**: `reth-node-internals.test.ts` は型名を直接参照して
  おらず、変更の影響なし。
- **ビルド・テスト**: リポジトリ全体で `pnpm lint` / `pnpm build` /
  `pnpm test`(shared 58 / collector 1058 / frontend 1205 / e2e 34)
  すべて通過。

前回レビューの補足(fieldPatch による drivesNodeId 残留の観測メモ、
#188 でのダングリングガード必須)と、コミット時の粒度指示(未コミットの
ため、1変更1コミットへの分割)は引き続き有効。

### 2026-07-08 QA検証(qa)

判定は**合格**。実際に collector を起動し WebSocket 経由で観測して、Issue
#186 の全完了条件が満たされていることを確認した。コードには手を入れていない。

#### 検証環境

- 検証時点で `chainviz-ethereum` プロジェクトの Ethereum スタック(reth1/reth2、
  beacon1/beacon2、validator1/validator2、workbench)が稼働中で、チェーンも
  進行していた(検証中に block 2929 → 3025 へ前進を確認)。
- `profiles/ethereum/docker-compose.yml` はプロジェクト名・サブネット
  (172.28.0.0/16)・固定 IP がハードコードされており、同一 Docker デーモン上に
  別プロジェクト名で並行してもう一つの独立スタックを立てるとネットワークが
  衝突するため、並行スタックの新規起動は行えない。また collector はコンテナを
  compose プロジェクト名でフィルタせず、稼働中の全コンテナを読み取り専用で
  観測する実装(`packages/collector/src/docker/poller.ts` が `listContainers`
  を無フィルタで呼ぶ)。
- 以上を踏まえ、稼働中スタックを一切変更しない形で検証するため、稼働中スタックを
  観測対象とし、**別ポート**(`CHAINVIZ_COLLECTOR_PORT=4222`/
  `CHAINVIZ_PROXY_PORT=4223`)で collector を新規プロセスとして起動して
  読み取り専用で観測した。addNode/removeNode/addWorkbench 等の変更系コマンドは
  一切送っていない。検証後にスタックのコンテナ数・構成が変わっていないこと、
  チェーンが正常進行していることを確認済み(稼働中スタックへの副作用なし)。

#### 確認した完了条件と実測結果

WebSocket で snapshot + diff を畳み込み、約22秒間観測した結果:

1. **beacon の `drivesNodeId`**: `beacon1` → `drivesNodeId:
   "chainviz-ethereum/reth1"`、`beacon2` → `"chainviz-ethereum/reth2"` を
   確認。ペアを取り違えず、駆動される側の reth・無関係な validator には
   `drivesNodeId` が付かないことも確認。
2. **reth の `internals`(syncStages/mempool)**: `reth1`/`reth2` の
   `NodeEntity.internals` に 15 個の同期ステージ(Headers〜PruneSenderRecovery、
   いずれも checkpoint 2970)と `mempool: { pending: 0, queued: 0 }` が反映され、
   `internals` を含む `entityUpdated` 差分が周期的に(22秒間で 6 回)届くことを
   確認。
3. **`nodeLinkActivity` の配信**: `fromNodeId`=beacon / `toNodeId`=reth の
   駆動リンク上で、Engine API 呼び出し統計(`engine_getPayloadV4`/
   `engine_newPayloadV4`/`engine_forkchoiceUpdatedV3` の count・latencyMs)を
   伴う `nodeLinkActivity` イベントが 22秒間で 8 回配信されることを確認。
   beacon↔reth のペアも取り違えていない。
4. **一部ノードの失敗が他ノードに波及しない**: 実行時は reth1/reth2 とも独立に
   internals・活動が反映され、相互汚染は観測されなかった。取得失敗の分離自体は
   `subscribeNodeInternals` の並行処理設計とテスト強化で追加された
   `peer-block-adapter.test.ts`(同一 tick 内で1ノードの取得失敗が他ノードを
   巻き込まない)で担保されており、実環境で意図的に故障を注入する検証は稼働中
   スタックを変更することになるため行っていない(構造・ユニットテストで確認)。

collector のログにエラー・fatal は出ていない。

#### 静的ゲート(完了条件6)

`pnpm build`、`pnpm lint`、`pnpm test` をこの worktree で独立に実行し、
いずれも成功することを確認した(shared 58 / e2e-unit 34 / collector 1058 /
frontend 1205、全通過。collector テスト出力中のデコード失敗等のログ行は
異常系テストの意図的な出力で、テスト自体は全通過)。なお `pnpm test` は各
パッケージのユニットテスト(`pnpm -r test`)であり、実 Docker を用いる e2e
(`pnpm test:e2e`)は含まないため、この実行でも稼働中スタックには触れていない。
