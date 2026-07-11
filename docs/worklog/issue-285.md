# Issue #285 validatorがbeaconと視覚的に関連付けられておらず「浮いて見える」

### 2026-07-11 Issue #285 設計（validator→beacon の内部リンク）

- 担当: designer
- ブランチ: issue-285-validator-beacon-link
- 内容: validator client（VC）カードがキャンバス上でどのノードとも結ばれず
  「浮いて見える」課題に対する設計。設計本文は
  `docs/ARCHITECTURE.md` §7.6.11（新設）と §2 / §7.3 / §7.4 の更新に反映
  済み。`packages/shared` は `NodeEntity.drivesNodeId` の docstring を
  一般化したのみ（構造変更なし）。`pnpm build && pnpm test` 全パッケージ
  通過を確認済み。

## 設計の要点（実装担当向けの引き継ぎ）

### 決定した方針

**既存の `drivesNodeId`（駆動する側→される側の一般関係）を再利用**して
validator → beacon の内部リンクエッジを描く（Issue 本文の候補 (a) を採用）。

- 候補 (b) 専用エッジ種別の新設は不採用: スキーマ上は既存の一般関係と
  同型で、種別を分けるとフロントに同じ導出ロジックの並行実装が生まれる
  だけ。役割の組ごとの文言の違いは `nodeRole` の解釈としてフロントの
  チェーンプロファイル表現セットが担えばよい（ChainAdapter 境界の流儀）
- 候補 (c) グループ化・配置の工夫は不採用: カード位置はユーザーがドラッグで
  動かせる（レイアウト永続化済み）ため配置による表現は壊れる。既存 UI の
  「関係はエッジで示す」流儀に合わせる

### データ取得元の調査結果（静的解決を選んだ理由）

VC がどの beacon に接続しているかを**実測観測する経路は現状存在しない**:

- lighthouse VC の HTTP API は `profiles/ethereum/scripts/lighthouse-vc.sh`
  で有効化していない（lighthouse の既定でも無効・localhost バインド・
  トークン認証が必要）
- VC のメトリクス（`--metrics`）も有効化していない
- Beacon API 側に「接続元 VC を列挙する」エンドポイントは無い
- collector の Docker 観測（`ContainerObservation`）はラベルは持つが
  コンテナの環境変数（`BEACON_NODE`）は収集しない

一方、既存の beacon→reth の `drivesNodeId` も Engine API のトラフィック
実測ではなく compose サービス名のノード群キーによる静的解決である。
validator→beacon も同じ仕組み（validator\<n\> ↔ beacon\<n\>）にそろえるのが
一貫する。`targets.ts` の `serviceNodeKey` は既に "validator" プレフィックスを
剥がせるため、追加するのは `findPairedStableId` の薄いラッパー 1 つで済む。

補足: addNode で追加されるフォロワーは validator 無しの reth+beacon ペア
（`node-lifecycle.ts`）なので、この対応付けが効くのは compose 静的の
validator1/validator2 のみ。動的コンテナへの考慮は不要。

### 各パッケージの作業分担

依存順序: collector → frontend（フロントはエッジ導出が既に `drivesNodeId`
汎用なので、collector が値を入れた時点でエッジ自体は現れる。文言の
出し分けはフロント作業）。並行着手も可能（フロントはモックデータで検証
できる）。

**collector**（`packages/collector/src/adapters/ethereum/`）:

1. `targets.ts`: `beaconStableIdForValidator(validator, observations)` を
   新設。`isValidatorService`（既存。`com.chainviz.role` ラベル厳密一致）で
   ガードし、validator 役でなければ即 undefined（`executionStableIdForBeacon`
   と同じ自己防衛）。本体は
   `findPairedStableId(validator, observations, isConsensusBeaconNode)`
2. `index.ts` の `resolveDrivesNodeId`:
   `executionStableIdForBeacon(...) ?? beaconStableIdForValidator(...)` の
   フォールスルーに変更（beacon と validator の候補集合は互いに素なので
   順序に意味は無い）
3. `nodeLinkActivity` は変更しない（validator 起点の活動観測は存在しない。
   配信しないのは意図した設計であり不具合ではない）
4. テスト: validator1↔beacon1 の対応付け、対応する beacon が無い場合の
   省略、validator 役でないコンテナへの即 undefined、プロジェクトスコープ
   （Issue #153 と同じ観点）

**frontend**（`packages/frontend/src/`）:

1. `entities/internalLinkEdge.ts`: `InternalLinkEdgeData` に端点の nodeRole
   （生文字列、optional）を追加し、`internalLinkEdgesToFlowEdges` で
   NodeEntity から詰める（エッジ導出ロジック自体は変更不要）
2. `chain-profiles/ethereum/internalLinkKinds.ts`（新設推奨。1ファイル1責務）:
   役割の組（driving→driven）→ {見出し・glossary キー・説明文言・活動
   セクション表示可否} のマッピング。consensus→execution は既存文言、
   validator→consensus は新文言 + 活動セクション非表示、未知の組は
   汎用見出し + アンカー無し + 活動非表示のフォールバック
   （`describeNodeRole` と同じ `Object.hasOwn` ガードの流儀に注意）
3. `entities/InternalLinkEdgePopover.tsx`: マッピングに従って見出し・説明を
   切り替え、`showsActivity` が false なら「直近の呼び出し」セクションを
   出さない（「最近の呼び出しはありません」を常時出すのは誤情報になる）
4. `entities/infraNode.ts` + InfraPopover: validator カードに「接続先の
   beacon ノード」行、beacon カードの駆動元行のラベルを駆動元の nodeRole で
   選ぶ形に一般化（逆引き索引に nodeRole も載せる）。beacon は「駆動する
   実行ノード」（reth）と合わせて関連行が 2 行になる
5. `i18n/messages.ts`: 新規キー（初稿は ARCHITECTURE.md §7.6.11 の表。
   キー名・語調は実装時に既存命名へ合わせて調整可）
6. `glossary/ethereum/terms/d-internal.yaml`: `beacon-api` を新設
   （定義の 3 拍子・アンカー・relatedTerms は §7.6.11 参照）。英語定義は
   chainviz-i18n のレビュー対象

**node-env**: 変更なし（VC の API/メトリクス有効化はしない。実測観測に
切り替えたくなったら別 Issue で 3 点セットとして設計する）。

### 決定済みとして前提にしてよいこと

- `drivesNodeId` 再利用・静的解決・活動パルス無し・見た目は既存内部リンクと
  同一・文言は役割の組で切り替え（未知の組はフォールバック）
- shared の型構造は変更しない（docstring のみ更新済み）

### 実装時に判断してよいこと

- i18n キーの命名・文言の語調（構成・意味を変える変更は不可）
- `internalLinkKinds.ts` の具体的なデータ構造（Map かオブジェクトか等）
- InfraPopover の行の並び順

### まだ決めていないこと（今回のスコープ外）

- VC→beacon の呼び出し活動の実測（VC の HTTP API/メトリクス有効化が必要。
  やるならノード環境テンプレート・アダプタ・表現セットの 3 点に跨がる
  別 Issue）
- E2E（UI 層）シナリオの追加要否は実装時に `packages/e2e/SCENARIOS.md` の
  運用ルール（PLAN.md「運用ルール」参照）に従って判断する

### 2026-07-11 Issue #285 collector 実装方針確認メモ

- 担当: collector
- ブランチ: issue-285-validator-beacon-link
- 設計メモ・ARCHITECTURE.md §7.3 / §7.6.11 を読んだ上での実装方針（設計の
  決定事項からの逸脱なし。範囲確認のみ）:
  1. `targets.ts` に `beaconStableIdForValidator(validator, observations)` を
     `executionStableIdForBeacon` の直後に追加する。実装は
     `isValidatorService(validator)` でガードし、false なら即
     `undefined`。本体は `findPairedStableId(validator, observations,
     isConsensusBeaconNode)`（`isConsensusBeaconNode` は既存の非公開関数を
     そのまま再利用でき、新設不要）
  2. `index.ts` の `resolveDrivesNodeId` を
     `executionStableIdForBeacon(obs, observations) ??
     beaconStableIdForValidator(obs, observations)` のフォールスルーに変更。
     両者の対象コンテナ集合は互いに素（beacon 役 vs validator 役）なので
     判定順に意味は無く、片方が undefined を返したらもう片方を試すだけで
     安全
  3. `nodeLinkActivity` 側は変更しない（設計メモの決定どおり、validator 起点の
     活動観測は存在しないため配信しない）
  4. テストは `targets.test.ts` に `beaconStableIdForValidator` の
     describe ブロックを `executionStableIdForBeacon` のブロックに倣って
     追加する（validator1↔beacon1 の対応付け・対応する beacon が無い場合の
     省略・validator 役でないコンテナへの即 undefined・プロジェクトスコープ
     の分離を確認）。`index.test.ts` 側は `resolveDrivesNodeId` の既存
     テストに、validator→beacon の解決が反映されるケースを追加する

### 2026-07-11 Issue #285 collector 実装記録

- 担当: collector
- ブランチ: issue-285-validator-beacon-link
- 実施内容: 上記の実装方針どおりに `packages/collector/src/adapters/ethereum/`
  へ実装した。設計・実装方針からの逸脱は無い。
  - `targets.ts`: `beaconStableIdForValidator(validator, observations)` を
    `executionStableIdForBeacon` の直後に新設。`isValidatorService` で
    ガードし、本体は既存の `findPairedStableId(validator, observations,
    isConsensusBeaconNode)` を呼ぶだけの薄いラッパー（新規ロジック無し）
  - `index.ts`: `resolveDrivesNodeId` の解決式を
    `executionStableIdForBeacon(obs, observations) ??
    beaconStableIdForValidator(obs, observations)` のフォールスルーに変更。
    JSDoc コメントも Issue #285 を追記して更新
  - テスト: `targets.test.ts` に `beaconStableIdForValidator` の
    describe ブロック（6 件。validator1↔beacon1 の対応付け・ノード群の
    取り違え防止・validator 役でないコンテナ（beacon/execution/workbench）
    への即 undefined・プロジェクトスコープの分離・観測が空の場合）を追加。
    `index.test.ts` にも `EthereumAdapter.pollInfra drivesNodeId resolution
    for validator→beacon (Issue #285)` の describe ブロック（4 件。
    pollInfra 経由での validator→beacon 解決・既存の beacon→execution
    解決への非干渉・対応する beacon が無い場合の省略・
    `com.chainviz.role` ラベルの無いフィクスチャでの後方互換確認）を追加。
    既存の `validatorFixture`（ラベル無し）はそのまま残し、ラベル付きの
    `validatorWithRoleFixture` を新設して使い分けた（既存テストの前提を
    壊さないため）
  - 回帰検出の確認: `resolveDrivesNodeId` のフォールスルーを一時的に
    `executionStableIdForBeacon` のみに戻し、新設した
    `index.test.ts` のテストが実際に失敗する（`expected undefined to be
    'chainviz-ethereum/beacon1'`）ことを確認してから実装を元に戻した
  - `pnpm --filter @chainviz/collector build && pnpm --filter
    @chainviz/collector test` を実行し、46 ファイル 1265 テストすべて通過
  - 実環境検証: `profiles/ethereum` で `docker compose up -d` してスタックを
    起動し、collector（`CHAINVIZ_COLLECTOR_PORT=4100` で別ポート起動、
    既存の別プロセスとの port 競合を避けた）の WebSocket スナップショットを
    直接取得して確認した。`validator1.drivesNodeId ===
    "chainviz-ethereum/beacon1"`、`validator2.drivesNodeId ===
    "chainviz-ethereum/beacon2"` を確認。reth1/reth2（execution）は
    drivesNodeId を持たない（駆動される側であり駆動する側ではないため）。
    addNode で追加されたフォロワー（reth3/beacon3 ペア、他セッションの
    検証作業による副産物）には validator が無く、既存の beacon3→reth3 の
    解決のみが効いていて validator 関連の追加解決が無いことも確認できた
    （設計メモどおり「addNode のフォロワーは validator 無し」の前提と一致）
- 申し送り: frontend 側（`InternalLinkEdgeData` への `nodeRole` 追加・
  `internalLinkKinds.ts` 新設・ポップオーバー文言切り替え・
  `beacon-api` 用語新設）は別担当が引き続き対応する。collector 側の
  `NodeEntity.drivesNodeId` 解決はこの実装で完結している
### 2026-07-11 実装着手前の方針確認（frontend）

- 担当: frontend
- ブランチ: `issue-285-validator-beacon-link-frontend`（collector 担当が
  `issue-285-validator-beacon-link` を同時に使用中のため、設計メモに
  記載の前例（Issue #274）に倣い分岐。マージ時に統括が cherry-pick で
  合流する）

実装ファイル構成（1ファイル1責務を踏まえた分割）:

1. `entities/internalLinkEdge.ts`: `InternalLinkEdgeData` に
   `drivingNodeRole?: string` / `drivenNodeRole?: string` を追加し、
   `internalLinkEdgesToFlowEdges` で駆動する側・される側それぞれの
   `NodeEntity.nodeRole` を詰める（値渡しのみ、解釈はしない）。
2. `chain-profiles/ethereum/internalLinkKinds.ts`（新設）: 役割の組
   （駆動する側→される側）→ 見出し・見出しの GlossaryTerm キー・説明文・
   活動セクション表示可否のマッピングを持つ
   `describeInternalLinkKind(drivingNodeRole, drivenNodeRole)` を提供する
   （`nodeRoles.ts` の `describeNodeRole` と同じ「マッピングに無い組は
   フォールバックへ倒す」流儀。ARCHITECTURE.md §7.6.11 の表の3行
   （consensus→execution / validator→consensus / それ以外・不明）を
   そのままテーブル化する）。
   InfraPopover の「駆動する実行ノード」「駆動元（合意ノード）」行の
   ラベル選択は、上記の役割組マッピングとは別に、専用のヘルパー
   `describeDrivesField(ownNodeRole)` / `describeDrivenByField(drivingNodeRole)`
   を同ファイルに置く。**この2つは「role 不明時はフォールバックで隠す」
   ではなく「validator のときだけ新表現、それ以外（consensus・不明を
   含む）は既存の engine-api 表現を既定にする」**方式にする。理由:
   相手ノードの role まで完全なペアが揃わないと行ごと消える設計にすると、
   既存の drivesNode/drivenBy 行が「role 未設定の旧スナップショットでは
   出ない」という新たな退行を生む（既存テストが多数この前提で書かれて
   いる）。エッジポップオーバー側（`describeInternalLinkKind`）は逆に
   「情報が無ければ汎用表現に倒す」という ARCHITECTURE.md 表どおりの
   3行フォールバックを厳密に実装する（エッジ自体・端点名は role に
   関係なく常に見えるため、見出し・活動セクションが汎用化しても実害が
   小さい）。この非対称は意図的な設計判断であり、実装時に統一しない。
3. `entities/InternalLinkEdgePopover.tsx`: `drivingNodeRole`/
   `drivenNodeRole` を受け取り `describeInternalLinkKind` の結果で
   見出し・説明・活動セクション表示を切り替える。
4. `entities/InternalLinkEdge.tsx`: `data.drivingNodeRole`/
   `data.drivenNodeRole` を `InternalLinkEdgePopover` へ橋渡しするだけ
   （ロジックを持たない）。
5. `entities/infraNode.ts`: 駆動元逆引き索引に nodeRole も載せ、
   `InfraNodeData.drivenByNodeRole` として渡す（`drivesNodeContainerName`
   側は entity 自身の `nodeRole` が既に InfraPopover で参照可能なので
   新規フィールド不要）。
6. `entities/InfraPopover.tsx`: `drivesFieldDescriptor` /
   `drivenFieldDescriptor` を計算し、既存のハードコードされた
   `field.drivesNode`/`field.drivenBy` + `engine-api` 固定を置き換える。
7. `i18n/messages.ts`: `edge.internalLinkValidator` /
   `edge.internalLinkGeneric`（フォールバック見出し）/
   `internalEdge.validatorPair` / `internalEdge.genericPair`
   （フォールバック説明文）/ `field.connectsToBeacon` /
   `field.validatorClient` を追加。
8. `glossary/ethereum/terms/d-internal.yaml`: `beacon-api` を新設。
   `a-infra.yaml` の `validator`/`cl-client` と `d-internal.yaml` の
   `engine-api` の `relatedTerms` に `beacon-api` を追記する（逆リンク）。

影響範囲の確認: 既存の内部リンク関連テスト（
`InternalLinkEdgePopover.test.tsx` 等）は nodeRole 未指定のフィクスチャで
書かれており、role 不明時にフォールバック表現へ切り替わる新仕様の下では
文言が変わる。これらは実運用（Issue #215 で全 Ethereum サービスに
`nodeRole` ラベルが付く）を反映して `drivingNodeRole="consensus"` /
`drivenNodeRole="execution"` を明示するよう更新し、role 不明時の
フォールバック自体は別途新規テストで固定する。

### 2026-07-11 実装完了（frontend）

方針確認どおりに実装した。主な変更点:

- `entities/internalLinkEdge.ts`: `InternalLinkEdgeData` に
  `drivingNodeRole?`/`drivenNodeRole?` を追加し、
  `internalLinkEdgesToFlowEdges` が駆動する側・される側それぞれの
  `NodeEntity.nodeRole` をそのまま値渡しするようにした。
- `chain-profiles/ethereum/internalLinkKinds.ts`（新設）:
  `describeInternalLinkKind(drivingNodeRole, drivenNodeRole)` で
  consensus→execution / validator→consensus / それ以外（フォールバック）
  の3パターンの見出し・説明文・活動セクション表示可否を解決する。
  `describeDrivesField`/`describeDrivenByField` は InfraPopover の
  「駆動する/される」行専用のヘルパーで、方針確認メモに記載した
  非対称フォールバック（validator のときだけ新表現、それ以外は既存の
  Engine API 表現を既定にし行を隠さない）を実装した。
- `entities/InternalLinkEdgePopover.tsx`: 見出し・説明文・活動セクションを
  `describeInternalLinkKind` の結果に応じて出し分けるよう書き換えた。
  見出しにアンカーが無い場合（フォールバック）は `GlossaryTerm` を使わず
  プレーンテキストで見出しを出す。
- `entities/InternalLinkEdge.tsx`: `data.drivingNodeRole`/`drivenNodeRole`
  を `InternalLinkEdgePopover` へそのまま橋渡しするだけの変更。
- `entities/infraNode.ts`: 駆動元逆引き索引（`drivenByContainerNameByTargetId`）
  に加えて `drivenByNodeRoleByTargetId` を新設し、
  `InfraNodeData.drivenByNodeRole` として渡すようにした。
- `entities/InfraPopover.tsx` / `entities/InfraNodeCard.tsx`:
  「駆動する◯◯ノード」「駆動元（◯◯ノード）」行のラベル・GlossaryTerm
  キーを `describeDrivesField`/`describeDrivenByField` の結果に置き換えた。
  `drivenByNodeRole` を新しい prop として追加し、`InfraNodeCard` から
  そのまま橋渡しするよう配線した。
- `i18n/messages.ts`: `edge.internalLinkValidator` /
  `edge.internalLinkGeneric`（フォールバック見出し） /
  `internalEdge.validatorPair` / `internalEdge.genericPair`
  （フォールバック説明文） / `field.connectsToBeacon` /
  `field.validatorClient` を追加した。
- `glossary/ethereum/terms/d-internal.yaml`: `beacon-api` を新設した
  （英語定義は初稿。chainviz-i18n のレビュー対象）。
  `glossary/ethereum/terms/a-infra.yaml` の `validator`/`cl-client` と
  `d-internal.yaml` の `engine-api` の `relatedTerms` に `beacon-api` へ
  の逆リンクを追記した。
- `websocket/mockData.ts`: `validatorNode` に
  `drivesNodeId: "lighthouse-1"` を追加し、validator→beacon の内部リンク
  エッジ・文言切り替え・活動セクション非表示をオフラインでも確認できる
  ようにした（validator-1/validator-2 とも既定モックに存在する唯一の
  beacon である lighthouse-1 を指す fan-in構成。既存の
  `internalLinkEdgesToFlowEdges` はこの構成を独立した複数エッジとして
  正しく描画できることをテストで確認済み）。

テスト:

- `entities/internalLinkEdge.test.ts`: nodeRole の伝搬・省略時の挙動を
  追加。
- `chain-profiles/ethereum/internalLinkKinds.test.ts`（新設）:
  `describeInternalLinkKind`/`describeDrivesField`/`describeDrivenByField`
  の3パターン・フォールバックを網羅。
- `entities/InternalLinkEdgePopover.test.tsx`: 既存テストを
  `drivingNodeRole="consensus"`/`drivenNodeRole="execution"` を明示する
  形に更新し、validator→consensus・フォールバックそれぞれの新規
  describe ブロックを追加（活動セクションが完全に非表示になることを
  含む）。
- `entities/InfraPopover.test.tsx` / `entities/infraNode.test.ts`:
  `drivenByNodeRole` の伝搬・validator 側の行ラベル切り替え・
  role 不明時に行が消えないことを追加。
- `app/App.internalLinkValidator.test.tsx`（新設）: モッククライアント
  経由で `App` を実際にマウントし、validator-1→lighthouse-1 の内部
  リンクエッジが現れること、validator-1 のポップオーバーに
  「接続先の beacon ノード」行が出ること（consensus→execution 用の
  「駆動する実行ノード」は出ないこと）を確認する。

検証: `pnpm build`（`tsc -b` と `vite build` の両方）・`pnpm test`
（frontendパッケージ全体、123ファイル/1922テスト）・`pnpm eslint`
（変更ファイルのみ）が全て通ることを確認した。

引き継ぎ事項:

- collector 側（`targets.ts`/`index.ts` の `resolveDrivesNodeId`）は
  `issue-285-validator-beacon-link` ブランチで並行実装中。マージ時は
  設計メモに記載のとおり統括が cherry-pick で合流する想定。
- frontend 側だけでは `docs/PLAN.md` のチェックボックス（Issue #285は
  collector/frontend合わせて1項目）は完了とみなせないため、今回は
  チェックを付けていない。collector 側の実装完了・両ブランチの合流後に
  更新すること。
- 英語の glossary 定義（`beacon-api`）・i18n 文言は初稿であり、
  chainviz-i18n のレビューが必要（設計メモに記載済み）。

### 2026-07-11 テスト強化（エッジケース・異常系・境界値）

- 担当: tester
- ブランチ: issue-285-validator-beacon-link（collector/frontend の合流後の続き）
- collector/frontend の実装担当が書いた基本テストを土台に、以下の観点で
  テストを追加した。実装ロジックは変更していない（テストファイルのみ）。

collector `packages/collector/src/adapters/ethereum/targets.test.ts`
（`beaconStableIdForValidator` の describe に3件追加）:

- 複数 validator の取り違え防止: validator1↔beacon1 と validator2↔beacon2 が
  同時に存在する状況で、ノード群キーで正しく分岐し取り違えないことを固定。
- 後方互換: compose サービス名が "validator1" でも `com.chainviz.role`
  ラベルが無い旧スナップショットでは VC と見なさず undefined を返す（既存の
  非-VC 判定を壊さず、ラベル導入前の観測に誤リンクを生やさない）。
- 候補フィルタ: ノード群キー "1" は一致するが beacon 位置のコンテナが
  consensus クライアントでない（reth プロセス）場合、`isConsensusBeaconNode`
  で弾かれ対応付けない。キー一致だけでなく候補フィルタも効いていることを固定。

collector `packages/collector/src/adapters/ethereum/index.test.ts`
（`resolveDrivesNodeId`（validator→beacon）の describe に2件追加。
`validator2WithRoleFixture` を新設）:

- フルトポロジの取り違え防止: reth1/beacon1/validator1 と reth2/beacon2/
  validator2 が同時に存在する状況で、validator→beacon・beacon→execution の
  両解決が 1↔2 を取り違えないことを pollInfra 経由で固定。
- addNode フォロワー: validator 無しの reth3+beacon3 ペア（managed ラベル付き）
  を追加しても、beacon3→reth3 の既存解決のみが張られ、validator 起点の
  誤リンクが生えないこと・静的 validator1↔beacon1 が維持されることを固定
  （設計メモ「addNode のフォロワーは validator 無し」の前提の回帰テスト）。

frontend `packages/frontend/src/chain-profiles/ethereum/internalLinkKinds.test.ts`
（非対称フォールバックの describe を新設。空文字列の境界1件も追加）:

- 意図的な非対称の固定: 相手ノードの role が不明な同一状況において、
  エッジ見出し用の `describeInternalLinkKind` は汎用フォールバックへ倒す
  一方、InfraPopover 行用の `describeDrivesField`/`describeDrivenByField` は
  validator 固有のラベルを保ち行を隠さないことを対比で固定。両者を同じ
  「厳密ペア一致」ロジックに統一する退行を検出する。consensus 側でも
  同様にフィールドは既存 Engine API 表現を保つことを併せて確認。
- `describeDrivenByField("")` が空文字列を未マッピング扱いにし engine-api
  フィールドを保つ境界を固定。

回帰検出の確認（意図的に実装を壊して新テストが検出することを確認後、元に戻した）:

- `beaconStableIdForValidator` の `isValidatorService` ガードを外す → 後方互換
  テスト（targets/index）が失敗。
- 候補フィルタを `isConsensusBeaconNode` から `isBeaconService` に緩める →
  候補フィルタテストが失敗。
- `findPairedStableId` のノード群キー一致判定を無効化 → 取り違え防止テスト
  （targets/index の crosstalk）が失敗。
- `describeDrivesField` を `describeInternalLinkKind` の厳密フォールバックに
  統一 → 非対称テストが失敗。

検証: `pnpm --filter @chainviz/collector build && test`（46ファイル/1270
テスト）、`pnpm --filter @chainviz/frontend build && test`（123ファイル/
1925テスト）が全て通過。追加分は collector +5・frontend +3。
