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
