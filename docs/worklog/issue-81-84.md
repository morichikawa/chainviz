# Issue #81-84 作業記録

### 2026-07-05 Issue #81/#82/#84 C層フロント実装のレビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-81-c-layer-frontend
- 内容: frontendのC層実装(未コミットのworktree)を静的レビューした。
  `pnpm lint` / `pnpm build` / `build:web`(vite) / `pnpm test`(shared 2件・
  collector 353件・frontend 353件・e2eユニット34件)すべて成功。結果は合格
  (差し戻しなし)。
  - 境界: フロントはWorldStateエンティティ(`@chainviz/shared`)のみを参照し、
    Docker/ノードAPIやチェーン固有のRPC語彙への依存はない。
  - `packages/shared` の型変更不要という判断は妥当。WalletEntity/
    TransactionEntityの既存定義で全機能が賄えていることを確認した。
  - 所有エッジを `WorldStateSnapshot.edges`(PeerEdge)に載せず
    `WalletEntity.ownerWorkbenchId` から都度導出する設計は妥当。
    ARCHITECTURE.md §2の「ワークベンチ削除時はentityUpdatedで
    ownerWorkbenchId=nullにする」という決定とちょうど整合し、
    edgeRemovedとの二重管理が要らない。#83の操作エッジ(RPC呼び出し)は
    エンティティから導出できない観測ストリームなので、その時点で
    shared側に新しいエッジ型/差分イベントの追加が必要になるが、
    今回の導出方式はそれを妨げない(所有=エンティティ状態の射影、
    操作=観測イベント、と性質が異なるため設計が分かれるのはむしろ自然)。
  - `useTxLifecycle` は useBlockPulses と同じ責務分離(純粋な遷移検知は
    `transaction.ts`、実時間スケジューリング・後片付けはフック側)で妥当。
    タイマーのクリーンアップ・連続確定時の上書きも確認した。
  - Canvasの合併型化(`canvasNode.ts`)はA層・B層に悪影響なし。位置永続化
    キーの分岐(containerName / address)も安定IDの原則(#15)に沿う。
    B層のグルーピングはエッジ側実装のためノード型追加の影響を受けない。
  - `glossary/ethereum/terms/c-transaction.yaml` は既存スキーマ
    ({ja,en}+layer+relatedTerms)に適合。WalletCard/Popoverが参照する
    termKey(eoa/smart-account/nonce/mempool/transaction/wei)はすべて
    定義済み。relatedTermsの参照先も全キー実在を確認した。
  - CONCEPT.mdの「所有エッジに元の所有者が削除済みである旨を示しつつ」は、
    ワークベンチカード自体が消える以上エッジは描きようがないため、
    ウォレットカード上のバッジで意図(削除済みの明示+カード存続)を
    満たしていると判断した。
  - エラー握りつぶし・環境依存の決め打ち定数は見当たらない
    (`formatEther` の非数値入力フォールバックはコメント付きの意図的な
    表示用フォールバックで問題ない)。
- 決定事項・注意点(軽微。次回コミット・後続作業で対応してよい):
  - i18nに追加した `card.wallet` キーが未使用。使うか削除するか整理する。
  - `TX_SETTLE_FLASH_MS`(1400ms)と styles.css の `wallet-tx-settle 1.4s` は
    同期が前提だが相互参照コメントがない。片方だけ変えるとフラッシュが
    途切れる/クラスだけ残るため、双方に対応関係のコメントを添えるとよい。
  - transaction.test.ts の「ignores tx that were already included before」と
    「does not re-flag an already included tx on a later pass」は入力・
    期待値が同一の重複テスト。片方に統合してよい。
  - mockDataの recentTxHashes 上限が定数6の直書きで
    `DEFAULT_RECENT_TX_LIMIT` と重複している(モックなので許容)。
  - まだ未コミットのため、コミット時は関心事ごとに分割すること
    (例: #84 glossary / Canvas合併型化 / #82 ウォレットカード+所有エッジ /
    #81 txライフサイクル / mockDataのC層対応 / docs更新)。

### 2026-07-05 Issue #81/#82/#84 C層フロント(txライフサイクル・ウォレット・用語) (frontend)

- 担当: frontend
- ブランチ: issue-81-c-layer-frontend
- 内容: ステップ7(Phase3 C層)のフロント3件を実装した。collector側
  (#76/#77)が未完成のため、`packages/frontend/src/websocket/mockData.ts`
  にWalletEntity・TransactionEntityのサンプルとtxライフサイクルのlive
  シミュレーションを追加し、それを使って実装・確認した。
  - #84: `glossary/ethereum/terms/c-transaction.yaml` を新規追加
    (transaction/mempool/nonce/eoa/smart-account/wei/gas)。既存の
    a-infra/b-networkと同じ `{ja, en}` + layer + relatedTerms 形式。
    `glossary/data.ts` の import に追加。
  - #82: ウォレットカード(`WalletCard.tsx`/`WalletPopover.tsx`)を実装。
    アドレス・残高(wei→Ether変換)・nonce・直近tx・スマートアカウント種別を
    表示し、ホバーで詳細ポップオーバーを出す。所有エッジ
    (`ownershipEdge.ts`/`OwnershipEdge.tsx`)はワークベンチ→ウォレットを
    点線+別色(--own-edge)でB層ピア接続と視覚的に区別。`ownerWorkbenchId`
    がnull(所有者削除済み)のウォレットはエッジを描かず、カード上に
    「所有者は削除済み」バッジを出してカード自体は残す。
  - #81: txライフサイクルを、ウォレットカード上のtxチップで表現した。
    pending中はCSSで明滅(mempool待機)、pending→included/failedへ遷移した
    瞬間を `useTxLifecycle` フックが検知し確定フラッシュ演出を当てる。
    純粋な遷移検知は `transaction.ts` の `detectTxSettlements`(テスト済み)、
    実時間スケジューリングはフック側という useBlockPulses と同じ分離。
- 決定事項・注意点:
  - `packages/shared` の型(WalletEntity/TransactionEntity)は既存定義で
    足りたため変更していない。所有エッジは `edges`(PeerEdgeのみ)には
    載せず `WalletEntity.ownerWorkbenchId` から都度導出する方式にした。
    collectorが所有エッジ用の新エッジ型を用意した場合は要見直し。
  - Canvasはインフラカード/ウォレットカードの合併型(`canvasNode.ts`)を
    受け取る形に一般化した。位置永続化キーはインフラ=containerName、
    ウォレット=address(どちらも再起動で変わらない安定ID)。
  - #83(ワークベンチ→ノードのRPC呼び出しエッジ)は、collector側で新しい
    エッジ型(packages/sharedの型)の設計が未確定のため今回スコープ外。
  - モッククライアントのtx live更新はconnect時に `resetTxState()` で
    初期化し、再接続時に送るスナップショット(初期値)と整合させている。
  - `pnpm build`(tsc -b)/`build:web`(vite)/`pnpm test`(353件)/`pnpm lint`
    すべて成功。

### 2026-07-05 Issue #81/#82/#84 C層フロント実装の動作検証(qa)

- 担当: qa
- ブランチ: issue-81-c-layer-frontend
- 内容: 未コミットのworktreeを実際に起動して動作検証した。`pnpm dev`
  (frontend, モックデータ)でvite dev serverを立て、キャッシュ済みの
  Playwright Chromiumをheadlessで起動し、CDP経由で画面のレンダリング・
  ホバー・時系列の状態変化を確認した(Chromium実行に不足していた共有
  ライブラリ libnspr4/libnss3/libasound2 はscratchpadへdebから展開し
  LD_LIBRARY_PATHで解決した。プロジェクトには手を加えていない)。
  検証結果はすべて完了条件を満たしており合格。
  - #82 ウォレットカード: Alice(EOA,残高5 ETH,nonce 3,直近tx)/Safe
    (スマートアカウント,10 ETH,nonce 0)/Bob(EOA,2 ETH,nonce 7)の3枚が
    表示され、アドレス・残高(Ether表記)・nonce・直近txチップが見えることを
    確認。
  - #82 所有エッジ: ワークベンチ(Alice)→所有ウォレット2枚が点線(dash 6 4,
    色--own-edge)で描かれ、reth-1↔reth-2のP2Pエッジ(実線)と視覚的に明確に
    区別できることをスクリーンショットで確認。DOM上もclassがownership-edge/
    peer-edgeで分離。
  - #82 所有者削除済み: ownerWorkbenchId:nullのBobウォレットは所有エッジが
    描かれず(ownership-edgeは2本のみ)、カードに赤の「所有者は削除済み」
    バッジを出してカード自体は残ることを確認。
  - #81 txライフサイクル: pending中のtxチップがblinkアニメーションで明滅
    (computed opacityが0.4〜1.0で変動することを実測)、pending→includedへ
    遷移する瞬間にis-settling(確定フラッシュ)が付与され、includedチップ
    (緑)へ変わること、Aliceのnonce/残高がtx確定に伴い更新される様子を
    時系列サンプリングで確認。
  - #84 glossary: nonce/EOA/スマートアカウント/直近tx(mempool)等の用語に
    ホバーすると対応する解説ポップオーバー(name/definition/relatedTerms)が
    表示されることを確認。
  - #7 品質ゲート: `pnpm lint`(clean)/`pnpm build`(全パッケージ成功)/
    `pnpm test`(collector 353件・frontend 353件ほか全green)を実行し成功。
- 決定事項・注意点:
  - #83(ワークベンチ→ノードのRPC呼び出しエッジ)はfrontend実装のスコープ外
    (今回のPLANチェック対象外)であり、本検証でも扱っていない。
  - スクリーンショット保存先(scratchpad):
    shot1-overview.png(全体)/shot4-glossary-nonce.png(nonceホバー+tx進行)。
    セッション固有のためworktreeには含めていない。

