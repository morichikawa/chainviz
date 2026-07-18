### 2026-07-16 Issue #346 UI層E2Eテストの一部が実.hover()依存・描画安定性不足でflakyになりうる（起票・バックログ追記のレビュー）

- 担当: reviewer
- ブランチ: docs-issue-346-backlog
- 内容: Issue #322のQA検証中にchainviz-qaが発見した既存のE2Eテスト脆さの
  Issue起票と、`docs/PLAN.md` バックログへの追記（docsのみの変更）のレビュー。
  - Issue #346本文とQA報告（`docs/worklog/issue-322.md` のQA記録）の照合:
    個別再現した4テスト（UI-C-04/UI-CMD-07/UI-ERR-02/UI-D-03）の失敗内容・
    UI-B-06をクロステスト汚染の誤検出として対象外にした判断・
    「slot time非依存の既存脆さ」という切り分け・期待する対応
    （dispatchHoverへの寄せ、UI-CMD-07のstable調査、UI-ERR-02の検出経路
    確認）のいずれもQA報告と一致し、過不足なし
  - Issue本文が参照する事実の実在確認: `dispatchHover` は
    `packages/e2e/src/ui/support/interactions.ts` に実在、UI-D-02は
    `packages/e2e/src/ui/node-internals.spec.ts` に実在し実.hover()を
    使わない代替手段の参考例という記述は正確
  - `docs/PLAN.md` の追記フォーマットは直前の #341 項目と一貫
    （チェックボックス+6スペースインデントの補足+Issueリンク行）。
    配置（バックログ節末尾・「## 運用ルール」の直前）も適切
  - `pnpm lint` / `pnpm build` / `pnpm test` 全通過を確認
- 決定事項・注意点:
  - レビュー結果は合格。コード変更を伴わないためCLAUDE.mdの例外規定に
    基づきchainviz-qaは省略可
  - QA報告は「それぞれ別Issue(frontend/e2e)」を推奨していたが、共通の
    根（実.hover()依存・描画安定性）を持つため1 Issueにまとめた統括の
    判断は妥当。着手時に原因が独立と判明したら分割すればよい
  - ラベルは bug + frontend。リポジトリに `e2e` ラベルは存在せず、
    Issue本文に対象パッケージ（`packages/e2e`）が明記されているため
    frontend で問題ない
  - 実装着手は後日。着手時は UI-CMD-07 について Issue #328
    （preserveDraggingState）との関連調査から入るのがよい

### 2026-07-17 Issue #346 実装（UI-C-04/UI-D-03のdispatchHover化、UI-ERR-02の検出経路修正。UI-CMD-07は未解決）

- 担当: frontend
- ブランチ: issue-346-e2e-hover-flakiness

#### 設計メモ（着手前の方針）

- UI-D-03（`card.hover()`）・UI-C-04（`eventChip.hover()`）は、UI-D-02
  （`node-internals.spec.ts`）が既に確立している `dispatchHover`（実マウス
  座標を経由せず対象要素へ直接 `mouseover` を dispatch する）へ寄せる。
  `InfraNodeCard`/`ContractCard` のポップオーバーはどちらも
  `useHoverPopover` の `onMouseEnter`（React合成イベント。ネイティブの
  `mouseover` から合成される）で開閉するため、同じ仕組みが使えるはず、
  という仮説で着手する
- UI-CMD-07 は Issue #328（preserveDraggingState）との関連を疑い、まず
  `Canvas.tsx`/`canvasNode.ts` のドラッグ状態引き継ぎロジックを確認する。
  原因不明で難航する場合は統括に chainviz-detective への追加依頼を提案する
- UI-ERR-02 は「エラー要素が0件で検出できない」の実際の失敗箇所（どの
  locator がどう失敗しているか）をまず実行して特定してから対応方針を決める

#### 実施内容

**事前準備**: 実 Docker 環境（既存の稼働中スタックを再利用）に対し、各
修正について「修正前に実際に失敗を再現 → 修正 → 再現しなくなることを
確認」の手順を徹底した（CLAUDE.md の運用ルール）。chromium は
システムライブラリ未導入のホストのため `LD_LIBRARY_PATH` に既存の
展開済みライブラリ（`~/chrome-deps/root/usr/lib/x86_64-linux-gnu`）を
足して実行した（ARCHITECTURE.md §8.6 の既知の前提と同じ対応）。

**UI-D-03**: 修正前に実行し、`card.hover()` の次の行
`expect(popover).toBeVisible()` が `element(s) not found` で失敗する
ことを確認した。原因を調査したところ、実際には2つの独立した問題が
あった。

1. `card.hover()` 自体は失敗しなかった（今回の環境では viewport 外には
   ならなかった）が、issue-322.md の QA 記録どおり React Flow の
   キャンバスは CSS transform によるパン/ズームでありスクロールコンテナ
   ではないため、対象カードが初期ビューポート外に配置された場合
   Playwright 標準の自動スクロール（scrollIntoViewIfNeeded）が効かず
   `hover()` が失敗しうる。座標非依存の `dispatchHover(card)` へ置き換えた
2. **より本質的な原因**: `popover` のロケータが `card.getByTestId(...)`
   （`card` の子孫として探索）になっていたが、`InfraPopover` は
   Issue #245（`PopoverPortal`）以降 `document.body` 直下へ portal
   描画されるため、DOM 上は `card` の子孫にならない。この
   `node-internals.spec.ts`（D層テスト）は Issue #245 より**前**に書かれて
   おり（`git log` で確認: テスト実装コミット `0594a96` → portal化コミット
   `2fce74b`）、portal化で locator のスコープが静かに壊れていた。
   `dispatchHover` だけでは解決せず、`page.getByTestId(...)`（page 直下から
   特定）に変更して初めて解消した。UI-D-02 が同じ portal 化の影響を受けて
   いないのは、そもそも `page.locator(".internal-link-popover")` と
   scope せずに探索していたため（=最初から今回の壊れ方をしない書き方
   だった）

**UI-C-04**: 同じ観点で調査したところ、`ContractCard.tsx` の
`contract-activity-chip__popover` も同じ Issue #245 の8箇所の portal化
対象の1つであり、`eventChip.locator(".contract-activity-chip__popover")`
という子孫スコープの locator が同様に壊れていた。`eventChip.hover()` を
`dispatchHover(eventChip)` に、popover の locator を
`page.locator(".contract-activity-chip__popover")` に変更した。

**UI-ERR-02**: 修正前に実行し、`ツールバーの「ノード追加」ボタンを押す`
ステップの `expect(anyGhostCard(page)).toHaveCount(2)` が
「14 × locator resolved to 0 elements」で失敗することを確認した
（issue-322.md QA記録の「14回リトライ」と一致）。原因は Issue #235
（`gh issue view 235` で state:CLOSED を確認）が既に修正済みだったこと。
修正前は `sendCommand` が未接続でも `commandId` を返しゴーストカードが
作られていたが、修正後（commit `39f5764`）は `sendCommand` が未接続時に
`undefined` を返すようになり、`useCommands.ts` の `dispatch` はゴーストを
作らず即座にエラートーストを出すようになった。しかし
`connection-errors.spec.ts` の UI-ERR-02 はこの修正時に更新されておらず、
「ゴーストが出た後60秒で無言で消える・トーストは出ない」という**修正前の
挙動**を検証したままだった。テストを新しい挙動（ゴーストは作られず、
即座にエラートーストが出る）に合わせて書き換え、`packages/e2e/SCENARIOS.md`
の UI-ERR-02 節も同様に更新した。

**UI-CMD-07（未解決）**: `commands-workbench.spec.ts` を単体・クリーンな
スタックに対して6回連続実行したが、いずれも合格し「削除ボタンが stable に
ならない」事象を再現できなかった。加えて `chain-ribbon.spec.ts` →
`commands-node.spec.ts` → `commands-workbench.spec.ts` の順で実行し
issue-322.mdのQA時に近い「他specの影響で世界状態が変化した状態」を再現
しようとしたが、この試みは無関係な原因（他エージェントが並行して同じ
共有Dockerスタックへ追加していたコンテナ`beacon3`/`reth3`/`test-2`により
ノード数が6ではなく8になっていた環境汚染）で `chain-ribbon`/`commands-node`
側が先に失敗し、`commands-workbench.spec.ts` 自体の実行までたどり着けな
かった。`preserveDraggingState`（Issue #328）のコードを読んだ限り、
`dragging === true` のノードにのみ影響する設計であり、削除ボタンを
クリックするだけの UI-CMD-07 のフローで意図せず dragging 状態になる
経路は見当たらなかった。削除ボタン自体にも継続的な transform/position
アニメーションを与える CSS は無い（スピナーは `removalPending` 中のみ）。
以上の理由から、コードレビューだけでは自信を持って断定できる根本原因に
辿り着けなかった。テストコード自体は変更せず、統括に
chainviz-detective への追加調査を提案する。

#### 検証結果

- `pnpm --filter @chainviz/e2e build`: 通過
- `pnpm --filter @chainviz/e2e test`（Docker非依存ユニット）: 171件通過
- 実 Docker 環境での個別再実行（いずれも修正後に合格を確認）:
  - `node-internals.spec.ts`（UI-D-01/02/03 まとめて）: 3件合格
  - `contract-lifecycle.spec.ts`（UI-C-03/04/06 まとめて）: 3件合格
  - `connection-errors.spec.ts` UI-ERR-02: 単体で合格（UI-ERR-01は本Issue
    と無関係な環境汚染=ノード数8件で失敗。後述）
  - `commands-workbench.spec.ts`（UI-CMD-05/06/07）: 6回連続合格（本来の
    再現対象だった「stable にならない」事象は不再現）

#### 決定事項・注意点

- 実 Docker 環境は複数エージェントが並行して同じ既存スタック
  （`chainviz-ethereum`）を共有して使っている。今回の作業中に
  `chainviz-ethereum-e2e-ui-alice-2-4`/`-e2e-ui-alice-3`（自分がbashの
  タイムアウトでテストプロセスを途中終了させ、Playwrightのafterallに
  よる後始末が走らなかったことが原因）と
  `chainviz-ethereum-e2e-ribbon-recipient-mrp057nv-3`（同様にchain-ribbon
  のテストプロセスを完走させられなかったことが原因）という自分自身の
  作業起因のコンテナが残存したため、作業終了時に `docker rm -f` で削除し
  ベースラインへ戻した。E2Eの実Docker検証はテストを完走させる（bashの
  タイムアウトで途中終了させない）ことを徹底しないと、afterAll の後始末が
  動かず環境を汚してしまう
- `beacon3`/`reth3`/`test-2` コンテナは本Issueの作業前から存在していた
  もの（他エージェントの並行作業由来と推測。自分は削除していない）。
  これが原因で `commands-node.spec.ts`/`chain-ribbon.spec.ts` 等
  本来無関係なテストがノード数不一致で失敗することがある。UI-CMD-07の
  再現失敗の一因としてこの環境汚染も否定できないため、chainviz-detective
  が追調査する際は「クリーンな独立スタック」（Issue #369の合成環境）で
  行うことが望ましい
- Issue #245（PopoverPortal化）・Issue #235（sendCommand未接続時の挙動
  修正）は、いずれも「frontend側の正当な修正が、既存のE2Eテストの暗黙の
  前提（DOM構造・挙動）を壊したが、テスト側が追随していなかった」という
  同型のパターン。将来同種のfrontend修正（特にポップオーバー実装や
  コマンド送信経路）を行う際は、対応するE2Eテスト（`packages/e2e/src/ui/`）
  に影響が無いか確認することを推奨する
- `docs/PLAN.md` のIssue #346チェックボックスは、UI-CMD-07が未解決のため
  完了とせず、進捗を注記するに留めた（Issueのクローズ・分割判断は統括に
  委ねる）

### 2026-07-17 Issue #346 テスト強化（portalスコープ崩れの横断確認・UI-ERR-02の検証強化）

- 担当: tester
- ブランチ: issue-346-e2e-hover-flakiness（`issue-346-impl-worktree` worktree）

#### 実施内容

**1. Issue #245 portal化による同種のlocatorスコープ崩れの横断確認**

実装担当はUI-C-04（contract-lifecycle）・UI-D-03（node-internals）の2箇所を
修正したが、同じパターンが他のE2Eテストに残っていないか
`packages/e2e/src/ui/` 配下を全数確認した。PopoverPortal経由で
`document.body` 直下へportal描画される全ポップオーバー（InfraPopover /
ContractPopover / WalletPopover / TxLifecyclePopover / ChainRibbonPopover /
GlossaryTerm / ActionHint / contract-activity-chip__popover）について、
各specがそのポップオーバーをトリガー要素の子孫としてスコープしていないかを
照合した。

その結果、`infra-display.spec.ts` に同型の未修正が2箇所残っていた。

- UI-A-02（`infra-popover-${RETH1_ID}`）: `card.getByTestId(...)` のまま
- UI-A-05（`glossary-popover-container`）: `card.getByTestId(...)` のまま

いずれもnode-internals UI-D-03と同一のportalスコープ崩れ（portal描画で
カードの子孫にならないため`card`スコープのlocatorが解決できない）。両方を
`page.getByTestId(...)` へ修正した。用語アンカー（`glossary-term-container`）
自体はカードの子孫として描画されるため`card`スコープのまま据え置いた。

その他のportal系specは問題なし。`chain-ribbon.spec.ts` は外側の
`chain-ribbon-popover-${hash}` を`page.getByTestId(...)` で取得し、内側の
`chain-ribbon-popover-parent-${hash}` はportal描画されたpopoverの子孫として
`popover.getByTestId(...)` で取得しており、いずれも正しいスコープ。
`node-internals.spec.ts`（UI-D-03修正済み）・`contract-lifecycle.spec.ts`
（UI-C-04修正済み）も確認済み。wallet-balance / token-balance / p2p-graph
等の残りのspecはポップオーバーのホバー検証を含まない。

**2. UI-ERR-02の検証強化**

「ゴーストが作られない」「即座にエラートーストが出る」の両方は検証済み
だったが、ゴースト数0の検証（`toHaveCount(0)`）を先に評価していたため、
クリックのdispatchが処理される前の空の状態を評価して素通りしうる余地が
あった（ゴーストが作られる退行を見逃す）。エラートーストの出現（=dispatch
完了）を先に待ってからゴースト数0を確認する順序へ変更し、トーストが空文字で
ないこと（理由の文言が入っていること）も確認するようにした。

**3. dispatchHoverの境界値確認（コード変更なし）**

`dispatchHover(target)` は `target.dispatchEvent("mouseover")` への薄い委譲。
対象要素が存在しない場合はPlaywrightのauto-waitがタイムアウトし明示的な
エラーで失敗する（無言では通らない）ため、テストヘルパーとして望ましい
挙動になっている。存在チェックを足すと本来検出すべきテスト失敗を握りつぶす
ことになるため、防御コードは追加しない。

#### 検証結果

- `pnpm --filter @chainviz/e2e build`: 通過（`@chainviz/shared` を先にビルド
  した上で `tsc --noEmit` が exit 0）
- frontend側 `popoverPortalConsistency.test.tsx` / `GlossaryTerm.testid.test.tsx`
  / `InfraPopover.testid.test.tsx`（計19件）を実行し全通過。
  `popoverPortalConsistency.test.tsx` は InfraPopover・GlossaryTerm を含む
  全8ポップオーバーについて「popoverは`document.body`配下にあり、トリガーの
  ローカルサブツリー（container）の子孫ではない」ことを固定しており、本修正
  （`card`スコープ → `page`スコープ）の正しさを直接裏付ける。
- 実Docker環境でのinfra-displayフル再実行は、作業時点で共有スタック
  （`chainviz-ethereum`）に他エージェントの並行作業由来の追加コンテナ
  （`beacon3`/`reth3`/`test-2`/`workbench-3`、いずれも2時間稼働）が存在し、
  infra-displayが期待するノード数（compose 6 + workbench = 7）と一致しない
  ため、破壊的な `down -v` なしには実施できなかった。E2Eの排他ロックは
  空だが、追加コンテナは並行作業由来（実装記録でも `beacon3`/`reth3`/`test-2`
  は他エージェント由来と記載）であり使用中の可能性を排除できないため、
  共有スタックのdown/upは行っていない。修正の正しさは上記の静的根拠・
  frontend単体テスト・実装担当による同一パターン（node-internals UI-D-03、
  同じInfraPopover・同じ`infra-popover-${id}`）の実Docker再現の3点で裏付け
  られる。クリーンな共有スタックが得られた時点でinfra-display.spec.ts
  （UI-A-01〜UI-A-05）のフル再実行による最終確認を残す。

#### 決定事項・注意点

- 変更はE2Eテストのlocator・検証順序のみ。実装コード・SCENARIOS.mdの
  シナリオ記述に変更は無い（挙動・シナリオ自体は変えていないため）。
- infra-display UI-A-02/UI-A-05は`card.hover()`/`term.hover()`（実マウス
  ホバー）を維持した。RETH1は compose ノードで初期レイアウト上ビューポート
  内に配置され、node-internals UI-D-03のDRIVENノード（実行時追加で
  ビューポート外に置かれうる）と異なりviewport外問題が生じにくいこと、
  およびUI-A-02の「ホバーを外すとポップオーバーが消える」ステップが
  `page.mouse.move(0,0)` の実マウス移動に依存する（dispatchHoverで開くと
  実ポインタが要素上を通らず`mouseout`が発火せず閉じない）ことから、
  最小変更としてlocatorスコープのみを修正した。

### 2026-07-17 Issue #346 実装・テスト強化の静的レビュー

- 担当: reviewer
- ブランチ: issue-346-e2e-hover-flakiness（`issue-346-impl-worktree` worktree）
- 判定: **合格**（実装担当への差し戻しなし）

#### 確認内容

- **変更範囲**: 分岐点（`18db8f4`）からの差分は `docs/`（PLAN.md・worklog）と
  `packages/e2e/`（SCENARIOS.md・spec 4ファイル）のみ。`packages/shared` への
  変更が無いことを確認
- **portalスコープ崩れの横断再確認**: `packages/e2e/src/ui/` 全14 specを対象に、
  ポップオーバー系locator（`*popover*` を含む `getByTestId`/`locator`）と
  `.hover()`/`dispatchHover` の全呼び出し箇所を独自にgrepで全数照合した。
  ポップオーバーのルート要素はすべて `page` スコープで解決し、その内部要素のみ
  ポップオーバー自身のスコープで解決する形になっており、トリガー要素の子孫として
  portal要素を探す誤ったスコープは残っていない（chain-ribbon の
  `popover.getByTestId(...)` はportal描画されたpopover自身の子孫探索であり正しい）。
  WalletPopover / TxLifecyclePopover / ActionHint / ContractPopover をホバーで
  開いて検証するspecは存在しないことも確認（tester の横断確認結果と一致）
- **frontend実装との整合**: `InfraPopover.tsx`（`infra-popover-${id}`）・
  `GlossaryTerm.tsx`（`glossary-popover-${termKey}`）・`ContractCard.tsx`
  （`.contract-activity-chip__popover`）・`Toast.tsx`（`toast-${id}` /
  `toast toast--${kind}`）・`websocket/client.ts`（未接続時 `sendCommand` が
  `undefined`）・`useCommands.ts`（未接続時ゴーストを作らず
  `describeCommandNotConnectedError` のerrorトースト）をすべて実コードで照合し、
  テストの期待と一致することを確認
- **UI-ERR-02の検証順序の妥当性**: 「トースト出現＝dispatch完了」を前提に
  ゴースト数0を後から確認する順序について、トーストの発火元が
  `useCommands.ts` の3箇所（コマンド結果エラー・ゴーストタイムアウト安全網・
  未接続エラー）に限られ、切断そのものではトーストが出ないことを確認した。
  クリック前にトーストが存在しない前提が成立するため、この順序変更は
  「素通り」の余地を実際に塞いでいる
- **品質ゲート観点**: エラー握りつぶしの追加なし（dispatchHoverに防御コードを
  足さない判断は「テスト失敗を握りつぶさない」方向で妥当）。環境依存の
  固定値はむしろ削減（GHOST_DISAPPEAR_TIMEOUT_MS 70秒待ちの撤去）。
  修正前の再現→修正→解消の手順が worklog に記録されている
- **コミット粒度**: 6コミットいずれも単一の関心事（UI-D-03/UI-C-04修正、
  UI-ERR-02追随、UI-A-02/05修正、UI-ERR-02強化、docs×2）で、
  Conventional Commits 形式にも準拠
- **ビルド・テスト**: `pnpm lint` / `pnpm build`（e2eの `tsc --noEmit` 含む）/
  `pnpm test`（shared 74・collector 1563・e2e 171・frontend 2592、全通過）を
  リポジトリ全体で確認

#### 非ブロッキングの指摘（差し戻し不要、フォローアップ推奨）

1. `packages/e2e/src/ui/support/interactions.ts` の `dispatchHover` doc
   コメントは「ノードカードのように単独でヒットテストできる要素は素直に
   hover() を使ってよい」という従来の整理のままだが、UI-D-03 で
   「初期ビューポート外に配置されうるカードは hover() が失敗する」という
   第2の理由が判明した。呼び出し側（node-internals.spec.ts）には記載済み
   だが、ヘルパー側のガイドも将来更新するとよい
2. `docs/PLAN.md` の #346 注記にある「UI-CMD-07 は chainviz-detective への
   追加調査を提案中」は、その後 main 側で Issue #373 として分割済みのため、
   main へのマージ時に統括が #373 への参照へ更新（またはコンフリクト解消）
   する必要がある（本ブランチ作成後に main が先行したことによる記述の陳腐化。
   本ブランチ自体の欠陥ではない）
3. UI-A-02/UI-A-05 で実 `hover()` を維持した理由（RETH1 は初期レイアウトで
   ビューポート内・UI-A-02 の「ホバーを外すと閉じる」が実ポインタ移動に依存）
   は worklog にのみ記録されている。spec 側コメントにも一言あると、将来の
   担当が安易に dispatchHover 化して閉じる検証を壊すことを防げる

#### QAへの申し送り

- `infra-display.spec.ts`（UI-A-01〜UI-A-05）の実Docker環境でのフル再実行が
  未実施（tester作業時に共有スタックへ他エージェント由来の追加コンテナ
  `beacon3`/`reth3`/`test-2`/`workbench-3` が存在しノード数が期待値と不一致
  だったため、破壊的な down/up を避けて見送られた）。クリーンなスタックで
  必ず実施すること

### 2026-07-18 Issue #346 最終QA検証（クリーンスタックでのE2Eフル再実行）

- 担当: qa
- ブランチ: issue-346-e2e-hover-flakiness（`issue-346-impl-worktree` worktree、HEAD=77a577d mainマージ済み）
- 判定: **合格**（#346のflaky問題は解消。実装担当への差し戻しなし）

#### 実施環境

- 稼働中の共有スタック（`chainviz-ethereum`）は開始時点で6ノード+workbench+genesis
  （one-shot Exited 0）のみで、tester作業時に問題となった追加コンテナ
  （`beacon3`/`reth3`/`test-2`/`workbench-3`）は存在しなかった。ただしconfigパスが
  既に削除された別worktree由来だったため、自worktreeのcomposeで
  `docker compose down -v` → `up -d` によりクリーンなgenesisから作り直した。
  e2e排他ロック（`/tmp/chainviz-test-e2e.lock`）は空で、実行中のplaywright/
  vitest/collectorプロセスも無く、並行利用が無いことを確認した上で実施。
- chromiumはシステムライブラリ未導入ホストのため、既存の展開済みライブラリ
  （`~/chrome-deps/root/usr/lib/x86_64-linux-gnu`）を `LD_LIBRARY_PATH` に足して実行
  （ARCHITECTURE.md §8.6・過去の作業と同じ対応）。slot=12秒。

#### 実行結果

- **重点4spec（infra-display / node-internals / connection-errors / multi-client、
  計12テスト）を3回連続実行し、いずれも12件全通過**（36テスト実行で失敗ゼロ）。
  申し送りで未実施だった `infra-display.spec.ts`（UI-A-01〜UI-A-05）を
  クリーンスタックで実行し、UI-A-02（`infra-popover`）・UI-A-05
  （`glossary-popover-container`）のportalスコープ修正が実環境で正しく動作する
  ことを確認した。
- **#346が直接修正した他specも確認**:
  - `contract-lifecycle.spec.ts` UI-C-04（ContractCard ActivityChipの
    dispatchHover化・portal対応locator）: 通過。
  - `commands-workbench.spec.ts` UI-CMD-07（#373のfitCanvasView堅牢化の対象）:
    3回連続で通過。tester/impl時に「stableにならない」と報告されていた事象は
    #373の修正取り込み後は再現しなかった。
- **UI-C-06の扱い（#346対象外）**: `contract-lifecycle` 初回実行でUI-C-06のみ
  セットアップ（`docker compose exec workbench forge create`）が
  `host.docker.internal:4001` へのConnection refusedで失敗した。原因は
  compose定義のworkbenchの `ETH_RPC_URL` がdev collectorのロギングプロキシ
  （4001）を指す一方、UI E2Eのcollectorは4125/4126で動くため、クリーン環境で
  4001に待受が無かったこと。UI-C-06は#346の変更範囲外
  （#346はUI-C-04のみ変更、差分で確認）で、失敗はホバー/描画のflakiness
  ではなく環境依存のプロキシ未起動。dev collectorを4000/4001で起動して
  4001プロキシを用意した状態で再実行するとUI-C-06も通過し、環境要因である
  ことを確認した。

#### 検証結論

- 申し送り事項（infra-displayのクリーンスタックでのフル再実行）を完了。
  #346の修正対象（dispatchHover化・portalスコープ修正・UI-ERR-02追随）および
  #373マージによるUI-CMD-07のstable化は、いずれも実Docker環境で複数回安定して
  通過する。#346のflaky問題は解消したと判断する。

#### 申し送り（#346とは別件・非ブロッキング）

- UI-C-06は、compose workbenchの `ETH_RPC_URL` が固定で4001（dev collectorの
  プロキシ）を指すため、UI E2E単独（dev collector無し）のクリーン環境では
  セットアップの `forge create` が到達できず失敗する。E2E collector（4125/4126）
  とworkbenchのRPC向き先が一致しない潜在的なテスト環境結合であり、#346以前から
  存在する。今回は関係無いため対処しないが、backlog化を検討する価値がある。
- 検証後、起動したdev collector（4000/4001）は停止済み。テストのafterAllにより
  managedコンテナの残存は無く、スタックはbaseline（6ノード+workbench+genesis）へ
  戻っていることを確認した。
