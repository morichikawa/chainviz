# Issue #330 mempool（未承認 tx）全体を俯瞰できるビューの設計

### 2026-07-16 Issue #330 mempool 俯瞰ビュー（mempool パネル）の設計
- 担当: designer（設計）
- ブランチ: issue-330-mempool-view
- 内容: pending tx を集約して mempool 全体を俯瞰する「mempool パネル」の
  設計を確定し、`docs/ARCHITECTURE.md` §11 に反映した。shared 型変更・
  collector 変更は不要と判断した（このフェーズでのコード変更なし）。
- 決定事項・注意点: 以下の設計メモ参照。実装は frontend のみで完結する。

## 設計メモ

### 現状整理（何が既にあるか）

- **pending tx はワールドステートに既に届いている**。collector は全
  Execution ノードに `newPendingTransactions` 購読を張り
  (`adapters/ethereum/index.ts` の `subscribeTransactions`)、
  `PendingTxTracker` が tx ハッシュで重複排除するため、フロントに届く
  `TransactionEntity`（`status === "pending"`）の集合は**ネットワーク全体で
  観測された未承認 tx の和集合**になっている。件数は store の
  `PENDING_TX_RETENTION = 256`（Issue #303）で有界。スナップショットにも
  含まれるため再接続後も揃う
- **ノード別の実数も既に届いている**。`NodeEntity.internals.mempool`
  （pending / queued。reth メトリクス由来、D層）。現状は `InfraPopover` の
  txpool 行でノード単位にしか見えない
- 表示は局所的（ウォレットカードの tx チップ = ウォレット視点、
  InfraPopover の txpool 行 = ノード単位の集計数）で、俯瞰する場所が無い。
  これが本 Issue のギャップ

### 決定した仕様と理由

1. **表示形式: キャンバス常設ミニパネル（`ContractListPanel` と同型）**
   - Issue #317 の「別タブ・ログビュー」機構は未実装。本 Issue のために
     タブ機構を先行実装するのは「先回り実装をしない」原則に反するため
     採らない。既存 UI に確立済みの常設ミニパネル（左下 `ContractListPanel` /
     右下 `PeerNetworkLegend`）のパターンに乗る
   - #317 実装時に mempool 投入をログ行として流したくなったら、その時に
     このパネルとの関係（併存か統合か）を再設計する
2. **0 件でも常設表示する**（`ContractListPanel` の「0 件なら非表示」とは
   逆の判断）
   - 健全な devnet では pending は 1〜2 ブロックで掃けるため、0 件で消す
     設計だと「mempool を見る場所」がほぼ常に存在しなくなり、
     「メモリプールが見れるようにしてほしい」という要望に応えられない
   - 「空である = tx が滞りなく取り込まれている」も学習上意味のある状態。
     0 件時は空である旨の文言（i18n、ja/en）を出す
3. **データソース: 既存の 2 つを 1 パネルに束ねる。新規観測ゼロ**
   - 上段: `TransactionEntity`（`status === "pending"`）の一覧
     = C層「チェーン全体の概念としての mempool」
   - 下段: 各 `NodeEntity.internals.mempool` の pending/queued
     = D層「各ノードが実際に抱える txpool の実数」
   - 用語集の `mempool` / `txpool` の定義がまさにこの C層/D層 の対応関係を
     説明している。パネル見出しに `GlossaryTerm`（`mempool`）、ノード別
     セクションに `txpool` を張って導線を作る
4. **どのノードの mempool か: 全ノード集約の 1 ビュー（ノード選択式に
   しない）**
   - `TransactionEntity` に観測元ノードの帰属が無く、ノード別の「中身」を
     出すには txpool 内容の新規観測（チェーン固有 RPC）+ shared スキーマへの
     ノード帰属追加が必要で、本 Issue の範囲（既存データソースの延長）を
     超える
   - 「ノードごとに中身が違いうる」という学びはノード別**件数**の並び
     （既存の internals.mempool）で示す。中身のノード別表示は需要が出たら
     別 Issue
5. **shared 型変更なし・collector 変更なし**。frontend のみで完結

### 実装の構成（frontend への引き継ぎ）

新規ファイル（1 ファイル 1 責務。テストも対で作る）:

- `packages/frontend/src/entities/mempoolList.ts` — 純粋なデータ変換。
  - `WorldStateEntity[]`（または App が持つ tx 配列）から
    `status === "pending"` の tx を抽出し、パネル行データ
    （hash / from / to / contractCall の関数名有無）へ変換する関数
  - `NodeEntity[]` から `internals.mempool` を持つノードの
    ノード別件数行（表示名 + pending/queued）を組み立てる関数
  - 表示上限で切り出し「他 n 件」の n を返すヘルパー
- `packages/frontend/src/entities/MempoolPanel.tsx` — 表示コンポーネント。
  `ContractListPanel.tsx` を雛形にする（header + count + rows +
  行クリックで `onSelect(nodeId)` を呼ぶだけの薄いコールバック）

既存ファイルへの変更:

- `Canvas.tsx`（または App.tsx から props 渡し）: パネルの配置と行クリック
  時のパン。`handleJumpToContract` と同型の「対象カードへ `setCenter`」を
  from ウォレットカード（ノード id = ウォレットアドレス。`walletNode.ts`
  参照）に対して行う。from がキャンバス上のウォレットカードとして存在
  しない tx はパン対象外（行を非クリック化 or クリック無効）
- `styles.css`: `.mempool-panel` 系。`.contract-list-panel` の見た目を踏襲。
  配置は左下スタック（`ContractListPanel` と縦に並べる）を推奨するが、
  React Flow の Controls との重なりを見て実装時に調整してよい
- `i18n/messages.ts`: パネル見出し・空状態・「他 n 件」・ノード別セクション
  見出し・行クリックのヒント等（ja/en 両方）
- 並び順に `useAppearanceOrder` を再利用できる（`ContractListPanel` と同じ
  「新しいものが上」）

実装時に判断してよいこと（未決のまま残す点）:

- 一覧の表示上限件数（8 件前後を想定。パネルの `max-height` との兼ね合いで
  決めてよい）
- pending → included/failed へ遷移した瞬間の行の消え方（即時消滅でよい。
  アニメーションは任意。ウォレットカードの tx チップに既に確定演出がある
  ため、パネル側で重ねて演出する必要はない）
- ノード別件数セクションの折りたたみの要否（ノード数が増えたときの密度
  調整。初期構成では EL 2 ノード程度なので折りたたみ無しで始めてよい）
- パネルの正確な配置座標・`ContractListPanel` との上下関係

### 既知の制限（仕様として明記済み。ARCHITECTURE.md §11.4）

- collector 起動前から mempool に居た tx は（included になるまで）一覧に
  現れない（観測起点が mempool 投入の購読のため）
- `PENDING_TX_RETENTION`（256 件）を超えて間引かれた pending は一覧からも
  消える。§10.4 の設計どおりで、パネル側で救済しない

### テスト観点（実装担当・tester への申し送り）

- `mempoolList.ts`: pending のみ抽出されること（included/failed が混ざら
  ない）、0 件時の出力、表示上限での切り出しと「他 n 件」、
  `internals.mempool` を持たないノード（beacon 等）が件数行に出ないこと
- `MempoolPanel.tsx`: 0 件時も描画されること（空文言）、行クリックで
  `onSelect` が from アドレスで呼ばれること、from がウォレットに無い行は
  クリック対象にならないこと

### 2026-07-16 実装（frontend）

- 担当: frontend
- 内容: 設計どおり `entities/mempoolList.ts`（純粋なデータ変換）+
  `entities/MempoolPanel.tsx`（表示コンポーネント）を新規追加し、
  `Canvas.tsx` / `App.tsx` / `styles.css` / `i18n/messages.ts` を変更した。
  glossary の `mempool` / `txpool` は既に用語データが存在していたため
  新規追加は不要で、`GlossaryTerm` の導線だけを張った。
- データフロー: `TransactionEntity`（pending）は React Flow ノードとして
  キャンバスに現れない（ウォレットカードの tx チップに埋め込まれるだけ）
  ため、`ContractListPanel` のように rfNodes だけから組み立てることが
  できなかった。そのため `Canvas.tsx` に新規 prop `transactions?:
  TransactionEntity[]` を追加し、App.tsx が既に持っている
  `transactions`（全 entities から `kind === "transaction"` を抽出した
  もの）をそのまま渡す構成にした。一方、ノード別実数
  （`NodeEntity.internals.mempool`）は既存の infra rfNodes（`data.entity`）
  から `kind === "node"` のものを filter するだけで揃うため、こちらは
  `contractListEntries` と同じ「rfNodes だけで完結」パターンを踏襲した
  （新規 prop 不要）。
- 行クリックのパン先判定（from がウォレットカードとして存在するか）は
  `MempoolTxEntry.fromIsWallet`（`buildMempoolTxEntries` の第2引数
  `walletIds`、Canvas.tsx が rfNodes 上のウォレットカード id 集合から作る）
  として純粋関数側に持たせ、`MempoolPanel` は `fromIsWallet` を見て
  ボタン（クリック可）か静的な `div`（クリック不可）かを出し分ける。
  テストで「非クリック行はボタン要素でなくクリックしても onSelectTx が
  呼ばれない」ことを確認済み。
- 表示上限は設計メモの推奨どおり `MEMPOOL_TX_DISPLAY_LIMIT = 8` とし、
  超過分は `limitMempoolTxEntries` が `overflowCount` を返し、パネルに
  「他 n 件」を出す。並び順は `ContractListPanel` と同じ
  `useAppearanceOrder`（新しいものが上）を tx hash キーで再利用（同型の
  `sortMempoolTxEntriesByAppearance` を別関数として用意。`nodeId` キーの
  `sortEntriesByAppearance` とはフィールド名が違うため使い回さず、1
  ファイル1責務のまま分離した）。
- ノード別セクションの折りたたみは設計メモどおり見送り（現状ノード数が
  少なく密度問題が出ていないため）。パネル自体の配置は左下、
  `ContractListPanel`（`left:15px; bottom:150px; max-height:220px`）の
  真上に固定オフセット（`bottom:385px` = 150 + 220 + 15px の隙間）で
  縦積みした。`ContractListPanel` は 0 件で非表示になるため両パネルが
  同時に最大高さで重なることはないが、`ContractListPanel` が伸びきった
  状態でも重ならない安全側の値にしてある。
- テスト: `mempoolList.test.ts`（純粋関数、pending 抽出・0件・上限切り出し・
  ノード別件数の絞り込みを個別に検証）、`MempoolPanel.test.tsx`（0件描画・
  行クリック・非クリック行・overflow表示・ノード別行・日英ローカライズ）
  を追加。`Canvas.tsx` 側の `getNode`/`setCenter` によるパン処理自体は
  `handleJumpToContract` と同じく単体テスト対象外（既存の踏襲。実際の
  React Flow レンダリングを要するため、パネル単体テストとキャンバス側の
  ロジックの薄さで許容している既存方針を踏襲した）。
- 確認: `pnpm --filter @chainviz/frontend build`・
  `pnpm --filter @chainviz/frontend test`（145ファイル / 2150件、全通過）・
  `eslint`（変更ファイルのみ対象、警告なし）。

## テスト強化（chainviz-tester）

実装担当が書いた基本テスト（ハッピーパス中心）に、異常系・境界値の
観点でケースを追加した。新機能の実装・既存ロジックの変更は行っていない。

- `mempoolList.test.ts`（純粋関数、+14件）:
  - `buildMempoolTxEntries`: 空入力、入力順の保持、`fromIsWallet` が
    大文字小文字を区別する完全一致であること（from とウォレット id 集合が
    同じ casing である前提を固定）、from が空文字のときの `fromIsWallet` の
    両分岐。
  - `sortMempoolTxEntriesByAppearance`: 空入力、同一 order 値を持つ行の
    安定順序、全 hash が order マップに無いときの挿入順維持。
  - `limitMempoolTxEntries`: 0 件入力、境界の 9 件（→8件表示・overflow 1）、
    limit=0（全件 overflow）、切り出し時に入力配列を破壊しないこと。
  - `buildMempoolNodeEntries`: 空ノード列、`internals` はあるが `mempool`
    が無いノードの除外、mempool 報告ノードと非報告ノードが混在する場合の
    絞り込み、同一件数のノードでも入力順が保たれること。
- `MempoolPanel.test.tsx`（コンポーネント、+4件）:
  - 非ウォレット行の from が空文字でもクラッシュせず静的行として描画され
    クリックで `onSelectTx` を呼ばないこと。
  - 複数行が渡された順に描画されること。
  - 0 件（空状態）では `overflowCount > 0` でも overflow ヒントを出さない
    こと（overflow 表示が非空分岐の内側にあることの回帰防止）。
  - tx が 0 件でもノード別セクションは描画され、空メッセージとノード行が
    共存すること。同一件数のノードが別々の行として描画されること。
- `Canvas.tsx` の `handleJumpToMempoolTx`（対象カードが消えている場合の
  `getNode` 未存在防御）は、React Flow の実レンダリングを要し既存の
  `handleJumpToContract` と同様に単体テスト対象外とする既存方針を踏襲。
  非クリック行が `onSelectTx` を呼ばないことはパネル単体テストで担保済み。
- 確認: `pnpm --filter @chainviz/frontend test`（145ファイル / 2170件、
  全通過）・`pnpm --filter @chainviz/frontend build`（成功）。

## レビュー（chainviz-reviewer）

### 2026-07-16 静的レビュー: 差し戻し（要修正1件）

- 担当: reviewer
- 確認内容: 設計メモ・ARCHITECTURE.md §11 との整合、mempoolList.ts の純関数
  ロジック、MempoolPanel の常設表示仕様、Canvas.tsx の配線とレイアウト、
  glossary 導線、i18n（ja/en）、エラー握りつぶしの有無、コミット粒度、
  `pnpm lint` / `pnpm build` / `pnpm test`（145ファイル / 2170件）の再実行
  （全通過）。

#### 要修正: `fromIsWallet` のアドレス表記照合バグ（機能が実環境で死ぬ）

- `buildMempoolTxEntries`（`mempoolList.ts:43`）は `walletIds.has(tx.from)`
  の大文字小文字を区別する完全一致で照合しているが、両者の表記は実環境では
  一致しない:
  - `TransactionEntity.from` は RPC 由来の全小文字。collector は casing を
    正規化しない（`eth-rpc-client.ts` の `normalizeTransaction` は素通し）
  - ウォレットカードの id（= `WalletEntity.address`）は viem
    `mnemonicToAccount` 由来の EIP-55 チェックサム表記（大文字混じり。
    `wallet-derivation.ts`）
- そのため実環境では全行が `fromIsWallet: false` になり非クリック化し、
  「行クリックで送信元ウォレットへパン」（§11.3）が常に機能しない。
  仮に一致しても `Canvas.tsx` の `handleJumpToMempoolTx` が小文字の from を
  そのまま `getNode` に渡すため、チェックサム表記 id のウォレットカードは
  見つからない（二重に壊れている）
- これは Issue #201 / #232 で既に2回起きた既知のバグパターンで、
  `packages/frontend/src/entities/addressCasing.ts`（`resolvePresentId` /
  `buildLowerCaseIndex`）がまさにこの照合のために存在する（同ファイル冒頭
  コメントが「単純な文字列一致(Set.has等)では常に不一致になり」と明記）。
  collector の store 側も同じ理由で `linkTransactionToWallets`
  （`store.ts:311-321`）で小文字化して比較している
- tester が追加したテスト（`mempoolList.test.ts` の「matches fromIsWallet
  case-sensitively」）は「両者は collector 側で同じ casing に正規化済みの
  前提」を固定しているが、この前提は事実に反する（そのような正規化は
  存在しない）。壊れた挙動を仕様として固定するテストになっているため、
  実装と併せて書き換えが必要
- 修正方針の提案（差し戻し先: chainviz-frontend。テスト書き換え含む）:
  - `MempoolTxEntry.fromIsWallet: boolean` を、present 側の表記に解決済みの
    `walletCardId: string | undefined` に置き換える
  - `buildMempoolTxEntries` は `buildLowerCaseIndex`（addressCasing.ts）で
    照合し、見つかった present 側の元表記を `walletCardId` に入れる
  - `MempoolPanel` のクリックは `walletCardId` を `onSelectTx` に渡し、
    `Canvas.tsx` はそれをそのまま `getNode` へ渡す
  - テストは「大文字小文字を無視して照合し、present 側の表記に解決する」
    仕様（deployEdge.ts と同型）を検証する形に改める

#### 上記以外は問題なし

- 設計メモ・§11 との整合: 常設ミニパネル、0 件でも表示（空文言あり）、
  上段 C層 / 下段 D層 の二段構成、全ノード集約、shared/collector 変更なし、
  表示上限 8 件 + 「他 n 件」、いずれも設計どおり
- 「0 件でも常設表示」が ContractListPanel と逆仕様である点は、設計メモに
  理由（健全な devnet では pending がほぼ常に 0 件のため、消すと見る場所が
  なくなる）が明記されており妥当と判断
- `bottom: 385px` は ContractListPanel の実 CSS 値（left:15 / bottom:150 /
  max-height:220）+ 隙間 15 の導出値で、前提条件が CSS コメントと worklog の
  両方に明記済み（CLAUDE.md の固定値ルールに適合）。ContractListPanel 側の
  値を変えるとズレる結合はあるが、コメントで追跡可能な範囲
- glossary 導線: `mempool`（c-transaction.yaml）・`txpool`（d-internal.yaml）
  とも用語データが実在し、GlossaryTerm の張り方も既存パネルと同型
- i18n は ja/en 両方あり。エラー握りつぶし該当なし（純関数のみ、catch なし）
- コミット粒度: 8 コミット（設計 docs / ロジック / i18n+CSS / パネル+配線 /
  worklog / テスト2件 / worklog）で関心事ごとに適切に分割

## 修正（chainviz-frontend、差し戻し対応）

### 2026-07-16 `fromIsWallet` のアドレス表記照合バグを修正

- 担当: frontend
- レビューの提案どおり `MempoolTxEntry.fromIsWallet: boolean` を
  `walletCardId: string | undefined` に置き換えた。
  - `mempoolList.ts`: `buildMempoolTxEntries` の内部で
    `addressCasing.ts` の `buildLowerCaseIndex(walletIds)` を使って
    「小文字 → present 側の元表記」の索引を1度だけ作り、`tx.from` を
    小文字化して引く。一致すればウォレットカード側の元の表記
    （`walletCardId`）を、一致しなければ `undefined` を各エントリに
    持たせる（`deployEdge.ts` と同型のパターン）。`buildMempoolTxEntries`
    の第2引数の型は `ReadonlySet<string>` から `Iterable<string>` に
    緩めた（`buildLowerCaseIndex` が `Iterable` を受けるため）。
  - `MempoolPanel.tsx`: クリック可否の判定を
    `entry.walletCardId === undefined` に変更し、クリック時は
    `onSelectTx(entry.walletCardId)`（解決済みの表記）を渡す。
  - `Canvas.tsx`: `handleJumpToMempoolTx` は元々受け取った文字列を
    そのまま `getNode` に渡すだけだったため、呼び出し元
    （`MempoolPanel`）が正しい表記を渡すようになったことで追加の変換は
    不要だった。引数名を `from` から `walletCardId` に変え、コメントを
    実態に合わせて更新した。
- テスト:
  - `mempoolList.test.ts`: 「`fromIsWallet` を casing 完全一致で判定する」
    という誤った前提を固定していたテスト2件を、実環境の形
    （`tx.from` が全小文字・ウォレットカード id がチェックサム表記、
    およびその逆）で `walletCardId` が正しく解決されることを検証する
    テストに書き換えた。
  - `MempoolPanel.test.tsx`: クリック時に `onSelectTx` へ渡る値が
    `entry.from` ではなく `entry.walletCardId`（casing が異なりうる）で
    あることを検証するテストに変更した。
- 検証: 修正前の実装（`walletIds.has(tx.from)` の完全一致）を一時的に
  再現し、新規追加した casing 不一致のテスト2件が実際に失敗すること
  （`walletCardId` が `undefined` になる）を確認したうえで、修正版に
  戻して全テストが通ることを確認した。
- 確認: `pnpm --filter @chainviz/frontend build`（成功）、
  `pnpm --filter @chainviz/frontend test`（145ファイル / 2171件、全通過）。
