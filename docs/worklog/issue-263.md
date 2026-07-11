### 2026-07-11 Issue #263 削除ボタンのaria-busy(removalPending)欠落バグ(設計メモ)

- 担当: frontend
- ブランチ: issue-263-removal-aria-busy

#### 背景・事実確認

Issue #237（operateボタンの `aria-busy={operationPending}` がタイミング次第で
欠落する不具合）の対応中に見つかった申し送り。`docs/worklog/issue-237.md`の
テスト強化担当・レビュー担当の記録によると、削除ボタン（Issue #222由来）の
`aria-busy={removalPending}`にも全く同じコードパターンがあり、使い捨て
テストで`data.removalPending`を`undefined`としてレンダーした場合に
`getAttribute("aria-busy")`が`null`（属性欠落）を返すことを実測確認済み。

原因はoperateボタンと同型。`App.tsx`の`infraNodesWithHighlight`
（`useMemo`）は、対象ノード/ワークベンチが一度も削除保留(true)を経験して
いない間、また`isSameInfraNode`の判定でブロック高進行等によりノード
オブジェクトが差し替わった直後は、`removalPending`フィールドを明示的に
mergeせず`undefined`のまま渡す。`entitiesToFlowNodes`
（`entities/infraNode.ts`）も`removalPending`を設定しないため常に
undefined起点になる。Reactは`aria-*`属性にundefined/nullを渡すと属性
自体をDOMから省略するため、`InfraNodeCard.tsx`の削除ボタンの
`aria-busy={removalPending}`がタイミング次第で属性欠落を起こす。

#### 採用する修正方針

Issue #237と全く同じ方針を採用する。

- `InfraNodeCard.tsx`の削除ボタンを`aria-busy={removalPending}`から
  `aria-busy={removalPending ?? false}`に変更する。
- `App.tsx`側のメモ化最適化（Issue #119対策）には一切手を入れない
  （operateボタンの修正時と同じ判断。上流のロジックではなく、値を
  受け取る側で明示的なデフォルト値を与える）。

#### テスト方針

`InfraNodeCard.test.tsx`の「removal-pending feedback (Issue #222)」
describeブロックに、Issue #237のoperateボタン向けテスト
（`InfraNodeCardOperationButton.test.tsx`）と同種の回帰テストを追加する。

- `data.removalPending`が明示的に`undefined`の場合、削除ボタンの
  `aria-busy`属性がDOM上に文字列値`"false"`として存在すること
  （修正前はこのアサーションが失敗し`null`を返すことを先に確認してから
  修正に着手する）。
- `data.removalPending`が`true`のとき`aria-busy="true"`になること
  （既存挙動の確認）。
- `data.removalPending`が明示的に`false`の場合も`aria-busy="false"`に
  なること（`?? false`フォールバックが明示falseを書き換えないことの
  境界値確認）。
- undefined → true → undefinedという上流の再レンダー列をシミュレートし、
  属性が常に存在し値だけが正しく切り替わることを確認するタイミング依存の
  遷移テスト（Issue #237の核心の再現と同型）。

既存の`renderCard`ヘルパーは`CommandActions`をそのまま返す設計で、直接
`rerender`を公開していない。遷移テストのために戻り値へ`rerenderWith`を
追加する（既存の戻り値はスプレッドで維持するため、`actions.removeNode`
等の既存の呼び出し側は無変更で動く非破壊な拡張）。

あわせて、Issue #237のレビュー担当が申し送りしていた
`packages/e2e/src/ui/form-validation.spec.ts`（UI-ERR-03、63〜75行）の
コメントも、修正後の実態（`aria-busy`属性は常に存在し値が`"false"`/`"true"`
のいずれかになる。属性欠落は起こらない）に合わせて更新する。

#### 実施内容（完了）

- `InfraNodeCard.tsx`の削除ボタンの`aria-busy={removalPending}`を
  `aria-busy={removalPending ?? false}`に変更し、operateボタンと同様の
  説明コメントを追加した。
- 修正前に`InfraNodeCard.test.tsx`へ回帰テスト（undefined渡しで
  `aria-busy="false"`になることを確認するテスト）を追加し、実際に
  `getAttribute("aria-busy")`が`null`を返して失敗することを確認した
  （再現の確認）。修正後は同テストが通ることを確認した。
- `renderCard`ヘルパーの戻り値を`{ ...full, rerenderWith }`に拡張し、
  undefined → true → undefinedの遷移を再現するタイミング依存テストを
  追加した。既存の呼び出し側（`actions.removeNode`等）はそのまま動作する
  ことを確認した。
- `packages/e2e/src/ui/form-validation.spec.ts`（UI-ERR-03）のコメントと
  アサーションを更新した。修正前の「属性欠落も起こりうる」という説明を
  削除し、`not.toHaveAttribute("aria-busy", "true")`のままにするか
  `toHaveAttribute("aria-busy", "false")`に厳密化するかは実装時に判断する
  （既存のIssue #237側コメントで「厳密化できる」との申し送りがあるため、
  同一パターンのoperateボタン側と挙動を揃える意味で厳密化する）。
- `pnpm --filter @chainviz/frontend build` / `pnpm --filter @chainviz/frontend
  test`が全て通ることを確認した。
