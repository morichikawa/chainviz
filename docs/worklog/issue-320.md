# Issue #320 ウォレットのtx履歴が直近6件に固定されスクロールで遡れない

### 2026-07-16 Issue #320 frontend実装 設計メモ・着手前

- 担当: frontend
- ブランチ: issue-320-tx-history-scroll-frontend
- 対象: `packages/frontend/` のみ（collector側の`MAX_WALLET_RECENT_TX_HASHES`
  拡張は別ブランチ`issue-320-tx-history-scroll`で並行実装され、後日統括が
  合流させる想定）

設計方針（`chainviz-ux`の設計メモの要点を踏まえる。全文は別ブランチのため
未参照。以下は引き継いだ要点に基づく判断）:

- **カード面とポップオーバーで解決件数を分離する**。現状
  `walletsToFlowNodes`が`resolveWalletTransactions(entity, ctx.txByHash)`を
  1回だけ呼び、その結果（既定6件）を`WalletNodeData.transactions`に格納して
  `WalletCard`（カードのチップ表示）と`WalletPopover`（ポップオーバー一覧）の
  両方に使い回していた。カード面のチップ表示は密度上6件のままが適切
  （`chainviz-ux`の判断）だが、ポップオーバーは全件見えるべきなので、
  `WalletNodeData`に`popoverTransactions`を新設し、
  `resolveWalletTransactions(entity, ctx.txByHash, Number.POSITIVE_INFINITY)`
  で全件解決する。`DEFAULT_RECENT_TX_LIMIT`（6）自体はカード用の値として
  そのまま残す（`transaction.ts`は変更しない）。
- `isSameWalletNode`（Issue #119の参照安定化）に`popoverTransactions`の
  比較を追加する（既存の`transactions`/`settlingHashes`と同じ
  `sameByReference`パターン）。追加しないと、ポップオーバー内容が変わっても
  React Flowの再描画スキップにより古い一覧が表示され続ける不具合になる。
- `WalletCard`は`WalletPopover`へ渡す`transactions`propを
  `data.popoverTransactions`に差し替える（カード面のチップは引き続き
  `data.transactions`＝6件のまま）。
- **ポップオーバーのスクロール対応**: `.wallet-popover__tx-list`に
  `max-height: 220px; overflow-y: auto`を追加し、細いスクロールバー
  （webkit系の`::-webkit-scrollbar`、Firefox系の`scrollbar-width: thin`）を
  常時表示にする。ポップオーバー自体の横幅を安定させるため、新規修飾クラス
  `.wallet-popover`（`max-width: 360px`）を`WalletPopover`のルート
  `PopoverPortal`の`className`に追加する（既存の`.infra-popover`と併記し、
  他のポップオーバー種別と衝突しないスコープにする）。
- `wallet-popover__tx-list`はこれまでCSS定義が無く、ブラウザ既定の
  リストスタイル（黒丸ビュレット・40pxインデント）のままだった。
  スクロール対応のついでにリスト装飾（`list-style: none`・`padding`・
  `margin`）も整える。
- **件数表示**: 新規i18nメッセージキー`wallet.recentTxCount`
  （`{count}`プレースホルダを含む文字列。ja: "直近の tx（{count}件）"、
  en: "Recent tx ({count})"）を追加し、tx一覧の見出しに件数を表示する。
  実装では既存の`format()`ヘルパー（`i18n/i18n.ts`。`{key}`プレースホルダを
  実行時の値へ置換する。`ChainRibbonCard`の`chainRibbon.txBadge`が同じ
  パターンで既に使っている）を使う。引き継いだ設計メモには「t()は
  プレースホルダ非対応のためIssue #319と同様に文字列結合で組み立てる」との
  記載があったが、#319のnonce表示（`{t("field.nonce")} {tx.nonce}`）は
  値が文末に単純追記されるだけの形だったのに対し、今回は「（…件）」と
  値を文中の決まった位置に埋め込む必要があり、単純な前後結合では日本語・
  英語で異なる括弧の位置・全角/半角に対応できない。`format()`は既に
  `chainRibbon.txBadge`で同種の用途に使われている既存ヘルパーであり、
  自前で同等のプレースホルダ置換を再実装するより一貫性が高いと判断し、
  こちらを採用する。0件時は従来どおり`wallet.noTx`のみを表示し件数行は
  出さない（0件なら文脈上不要なため）。
- 「もっと見る」ボタン・下端フェードは設計担当の判断で不採用（除外仕様）。
  実装しない。
- `packages/frontend/src/websocket/mockData.ts`のAlice tx履歴は
  `advanceTxLifecycle`内で`nextRecent.slice(6)`のようにハードコードされた
  6件上限で間引かれていた。スクロール動作をモックモード（オフライン）でも
  確認できるよう、この上限を新設の名前付き定数
  `MOCK_ALICE_RECENT_TX_LIMIT = 20`に置き換える（既存の
  `INITIAL_ALICE_NONCE`等と同じ命名パターン）。
- 対象外: `WalletPopoverTxItem`内部（Issue #319で追加されたnonce表示・
  `walletAddress` prop）には手を入れない（#319との競合回避、依頼文の
  明示的な指示どおり）。

実装後は`pnpm --filter @chainviz/frontend build`と
`pnpm --filter @chainviz/frontend test`で確認する。

### 2026-07-16 Issue #320 frontend実装 完了報告

- 担当: frontend
- ブランチ: issue-320-tx-history-scroll-frontend（mainから作成。collector側の
  `MAX_WALLET_RECENT_TX_HASHES`拡張は含まない。別ブランチ
  `issue-320-tx-history-scroll`と後日合流予定）

実装内容（上記設計メモどおり）:

- `packages/frontend/src/entities/walletNode.ts`: `WalletNodeData`に
  `popoverTransactions`を追加。`walletsToFlowNodes`で
  `resolveWalletTransactions(entity, ctx.txByHash, Number.POSITIVE_INFINITY)`
  により全件解決する。カード用の`transactions`（`DEFAULT_RECENT_TX_LIMIT`＝
  6件）は変更なし。`isSameWalletNode`に`popoverTransactions`の
  `sameByReference`比較を追加。
- `packages/frontend/src/entities/WalletCard.tsx`: `WalletPopover`へ渡す
  propを`transactions`（6件）から`popoverTransactions`（全件）に差し替え。
- `packages/frontend/src/entities/WalletPopover.tsx`: tx一覧の見出しに
  `wallet.recentTxCount`（`format()`で件数埋め込み）を表示。0件時は従来どおり
  `field.recentTx`のみ。ルート`PopoverPortal`の`className`に`wallet-popover`
  修飾クラスを追加。tx一覧自体は元々`transactions`を全件`.map`していたため、
  呼び出し側が全件を渡せばコンポーネント内部の変更なしで全件描画される。
- `packages/frontend/src/i18n/messages.ts`: `wallet.recentTxCount`
  （ja: "直近の tx（{count}件）"、en: "Recent tx ({count})"）を追加。
- `packages/frontend/src/styles.css`: `.wallet-popover`（`max-width: 360px`）・
  `.wallet-popover__tx-list`（`max-height: 220px`・`overflow-y: auto`・
  `list-style: none`・`scrollbar-width: thin`・`::-webkit-scrollbar`系）・
  `.wallet-popover__tx-item`（区切り線）を追加。
- `packages/frontend/src/websocket/mockData.ts`: Aliceの`recentTxHashes`
  保持上限を新設の`MOCK_ALICE_RECENT_TX_LIMIT = 20`に引き上げ（旧
  ハードコード値`6`を置換）。

設計メモからの変更点: 件数表示の実装方法を、引き継いだメモにあった
「文字列結合」ではなく既存の`format()`ヘルパーで実装した（設計メモの
「実装方針」節に採用理由を記載済み）。それ以外は設計メモどおり。

テスト（すべて新規追加。既存テストはロジック変更に伴う型エラー修正のみ）:

- `packages/frontend/src/entities/walletNode.popoverTransactions.test.ts`:
  `popoverTransactions`が全件解決されること、カード用`transactions`が
  引き続き6件に絞られること、未解決ハッシュの除外、空配列時の挙動、
  `isSameWalletNode`が新フィールドの変化を検出すること（超過分のtxだけが
  変化し card面の`transactions`は完全に不変というケースで検証）。
- `packages/frontend/src/entities/WalletPopover.scroll.test.tsx`: tx一覧が
  `DEFAULT_RECENT_TX_LIMIT`を超えて全件描画されること、`wallet-popover`
  クラスの付与、日英それぞれの件数見出し、0件時のフォールバック表示。
- `packages/frontend/src/entities/walletPopoverStyles.test.ts`: jsdomは
  スタイルシートのカスケードを評価しないため、コンポーネントテストでは
  実際のスクロール可否を検証できない。`styles.css`の内容を直接読み込み、
  `max-height`/`overflow-y`/`scrollbar-width`等の宣言が存在することを
  正規表現で固定する回帰テスト（`peerEdge.test.ts`の色リテラル固定と同種の
  手法）。`import.meta.url`はjsdom環境でfileスキームにならないため
  （`glossary/parse.test.ts`と同じ制約）、cwdから探索する方式にした。
- `packages/frontend/src/entities/WalletCard.popoverTransactionsIntegration.test.tsx`:
  `WalletCard`を実際にホバーし、カードのチップ件数とポップオーバーの
  一覧件数が異なる（ポップオーバーの方が多い）ことを確認する統合テスト。
  `data.transactions`を渡し戻す配線ミスの再発を検出できる。
- `packages/frontend/src/websocket/mockData.txHistoryLimit.test.ts`:
  モックのAlice tx履歴が旧上限(6)を超えて増え続けること、新上限(20)で
  頭打ちになること、超過分が`entityRemoved`で掃除されることを確認。
- `packages/frontend/src/i18n/i18n.test.ts`: `wallet.recentTxCount`の
  ja/en訳・`{count}`プレースホルダ存在の回帰チェックを追加。

既存テストのうち、`WalletNodeData`のオブジェクトリテラルを直接構築していた
以下のテストファイルは、新規必須フィールド`popoverTransactions`追加に伴う
型エラーを解消するため`popoverTransactions`を追記した（ロジック変更ではなく
型整合のための機械的な追記）: `WalletCard.test.tsx` /
`txLifecyclePopoverHover.test.tsx` / `canvasLayers.test.ts` /
`chainRibbonCrossHighlight.test.tsx` / `canvasNode.test.ts` /
`interaction/popoverPortalConsistency.test.tsx`。

確認結果:

- `pnpm --filter @chainviz/frontend build`: 成功。
- `pnpm --filter @chainviz/frontend test`: 149ファイル / 2169テスト
  全通過（追加分を含む）。
- `npx eslint`（変更した全ファイル対象）: エラーなし。

次の担当（レビュー・QA・統括による合流作業）への注意点:

- 本ブランチは`packages/frontend/`のみの変更。collector側の
  `MAX_WALLET_RECENT_TX_HASHES`拡張（別ブランチ
  `issue-320-tx-history-scroll`）と合流させないと、実環境では
  collectorが保持する件数（現状の上限）までしかポップオーバーに
  表示されない（モックモードでは`MOCK_ALICE_RECENT_TX_LIMIT=20`により
  スクロール動作を確認できる）。
- `docs/PLAN.md`のIssue #320チェックボックスは、collector側の変更が
  合流し両方揃って初めてIssue全体の完了条件を満たすため、このコミット
  時点ではまだチェックしていない（統括の合流作業後に更新する想定）。

**collector（chainviz-collector）**

- `packages/collector/src/world-state/store.ts` の
  `MAX_WALLET_RECENT_TX_HASHES` を **20 → 32 に引き上げ**、コメントを更新する。
  - 根拠: フロントが「保持分を全件表示」するようになるため、この定数が
    そのまま履歴の実効上限になる。一方、included/failed tx エンティティは
    block の保持窓（`BLOCK_RETENTION` = 32）と連動して掃除されるため
    （Issue #298/#303）、32 ブロックより古い tx は hash が残っていても
    フロントで解決できない（`resolveWalletTransactions` が除外する）。
    1 ブロック 1 tx 程度の典型的なデモ操作では「解決可能な上限 ≒
    BLOCK_RETENTION」なので、それに揃えた 32 が無駄なく最大。
  - 固定値の前提条件（CLAUDE.md のルールに従いコード内コメントにも書く）:
    `BLOCK_RETENTION` 以上に増やしても、1 ブロックに複数 tx が積まれる
    バースト時以外は解決不能な hash が増えるだけ。`BLOCK_RETENTION` を
    変える場合はこの値も併せて見直すこと。
  - `packages/shared` の型変更は**不要**（`recentTxHashes: string[]` のまま。
    件数はデータの長さの問題であり型に現れない）。

### 決めた事項（判断に迷ったら統括へ）

- ポップオーバーの表示件数に**フロント側の固定上限は設けない**（保持されて
  いる分 = collector の上限 32 件がそのまま上限）。「システムが保持している
  ものは全部見せる、保持ウィンドウ自体は CONCEPT.md の決定（tx 履歴は
  アニメーション再生に足りる直近ウィンドウのみ保持、それ以前は保持しない。
  CONCEPT.md 190 行目付近）に従う」という整理。無限の履歴を遡る機能に
  拡張しない。
- 「もっと見る」ボタンや遅延読み込みは**作らない**（保持上限が 32 件なら
  一括描画で性能上の問題は無い。先回り実装をしない原則）。
- 下端フェード等の追加のスクロールヒントは**入れない**（常時表示の
  スクロールバー + 見出しの件数表示で足りると判断。過剰装飾を避ける）。
- キーボード操作: 行の `tabIndex=0` は既存のまま。フォーカス移動で
  ブラウザが自動的にスクロール追従するため追加実装しない。なお
  「ポップオーバー自体がホバーでしか開かない」問題は既存の制約で、
  この Issue のスコープ外。

### Issue #319 との関係（競合しないことの確認）

#319（マージ済み）は行の中身（`WalletPopoverTxItem` に `walletAddress`
prop・nonce 表示・`wallet-popover__tx-nonce`）、#320 は一覧のコンテナ
（件数と `wallet-popover__tx-list` の CSS）と上流のデータ量を変える。
現在の `WalletPopover.tsx` を読んだ上で、#320 で `WalletPopoverTxItem` は
変更しない設計にした（ARCHITECTURE.md §6.12 の分担どおり）。

### 実装担当への注意点

- ARCHITECTURE.md に §6.13 として本設計（スクロール対応・保持上限 32 への
  変更）を追記すること（sync-docs）。
- テスト観点: `resolveWalletTransactions` の limit 省略/Infinity の挙動、
  WalletCard のチップが 6 件で切れること・pending 件数が全件基準なこと、
  WalletPopover が 7 件以上を全件描画すること、見出しの件数表示。
  collector 側は `linkTransactionToWallets` の上限 32 への既存テストの追随。
- QA 観点: 実環境（`pnpm dev:up`）でウォレットから tx を 7 件以上送り、
  ポップオーバー内へマウスを移してスクロールで 7 件目以降が見えること、
  スクロール中もポップオーバーが閉じないこと、ホイールでキャンバスが
  ズームしないことを確認する。

### 2026-07-16 collector 側実装（収集悟）

- 対象: `packages/collector/src/world-state/store.ts` の
  `MAX_WALLET_RECENT_TX_HASHES` を 20 → 32 に変更。
- コメントを設計メモの根拠（included/failed tx は `BLOCK_RETENTION`（32）と
  連動して掃除されるため、それ以上増やしても解決不能な hash が増えるだけ）
  に沿って書き換えた。`BLOCK_RETENTION` を変更する際はこの値も見直すよう
  明記した。
- `docs/ARCHITECTURE.md` 内の `MAX_WALLET_RECENT_TX_HASHES = 20` という
  古い記述（tx 保持窓のセクション）も 32 に更新した（sync-docs）。
  §6.13 としての本設計全体の追記は、frontend 側の実装と合わせて別途
  行われる想定（このコミットでは collector 変更に直接関係する箇所のみ
  修正）。
- テスト: `store-transaction-wallet-link.test.ts` の
  「caps recentTxHashes and drops the oldest entries beyond the limit」を
  新しい上限（32）に合わせて更新（投入件数を 25 → 37、期待される保持件数を
  20 → 32、先頭ハッシュの期待値を `0x24` → `0x36` に修正）。他のテストは
  上限値に依存しないため変更不要。
- 確認: `pnpm --filter @chainviz/collector build` / `pnpm --filter
  @chainviz/collector test` ともに成功（64 ファイル 1458 テスト全て pass）。
- `packages/shared` の型変更は無し（設計メモどおり `recentTxHashes:
  string[]` のまま）。
