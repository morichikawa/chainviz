# Issue #409 チェーンを遡れるようにしたい

### 2026-07-23 Issue #409 チェーンを遡れるようにしたい（設計）
- 担当: designer
- ブランチ: issue-409-block-detail-navigation
- 内容: Issue本文が空だったため、まず要望の解釈とスコープの確定を行った。
  `docs/CONCEPT.md`・`docs/ARCHITECTURE.md`・`docs/PLAN.md` を精査し、
  「チェーンを遡る」機能として現実的な範囲を決定し、`docs/ARCHITECTURE.md`
  §17（ブロック詳細パネル）として設計を記述した。GitHub Issue本文にも
  具体的なスコープと受け入れ条件を追記した。

- **要望の解釈とスコープ決定の経緯**:
  タイトルのみでは「特定ブロックの詳細を見たいだけ」「タイムトラベル的な
  キャンバス全体の再生」「本格的なブロックエクスプローラー」のどれを
  指すか分からなかった。既存のドキュメントを調べると、この種の「過去を
  遡りたい」という要望には既に3件の前例があることが分かった:
  - Issue #317（通信ログパネル）: DiffEventの時系列ログを500件のリング
    バッファで保持し、遡って確認できるようにした
  - Issue #298（チェーンリボン）: collector側に`BLOCK_RETENTION = 32`の
    保持窓を導入したが、表示は直近8タイルに固定
  - Issue #320（ウォレットのtx履歴）: 表示件数を6件固定からcollectorの
    保持上限（32件）まで見れるようスクロール対応した。「無限の履歴を
    遡る機能には拡張しない」と明記されている（ARCHITECTURE.md §6.13）
  この3件はいずれも「collectorが既に保持している範囲内で、表示側の制限を
  緩める」というパターンで、「無限に遡れる本物のエクスプローラーは作ら
  ない」という一貫した設計判断がある。今回もこの路線を踏襲するのが
  CONCEPT.mdの設計思想（学習・可視化ツールであって実運用のexplorerでは
  ない）と整合すると判断した。
  一方、チェーンリボンには「⋯」（older）という、親ブロックが表示窓の外に
  あることを示すだけのUI要素が既にあり（Issue #351）、「窓の外にあると
  伝えるだけで実際には辿れない」という未解消のギャップがまさにこの
  Issueの要望と一致すると判断した。

- **決定したスコープ**（詳細は ARCHITECTURE.md §17）:
  - 対応する: collectorが現在保持している最大32ブロック（slot 12秒で
    約6.4分）の範囲内で、任意のブロックの詳細（フルhash・parentHash・
    timestamp・受信ノード一覧・取り込み済みtx全件）を見られるようにし、
    親子関係をたどって前後に移動できるようにする「ブロック詳細パネル」
  - 対応しない（意図的に外す）: 保持窓より前のブロックへの新規RPCによる
    遡及取得、ハッシュ/アドレス/番号による全チェーン検索UI（本格的な
    ブロックエクスプローラー）、セッションリプレイ（CONCEPT.mdの
    「発展の発展」として既に将来課題化されている）
  - `BLOCK_RETENTION`（現在32）は変更しない。パネル+前後ナビゲーション
    だけで「直近8タイル(約96秒)」から「保持窓全体(約6.4分)」まで見える
    範囲を広げられるため、今回はこの範囲で十分と判断した。値を大きく
    するかどうかは実際に使ってみてから判断すべきで、今使ってもいない
    深さを先回りで決め打ちしないというCLAUDE.mdの固定値ルールに従った

- **データフロー**: `packages/shared`の型変更なし・collectorの変更なし。
  フロントのみで完結する（チェーンリボン#298・mempoolパネル#330と同じ
  方針）。
  - サイドパネルの新kind `{ kind: "blockDetail"; hash: string }`
    （frontend内部の型。`side-panel/sidePanelView.ts`）
  - 開くトリガーは`ChainRibbonPopover`内の新ボタン（Issue #401の
    `hashDemo.open`ボタンと同型）。タイル本体への新規クリックトリガー
    追加は避けた（タイル本体は#298/#351のホバー凍結・強調ロジックが
    複雑に絡んでおり、干渉するリスクがあるため）
  - 対象ブロックの解決は`Canvas.tsx`が`rfNodes`中のチェーンリボンノード
    （`type === CHAIN_RIBBON_NODE_TYPE`、常に1つ）の`data.blocks`
    （保持窓内のBlockEntity全件。既存フィールド）をhashでインデックス化
    するだけで得られる。tx一覧は既に`CanvasProps.transactions`として
    渡されている全TransactionEntity配列を`blockHash`で絞り込むだけ
    （どちらも新しいデータ取得を伴わない、既存データの再結合）
  - 前後ナビゲーションはparentHash/parentHashの逆引きで実現（詳細は
    ARCHITECTURE.md §17.3）。フォーク発生時のtie-breakはチェーンリボンの
    `pickCanonicalPerNumber`と同じ規則を踏襲し、表示の一貫性を保つ
  - ダングリングガード（表示中のブロックが保持窓から外れた場合）は
    contractSourceと同じ「自動的にパネルを閉じる」方針とした。理由の
    説明UIは追加しない（新しいUI要素を増やさない単純化。QAで問題に
    なれば別途検討）

- **判断: chainviz-ux は経由しない**（実装担当への提案。統括の判断で
  上書き可）。理由: (1) 開くトリガーは既存のポップオーバー内ボタンという
  Issue #401で実証済みのパターンをそのまま踏襲するため新規のインタラ
  クション設計は不要、(2) パネルの中身も既存パターン（フィールド表示・
  WalletPopoverTxItem相当のtx行・mempoolパネルのnボタン間引き）の組み
  合わせで賄え、Issue #330・#362・#377と同水準の複雑さと判断した。
  トリガー・境界時の文言・ダングリング時の挙動など数点のUX的判断は
  designerがこのメモ内で決定済み。実装中に想定以上に複雑な判断が
  必要になった場合はUX設計を挟むことを妨げない

- **実装担当への引き継ぎ**（frontendのみ、shared/collector変更なし）:
  - `packages/frontend/src/side-panel/sidePanelView.ts`:
    `{ kind: "blockDetail"; hash: string }`を追加
  - `packages/frontend/src/entities/ChainRibbonPopover.tsx`: 「ブロック
    詳細を見る」ボタンを追加（`hashDemo.open`ボタンと同じ
    nodrag/stopPropagationパターン）
  - `packages/frontend/src/side-panel/`: 新規`BlockDetailView.tsx`
    （仮称。1ファイル1責務、`ContractSourceView.tsx`と同水準の規模を
    想定）と、対象ブロック・前後ブロック・tx一覧の導出ロジックを
    切り出した純粋関数（`entities/chainRibbon.ts`への追加、または新規
    `entities/blockDetail.ts`。ARCHITECTURE.md §17.2〜17.3参照）
  - `packages/frontend/src/side-panel/SidePanelHost.tsx`:
    `blocksByHash`・対象ブロックのtx一覧を渡す新propを追加し、
    `blockDetail` kindのcaseを追加。ダングリングガードも追加
  - `packages/frontend/src/canvas/Canvas.tsx`: `rfNodes`からチェーン
    リボンノードの`data.blocks`を拾って`blocksByHash`を`useMemo`で
    作る（`contractsByAddress`と同じ書き方）
  - i18nキー（`blockDetail.*`）の新設。ja/en両方
  - `packages/e2e/SCENARIOS.md`へのBブロックUIシナリオ追記と
    Playwrightテスト実装（ARCHITECTURE.md §17.5に境界値テストの
    注意点を明記済み。32ブロック分待つ必要はなく、テスト環境起動直後の
    「観測している最古のブロック」で境界条件を検証できる）
  - glossary変更は不要（block/hash/parentHashの既存エントリで足りる）

- **決定事項・注意点（次の担当が知っておくべきこと）**:
  - `packages/shared`は一切変更していない（設計時点でビルド・テストへの
    影響なし。既存の`pnpm build && pnpm test`はそのまま通る）
  - このIssueは frontend + e2e のみで完結する規模と判断し、複数の
    サブIssueには分割しなかった（1 Issue = 1 PRで完結する見込み）。
    Issue #330（mempoolパネル）・#401/#402（暗号デモ）と同等の粒度
  - 「⋯」（older。チェーンリボン最左の要素）を新パネルへのもう一つの
    入口にするかは実装時のオプションとして残した（必須要件にはしない。
    最古タイルのポップオーバーから開けば同じ効果が得られるため）

### 2026-07-23 Issue #409 チェーンを遡れるようにしたい（実装）
- 担当: frontend
- ブランチ: issue-409-block-detail-navigation
- 内容: 設計メモに従い、frontendのみでブロック詳細パネルを実装した。
  `packages/shared`・collectorの変更は無い。

- **実装した変更**（設計メモ「実装担当への引き継ぎ」の対応）:
  - `packages/frontend/src/side-panel/sidePanelView.ts`: `SidePanelView` に
    `{ kind: "blockDetail"; hash: string }` を追加
  - `packages/frontend/src/entities/blockDetail.ts`（新規）: 純粋関数群。
    `buildBlocksByHash`（hash索引化）、`findParentBlock`/`findChildBlock`
    （前後ブロックの解決。`findChildBlock`はチェーンリボンの
    `pickCanonicalPerNumber`と同じ tie-break を独立実装。走査対象が
    「同一番号内」ではなく「特定ブロックの子候補」で異なるため共有は
    しなかった）、`resolveBlockNavigation`（前後 + isLatest をまとめる）、
    `selectBlockTransactions`（対象ブロックのtxをnonce昇順で抽出。
    `countTransactionsByBlockHash`と同じ絞り込み条件）、
    `limitBlockTransactions`（mempoolの「他n件」と同型の安全弁。既定
    100件。ミニパネルより表示余地が大きいため mempool より緩め）
  - `packages/frontend/src/side-panel/BlockDetailView.tsx`（新規）: パネルの
    中身。ヘッダ（番号+短縮hash）、フィールド（フルhash・親hash・
    タイムスタンプ）、受信ノード全件（`deriveReceivedOrder`をそのまま
    再利用）、tx一覧（`deriveTxCallPreview`を`WalletPopover.tsx`の
    `TxCallPreviewLine`と同様に再利用し呼び出し内容を表示）、前後
    ナビゲーションボタンとdisabled時の理由文言を持つ。親hashフィールド
    自体もクリックで「前のブロック」と同じ移動ができるようにした
    （設計メモで「実装時に検討」とされていた任意項目。ボタン化して
    `infra-field`の見た目を保ったまま`onNavigate`を呼ぶ）
  - `packages/frontend/src/side-panel/SidePanelHost.tsx`: `blockDetail` kind
    のディスパッチを追加。`blocksByHash`/`blockNodeLabelById`/
    `latestBlockHash`/`transactions`の4つの新規propsを追加（すべて
    optional。既存の単体テスト・ハーネスが新規propsを渡さなくても
    ビルドが壊れないように、モジュールスコープの固定Mapを既定値にした）。
    ダングリングガードは`contractSource`と同じ仕組みに相乗りさせ、
    `blocksByHash`から対象hashが引けなくなったら自動的に閉じる
  - `packages/frontend/src/canvas/Canvas.tsx`: `rfNodes`からチェーンリボン
    ノード（`type === CHAIN_RIBBON_NODE_TYPE`）を`useMemo`で見つけ、
    `data.blocks`/`data.nodeLabelById`/`data.tiles`から
    `blocksByHash`/`nodeLabelById`/`latestBlockHash`を導出して
    `SidePanelHost`へ渡した（`contractsByAddress`と同じ「rfNodesを
    filterするだけ」の流儀）。`latestBlockHash`は`data.tiles.at(-1)`（番号
    昇順の末尾=最新。`deriveRibbonTiles`の契約）。`ChainRibbonCard`内の
    ホバー凍結（`useFrozenRibbonTiles`）は表示専用のローカルstateであり、
    データ導出側は常に生の`data.tiles`を使うため影響しない
  - `packages/frontend/src/entities/ChainRibbonPopover.tsx`: 「ブロック
    詳細を見る」ボタンを追加。Issue #401の「ハッシュのしくみを試す」
    ボタンと同じnodrag/stopPropagationパターンで、ブロック詳細ボタンを
    先頭（受信ノード欄との区切り線を持つ）、ハッシュデモボタンを2番目
    （区切り線なしで詰めて並ぶ）に配置した
  - `packages/frontend/src/i18n/messages.ts`: `blockDetail.*`のja/enキーを
    7件追加（title/open/prev/next/prev.unavailable/next.latest/
    next.unavailable）。フィールドラベル（番号・hash・親・時刻・受信
    ノード欄等）は`chainRibbon.popover.*`の既存キーをそのまま再利用し、
    キーの重複を避けた
  - `packages/frontend/src/styles.css`: `.block-detail-view__*`のスタイルを
    追加。フィールド行は既存の`.infra-field`を再利用し、新規CSSは
    ヘッダ・受信ノードリスト・tx行・ナビゲーションボタンの部分のみに
    絞った
  - `packages/e2e/SCENARIOS.md`にUI-B-07として追記し、
    `packages/e2e/src/ui/block-detail.spec.ts`（新規）にPlaywrightテストを
    実装した。ARCHITECTURE.md §17.5の注意点通り、起動直後に観測できる
    最古のブロックで「前のブロックがdisabled」の境界を確認しており、
    32ブロック分待つ必要はない

- **テスト**: `packages/frontend/src/entities/blockDetail.test.ts`
  （純粋関数群。フォークのtie-break・nonce無しtxの扱い・isLatestの
  境界値等）、`packages/frontend/src/side-panel/BlockDetailView.test.tsx`
  （表示コンポーネント。前後ボタンのdisabled/reason・tx一覧・overflow等）、
  `packages/frontend/src/side-panel/SidePanelHost.blockDetail.test.tsx`
  （kind振り分け・ダングリングガード・実際のナビゲーション遷移）、
  `packages/frontend/src/entities/ChainRibbonPopover.blockDetailEntry.test.tsx`
  （ポップオーバーの導線ボタン）の4ファイルに分割して追加した（CLAUDE.md
  のテストファイル分割方針）。`pnpm lint && pnpm build && pnpm test`が
  frontend・shared・collector・e2eの全パッケージで通ることを確認済み
  （e2eは`tsc --noEmit`のみ。Playwrightの実行には実チェーン環境が必要な
  ため、この実装セッションでは実行できていない。chainviz-qaでの実機検証を
  推奨する）

- **次の担当が知っておくべき注意点**:
  - `packages/shared`は一切変更していない
  - `SidePanelHost`の新規propsはすべてoptionalにしてあるため、
    Canvas.tsxを経由しない既存の単体テスト・ハーネス（`SidePanelHost.test.tsx`
    等）は変更不要だった
  - `findChildBlock`のフォークtie-breakは`chainRibbon.ts`の
    `pickCanonicalPerNumber`と規則は同じだが、コードとしては独立実装
    （走査対象が異なるため共有関数化はしていない）。将来的にこの規則
    自体を変更する場合は両方を更新する必要がある
  - e2eテスト（`block-detail.spec.ts`）はこのセッションでは実行確認して
    いない（Docker環境が無い）。chainviz-qaでの実行を必須とする
