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
