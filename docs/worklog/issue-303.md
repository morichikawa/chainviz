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

### 2026-07-13 実装着手前の方針確認メモ（collector）

設計メモの方針をそのまま採用する。実装に落とす際の具体的な関数構成・
既存パターンとの対応を以下に記録する。

- `PENDING_TX_RETENTION = 256` を採用する（推奨値どおり）。前提コメントは
  `BLOCK_RETENTION` の書き方（固定値が成立する前提条件を列挙する形式）を
  踏襲する。
- `applyTransaction` の分岐は `tx.blockHash` の有無で分ける。
  - `blockHash` あり（included/failed）: `this.entities.get(tx.blockHash)` を
    見て `kind === "block"` でなければ空配列を返して捨てる。存在すれば
    従来どおり `applyKeyed` に委ねる。
  - `blockHash` なし（pending）: 従来どおり `applyKeyed` を呼んだ後、新設の
    `evictExcessPendingTransactions()` で件数上限を適用する。この private
    メソッドは `this.entities` を1回走査して `kind === "transaction" &&
    status === "pending"` のものを Map 挿入順（`values()` の反復順）で
    収集し、上限超過分だけ先頭（＝最古）から `entityRemoved` として
    `applyEvent` に流す。`evictBlocksBelow` と同じ「一度だけ走査して
    削除しながら差分配列を組み立てる」形に揃える。
- `applyBlock` の `evictBlocksBelow` は、削除した block の hash 集合を
  作った後、`this.entities` をもう一度走査して `kind === "transaction" &&
  blockHash` がその集合に含まれるものを併せて `entityRemoved` にする
  （block 削除と tx 削除を同一差分配列にまとめて返す。設計メモの
  「同一差分で配信」に対応）。
- `index.ts` の配線: `applyTransaction` 自体の返り値（`DiffEvent[]`）だけでは
  「入口ガードで捨てた（空配列）」のか「差分なし（既に反映済みで内容も
  同じ）」なのかを呼び出し側から区別できない。返り値の型を変える案も
  検討したが、既存の多数のテスト（`store.test.ts` の `applyTransaction`
  系）が配列としての等価比較をしており、型変更は無関係な既存テストの
  書き換えを広げてしまう。代わりに `findWorkbenchByIp` / `findNodeByIp`
  と同じ「id からエンティティの有無を引く」パターンに倣い、
  `hasTransaction(hash: string): boolean` を store に追加する。`index.ts`
  は `applyTransaction` を呼んだ直後に `store.hasTransaction(tx.hash)` を
  見て、true のときだけ `linkTransactionToWallets` を呼ぶ（tx が store に
  存在しない＝入口ガードで捨てられた、または一度も取り込まれていない
  状態なら wallet 側にも載せない）。`linkTransactionToWallets` 自体は
  同一 hash の重複追加を既にガードしているため、副作用は無い。
- テストは設計メモの5観点を、既存 `store.test.ts` を肥大化させない形で
  `store-transaction-retention.test.ts` に分割して追加する。既存
  `store.test.ts` の `applyTransaction` テストのうち、pending →
  included の遷移で存在しない block hash を参照していたケースは、新しい
  入口ガードの下では「block 未観測」として弾かれる挙動に変わるため、
  対応する block を `applyBlock` で事前に seed するよう修正する。

### 2026-07-13 実装（collector）

- 担当: collector
- ブランチ: issue-303-transaction-retention
- 内容: 設計メモどおり、`WorldStateStore` の tx 保持に2系統の窓を実装した。
  - `packages/collector/src/world-state/store.ts`
    - `PENDING_TX_RETENTION = 256`（前提コメント付き）を追加。
    - `applyTransaction`: `tx.blockHash` の有無で分岐。included/failed
      （`blockHash` あり）は `this.entities.get(tx.blockHash)` が
      `kind === "block"` のときだけ `applyKeyed` に委ね、無ければ空配列を
      返して捨てる（入口ガード）。pending（`blockHash` なし）は
      `applyKeyed` の後に新設 `evictExcessPendingTransactions()` で件数
      上限を適用する。
    - `evictBlocksBelow`: 窓落ちした block の hash 集合を作った後、
      `blockHash` が一致する tx も同じ差分配列の中で `entityRemoved` に
      する。
    - `evictExcessPendingTransactions`（private・新設）: pending tx を
      Map 挿入順で収集し、`PENDING_TX_RETENTION` 超過分を最古から
      `entityRemoved` にする。
    - `hasTransaction(hash)`（新設・public）: 指定 hash の tx が store に
      存在するかを返す。`applyTransaction` の返り値（`DiffEvent[]`）だけ
      では「入口ガードで捨てた」のか「差分なし（既に反映済みで内容も
      同じ）」なのかを呼び出し側が区別できないため、`index.ts` 側の判定に
      使う（`findWorkbenchByIp` 等と同じ「id からエンティティの有無を
      引く」パターン）。
  - `packages/collector/src/index.ts`: `subscribeTransactions` のコール
    バックで `store.applyTransaction(tx)` の後に `store.hasTransaction(tx.hash)`
    を確認し、true のときだけ `store.linkTransactionToWallets(tx)` を呼ぶ
    ように変更した（入口ガードで捨てた tx をウォレットの
    `recentTxHashes` に載せないため）。
- テスト:
  - 新規 `packages/collector/src/world-state/store-transaction-retention.test.ts`
    に、設計メモの5観点（block退去との連動・追いつきフラッドの入口ガード・
    pendingがblock evictionで消えないこと・pending上限のevict・
    pending→included遷移）を含む18ケースを追加した。
  - 既存 `store.test.ts` の「emits an update with only the changed fields
    on inclusion」テストは、included への遷移前に対応 block を
    `applyBlock` で seed するよう修正した（新しい入口ガードにより、
    存在しない block を参照する included tx は取り込まれなくなったため、
    元のテストのままでは失敗する）。他の既存 tx 系テストは pending の
    ままのケースが大半で影響を受けなかった。
  - `pnpm --filter @chainviz/collector build && pnpm --filter @chainviz/collector test`
    が通ることを確認済み（56 test files / 1398 tests）。
- 実機検証: `pnpm dev:up` で稼働中の Docker スタック（`profiles/ethereum`）に
  対し collector を起動し、WebSocket 経由で `runWorkbenchOperation`
  （`transfer`）を2回実行した。
  - 送金の tx が pending を経て included としてワールドステートに正しく
    反映され、送金元ウォレットの `recentTxHashes` にも反映されることを
    確認した。
  - その後チェーンの進行を実測で待ち、最初の送金が含まれるブロックが
    `BLOCK_RETENTION`（32）の窓外に押し出された時点で、そのブロックと
    紐づく tx が store のスナップショットから同時に消えている（残存 tx
    エンティティ 0 件）ことを確認した。
  - collector ログにエラー・警告は出ていない。
- 決定事項・注意点:
  - `applyTransaction` の返り値の型自体は変更していない（`DiffEvent[]`
    のまま）。理由は設計メモの実装着手前メモに記載したとおり、型を
    変えると既存の多数のテストの等価比較を無関係に書き換える必要が
    生じるため。代わりに `hasTransaction` という副問い合わせメソッドで
    「取り込まれたか」を表現した。
  - `evictBlocksBelow` の tx 走査は pending tx（`blockHash` が
    `undefined`）を自然に除外する（`Set.has(undefined)` は必ず
    `false`）ため、pending tx 用の特別な除外条件は不要だった。

### 2026-07-13 テスト強化（tester）

- 担当: tester
- ブランチ: issue-303-transaction-retention
- 内容: 実装担当が書いた基本テスト（`store-transaction-retention.test.ts`、
  18 ケース）を土台に、境界値・異常系・タイミングズレに絞った補強テストを
  新規ファイル `packages/collector/src/world-state/store-transaction-retention-edge.test.ts`
  に追加した（10 ケース）。基本ファイルはハッピーパスの保持方針を担い、
  こちらは境界・異常系の関心事を担う分割（1 ファイル 1 責務。CLAUDE.md）。
  追加した観点:
  - 入口ガードのタイミングズレ:
    - included tx が対応 block より先着した場合は捨てられ、その後 block が
      到着しても遡って取り込まれない（入口ガードは applyTransaction の瞬間の
      block 存在のみを見る）。
    - block 到着後に同じ tx が再配信されれば取り込まれる（再試行での回復）。
    - `blockHash` が block 以外の既存エンティティ（例: pending tx の hash）を
      指す場合、`get` はヒットするが `kind !== "block"` なので捨てられる
      （kind チェックの境界）。
  - `PENDING_TX_RETENTION` 境界と pending -> included 遷移:
    - pending が included へ遷移すると pending 件数が減り、空いたスロットに
      新しい pending が間引きなしで入る。
    - 超過ごとに次に古い pending が退去する（窓のスライドが継続する）。
    - cap で退去した pending が pending のまま再配信されても末尾に入り直し、
      恒久的な取りこぼしにはならない。
  - 複数 block が同時に窓外へ押し出される場合の同期性:
    - 番号の大きなジャンプで複数 block が一度に窓外となったとき、各 block に
      紐づく複数 tx が同じ差分の中で全て削除される。
    - 窓内に残る block の tx は削除されず、窓落ちした block の tx だけが消える。
  - 入口ガードで捨てた tx がウォレット観測を害しないこと:
    - included tx が入口ガードで捨てられた場合、`index.ts` は
      `hasTransaction` が false のため `linkTransactionToWallets` を呼ばない
      （その配線を模したテスト）。それでも残高・nonce は次のポーリング周期の
      `applyWallets` で独立に反映される（tx 紐付けと無関係）。
    - 取り込まれた場合のみ `linkTransactionToWallets` によって
      `recentTxHashes` に載る。
- 回帰検出の確認: 追加テストが実装の欠陥を実際に検出できることを、実装を
  意図的に壊して確認した（確認後は元に戻し、`store.ts` は無変更）:
  - 入口ガードの `kind !== "block"` チェックを外す → kind 境界のテストが失敗。
  - `evictBlocksBelow` の tx 削除ループをスキップ → 複数 block 同期のテストが失敗。
  - `evictExcessPendingTransactions` の pending 判定から `status === "pending"`
    を外し included も数える → スロット解放のテストが失敗。
- `pnpm --filter @chainviz/collector build && pnpm --filter @chainviz/collector test`
  が通ることを確認済み（57 test files / 1408 tests。既存 1398 + 追加 10）。
- 報告した気づき（実装のバグではなく設計前提の確認事項。差し戻しではない）:
  - `applyTransaction` の分岐は `tx.blockHash` の有無だけで行うため、
    `status === "included"`/`"failed"` にもかかわらず `blockHash` が
    `undefined` の tx（アダプタが本来生成しない不正入力）は pending 分岐に
    入り、`status === "pending"` でないため pending cap にも数えられず、
    block 連動でも消えないため無制限に残りうる。現状の設計は「included/failed は
    必ず blockHash を持つ」というアダプタの保証を前提としており、通常運転では
    到達しない。堅牢性を上げるなら分岐条件を status も見る形にする余地がある
    （今回はテスト追加のみの担当のため実装は変更していない）。

### 2026-07-13 レビュー（reviewer）: 差し戻し

- 担当: reviewer（横断レビュー・静的整合性）
- ブランチ: issue-303-transaction-retention
- 判定: **差し戻し**（下記1点の堅牢性ハードニングを実装担当へ依頼。現行コードは
  アダプタが今実際に生成する入力に対しては正しく、機能上のバグではないが、
  本 Issue の目的である「tx 蓄積の有界化の保証」に穴が残るため）。

#### 差し戻しに至らない範囲での確認結果（いずれも問題なし）
- ビルド・lint・テストはリポジトリ全体で green（shared 62 / collector 1408 /
  e2e 158 / frontend 2120。lint・build も成功）。
- 設計メモの決定事項からの逸脱なし。`evictBlocksBelow` の tx 同時削除、
  `evictExcessPendingTransactions` の最古間引き、`hasTransaction` の新設と
  `index.ts` の配線（取り込んだ場合のみ `linkTransactionToWallets` を呼ぶ）は
  設計どおり。
- `evictBlocksBelow` の tx 走査は `Set.has(undefined) === false` により pending を
  自然に除外しており正しい。
- エラーを握りつぶす箇所は無い（入口ガードで tx を捨てるのは設計上の正常系で、
  worklog・コメントに理由が明記されている）。
- 固定値 `PENDING_TX_RETENTION = 256` は前提条件がコメントと worklog の両方に
  明記されており、CLAUDE.md の固定値ルールに沿う。
- コミット粒度（設計 / 実装 / 実装 worklog / テスト強化の4コミット、
  1 関心事 = 1 コミット）・Conventional Commits 準拠。
- docs（ARCHITECTURE.md §10.4 / PLAN.md / WORKLOG.md / 本 worklog）は実装を
  正しく反映している。

#### 差し戻す論点: `applyTransaction` の分岐条件に `status` を含める
tester 申し送りの潜在的な穴を精査した結果、堅牢性ハードニングとして差し戻す。

- **不変条件の保証状況**: `status: "included" | "failed"` の TransactionEntity を
  生成する箇所は `TransactionLifecycleTracker.recordInclusion`
  （`adapters/ethereum/transactions.ts`）ただ1つで、そこでは `blockHash` を必ず
  同時にセットしている。`recordPending` は pending のみ（blockHash なし）、
  `updateContractEvents` は既存を spread して status/blockHash を保つ。よって
  **実行時の不変条件「included/failed ⇒ blockHash あり」は単一チョークポイントで
  保証されており、現状の通常運転で穴に到達することはない**。ただし
  `packages/shared` の `TransactionEntity` 型は `status` と `blockHash?` が独立
  フィールドで、この不変条件を型レベルでは強制していない。
- **穴の実体**: store 内の2つの関数で「pending の判定基準」が食い違っている。
  - `applyTransaction`: pending か否かを `tx.blockHash === undefined` で判定
  - `evictExcessPendingTransactions`: pending か否かを `status === "pending"` で判定
  この差の隙間（`status` が included/failed なのに `blockHash === undefined` の
  不正入力）に落ちた tx は、pending 分岐に入って applyKeyed で取り込まれるが、
  `status !== "pending"` のため pending cap にも数えられず、`blockHash` を持たない
  ため block 連動でも削除されない。結果として**本 Issue が防ごうとした「tx の
  無制限蓄積」が別の入口から静かに再発しうる**。
- **差し戻す理由**（現行が「機能上正しい」ことを認めたうえで、なお修正を求める）:
  1. 本 Issue の目的は tx 蓄積を有界化する保証を得ることであり、その保証が
     「アダプタが型で強制されない不変条件を守る限り有界」という条件付きに
     留まっているのは、Issue の趣旨（メモリ有界化）に対して弱い。型が不変条件を
     強制していない以上、境界層である store は producer を無条件に信頼すべきで
     ない。
  2. store は既に境界で防御的に振る舞う設計になっている（`applyNodeInternals` は
     未存在ノードをログして捨てる、`applyBlock` は窓外を捨てる、
     `linkTransactionToWallets` はダングリング参照を skip）。`applyTransaction`
     だけが「included ⇒ blockHash」を無防備に信頼するのは、同一モジュールの
     防御スタイルと不整合。
  3. CLAUDE.md はレビュー観点として「新チェーンプロファイル追加時・アダプタの
     実装ミス」を明示的に挙げ、環境変化で静かに壊れる固定前提を戒めている。
     不正入力を「メモリリークする分岐へ黙って誤ルーティングする」現状は、
     「エラーを握りつぶさない」原則の趣旨に隣接する。
  4. 修正は小さく、正常な入力に対して挙動を一切変えない（下記）。

#### 実装担当（collector）への具体的な修正指示
- `packages/collector/src/world-state/store.ts` の `applyTransaction` の分岐基準を、
  `tx.blockHash` の有無ではなく **`tx.status`** に変える（`evictExcessPendingTransactions`
  の判定基準と揃える）。具体的には:
  - `tx.status !== "pending"`（= included / failed）の場合:
    - `tx.blockHash === undefined` なら、これはアダプタ契約違反の不正入力。
      `applyNodeInternals` と同じく具体的な hash を含めて `console.error` で
      ログし、空差分を返して捨てる（黙って pending 分岐へ流さない）。
    - `blockHash` があれば従来どおり block 存在の入口ガードを適用する。
  - `tx.status === "pending"` の場合: 従来どおり applyKeyed + `evictExcessPendingTransactions`。
  - この変更は、アダプタが実際に生成する全ての正常入力（included/failed は必ず
    blockHash あり、pending は必ず blockHash なし）に対して現状と完全に等価。
    差分が出るのは「included/failed かつ blockHash なし」という現状到達不能な
    不正入力のみで、そこを無制限蓄積からログ付き破棄へ変える。
- テスト（tester 依頼、または実装担当）: 「status が included/failed かつ
  blockHash が undefined の tx を渡すと、取り込まれず（`hasTransaction` が false）、
  pending cap にも数えられず蓄積しないこと」「その際 `console.error` でログされる
  こと」を検証するケースを追加する。既存の正常系テスト（included tx は blockHash を
  必ず持つ）は挙動が変わらないため影響しない見込み。
- 併せて `docs/ARCHITECTURE.md` §10.4 の入口ガードの記述を「included/failed の
  判定は status で行い、blockHash 欠落の不正入力はログして捨てる」旨に更新する。

