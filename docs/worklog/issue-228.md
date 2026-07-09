### 2026-07-09 Issue #228 SCENARIOS.md棚卸しで「移行」指定のa-b-layer.test.ts WSテストが#199で削除されずに残っている

- 担当: collector
- ブランチ: issue-228-remove-migrated-ab-layer-tests

#### 設計メモ(着手前)

UI-A-01（`infra-display.spec.ts`）とUI-B-01（`p2p-graph.spec.ts`）が
`a-b-layer.test.ts`の2テスト（A層スナップショットのkind/clientType検証、
beacon間PeerEdge検証）を同等以上に検証済みのため、SCENARIOS.mdの運用
ルール（「移行」行は対応UIシナリオgreen化後のコミットでWS版を削除）に
従い、単純に該当2テストを削除するだけの対応。PROTO-B-01（ブロック伝播
タイミング）は「残す」指定なので触れない。コード削除とドキュメント
更新(SCENARIOS.md棚卸し表)を別コミットに分ける。

#### 内容

- `packages/e2e/src/a-b-layer.test.ts` から以下2テストを削除:
  - `describe("A 層: 接続時スナップショット")` の
    `it("compose の 6 ノード + ワークベンチが正しい kind / clientType で載る")`
  - `describe("B 層: ピア接続")` の
    `it("beacon1 と beacon2 のあいだに PeerEdge が張られる")`
  - 削除に伴い、これら2テストのみが使っていた `waitForInfra` ヘルパー・
    `WorkbenchEntity` 型 import・`describe("A 層: 接続時スナップショット")` /
    `describe("B 層: ピア接続")` の空になった describe ブロックも合わせて
    除去した。残す「B 層: ブロック伝播タイミング」（PROTO-B-01）は無変更
- `packages/e2e/SCENARIOS.md` の棚卸し表の該当2行を、#200で他行に使われて
  いる書式に揃えて「移行済み（#228で削除）」に更新

#### 決定事項・注意点

- 削除前に、UI-A-01がcompose 6ノード+ワークベンチ全件のkind相当
  （カード表示・clientType表示）を検証し、UI-B-01がbeacon1-beacon2間の
  ピアエッジ（加えてreth1-reth2間も）を検証していることを実装コードで
  確認してから削除した（裏取り）
- `pnpm test:e2e`（vitest、WSプロトコル層）を実際に実行し、残った
  PROTO-B-01を含む全テストがgreenのままであることを確認した

#### レビュー（chainviz-reviewer, 2026-07-09）

- 判定: **合格**（軽微な指摘1件あり、対応は任意）
- 確認内容:
  - 削除2テストの移行先カバレッジを実コードで裏取り。A層スナップショット
    （6ノード+ワークベンチのkind/clientType）は `ui/infra-display.spec.ts`
    UI-A-01 が7枚のカード表示（`.infra-card--node`/`.infra-card--workbench`
    での件数確認+`infra-card-<id>` 完全一致）・6ノード全件のclientType表示・
    ワークベンチ/ノードの種別差（操作ボタンの有無）で同等以上に検証。
    beacon間PeerEdgeは `ui/p2p-graph.spec.ts` UI-B-01 が beacon1-beacon2 の
    ピアエッジ（`data-id^="peer-"`）に加え reth1-reth2 も検証しており同等以上
  - 「残す」指定のPROTO-B-01（ブロック伝播タイミング）は無変更
    （ファイル冒頭コメントの範囲説明の更新のみ）であることを diff で確認
  - 未使用となった `NodeEntity`/`WorkbenchEntity` import・`PROJECT`/`id`・
    `waitForInfra` の除去を確認。他テストファイルは各自ローカル定義を持つため
    影響なし
  - SCENARIOS.md 棚卸し表の書式は #200 の既存行「移行済み（#200で削除）」と
    一貫
  - `pnpm build` / `pnpm lint` / `pnpm test` 全通過を確認
  - コミットは「テスト削除」「SCENARIOS.md更新」「worklog追記」の3分割で
    1変更1コミットの規約に適合
- 軽微な指摘（非ブロッキング）: `packages/e2e/src/d-layer.test.ts:30` の
  コメントが、今回削除した `waitForInfra` を待ち時間の例として参照した
  ままになっている（動作影響なし。別の機会の修正でよい）
