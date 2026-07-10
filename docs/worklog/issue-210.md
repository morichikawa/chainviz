### 2026-07-10 Issue #210 ワークベンチに複数ウォレットが紐づいているように見える（調査記録）

- 担当: detective（原因究明）
- ブランチ: issue-210-workbench-multiple-wallets
- 内容: 原因調査のみ（コード修正なし）。結論は「不具合ではなく、モックデータ
  表示時の意図した挙動」。

#### 再現した症状

- 実環境（稼働中の chainviz-ethereum スタック + collector(4000) + vite dev
  5173、`VITE_COLLECTOR_URL` 設定あり）では **再現しない**。
  - collector の WebSocket スナップショットを直接取得して確認:
    workbench 1件（`walletIds: ["0x2BB7Dc…d4c0"]` の1件のみ）、wallet
    エンティティ 1件、UI 上の所有エッジ（`.ownership-edge`）も 1本。
- `VITE_COLLECTOR_URL` 未設定で frontend を起動（モックモード）すると
  **再現する**: ワークベンチカード `chainviz-workbench-alice` から所有
  エッジが 2本 出て、2つのウォレットカード（EOA `0xa11ce…` と
  スマートアカウント `0x5afe…`）に紐づいて見える。headless Chromium での
  DOM 集計でも `.ownership-edge` は 2本（データどおりで重複描画ではない）。

#### 検証した仮説と実測結果

1. 表示バグ（1ウォレットの重複描画・エッジの多重描画）→ **棄却**。
   `ownershipEdgesToFlowEdges`（frontend/src/entities/ownershipEdge.ts）は
   ウォレット1件につきエッジ1本しか作らず、実測でもエッジ数はウォレット
   数と一致（実接続=1、モック=2）。
2. データの重複（同じワークベンチにウォレットエンティティが複数回作られる）
   → **棄却**。collector の `workbenchWalletIds`
   （adapters/ethereum/index.ts）はワークベンチ1つにつき常に導出アドレス
   1件（mnemonic 未設定なら0件）を返す。`WalletTracker.workbenchWallets`
   も同じく1ワークベンチ=1アドレス。`computeWalletDiff`
   （world-state/diff.ts）は観測から消えたアドレスの `ownerWorkbenchId` を
   null にするため、mnemonic やウォレットインデックスが変わっても
   「1ワークベンチに2ウォレット所有」が持続する経路は構造上ない。
3. 意図した挙動（モックデータ）→ **これが原因**。
   frontend/src/websocket/mockData.ts の `workbench-alice` は意図的に
   `walletIds: [ALICE_WALLET, SAFE_WALLET]` を持ち、EOA（Alice）と
   スマートアカウント（Safe）の両方を所有する。これは docs/CONCEPT.md
   「ウォレット・アカウントの可視化」の決定（基本形は1ワークベンチ=
   1つの主たる鍵だが、複数アドレス所有にも技術的に対応する。
   コントラクトウォレット(Smart Account)も同種の要素として表示する）を
   デモするための設計で、`WorkbenchEntity.walletIds` が `string[]`
   （複数許容）なのも同じ理由。

#### 根本原因

モックモード（`VITE_COLLECTOR_URL` 未設定で frontend を起動した状態）の
デモデータが、スマートアカウント表示の確認用として1つのワークベンチに
2つのウォレット（EOA + Smart Account）を意図的に紐づけている。実接続
（collector 経由）のデータパスでは1ワークベンチ=1ウォレットしか生成
されず、UI の描画にも重複はない。つまりコードの不具合ではない。

#### 対応方針（提案）

- コード修正は不要（collector / frontend とも正常）。
- モックモードはヘッダーに「接続済み · モックデータ」バッジが出る
  （実接続時は「接続済み」のみ）。ユーザーが実環境のつもりでモックを
  見ていた可能性があるため、確認時はこのバッジで見分けられる。
- もし「モックでも紛らわしい」となる場合の選択肢としては、
  スマートアカウントのウォレットカード（`0x5afe…`）に既に出ている
  「スマートアカウント」バッジ・用語解説の文言強化（UX 担当マター）が
  考えられるが、CONCEPT.md 上は現状が意図どおりであり必須ではない。

#### 調査時の環境メモ

- WSL2 のこの環境では Playwright の chromium がシステムライブラリ不足
  （libnspr4 等）で起動しないため、スクラッチパッドに展開済みのライブラリを
  `LD_LIBRARY_PATH` で与えて headless 起動した（e2e 実行時も同様の考慮が
  必要になる可能性がある）。
- 調査のために一時的に起動したモック用 vite（ポート5299）は調査後に停止済み。
  既存の dev スタック（docker / collector / vite 5173）には手を加えていない。

### 2026-07-10 Issue #210 レビュー（調査記録の検証）

- 担当: reviewer
- ブランチ: issue-210-workbench-multiple-wallets
- 内容: detective の調査記録（コミット 35243bc、docs-only）の静的レビュー。
  結果は**合格**。「不具合ではなくモックデータの意図した挙動」という結論を
  支持する。
- 確認した根拠:
  - `packages/frontend/src/entities/ownershipEdge.ts` の
    `ownershipEdgesToFlowEdges` はウォレット1件（`ownerWorkbenchId` 非 null
    かつ所有者がキャンバスに存在）につきエッジ1本しか作らない。記載どおり。
  - `packages/collector/src/adapters/ethereum/index.ts` の
    `workbenchWalletIds` は mnemonic 未設定なら空配列、あれば導出アドレス
    1件のみを返す。`wallet-tracker.ts` の `workbenchWallets` も
    1ワークベンチ=1アドレス。記載どおり。
  - `packages/collector/src/world-state/diff.ts` の `computeWalletDiff` は
    観測から消えたウォレットの `ownerWorkbenchId` を null に更新するため、
    実接続パスで「1ワークベンチに2ウォレット所有」が持続する経路は無い。
    記載どおり。なお所有エッジは `WorkbenchEntity.walletIds` ではなく
    `WalletEntity.ownerWorkbenchId` から導出されるため、実接続で複数エッジが
    出るには同一 owner の WalletEntity が複数必要だが、上記のとおり生成経路が
    1件しかなく構造的に起きない（結論の裏取りとして独立に確認）。
  - `packages/frontend/src/websocket/mockData.ts` は `workbench-alice` に
    `walletIds: [ALICE_WALLET, SAFE_WALLET]` を持たせ、`safeWallet()` は
    `isSmartAccount: true`・`ownerWorkbenchId: "workbench-alice"`。記載どおり。
  - `docs/CONCEPT.md`「ウォレット・アカウントの可視化」に「1ワークベンチが
    複数アドレスを持つ場合にも技術的には対応」「コントラクトウォレット
    （Smart Account）も同種の要素として表示」とあり、モックの2ウォレットは
    設計どおり。`WorkbenchEntity.walletIds: string[]`
    （`packages/shared/src/world-state/entities.ts`）も同趣旨で整合。
  - モックモード判別のバッジ「· モックデータ」は
    `packages/frontend/src/app/App.tsx`（`connection.mock`）に実在する。
- 差分の確認: `main..HEAD` はコミット1件のみで、変更は
  `docs/worklog/issue-210.md`（新規）と `docs/WORKLOG.md`（索引1行）のみ。
  コード変更なし。コミット粒度も問題なし。
- ビルド・テスト: `pnpm lint` / `pnpm build` / `pnpm test` 全通過
  （frontend 1421件を含む全パッケージ成功）。
- 注意点: docs-only 変更のため、CLAUDE.md の例外規定により chainviz-qa は
  省略可（reviewer 合格のみで足りる）。

### 2026-07-10 レビュー（ブランチ issue-210-plan-checkbox / c7caf8c）

- 担当: reviewer（静的レビュー）
- 対象: `docs/PLAN.md` のみの変更。バックログの Issue #210 の行を
  `- [ ]` から `- [x]` に変更し、「調査の結果、不具合ではなくモック
  データの意図的な仕様と判明。コード変更なし」という補足を追記。
- 結果: **合格**
- 確認した内容:
  - `git diff main..HEAD`: 変更は `docs/PLAN.md` の該当4行のみ。
    意図しない差分なし。
  - 書式: 他の完了済みバックログ項目と同じ `- [x]` + 6スペース
    インデントの継続行 + Issue リンクの形式。補足の全角括弧も
    PLAN.md 内の既存表記（見出し・注記で全角括弧を多用）と一貫。
  - Issue #210 は CLOSED、PR #242 は MERGED であることを gh で確認。
    チェックを付ける前提条件（Issue 完了）を満たしている。
  - コミット粒度: `main..HEAD` はコミット1件（`docs: PLAN.mdバックログの
    Issue #210を完了済みに更新`）。Conventional Commits 形式で、
    1変更1コミットの規約どおり。
  - `pnpm lint` / `pnpm build` / `pnpm test` 全通過（shared 58件、
    frontend 1421件を含む全パッケージ成功）。
- 注意点: docs-only 変更のため、CLAUDE.md の例外規定により
  chainviz-qa は省略可。
