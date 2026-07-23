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
