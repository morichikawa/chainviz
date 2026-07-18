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

### 2026-07-18 Issue #362 実装設計メモ（frontend、着手前）

- 担当: frontend
- ブランチ: issue-362-sidepanel-resize
- 設計メモ 1〜7 をそのまま踏襲する。実装前に確認した既存コードとの
  対応・関数構成のみここに残す。

1. `side-panel/sidePanelWidth.ts`（純ロジック）:
   - 定数はエクスポートする
     `SIDE_PANEL_WIDTH_STORAGE_KEY` / `SIDE_PANEL_DEFAULT_WIDTH` /
     `SIDE_PANEL_MIN_WIDTH`。最大比率 0.9 はモジュール内部定数に留め、
     代わりに `sidePanelMaxWidth(viewportWidth)` を公開する（ハンドルの
     `aria-valuemax` 計算にも使うため、比率をハンドル側に漏らさない）
   - `clampSidePanelWidth(width, viewportWidth)` は `sidePanelMaxWidth`
     を内部で使う。`min` が常に `max` 以下になるよう
     `Math.max(SIDE_PANEL_MIN_WIDTH, viewportWidth * 0.9)` で下限保証
     する（極端に狭いビューポートでも矛盾したレンジにならない）
   - 保存フォーマットは `layoutStore.ts`（JSON）ではなく `i18n.ts` の
     `saveLanguage`（生文字列）と同じスカラー方式にする
     （`String(width)` / `Number(raw)`）。壊れた値・範囲外は
     `loadSidePanelWidth` 内で `SIDE_PANEL_DEFAULT_WIDTH` にフォール
     バックしてから clamp する
   - 保存失敗（`saveSidePanelWidth`）は `layoutStore.saveLayout` と
     同じ try/catch + `console.warn` パターンを流用する
2. `side-panel/useSidePanelResize.ts`（フック）:
   - 引数は `storage: KeyValueStorage` のみ（既定値の解決は
     `SidePanel.tsx` 側で `useState(() => storage ?? getBrowserStorage())`
     により1回だけ行い、`LanguageProvider.tsx` と同じ注入パターンに揃える。
     フック自体には省略可能性を持たせない）
   - ドラッグの開始位置・開始幅は `useRef` に保持し、pointermove /
     pointerup のイベントリスナーは `resizing` が true の間だけ window に
     登録する（`useEffect` の依存配列は `[resizing, storage]` のみとし、
     幅の state 自体は依存に含めない。pointermove のたびに listener を
     張り替えないため）。pointerup 時も同じ計算式で最終幅を確定させ、
     その場で1回だけ保存する
   - ビューポート幅は `window.innerWidth` を都度読む（保存や resize
     イベント購読はしない。ウィンドウ縮小時の見た目の破綻防止は既存の
     CSS `max-width: 90vw` に委ねる。設計メモの決定どおり）
   - キーボード操作（←→、24px 刻み）は都度 `saveSidePanelWidth` を呼ぶ
     （ドラッグと違って離散的な操作なので毎回保存してもコストが低い）
3. `SidePanel.tsx`:
   - `storage?: KeyValueStorage` を追加し、ルート要素に
     `style={{ width }}` を付与。ハンドルは `.side-panel` 内の先頭に
     `position: absolute` な `div` として追加する（`.side-panel` 自体が
     既に `position: absolute` なので、フレックスレイアウト
     （ヘッダー/ボディ）に影響を与えずに重ねられる）
   - ハンドルの aria 属性はフックの `handleProps` をスプレッドし、
     `aria-label` のみ `SidePanel.tsx` が `t()` で解決して追加する
     （フックは i18n を知らない）
4. `styles.css`: `.side-panel` から `width: 420px` を削除。
   `.side-panel__resize-handle` を新設（左端に重ねる縦帯、
   `cursor: ew-resize`、`touch-action: none`、hover/active/focus-visible
   のフィードバック）
5. `i18n/messages.ts`: `sidePanel.resizeHandle` を
   `sidePanel.close` の直後に追加する
6. テストファイル分割（1ファイル1責務。CLAUDE.md 運用ルール）:
   - `sidePanelWidth.test.ts`: クランプ境界・壊れた値・保存失敗
   - `useSidePanelResize.test.ts`: フック単体（`renderHook` 相当。
     ドラッグの開始→移動→終了、クランプ、キーボード操作、保存タイミング）
   - `SidePanel.test.tsx` は既存のシェルのテストのまま変更せず、幅・
     ハンドル関連は新規 `SidePanel.resize.test.tsx` に分ける（既存
     ファイルの肥大化を避ける）
7. E2E: 既存の e2e パッケージ構成を確認してから、実ブラウザでの
   pointer ドラッグシミュレーションが必要かを判断する（jsdom の
   `PointerEvent` 制約は vitest 側の unit test で吸収できる想定のため、
   E2E は「ハンドルが表示され、キーボードで幅が変わる」程度の
   最小限に留めるか、既存のE2E範囲と重複するなら追加しない判断も
   あり得る）

### 2026-07-18 Issue #362 実装完了（frontend）

- 担当: frontend
- ブランチ: issue-362-sidepanel-resize
- 内容: 上記の実装設計メモに従い実装した。

1. **`side-panel/sidePanelWidth.ts`（新規）**: 定数
   （`SIDE_PANEL_WIDTH_STORAGE_KEY` / `SIDE_PANEL_DEFAULT_WIDTH` /
   `SIDE_PANEL_MIN_WIDTH`）、`sidePanelMaxWidth` / `clampSidePanelWidth` /
   `loadSidePanelWidth` / `saveSidePanelWidth` を実装。保存形式は
   `i18n.ts` の `saveLanguage` と同じ生文字列（`String(width)` /
   `Number(raw)`）。保存失敗は `layoutStore.saveLayout` と同じ
   try/catch + `console.warn`
2. **`side-panel/useSidePanelResize.ts`（新規）**: ドラッグ
   （pointerdown/pointermove/pointerup）とキーボード（←→、24px 刻み）
   による幅変更の状態管理。ドラッグ中の window リスナー登録は
   `resizing` が true の間だけ張り、依存配列に幅の state を含めない
   （pointermove のたびに listener を張り替えない）。ドラッグ終了時・
   キー操作時にのみ保存する
3. **`SidePanel.tsx`**: `storage?: KeyValueStorage` を追加（既定
   `getBrowserStorage()`、`LanguageProvider` と同じ注入パターン）。
   ルート要素に `style={{ width }}` を付与し、左端に
   `role="separator"` のリサイズハンドルを追加。`SidePanelHost.tsx` /
   `SidePanelContext.tsx` は設計どおり無変更
4. **`styles.css`**: `.side-panel` から固定 `width: 420px` を削除
   （`max-width: 90vw` は残す）。`.side-panel__resize-handle` を新設
   （左端に重ねる縦帯、hover/active/focus-visible のフィードバック）
5. **`i18n/messages.ts`**: `sidePanel.resizeHandle`
   （ja: 「パネルの幅を変更」/ en: "Resize panel width"）を追加
6. **テスト**: `sidePanelWidth.test.ts`（クランプ境界・壊れた値・
   保存失敗）、`useSidePanelResize.test.ts`（ドラッグ・キーボード・
   保存タイミング・アンマウント時のリスナー掃除）、
   `SidePanel.resize.test.tsx`（シェル統合。既存 `SidePanel.test.tsx`
   は変更せず新規ファイルに分離）
7. **E2E**: `packages/e2e/src/ui/side-panel-resize.spec.ts`
   （`UI-PANEL-01`）を追加し `SCENARIOS.md` にも記載。実ブラウザでの
   ドラッグ挙動とリロード後の localStorage 永続化は jsdom の unit test
   では代用しきれない部分のため、そこだけを検証範囲にした（キーボード
   操作・クランプ境界は unit test で既にカバー済みのため E2E では
   重複させない）
- 実装中に見つかった注意点:
  - **jsdom は `PointerEvent` を実装していない**。unit test では
    `fireEvent.pointerDown` は内部で `PointerEvent` の構築を試みて
    無反応になる（イベント自体が発火しない）。代わりに `"pointerdown"`
    などの型名を持つ `MouseEvent` を dispatch する（`clientX` だけを
    見る実装なので代用できる）。加えて、DOM への直接
    `element.dispatchEvent(...)` は React の act() 境界外になり
    レンダー結果の反映が assertion より後になる（未然にDOM状態を
    読んでしまい失敗する）ことを実機確認した。`@testing-library`
    の `fireEvent(...)` （act() で自動的に包む）経由にすることで解消した
  - `clampSidePanelWidth` の最小/最大が矛盾しないよう、
    `sidePanelMaxWidth` 内で `Math.max(SIDE_PANEL_MIN_WIDTH, viewportWidth
    * 0.9)` により下限を保証している。極端に狭いビューポート
    （幅 300px 未満相当）でもレンジが破綻しないことをテストで確認済み
- 確認: `pnpm lint && pnpm build && pnpm test` を全パッケージ
  （shared / collector / frontend / e2e）に対して実行し通過を確認
  （frontend: 208ファイル2682テスト、collector: 80ファイル1636テスト、
  e2e: 15ファイル179テスト、shared: 6ファイル75テスト）
- 未実施: `docs/PLAN.md` のチェックボックス更新は依頼により保留。
  push・PR作成・マージ・Issueクローズも未実施（統括の指示待ち）

### 2026-07-18 Issue #362 テスト強化メモ（tester、着手前）

- 担当: tester
- ブランチ: issue-362-sidepanel-resize
- 方針: frontend が書いた基本テストを土台に、異常系・境界値の観点で
  ケースを追加する。実装ロジックには手を入れない。既存の3テストファイル
  （`sidePanelWidth.test.ts` / `useSidePanelResize.test.ts` /
  `SidePanel.resize.test.tsx`）はまだ肥大化しておらず関心事も一致して
  いるため、新規ファイルを作らず該当ファイルにケースを追記する。
- 追加する観点:
  1. `sidePanelWidth.ts` のクランプ/読み込みの境界・異常値:
     負数・`"NaN"`/`"Infinity"`/`"-Infinity"` の文字列・空文字/空白・
     小数・16進表記・ちょうど最大値/最大値超過・ビューポート最狭時の
     レンジ潰れ（min==max）
  2. `useSidePanelResize.ts`: ドラッグ中のビューポート縮小で最大幅が
     変化するケース、ドラッグ中の再 pointerdown（割り込み）による
     アンカー再設定、連続ドラッグでの開始幅の引き継ぎ、左方向ドラッグの
     最大クランプ、`aria-valuemax` のビューポート反映
  3. キーボード操作（←→ 24px 刻み）の最小/最大境界クランプと、狭い
     ビューポートでの最大クランプ
  4. PointerEvent 代用ヘルパー（type だけ差し替えた MouseEvent）が
     実装の読む `clientX` のみに依存している点の妥当性確認（実装は
     `event.clientX` しか参照しないため代用が成立する）
- `SidePanelHost.tsx` / `SidePanelContext.tsx` は `git diff main` で
  無変更を確認済み。

### 2026-07-18 Issue #362 テスト強化完了（tester）

- 担当: tester
- ブランチ: issue-362-sidepanel-resize
- 内容: 実装ロジックは変更せず、既存3テストファイルにエッジケースを
  追記した（新規ファイルは作らず、関心事の一致する既存ファイルに追加）。
- 追加ケース:
  - `sidePanelWidth.test.ts`: 最大幅の分岐点（0.9*vw が最小幅を跨ぐ
    ビューポート）、負数のクランプ（有限なので最小へ）、最大境界
    ちょうど/超過/直下、小数の保持、最狭ビューポートでの min==max 潰れ、
    保存値 `"NaN"`/`"Infinity"`/`"-Infinity"` のフォールバック、
    空文字・空白（Number で 0 になり最小へクランプ）、16進表記、小数、
    最小ちょうどの保存値
  - `useSidePanelResize.test.ts`: 左方向ドラッグの最大クランプ、ドラッグ
    中のビューポート縮小で最大幅が変化するケース、ドラッグ中の再
    pointerdown による割り込み・アンカー再設定、連続ドラッグでの終端幅の
    引き継ぎ、移動なし pointerup での保存、キーボードの最大/最小境界
    クランプ（狭いビューポート含む）、`aria-valuemax` のビューポート
    反映と最狭時の floor、小数幅の `aria-valuenow` 丸め、window リスナー
    がポインタイベント名で登録されることの確認
  - `SidePanel.resize.test.tsx`: `handleProps` の aria 属性がハンドル DOM
    に届いていること（スプレッド漏れ回帰防止）、キーボードでの最小
    クランプと永続化の DOM 経由での検証
- PointerEvent 代用ヘルパーの妥当性確認: 実装は window リスナーを
  `"pointermove"`/`"pointerup"` で登録し、ハンドラは `event.clientX`
  のみを参照する。テストは type だけ差し替えた MouseEvent（clientX を
  持つ）を同じイベント名で dispatch しており代用が成立する。実装が
  `"mousemove"` 等に変わると代用前提が崩れるため、リスナー登録名を
  明示的に検証するテストを追加して契約として固定した。
- 発見した軽微な挙動（バグではないが記録）:
  - 保存値が空文字/空白の場合、`Number("")===0` のため「壊れた値 →
    既定 420」ではなく「範囲外 → 最小 300」に落ちる。`saveSidePanelWidth`
    は数値文字列しか書かないため空文字は外部改変でしか発生せず、実害は
    ない。挙動をテストで固定した。
  - `clampSidePanelWidth(NaN, ...)` は NaN をそのまま返す（内部で
    サニタイズしない）。読み込み経路は `loadSidePanelWidth` が事前に
    非有限を弾くため実際には NaN が渡らず、ドラッグ/キーボード経路の
    入力も常に有限値。現状バグではないが、将来この純関数を別経路から
    呼ぶ場合は呼び出し側でのガードが必要。
- 確認: `pnpm --filter @chainviz/frontend build` と `test` 全通過
  （208ファイル2706テスト）。追加分の対象3ファイルは56テスト。eslint も
  クリーン。実装ファイル・`SidePanelHost.tsx`・`SidePanelContext.tsx`・
  `docs/ARCHITECTURE.md` などには変更なし。

### 2026-07-18 Issue #362 静的レビュー（reviewer）

- 担当: reviewer
- ブランチ: issue-362-sidepanel-resize
- 内容: サイドパネル幅リサイズ実装（frontend + tester強化後）の静的レビュー。
- 確認結果:
  1. `sidePanelWidth.ts` のclamp/load/save: 既定420px・最小300px・最大は
     `viewportWidth * 0.9`（実行時に測る。`sidePanelMaxWidth` で
     min<=max の下限保証あり）で設計メモどおり。保存形式は
     `i18n.ts` の `saveLanguage` と同じスカラー方式で既存パターンと一貫。
     testerが発見した「空文字/空白の保存値は `Number("")===0` のため
     既定420ではなく最小300に落ちる」挙動は**許容と判断**:
     `saveSidePanelWidth` は数値文字列しか書かないため空文字は
     localStorage の外部改変でしか発生せず、結果も有効範囲内（300）で
     UIは壊れない。挙動はコメント付きテストで固定済みであり、修正不要
  2. `useSidePanelResize.ts` の window リスナー方式: リスナー登録は
     `resizing` が true の間だけで、`useEffect` のクリーンアップで
     pointerup 時・アンマウント時とも確実に解除される（アンマウント時の
     解除はテストで検証済み）。リークなし。フロント内に既存の自前
     ポインタドラッグ実装は無く（カードのドラッグは React Flow 任せ）、
     jsdom の `setPointerCapture` 未実装を踏まえた設計判断も worklog・
     コード内コメントの両方に記録されており妥当
  3. `SidePanelHost.tsx` / `SidePanelContext.tsx`: `git diff main..HEAD`
     で無変更を確認（設計どおり）
  4. a11y: `role="separator"` + `aria-orientation="vertical"` +
     `aria-valuenow/min/max`（now/max は `Math.round` 済み）+
     `tabIndex=0` + ←→キー操作 + i18n化された `aria-label`
     （ja/en 両方をテストで検証）+ CSS の `:focus-visible` アウトライン。
     WAI-ARIA の focusable separator パターンに適合
  5. エラー握りつぶし: catch は `saveSidePanelWidth` の1箇所のみで、
     `console.warn` でエラー内容を出力し、握りつぶす理由（保存失敗が
     ドラッグ操作を壊さないため。`layoutStore.saveLayout` と同じ防御的
     パターン）がコメントに明記されている。問題なし
  6. 固定値の扱い: 最大幅は実行時のビューポート幅から動的に導出。
     420/300/24px は環境状態に依存しない設計定数で、根拠がコード
     コメントと worklog の両方にある。E2E も `expect.poll` + 緩い閾値
     （150px ドラッグで +100 超）で決め打ちに依存しない。問題なし
  7. コミット粒度: `git log main..HEAD` の9コミットはいずれも単一の
     関心事（設計docs / 永続化ロジック / フック / シェル組み込み /
     E2E / worklog記録 / テスト強化）に分かれており、Conventional
     Commits 形式にも適合
  8. `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過
     （shared 75 / e2e 179 / collector 1636 / frontend 2706）
- 差し戻し指摘（軽微・1件）:
  - `docs/ARCHITECTURE.md` §12.2（2583-2584行目）の「読み込み時は
    壊れた値・**範囲外の値を既定値へフォールバック**し」が実装と不一致。
    実装（`loadSidePanelWidth`）は非有限値（非数・±Infinity）のみ
    既定420pxへフォールバックし、**範囲外の有限値はクランプ**する
    （保存値"5"→300、保存値"900"+ビューポート500→450。テストで固定済み）。
    クランプの方がウィンドウ縮小後もユーザーの調整幅に近い値を保てる
    ため、**実装側が正**と判断。ARCHITECTURE.md の当該文を
    「非数などの壊れた値は既定値へフォールバックし、範囲外の値は
    現在の[最小, 最大]範囲へクランプする」の趣旨に修正すること
- 判定: 上記1件の docs 修正をもって合格。実装コード・テストへの
  差し戻しは無し
