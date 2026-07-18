### 2026-07-17 Issue #362 サイドパネル(コントラクトソース表示・用語集表示)の幅をリサイズできるようにする（起票・バックログ追記のレビュー）

- 担当: reviewer
- ブランチ: docs-issue-362-backlog
- 内容: ユーザーからの要望で起票したIssue #362と、`docs/PLAN.md`
  バックログへの追記（docsのみの変更）のレビュー。
  - Issue #362本文と`docs/PLAN.md`追記の照合: 要望の出所（ユーザーからの
    要望）・現状（幅固定、ARCHITECTURE.md §12.2に「400px目安」と記載）・
    論点（ドラッグリサイズハンドル・幅の永続化要否・最小/最大幅）・
    共通シェル(`SidePanel.tsx`)で全kind一括対応できる見込み、のいずれも
    一致。Issue本文にある詳細（永続化を既存の`layout/layoutStore.ts`
    (Issue #15)に載せるかセッション限りにするか、対象パッケージが
    `packages/frontend`であること）はPLAN.md側では要約により省略されて
    いるが、バックログ項目は要約で足りるため過不足なしと判断
  - 追記が参照する事実の実在確認: `docs/ARCHITECTURE.md` §12.2
    （2536行目）に「幅は 400px 目安（実装時に実測で確定してよい）」の
    記載が実在。実装上も `packages/frontend/src/styles.css` の
    `.side-panel` が `width: 420px`（`max-width: 90vw`）の固定幅であり、
    「現状は幅固定」の記述は実装と整合（420pxは「400px目安・実測で確定
    してよい」の範囲内）。`packages/frontend/src/side-panel/SidePanel.tsx`
    と `contractSource`/`glossary`/`commsLog` の3 kindも実在
  - `docs/PLAN.md` の追記フォーマットは直前の #359 項目と一貫
    （チェックボックス+6スペースインデントの補足+Issueリンク行）。
    配置（バックログ節末尾・「## 運用ルール」の直前）も適切
  - コミット粒度: `git log main..HEAD` は1コミット（PLAN.md追記のみ）で
    1変更1コミットの規約に適合。Conventional Commits形式も適合
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過を確認
    （shared 74 / collector 1563 / e2e 171 / frontend 2592テスト）
- 決定事項・注意点:
  - レビュー結果は合格。コード変更を伴わないためCLAUDE.mdの例外規定に
    基づきchainviz-qaは省略可
  - 実装着手は後日。着手時はリサイズハンドルの実装方法・幅の永続化要否・
    最小/最大幅の範囲を設計判断する（`docs/ARCHITECTURE.md` §12.2の
    「幅は400px目安」の記述も、リサイズ可能化にあわせて更新が必要になる
    見込み）

### 2026-07-18 Issue #362 設計メモ（designer）

- 担当: designer
- ブランチ: issue-362-sidepanel-resize
- 内容: 実装着手前の設計。リサイズ操作のデータフロー・永続化方式・
  最小/最大幅の確定。確定内容は `docs/ARCHITECTURE.md` §12.2 に反映済み。
  ここでは経緯・理由・実装担当（frontend）への引き継ぎ詳細を残す。
- 決定事項・注意点: 下記のとおり。`packages/shared` の型変更は不要
  （`SidePanelView` はフロント内部の型で、幅は純粋な UI 状態のため）。

## 現状の把握（設計時）

- `SidePanel.tsx`（シェル）は kind を知らない共通枠。幅は
  `styles.css` の `.side-panel { width: 420px; max-width: 90vw }` で固定
  （§12.2 の「400px 目安」という記述は実測 420px と齟齬があったため
  今回の更新で実態に合わせた）
- `SidePanelHost.tsx` が kind ごとの振り分けを担い、3 kind とも同じ
  位置に同じ `SidePanel` 要素を返す。React の差分更新では同一位置・
  同一型なので kind 切り替え時もシェルはアンマウントされない → シェル内
  に幅の state を持てば kind をまたいで自然に共有される
- 既存の永続化は 2 系統ある:
  - `layout/layoutStore.ts`: 「安定 ID → 座標」のマップ
    （`chainviz.layout.v1`）。カード位置専用のスキーマ
  - `i18n/LanguageProvider.tsx`: スカラー 1 値（`chainviz.lang`）。
    `platform/storage.ts` の `KeyValueStorage` を注入し、既定は
    `getBrowserStorage()`（jsdom 等ではインメモリ代替）
- フロント内に汎用のドラッグ実装は無い（カードのドラッグは React Flow
  任せ）。今回のリサイズが初のポインタドラッグ自前実装になる

## 設計上の判断と理由

1. **永続化する**。localStorage キーは `chainviz.sidePanel.width.v1`
   （新設）。理由: 言語・カード配置と同様「ユーザーが調整した見え方」で
   あり、リロードのたびにリセットされると調整が無駄になる。コントラクト
   ソースを読む作業は繰り返し発生するため恩恵が大きい
2. **`layoutStore` には載せない**。あちらは「安定 ID → Position」の
   マップで、スカラー 1 値を混ぜるとロード時のバリデーション
   （`isPosition`）と噛み合わずスキーマが濁る。言語設定と同系の
   「スカラー設定値」として独立モジュール `side-panel/sidePanelWidth.ts`
   に置く（1 ファイル 1 責務）
3. **幅は kind 共通の 1 値**。ドック領域は 1 つで、kind ごとに幅が
   変わると切り替えのたびに画面がガタつく。kind 別の幅が本当に必要に
   なったらストレージ値の拡張で対応する（先回りしない）
4. **最小 300px / 最大 90vw / 既定 420px**。
   - 既定 420px は現行 CSS の固定値を引き継ぐ（見た目の非互換を
     作らない）。CSS の `width: 420px` は削除し、幅の唯一の出どころを
     `sidePanelWidth.ts` の定数 + インライン style に一本化する
     （二重管理を避ける）
   - 最小 300px は「ヘッダ（タイトル + 閉じるボタン）と commsLog の
     フィルタバーが操作可能なまま保てる下限」としての設計定数。
     実装時に commsLog フィルタバーで実際に確認し、崩れるなら
     320px 程度まで上げてよい（±20px の調整は実装判断に委ねる）
   - 最大はビューポート幅の 90%。既存 CSS の `max-width: 90vw` と同じ
     比率で、クランプ計算時のビューポート幅は実行時に測る
     （固定 px にすると画面サイズの変化で静かに破綻するため）。
     CSS の `max-width: 90vw` はガードとして残す（ウィンドウ縮小時に
     ライブで効く）
5. **ドラッグはポインタキャプチャではなく window リスナー方式**。
   pointerdown（ハンドル上）で開始位置と開始幅を記録し、window に
   pointermove / pointerup を登録、pointerup で解除。理由: jsdom は
   `setPointerCapture` を実装しておらず、テストで素直に発火できる
   window リスナー方式のほうがテスト容易性が高い。パネルは
   `position: absolute; right: 0` なので
   `新しい幅 = 開始幅 + (開始X − 現在X)`（左へドラッグ = 広がる）
6. **アクセシビリティ**: ハンドルは `role="separator"`・
   `aria-orientation="vertical"`・`aria-valuenow/min/max`・
   `tabIndex={0}` とし、←キーで広く / →キーで狭く（1 打鍵 24px）。
   aria-label は新規 i18n キー（`{ja, en}`）で付ける
7. **保存タイミング**: ドラッグ終了時（pointerup）とキー操作時。
   ドラッグ中の pointermove では state 更新のみ（毎フレーム
   localStorage に書かない）。読み込み時は壊れた JSON・非数・範囲外を
   既定値へフォールバックし、保存失敗（QuotaExceededError 等）は
   `console.warn` で握りつぶす（`layoutStore` と同じ防御的パターン。
   握りつぶす理由も同様にコメントで残すこと）

## 実装担当（frontend）への引き継ぎ

作業ファイルと分担（すべて `packages/frontend`）:

1. **新規 `src/side-panel/sidePanelWidth.ts`**（純ロジック）:
   - 定数 `SIDE_PANEL_DEFAULT_WIDTH = 420` / `SIDE_PANEL_MIN_WIDTH = 300` /
     最大比率 0.9、ストレージキー `chainviz.sidePanel.width.v1`
   - `clampSidePanelWidth(width, viewportWidth)`: 純関数
   - `loadSidePanelWidth(storage, viewportWidth)`: 未保存・壊れた値・
     範囲外 → 既定値（クランプして返す）
   - `saveSidePanelWidth(storage, width)`: 失敗は warn のみ
   - `storage` は `platform/storage.ts` の `KeyValueStorage` 型を受ける
2. **新規 `src/side-panel/useSidePanelResize.ts`**（フック）:
   - `useSidePanelResize(storage)` →
     `{ width, resizing, handleProps }` 程度の形
   - pointerdown → window リスナー登録、pointermove で
     クランプ済み幅を setState、pointerup で解除 + 保存
   - キーボード（ArrowLeft/ArrowRight、24px 刻み）+ 即保存
   - アンマウント時に window リスナーを確実に掃除する
3. **変更 `src/side-panel/SidePanel.tsx`**:
   - 左端にハンドル要素（`side-panel__resize-handle`）を追加、
     ルート div に `style={{ width }}` を付与
   - `storage?: KeyValueStorage` を optional prop で受け、既定は
     `getBrowserStorage()`（`LanguageProvider` と同じ注入パターン。
     `SidePanelHost` は無変更でよい）
4. **変更 `src/styles.css`**:
   - `.side-panel` から `width: 420px` を削除（`max-width: 90vw` は残す）
   - `.side-panel__resize-handle`: 左端の縦帯（幅 8px 程度）、
     `cursor: ew-resize`、`touch-action: none`、hover/ドラッグ中の
     視覚フィードバック（境界線のハイライト等は「静かな夜のガラス」
     方針に合わせる）
5. **変更 `src/i18n/messages.ts`**: ハンドルの aria-label 用キーを追加
   （例: `"sidePanel.resizeHandle": { ja: "パネルの幅を変更", en: "Resize panel" }`。
   文言は実装時に調整可）
6. **テスト**（基本分。強化は tester）:
   - `sidePanelWidth.test.ts`: クランプ境界値、壊れた保存値の
     フォールバック、保存失敗の握りつぶし
   - リサイズ操作のテスト（`SidePanel.test.tsx` に足すか、肥大化する
     なら `SidePanel.resize.test.tsx` に分ける）: ドラッグで幅が変わる /
     pointerup で保存される / 最小・最大でクランプされる / キーボード
     操作。storage はインメモリ実装を注入する

前提にしてよい決定済み事項: 上記「設計上の判断と理由」1〜7 と
`docs/ARCHITECTURE.md` §12.2 の更新内容。

実装時に判断してよい事項:

- 最小幅の ±20px の微調整（commsLog フィルタバーの実際の崩れ具合で）
- ハンドルのヒット領域幅・視覚フィードバックの具体的な見た目
- ダブルクリックで既定幅に戻す機能は**必須ではない**（入れる場合も
  数行で済む範囲に限る。タブ化・複数パネル等への拡張は先回りしない）
- フックの返り値の正確な形（`handleProps` にまとめるか個別に返すか）

## 対象外（今回やらないこと）

- `packages/shared` の変更（不要）
- `SidePanelHost.tsx` / `SidePanelContext.tsx` の変更（幅はシェル内
  ローカル state + storage で完結し、コンテキストに載せると
  pointermove ごとに全コンシューマが再レンダーされるため載せない）
- kind ごとの個別幅・下部ドロワー等のレイアウト拡張
