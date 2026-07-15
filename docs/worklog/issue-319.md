# Issue #319 ウォレットのtx履歴に各txのnonce値が表示されず送信順序が追いにくい

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
