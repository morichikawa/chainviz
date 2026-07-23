### 2026-07-23 Issue #408 メモリプールがどこに格納されているか分かりにくい

- 担当: ux
- ブランチ: issue-408-mempool-node-locality
- 内容: Issue本文が空だったため、実機（`pnpm --filter @chainviz/frontend dev`
  のモックデータ + Playwright、`LD_LIBRARY_PATH` に
  `/home/zoe/chrome-deps/root/usr/lib/x86_64-linux-gnu` を追加して chromium を
  起動）で mempool 関連の現状表示を確認し、具体的に何が分かりにくいかを特定、
  Issue本文への追記とUX設計をまとめた。

#### 調査結果

`docs/CONCEPT.md`「用語解説」の mempool 定義は「各ノードが保持する」と
正しく書かれており、mempool 自体を可視化する仕組み（Issue #330 の
`MempoolPanel`、ステップ9の `InfraPopover` txpool 行）も既に実装済み。
それにもかかわらず「どこに格納されているか分かりにくい」という指摘が
出た理由を、実際にキャンバスを操作して切り分けた。

1. **ノードカード本体に mempool の手がかりが無い**。
   `packages/frontend/src/entities/InfraNodeCard.tsx` のカード面
   （常時見える部分）には kind ラベル・同期状態ドット・名前・サブタイトル・
   （同期中のみ）同期進捗バーしか無く、txpool/mempool に関する表示は
   一切無い。ホバーして `InfraPopover` を開かない限り、そのノードが
   mempool を持つこと自体に気づけない。
2. **`InfraPopover` 内でも txpool 行が同期ステージ10行の下に埋もれている**。
   `InfraPopover.tsx` の txpool 行（`entity.internals?.mempool` があるとき
   のみ表示）は、`InfraPopoverSyncStages`（ヘッダ取得〜仕上げの10行）の
   直後、ポップオーバー最下部に配置されている。実際にホバーして
   スクリーンショットを撮ると、txpool 行を見るには縦に長いポップオーバー
   全体を目で追う必要があることを確認した。
3. **`MempoolPanel`（Issue #330）の「ノード別 txpool」欄が、キャンバス上の
   実際のノードカードと視覚的に結び付いていない**。
   `packages/frontend/src/entities/MempoolPanel.tsx` の「ノード別 txpool」
   セクション（`mempool-panel__node-row`）はノード名と pending/queued 件数を
   `<li>` で並べるだけで、CSS にもクリック/ホバーの反応が無い
   （`mempool-panel__node-row` に `:hover` スタイルなし、コンポーネント側も
   `onClick` を持たない）。同じパネルの上段（tx 一覧）は行クリックで
   `Canvas.tsx` の `handleJumpToMempoolTx` により該当ウォレットカードへ
   パンする導線を持つが、下段のノード別行にはこの導線が無い。
   `ContractListPanel` の行クリック（`handleJumpToContract`）は対象カードへ
   パンした上で一時的な強調表示（`jumpHighlightNodeId` +
   `NEW_ARRIVAL_HIGHLIGHT_DURATION_MS`）まで行うが、これも
   `CONTRACT_NODE_TYPE` のカードのみが対象で、ノードカード
   （`InfraNodeCard`）には適用されていない。

つまり、「mempool の中身・件数が見える」ことと「その mempool が具体的に
どのノードカードに対応するのかがキャンバス上で視覚的に分かる」ことは
別の課題であり、Issue #330・ステップ9では前者のみが達成されていた。

なお、`TransactionEntity`（mempool パネル上段の tx 一覧）自体にどのノードで
観測されたかという帰属情報が無い点は、Issue #330 §11.2（`docs/ARCHITECTURE.md`）
で「新規観測が必要になるため範囲外」と明示的に決定済みであり、本Issueでも
この決定を覆さない（tx 一覧の「どのノード由来か」までは扱わず、
ノード別集計＝下段の可視性向上に絞る）。

#### UX設計

**操作フロー**

- ノードカードは、ホバーしなくても「mempool を持つノードであること」と
  「現在の pending 件数」が一目で分かる状態にする（Execution クライアント
  など `entity.internals?.mempool` を持つノードのみ。Consensus/Validator
  には出さない。既存の txpool 行と同じ分岐条件を流用できる）。
- `MempoolPanel` の「ノード別 txpool」の各行はクリック可能にし、クリック
  すると対応するノードカードへキャンバスがパンする。可能であれば
  `ContractListPanel`/`handleJumpToContract` と同じ「対象カードを一時的に
  強調表示する」演出も適用する（既存の `jumpHighlightNodeId` の仕組みを
  ノードカードにも拡張できるならそれを使う。拡張コストが見合わなければ
  パンのみでもよい。ここは実装担当の判断に委ねる）。

**情報の見せ方**

- ノードカード面への表示は、既存の「ブートノードバッジ」
  （`infra-card__badge--bootnode`）と同格の小さなバッジ/ピルとして追加する
  案を推奨する。ラベルは既存の `field.txpool`（`txpool`/`Txpool`）と
  `txpool.value`（`pending {n} · queued {m}`）をそのまま再利用できる。
  `GlossaryTerm termKey="txpool"` を維持し、用語解説への導線も残す。
- pending が 0 件のときに非表示にするか常時表示するかは未決定（下記
  「決めきれない点」参照）。UX設計としては、mempool パネル本体が「0件も
  意味のある情報」という方針（Issue #330 §11.3）を既に採っていることと
  整合させ、**常時表示（0件も出す）を推奨**する。「このノードは常に自分の
  mempool を持っている」という事実そのものを見せる方が、今回の指摘
  （どこに格納されているか分からない）への直接的な回答になるため。
- `InfraPopover` 内の txpool 行は、同期ステージブロック（10行）より前、
  クライアント種別・役割などの基本情報に近い位置へ移動する。同期ステージは
  「進行中の作業の詳細」という性質上どうしても長くなるため、txpool は
  その手前に置いて先に目に入るようにする。

**shared型変更・collector変更**

- 不要。すべて既存の `NodeEntity.internals.mempool`
  （pending/queued）を使う表示上の変更のみ。

#### 決めきれない点（実装担当・統括に確認）

- ノードカードの mempool バッジを pending 0 件でも常時表示するか、
  0件のときは非表示にするか。上記のとおり常時表示を推奨するが、
  カード面の情報密度（バッジが増えすぎて見づらくならないか）とのバランスは
  実装時に実際のカード密度を見て判断してよい。
- `MempoolPanel` のノード別行クリック時に `ContractListPanel` と同じ
  一時強調演出（`jumpHighlightNodeId`）をノードカードにも拡張するか、
  パンのみに留めるか。既存の強調機構が `CONTRACT_NODE_TYPE` 専用に
  書かれているため、汎用化のコストと効果を実装担当が判断する。

#### 次の担当への申し送り

- 実装は chainviz-frontend が引き継ぐ。上記「操作フロー」「情報の見せ方」
  に沿って、(1) `InfraNodeCard` への txpool バッジ追加、(2) `InfraPopover`
  内の txpool 行の並び順変更、(3) `MempoolPanel` のノード別行のクリック
  可能化（対象カードへのパン）、の3点を実装範囲とする。
- 参考にする既存パターン: `Canvas.tsx` の `handleJumpToContract`
  （パン＋一時強調）、`handleJumpToMempoolTx`（パンのみ）。

### 2026-07-23 実装（chainviz-frontend）

- 担当: frontend
- ブランチ: `issue-408-mempool-node-locality`（実装時、同名ブランチが別
  worktree で既にチェックアウト済みだったため、作業用worktreeでは
  `issue-408-mempool-node-locality-frontend` というローカルブランチ名で
  `origin/issue-408-mempool-node-locality` を追跡して作業し、最終的に
  `origin/issue-408-mempool-node-locality` へ push した。リモートの
  ブランチ名自体は変えていない）

#### 設計メモ（着手前）

UX設計（上記）で決まった3点をそのまま実装範囲とする。

1. `InfraNodeCard`: `entity.internals?.mempool` があるノードに、サブタイトル
   直下へ txpool バッジを追加する。
2. `InfraPopover`: 既存の txpool 行を bootnode 行の直後・同期ステージより
   前へ移動する。
3. `MempoolPanel`: ノード別行を `<button>` 化し、`onSelectNode` コールバック
   を新設。`Canvas.tsx` 側は `handleJumpToContract` と同型の
   `handleJumpToMempoolNode` を新設し、`jumpHighlightNodeId` の対象型に
   `"infra"`（`InfraNodeCard` の React Flow ノード type）を追加する。

`packages/shared` の型変更・collector 変更は不要という設計判断のとおり、
既存の `NodeEntity.internals.mempool`（pending/queued）を表示・配線するだけ。

#### 決めきれない点への回答

- **バッジの0件時表示**: 常時表示（0件でも出す）を採用。UX設計の推奨
  どおり、`MempoolPanel` 本体が既に採っている「0件も意味のある情報」の
  方針と揃えた。
- **バッジの配置**: UX設計は「ブートノードバッジと同格」＝ヘッダー行への
  配置を推奨していたが、実装では**ヘッダー行ではなくサブタイトル直下の
  専用行**に置いた。理由: `.infra-card` の `min-width: 190px` に対し、
  ヘッダー行には既にステータスドット・kindラベル・（条件付きで）
  ブートノードバッジ・削除ボタンが並んでおり、ここへさらに
  「txpool pending N · queued M」相当の pill を追加すると、
  `infra-card__header` に `flex-wrap` が無いため横幅超過時にカードの
  角丸から要素がはみ出す/重なるリスクがあった（実機で目視確認する手段が
  無い状況で、レイアウト崩壊のリスクを取るより安全側に倒した）。視覚的な
  「pill バッジ」の見た目（配色・サイズ）は `infra-card__badge--bootnode`
  と完全に同じクラス値を再利用した新設クラス `infra-card__badge--txpool`
  で保っており、「同格のバッジ」という意図は達成している。この判断は
  `docs/worklog/issue-408.md`（本ファイル）に記録済みなので、QA で実際の
  カード密度を見て問題があれば再検討してよい。
- **強調演出（`jumpHighlightNodeId`）のノードカードへの拡張**: 拡張した。
  `Canvas.tsx` の `displayNodes` 計算で、ジャンプ強調対象の型判定を
  `node.type === CONTRACT_NODE_TYPE` 単独から
  `node.type === CONTRACT_NODE_TYPE || node.type === "infra"` 相当（実装は
  下記の型エラー対応により2つの独立した `if`/`else if` に分割）へ拡張した。
  コストは小さく、`ContractListPanel` と同じ発見容易性が得られるため。

#### 実装内容

- `packages/frontend/src/entities/InfraNodeCard.tsx`: `mempool` 変数
  （`entity.kind === "node" ? entity.internals?.mempool : undefined`）を
  導出し、サブタイトル直下に `infra-card__txpool-row` /
  `infra-card__badge--txpool` を追加。`data-testid` は
  `infra-card-txpool-${entity.id}`。ラベルは `field.txpool`
  （`GlossaryTerm termKey="txpool"` 付き）、値は既存の `txpool.value`
  フォーマット（`pending {n} · queued {m}`）をそのまま再利用。
- `packages/frontend/src/entities/InfraPopover.tsx`: txpool 行を
  `entity.p2pRole === "bootnode"` 行の直後・`showsSyncState` ブロックの
  直前へ移動（元は同期ステージセクションの直後、ポップオーバー最下部）。
  JSDoc の記述も更新。
- `packages/frontend/src/entities/MempoolPanel.tsx`: ノード別行を
  `<li><button className="mempool-panel__node-row" onClick={() =>
  onSelectNode(node.nodeId)}>...` へ変更。新規 prop `onSelectNode:
  (nodeId: string) => void` を追加（`MempoolNodeEntry.nodeId` は
  `buildMempoolNodeEntries` が `rfNodes` から直接作るため、tx 行の
  `walletCardId === undefined` のような「解決できない」ケースは無く、
  常にクリック可能）。
- `packages/frontend/src/canvas/Canvas.tsx`: `handleJumpToMempoolNode` を
  新設し `MempoolPanel` の `onSelectNode` に接続。`displayNodes` の
  ジャンプ強調判定に `"infra"` 型を追加。
- `packages/frontend/src/i18n/messages.ts`: `mempoolPanel.nodeJumpHint`
  （ノード別行の title 属性用ヒント文言）を新設。
- `packages/frontend/src/styles.css`: `infra-card__txpool-row` /
  `infra-card__badge--txpool`（新設）、`.mempool-panel__node-row` を
  非インタラクティブな `<li>` の中身用スタイルからボタン用スタイル
  （`cursor: pointer`、`:hover` 背景）へ変更。

#### 実装時に踏んだ型エラーと対応

`displayNodes` の `useMemo` 内で、ジャンプ強調対象の型判定を
`node.type === CONTRACT_NODE_TYPE || node.type === "infra"` という1つの
条件式にまとめたところ、`tsc -b` で
`Type 'ContractEntity' is not assignable to type 'NodeEntity'` という
型エラーになった。`CanvasFlowNode` は判別可能ユニオン型だが、
`node.type === A || node.type === B` で2メンバーへ narrow された状態の
まま `{ ...node, data: { ...node.data, isNew: true } }` を評価すると、
TypeScript が union の各メンバーに分配して spread してくれず、
`data.entity` の型（`ContractEntity` と `InfraEntity`）が単一の型として
マージされようとして矛盾する。回避策として、1つの `if` にまとめず
`if (isJumpHighlightTarget && node.type === CONTRACT_NODE_TYPE) {...}
else if (isJumpHighlightTarget && node.type === "infra") {...}` と
型ごとに分岐を分けた（各分岐内では単一メンバーへ narrow された状態で
spread するため型エラーが出ない）。同種のパターンに当たった場合の
参考にしてほしい。

#### テスト

- `InfraNodeCard.test.tsx`: txpool バッジの表示条件（mempool 有無・
  pending/queued 0件でも表示・workbench では出さない・bootnode バッジと
  共存）を追加。
- `InfraPopover.test.tsx`: `compareDocumentPosition` を使い、txpool 行が
  同期ステージ見出しより DOM 上で先に来ることを検証するテストを追加
  （このテストは実装前の状態（旧順序）に対して意図的に revert して
  実行し、実際に fail することを確認した上で実装後に戻して pass する
  ことも確認済み）。
- `MempoolPanel.test.tsx`: ノード別行が `<button>` になること、
  `onSelectNode` に `nodeId` が渡ること、複数行でそれぞれ独立して呼ばれる
  こと、`onSelectTx` と混同しないことを追加。

`Canvas.tsx` の `handleJumpToMempoolNode`／`handleJumpToContract` 自体は
既存コードでも Canvas.tsx 単体のユニットテストが無く（React Flow の
`getNode`/`setCenter` を伴う配線ロジックで、既存の `handleJumpToContract`
にも単体テストが無い）、本Issueでも同じ方針を踏襲し新規のテストは
追加していない。パン・強調の実際の見た目は QA（Playwright での実機確認）
での検証を想定。

#### 次の担当への申し送り

- `chainviz-tester`: 境界値として、`internals.mempool` が pending/queued
  ともに巨大な値（表示崩れの有無）、`mempool-panel__node-row` の
  `onSelectNode` を高速連打した場合の挙動などを検討してほしい。
- `chainviz-qa`: 実機で (1) ノードカードに常時 txpool バッジが出ること、
  (2) `InfraPopover` で txpool 行が基本情報の並びに来ていること、
  (3) `MempoolPanel` のノード別行クリックで対応ノードカードへパン＋
  一時強調されること、の3点を確認してほしい。あわせて、ヘッダー行では
  なくサブタイトル直下に txpool バッジを置いた実装判断（上記
  「決めきれない点への回答」参照）が実際のカード密度で問題ないか
  目視確認してほしい。
