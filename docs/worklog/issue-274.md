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

