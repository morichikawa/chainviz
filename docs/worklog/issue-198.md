### 2026-07-09 Issue #198 frontendへのdata-testid追加(設計メモ)

- 担当: frontend
- ブランチ: issue-198-frontend-testids

#### 設計メモ(着手前)

`docs/ARCHITECTURE.md` §8.5 が明記する「追加計装が必要な箇所」5点に絞って
`data-testid` を追加する。対応表は以下のとおり(既存34箇所の命名規則
`<種別>-<識別子>` のケバブケースに揃える)。

| 対象 | ファイル | 追加する data-testid | 備考 |
| --- | --- | --- | --- |
| 接続ステータスバッジ | `app/App.tsx` (`StatusBadge`) | `connection-status-badge` | UI-CONN-01。単一要素なので識別子サフィックス無し |
| ツールバー: ノード追加ボタン | `canvas/CanvasToolbar.tsx` | `canvas-toolbar-add-node` | UI-CMD-01 等 |
| ツールバー: ワークベンチラベル入力 | `canvas/CanvasToolbar.tsx` | `canvas-toolbar-workbench-label` | UI-CMD-05/06 |
| ツールバー: ワークベンチ追加ボタン | `canvas/CanvasToolbar.tsx` | `canvas-toolbar-add-workbench` | UI-CMD-05/06 |
| 言語トグル | `i18n/LanguageToggle.tsx` | `language-toggle` | UI-A-03 |
| 用語ポップオーバー(アンカー) | `glossary/GlossaryTerm.tsx` | `glossary-term-<termKey>` | ホバー/フォーカス対象。UI-A-05 |
| 用語ポップオーバー(中身) | `glossary/GlossaryTerm.tsx` | `glossary-popover-<termKey>` | 定義文の中身を検証する側 |
| インフラポップオーバー | `entities/InfraPopover.tsx` | `infra-popover-<entity.id>` | UI-A-02。entity.id は node/workbench 共通の安定 ID(`InfraEntity.id`) |

方針・判断:

- `WalletPopover` / `ContractPopover` / `PeerEdgePopover` は §8.5 の
  追加計装リストに無く、中身の個々の要素(`wallet-token-*` /
  `contract-activity-chip-*` 等)に既に testid があるため、ポップオーバー
  自体のラッパーには追加しない(スコープをARCHITECTURE.mdの明記どおりに
  絞る)
- React Flow のエッジは CLAUDE.md/ARCHITECTURE.md の方針どおり `data-id`
  で識別できるため対象外
- `packages/e2e/src/ui/foundation-smoke.spec.ts` は現状
  `.status-badge--connected` という CSS クラスで接続確認をしている
  (コメントに「#198で計装後に置き換え可能」の旨が明記されている)。
  今回 `connection-status-badge` を追加したので、実際に Playwright から
  ロケータとして使えることを確認する目的でこのテストを
  `page.getByTestId("connection-status-badge")` ベースに置き換える
  (フロントの変更ではなく `packages/e2e` 側の変更のため別コミットにする)
- いずれもロジック変更を伴わない(表示条件・分岐の追加は無い)ため、
  CLAUDE.mdの「ロジックを伴わない見た目調整はユニットテスト対象外」に
  該当するが、「追加したdata-testidが実際にロケータとして使えること」の
  確認として、既存の対応コンポーネントのテストファイル(App用に新規、
  CanvasToolbar.test.tsx・LanguageToggle.test.tsx・GlossaryTerm.test.tsx・
  InfraPopover.test.tsxは既存ファイルへ追記)に「要素が testid で取得できる」
  ことを確認するテストケースを足す
- 接続ステータスバッジは `App.tsx` 内のローカル関数 `StatusBadge`
  (非export)のため、専用の新規テストファイル
  `app/App.connectionStatusBadge.test.tsx` を1本作り、実際に `<App>` を
  マウントしてモッククライアント経由で `connected` になった時点・
  `isMock` の出し分けを確認する(1ファイル1責務: 既存の
  `App.internalLink.test.tsx` / `App.workbenchOperations.test.tsx` とは
  別関心事のため分離する)

#### 実施結果

設計メモどおり5点に `data-testid` を追加した。

- `app/App.tsx`: `StatusBadge` の span に `connection-status-badge`
- `canvas/CanvasToolbar.tsx`: ノード追加ボタンに
  `canvas-toolbar-add-node`、ワークベンチラベル入力に
  `canvas-toolbar-workbench-label`、ワークベンチ追加ボタンに
  `canvas-toolbar-add-workbench`
- `i18n/LanguageToggle.tsx`: ボタンに `language-toggle`
- `glossary/GlossaryTerm.tsx`: ホバー/フォーカス対象のアンカー span に
  `glossary-term-<termKey>`、定義文ポップオーバーの span に
  `glossary-popover-<termKey>`
- `entities/InfraPopover.tsx`: ポップオーバーのルート div に
  `infra-popover-<entity.id>`(node/workbench 共通の `InfraEntity.id`)

いずれも表示条件・分岐の追加を伴わない属性追加のみ(ロジック変更なし)。
追加した testid が実際に取得できることを確認するテストを、対応する
既存テストファイルへ追記した(`CanvasToolbar.test.tsx` /
`LanguageToggle.test.tsx` / `GlossaryTerm.test.tsx` /
`InfraPopover.test.tsx`)。接続ステータスバッジのみ、`App.tsx` 内で
export されていないコンポーネントのため新規ファイル
`app/App.connectionStatusBadge.test.tsx` を追加し、`<App>` を実際に
マウントしてモッククライアント経由で `connected` 表示・`isMock` による
「モックデータ」表記の出し分けを確認した。

設計メモどおり `packages/e2e/src/ui/foundation-smoke.spec.ts` も
`.status-badge` という CSS クラスセレクタから
`page.getByTestId("connection-status-badge")` に置き換え、追加した
testid が実際に Playwright のロケータとして使えることを確認した(この
ファイルは #199 で正式なシナリオ実装に置き換わるまでの土台テストの
ため、コメントの `#198(data-testid 計装)` への参照も削除した)。

`pnpm build && pnpm lint && pnpm test` をリポジトリ全体に対して実行し、
全パッケージ(shared/collector/frontend/e2e)で green であることを確認
した(frontend: 89 test files / 1357 tests、e2e: 5 test files / 50
tests、いずれも green)。

作業中に見つけた新規の不具合・改善要望は無かった(GitHub Issue の起票
は無し)。

次の担当(#199〜#203)への申し送り:

- `WalletPopover` / `ContractPopover` / `PeerEdgePopover` のポップオーバー
  ルート自体には今回 testid を追加していない(§8.5 の明記リストに無く、
  中身の個々の要素に既存の testid があるため)。もし #201 実装時にこれら
  ポップオーバー自体をロケータとして直接扱う必要が出た場合は、同じ命名
  規則(`<種別>-popover-<識別子>`)で追加してよい
