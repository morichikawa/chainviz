# Issue #391 サイドパネルのリサイズハンドルが右ボタンドラッグに反応しテキスト選択も抑止されない

### 2026-07-18 Issue #391 起票の経緯

- 担当: 統括
- ブランチ: issue-362-sidepanel-resize(#362のマージ前に併せて起票)
- 内容: Issue #362の最終QA検証(docs/worklog/issue-362.mdの最終QA検証節)で
  chainviz-qaが実ブラウザ操作で確認した軽微なUX上の粗さをIssue化し、
  `docs/PLAN.md`のバックログ節末尾に追記した。
- 事実関係: `handlePointerDown`が`event.button`をチェックしていないため、
  リサイズハンドル上で右ボタンを押しながらドラッグすると幅が変化して
  しまう。また、リサイズ中(`resizing`状態)は`user-select`抑止が無いため、
  通常の左ボタンドラッグでも周囲の本文テキストが選択されてしまう。
  機能自体は正常に動作するため、Issue #362の完了条件は損なわず差し戻し
  対象外と判断し、別Issueとして分離した。

### 2026-07-18 実装設計メモ

- 担当: chainviz-frontend
- 対応範囲は2点。
  1. `useSidePanelResize.ts`の`handlePointerDown`で`event.button !== 0`の
     ときは早期returnし、`dragRef`のセット・`setResizing(true)`のいずれも
     行わないようにする。左ボタン(button === 0)のみドラッグを開始する。
     `ReactPointerEvent`の型上は`button`がoptionalではないため、テスト側の
     モックイベント生成ヘルパー(`pointerDownEvent`)にも`button`を追加する
     必要がある。
  2. `resizing`状態中のテキスト選択抑止は、既存の
     `side-panel__resize-handle--active`と同じパターンで、`SidePanel.tsx`の
     ルート要素(`.side-panel`)に`resizing`のときだけ`side-panel--resizing`
     修飾クラスを足す。`styles.css`側で
     `.side-panel--resizing, .side-panel--resizing * { user-select: none; }`
     を追加し、パネル配下(ヘッダー・タイトル・本文)のテキスト選択をドラッグ中
     だけ止める。ハンドル自体はパネルの左端をわずかにはみ出す(`left: -4px`)
     配置だが、ドラッグ中は幅の再計算でハンドルがポインタ位置に追従するため、
     パネル外(キャンバス側)まで選択される実害は無いと判断し、`document.body`
     全体ではなく`.side-panel`配下に絞ったCSSスコープとした。
- 再現確認の手順: 修正前のコードで`useSidePanelResize.test.ts`に
  「右ボタンpointerdownではresizingにならない」テストを追加してから
  `pnpm --filter @chainviz/frontend test`を実行し、実際に落ちることを
  確認する。その後ガード節を実装し、同テストが通ることを確認する
  (CLAUDE.mdの「直したはずで済ませない」運用ルールに従う)。
