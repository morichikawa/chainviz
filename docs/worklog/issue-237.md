### 2026-07-11 Issue #237 operationPending の operate ボタンで aria-busy
属性がブロック到達タイミング次第で欠落する(設計メモ)

- 担当: frontend
- ブランチ: issue-237-aria-busy-operate-button

#### 原因確認

Issue本文の指摘どおり、原因は `App.tsx` の `infraNodesWithHighlight`
（`useMemo`）にある。

- `entitiesToFlowNodes`（`entities/infraNode.ts`）は `operationPending` を
  一切設定しないため常に `undefined`。
- `infraNodesWithHighlight` は `operationPending === (node.data.operationPending
  ?? false)`（値に変化が無い）のとき、`operationPending` フィールドを
  明示的に merge せず元の `node` オブジェクトをそのまま返す。そのワーク
  ベンチが一度も保留中(true)を経験していない間は常にこの条件が真になり、
  `operationPending` は `undefined` のまま=`InfraNodeCard.tsx` の
  `aria-busy={operationPending}` が `undefined` を受け取り、React が
  `aria-*` 属性を DOM から省略する。
- さらに `isSameInfraNode`（`stabilizeNodes` の判定関数）は `maxElBlockHeight`
  を比較対象に含むため、稼働中チェーンでブロック高が進むたびに新しい
  `InfraFlowNode` オブジェクトへ差し替わる。この新オブジェクトは
  `entitiesToFlowNodes` 由来で `operationPending: undefined` に戻っている
  ため、一度 `aria-busy="true"→"false"` の明示的な遷移を経た後でも、次の
  ブロック到達で再び `undefined`（属性欠落）に戻ってしまう。

#### 採用する修正方針

Issue本文が提案する2案のうち、`App.tsx` 側のメモ化最適化(Issue #119対策)
の意図を壊さない後者を採用する。

- `InfraNodeCard.tsx` の該当箇所を `aria-busy={operationPending}` から
  `aria-busy={operationPending ?? false}` に変更する。
- これにより、上流(`App.tsx`)の `data.operationPending` が `undefined` の
  ままであっても、DOM には常に明示的な `aria-busy="false"` が出力される。
  `App.tsx` 側のメモ化ロジック(頻繁なノード差し替え含む)には一切手を
  入れない。

`removalPending`（Issue #222 由来、削除ボタンの `aria-busy`）にも全く同じ
パターンのコードがあり理論上同じ欠落が起こり得るが、今回のIssueの対象は
operate ボタン(`operationPending`)のみのため、このIssueでは触れない。
別途フォローアップを検討する余地がある旨のみここに記録しておく。

#### テスト方針

タイミング依存の再現テストとして、`data.operationPending` を明示的に
`undefined` として渡した場合に `aria-busy` 属性自体が存在すること
（`"false"` という文字列値を持つこと）を確認するテストを追加する
（`toHaveAttribute("aria-busy", "false")` で厳密に一致させる。既存の
E2E側の回避策 `not.toHaveAttribute("aria-busy", "true")` とは逆に、今回は
「属性が存在し値がfalseである」ことそのものを検証する）。修正前はこの
アサーションが失敗する（属性が存在しない）ことを確認してから修正する。

#### 実施内容(完了)

- `packages/frontend/src/entities/InfraNodeCardOperationButton.test.tsx` に
  再現テストを2件追加した。
  - `data.operationPending` を明示的に `undefined` として渡し、
    `aria-busy` 属性が DOM 上に文字列値 `"false"` として存在することを
    確認するテスト（Issue #237 の再現ケース）。
  - `data.operationPending` が `true` のとき `aria-busy="true"` になる
    ことを確認するテスト（既存の挙動が壊れていないことの確認）。
  - なお `@testing-library/jest-dom` はこのプロジェクトに導入されておらず
    `toHaveAttribute` は使えないため、既存テストの慣習
    （`InfraNodeCard.test.tsx` 等）に合わせて `getAttribute(...)` の
    生値比較で書いた。
  - 修正前にこの2件のうち1件目を実行し、`getAttribute("aria-busy")` が
    `null`（属性欠落）を返すことを確認した上で修正に着手した
    （再現の確認）。
- `packages/frontend/src/entities/InfraNodeCard.tsx` の operate ボタンの
  `aria-busy={operationPending}` を `aria-busy={operationPending ?? false}`
  に修正した（設計メモどおり、`App.tsx` 側のメモ化ロジックには手を
  入れていない）。
- 修正後、上記2件を含む `InfraNodeCardOperationButton.test.tsx`
  （11件）・`InfraNodeCard.test.tsx`（46件）が全て通ることを確認した。
- `pnpm --filter @chainviz/frontend build` / `pnpm --filter @chainviz/frontend
  test`（112ファイル・1734件）が全て通ることを確認した。
  `pnpm exec eslint packages/frontend/src/entities/InfraNodeCard.tsx
  packages/frontend/src/entities/InfraNodeCardOperationButton.test.tsx`
  でも lint エラーが無いことを確認した。

#### 次の担当への注意点

- Issue本文の指摘どおり、削除ボタン（Issue #222 由来）の
  `aria-busy={removalPending}`（`InfraNodeCard.tsx`）にも全く同じコード
  パターンがあり、理論上同じ「値がブロック到達タイミング次第で欠落する」
  問題が起こり得る。今回のIssue #237の対象は operate ボタン
  （`operationPending`）のみのため意図的に手を付けていない。気づいた
  ものとして記録しておくので、必要であれば別途Issue化を検討する。

### 2026-07-11 Issue #237 テスト強化(異常系・境界値)

- 担当: tester
- ブランチ: issue-237-aria-busy-operate-button

#### 追加したテスト（`InfraNodeCardOperationButton.test.tsx`）

実装担当が追加した2件（undefined 渡しで `aria-busy="false"`、true で
`aria-busy="true"`）を土台に、以下の観点を追加した。

- 境界値: `data.operationPending` が明示的な `false` の場合も
  `aria-busy="false"` になること（`?? false` フォールバックが明示 false を
  誤って書き換え・欠落させないことの確認）。
- タイミング依存の遷移（Issue #237 の核心の再現）: 同一 `InfraNodeCard` を
  `rerender` で更新し、`operationPending` を undefined → true → undefined と
  遷移させ、各段で `aria-busy` 属性が常に DOM 上に存在し（null にならず）
  値だけが `"false"` → `"true"` → `"false"` と正しく切り替わることを確認。
  これは App.tsx の `infraNodesWithHighlight` が、対象ワークベンチが保留を
  経験するまで undefined を渡し、true 化後もブロック到達で `isSameInfraNode`
  判定によりノードオブジェクトが作り直されて再び undefined に戻る、という
  上流の再レンダー列を直接シミュレートしたもの。
- 上記2件のうち遷移テストが、修正前のコード
  （`aria-busy={operationPending}`）に対して実際に失敗すること（1回目と
  3回目で属性が欠落）を、修正を一時的に戻して確認済み。明示 false の
  テストは修正前でも通る（undefined のみが欠落を起こしたため）ことも
  合わせて確認した。

テストヘルパの `renderCard` に `rerenderWith`（extraData だけ差し替えて
再レンダーする薄いラッパ）を追加した。既存の全テストは非破壊で通る。

#### 同コンポーネント内の他 aria 属性の点検（観点3）

`InfraNodeCard.tsx` の aria 属性を全て確認した。`aria-hidden="true"`
（ステータスドット・スピナー）は静的な文字列リテラル、削除ボタンの
`aria-label` / `title` は常に `t(...)` の文字列で、いずれも undefined 欠落の
リスクは無い。動的な真偽値をそのまま渡している aria 属性は operate ボタンの
`aria-busy`（修正済み）と、削除ボタンの `aria-busy={removalPending}` の2箇所
のみ。後者が下記 Issue #263 の対象。

#### Issue #263（削除ボタン removalPending）の事実確認

削除ボタンの `aria-busy={removalPending}`（`InfraNodeCard.tsx`、`?? false` の
フォールバック無し）に、operate ボタンと同一の欠落バグが実在することを
実測で確認した。使い捨てテストで `data.removalPending` を `undefined` として
`InfraNodeCard` をレンダーし、削除ボタンの `getAttribute("aria-busy")` が
`null`（属性欠落）を返すことを確認（同条件で operate ボタンは修正済みのため
`"false"` を返す）。

App.tsx 側の経路も operate と同型で、`infraNodesWithHighlight` は
`removalPending` も `operationPending` と同じ merge 条件で扱い（一度も保留を
経験しない間・`isSameInfraNode` によるオブジェクト差し替え後は undefined の
まま渡す）、`entitiesToFlowNodes` は `removalPending` を設定しないため常に
undefined 起点になる。したがって「削除ボタンでも aria-busy がブロック到達
タイミング次第で欠落する」という Issue #263 の申し送りは事実。

本 Issue #237 のスコープ外のため修正はしていない（使い捨てテストも削除済み）。
Issue #263 側で `aria-busy={removalPending ?? false}` への修正と回帰テスト
追加を行うのが妥当。

### 2026-07-11 Issue #237 レビュー(静的確認)

- 担当: reviewer
- ブランチ: issue-237-aria-busy-operate-button
- 内容: 修正・テスト強化の静的レビューを実施し、合格と判定した。
  - 修正の妥当性: `InfraNodeCard.tsx` の operate ボタンを
    `aria-busy={operationPending ?? false}` とする最小修正で、App.tsx 側の
    メモ化最適化(Issue #119 対策)に手を入れない方針は妥当。修正箇所の
    コメントに上流の undefined 渡しの背景が明記されており、意図が追える。
  - 他箇所の網羅確認: リポジトリ内の `aria-busy` 使用箇所を全て確認した。
    - `CanvasToolbar.tsx`(pendingAddNode / pendingAddWorkbench): props の
      分割代入でデフォルト値 `= false` が与えられ、かつ App.tsx から渡る値も
      `ghosts.some(...)` の boolean のため undefined になり得ない。問題なし。
    - `InfraNodeCard.tsx` の削除ボタン `aria-busy={removalPending}`: 同種の
      欠落バグが実在(テスト強化担当が実測確認済み)。Issue #263 として
      別途起票済み・本ブランチのスコープ外という扱いは適切。
    - その他の aria 属性(aria-hidden / aria-label)は静的リテラルまたは
      常に文字列を返す `t(...)` であり、欠落リスクなし。
  - テストの実効性: 修正を一時的に戻した状態で
    `InfraNodeCardOperationButton.test.tsx` を実行し、undefined 渡しテストと
    undefined → true → undefined 遷移テストの2件が実際に失敗すること
    (属性欠落を検出できること)を確認したうえで復元した。境界値
    (明示的な false)・既存挙動(true)のケースも揃っており、実装の詳細を
    なぞるだけの無意味なテストにはなっていない。
  - ビルド・lint・テスト: リポジトリ全体で `pnpm build` / `pnpm lint` /
    `pnpm test`(frontend 112ファイル・1736件含む)が全て通ることを確認した。
  - コミット粒度: fix / test / docs が分かれており Conventional Commits に
    準拠。問題なし。
  - docs: `docs/PLAN.md` のチェック・Issue リンク、`docs/WORKLOG.md` の
    索引行、本ファイルの設計メモ・実施記録・Issue #263 への申し送りが
    実装と一致していることを確認した。
- 決定事項・注意点(軽微・非ブロッキングの申し送り1件):
  - `packages/e2e/src/ui/form-validation.spec.ts`(UI-ERR-03)のコメントが
    「operationPending を一度も切り替えていないワークベンチには aria-busy
    属性自体を付けない実装になっており…属性欠落も起こりうる」と修正前の
    挙動を説明したままになっている。本修正後は属性が常に `"false"` で
    存在するため、このコメントは陳腐化しており、アサーションも
    `toHaveAttribute("aria-busy", "false")` に厳密化できる。同じ箇所を
    触ることになる Issue #263 の対応時にコメント更新・厳密化を合わせて
    行うのが効率的(本ブランチの合否には影響しない)。
