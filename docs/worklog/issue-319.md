# Issue #319 ウォレットのtx履歴に各txのnonce値が表示されず送信順序が追いにくい

### 2026-07-16 Issue #319 テスト強化（tester）

- 担当: tester
- ブランチ: issue-319-tx-nonce-display-frontend（collector/frontend実装が合流済み）
- 目的: 実装担当が書いた基本テストに対し、異常系・境界値のケースを追加する
  （実装ロジックは変更しない）。

追加したテスト:

- `packages/collector/src/adapters/ethereum/eth-rpc-client.test.ts`
  （`normalizeNonce`経由の`getTransactionByHash`）:
  - 大文字の16進桁（"0x2A"）を正しく数値化する（BigIntは桁の大小を区別しない）。
  - 明示的な`null`のnonce（フィールド欠落=undefinedとは区別し、想定外値として
    ログを出したうえで省略する）。
  - `Number.MAX_SAFE_INTEGER`を超える極端に大きい16進値でも、BigInt→Number
    変換は例外にならず有限の（精度は落ちる）数値になり、NaNにはならず nonce も
    省略されない。現状挙動を固定する回帰テスト。
  - 空文字のnonce（`BigInt("")===0n`のため0として記録され、欠落・不正値と
    異なりログは出ない）。想定外だが実害の小さい既存挙動を明示的に固定した。
- `packages/collector/src/adapters/ethereum/transactions.test.ts`
  （`recordInclusion`のnonce保持）:
  - pending時にnonceが無く（existingはあるがnonce欠落）、inclusionでも無い場合、
    nonceフィールドをでっち上げず省略のまま保つ。
  - 別ブロックへの再取り込み（reorg相当）を複数回またいでも、最初のpending
    観測nonceを保持し続ける（existing優先が複数回のinclusionをまたいで効く）。
  - 同一nonceを持つ複数tx（正常系では起きないが防御的に）を、hashごとに独立して
    保持する。
- `packages/frontend/src/entities/WalletPopover.nonce.test.tsx`
  （`WalletPopoverTxItem`のnonce表示条件）:
  - walletAddressが大文字・tx.fromが小文字という逆方向の大文字小文字混在でも
    一致する（比較の対称性。既存テストはfrom側のみ大文字化していた）。
  - tx.fromが空文字でも例外を投げず、一致しないため nonce を出さない。
  - 送信txと受信txが混在する履歴で、送信txにのみ nonce を出し受信txには
    出さない。
  - 大きいnonce値をそのまま連結して表示する。

回帰検出力の確認: frontendの比較を`walletAddress.toLowerCase()`から素の
`walletAddress`へ意図的に壊すと逆方向テストが落ちること、collectorの
`normalizeNonce`を`MAX_SAFE_INTEGER`超でNaNを返すよう壊すと大nonceテストが
落ちることを確認してから元に戻した。

確認結果:

- `pnpm --filter @chainviz/collector build` / `pnpm --filter @chainviz/frontend build`:
  いずれも成功。
- `pnpm --filter @chainviz/collector test`: 64ファイル / 1458テスト（+7）全通過。
- `pnpm --filter @chainviz/frontend test`: 144ファイル / 2129テスト（+4）全通過。

実装のバグは見つからなかった。空文字nonceが0になる点・大nonceで精度が落ちる点は
いずれも想定外入力に対する現状挙動で、実運用のdevnetでは発生しないため差し戻しは
行わず、挙動固定のテストとして記録するに留めた。

### 2026-07-16 Issue #319 frontend実装 設計メモ・着手前
- 担当: frontend
- ブランチ: issue-319-tx-nonce-display-frontend
- 設計メモ:
  - `packages/shared/src/world-state/entities.ts` の `TransactionEntity.nonce?: number`
    は設計担当（chainviz-designer）が別ブランチで先に実装済みのコミット
    （020d4e2）を cherry-pick して取り込む。frontend側はこの型を読むだけ。
  - `WalletPopoverTxItem`（`packages/frontend/src/entities/WalletPopover.tsx`）に
    `walletAddress: string` prop を追加し、`tx.nonce !== undefined && tx.from`
    がそのウォレット自身（大文字小文字を無視して比較）の場合のみ nonce を
    表示する。受信txの`nonce`は送信元ウォレットのものであり、そのまま出すと
    行の主語（このウォレットの送信順序）と食い違って誤解を招くため、送信tx限定
    にする。
  - 表示位置はhash直後・statusチップの前。文言は既存の `field.nonce` 翻訳キー
    を再利用し `${t("field.nonce")} ${tx.nonce}` の文字列結合で組み立てる
    （`t()` はプレースホルダ非対応のため）。
  - CSSクラスは `wallet-popover__tx-nonce` を新設してスコープする（Issue #320が
    同じファイルのul/li構造を今後触る予定のため、クラス名衝突を避ける）。
  - `GlossaryTerm` は行内に付けない（行ホバーは既に `TxLifecyclePopover` 用の
    ため、入れ子のホバーUIを避ける）。
  - `WalletPopover` 本体の `transactions.map` から `walletAddress={entity.address}`
    を渡す。
  - テストは既存の `WalletPopover.test.tsx`（tx呼び出しプレビュー・トークン
    残高のテストで既に263行と大きめ）に追記せず、既存の
    `Component.concern.test.tsx` 命名パターン（例:
    `InfraNodeCard.forkColor.test.tsx`）に倣い `WalletPopover.nonce.test.tsx`
    を新規作成して関心事を分離する。

### 2026-07-16 Issue #319 frontend実装 完了
- 担当: frontend
- ブランチ: issue-319-tx-nonce-display-frontend
- 内容:
  - `packages/shared` の型変更（020d4e2、`TransactionEntity.nonce?: number`）を
    cherry-pick で取り込み（コンフリクトなし）。
  - `packages/frontend/src/entities/WalletPopover.tsx` の
    `WalletPopoverTxItem` に `walletAddress` prop を追加し、送信tx限定
    （`tx.nonce !== undefined && tx.from.toLowerCase() === walletAddress.toLowerCase()`）
    でnonceをhash直後・statusチップ前に表示。`data-testid`は既存の
    `wallet-tx-call-${tx.hash}` に倣い `wallet-tx-nonce-${tx.hash}` を付与。
  - `packages/frontend/src/styles.css` に `.wallet-popover__tx-nonce` を新設
    （`--muted` 色・10pxの控えめな添え書き）。
  - `WalletPopover` 本体の `transactions.map` から `walletAddress={entity.address}`
    を渡すよう変更。
  - `packages/frontend/src/entities/WalletPopover.nonce.test.tsx` を新規作成し、
    送信tx(nonce表示)・受信tx(非表示)・nonce未観測(非表示)・nonce=0(表示、
    値0が省略と混同されないこと)・アドレス大文字小文字無視の一致、の5ケースを
    カバー。`showNonce` の判定を意図的に `false` 固定へ壊した状態で該当3ケースが
    実際に落ちることを確認してから元に戻し、回帰検出力があることを確認済み。
- 決定事項・注意点:
  - collector側のnonce観測実装は別のエージェントが並行して別ブランチ
    （`issue-319-tx-nonce-display`）で進めており、本ブランチには未合流。
    実データでのnonce値取得は collector 側の合流を待つ必要がある
    （現状のfrontend実装は `TransactionEntity.nonce` が入っていれば表示する
    だけで、値の出所には関知しない）。
  - `pnpm --filter @chainviz/frontend build` と
    `pnpm --filter @chainviz/frontend test` はいずれも成功
    （144テストファイル・2125テスト、全パス）。
  - `docs/PLAN.md` のIssue #319チェックボックスは、collector側の合流・
    実機QAが完了してから統括がチェックする想定のため、本作業では更新して
    いない（frontend単独では完全な機能検証ができないため）。

### 2026-07-16 Issue #319 設計（tx履歴のnonce表示）

- 担当: designer
- ブランチ: issue-319-tx-nonce-display
- 内容: 設計メモ（実装は未着手。`packages/shared` の型追加のみ本ブランチで実施済み）

## 設計メモ

### 現状確認の結果

- `TransactionEntity`（`packages/shared/src/world-state/entities.ts`）に
  nonce は**含まれていなかった**。型追加が必要
- collector の tx 観測経路は2系統:
  1. **pending 検知**: `EthereumAdapter.handlePendingTx`（`adapters/ethereum/index.ts`）
     が `eth_getTransactionByHash` で tx 詳細を取得 →
     `TransactionLifecycleTracker.recordPending`（`adapters/ethereum/transactions.ts`）。
     このレスポンスには `nonce`（16進文字列）が**含まれる**が、現状の正規化
     （`eth-rpc-client.ts` の `normalizeTransaction` → `RpcTransaction`）は
     hash/from/to/input しか取り出していない
  2. **ブロック取り込み**: `handleBlockInclusion` が `eth_getBlockReceipts` →
     `recordInclusion`。receipt には **nonce が含まれない**（Ethereum の
     receipt 仕様）

### 決定した仕様上の判断（理由つき）

1. **`TransactionEntity.nonce?: number`（optional）を追加**（実施済み）。
   - optional の理由: (a) 旧スナップショット互換、(b) pending を経ず
     取り込みだけを観測した tx では receipt から取れない。省略 = 情報なしで
     フロントは表示を出さない側に倒す（`contractCall` と同じ流儀）
   - `nonce: 0` は「そのアカウントの最初の送信」という意味のある観測値。
     省略と取り違えない（falsy 判定禁止。`!== undefined` で判定する）
2. **取り込みのみ観測の tx のために追加 RPC を発行しない**。
   `eth_getBlockByHash`（full tx）や tx ごとの `eth_getTransactionByHash` で
   埋めることは可能だが、「ブロックあたりの RPC 呼び出し回数を増やさない」
   （Issue #86 の方針。`eth-rpc-client.ts` の `getBlockReceipts` コメント参照）
   を維持する。ワークベンチ発の tx は必ず pending 経由で観測されるため、
   学習目的（自分が送った tx の順序を追う）には十分
3. **nonce は「送信 tx」にのみ表示する**（frontend）。
   `WalletEntity.recentTxHashes` は from/to 両方の一致で紐づくため
   （`world-state/store.ts` の `linkTransactionToWallets`）、受信 tx も
   一覧に載る。nonce は送信元アカウントの連番なので、受信 tx に送信者側の
   nonce を出すと、ポップオーバー上部の自ウォレットの nonce と混同する。
   `tx.from` とウォレットアドレスの小文字化比較で送信 tx のみ表示する
4. **行内に GlossaryTerm は付けない**。tx 行のホバーは既に
   `TxLifecyclePopover` に割り当てられており、ホバー要素の入れ子を避ける。
   nonce の用語解説アンカーは上の「nonce」フィールドラベルが既に持つ
5. **i18n は既存キー `field.nonce`（ja: "nonce" / en: "Nonce"）を再利用**。
   `t()` はプレースホルダ非対応（`LanguageProvider` の `t: (key) => string`）
   なので、`{t("field.nonce")} {tx.nonce}` の連結で組む。新キー不要

### データフロー（実装担当への引き継ぎ）

```
eth_getTransactionByHash レスポンス（nonce: "0x3"）
  → [collector] normalizeTransaction が数値化して RpcTransaction.nonce へ
  → handlePendingTx が TxDetail.nonce として recordPending へ
  → TransactionEntity.nonce = 3（recordInclusion は既存値を引き継ぐ）
  → WebSocket 経由でフロントへ（プロトコル変更なし）
  → [frontend] WalletPopoverTxItem が送信 tx なら「nonce 3」を表示
```

### collector 側の作業（chainviz-collector）

- `adapters/ethereum/eth-rpc-client.ts`:
  - `RpcTransaction` に `nonce?: number` を追加
  - `normalizeTransaction` で raw の `nonce`（16進文字列）を
    `Number(BigInt(hex))` で数値化（既存 `fetchNonce` と同じ変換）。
    欠落・非文字列・BigInt 変換不能は**省略に倒す**（input の "0x"
    フォールバックと同じ防御的姿勢。tx 全体を捨てない）
  - `RpcTransactionReceipt` は変更しない（receipt に nonce は無い）
- `adapters/ethereum/transactions.ts`:
  - `TxDetail` に `nonce?: number` を追加（`TxInclusionDetail` は
    `TxDetail` を extends しているので自動的に持つ）
  - `recordPending`: `detail.nonce` を entity へ（`contractCall` と同じ
    スプレッドパターンで、undefined ならフィールド自体を省略）
  - `recordInclusion`: `existing?.nonce ?? tx.nonce` を entity へ引き継ぐ
    （tx の nonce は不変なのでどちらでも同値だが、from/to と同じ
    「既存優先」の流儀に合わせる。receipt 経路では tx.nonce は常に
    undefined なので、実質は pending 時の観測値の保持）
- `adapters/ethereum/index.ts` の `handlePendingTx`:
  `recordPending` へ渡すオブジェクトに `detail.nonce` を追加
- テスト: `normalizeTransaction` の nonce 正規化（正常・欠落・不正値・
  "0x0"）、tracker の pending→inclusion をまたぐ nonce 保持

### frontend 側の作業（chainviz-frontend）

- `entities/WalletPopover.tsx` の `WalletPopoverTxItem`:
  - props に `walletAddress: string` を追加（呼び出し元 `WalletPopover` が
    `entity.address` を渡す）
  - 表示条件: `tx.nonce !== undefined && tx.from.toLowerCase() ===
    walletAddress.toLowerCase()`
  - 表示位置: `shortHex(tx.hash)` の**直後、status チップの前**。
    行の並びは「hash → nonce → status チップ → TxCallPreviewLine」
    （hash = 同一性、nonce = 順序の修飾、status = 結果、と読み下せる並び。
    `TxCallPreviewLine` は末尾のまま変えない）
  - 文言: `{t("field.nonce")} {tx.nonce}`（例: ja「nonce 3」/ en「Nonce 3」）。
    小さめの補助テキスト（クラス例: `wallet-popover__tx-nonce`）、
    `data-testid={`wallet-tx-nonce-${tx.hash}`}`
  - 送信判定の小文字化比較は純粋関数（例: `transaction.ts` に
    `isTxSentBy(tx, address)` を追加）として切り出すとテストしやすい
    （関数名・置き場所は実装担当の判断でよい）
- テスト: 送信 tx で nonce が出る / 受信 tx では出ない / nonce 未観測
  （undefined）では出ない / `nonce: 0` は「nonce 0」と出る

### Issue #320（tx履歴のスクロール）との調整

- **#319 を先に実施**し、#320 はその上に積む（統括の計画どおり）
- 責務の分割: #319 は**行の中身**（`WalletPopoverTxItem`）、#320 は
  **一覧のコンテナ**（`wallet-popover__tx-list` のスクロール・
  `DEFAULT_RECENT_TX_LIMIT`・collector 側 `MAX_WALLET_RECENT_TX_HASHES`）。
  重なりは小さい
- #319 では行構造の変更を「span 1個の追加」に留め、リスト側
  （ul/li の構造・件数制御）には手を入れないこと。CSS 追加も
  `wallet-popover__tx-nonce` にスコープし、リスト全体のレイアウト変更を
  持ち込まない（#320 とのコンフリクト回避）
- #320 で表示件数が増えると古い tx が evict 済み（collector の
  `TransactionLifecycleTracker` は maxTxs=1000、store は Issue #303 の
  保持窓あり）で解決できないケースが増える点は #320 側の論点

### 本ブランチで実施済みの変更

- `packages/shared/src/world-state/entities.ts`: `TransactionEntity.nonce?:
  number` を追加（doc コメント付き）
- `packages/shared/src/world-state/entities.test.ts`: nonce の JSON 往復
  （`nonce: 0` の falsy 保持）と省略（キー自体が現れない）のテストを追加
- `docs/ARCHITECTURE.md`: §2 のスキーマに nonce を追記、§6.12
  「tx 履歴の nonce 表示（Issue #319）」を新設
- 確認: `pnpm lint && pnpm build && pnpm test` 全パッケージ通過
  （shared 64 / collector 1439 / frontend 2120 テスト）

### 2026-07-16 collector側実装（chainviz-collector）

- 担当: collector
- ブランチ: issue-319-tx-nonce-display（同ブランチ上で継続）
- 対象: `packages/collector/` のみ（frontend側は別ブランチで並行実装中）

#### 実施内容

1. `adapters/ethereum/eth-rpc-client.ts`
   - `RpcTransaction.nonce?: number` を追加。
   - `normalizeTransaction` に `normalizeNonce(txHash, rawNonce)` ヘルパーを
     追加し、raw の nonce（16進文字列）を `Number(BigInt(...))` で数値化。
     - フィールド欠落は正常系として黙って省略（そのノード実装/レスポンス
       に元々含まれないケース）。
     - フィールドは存在するが非文字列、または `BigInt()` が例外を投げる
       不正値の場合は `console.error` でログした上で省略する（CLAUDE.md の
       「エラーを握りつぶさない」ルールに従い、想定外ケースのみログする。
       欠落と不正値でログの要否を分けた）。
2. `adapters/ethereum/transactions.ts`
   - `TxDetail.nonce?: number` を追加。
   - `recordPending`: `detail.nonce !== undefined` のときだけ entity に
     `nonce` を載せる（`contractCall` と同じスプレッドパターン）。
   - `recordInclusion`: `existing?.nonce ?? tx.nonce` を計算し、
     `createdContractAddress` と同じ「既存優先」の流儀で entity に反映。
     `TxInclusionDetail` は `TxDetail` を extends しているため型変更は不要。
3. `adapters/ethereum/index.ts`
   - `handlePendingTx` が `recordPending` に渡すオブジェクトへ
     `detail.nonce` を追加（`detail.nonce !== undefined` のときだけ）。
   - 該当メソッドのdocコメントにnonceの扱い（追加RPCなし、取り込みのみ
     観測のtxには付与しない）を追記。

意図的に行わなかったこと: 取り込みのみ観測したtx（pendingを経ずブロック
取り込みだけを観測したtx）へのnonce付与。設計メモの通り、追加RPCを
発行しない方針（Issue #86）を維持するため、この場合はnonce省略のまま。

#### テスト

- `eth-rpc-client.test.ts`: `getTransactionByHash` の既存テスト1件を
  nonce付きレスポンスの期待値に合わせて更新（nonce: "0x0" → 0が出力に
  含まれることを確認するテストに変化）。新規に
  `describe("nonce (sender account tx counter, Issue #319)")` を追加し、
  正常な16進値の数値化・`"0x0"`が省略されず0として出ること・フィールド
  欠落時は省略されること・非文字列や変換不能値のときは省略した上で
  `console.error` が呼ばれることを確認。
- `transactions.test.ts`: `recordPending nonce (Issue #319)` /
  `recordInclusion nonce (Issue #319)` の2つのdescribeを追加。nonce付与・
  nonce 0が省略と区別されること・未提供時は省略されること・pending時に
  観測したnonceがinclusion後も引き継がれること・pendingを経ないtxには
  nonceが付かないことを確認。
- `transaction-subscribe.test.ts`: アダプタ経由のend-to-endテストを1件
  追加。`stubRpcClient` のtxsフィクスチャは正規化後の`RpcTransaction`型で
  固定されており16進文字列→数値の正規化を経由できないため、この
  テストだけは`eth_getTransactionByHash`の生レスポンス（nonce: 16進
  文字列）を返す`EthRpcClient`を直接組み立てて、
  `handlePendingTx`→`normalizeTransaction`→`recordPending`の一連が
  正しく数値化されたnonceを`TransactionEntity`まで届けることを確認した。

#### 確認結果

- `pnpm --filter @chainviz/collector build`: 成功。
- `pnpm --filter @chainviz/collector test`: 64ファイル / 1451テスト
  全て通過（変更前1439テストから+12）。
- `npx eslint`（変更したファイルを個別指定）: エラーなし。

#### 申し送り

- `docs/PLAN.md` の該当チェックボックスは、frontend側（別ブランチで並行
  実装中）と合流してから更新する想定。collector単体では機能として
  観測はできてもUI表示が伴わないため、このタイミングではチェックを
  付けていない。
- frontend側が`WalletPopoverTxItem`に表示する際、`TransactionEntity.nonce`
  は`undefined`（省略）と`0`を区別して扱う必要がある（falsy判定禁止。
  設計メモにも明記済み）。

### 未確定・実装時に判断してよい点

- frontend の送信判定ヘルパーの関数名・置き場所
- nonce 表示の細かな見た目（フォントサイズ・色。既存の補助テキストの
  トーンに合わせる）
- `TxLifecyclePopover`（tx 行ホバーの詳細）にも nonce を出すかは本 Issue の
  スコープ外とした（WalletPopover の一覧行で順序が追えれば目的は達成。
  必要なら別途 UX 判断）
