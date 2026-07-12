# Issue #303 WorldStateStore の TransactionEntity 無制限蓄積の保持方針設計

### 2026-07-13 Issue #303 WorldStateStore の TransactionEntity が無制限蓄積する問題の設計
- 担当: designer（設計）
- ブランチ: issue-303-transaction-retention
- 内容: `WorldStateStore` に tx の保持窓を設ける方針を設計し、`docs/ARCHITECTURE.md`
  §10.4 に反映した。この設計フェーズでは実装ロジックは書かず、ドキュメントと
  設計判断の確定までを行う。shared 型変更は不要と判断した（コード変更なし）。

#### 問題の実体
- `WorldStateStore.applyTransaction` は `applyKeyed` を呼ぶだけで、tx を一度
  入れたら削除しない。block は #298 で番号窓（`BLOCK_RETENTION = 32`）を入れて
  有界化したが、tx は対象外のまま残っていた。
- 蓄積の主因は 2 つ:
  1. 通常運転でチェーン先端が進むたびに included/failed tx が増え続ける。
  2. addNode 直後の追いつき中ノードが過去ブロックの newHeads を大量に流し、
     `handleBlockInclusion` → `recordInclusion` → `applyTransaction` が過去
     ブロックの tx を大量に store へ入れる。`applyBlock` は番号窓で過去 block を
     弾くが、tx 側には同等のガードが無かったため、**block は store に無いのに
     その tx だけが store に残る**という不整合・漏れが起きうる。
- アダプタ内の `TransactionLifecycleTracker` は `maxTxs = 1000` で自前に evict
  するが、その evict を store へ `entityRemoved` として通知しないため、store の
  蓄積は止まらない。store は自前の保持窓で閉じる必要がある。

#### 決定した保持方針（種別で 2 系統）
- **included / failed tx（`blockHash` あり）は対応 block の store 内存在に連動**:
  - 入口ガード: `applyTransaction` で included/failed tx は、`blockHash` を id に
    持つ block が store に在るときだけ取り込む（`entities.get(tx.blockHash)` が
    `kind === "block"`）。無ければ空差分で捨てる。→ 追いつきフラッドの過去 tx は
    「その block が番号窓で弾かれ store に無い」ため同じ窓で自動的に弾かれる。
  - 退去: `applyBlock` の eviction で窓落ちする block の hash を集め、`blockHash`
    が一致する tx も削除して `entityRemoved` を配信。不変条件
    「included/failed tx が store に在る ⇔ その block が store に在る」を保つ。
  - これにより included/failed tx は「窓内 block 数 × ブロックあたり tx 数」で
    有界。tx に block 番号を持たせる shared 型変更は不要（block 存在で代替）。
- **pending tx（`blockHash` なし）は block eviction では絶対に消さない**:
  - block 連動の対象外にすることで「pending を誤って削除しない保証」を構造的に
    担保する（Issue の要求）。
  - 代わりに件数上限 `PENDING_TX_RETENTION`（既定 256）で有界化。超過時は
    `Map` の挿入順で最古の pending から間引き `entityRemoved` を配信。
  - pending → included 遷移は入口ガードを通過（block 先着済みなので取り込まれる）、
    以後は included として block 連動側へ移る。cap で消した pending が後に included
    になっても入口ガードで再取り込みされるため恒久的な取りこぼしにならない。

#### 前提条件（固定値・順序の明記。CLAUDE.md の固定値ルール）
- **観測順序の前提**: 同一ノードの newHeads について、B 層 `subscribeBlocks` は
  `onBlock` を同期で呼び、C 層 `subscribeTransactions` → `handleBlockInclusion` は
  receipt 取得を挟む非同期処理として tx を配信する。したがって block は対応する
  included/failed tx より先に store へ届く。入口ガード（block 存在が admit 条件）は
  この順序を前提とする。稀に tx が block より先着した場合、その in-window tx は
  一度だけ弾かれて再試行されない（実運用では onBlock 同期・tx 側 await receipt の
  差により事実上起きない）。
- **`PENDING_TX_RETENTION = 256` の前提**: 健全に稼働するチェーンでは pending は
  1〜2 ブロックで included へ流れて掃けるため同時滞留は少数。この上限は「一度も
  採掘されない tx（無効・過少ガス・置換で捨てられた）が病的に溜まり続ける」ケース
  だけを防ぐ安全弁で、今この瞬間の観測状態から導く値ではない。値を変える場合は
  この前提の見直しも行う。

#### 影響範囲
- **shared**: 型変更なし。`TransactionEntity.status` / `blockHash`、`BlockEntity`
  の `hash` / `number` の既存フィールドだけで成立する。
- **frontend**: 変更なし。フロントの store は `entityRemoved` を汎用に削除処理済み。
  `resolveWalletTransactions` は索引に無い hash（「既に掃除された tx」）を除外済み。
  `countTransactionsByBlockHash` / チェーンリボンのホバー連動 / `useTxLifecycle` は
  毎レンダー `transactions` から再計算するため削除が自然に反映される。included tx の
  退去は対応 block の退去と同時なのでリボンの件数バッジも整合したまま。
- **collector**: 実装対象（下記）。

#### 実装担当（collector）への引き継ぎ
- 変更ファイル: `packages/collector/src/world-state/store.ts`。
  - `PENDING_TX_RETENTION` 定数（前提コメント付き）を追加。
  - `applyTransaction`: included/failed は入口ガード（block 存在チェック）を追加、
    admit 後は従来どおり `applyKeyed`。pending は `applyKeyed` 後に pending 件数
    上限を適用し、超過分を最古から evict（`entityRemoved`）。
  - `applyBlock` / `evictBlocksBelow`: 窓落ち block の hash を集め、`blockHash` が
    一致する tx も削除して `entityRemoved` に含める（block 削除と同一差分で配信）。
    block の hash は `entityId(block)` = `block.hash` と一致するため `get` で O(1) 判定可。
- `packages/collector/src/index.ts`: `linkTransactionToWallets` は `applyTransaction`
  が tx を取り込んだ場合にだけ呼ぶよう配線を見直す（弾いた過去 tx を wallet の
  `recentTxHashes` に載せない）。
- アダプタの `TransactionLifecycleTracker`（`maxTxs = 1000`）は変更しない。
- テスト: store の tx 保持について、(1) included tx は block 退去と同時に消える、
  (2) 追いつきフラッドの過去 included tx（block 無し）は取り込まれない、
  (3) pending tx は block eviction で消えない、(4) pending 上限超過で最古から
  evict される、(5) pending → included 遷移が正しく差分化される、の観点で
  ユニットテストを追加する。既存 `store.test.ts` が肥大化するなら
  `store-transaction-retention.test.ts` として関心事ごとに分割する（1 ファイル
  1 責務。CLAUDE.md）。

#### まだ決めきっていない点（実装時に判断可）
- `PENDING_TX_RETENTION` の具体値（256 を推奨値として提示）。実装時に他の定数
  （アダプタ `maxTxs = 1000` 等）との整合を見て調整してよいが、上限の性格
  （安全弁）と前提コメントは維持する。
- 入口ガードで tx を弾いた場合に collector 側でログを出すか（追いつき時に大量に
  なりうるため既定は無ログ推奨。デバッグ用に件数集計ログを検討してよい）。
