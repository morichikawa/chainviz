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

### 2026-07-23 Issue #409 チェーンを遡れるようにしたい（テスト強化）
- 担当: tester
- ブランチ: issue-409-block-detail-navigation
- 内容: 実装担当が書いた基本テストに対し、異常系・境界値・不変条件の観点で
  ケースを追加した。新機能の実装・実装ロジックの変更はしていない。

- **追加した観点**（既存テストファイルの関心事に沿って追記。1ファイル1責務を維持）:
  - `entities/blockDetail.test.ts`:
    - `findChildBlock`のフォークtie-break規則が`chainRibbon.ts`の
      正史選択（`deriveRibbonTiles`経由の`pickCanonicalPerNumber`）と実際に
      同じ勝者を選ぶことを直接突き合わせるcross-check（申し送りの「規則は
      同じだが独立実装」という不変条件を、片方だけ規則が変わった場合に
      検知できるようにする回帰テスト）
    - `findChildBlock`のtie-breakがMapの反復順（＝挿入順）に依存せず
      決定的であること
    - `resolveBlockNavigation`で`isLatest=true`と`child`定義済みが同時に
      成立しうること（両者は独立に導出される）
    - `selectBlockTransactions`が`blockHash`未定義のtxを除外すること・
      入力配列を破壊しないこと
    - `limitBlockTransactions`の境界: 件数が上限ちょうど（overflow 0）・
      上限0・0件・返り値が入力とは別インスタンスであること
  - `side-panel/BlockDetailView.test.tsx`:
    - 親も子も無い孤立ブロック（保持窓に1件のみ）で前後ボタンが両方
      無効になり両方向の理由文言が同時に出ること
    - tx呼び出しプレビューの宛先コントラクト名が解決できない場合に
      `shortHex(アドレス)`へフォールバックすること
  - `side-panel/SidePanelHost.blockDetail.test.tsx`:
    - 親hashフィールドのリンク（prevボタンとは別の導線）からの前ブロック
      移動がパネル1枚のまま中身差し替えで動くこと
  - `entities/ChainRibbonPopover.blockDetailEntry.test.tsx`:
    - 「ブロック詳細を見る」ボタンが`nodrag`クラスを持つこと（React Flowの
      パン操作にボタン押下を横取りされない防御。stopPropagationとは別の
      観点で、双方を固定）

- **見つかった問題と対応**:
  - e2eテスト`packages/e2e/src/ui/block-detail.spec.ts`のアサーション不備を
    修正した。「次のブロック」クリック後に子ブロックへ差し替わったことを
    `block-detail-view`のテキストに`firstHash`が含まれないこと
    （`not.toContainText(firstHash)`）で判定していたが、子ブロックは親hash欄に
    `firstHash`を全文表示する（`parentHash === 親（=firstHash）`）ため、
    機能が正しく動いていてもこのアサーションは失敗する。表示中ブロックの
    hashで採番されるnav ボタン（`block-detail-next-${firstHash}`）が消えたこと
    で差し替わりを判定するよう修正した（Playwrightの実機実行は未確認だが、
    コードレベルの論理的な不備として修正。実機検証はchainviz-qaに委ねる）。

- **確認**: `pnpm lint && pnpm build && pnpm test`が全パッケージで通ることを
  確認済み（frontend 3090件・collector 1673件・shared 75件・e2eは
  `tsc --noEmit`型検証のみ。e2eのPlaywright実機実行は未実施）。

### 2026-07-23 Issue #409 チェーンを遡れるようにしたい（レビュー）
- 担当: reviewer
- ブランチ: issue-409-block-detail-navigation（レビューは、既に別worktreeで
  当該ブランチをチェックアウト中だったため、同一コミットを指す一時ローカル
  ブランチ`review-issue-409`上で実施した。内容は同じコミット履歴）
- 判定: **合格**

- **確認した内容**:
  - `main`との差分全体（`packages/shared`・collector側の変更が無いこと、
    frontend + e2eのみで完結していることを含む）を読んだ。設計メモ・
    ARCHITECTURE.md §17との整合を確認し、齟齬は見つからなかった
  - 境界の遵守: フロントはDocker/ノードAPIに直接触れていない。チェーン
    固有語彙（`eth_getLogs`等）の漏出も無い。`blockDetail.ts`は既存の
    `BlockEntity`/`TransactionEntity`の再結合のみで新規観測を伴わない
  - チェーンプロファイルの独立性: 既存プロファイルへの分岐追加は無い
  - `packages/shared`: 変更なし。ビルド・テストへの影響なしを確認
  - `findChildBlock`のtie-break規則が`chainRibbon.ts`の
    `pickCanonicalPerNumber`と実際に一致することは妥当な設計判断と判断した。
    両者は`latestReceiptTime`（`blockPulse.ts`、両ファイルで共通利用）を
    入力に使う同一の比較式を独立に持っているが、走査対象（「特定ブロックの
    子候補」対「同一番号内の正史選択」）が異なるため関数の直接共有はしづらく、
    tester担当が追加したcross-checkテスト（`findChildBlock`の勝者と
    `deriveRibbonTiles`経由の正史選択が一致することを直接突き合わせる）が
    規則の乖離を検知できるため、リスクは許容範囲内と判断した
  - 固定値の妥当性: `BLOCK_DETAIL_TX_DISPLAY_LIMIT = 100`は表示密度の
    安全弁であり、`mempoolList.ts`の`MEMPOOL_TX_DISPLAY_LIMIT`と同種で
    データの動的な性質に依存しない値。collectorの`BLOCK_RETENTION`
    （32、現状不変）はこの実装のどこにもハードコードされておらず、常に
    frontendに届くデータ（`blocksByHash`）から動的に導出している。
    e2eテストの待機時間（`BLOCK_DETAIL_TIMEOUT_MS`）も`SLOT_DURATION_MS`
    から導出する動的な式であり、決め打ちの絶対値ではない
  - エラーの握りつぶし: 今回の変更はいずれも純粋関数・表示コンポーネントで
    非同期処理や`catch`を含まない。該当なし
  - ダングリングガード: 既存の`contractSource`と全く同じ仕組み
    （`useEffect`で`dangling`を監視して`close()`）を再利用しており、
    新規のバグ混入リスクは低い
  - ビルド・lint・テスト: `pnpm lint && pnpm build && pnpm test`を
    リポジトリ全体で実行し、全パッケージ通過を確認した（frontend
    3090件・collector 1673件・shared 75件・e2e(vitest) 185件、e2eの
    `build`は`tsc --noEmit`）。worklogの申告と一致
  - テストコードの質: `blockDetail.test.ts`はフォークのtie-break・Map反復
    順非依存・`isLatest`とchildの独立成立・nonce欠損tx・
    `limitBlockTransactions`の境界（ちょうど上限・0・空）等、異常系・境界値を
    広くカバーしている。`SidePanelHost.blockDetail.test.tsx`は
    ダングリングガードの発火・親hashリンクからのナビゲーション・tx絞り込みを
    個別に検証しており、実装の詳細をなぞるだけの無意味なテストにはなって
    いない。テストファイルもCLAUDE.mdの1ファイル1責務方針に沿って関心事
    ごとに分割されている
  - スコープの逸脱確認: tx行からウォレット/コントラクトカードへのジャンプ
    機能は追加されておらず（ARCHITECTURE.md §17.4で明示的に対象外とした
    範囲）、過剰実装は見当たらない。保持窓外への遡及RPCも追加されていない
  - コミット粒度: `git log main..HEAD`で8コミットを確認し、
    「データ導出関数の追加」「サイドパネルviewの追加」「導線の配線」
    「e2eシナリオ追加」「worklog記録」「テスト強化」「e2eアサーション
    修正」がそれぞれ独立したコミットに分かれており、1変更1コミットの
    方針に沿っていた
  - docsとの整合: `docs/ARCHITECTURE.md` §17・`docs/PLAN.md`のチェック
    ボックス・`packages/e2e/SCENARIOS.md`のUI-B-07が実装内容と一致して
    いることを確認した

- **軽微な所感（合否に影響しない）**: `findChildBlock`と
  `pickCanonicalPerNumber`のtie-break比較式そのもの（6行程度）は独立実装
  のまま重複している。将来この規則を変える際は両方の更新が必要になる点は
  worklogに明記済みであり、cross-checkテストが安全網として機能するため、
  現時点でこの設計を変更させる指摘はしない

- **次の担当**: chainviz-qaによる実機検証（特にPlaywright
  `block-detail.spec.ts`の実行と、保持窓境界・フォーク時の前後ナビゲーション
  の目視確認）を推奨する。
