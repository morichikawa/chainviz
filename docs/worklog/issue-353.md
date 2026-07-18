### 2026-07-18 Issue #353 GlossaryTermのキーボード操作(Space)でpreventDefaultが呼ばれずページスクロールし得る

- 担当: frontend
- ブランチ: issue-353-glossary-term-prevent-default

#### 実装設計メモ(着手前)

- 対象は `packages/frontend/src/glossary/GlossaryTerm.tsx` の1ファイルのみ。
- `role="button"` を持つ `<span>`(ネイティブ `<button>` ではない)は、Space
  キー押下時にブラウザがページスクロールする既定動作を自動的には抑止しない。
  ネイティブ `<button>` ならブラウザが自動で `preventDefault` 相当の動作を
  行うが、このコンポーネントはカスタム要素のため明示的な呼び出しが必要。
- 現状の `onKeyDown` は `event.key === "Enter" || event.key === " "` の
  条件で `openPanel(event)` を呼ぶのみで、`openPanel` 内では
  `event.stopPropagation()` は呼ぶが `event.preventDefault()` は呼んで
  いない。
- 修正方針: `onKeyDown` ハンドラ内で `openPanel` を呼ぶ前に
  `event.preventDefault()` を追加する。`openPanel` はクリックイベントでも
  共用されている関数のため、`openPanel` 自体に `preventDefault` を入れると
  クリックイベント(`MouseEvent`)に対しても呼ぶことになり意味が薄い
  (クリックのデフォルト動作を抑止する必要はない)。そのため `openPanel`
  本体ではなく `onKeyDown` のインラインハンドラ側に限定して追加する。
- 既存の挙動(パネルが開く・`stopPropagation` によるカード等への伝播防止)は
  変更しない。
- 回帰テスト: Space/Enter 押下時に `defaultPrevented` が `true` になる
  ことを確認するテストを追加する。既存の `GlossaryTerm.panelIntegration.test.tsx`
  に「クリック/Enter/Space の連携」の関心が既にあるため、そこに追記する
  (新規ファイルを作るほどの分量ではなく、既存の関心事の一部として扱う)。
  修正前のコードで実際に `defaultPrevented` が `false` のまま(問題が再現
  すること)を確認してから修正し、修正後に `true` になることを確認する。
