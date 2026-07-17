### 2026-07-17 Issue #364 サンプルコントラクトのトークンシンボル(CVZ等)がSolidityの定数でハードコードされておりデプロイ時に変更できない（起票・バックログ追記のレビュー）

- 担当: reviewer
- ブランチ: docs-issue-364-backlog
- 内容: ユーザーからの指摘で起票したIssue #364の、`docs/PLAN.md`
  バックログ節への追記（docsのみの変更）のレビュー。
  - Issue #364本文と`docs/PLAN.md`追記の照合: 指摘の出所（ユーザーからの
    指摘）・事実関係（`symbol = "CVZ"`が定数、コンストラクタ引数は
    `initialSupply`のみ）・問題点（「CVZ」が一般的なブロックチェーン
    用語・ティッカーに見えてしまう）・対応の論点（name/symbolの
    コンストラクタ引数化、または表記変更）・影響範囲（catalog.json・
    operationCatalog.ts・mockData.ts等のCVZ依存箇所の洗い出しが必要）の
    いずれも一致。Issue本文にあるChainvizNFT.solの`symbol = "CVN"`への
    言及（本文では「要確認」扱い）はPLAN.md側ではタイトルの「(CVZ等)」に
    要約されているが、バックログ項目は要約で足りるため過不足なしと判断
  - Issue本文が参照する事実の実在確認:
    `profiles/ethereum/contracts/src/ChainvizToken.sol` 13行目に
    `string public constant symbol = "CVZ";` が実在し、コンストラクタは
    `constructor(uint256 initialSupply)` のみ（symbolは引数化されて
    いない）。Issue本文で「要確認」とされていた
    `profiles/ethereum/contracts/src/ChainvizNFT.sol` についても30行目に
    `string public constant symbol = "CVN";` が実在し、同じ構造であることを
    レビュー時に確認済み（着手時の再調査は不要）。影響範囲として挙げられた
    `profiles/ethereum/contracts/catalog.json`・
    `packages/frontend/src/chain-profiles/ethereum/operationCatalog.ts`・
    `packages/frontend/src/websocket/mockData.ts` もいずれもCVZ文字列を
    含んで実在（そのほかfrontend/collector/shared/e2eのテスト等にも
    CVZ参照が多数あり、Issue本文の「該当箇所多数」と整合）
  - `docs/PLAN.md` の追記フォーマットは直前の #359 項目等と一貫
    （チェックボックス+6スペースインデントの補足+Issueリンク行）。
    配置（バックログ節末尾・「## 運用ルール」の直前）も適切
  - コミット粒度: `git log main..HEAD` は1コミット（PLAN.md追記のみ）で
    1変更1コミットの規約に適合。Conventional Commits形式も適合
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過を確認
    （frontend 198ファイル2592テスト含む）
- 決定事項・注意点:
  - レビュー結果は合格。コード変更を伴わないためCLAUDE.mdの例外規定に
    基づきchainviz-qaは省略可
  - 実装着手は後日。コンストラクタ引数化（DeployFormからの入力）か
    表記変更かは着手時に設計判断が必要。引数化する場合はfrontend
    （DeployForm）にも波及するため、着手時はchainviz-designerの設計を
    先行させるのがよい
