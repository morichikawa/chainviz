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

### 2026-07-18 実装完了

- 担当: chainviz-frontend
- 実施内容:
  1. `useSidePanelResize.ts`の`handlePointerDown`冒頭に
     `if (event.button !== 0) return;`を追加。左ボタン以外での
     ドラッグ開始を防いだ。回帰テストとして
     `useSidePanelResize.test.ts`に「右ボタンpointerdownでは
     resizingにならず幅も変化しない」ケースを追加(`pointerDownEvent`
     ヘルパーに`button`引数を追加)。
  2. `resizing`中は`SidePanel.tsx`のルート要素に`side-panel--resizing`
     修飾クラスを追加し、`styles.css`に
     `.side-panel--resizing, .side-panel--resizing * { user-select: none; }`
     を追加。`SidePanel.resize.test.tsx`に、ドラッグ中はクラスが付与され
     pointerup後に外れることを確認するケースと、右ボタン
     pointerdownではクラスも幅変化も起きないことを確認する統合レベルの
     ケースを追加。
- 再現確認: いずれの修正も、テスト追加後・修正前の状態で実際に
  `pnpm vitest run`が失敗することを確認してから実装し、実装後に
  グリーンになることを確認した(修正前後の両方を自分の手で確認する
  CLAUDE.mdの運用ルールに従った)。
- 確認結果: `pnpm lint`・`pnpm build`・`pnpm test`をリポジトリ全体
  (shared/collector/frontend/e2e)に対して実行し、いずれも成功
  (frontend 210 test files / 2733 tests 全通過)。
- コミットは、設計メモ(docs)・ボタンガード修正+テスト(fix)・
  テキスト選択抑止修正+テスト(fix)の3つに分けた。
- 次の担当への申し送り: `docs/PLAN.md`のIssue #391チェックボックス
  更新は統括の依頼によりまだ行っていない。レビュー・QAを経てPRが
  マージされる運用に従うこと。

### 2026-07-18 テスト強化メモ

- 担当: chainviz-tester
- 基本実装・基本テスト(右ボタンガード・resizing中のno-selectクラス)は
  完了済み。異常系・境界値の観点で以下を追加する。
  1. 中ボタン(button===1)およびその他の非プライマリボタン(3,4)でも
     ドラッグが開始しないことを確認する。ガードは`event.button !== 0`
     なので0以外は全て弾かれるはずだが、右ボタン(2)のみの回帰テスト
     しか無いため、代表値をパラメタライズして固定する。
  2. 左ボタンでドラッグ開始後(resizing中)に非プライマリボタンの
     pointerdownが割り込んでも、ドラッグの開始アンカーが再設定されない
     ことを確認する(既存の「左ボタン再pointerdownでアンカー再設定」テストと
     対になる回帰。右クリックが割り込んでも幅計算が乱れない)。
  3. キーボード操作(←→)によるリサイズでは`side-panel--resizing`クラスが
     付与されないこと(意図通りポインタドラッグ限定であること)を確認する。
- CSSの`user-select: none`が`.side-panel--resizing *`でパネル内の
  input等に及ぶ懸念(観点4)については、jsdomがCSSカスケードを評価しない
  ため計算スタイルでの直接検証は不可。代わりに「クラスはドラッグ中のみの
  過渡状態でpointerup後に除去される」ことを既存テストで担保している事実を
  もって、恒常的な悪影響は無いと整理する(下記の完了記録に懸念として明記)。

### 2026-07-18 静的レビュー結果（合格）

- 担当: chainviz-reviewer
- 判定: **合格**。差し戻し事項なし。
- 確認内容:
  1. **`event.button !== 0` ガードの仕様適合**: PointerEvent の `button` は
     MouseEvent 由来で 0=主ボタン(左)、1=中、2=右、3=戻る、4=進む。
     pointerdown 時に主ボタンなら 0 になるのは仕様どおりで、ガードは正しい。
     タッチ・ペンの接触も `button` は 0 になるため、タッチ操作での
     リサイズを妨げない点も問題なし。
  2. **`.side-panel--resizing *` の影響範囲**: `user-select: none` は
     テキスト選択のみを止め、input へのフォーカスや入力自体は妨げない。
     クラスは `resizing` 中だけの過渡状態で pointerup 時に外れることが
     テストで担保されており、恒常的な悪影響は無い。testerの「実害なし」
     判断を支持する。
  3. **testerの申し送り（`handlePointerUp` のボタン非判別）**: 差し戻し
     不要の判断は妥当。むしろ Pointer Events 仕様では、既にボタンが
     押下中のポインタに別ボタンの押下/解放が加わった場合（chorded
     buttons）、発火するのは pointerdown/pointerup ではなく pointermove
     （`button` に変化したボタンが載る）。pointerup は最後のボタンが
     離れたときのみ発火するため、「左ドラッグ中に右ボタンの pointerup で
     終了する」状況は実ブラウザの実マウス操作では発生せず、jsdom の
     合成イベントでのみ観察される。現在の実装（pointerup で無条件終了）は
     「全ボタンが離れたらドラッグ終了」という正しい挙動と一致する。
  4. **コミット粒度・形式**: `git log main..HEAD` の7コミットはいずれも
     単一関心（設計メモ / ガード修正+テスト / 選択抑止修正+テスト /
     実装記録 / テスト強化メモ / エッジケーステスト / 統合テスト）で、
     Conventional Commits 形式に適合。修正とその回帰テストが同一
     コミットに含まれる構成も開発ルールどおり。
  5. **ビルド・lint・テスト**: `pnpm lint` / `pnpm build` / `pnpm test` を
     リポジトリ全体で実行し全通過（frontend 210 ファイル / 2739 テスト）。
  6. **テストの質**: 右ボタンだけでなく中(1)・戻る(3)・進む(4)の
     パラメタライズ、ドラッグ中の非プライマリ割り込みでアンカーが
     再設定されないこと（アンカー座標の差で検証しており、壊れたコードでは
     通らない）、キーボードリサイズでは抑止クラスが付かないことまで
     カバーされており、実装の詳細をなぞるだけの無意味なテストは無い。
     修正前に赤・修正後に緑を確認した記録もある。
- 非ブロッキングの指摘（マージ判断には影響しない）:
  - テスト強化メモに「下記の完了記録に懸念として明記」とあるが、tester の
    完了記録の節が worklog に追記されていない（メモの節自体に懸念と根拠が
    書かれているため情報の欠落は無い）。
  - 本ブランチは main（PR #394 マージ後）より前の地点から分岐しており、
    `docs/WORKLOG.md` の #391 行を書き換えているため、マージ時に軽微な
    コンフリクトが出る可能性がある。解消は統括に委ねる。

### 2026-07-18 最終QA検証結果（合格）

- 担当: chainviz-qa
- 判定: **合格**。3つの完了条件をいずれも実ブラウザ操作で確認した。
- 検証環境: 稼働中の共有 Docker チェーン（chainviz-ethereum-* コンテナ群）を
  再利用し、本ワークツリー（issue-391-sidepanel-resize-handle、修正あり）から
  Playwright UI E2E の基盤（`playwright.config.ts` の globalSetup で
  UI層専用 collector を 4125、vite dev server を 5275 に起動）を使って
  Chromium から実際にサイドパネルを操作した。修正前コードを配信している
  メインチェックアウト由来の手動 dev スタック（vite 5173）は使っていない。
  - 環境固有の注意点: Chromium 起動時に libnspr4.so 等が見つからず失敗した
    ため、`/home/zoe/chrome-deps/root/usr/lib/x86_64-linux-gnu` を
    `LD_LIBRARY_PATH` に追加して起動した（この環境で UI E2E を回す際の
    既知の前提）。
- 検証手順と結果（通信ログパネルを開いてリサイズハンドルを操作）:
  1. リサイズハンドル上で右ボタンを押しながら左へ 150px ドラッグ →
     ドラッグ中もパネル幅は初期値(420px)のまま変化せず、
     `side-panel--resizing` クラスも付与されなかった。pointerup 後も 420px。
     期待どおり右ボタンではリサイズが開始しない。
  2. 左ボタンでハンドルをドラッグ → 幅が縮小し（ドラッグ方向に追従）、
     正常にリサイズできた。
  3. 左ボタンドラッグ中はルート要素に `side-panel--resizing` クラスが付与され、
     ドラッグ中にパネル本文上をなぞっても `window.getSelection()` が空文字
     （テキスト選択が発生しない）ことを確認。pointerup 後はクラスが除去された。
- 検証に用いた一時 Playwright スペックは検証後に削除済み（コミット対象外）。
  検証中に Docker チェーンへの破壊的操作は行っていない（読み取りのみ）。
  UI層 E2E 用の collector(4125)/vite(5275) は globalTeardown で停止済み。
- 統括への申し送り: 本ブランチには既に `docs/PLAN.md` の #391 チェックボックスを
  `[x]` に変更するコミット(cbba4ca)が含まれている。CLAUDE.md の運用では
  QA 合格後に統括がチェックを付ける手順のため、このコミットが QA 前に
  入っている点は経緯として留意されたい（QA 判定自体は上記のとおり合格）。
