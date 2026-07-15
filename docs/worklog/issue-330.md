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
