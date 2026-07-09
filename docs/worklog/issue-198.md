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

### 2026-07-09 Issue #198 テスト強化記録

- 担当: tester
- ブランチ: issue-198-frontend-testids

実装担当が追加した data-testid が「属性が付いているだけ」でなく、想定の
条件・タイミングで DOM に現れることを検証する観点でテストを追加した。
関心事ごとに新規ファイルへ分離し、既存テストファイルは肥大化させない。

追加ファイルとカバーした観点:

- `src/glossary/GlossaryTerm.testid.test.tsx`(新規)
  - popover の testid が閉じている間は DOM に存在せず、ホバー
    (mouseEnter/mouseLeave)・フォーカス(focus/blur)の開閉に合わせて
    出入りすること(アンカーの testid は常時存在)
  - unknown term(glossary に無い用語)はプレーン span へフォールバック
    するため `glossary-term-*` / `glossary-popover-*` の testid 自体が
    存在しないこと
  - 複数の異なる termKey を同時にレンダーしたとき各アンカーが一意に
    識別でき、ホバーした用語の popover だけが対応する termKey で開くこと
  - 同一 termKey を複数箇所で使うと testid が一意にならない(getByTestId
    が例外、getAllByTestId で複数取得)という制約を挙動として固定
- `src/entities/InfraPopover.testid.test.tsx`(新規)
  - entity.id が変わったとき(ゴースト仮 id → 実 id への差し替え)に
    testid が新しい id へ追従し、古い id の testid が残らないこと
  - testid は containerName ではなく id をキーにすること
  - node と workbench の popover を同時にレンダーしても id ごとに
    別要素として一意に識別できること

接続ステータスバッジ(`connection-status-badge`)の「接続状態が変化した
ときにも同じ testid を保つ」観点は、モッククライアントが connect() で
同期的に connected へ遷移し connecting 状態を経由しない・StatusBadge が
非 export のため、実装を変えずに `<App>` 経由で状態遷移を駆動する手段が
無い。既存の `App.connectionStatusBadge.test.tsx` が connected 表示と
isMock の出し分けを固定しているため、追加のテストは見送った(実装変更を
避けるため)。

作業中に見つけた不具合・改善要望は無し(GitHub Issue の起票は無し)。

`pnpm build && pnpm lint && pnpm test` をリポジトリ全体で実行し全パッケージ
green を確認(frontend: 91 test files / 1368 tests)。

### 2026-07-09 Issue #198 レビュー記録

- 担当: reviewer
- ブランチ: issue-198-frontend-testids
- 判定: **合格**

確認した内容:

- ARCHITECTURE.md §8.5 の「追加計装が必要な箇所」5点(接続ステータス
  バッジ・キャンバスツールバー3要素・言語トグル・用語ポップオーバー・
  インフラポップオーバー)すべてに data-testid が追加されていることを
  差分で確認した。命名は既存34箇所のパターン(ケバブケース、
  `<種別>-<識別子>`、動的キーは `<種別>-<安定ID>`)と一貫している
- 5コンポーネントの実装差分はいずれも属性追加のみで、表示条件・分岐・
  ロジックの変更は無い(GlossaryTerm の unknown-term フォールバック分岐
  も従来どおりで、testid はフォールバック側に付かない)
- `GlossaryTerm.testid.test.tsx`: 開閉タイミング(hover/focus)での
  popover testid の出入り、unknown term での testid 不在、複数 termKey の
  一意識別、同一 termKey 重複時の getByTestId 例外(制約の固定)まで
  カバーしており妥当。`InfraPopover.testid.test.tsx`: ゴースト仮 id →
  実 id への差し替え追従、containerName 非依存、node/workbench 共存時の
  一意識別をカバーしており妥当
- catch 節の追加は無く、エラー握りつぶしの懸念箇所は無い。環境状態に
  依存する固定値の埋め込みも無い(e2e の 30 秒タイムアウトは #197 由来の
  既存値で今回の変更対象外)
- `pnpm build` / `pnpm lint` / `pnpm test` をリポジトリ全体で実行し
  全パッケージ green(shared 58 / collector 1084 / frontend 91ファイル
  1368テスト / e2e 50)。worklog 記載のテスト数とも一致
- docs/PLAN.md のチェックボックス(#198)・docs/WORKLOG.md 索引・本
  worklog の記述が実装と整合していることを確認した
- コミット粒度: 実装5コミット(1コンポーネント=1コミット、対応テスト
  同梱)+ e2e 1コミット + テスト強化2コミット + docs 2コミットの計10
  コミットで、関心事ごとの分割として適切
- テスト強化担当が見送った「接続ステータスバッジの状態遷移中の testid
  維持」は、App.tsx 上で testid が status に依存しない固定リテラルで
  あること(可変なのは className のみ)を静的に確認した。モック
  クライアントが同期的に connected へ遷移する以上、実装を変えずに
  中間状態を駆動できないという判断は妥当で、テストのために実装へ手を
  入れない選択も適切

指摘事項: 無し。push・PR作成・マージは統括の判断に委ねる。

### 2026-07-09 Issue #198 QA検証記録

- 担当: qa
- ブランチ: issue-198-frontend-testids
- 判定: **合格**

実際に frontend を起動し、追加された data-testid がブラウザ上で人間が
操作したときの見え方として機能することを確認した。

環境準備:

- Playwright の chromium 本体は導入済みだったが、システムライブラリ
  (`libnspr4.so` / `libnss3.so` / `libnssutil3.so` / `libasound.so.2`)が
  未導入で、この環境では `sudo` にパスワードが必要なため
  `playwright install-deps` を実行できなかった。同一スクラッチパッドに
  過去セッションが展開済みの当該 .deb 由来ライブラリ一式があったため、
  `LD_LIBRARY_PATH` にそのディレクトリを指定して chromium を起動した
  (システムへの変更は行っていない)。

実施した検証と結果:

1. `pnpm test:e2e:ui`(Playwright)を実行し、`foundation-smoke.spec.ts` が
   `page.getByTestId("connection-status-badge")` のロケータで green に
   なることを確認した(1 passed)。globalSetup が既存の稼働中
   chainviz-ethereum スタックを再利用し、UI 層専用ポートで collector を
   起動、vite dev 経由で実 collector に接続した状態でグリーンになった。

2. frontend をモックデータモード(`VITE_COLLECTOR_URL` 未設定)で vite dev
   起動し、chromium から操作して以下を確認した(全 10 項目 PASS):
   - `connection-status-badge` が存在し、テキスト「接続済み・モック
     データ」、class に `status-badge--connected` を持つ
   - `canvas-toolbar-add-node` / `canvas-toolbar-workbench-label` /
     `canvas-toolbar-add-workbench` がいずれも可視
   - `language-toggle` が存在し、クリックでラベルが「English」→「日本語」に
     切り替わる(実際にトグルとして機能する)
   - `glossary-term-*` アンカーが 28 個存在。先頭アンカーにホバーすると
     対応する `glossary-popover-*` が実際に表示され、ポインタを外すと
     消える(開閉が機能する)
   - インフラカードにホバーすると `infra-popover-<entity.id>`
     (`infra-popover-lighthouse-1`)が実際に表示される
   - ページ内 JS エラーは 0 件

3. スクリーンショットで実際の描画も確認した。ツールバー・接続バッジ・
   言語トグルが所定の位置に描画され、用語ポップオーバーは定義文と
   関連語リンクを含んで可視表示され、インフラポップオーバーは IP・
   ポート・クライアント・CPU・メモリを含んで可視表示された(DOM 属性の
   有無だけでなく人間が見たときの見え方としても機能している)。

ARCHITECTURE.md §8.5 の 5 箇所すべてが実機で仕様どおりロケータとして
機能し、Issue #198 の完了条件を満たしていると判定する。push / PR 作成 /
マージ / Issue クローズは統括の判断に委ねる。
