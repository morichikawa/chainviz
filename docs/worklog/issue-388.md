# Issue #388 UI-B-06(chain-ribbon.spec.ts)がUI-B-05との併走時に間欠的にflakyになる

### 2026-07-18 Issue #388 起票の経緯

- 担当: 統括
- ブランチ: issue-388-ui-b06-flaky-backlog
- 内容: Issue #351の最終QA検証(docs/worklog/issue-351.mdの最終QA検証節)で
  chainviz-qaが偶発的に観測した既存のflaky問題をIssue化し、
  `docs/PLAN.md`のバックログ節末尾に追記した。
- 事実関係: `packages/e2e/src/ui/chain-ribbon.spec.ts`のUI-B-06は単独実行
  では3/3安定合格するが、UI-B-05との併走(同一ファイル内の連続実行)では
  round1・2で失敗しround3で合格するという間欠的なflakyが観測された。
  Issue #351のコード変更(`isReverseHighlighted`への`isDrivingParentHighlight`
  条件追加)はUI-B-06のテスト対象範囲(親ブロック行を見ない)に影響しない
  ことをQAがコードで確認済み。実態は、UI-B-06が「実送金→ブロック取り込み
  待ち→ホバー」を直列に行う構造上、対象ブロックが表示窓(直近8タイル)から
  流れ出るまでの時間との競合であり(docs/worklog/issue-298.mdに既出の課題)、
  併走時の負荷でこの競合を跨ぎやすくなる既存由来のタイミング依存と
  考えられる。

### 2026-07-18 Issue #388 起票・バックログ追記のレビュー

- 担当: reviewer
- ブランチ: issue-388-ui-b06-flaky-backlog
- 判定: **合格**
- Issue本文と`docs/PLAN.md`追記の一致、参照事実の実在確認
  (`packages/e2e/src/ui/chain-ribbon.spec.ts`のUI-B-05/UI-B-06、
  `docs/worklog/issue-298.md`のタイミング課題の記録、Issue #346の実在)、
  `docs/worklog/issue-388.md`とissue-351.mdの最終QA記録との整合性、
  `docs/WORKLOG.md`の#351行更新内容の整合性、コミット粒度、
  Conventional Commits形式、`pnpm lint && pnpm build && pnpm test`
  全パッケージ通過をすべて確認
- docs配下のみの変更のため、CLAUDE.mdの例外規定に基づきchainviz-qaは
  省略(reviewer合格のみ)

### 2026-07-18 Issue #388 設計メモ（待機戦略の見直し）

- 担当: designer
- ブランチ: issue-388-ui-b06-flaky
- 内容: UI-B-06の併走時flakyを構造的に解消するテスト戦略を設計した。
  設計の要旨は `docs/ARCHITECTURE.md` §10.6（新設）に反映済み。
  `packages/shared` の型変更は不要（確認済み。必要な
  `TransactionEntity.blockHash` は既存フィールド）。

#### 問題の分解（なぜ間欠的に失敗するか）

UI-B-06の現行構造には、独立した2つのタイミング依存がある:

1. **表示窓との競合**: 「included チップ観測 → Fit View クリック →
   チップへ実ホバー」の間にチェーンが進行すると、対象ブロックのタイルが
   表示窓（直近8タイル）から流れ出て、逆方向ハイライトの
   `toHaveCount(1)` が永遠に0のままになる（#298 QA検証で実測済みの
   メカニズム。表示窓の凍結 `useFrozenRibbonTiles` はホバー開始後に
   しか効かないため、ホバー開始前の流出は防げない）
2. **実マウスホバーの脆さ**: 実マウス座標に紐づくホバーは、併走負荷時の
   頻繁な再描画で要素がポインタの下から動くと `mouseleave` が発火して
   `hoveredBlockHash` が落ち、強調が消える（#298 QAの観測「一瞬点灯した
   後に消えて戻らない」、#346で体系化された実 `.hover()` 依存の脆さと
   同根）。#351 QAが観測したround1（正方向でカード強調が付かず）・
   round2（逆方向でタイル強調0件）の両方をこの2要因で説明できる

さらに現行テストは「チップにホバーして強調されたタイルを逆引きし、その
testidで正方向の対象を決める」構造のため、逆方向の成立が正方向の前提に
なっており、失敗が連鎖しやすい。

#### 設計判断（3点）

1. **フロントの製品挙動は変えない**（表示窓・凍結条件・ハイライト
   ロジックは現状のまま）。#298のQA差し戻し対応で製品側の窓流出は
   「ホバー中の凍結」として解決済みであり、今回のflakyは「ホバー開始
   までの競合」というテスト構造の問題。テスト都合で製品のUX（窓の
   前進仕様）を変える方向は採らない
2. **`TxChip` に `data-block-hash` を計装する**（唯一のフロント変更。
   1属性の追加のみ）。#351の `data-parent-hash`・#298の
   `data-connected-to-previous` と同じ「完全なhashをe2e用に露出する」
   既存流儀。これにより逆引きの往復が不要になり、対象タイルを
   `chain-ribbon-tile-<blockHash>` で直接・即座に特定できる。
   `blockHash` はワールドステートの既存語彙でありChainAdapter境界も
   越えない
3. **UI-B-06のホバーを `dispatchHover` / `dispatchUnhover`（新設）に
   置き換える**（#346の確立済み方針の踏襲）。合成イベントによるホバー
   状態はポインタ位置に依存せず、再描画で落ちない。解除は
   `page.mouse.move(0,0)` の代わりに `mouseout` を直接 dispatch する
   （dispatch化すると実ポインタは一度も要素上に無いため、実マウス移動
   では `mouseout` が発火しない）。UI-B-05は#351の要件（実マウス軌跡での
   維持検証）を担うため**変更しない**

#### 新しいUI-B-06の構造（実装担当への引き継ぎ）

対象パッケージ: `packages/frontend`（1属性+単体テスト）、`packages/e2e`
（ヘルパー+spec+SCENARIOS.md）。作業は1人（frontend担当）で直列に
実施できる規模。依存順序: フロントの属性追加 → e2e書き換え。

1. `packages/frontend/src/entities/WalletCard.tsx` の `TxChip` に
   `data-block-hash={tx.blockHash}` を追加（pending中はundefinedで
   属性ごと出ない。Reactの標準挙動）。単体テストで「pending中は属性
   なし・included後は完全なblockHashが載る」ことを固定する
2. `packages/e2e/src/ui/support/interactions.ts` に `dispatchUnhover`
   （`target.dispatchEvent("mouseout")`）を追加し、docコメントに
   「dispatchHoverで開始したホバーは実ポインタが要素上に無いため、
   実マウス移動では解除できない」理由を書く。Reactの `onMouseLeave` は
   ネイティブ `mouseout`（relatedTarget無し=画面外へ抜けた扱い）から
   合成される想定だが、**実ブラウザで解除が実際に効くことの実測確認を
   実装時に必ず行う**こと。効かない場合のフォールバックは
   `dispatchEvent("mouseout", { relatedTarget: <外部要素のハンドル> })`
3. `chain-ribbon.spec.ts` UI-B-06 を識別ベースに再構成:
   - ステップ1（前提・既存）: 送金 → included チップ待ち。チップの
     `data-block-hash` から対象ブロックのhashを取得する
   - ステップ2（新設・前提）: `chain-ribbon-tile-<blockHash>` が表示窓内に
     見えることを明示的に待つ。タイルはincludedチップより先（blockが
     included更新に先行する。ARCHITECTURE.md §10.4の観測順序）に届いて
     いるため、待つのは描画反映の遅延のみ。タイムアウトは
     `SLOT_DURATION_MS` 由来+固定オーバーヘッドで導出（値は実装判断。
     前提条件コメント必須）
   - ステップ3（逆方向）: `dispatchHover(チップ)` → 対象タイルに
     `chain-ribbon-tile--highlight` が付くこと（識別ベース）+ 強調が
     ちょうど1件であること（二重強調の回帰検出。#351の教訓）→
     `dispatchUnhover(チップ)` → 強調0件
   - ステップ4（正方向）: `dispatchHover(タイル)` → 送信元ウォレット
     カードに `infra-card--ribbon-highlight` が付く
   - ステップ5（既存）: `dispatchUnhover(タイル)` → 強調が消える
   - `.react-flow__controls-fitview` のクリックはホバー経路から撤去する
     （dispatch化で「ビューポート内に収める」必要が消えるため）。ただし
     finally の後始末（削除ボタンの実クリック）は実マウス操作のため、
     後始末の直前に Fit View クリックを移設して到達性を保つ
4. `packages/e2e/SCENARIOS.md` の UI-B-06 を新構造に同期する（前提に
   「対象ブロックのタイルが表示窓内に表示されている」、操作・確認に
   逆方向（チップ→タイル強調）を明文化。文言は実装判断。test.step と
   1対1の規約を維持）

#### この設計で競合が解消する根拠（タイミング前提）

- includedチップ観測時点で対象ブロックは最新タイル（表示窓の右端）。
  窓から流れ出るまで約7スロットの猶予（slot=2秒でも約14秒、12秒なら
  84秒）がある
- 新構造でホバー開始までに挟まる操作は「属性読み取り→タイル可視待ち
  （通常は即時）→dispatch」のみで、実クリックやポインタ移動の
  actionability 待ちを含まず、併走負荷時でも数秒で完了する
- ホバー開始後は既存の凍結（`useFrozenRibbonTiles`）が効くため流出しない。
  ステップ3の解除→ステップ4の再ホバーの間だけ凍結が一瞬外れるが、その
  時点でタイルの経過は高々2〜3スロットで、残り猶予（5スロット以上）に
  対しギャップはミリ秒オーダー
- この前提（表示件数8・blockがtxより先に届く観測順序）はspec上の
  コメントと ARCHITECTURE.md §10.6 に明記する

#### 検証プロトコル（実装担当・QAへ）

- CLAUDE.mdの「直したはずで済ませない」ルールに従い、修正前に
  `chain-ribbon.spec.ts` のファイル単位実行（UI-B-05+UI-B-06併走）を
  複数round実施してflakyを再現し、修正後に同条件で複数round（目安3回）
  連続greenを確認する。UI-B-06単独でも3回greenを確認する
- `dispatchUnhover` による解除（強調が消える・ポップオーバーが閉じる）が
  実ブラウザで機能することを、単発の実行で必ずアサーションで確認する

#### 決めきれなかった点（実装時に判断してよい）

- タイル可視待ちのタイムアウト具体値（`SLOT_DURATION_MS` 由来の導出式）
- SCENARIOS.md の箇条書きの最終文言
- `dispatchUnhover` のイベント初期化詳細（relatedTargetの要否は実測で
  決める）

### 2026-07-18 Issue #388 実装設計メモ

- 担当: frontend
- ブランチ: issue-388-ui-b06-flaky
- 設計メモ（上記designerのメモ）の手順にそのまま従う。実装時の判断点を
  以下のとおり決めた。

1. **`WalletCard.tsx` の `TxChip`**: `data-testid` の隣に
   `data-block-hash={tx.blockHash}` を追加するだけ（`tx.blockHash` は
   `TransactionEntity` の既存の任意フィールド。undefinedのときReactは
   属性そのものを出さない）。単体テストは既存の
   `WalletCard.test.tsx` の「tx chip」系 `describe` に1ケース追加し、
   pending中（blockHash未設定）で属性なし・included後（blockHash設定）
   で完全なhashが載ることの両方を確認する
2. **`dispatchUnhover`**: `interactions.ts` の `dispatchHover` の対に
   `target.dispatchEvent("mouseout")` を追加する。relatedTargetは
   実装時に実測して要否を決める（本文2番目の理由に対応）。単体テストは
   Playwright API呼び出しのラッパーでロジックが無いため対象外
   （CLAUDE.mdの「純粋な見た目調整のみの変更は対象外」に準じ、E2Eヘルパーの
   1行dispatch呼び出しも同様に扱う。振る舞いの実効性はUI-B-06内の
   アサーションで担保する）
3. **UI-B-06 の再構成**: designerの5ステップ構成に従う。タイル可視待ちの
   タイムアウトは `RIBBON_TILE_TIMEOUT_MS`（既存の
   `SLOT_DURATION_MS * 3 + 20_000`）をそのまま流用する。理由: 「included
   チップ観測 → 対象タイルが表示窓内に描画済みになる」までの遅延は
   通常ミリ秒オーダー（blockはtxのincluded更新より先に届く。§10.4）だが、
   上限としては「タイルが1件も無い状態からの初回描画」と同じ最悪ケース
   （新規追加の反映が1 slot分遅れる可能性）を想定しておけば十分であり、
   新しい定数を導入せず既存の考え方を再利用する
4. **SCENARIOS.md**: 前提に「対象ブロックのタイルが表示窓内に表示されて
   いる」を追記し、確認欄に逆方向（チップ→タイル強調、ちょうど1件）を
   明文化する。文言は既存の項目（UI-B-05等）の文体に合わせる
