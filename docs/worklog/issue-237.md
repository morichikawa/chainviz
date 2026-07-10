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
