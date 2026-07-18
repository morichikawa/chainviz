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

#### テスト強化メモ(着手前)

- 担当: tester
- 既存の `GlossaryTerm.panelIntegration.test.tsx` にSpace/Enterの
  `defaultPrevented` 回帰テストが2件あり、ハッピーパスは押さえられている。
  以下の抜けを補うテストを同ファイルに追加する(いずれもキーボード連携の
  関心に収まるため新規ファイルは作らない)。
  1. 無関係キー(Tab・矢印キー)では `preventDefault` が呼ばれない
     こと(`fireEvent.keyDown` の戻り値が `true` = キャンセルされない)を
     確認する。既存の「ignores unrelated keys」はパネルが開かないことのみ
     確認しており、preventDefault の副作用がSpace/Enterに限定されている
     ことは固定していない。矢印キーはページスクロールの原因になり得る
     代表として追加する。
  2. クリック経路では `preventDefault` が漏れていないこと
     (`fireEvent.click` の戻り値が `true`)を確認する。preventDefault は
     `onKeyDown` インラインハンドラ側にのみ追加され `openPanel` 本体には
     入れていない、という実装意図(クリックのデフォルト動作は抑止不要)を
     回帰テストとして固定する。
  3. パネルが既に開いた状態で再度Spaceを押しても引き続き
     `preventDefault` が呼ばれる(トグルや条件分岐でスキップされない)
     ことを確認する。本コンポーネントにトグル動作は無く常に同じ用語で
     開き直すが、押下ごとにスクロール抑止が効くことを固定する。
