### 2026-07-08 Issue #188 内部リンクエッジ(beacon→reth)の常設描画とnodeLinkActivityの活動パルス 設計メモ
- 担当: frontend
- ブランチ: issue-188-internal-link-pulse

#### 実装前の設計方針

ARCHITECTURE.md §7.6.3（内部リンクエッジ）・§7.6.4（活動パルス）・§7.6.7
（Engine API メソッド分類ラベル）を実装可能な単位に分解する。既存の類似実装
との対応は以下のとおり:

| 要件 | 対応する既存実装（参考にした流儀） |
| --- | --- |
| 常設エッジをエンティティのフィールドから導出 | `deployEdge.ts`（`ContractEntity.deployerAddress` から常設エッジを導出。ダングリングガード含む） |
| ホバーで太くなる + ポップオーバー | `DeployEdge.tsx` / `PeerPropagationEdge.tsx` の hover state 注入パターン（`Canvas.tsx` がホバー中の edge id を突き合わせて `data.hovered` を注入） |
| 1観測1本の揮発パルスを永続エッジに乗せる | `blockPulse.ts` の `attachPulsesToEdges`（永続エッジ + 揮発パルスの合成）。`useOperationPulses`/`useContractSettlementEffects` のような「エッジ自体も揮発」パターンとは異なる（内部リンクは常設なので、こちらのほうが構造として近い） |
| WebSocket 経由の揮発イベントをフックへ渡す経路 | `useWorldState.ts` の `operations`（`OperationSignal[]`、`extractOperations`）と同型に `nodeLinkActivities`（`NodeLinkActivitySignal[]`、`extractNodeLinkActivities`）を追加 |
| チェーン固有語彙（Engine API メソッド名）の解釈 | `chain-profiles/ethereum/operationCatalog.ts` と同じ置き場所に `nodeInternals.ts` を新設 |

#### コンポーネント構成（新規ファイル）

- `entities/internalLinkEdge.ts`: `NodeEntity[]`（`drivesNodeId` 保有）から
  常設エッジ（`InternalLinkFlowEdge`）を導出する純粋関数群。エッジ ID は
  `internal-link-${fromNodeId}=>${toNodeId}`。ダングリングガード（駆動元・
  駆動先の両方が現在キャンバス上に存在する場合のみ描く）は `deployEdge.ts`
  と同じ考え方。パルス・直近活動の合成（`attachInternalLinkActivity`）も
  ここに置く（`blockPulse.ts` の `attachPulsesToEdges` と同型）。
  スクレイプ間隔・鮮度判定の定数もここに置く:
  - `INTERNAL_LINK_POLL_INTERVAL_MS = 3000`: collector 側
    `packages/collector/src/adapters/ethereum/reth-metrics-tracker.ts` の
    `NODE_INTERNALS_POLL_INTERVAL_MS` と同じ値であることが前提（frontend は
    collector パッケージに依存しないため、値のみをコピーして持ち、コメントで
    出典と「値がずれたら両方直すこと」を明記する）。
  - `INTERNAL_LINK_FRESHNESS_MS`: `INTERNAL_LINK_POLL_INTERVAL_MS * 3 + 1000`
    として導出する（ARCHITECTURE.md §7.6.3「スクレイプ間隔3秒の3回分+余裕」を
    そのままコードにする。固定値を直接埋め込まず、ポーリング間隔定数からの
    計算式にすることで、間隔定数を変更したときに鮮度判定が追従する）。
- `entities/useNodeLinkActivityPulses.ts`: `nodeLinkActivities`（揮発イベント
  列）を監視し、(1) 対応する常設エッジへ1本のパルスを追加してタイマーで消し、
  (2) エッジごとの「直近観測」（ポップオーバー用）を更新するフック。
  `useOperationPulses.ts` と同じ「seq 重複排除 + タイマー管理」の構造。
  対応する常設エッジが無い（端点がキャンバス上に無い）観測は無視する
  （§7.4 ダングリングガード。store には畳み込まない）。
- `entities/InternalLinkEdge.tsx`: カスタムエッジ本体。二重線は「同じ
  ベジェパスに、太く低不透明度の sheath（`BaseEdge`）+ 細く高不透明度の
  core（追加の `<path>`）を重ねる」ことで表現する（オフセットパスをずらす
  実装ではない。§7.6.3 の「重ねて描く」という記述どおり）。パルスは
  `PeerPropagationEdge`/`ContractCallPulseEdge` と同じ `offset-path` 走行
  （常に source→target 方向固定、`reverse` 相当のフラグ不要。§7.6.4「進行
  方向は CL→EL 固定」であり、内部リンクエッジの source は常に駆動側=CL の
  ため）。ホバー中は sheath/core 双方を太くし、`EdgeLabelRenderer` で
  `InternalLinkEdgePopover` を表示する。
- `entities/InternalLinkEdgePopover.tsx`: 見出し（`GlossaryTerm
  termKey="engine-api"`）・端点表記・説明文（`GlossaryTerm
  termKey="el-cl-separation"` を文中に埋め込む。3分割の i18n キーで実現。
  `peerEdge.ts`/`NetworkLabel.tsx` 側の `legend.hint.prefix/term/suffix` と
  同じ手法）・直近活動（鮮度切れなら「最近の呼び出しはありません」）を表示。
- `entities/internalLinkActivity.ts`: `InternalCallStats[]` を表示用文字列へ
  整形する純粋関数（`chain-profiles/ethereum/nodeInternals.ts` の分類ラベルを
  引き、メソッド名 ×回数（分類ラベル）（平均 x ms) の形に組み立てる）。
- `chain-profiles/ethereum/nodeInternals.ts`: ARCHITECTURE.md §7.6.7 の
  Engine API メソッド分類ラベル（前方一致）を静的データとして持つ。

#### データフロー

1. collector → WebSocket diff の `nodeLinkActivity` イベント（既存。Issue
   #186 で配線済み）。
2. `world-state/store.ts` に `extractNodeLinkActivities` を追加し、
   `extractOperations` と同じく worldState へは畳み込まない。
3. `world-state/useWorldState.ts` が `operations` と並列に `nodeLinkActivities:
   NodeLinkActivitySignal[]`（フロント側 seq 付与、上限キャップあり）を state
   として持ち、`commands/useCommands.ts` を素通りして `App.tsx` まで渡す。
4. `App.tsx`:
   - `nodeEntities`（既存）から `internalLinkEdgesToFlowEdges(nodeEntities,
     infraNodeIds)` で常設エッジの土台を作る。
   - `useNodeLinkActivityPulses(nodeLinkActivities, baseEdges)` でパルス +
     直近観測を合成した最終エッジ配列を得て、`edges` 配列へ連結する。
   - `entitiesToFlowNodes`（`infraNode.ts`）に `drivesNodeContainerName` を
     追加し、CL 側 `InfraPopover` に「駆動する実行ノード」行を出す（§7.6.3
     に明記された内部リンクエッジ設計の一部。`rpcTargetContainerName` と
     全く同じパターンで実装する）。
5. `Canvas.tsx`: `INTERNAL_LINK_EDGE_TYPE` を `edgeTypes` に登録し、ホバー
   状態の注入対象に追加する（`isPeerFlowEdge`/`isDeployFlowEdge` と同じ
   `isInternalLinkFlowEdge` 型ガードを使う）。

#### i18n key の扱い

ARCHITECTURE.md §7.6.8 の初稿は `internalEdge.pair` を1本の完成文として
定義しているが、文中に `GlossaryTerm(el-cl-separation)` を埋め込む必要が
あるため、既存の `legend.hint.prefix/term/suffix` 分割と同じ手法で
`internalEdge.pair.prefix` / `.term` / `.suffix` の3キーに分割する（意味・
文面は初稿を保ったまま、実装上の都合で分割するのみ。CLAUDE.md
「構成・意味を変える変更は不可、語調の微調整は裁量」の範囲内）。

分類ラベル・平均レイテンシの丸括弧は日英共通で半角 `()` に統一する（ARCHITECTURE
の和文例は全角括弧だが、実装をシンプルにするための微調整）。

#### 鮮度判定の実装上の制約（既知の限界）

鮮度（10秒）の判定は `Date.now()` を使い、ポップオーバーが**再レンダーされた
時点**の値で評価する。専用のティッカー（setInterval で強制再レンダー）は
設けない。理由: 既存のホバーポップオーバー（Peer/Deploy）もライブ更新の
仕組みを持たず、実環境では3秒間隔でノード内部の diff が届き App 全体が
再レンダーされるため、ホバーしたまま10秒待っても次の diff 到着時には
自然に最新の鮮度判定に更新される。専用タイマーを追加する複雑さに見合う
実害が今のところ無いと判断した（先回り実装をしない原則）。

#### mockData への追加

`packages/frontend/src/websocket/mockData.ts` に以下を追加する:
- 初期スナップショットの `lighthouseNode`（CL）に `drivesNodeId:
  "reth-node-1"` を追加し、内部リンクエッジ1本をオフラインで確認できる
  ようにする。
- `newFollowerNodePair` が返す beacon にも対応する reth の id を
  `drivesNodeId` として持たせる（addNode 後のペアでも内部リンクが張られる
  ことを確認できるようにする）。
- 定期 tick（`createMockClient` の `setInterval` コールバック内）で
  `nodeLinkActivity` の DiffEvent を1個ずつ流し、活動パルスをオフラインで
  目視確認できるようにする。

---

### 実装記録

- 内容: 上記設計どおりに実装した。追加・変更したファイルは以下:
  - 新規: `entities/internalLinkEdge.ts`（+test）、
    `entities/useNodeLinkActivityPulses.ts`（+test）、
    `entities/InternalLinkEdge.tsx`（+test）、
    `entities/InternalLinkEdgePopover.tsx`（+test）、
    `entities/internalLinkActivity.ts`（+test）、
    `chain-profiles/ethereum/nodeInternals.ts`（+test）
  - 変更: `world-state/store.ts`（`extractNodeLinkActivities`）、
    `world-state/useWorldState.ts`（`nodeLinkActivities` state 経路）、
    `commands/useCommands.ts`（素通し）、`entities/infraNode.ts`
    （`drivesNodeContainerName`）、`entities/InfraPopover.tsx`（「駆動する
    実行ノード」行）、`entities/InfraNodeCard.tsx`（prop 中継）、
    `canvas/Canvas.tsx`（edgeType登録・hover配線）、`app/App.tsx`（配線）、
    `i18n/messages.ts`、`styles.css`、`websocket/mockData.ts`
- 決定事項・注意点:
  - `INTERNAL_LINK_POLL_INTERVAL_MS`（3000ms）は collector 側
    `NODE_INTERNALS_POLL_INTERVAL_MS` と値を一致させる前提の frontend 側
    コピー。collector 側の値を変更する場合はこちらも合わせて変更すること
    （cross-package import ができないため、値の一致は運用で担保する。
    `entities/internalLinkEdge.ts` のコメントに明記済み）。
  - パルスの向きは常に「駆動側(CL)→駆動される側(EL)」固定。内部リンク
    エッジ自体の source が常に駆動側になるよう `internalLinkEdgesToFlowEdges`
    を実装しているため、`PeerFlowEdge` のような `reverse` フラグは持たない。
  - `InfraPopover` の「駆動する実行ノード」行は CL 側にのみ表示する（EL 側
    への逆方向の行は追加しない。ARCHITECTURE.md §7.6.3 の決定どおり）。
  - `pnpm --filter @chainviz/frontend build` / `test` が通ることを確認済み。

---

### 検証・修正記録(WSLクラッシュからの再開)

前回セッションがWSLクラッシュで中断した時点で、`App.internalLink.test.tsx`
が2件とも失敗していた。原因調査と修正内容は以下のとおり。

- **1件目の原因**: `screen.getByText("chainviz-reth-1")` が2箇所にマッチして
  いた。`reth-node-1` カード自身の見出し(`infra-card__name`)と、
  `lighthouse-1` カードのポップオーバー内「駆動する実行ノード」欄の両方に
  同じ文字列が表示されるため。実装側の問題ではなくテストのクエリが
  広すぎたのが原因。`within(card)` で `lighthouse-1` カードの範囲に絞る形へ
  修正した。
- **2件目の原因**: `container.querySelector(".internal-link-edge")` が常に
  `null` になっていた。これはテストの選定ミスというより、React Flow
  (`@xyflow/react`)を jsdom 上でエッジまで描画させるための前提条件が
  揃っていなかったことが原因(実装のバグではない)。具体的には:
  1. jsdom には `ResizeObserver` が無いため、他の既存テスト
     (`App.workbenchOperations.test.tsx`)と同様 no-op スタブで補っていたが、
     no-op のままだと `@xyflow/react` がノードの `measured`/`handleBounds`
     を一切確定できず、エッジの端点座標が常に `null` になり
     `EdgeWrapper` がエッジ自体を描画しない(内部リンクエッジに限らず
     全エッジが対象)。
  2. `@xyflow/system` の `updateNodeInternals` は `node.offsetWidth` /
     `offsetHeight`(jsdom では常に `0`。jsdom はレイアウト計算をしない)の
     両方が真値でない限り測定結果を確定させないガードがあり、
     `HTMLElement.prototype.offsetWidth`/`offsetHeight` を固定値でスタブ
     しない限り `ResizeObserver` のコールバックを発火させても意味がない。
  3. jsdom には `DOMMatrixReadOnly` も無く、`updateNodeInternals` がビュー
     ポートの CSS `transform` から現在のズーム倍率を読むために使うため、
     `m22 = 1`(等倍)を返す最小限のスタブが必要。
  - 対応として `App.internalLink.test.tsx` の `beforeAll` に
    `offsetWidth`/`offsetHeight`/`DOMMatrixReadOnly` のスタブを追加し、
    `ResizeObserver` のコールバックをノードマウント時に1回発火させる
    スタブへ差し替えた。この対応はエッジの描画有無まで検証する
    このファイル固有の要件であり、既存の `App.workbenchOperations.test.tsx`
    (エッジの描画有無を検証しない)には影響しない。
  - 上記調査の過程で「本当に jsdom の制約が原因で、実装側のバグでは
    ないか」を切り分けるため、一時的なデバッグ用テストファイル
    (git管理外、作業完了後に削除済み)で `.react-flow__edges` の中身や
    ノードの `style` 属性(`visibility: hidden` のまま固定されている
    こと)を直接ダンプして原因を特定した。
- **実装側の変更は無し**。上記はすべてテストファイル
  (`App.internalLink.test.tsx`)側の修正であり、`InternalLinkEdge.tsx` /
  `internalLinkEdge.ts` / `useNodeLinkActivityPulses.ts` /
  `InternalLinkEdgePopover.tsx` 等の実装ファイルは変更していない。
- **実装内容の再確認**: `docs/ARCHITECTURE.md` §7.6.3(内部リンクエッジ)・
  §7.6.4(活動パルス)・§7.6.9(glossary)と実装を突き合わせ、以下を確認した:
  - 二重線(鞘+芯)・無彩色シルバー(`--internal-edge: #c9d4e8`)・矢印なし・
    ホバーで太くなる・ポップオーバー(見出し/端点/EL-CL分離の説明文/直近
    呼び出しのメソッド別内訳)・CL側ポップオーバーの「駆動する実行ノード」
    行・ダングリングガードが、すべて設計どおり実装されていることを
    コード上で確認した。
  - パルスは1観測1本、進行方向はCL→EL固定、専用の到達演出を追加しない
    (既存のブロック高更新・伝播発光の時間的一致に委ねる)という決定も
    実装(`useNodeLinkActivityPulses.ts`・`internalLinkEdge.ts`)どおり
    だった。
  - `chain-profiles/ethereum/nodeInternals.ts` のEngine APIメソッド分類
    ラベルは §7.6.7 の表と完全に一致していることを確認した。
  - glossary(`glossary/ethereum/terms/d-internal.yaml`)は既にIssue #190で
    追加済みであり、`engine-api`/`el-cl-separation` の参照(`GlossaryTerm`)
    が正しく配線されていることを確認した(このIssueのスコープはglossary
    データ自体の追加ではなく参照配線)。
  - 同期ステージ(§7.6.5)・txpool内訳(§7.6.6)はIssue #189のスコープであり、
    本Issueでは未実装のままで正しい(`docs/PLAN.md` ステップ9の担当分割
    どおり)。
- **実機確認**: このリポジトリの実行環境では Playwright の Chromium が
  システム共有ライブラリ不足(`libnspr4.so` 等)により起動できず(`apt-get`
  にはパスワード入力が必要でサンドボックスから実行不可)、ブラウザでの
  確認は行えなかった。代わりに `@testing-library/react` ベースで、モック
  クライアントの周期tick(`intervalMs`を指定して実際の`setInterval`を
  動かす)を使い、以下を実際に動かして確認した(確認用コードはテスト
  スイートには追加せず、確認後に削除済み):
  - 内部リンクエッジが常設で描画される(`.internal-link-edge`)
  - モックの`nodeLinkActivity`周期tickにより活動パルスが実際に現れる
    (`.internal-link-pulse`)
  - エッジへのホバーでポップオーバーが表示され、見出し・端点表記・
    EL/CL分離の説明文・直近呼び出しの内訳(`engine_newPayloadV4 ×1
    (ブロックの実行依頼) (平均 8 ms) · engine_forkchoiceUpdatedV3 ×1
    (チェーン先端の更新) (平均 4 ms)`)が実際にDOMへ出力されることを
    確認した。
- **確認済みコマンド**: `pnpm --filter @chainviz/frontend build` /
  `pnpm --filter @chainviz/frontend test`(83 test files / 1287 tests、
  全通過)、`pnpm -r build`(shared/collector/frontend/e2e すべて成功)、
  `pnpm lint`(ルートのeslint、エラーなし)。
- **次の担当への注意点**: React Flow をjsdom上で「エッジの描画有無」まで
  検証したい場合は、`ResizeObserver`のno-opスタブだけでは不十分で、この
  ファイルに追加した3点(offsetWidth/offsetHeight固定値・ResizeObserver
  コールバック発火・DOMMatrixReadOnlyスタブ)が必要になる。今後同様の
  End-to-End的なエッジ描画確認をする場合は、このテストファイルの
  `beforeAll`を参考にできる。

---

### テスト強化記録(異常系・境界値の追加)

実装担当が書いた基本テスト(ハッピーパス中心)に対し、エッジケース・
異常系・境界値の観点で以下のテストを追加した。実装ロジックの変更は
行っていない。

- `entities/internalLinkEdge.test.ts`(+2件):
  - fan-in(複数のCLが同じELを`drivesNodeId`で指す)。型上あり得る構成で、
    エッジidが駆動元ごとに分かれて衝突せず、2本が独立して張られることを確認。
    fan-out(1つのCLが複数ELを駆動)は`drivesNodeId`が単一フィールドのため
    型上表現できないことも併記。
  - `attachInternalLinkActivity`の複数エッジ横断での取り違え防止。2ペアの
    実エッジを土台に、片方にだけパルス・もう片方にだけ直近観測を与えても
    混線しないことを確認。
- `entities/useNodeLinkActivityPulses.test.tsx`(+3件):
  - 複数エッジ同時存在時のパルス混線防止。edge Aへの観測がedge Bに漏れず、
    直近観測(observedAt)もエッジごとに独立して保持されることを確認。
  - 新着ノードの発光と同時に観測が届き、まだ内部リンクエッジが無い場合の
    挙動。ダングリングで無視された同一seqの観測は、後でエッジが出現しても
    遡って発火しない(seen済みのため取りこぼしはリカバリしない)ことを固定。
  - `calls`が空配列の観測でもパルスを1本出す防御的挙動を固定(実運用では
    collector側が`calls.length===0`で送信を打ち切るため通常は起こらない)。
- `entities/InternalLinkEdgePopover.test.tsx`(+2件):
  - 未来日時の観測(クロックスキュー)を鮮度切れ扱いにしない境界を確認。
  - 鮮度切れ表示の判定が`observedAt`の新しさだけで決まり、`calls`が空でも
    「最近の呼び出しはありません」に倒れないことを確認。
- 確認コマンド: `pnpm --filter @chainviz/frontend test`(83 test files /
  1294 tests、全通過)、`pnpm --filter @chainviz/frontend build`、
  `pnpm -r build`(shared/collector/frontend/e2e すべて成功)。
- 実装バグらしきものは検出されなかった。ダングリングガード・自己参照回避・
  fan-in・鮮度判定・パルスの隔離はいずれも設計どおりに動作している。

---

### レビュー記録(chainviz-reviewer)

コードを読んでの静的レビューと `pnpm lint` / `pnpm build` / `pnpm test` の
実行により確認した。判定は**合格**(実機での動作検証は chainviz-qa に委ねる)。

- **確認したコマンド**: リポジトリ全体で lint(エラーなし)・build(shared/
  collector/e2e/frontend すべて成功)・test(shared 58 / e2e 34 / collector
  1058 / frontend 1294、全通過)。
- **ARCHITECTURE.md §7.6.2〜§7.6.4・§7.6.10 との整合**: 以下をコード上で
  突き合わせて確認した。
  - 無彩色シルバー(`--internal-edge: #c9d4e8`)の二重線(鞘 6px/0.18 +
    芯 1.5px/0.8 を同一ベジェパスへ重ね描き)、矢印なし、ホバーで鞘・芯
    双方が太くなる(§7.6.3・決定事項4)。
  - パルスは1観測1本(`useNodeLinkActivityPulses` が signal 1件につき
    パルス1個のみ生成)、進行方向は CL→EL 固定(source が常に駆動側で
    `reverse` 相当のフラグ自体が存在しない)、専用の到達演出なし(§7.6.4・
    決定事項2)。
  - 鮮度判定 10 秒は `INTERNAL_LINK_POLL_INTERVAL_MS * 3 + 1000` の計算式で
    導出されており、決め打ちの 10000 埋め込みではない(品質ゲート運用
    ルールの「固定値は前提条件込みで明記」も、collector 側定数との一致
    前提としてコメント・worklog 両方に明記済み)。
  - CL 側 InfraPopover の「駆動する実行ノード」行のみ追加、EL 側への
    逆方向行なし(§7.6.3)。
  - 表示切り替え・フィルタの類は追加されていない(§7.6.2・決定事項1)。
  - Engine API 分類ラベル(`nodeInternals.ts`)は §7.6.7 の表と一致。
    チェーン固有語彙(engine_*)の解釈は chain-profiles 配下に閉じており、
    world-state スキーマ・共有型への漏れはない(ChainAdapter 境界)。
  - i18n の `internalEdge.pair` 3分割は GlossaryTerm 埋め込みのための
    実装上の分割で、文面は §7.6.8 初稿を保っている。妥当と判断。
- **境界の遵守**: frontend から collector への import はなく、`3000ms` の
  値コピーには出典と同期の注意コメントがある。データフローは
  `extractNodeLinkActivities`(store) → `useWorldState`(seq 付与・100件
  キャップ) → `useCommands`(素通し) → `App` → フックの一方向で、
  `operations` と同じ経路分離の流儀どおり。
- **ダングリングガード**: 常設エッジ導出(`internalLinkEdgesToFlowEdges`)で
  「起点が present に無い / 駆動先が present に無い / 駆動先がノード一覧で
  解決できない / 自己参照」の4パターンすべてをスキップし、揮発イベント側
  (`useNodeLinkActivityPulses`)でも対応エッジ不在の観測を無視する。両方に
  テストがある。
- **fan-in 構成**: エッジ id が `internal-link-<from>=><to>` と駆動元を含む
  ため、複数 CL が同一 EL を指しても id 衝突しない。設計として妥当。
  tester 追加のテストで固定済み。
- **jsdom テスト環境の工夫(App.internalLink.test.tsx)**: offsetWidth/
  offsetHeight 固定値・ResizeObserver コールバック発火・DOMMatrixReadOnly
  の3スタブは、React Flow のエッジ描画有無を jsdom で検証するための必要
  最小限で、理由がコメントに詳述されている。スタブはファイルローカルの
  `beforeAll` で定義され、vitest は既定でテストファイルごとに環境を分離する
  (`vite.config.ts` に isolate 無効化や pool 上書きは無い)ため、他テストへの
  漏れはない。実際に全 83 ファイルが通過している。妥当なアプローチと判断。
- **テストコードの質**: 異常系・境界値(鮮度境界ちょうど/+1ms、クロック
  スキュー、calls 空配列、seen 済み seq の再発火なし、複数エッジ混線防止、
  アンマウント時のタイマー破棄)が揃っており、実装の詳細をなぞるだけの
  無意味なテストは見当たらない。エラー握りつぶし(catch の追加)は差分中に
  皆無。
- **glossary 参照**: `engine-api` / `el-cl-separation`(Issue #190 で追加
  済み)が `InternalLinkEdgePopover` の見出し・本文、`InfraPopover` の
  「駆動する実行ノード」ラベルから `GlossaryTerm` で参照されている。
- **残課題(chainviz-qa への申し送り)**: Playwright での実機確認は環境制約で
  未実施のため、以下は QA が実環境(docker compose + collector + frontend)で
  確認すること。
  1. beacon→reth の内部リンクエッジが常設で描画される(addNode 後のペア含む)
  2. チェーン進行中、活動パルスがおおむね3秒間隔で CL→EL 方向に流れる
  3. エッジホバーでポップオーバー(見出し・端点・説明文・直近呼び出しの
     内訳)が表示され、既存エッジ(P2P/所有/操作/デプロイ)と線種・色で
     見分けられる
  4. lighthouse カードのポップオーバーに「駆動する実行ノード」行が出る
- **統括への補足(非ブロッキング)**: (1) 本ブランチは未コミットのため
  コミット粒度は未レビュー。コミット時は「world-state 経路 / エッジ・
  パルス描画 / mockData / docs」など関心事ごとに分けること。(2) collector
  側 `NODE_INTERNALS_POLL_INTERVAL_MS` のコメントには frontend 側コピーの
  存在への言及が無い。将来 collector 側だけ変更されるリスクを下げるため、
  別途 collector を触る機会に相互参照コメントを足すとよい(本 Issue の
  スコープ外なので差し戻しはしない)。

---

### QA検証記録(chainviz-qa 実機検証)

実ブラウザ(Playwright + Chromium)で `pnpm --filter @chainviz/frontend
build:web` → `preview`(モッククライアント)を起動して検証した。判定は**合格**。
実装担当・reviewer が申し送りした「実ブラウザでの見た目(線種の見分け・
パルスの流れ・ホバー挙動)」を実際に確認できた。

- **実機環境の準備**: このリポジトリの Playwright Chromium は共有ライブラリ
  不足(libnspr4/libnss3/libasound2 等)で起動できないため、Issue #165〜168
  QA と同じ手法で `apt-get download` により該当 deb を取得・ローカル展開し、
  `LD_LIBRARY_PATH` に通して起動した。今回必要だった deb は libnspr4 /
  libnss3 / libasound2t64 / libasound2-data。Playwright 1.61.1 が要求する
  chromium は chromium-1228(chrome-linux64)。

- **確認できた項目(完了条件との対応)**:
  1. 内部リンクエッジの常設表示: chainviz-lighthouse-1 ↔ chainviz-reth-1
     間に無彩色シルバーのエッジが常設で1本描画される。DOM 上で
     `.internal-link-edge__core`(芯: stroke rgb(201,212,232)=#c9d4e8 /
     1.5px / opacity 0.8)と同一ベジェパスに重なる鞘(BaseEdge: 同色 /
     6px / opacity 0.18)の二重描画を確認。矢印なし。スクリーンショットでも
     他エッジ(P2P=黄緑破線・操作=マゼンタ破線・所有=橙破線・デプロイ=青破線)
     と明確に線種・色で見分けられることを目視確認した(内部リンクだけが
     実線のシルバー)。エッジは有効な drivesNodeId ペア1組に対して1本のみで、
     余計なダングリングエッジは描画されていない。
  2. エッジホバーでポップオーバー表示: エッジ上へマウスを移動すると
     `EdgeLabelRenderer` 経由でポップオーバーが表示され、見出し「内部リンク
     (Engine API)」・端点表記「chainviz-lighthouse-1 → chainviz-reth-1」・
     EL/CL 分離の説明文・「直近3秒の呼び出し」as `engine_newPayloadV4 ×1
     (ブロックの実行依頼) (平均 8 ms) · engine_forkchoiceUpdatedV3 ×1
     (チェーン先端の更新) (平均 4 ms)` が DOM・スクリーンショット双方で
     確認できた。
  3. 活動パルス: モックの周期 tick(3秒間隔)で nodeLinkActivity が届くたびに
     エッジ上へ `.internal-link-pulse`(1観測1本の揮発 circle)が現れることを
     確認(待機ループで約3秒後に count=1 を観測)。
  4. glossary 参照: lighthouse カードをホバーして InfraPopover を開き、
     「駆動する実行ノード: chainviz-reth-1」行の engine-api 用語をホバーすると
     glossary ツールチップが完全な定義文(「合意クライアント(CL)と実行
     クライアント(EL)を繋ぐ内部 API…」)で表示され、関連語に
     `el-cl-separation` が並ぶことを確認。engine-api / el-cl-separation の
     両方が UI から参照できている(用語は既知として解決され
     `glossary-term--unknown` にならない)。
  5. CL 側 InfraPopover の「駆動する実行ノード」行が lighthouse-1 側にのみ
     表示されることを確認(reth 側 InfraPopover には逆方向の行は出ない)。

- **ダングリングガード**: ブラウザ上ではモックが両端点を常に持つため
  ガード発動シーンは再現できないが、有効な1ペアに対しエッジが1本だけ
  描画され不要なエッジが出ないことは確認した。ガードの4パターン
  (起点不在/駆動先不在/駆動先未解決/自己参照)は tester 追加の
  ユニットテスト(`internalLinkEdge.test.ts` /
  `useNodeLinkActivityPulses.test.ts`)で網羅済みであり、reviewer も確認済み。

- **品質ゲート(独立実行)**: リポジトリ全体で `pnpm lint`(eslint、エラー
  なし)・`pnpm build`(shared/collector/e2e/frontend すべて成功)・`pnpm test`
  (shared 58 / e2e 34 / collector 1058 / frontend 1294、全通過)を確認した。

- **判定**: 完了条件をすべて満たしているため合格。差し戻しなし。
  検証用の一時 Playwright スクリプト(packages/e2e 配下に一時作成)は
  検証後に削除済みで、ブランチへの残置は無い。
