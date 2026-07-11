# Issue #274 CLノード(beacon)の同期状態が永久に「同期中」(blockHeight 0)と表示される

### 2026-07-11 Issue #274 設計（Beacon API 由来の CL 同期観測）

- 担当: designer（設計）
- ブランチ: issue-274-beacon-sync-display
- 内容: beacon（CL）ノードの `syncStatus`/`blockHeight` に情報源が無く、
  `toEntity` のフォールバック（"syncing"/0）が永久に配信され続ける既知の
  ギャップ（`docs/ARCHITECTURE.md` §7.3）を埋める設計。Issue 本文の
  対処方針候補のうち **候補(a)「Beacon API から観測して埋める」を採用**し、
  データフロー・ファイル構成・フロント表示・shared 型変更の要否を確定した。
  実装は collector / frontend 担当へ引き継ぐ（本フェーズはコード変更なし。
  shared はドキュメントコメントの追記のみで型変更なし）。

#### 決定事項と理由

1. **情報源は Beacon API `GET /eth/v1/node/syncing`（候補(a)を採用）**。
   - beacon は「チェーン（のコピー）を追う係」であり同期状態の表示自体は
     正しい。validator（#215、`showsSyncState: false`）のように表示を消す
     対処は不適切で、値の情報源を作るのが本筋。
   - このエンドポイントはピア取得（`/eth/v1/node/identity` /
     `/eth/v1/node/peers`）と同じ Beacon API（5052）の別パスで、追加の
     観測経路（ポート開放・認証等）は不要。1 リクエスト/ノード/周期の
     軽量 GET（レスポンス約 110 バイト）。
   - 稼働中スタック（2026-07-11、beacon1 のホスト公開 5052）での実測:
     `{"data":{"is_syncing":false,"is_optimistic":false,"el_offline":false,
     "head_slot":"16587","sync_distance":"0"}}`。数値フィールドは
     **10進の文字列**で返る点に注意（パース必須）。
2. **候補(b)「未観測の間は『観測中…』表示にする」は不採用**。
   - 情報源ができれば未観測の窓は最初の 1 ポーリング周期（約 3 秒）に
     縮む。これは EL ノードの現状（D層観測が入るまでプレースホルダ）と
     同じであり、専用表示を作る益が無い。
   - 「未観測」を表現するには shared の `syncStatus` union に第3値を足す
     型変更が必要で、collector の diff/store・frontend の全消費箇所へ
     波及する。#243 で「validator だけ optional 化する型変更は波及の割に
     益が無い」と退けたのと同じ判断。
3. **`syncStatus` はビーコンノードの自己申告から導出する**:
   `is_syncing` / `el_offline` / `is_optimistic` が**すべて false のとき
   `"synced"`、いずれかが true なら `"syncing"`**。
   - EL 側（#187）の「全ノードの Finish checkpoint 最大値との差 ≦ 5」の
     ような他ノード比較は不要（lighthouse 自身が先端追従を判定して返す
     ため）。固定閾値も持ち込まない。
   - `el_offline: true` は「接続先 EL が落ちていて頭を進められない」状態、
     `is_optimistic: true` は「EL 未検証のヘッドを楽観的に持っている」
     状態。どちらも「健全に追従できている」とは言えないため保守的に
     `"syncing"` 側へ倒す（定常状態の実測では 3 つとも false）。
   - フィールド欠落時（lighthouse 以外の CL クライアント・バージョン差）:
     `is_syncing` が boolean で読めなければそのノードの今回観測を破棄
     （キャッシュ未更新＝前回値保持）。`el_offline` / `is_optimistic` の
     欠落は false 扱い（欠落した補助フラグを理由に不調表示へ倒さない）。
4. **`blockHeight` には `head_slot`（ヘッドスロット）を入れ、フロントの
   表示ラベルを consensus 役割のとき「ヘッドスロット」に切り替える**。
   - スロットはブロック高と近いが一致しない（空スロットの分だけ大きい。
     実測: head_slot 16587 に対し EL の `eth_blockNumber` は 16583）。
     スロット値に「ブロック高」ラベルを付けると reth カードとの数値の
     食い違いが「壊れている」誤解を生むため、ラベルの切り替えは必須。
   - 代替案「`/eth/v2/beacon/blocks/head` から execution_payload の
     block_number を取れば EL と同じ『ブロック高』で表示できる」は不採用。
     リクエストが 2 本になり、ブロック全体（実測約 3.5KB、tx 数に比例して
     肥大）を 3 秒ごとに全 beacon から取るのは「RPC 呼び出しを増やさない」
     既存方針（#86 の設計判断と同系）に反する。また CL の先端をスロットで
     見せること自体が EL/CL の違い（D層可視化の狙い、§7.6.1）の学習材料に
     なる。
   - shared の `blockHeight` の意味づけは「単位・意味は役割に応じて
     チェーンプロファイルが決める」とドキュメントコメントで明文化した
     （型変更なし。§2 のスキーマ注記も同期済み）。**役割の異なるノード間で
     blockHeight を直接比較・集計してはならない**。現状の集計箇所
     `computeMaxSyncTargetHeight`（同期ミニバーの分母）は
     `internals.syncStages` を持つノード（=EL）のみ集計するため汚染されない
     ことを確認済み。
5. **ポーリングは D層ループ（`pollNodeInternalsOnce`、3 秒周期）に相乗り
   させる**（ピアループではなく）。
   - EL 側の同期観測（`syncStatusCache.update`）が既にこのループにあり、
     「同期観測の書き込みは D層ループ、読み出しは pollInfra の toEntity」
     という既存構造（§7.3「書き手を applyInfra の 1 本に保つ」）をそのまま
     踏襲できる。
   - このループは毎 tick Docker 観測を取り直すため、addNode/removeNode で
     beacon が増減しても追従する（既存の EL メトリクス対象と同じ）。
   - ピアループ側は取得失敗時にそのノードのピア情報ごと落とす構造
     （catch → null）なので、同期観測を混ぜると失敗の巻き添えになる。

#### データフロー（実装対象）

```
[D層ループ nodeInternalsTick（3秒周期・既存）]
  pollNodeInternalsOnce
    ├─ executionMetricsTargets(...) → reth /metrics → syncStatusCache.update  （既存）
    └─ beaconTargets(observations)  → GET /eth/v1/node/syncing               （新規）
         → beacon-api.ts: fetchBeaconSyncing() が生レスポンスを正規化
         → beacon-sync-status.ts: resolveBeaconSyncStatus() で
            {syncStatus, blockHeight(=headSlot)} へ変換
         → BeaconSyncStatusCache.set(stableId, resolved)
[A層ループ pollInfra（既存）]
  toEntity: syncStatusCache.resolve(id) ?? beaconSyncStatusCache.resolve(id)
            ?? プレースホルダ("syncing"/0)
  → applyInfra → store → diff 配信（書き手は従来どおり 1 本）
[frontend]
  InfraPopover: showsSyncState の高さ行のラベル/用語解説を
  nodeRoles.ts の役割記述子で切り替え（consensus → ヘッドスロット/slot）
```

#### collector 担当への引き継ぎ（実装内容）

`packages/collector/src/adapters/ethereum/` 配下:

1. `beacon-api.ts`: `fetchBeaconSyncing(http, baseUrl)` を追加。
   `GET ${baseUrl}/eth/v1/node/syncing` を叩き、
   `{ isSyncing: boolean; isOptimistic: boolean; elOffline: boolean;
   headSlot: number }` へ正規化して返す（`head_slot` は 10進文字列 →
   number。`is_syncing` が boolean でない・`head_slot` が数値にパース
   できない場合は throw し、呼び出し側にログさせる。`is_optimistic` /
   `el_offline` の欠落は false）。Beacon API のパス・レスポンス形状は
   このファイルに閉じ込める（既存の流儀）。
2. 新規ファイル `beacon-sync-status.ts`（1 ファイル 1 責務。EL 用の
   `sync-status.ts` とは判定ロジックが異なるため同居させない）:
   - `resolveBeaconSyncStatus(raw): ResolvedSyncStatus`（純関数）。
     上記決定事項 3 の判定で `syncStatus` を決め、`blockHeight` に
     `headSlot` を入れる（`ResolvedSyncStatus` は `sync-status.ts` から
     import して共用）。
   - `BeaconSyncStatusCache`: `set(stableId, resolved)` /
     `resolve(stableId): ResolvedSyncStatus | undefined` /
     `forgetNode(stableId)` を持つ単純なキャッシュ
     （`NodeSyncStatusCache` と違い最大値比較を持たない）。
3. `index.ts`:
   - フィールド `beaconSyncStatusCache` を追加。
   - `pollNodeInternalsOnce`: 取得済みの `observations` から
     `beaconTargets(observations)`（既存関数。validator 除外済み）を列挙し、
     EL メトリクスと並行に各 beacon の syncing を取得 → キャッシュ更新。
     取得失敗はそのノードだけ落として `console.error`（stableId と実際の
     エラー内容を出す。黙って握りつぶさない）し、キャッシュは前回値を
     保持（次周期で回復する一時的縮退）。
   - 消えたノードの後始末: 既存の `trackedNodeInternalsIds` と同様に、
     今回の beacon 対象集合に無くなった stableId を
     `beaconSyncStatusCache.forgetNode` する（EL 用とは別の集合で追跡する。
     混ぜると forget 先のキャッシュが曖昧になる）。
   - `toEntity`: `this.syncStatusCache.resolve(obs.stableId) ??
     this.beaconSyncStatusCache.resolve(obs.stableId)` に変更（両キャッシュ
     の対象ノード集合は互いに素なので順序に意味は無いが、既存の EL 側を
     先に書く）。コメントの「CL ノードは既存プレースホルダのまま」の
     記述を更新する。
4. `dispose()` の変更は不要（新規タイマー・接続を持たないため）。

#### frontend 担当への引き継ぎ（実装内容）

`packages/frontend/src/` 配下:

1. `chain-profiles/ethereum/nodeRoles.ts`: `NodeRoleDescriptor` に
   optional なフィールド（例: `syncHeight?: { label: Localized;
   glossaryKey: string }`。命名は実装裁量）を追加し、`consensus` にのみ
   `{ label: { ja: "ヘッドスロット", en: "Head slot" }, glossaryKey:
   "slot" }` を設定する。省略時（execution・未知役割・nodeRole 無し）は
   既存表示（`field.blockHeight`「ブロック高」+ 用語解説 `block`）に
   フォールバックする。
2. `entities/InfraPopover.tsx`: `showsSyncState` ブロック内の高さ行で、
   記述子の override があればラベル・用語解説キーをそれで置き換える。
   「同期状態」行は変更なし（synced/syncing の文言は共通でよい）。
3. `glossary/ethereum/terms/a-infra.yaml`（`cl-client` / `validator` と
   同じファイル。最終的な置き場所は実装時の裁量でよい）に用語 `slot` を
   新設する。既存の 3 拍子（定義 → なぜ必要か → chainviz ではどう
   見えるか）で書き、「スロットは 2 秒ごとの提案機会であり、提案が無い
   （空の）スロットもあるため、ヘッドスロットは EL のブロック高より
   少し大きくなる」ことを chainviz での見え方として含めると、beacon
   カードと reth カードの数値の差の説明がその場で完結する。
   relatedTerms は `block` / `cl-client` あたり。UI アンカーは本ポップ
   オーバー行が対応する（#124 の「全用語にアンカー必須」を満たす）。
   英語定義は chainviz-i18n のレビュー対象。
4. `i18n/messages.ts` の変更は不要（記述子が `Localized` を持つため）。
   カード面（`InfraNodeCard`）は syncStatus のドットのみで高さを表示
   しないため変更不要。`InfraNodeCardSyncProgress` /
   `computeMaxSyncTargetHeight` は `internals.syncStages` 起点なので
   beacon には発火しない（変更不要なことを確認済み）。

#### テスト・QA の観点（tester / qa への申し送り）

- collector: `fetchBeaconSyncing` のパース（文字列 head_slot、フラグ欠落、
  不正形状で throw）、`resolveBeaconSyncStatus` の判定表（3 フラグの
  組み合わせ）、キャッシュの set/resolve/forget、`toEntity` の
  フォールバック順（EL キャッシュ → CL キャッシュ → プレースホルダ）、
  取得失敗時に前回値が保持されること。
- frontend: consensus ノードのポップオーバーで「ヘッドスロット」ラベル +
  `slot` 用語解説になること、execution は従来どおり「ブロック高」である
  こと、nodeRole 省略・未知値で既存フォールバックが崩れないこと。
- QA（実機）: beacon1/beacon2 のポップオーバーが「同期状態: 同期済み /
  ヘッドスロット: <増加する値>」になること。reth 側の表示が非退行である
  こと。addNode 直後の新 beacon が「同期中」→ 追いついたら「同期済み」に
  遷移すること（lighthouse のバックフィル中は `is_syncing: true` が返る）。
  beacon 停止 → 対象から消えたノードの値が他ノードに影響しないこと。

#### 前提条件・注意点

- 判定に固定の閾値・タイムアウトは導入していない（自己申告ベース）。
  ポーリング周期は既存の `nodeInternalsPollIntervalMs`（3 秒）に相乗り
  し、新しい定数を作らない。
- `/eth/v1/node/syncing` は Beacon API 標準（Eth Beacon Node API 仕様）の
  エンドポイントであり lighthouse 固有ではないが、`el_offline` は比較的
  新しいフィールドのため欠落を許容する実装にする（上記決定事項 3）。
- 未観測の最初の約 3 秒間は従来どおり「同期中 / ヘッドスロット: 0」が
  出る（EL ノードの既存挙動と同じ窓。専用表示は作らない＝決定事項 2）。
- shared は**型変更なし**（`syncStatus`/`blockHeight` へのドキュメント
  コメント追記のみ）。`pnpm build` / `pnpm test` が全パッケージで通る
  ことを設計フェーズで確認済み。

### 2026-07-11 Issue #274 実装方針の確認（collector）

- 担当: collector
- ブランチ: issue-274-beacon-sync-display
- 設計メモ（上記）を実装に落とす際の関数構成・データフローを確認。
  設計からの変更は無いが、既存コードとの対応関係を明記しておく。

1. `beacon-api.ts`: 既存の `fetchNodePeerId` / `fetchConnectedPeerIds` と
   同じ形（`HttpClient` + `baseUrl` を受けて Beacon API 固有の JSON 形状を
   このファイル内だけで正規化する）で `fetchBeaconSyncing` を追加する。
   返り値の型名は `BeaconSyncingSnapshot`（`isSyncing` / `isOptimistic` /
   `elOffline` / `headSlot`）とする。`head_slot` は `Number(...)` で
   パースし `Number.isFinite` で検査、`is_syncing` は `typeof === "boolean"`
   で検査してどちらも満たさなければ throw。`is_optimistic` / `el_offline`
   は `=== true` の真偽判定にすることで、値が欠落（`undefined`）していても
   例外にならず false 扱いになる（決定事項 3 をそのまま関数に落とし込む）。
2. `beacon-sync-status.ts`: `resolveBeaconSyncStatus(raw: BeaconSyncingSnapshot):
   ResolvedSyncStatus` は 3 フラグの OR 判定のみの純関数。`ResolvedSyncStatus`
   は `sync-status.ts` から import して型を共用する（EL/CL で同じ形の
   値を pollInfra が読む）。`BeaconSyncStatusCache` は `NodeSyncStatusCache`
   と違い最大値比較をしないため `Map<string, ResolvedSyncStatus>` を
   `set` / `resolve` / `forgetNode` で包むだけの薄いクラスにする。
3. `index.ts`:
   - フィールド追加: `beaconSyncStatusCache = new BeaconSyncStatusCache()`
     （`syncStatusCache` の直後）、`trackedBeaconSyncIds = new Set<string>()`
     （`trackedNodeInternalsIds` の直後。EL 用の追跡集合とは別に持つ設計
     どおり）。
   - `pollNodeInternalsOnce` 内で `beaconTargets(observations)`（既存の
     ピアポーリングで使っている関数をそのまま再利用。validator は
     `beaconTargets` の時点で既に除外済み）を呼び、EL 用の
     `trackedNodeInternalsIds` と同じパターンで `trackedBeaconSyncIds` の
     差分から `forgetNode` する。EL の `pollOneNodeInternals` 呼び出しと
     新設の `pollOneBeaconSync` 呼び出しは同じ `Promise.all` にまとめて
     並行実行する（両者は独立した対象集合・独立したキャッシュなので
     混ぜてよい）。
   - 新規メソッド `pollOneBeaconSync(target: BeaconTarget)`: 取得失敗を
     `pollOneNodeInternals` と同じ流儀（`console.error` に stableId と
     実際のエラー内容を出し、そのノードだけ諦めて前回値を保持）で処理する。
   - `toEntity`: `this.syncStatusCache.resolve(obs.stableId) ??
     this.beaconSyncStatusCache.resolve(obs.stableId) ?? { syncStatus:
     "syncing" as const, blockHeight: 0 }` の順で解決する。既存コメント
     （353〜357行目付近、「CL ノード・観測前…」の記述）を更新し、CL は
     `beaconSyncStatusCache` から埋まる旨を明記する。

このメモの内容で実装を進める。

### 2026-07-11 Issue #274 実装記録（collector）

- 担当: collector
- ブランチ: issue-274-beacon-sync-display
- 変更ファイル:
  - `packages/collector/src/adapters/ethereum/beacon-api.ts`:
    `fetchBeaconSyncing(http, baseUrl)` を追加。`GET /eth/v1/node/syncing`
    を叩き `BeaconSyncingSnapshot`（`isSyncing`/`isOptimistic`/`elOffline`/
    `headSlot`）へ正規化する。`is_syncing` が boolean で読めない、
    `head_slot` が数値としてパースできない場合は throw（呼び出し側で
    ログさせる）。`is_optimistic`/`el_offline` の欠落は `=== true` 判定に
    することで自動的に false 扱いになる。
  - `packages/collector/src/adapters/ethereum/beacon-sync-status.ts`
    （新規）: `resolveBeaconSyncStatus(raw)` と `BeaconSyncStatusCache`
    （`set`/`resolve`/`forgetNode`）。`ResolvedSyncStatus` 型は
    `sync-status.ts` から import して EL 用キャッシュと形を揃えた。
  - `packages/collector/src/adapters/ethereum/index.ts`: フィールド
    `beaconSyncStatusCache` / `trackedBeaconSyncIds` を追加。
    `pollNodeInternalsOnce` で `beaconTargets(observations)` を並行に
    `pollOneNodeInternals`（EL）と同じ `Promise.all` に混ぜて処理する
    新規メソッド `pollOneBeaconSync` を呼ぶ。取得失敗はそのノードだけ
    `console.error` に stableId と実際のエラー内容を出して諦め、キャッシュは
    前回値を保持する（一時的縮退）。観測から消えた beacon は
    `trackedBeaconSyncIds` の差分で `forgetNode`。`toEntity` は
    `syncStatusCache.resolve(...) ?? beaconSyncStatusCache.resolve(...)`
    の順でフォールバックする（対象ノード集合は互いに素）。
- テスト:
  - `beacon-api.test.ts` に `fetchBeaconSyncing` のケースを追加
    （実測レスポンス形状のパース、フラグ欠落時の false 扱い、
    head_slot=0（genesis）の扱い、`is_syncing`/`head_slot` の不正値での
    throw、HTTP クライアント自体の例外伝播）。
  - `beacon-sync-status.test.ts`（新規）: `resolveBeaconSyncStatus` の
    判定表（3 フラグの組み合わせ）と `BeaconSyncStatusCache` の
    set/resolve/forgetNode、他ノードとの比較を持たないことの確認。
  - `peer-block-adapter.test.ts`: 新規 describe ブロック
    「EthereumAdapter syncStatus/blockHeight for CL (beacon) via Beacon
    API (Issue #274)」を追加し、D層ループ（`subscribeNodeInternals`）→
    `beaconSyncStatusCache` → `pollInfra`（`toEntity`）の結合フローを
    検証（head_slot の反映、EL とは単位が異なり混同しないこと、
    3 フラグそれぞれが true の場合の syncing 判定、beacon 間で相互比較
    しないこと、取得失敗時に前回値を保持すること、削除時の forgetNode、
    validator が対象外であること）。
- 既存テストへの影響（重要）: `pollNodeInternalsOnce` が同じ tick で
  beacon の同期状態も取得するようになったため、`subscribeNodeInternals`
  系の既存テストのうち beacon フィクスチャを含み `httpClient` を渡して
  いなかったものは、既定の `createFetchHttpClient()`（実 fetch）が
  使われてしまい、fake timers 環境下で実ネットワーク待ちが解決タイミングと
  噛み合わず 3 件が不安定に失敗した（`vi.advanceTimersByTimeAsync` が
  実ソケット I/O を早送りできないため）。対処として:
  - `beaconHttp` ヘルパー（`peer-block-adapter.test.ts`）を拡張し、
    `/eth/v1/node/syncing` に既定で健全な応答（synced/head_slot 0）を
    返すようにした（`syncing` フィールドで上書き可能）。
  - 同期状態の値自体を検証しない既存テストには、実ネットワークに
    フォールバックしないための新規ヘルパー `defaultBeaconSyncHttp(...ips)`
    経由でモック `httpClient` を明示的に渡すよう修正した。
  - Issue #187 側の既存テスト「CL(beacon)ノードは D層メトリクスを
    持たないためプレースホルダのまま」は、beacon 自身の Beacon API
    取得が失敗するケース（モック HttpClient がそのベース URL に応答を
    持たない）に意味が変わったため、タイトル・コメントを実態に合わせて
    修正した（`beaconHttp({})` で意図的に「取得失敗時の前回値保持」を
    検証するテストとして残した）。
  - **テストにモック HttpClient を渡さない場合、実ネットワークへ
    フォールバックしてテストが不安定になる**ことが分かったので、
    今後 `subscribeNodeInternals` 系のテストに beacon フィクスチャを
    加える際は必ず `httpClient` を明示すること（次の担当への申し送り）。
- 実機確認（docker compose、`pnpm dev:up`）: 稼働中のスタックに対し
  WebSocket スナップショットを取得し、`beacon1`/`beacon2` の
  `syncStatus` が `"synced"`、`blockHeight` が `head_slot`（17311）で
  `reth1`/`reth2` の `blockHeight`（EL のブロック高、17300/17301）とは
  異なる値になっていることを確認した。`validator1`/`validator2` は
  従来どおり `syncing`/0 のプレースホルダのまま（`beaconTargets` の
  選別基準どおり対象外であり非退行）。
- 確認コマンド: `pnpm --filter @chainviz/collector build` /
  `pnpm --filter @chainviz/collector test`（1214 件）/
  `pnpm build`（全パッケージ）がいずれも成功。
- frontend 側（`nodeRoles.ts` の高さ行 override・`InfraPopover.tsx` の
  ラベル切り替え・`glossary` の `slot` 新設）は未着手のまま別担当へ
  引き継ぐ。collector 側の `NodeEntity.blockHeight` には既に
  head_slot が入っており、フロント未対応の間は「ブロック高」ラベルの
  まま大きめの値（head_slot）が表示される暫定状態になる（既存の
  ラベル文言を変更しない限りの制約であり、機能追加前提の一時的な見え方）。

### 2026-07-11 frontend 実装方針（着手前メモ）

- 担当: frontend
- ブランチ: `issue-274-beacon-sync-display-frontend`（`git worktree` の制約上、
  collector 担当が同じブランチ名 `issue-274-beacon-sync-display` を別
  worktree で使用中のため、同一コミットから分岐した別名ブランチを新規に
  切って作業する。マージ時の合流調整は統括が行う）
- `NodeRoleDescriptor`（`nodeRoles.ts`）に optional な `heightField?:
  { label: Localized; glossaryKey: string }` を追加し、`consensus` にのみ
  `{ label: { ja: "ヘッドスロット", en: "Head slot" }, glossaryKey: "slot" }`
  を設定する。**既定値（「ブロック高」+ `block`）はここに複製しない**。
  i18n messages.ts の `field.blockHeight` を単一の情報源に保ち、
  `InfraPopover.tsx` 側で override が無いときにそちらへフォールバックする
  （デフォルトを2箇所に持つとラベル文言のドリフトを招くため）。
  併せて `describeHeightField(nodeRole)` を新設し、override 取得ロジックを
  `nodeShowsSyncState` と同じ「未知値/undefined は undefined（＝デフォルト
  適用）」の形で切り出してユニットテスト可能にする。
- `InfraPopover.tsx` の高さ行を `nodeRoleDescriptor?.heightField` の有無で
  ラベル・`GlossaryTerm` の `termKey` を出し分ける。値自体
  （`entity.blockHeight`）はそのまま表示する（意味づけの変更のみで値の
  変換はしない。ヘッドスロット/ブロック高のどちらであってもワールド
  ステート側の `blockHeight` フィールドをそのまま使う設計はドキュメント
  コメントレベルで既に決定済み）。
- `glossary/ethereum/terms/a-infra.yaml` に `slot` を新設する（`cl-client`
  の直後）。日本語定義文は設計メモの「3拍子（定義→なぜ必要か→chainviz
  でどう見えるか）」に従い、head_slot が EL のブロック高よりわずかに
  大きくなり得る理由（空スロットの存在）を含める。英語定義はプレース
  ホルダとして日本語の直訳を置き、chainviz-i18n のレビュー対象とする
  （設計メモの指示どおり）。`relatedTerms` は `block` / `cl-client`。
- テストは `nodeRoles.test.ts`（`heightField` の記述子形状・
  `describeHeightField` の分岐）と `InfraPopover.test.tsx`（consensus で
  「ヘッドスロット」+ `slot` アンカー、execution/undefined/未知値で従来の
  「ブロック高」+ `block` に留まること、英語ローカライズ）に追加する。

### 2026-07-11 frontend 実装完了

- 担当: frontend
- 実施内容:
  1. `packages/frontend/src/chain-profiles/ethereum/nodeRoles.ts`:
     `NodeRoleDescriptor` に optional な `heightField?: { label: Localized;
     glossaryKey: string }` を追加し、`consensus` にのみ
     `{ label: { ja: "ヘッドスロット", en: "Head slot" }, glossaryKey: "slot" }`
     を設定した。取得用に `describeHeightField(nodeRole)` を新設し、
     override が無い場合（execution・validator・未知値・undefined）は
     `undefined` を返す（既存の `describeNodeRole`/`nodeShowsSyncState` と
     同じフォールバック方針）。
  2. `packages/frontend/src/entities/InfraPopover.tsx`: 高さ行のラベル・
     `GlossaryTerm` の `termKey` を `describeHeightField` の結果で出し分ける
     ように変更。override が無いときは従来どおり `t("field.blockHeight")` +
     `block` を使う（既定値を `nodeRoles.ts` 側に複製せず、i18n
     messages.ts を単一の情報源に保った）。表示する値自体
     （`entity.blockHeight`）は変換せずそのまま出す。
  3. `glossary/ethereum/terms/a-infra.yaml` に用語 `slot` を新設（`cl-client`
     の直後）。3拍子（定義→なぜ必要か→chainvizでの見え方）の構成で、
     ヘッドスロットが空スロットの分だけ EL のブロック高よりわずかに
     大きくなり得ることを含めた。英語定義は日本語の直訳ベースの
     プレースホルダで、chainviz-i18n のレビュー対象として残す。
     `relatedTerms: [block, cl-client]`。
  4. テスト: `nodeRoles.test.ts` に `heightField` の記述子形状・
     `describeHeightField` の分岐（consensus/execution/validator/未知値/
     undefined）を追加。`InfraPopover.test.tsx` に consensus ノードで
     「ヘッドスロット」表示・`slot` glossary アンカー・値がそのまま出る
     こと、execution/undefined/未知値ロールで従来の「ブロック高」+
     `block` のままであること、英語ローカライズ（"Head slot"）を追加。
  5. `i18n/messages.ts` は変更なし（既存 `field.blockHeight` を既定
     フォールバックとして再利用したため。設計メモどおり）。
- 確認: `pnpm build` / `pnpm test`（frontend、121 ファイル・1882 テスト
  すべて成功）/ `pnpm lint`（ルート、エラーなし）を実行し、いずれも
  通ることを確認した。
- 触れていないもの: collector 側（`beacon-api.ts` / `beacon-sync-status.ts`
  / `index.ts`）は別 worktree で並行実装中のため一切変更していない。
- 注意点（次の担当・統括向け）:
  - **ブランチ名の乖離**: `git worktree` はブランチを2箇所で同時に
    checkout できないため、`issue-274-beacon-sync-display` は collector
    側の worktree が使用中だった。本作業は同じコミット
    （`docs: Issue #274 の設計メモを記録しバックログ・索引を更新`）から
    分岐した `issue-274-beacon-sync-display-frontend` というブランチ名で
    行った。マージ時は collector 側のコミットとこのブランチのコミットを
    1本の PR（`issue-274-beacon-sync-display` へ統合するか、いずれかの
    ブランチへ cherry-pick/rebase する）にまとめる調整が必要。
  - `docs/PLAN.md` の該当チェックボックス（「CLノード(beacon)の同期状態が
    永久に『同期中』」）は、issue 全体が collector 実装込みで完了する
    までチェックを付けていない（本チェックボックスは1 Issue = collector +
    frontend 両方の実装を含む粒度のため）。

### 2026-07-11 Issue #274 テスト強化（異常系・境界値）

- 担当: tester
- ブランチ: issue-274-beacon-sync-display（collector・frontend の実装を
  合流済みのブランチ上で作業）
- 実装担当が書いた基本テスト（ハッピーパス中心）に対し、異常系・境界値・
  データと表示の分離の観点でケースを追加した。実装コードは変更していない。

#### collector 側

- `beacon-api.test.ts`（`fetchBeaconSyncing`）:
  - `head_slot` が JSON 数値（文字列でない）でもパースできること。
  - `is_optimistic` が非 boolean の真値（文字列 `"true"`）、`el_offline` が
    非 boolean の真値（数値 `1`）のとき、`=== true` の厳密判定により false に
    倒れること（補助フラグの欠落を不調表示にしない方針との一貫性）。対に、
    本物の boolean `true` はそのまま透過することも固定。
- `beacon-sync-status.test.ts`（`resolveBeaconSyncStatus`）:
  - 3 フラグ（is_syncing / is_optimistic / el_offline）の全 8 組み合わせを
    網羅する `it.each` の真理値表を追加。個別 it では抜けていた FTT / TFT /
    TTF の 3 通りを含め、「すべて false のときだけ synced」を明示的に固定。
  - `BeaconSyncStatusCache`: forgetNode 後に同じ stableId を再観測する
    ライフサイクル（removeNode → addNode 相当）で前回値が残らず新しい値で
    埋まることを固定。
- `peer-block-adapter.test.ts`（Issue #274 の結合テスト describe）:
  - 同じ D層 tick で EL の `/metrics` 取得が失敗しても、CL(beacon)の
    `/eth/v1/node/syncing` は影響を受けずに解決されること（`pollOneBeaconSync`
    と `pollOneNodeInternals` が独立したキャッシュ・対象集合で互いに干渉
    しない。逆向き（beacon 失敗時に EL が埋まる）は既存テストがカバー済み）。

#### frontend 側

- `nodeRoles.test.ts`（`describeHeightField`）: `"toString"` /
  `"constructor"` / `"__proto__"` / `"hasOwnProperty"` などの継承メンバ名で
  記述子を誤って返さないこと（Issue #215 で入れた `Object.hasOwn` ガードが
  `describeNodeRole` 経由で `describeHeightField` にも効くことの確認）。
- `InfraPopover.test.tsx`（Issue #274 の高さ行ラベル override describe）:
  - consensus ノードの値が未観測窓のプレースホルダ（syncStatus="syncing" /
    blockHeight=0）のままでも、高さ行が「ヘッドスロット」ラベル + 値 "0" を
    出すこと（ラベル切り替えは役割で決まり値に依存しない。Issue #215 の
    「display is role-driven, not data-driven」と同じデータ／表示ロジックの
    分離。観測前に一瞬「ブロック高」になってから切り替わるちらつきが無い）。

#### 確認

- `pnpm --filter @chainviz/collector build` / `test`（1228 件、+14）、
  `pnpm --filter @chainviz/frontend build` / `test`（1884 件、+2）が
  いずれも成功。

#### 実装担当への申し送り（潜在的なエッジ・軽微）

- `fetchBeaconSyncing` の `head_slot` パースは `Number(...)` を使うため、
  以下の異常入力を throw せず静かに受理する（`Number.isFinite` を通過する）:
  空文字列 `""` / 空白のみ `" "` → 0、`"0x10"` → 16（16進として解釈）、
  `"1e3"` → 1000、`null` → 0。特に空文字列・null が 0 になると、本 Issue が
  解消しようとした「同期中 / blockHeight 0」の症状を再現しうる（欠落
  `undefined` は NaN で throw されるのと非対称）。実運用の lighthouse は常に
  正しい 10進文字列を返すため実害の可能性は低く、今回はテストで固定せず
  報告に留めた（現状の挙動を「正」として enshrine すると将来の厳格化を
  妨げるため）。より厳格にするなら 10進整数文字列の形（例: `/^\d+$/`）で
  検証してから `Number` に渡す選択肢がある。実装を変えるかは collector
  担当の判断に委ねる。

### 2026-07-11 Issue #274 レビュー（静的整合性・テスト品質）

- 担当: reviewer
- ブランチ: issue-274-beacon-sync-display
- 判定: **合格**（差し戻しなし。軽微な申し送り2点あり、下記）

#### 確認内容

- 設計原則との整合:
  - 境界の遵守: 追加の観測経路は collector 内の Beacon API 呼び出しのみで、
    frontend は `NodeEntity.blockHeight` / `nodeRole` を読むだけ。Beacon API の
    パス・レスポンス形状は `beacon-api.ts`（ChainAdapter 実装の内側）に
    閉じている。「ヘッドスロット」ラベル・用語 `slot` は
    `chain-profiles/ethereum/nodeRoles.ts`（チェーンプロファイル表現セット）に
    置かれ、`InfraPopover.tsx` 本体は記述子を読むだけの汎用実装のまま。
    shared は型変更なし（ドキュメントコメント追記のみ）で、コメント中の
    EL/CL への言及は例示であり、スキーマにチェーン固有語彙は入っていない。
  - Issue #215 / #243 との一貫性: validator は「同期する係ではない」ため
    表示自体を消す（`showsSyncState: false`）、beacon は「チェーンを追う係」
    のため情報源を作って値を埋める、という対処の違いが `nodeRoles.ts` の
    コメントと設計メモの両方から読み取れる。`describeHeightField` は
    `describeNodeRole` 経由のため #215 の `Object.hasOwn` ガードも効いている
    （テストで固定済み）。
  - 固定値の埋め込みなし: 判定はノード自己申告の3フラグのみで、閾値・
    タイムアウトの新設なし。ポーリングも既存の3秒周期に相乗り。
  - エラーの握りつぶしなし: `pollOneBeaconSync` の catch は stableId と
    実際のエラー内容を `console.error` に出し、前回値保持（一時的縮退）の
    意図がコメントで明示されている。
- 追加 RPC の確認: 差分に現れる新規エンドポイントは
  `GET /eth/v1/node/syncing` のみ（コード・テスト全体を grep で確認）。
  Issue #86 の「RPC を増やさない」方針と両立している。
- cherry-pick 合流の確認: frontend 4コミット（nodeRoles override /
  InfraPopover / glossary / worklog）が本ブランチに欠落・重複なく取り込まれて
  いる（worklog の frontend 実装完了メモに記載の変更・テストと差分が一致。
  分岐元ブランチ `issue-274-beacon-sync-display-frontend` は削除済み）。
- ビルド・テスト: リポジトリ全体で `pnpm lint` / `pnpm build` / `pnpm test`
  すべて成功（shared 62 / collector 1228 / frontend 1884 件）。
- テスト品質: `resolveBeaconSyncStatus` は3フラグ全8組み合わせの真理値表、
  `fetchBeaconSyncing` は実測形状・フラグ欠落・genesis の head_slot=0・
  不正値 throw・HTTP 例外伝播、キャッシュは forget→再観測のライフサイクル、
  結合テストは EL 失敗時の CL 非干渉・前回値保持・validator 対象外まで
  カバーしており、ハッピーパスの写経に留まっていない。
- コミット粒度: 14コミットすべて Conventional Commits 準拠で、
  設計 docs / shared コメント / collector 3分割 / frontend 3分割 /
  テスト強化 / worklog が関心事ごとに分かれている。
- docs: `docs/ARCHITECTURE.md` §2・§7.3 が「既知のギャップ」の記述を解消後の
  実装に更新済み。`docs/PLAN.md` チェック済み + Issue リンクあり。
  `docs/WORKLOG.md` 索引に1行追加済み。

#### head_slot パース厳格化の判断（テスト強化担当からの申し送りへの回答）

**差し戻しはせず、別 Issue 起票を推奨**とする。理由:

- Beacon API 仕様上 `head_slot` は10進文字列エンコードの uint64 であり、
  本プロファイルで使う lighthouse は常に準拠した値を返す。`""`/`null` が
  0 に化けるのは「`is_syncing` は正しい boolean を返すのに `head_slot` だけ
  壊れた値を返す非準拠クライアント」という狭い前提でのみ起こる。
- 起きた場合の影響も表示上の値（ヘッドスロット 0）に限られ、他ノードへの
  汚染や syncStatus 誤判定には波及しない（syncStatus はフラグのみで決まる）。
- 一方で厳格化には設計判断が要る（テスト強化で「JSON 数値の head_slot も
  受理する」ことが固定されたため、単純な `/^\d+$/` 文字列検査だけでは
  そのテストと矛盾する。「10進整数文字列 または 非負整数の JSON 数値」を
  受理する形にする必要がある）。この判断を本 Issue のマージ後に急いで
  混ぜ込むより、独立した小 Issue として扱うのが適切。

#### 軽微な申し送り（非ブロッキング）

1. 上記のとおり `fetchBeaconSyncing` の `head_slot` パース厳格化を別 Issue と
   して起票することを推奨（統括判断）。
2. 用語 `slot` の定義文が「Proof of Stake で 2 秒ごとに割り当てられる」と、
   2秒を PoS 一般の事実のように書いている。2秒は本環境の短縮設定
   （`profiles/ethereum/values.env` の `SLOT_DURATION_IN_SECONDS="2"`）で
   あり、Ethereum メインネットは12秒。学習支援アプリの用語集としては
   「この環境では2秒（メインネットは12秒）」のように区別した方が誤解が無い。
   英語定義は元々 chainviz-i18n のレビュー対象（プレースホルダ）なので、
   その際に日本語側も併せて直すのが低コスト。

### 2026-07-11 i18nレビュー記録（slot用語）

- 担当: i18n
- ブランチ: issue-274-beacon-sync-display
- 内容: `glossary/ethereum/terms/a-infra.yaml` の `slot` 用語について、
  reviewer からの申し送り（上記「軽微な申し送り」2番）に対応した。
  日本語定義文・英語定義文の両方を、以下の観点で書き直した。
  - 「1スロット=12秒」がEthereumメインネットの仕様であることと、
    「2秒」はchainvizの開発環境で短縮した設定値であることを明確に
    区別する文に修正（`profiles/ethereum/values.env` のコメント
    「既定の 12 秒から 2 秒へ」を一次情報として採用）。
  - 日本語定義文の内容変更は本来 chainviz-frontend の担当領域だが、
    今回はレビューアから明示的に対応許可が出ている指摘のため、
    i18n側でそのまま修正した。
  - 英語訳は日本語の直訳ベースのプレースホルダだったため、内容修正に
    合わせて自然な英語に書き直した。文章の構成（PoSスロットの定義 →
    メインネット/chainvizでの秒数の違い → 空スロット → ヘッドスロットと
    ELブロック高の乖離 → chainvizでの見え方）は、既存の `cl-client` /
    `rpc-endpoint` 等のエントリと同じ「一般的な定義 → chainvizでの
    具体的な現れ方」という3拍子の構成を踏襲した。
  - 用語集の英語エントリでは、他のエントリと同様に具体的な環境変数名や
    設定ファイルパスを本文中に出さず、「Ethereum mainnet」「chainviz's
    dev environment」という自然文で説明する方針にした。
- 確認事項: `packages/frontend/src/glossary/parse.ts` を確認し、
  `en`/`ja` の文字数上限などのバリデーションが無いことを確認した
  （定義文の長さがビルド・テストに影響しない）。
