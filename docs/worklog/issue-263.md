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

#### テスト強化（tester）

実装担当が追加した基本テスト（`InfraNodeCard.test.tsx`の削除ボタン
aria-busyの`undefined`/`true`/`false`各値と`undefined → true → undefined`
遷移）を土台に、以下の観点で追加・確認した。

- 削除ボタン（Issue #263）と操作ボタン（Issue #237）が同一のワークベンチ
  カード上に同時に存在する状態で、2つの`aria-busy`が相互に干渉しないこと
  を横断的に検証する新規テストファイル
  `packages/frontend/src/entities/InfraNodeCardPendingAria.test.tsx`を追加
  した。個別ボタンのaria-busy挙動は既存の2ファイル（`InfraNodeCard.test.tsx`
  ・`InfraNodeCardOperationButton.test.tsx`）がカバー済みのため、新ファイルは
  「同一カード上での独立性」という関心事だけに絞った（1ファイル1責務）。
  網羅した組み合わせ:
  - 両方未指定（undefined/undefined）→ 両方 false
  - removalPending=true / operationPending=undefined → 削除のみ true、操作は false
  - removalPending=undefined / operationPending=true → 削除は false、操作のみ true
  - 両方 true → 両方 true（排他ではなく独立）
  - 両方 明示 false → 両方 false（`?? false`が明示falseを書き換えない）
  - 明示 false / true の混在 → それぞれ独立に反映
  - 片方だけが undefined ⇄ true と揺れる再レンダー列で、もう片方の
    aria-busy が巻き添えで欠落・変化しないこと（上流のオブジェクト差し替えを
    模した遷移テスト）
- 追加した独立性テストが実際に元の欠落バグを検出できることを、
  `InfraNodeCard.tsx`の削除ボタンを`aria-busy={removalPending ?? false}`から
  `aria-busy={removalPending}`へ一時的に戻した状態で確認した（新ファイルの
  8件中3件が失敗）。確認後に修正を元へ戻した。
- 要件3（他のaria属性に同種の欠落パターンが残っていないか）の最終再走査を
  行った。`InfraNodeCard.tsx`内の動的なaria属性は2つの`aria-busy`のみで、
  いずれも今回・Issue #237で`?? false`済み。`aria-label`（削除ボタン）は
  三項演算子で常に`t()`の文字列に解決されるため欠落しない。`aria-hidden`
  （同期ドット・各スピナー）はすべて静的な文字列リテラルであり、undefined/null
  になり得ない。したがって同種の属性欠落パターンは他に存在しない。
- `pnpm --filter @chainviz/frontend test`（118ファイル・1829件）と
  `pnpm --filter @chainviz/frontend build`がいずれも通ることを確認した。
- レビュー指摘対応: 新規テストファイルの未使用import
  （`import type { CommandActions }`）を削除し、`pnpm lint`（eslint）が
  通ることを確認した。

#### レビュー（reviewer）

差し戻し。指摘は1件のみで、それ以外の観点は全て問題なし。

- **[要修正] `pnpm lint` が失敗する**。テスト強化で追加された
  `packages/frontend/src/entities/InfraNodeCardPendingAria.test.tsx` の
  6行目 `import type { CommandActions } from "../commands/useCommands.js";`
  が未使用（`@typescript-eslint/no-unused-vars`）。このファイルでは
  `CommandActionsProvider` の `actions` をインラインで渡しており型注釈に
  使っていないため、import を削除すればよい。`.githooks/pre-push` は
  `pnpm lint && pnpm build && pnpm test` を実行するため、このままでは
  push 自体が失敗する。

以下は確認済みで問題なし。

- `pnpm build`（全パッケージ）と `pnpm test`（frontend 118ファイル・
  1829件を含む）は通る。失敗は lint のみ。
- 修正は Issue #237 の operate ボタン（`aria-busy={operationPending ?? false}`）
  と完全に同型で、上流（App.tsx のメモ化）に手を入れない判断・説明コメント
  の書き方も一貫している。undefined フォールバックの理由コメントが
  コード上に明記されており、「なぜ ?? false か」が後から読んで分かる。
- `InfraNodeCard.test.tsx` の追加テストは undefined / true / 明示 false の
  境界値と undefined → true → undefined の遷移（元バグの核心）をカバー。
  worklog に「修正前にテストが実際に失敗する（null を返す）ことを確認した」
  記録があり、意味のあるテストであることが担保されている。
- `InfraNodeCardPendingAria.test.tsx`（独立性テスト8件）は「同一カード上の
  2つの aria-busy が干渉しないか」という関心事に絞られており、1ファイル
  1責務の原則に沿う。両方 true（排他でないこと）、明示 false 混在、片方
  だけが揺れる再レンダー列など組み合わせが妥当。壊した状態で 8件中3件が
  失敗することの確認記録もある。
- UI-ERR-03 のアサーション厳密化（`not.toHaveAttribute("aria-busy", "true")`
  → `toHaveAttribute("aria-busy", "false")`）は、「フォーム不正時に送信を
  試みても操作が保留状態にならない」という元の検証意図を保ったまま、
  #237 修正後は属性欠落が起こらなくなった実態に合わせて強くしたもので、
  意図を損なっていない。コメントの更新内容も実装と一致する。
- コミット粒度は fix / e2e アサーション厳密化 / 独立性テスト追加 / docs
  で分かれており、Conventional Commits 準拠。
- `docs/PLAN.md` のチェックボックス・Issue リンク、`docs/WORKLOG.md` の
  索引1行、worklog 本文とも実装内容と齟齬なし。

#### 再レビュー（reviewer）

合格。前回の差し戻し指摘（1件）への対応を確認した。

- コミット `f0bd1fe` の差分は、指摘どおり
  `InfraNodeCardPendingAria.test.tsx` の未使用 import
  （`import type { CommandActions }`）の削除1行と、worklog への対応記録の
  追記のみ。指摘範囲を過不足なく反映しており、他のコードへの変更はない。
- リポジトリ全体で `pnpm lint` が通ることを確認した（前回の失敗はこの
  1件のみだったため解消）。
- 削除対象ファイルのテスト
  （`pnpm --filter @chainviz/frontend exec vitest run
  src/entities/InfraNodeCardPendingAria.test.tsx`）が8件すべて通ることも
  確認した。
- その他の観点（build/test・修正内容・テストの質・コミット粒度・docs
  整合）は前回レビューで確認済みのため再確認は差分のみとした。

#### QA検証記録（qa）

合格。実機（jsdom 上で実際に `InfraNodeCard` をレンダーし、削除ボタンの
DOM 属性を観測）で以下を確認した。

- 使い捨ての検証テストで、上流が `removalPending` を明示 merge していない
  状態（`data.removalPending` = undefined）でワークベンチカードをレンダー
  した際、削除ボタンの実 DOM が
  `<button ... aria-busy="false" data-testid="infra-card-remove-workbench-1">×</button>`
  となり、`getAttribute("aria-busy")` が属性欠落（null）ではなく文字列
  `"false"` を返すことを確認した（完了条件2の undefined 起点ケース）。
- 同じ削除ボタンを実際に `fireEvent.click` したところ
  `removeWorkbench("workbench-1")` が1回呼ばれ、通常の削除操作フローが
  従来通り動作することを確認した（回帰確認・完了条件3）。
- コマンド結果待ちの削除保留状態（`removalPending` = true）へ再レンダー
  すると、ボタンが `aria-busy="true"`・`disabled`・スピナー表示になる
  ことを DOM 上で確認した（完了条件1）。
- そこから上流がオブジェクトを差し替えて再び undefined を渡す遷移
  （削除完了/カード残存中）でも、`aria-busy` は属性欠落せず明示値
  `"false"` に戻ることを確認した（完了条件2のタイミング依存ケース）。
- 修正が実際に効いていることの独立確認として、`InfraNodeCard.tsx` の
  削除ボタンを一時的に `aria-busy={removalPending}` へ戻すと、同じ検証で
  undefined 起点の `getAttribute("aria-busy")` が null（属性欠落）となり
  元の不具合が再現することを確認し、その後 `?? false` へ復元した。
- 既存テスト（`InfraNodeCard.test.tsx` 50件・`InfraNodeCardPendingAria.test.tsx`
  8件）がいずれも通ることを確認した。検証用の使い捨てファイルは確認後に
  削除し、作業ツリーはクリーンな状態に戻した。

元 Issue（削除ボタンの aria-busy 属性がタイミング次第で欠落する）は
解消されており、完了条件を満たしている。
