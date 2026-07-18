# Issue #377 用語集パネルのフォントサイズを変更できるようにする

### 2026-07-18 Issue #377 起票とバックログ追記のレビュー

- 担当: reviewer
- ブランチ: docs-issue-377-backlog
- 内容: ユーザーからの要望を受けて統括が Issue #377 を起票し、
  `docs/PLAN.md` のバックログ節末尾(「## 運用ルール」の直前)に
  追記した。その内容をレビューした。
- レビュー結果: 合格
  - Issue #377 本文と PLAN.md の追記が過不足なく一致(ユーザーからの
    要望であること・フォントサイズ変更UIの要否・設定の永続化要否・
    他のサイドパネル(コントラクトソース表示・通信ログ)への適用範囲が
    論点であること・対象パッケージ frontend)
  - Issue 本文が参照する事実の実在確認: 用語集パネル(Issue #313、
    CLOSED)は実装済みで `SidePanelHost.glossary.test.tsx` 等が実在。
    レイアウト永続化の仕組み `packages/frontend/src/layout/layoutStore.ts`
    (Issue #15)も実在。サイドパネルの共通シェル
    `packages/frontend/src/side-panel/SidePanel.tsx` と kind ごとの
    振り分け(`SidePanelHost.tsx`)も実在し、類似要望として参照される
    Issue #362(サイドパネル幅リサイズ)は OPEN で記述どおり
  - 追記フォーマットは既存バックログ項目(チェックボックス行+括弧書きの
    補足+末尾の Issue リンク行)と一貫。配置(バックログ節末尾、
    「## 運用ルール」直前)も適切
  - コミット粒度: PLAN.md への追記のみの1コミット(dcac23f)で、
    Conventional Commits 形式(`docs:`)にも準拠
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過
    (frontend: 199ファイル2602テスト成功)
- 決定事項・注意点:
  - 実装着手は後日。UI の形(ボタン・スライダー等)・永続化の要否
    (layoutStore に載せるかセッション限りか)・用語集パネル単体か
    他のサイドパネルにも共通適用かは着手時に設計判断(Issue #362 の
    幅リサイズと同時に扱うと共通シェル側で一括対応できる可能性がある)
  - docs 配下のみの変更のため、CLAUDE.md の例外規定に基づき
    chainviz-qa は省略(reviewer 合格のみ)

### 2026-07-18 Issue #377 UX設計メモ(ux)

- 担当: ux
- ブランチ: issue-377-glossary-font-size
- 内容: 実装着手前のUX設計。実際にフロントをモックモード
  (`pnpm --filter @chainviz/frontend dev`、`VITE_COLLECTOR_URL` 未設定)で
  起動し、Playwright(chromium)で用語集・通信ログ・コントラクトソースの
  3パネルを実際に開いて現状の文字サイズ・読みやすさを確認したうえで、
  Issue の3論点(UI形状・永続化要否・適用範囲)を確定した。
  `packages/shared` の型変更は不要。

## 1. 現状の把握(実機確認)

- サイドパネル内の本文はほぼ 10〜13px で構成されている:
  - 用語集: 用語名 13px / 定義文 12px(--muted) / 英語併記・チップ類 11px /
    グループ見出し 11px
  - 通信ログ: 件名 12px / 本文・コード 12px / 時刻・フィルタチップ 11px /
    カテゴリチップ 10px
  - コントラクトソース: コード 12px(等幅) / 注記 12px / ファイル名 11px
- 用語集は「定義文を読む」パネルであり、学習アプリの読み物としては
  12px の muted 色の長文が続く。ここが「小さくて読みにくい」という
  要望の中心と考えられる
- 幅リサイズ(Issue #362)で幅は広げられるようになったが、文字自体の
  大きさは変わらないため、「広くしても読みやすくならない」という
  ギャップが残っている(動くが伝わらない、の一種)
- ブラウザのページズームでも拡大はできるが、キャンバス(カード・
  エッジ)まで一緒に拡大されてしまい、「キャンバスは今のまま、
  読み物のパネルだけ大きくしたい」という要望には応えられない

## 2. 設計判断(Issue の3論点への回答)

1. **UI形状: パネルヘッダーに「A− / 100% / A+」のステッパーを置く**
   - 場所は共通シェル(`SidePanel.tsx`)のヘッダー、タイトルと閉じる
     ボタンの間。どの kind でも同じ位置に出る
   - スライダーにしない理由: 選べる値は離散プリセット(後述の5段階)で
     十分で、ヘッダーの限られた幅(最小 300px)に収まり、ボタンは
     キーボード操作(Tab + Enter)もそのまま効く
   - 中央の「100%」表示は現在の倍率のフィードバックであると同時に、
     クリックで既定(100%)に戻すリセットボタンを兼ねる
     (aria-label・title で「文字の大きさを既定に戻す」と明示する)
   - 最小/最大に達したら該当ボタンを disabled にする(それ以上
     押しても変わらないことを見た目で伝える)
2. **永続化する**。localStorage キーは `chainviz.sidePanel.fontScale.v1`
   (新設)。幅(`chainviz.sidePanel.width.v1`)と同じ「スカラー1値の
   UI 設定」なので、`layout/layoutStore.ts`(安定ID→座標のマップ)には
   載せず、`sidePanelWidth.ts` と同じ独立モジュール +
   `platform/storage.ts` の `KeyValueStorage` 注入パターンで持つ。
   理由も幅と同じ: 「ユーザーが調整した見え方」はリロードのたびに
   リセットされると調整が無駄になる
3. **適用範囲は3パネル(kind)共通**。用語集単体にしない理由:
   - 「小さい文字の長文を読む」という課題は通信ログ・コントラクト
     ソースにも同じように存在する(実機確認で 3 パネルとも本文
     10〜13px であることを確認済み)
   - 幅が kind 共通の1値である(Issue #362)のと同じで、kind ごとに
     文字サイズが変わると切り替えのたびに見た目がガタつく
   - 共通シェルのヘッダーに置くため、実装も kind 非依存で1箇所に
     閉じる。kind 別設定が本当に必要になったらストレージ値の拡張で
     対応する(先回りしない)

## 3. スケールの定義

- 5段階の離散プリセット: **0.85 / 1.0 / 1.15 / 1.3 / 1.5**
  (表示は 85% / 100% / 115% / 130% / 150%)。既定は 1.0
- 上限 1.5 の根拠: 実機で 1.4 倍相当を適用したスクリーンショットを
  確認し、用語集(関連用語チップの折り返し)・通信ログ(フィルタ
  チップ・エントリ本文の折り返し)・コントラクトソース(横スクロール
  既存)のいずれもレイアウトが破綻しないことを確認した。1.5 は
  その少し上で、これ以上はパネル幅とのバランスが崩れ実用性が下がる
- 下限 0.85: 「一覧性を上げたい」逆方向の要望にも1段だけ応える。
  0.85 倍でも 11px → 9.35px 程度で判読可能なことを実機確認済み
- 読み込み時、保存値が刻みに無い値(手動改変等)なら最も近い
  プリセットへスナップする。非数・非有限は既定 1.0 にフォールバック
  (幅の `loadSidePanelWidth` と同じ防御的パターン)

## 4. 操作フロー

1. ユーザーがいずれかのサイドパネルを開く → ヘッダーに
   「A− 100% A+」が見える(タイトルの右、✕ の左)
2. 「A+」を押すたびに1段階拡大し、パネル本文の文字が即座に大きくなる。
   150% に達したら「A+」が disabled になる
3. 「A−」も同様に1段階ずつ縮小。85% で disabled
4. 中央の「100%」(現在値表示)を押すと既定に戻る
5. 変更は押した瞬間に保存され、パネルを閉じても・kind を切り替えても・
   リロードしても維持される

## 5. 情報の見せ方

- ボタン文言は「A−」「A+」(文字サイズ変更の慣習的表現。翻訳不要で
  ja/en 共通)。aria-label は i18n キーで持つ:
  - `sidePanel.fontSmaller`: {ja: "文字を小さく", en: "Decrease text size"}
  - `sidePanel.fontLarger`: {ja: "文字を大きく", en: "Increase text size"}
  - `sidePanel.fontReset`: {ja: "文字の大きさを既定に戻す(現在 {value})",
    en: "Reset text size (current {value})"} ※プレースホルダの要否は
    実装時に `format()` の既存機構に合わせて調整してよい
- 見た目は「静かな夜のガラス」方針に合わせ、`side-panel__close` と
  同系の控えめなボタン(枠なし・hover で薄く発光)。ヘッダーの
  情報量を増やしすぎない
- 拡大の対象は**パネル本文(`side-panel__body`)のみ**。ヘッダー
  (タイトル・ボタン類)は操作系のクロームなので拡大しない(拡大
  すると操作ボタン自体の位置がずれて操作感が不安定になるため)

## 6. 実装方式(データフロー・ファイル構成)

CSS カスタムプロパティ方式にする。JS はスケール値を1つ管理して
ルート要素にインライン style で渡すだけにし、拡大の実体は CSS 側の
`calc()` に寄せる(React の再レンダーはボタン押下時の1回だけで済む)。

```
ボタン押下
  → useSidePanelFontScale が scale state を更新 + save
  → SidePanel ルート div の style { "--side-panel-font-scale": scale }
  → styles.css のパネル内 font-size: calc(Npx * var(--side-panel-font-scale, 1))
```

作業ファイル(すべて `packages/frontend`):

1. **新規 `src/side-panel/sidePanelFontScale.ts`**(純ロジック。
   `sidePanelWidth.ts` と対になる):
   - `SIDE_PANEL_FONT_SCALE_STORAGE_KEY = "chainviz.sidePanel.fontScale.v1"`
   - `SIDE_PANEL_FONT_SCALE_STEPS = [0.85, 1, 1.15, 1.3, 1.5] as const`
   - `SIDE_PANEL_DEFAULT_FONT_SCALE = 1`
   - `stepSidePanelFontScale(current, direction: 1 | -1)`: 隣の
     プリセットを返す(端では同値を返す)
   - `loadSidePanelFontScale(storage)`: 非数・非有限 → 既定 1.0、
     刻み外の有限値 → 最も近いプリセットへスナップ
   - `saveSidePanelFontScale(storage, scale)`: 失敗は
     `console.warn` のみ(`saveSidePanelWidth` と同じ防御的パターン。
     理由コメントも同様に残す)
2. **新規 `src/side-panel/useSidePanelFontScale.ts`**(フック):
   - `useSidePanelFontScale(storage)` →
     `{ scale, increase, decrease, reset, canIncrease, canDecrease }`
   - increase/decrease/reset のたびに即保存(離散操作なので毎回
     保存してよい。`useSidePanelResize` のキーボード操作と同じ判断)
3. **変更 `src/side-panel/SidePanel.tsx`**:
   - 既存の `storage`(`useSidePanelResize` と共用)をフックへ渡す
   - ヘッダーに `side-panel__font-controls`(A− / 現在値% / A+)を追加
   - ルート div の style を
     `{ width, "--side-panel-font-scale": scale }` に拡張(カスタム
     プロパティは `React.CSSProperties` に無いため型上の逃げが必要。
     `style={{ width, ...({ "--side-panel-font-scale": scale } as
     React.CSSProperties) }}` 等、既存コードの流儀に合わせて実装判断)
4. **変更 `src/styles.css`**:
   - `.side-panel__body { font-size: calc(16px * var(--side-panel-font-scale, 1)); }`
     を追加(明示 font-size を持たない要素、例
     `.contract-source-view__name` は継承 16px なのでこれで追従する)
   - パネル本文系の明示 font-size を `calc(Npx * var(--side-panel-font-scale, 1))`
     に機械的に変換する。対象(UX設計時に実機プレビューで検証した一覧):
     - glossary-panel: `__search`(13) `__empty`(12) `__group-heading`(11)
       `__row-header`(13) `__row-secondary`(11) `__row-definition`(12)
       `__layer-chip`(11) `__related-label`(11) `__related-chip`(11)
     - contract-source-view: `__address`(12) `__unavailable`(12)
       `__filename`(11) `__code`(12)
     - comms-log: `-view__description`(12) `-view__empty`(12)
       `-view__note`(11) `-filter-bar__label`(11) `-filter-bar__chip`(11)
       `-filter-bar__node select`(11) `-entry__time`(11)
       `-entry__subject`(12) `-entry__body`(12) `-entry__code`(12)
       `-entry__chip`(10)
   - `.side-panel__header` 配下(タイトル・✕・今回のステッパー)は
     変換しない(§5 のとおりクロームは拡大対象外)
   - `.side-panel__font-controls` のスタイルを新設
5. **変更 `src/i18n/messages.ts`**: §5 の3キーを `sidePanel.resizeHandle`
   の直後に追加
6. **テスト**(基本分。強化は tester。1ファイル1責務で分割):
   - `sidePanelFontScale.test.ts`: ステップ送り(端で止まる)、
     スナップ(刻み外→最近傍)、壊れた値のフォールバック、保存失敗
   - `useSidePanelFontScale.test.ts`: increase/decrease/reset と
     保存タイミング、can フラグの境界
   - `SidePanel.fontScale.test.tsx`: ボタンが描画される・押下で
     ルートのカスタムプロパティが変わる・端で disabled・注入した
     インメモリ storage に保存される(既存 `SidePanel.test.tsx` には
     足さず新規ファイルにする)

## 7. 対象外・注意点

- `packages/shared` の変更: 不要(純粋なフロントの UI 設定)
- `SidePanelHost.tsx` / `SidePanelContext.tsx`: 変更不要(幅と同じく
  シェル内で完結させる。コンテキストに載せない)
- 用語ホバーポップオーバー(`GlossaryTerm`)・`ActionHint` の文字は
  対象外: これらはキャンバス側でも使う全画面共通 UI で、パネル専用
  設定に連動させると同じ部品の文字サイズが場所によって変わり
  一貫性を欠くため
- ヘッダーが最小幅 300px でも崩れないことを実装時に確認する。
  収まらない場合はタイトルの `text-overflow: ellipsis` を許容する
- E2E は必須にしない(jsdom の unit test でカバーできる範囲のため)。
  追加するなら「ボタン押下で本文の computed font-size が変わり、
  リロード後も維持される」だけの最小限にする(Issue #362 の
  `UI-PANEL-01` と同じ絞り方)
- `docs/ARCHITECTURE.md` §12.2 に幅と並べて「文字サイズもユーザーが
  変更できる(kind 共通・`chainviz.sidePanel.fontScale.v1`)」の趣旨を
  実装時に追記すること
- 実装時に判断してよい事項: ボタンの具体的な見た目・現在値表示の
  文言形式(「100%」表記か「±0」かなど。ただし現在値が分かること・
  リセット手段があることは維持)・上限 1.5 の ±1 段の微調整

## 8. 検証手段の記録

- モックモード(collector 不要)の frontend + Playwright(chromium、
  `LD_LIBRARY_PATH=/home/zoe/chrome-deps/root/usr/lib/x86_64-linux-gnu`
  が必要。issue-362 の QA 記録と同じ手当て)でスクリーンショット確認した
- スケール適用後の見え方は、§6-4 の calc() 変換をそのまま
  `page.addStyleTag` で注入して 0.85 / 1.4 倍を撮影し、折り返し・
  チップ配置が破綻しないことを確認した(この手順は実装後の
  目視確認にも再利用できる)

### 2026-07-18 Issue #377 実装設計メモ(frontend)

- 担当: frontend
- ブランチ: issue-377-glossary-font-size
- UX設計メモ(上記)をそのまま採用する。着手前に既存コード
  (`sidePanelWidth.ts`/`useSidePanelResize.ts`/`SidePanel.tsx`/
  `styles.css`/`GlossaryPanelView.tsx`/`ContractSourceView.tsx`/
  `CommsLogView.tsx`/`CommsLogEntryRow.tsx`/`CommsLogFilterBar.tsx`)を
  読み、設計メモ §6 の対象セレクタ一覧が実装と一致することを確認した。

**確認した差異と対応方針**

- `comms-log-view__note` と `comms-log-entry__code` は設計メモでは
  変換対象に挙がっているが、実装を見ると現状どちらも明示 `font-size` を
  持たず、親要素(`comms-log-view__empty` 12px / `comms-log-entry__body`
  12px)から継承しているだけだった。親を `calc()` に変換すれば継承先も
  連動して拡大されるため、この2つには個別の `calc()` ルールを追加
  しない(追加すると明示値が生まれ、将来親の値を変えたときに追従しなく
  なるほうが問題)。既定 1.0 倍時の見た目は変わらない

**実装方針(設計メモ §6 のとおり)**

1. `side-panel/sidePanelFontScale.ts`(純ロジック、`sidePanelWidth.ts` と
   対になる新規ファイル):
   - 定数: `SIDE_PANEL_FONT_SCALE_STORAGE_KEY`、
     `SIDE_PANEL_FONT_SCALE_STEPS = [0.85, 1, 1.15, 1.3, 1.5]`、
     `SIDE_PANEL_DEFAULT_FONT_SCALE = 1`
   - `nearestFontScaleStepIndex(value)`(内部ヘルパー): 5段階から最も
     近い値のインデックスを返す
   - `stepSidePanelFontScale(current, direction)`: 現在値に最も近い
     刻みのインデックスを求め、`direction`(+1/-1)だけ動かした刻みを
     返す(配列の端では同じインデックスに留まり同値を返す)
   - `loadSidePanelFontScale(storage)`: `loadSidePanelWidth` と同じ
     防御的パターン(非数・非有限 → 既定、刻み外の有限値 → 最近傍へ
     スナップ)
   - `saveSidePanelFontScale(storage, scale)`: `saveSidePanelWidth` と
     同じ try/catch + `console.warn`
2. `side-panel/useSidePanelFontScale.ts`(新規フック):
   - `useSidePanelFontScale(storage)` → `{ scale, increase, decrease,
     reset, canIncrease, canDecrease }`
   - increase/decrease/reset は状態更新と同時に `saveSidePanelFontScale`
     を呼ぶ(離散操作なので毎回保存。`useSidePanelResize` のキーボード
     操作と同じ判断)
   - `canIncrease`/`canDecrease` は現在値が最大/最小の刻みと厳密一致
     するかで判定(それ以外はどちらも押せる)
3. `SidePanel.tsx`:
   - 既存の `store`(`useSidePanelResize` と共用する解決済み storage)を
     `useSidePanelFontScale` にも渡す
   - ヘッダーに `side-panel__font-controls` を追加(タイトルと閉じる
     ボタンの間)。中身は A− ボタン・現在値ボタン(リセット兼用)・A+
     ボタン
   - ルート div の `style` を `{ width, "--side-panel-font-scale": scale
     }` に拡張。カスタムプロパティは `React.CSSProperties` の型に
     無いため、`Object.assign` ではなく `as React.CSSProperties` で
     型を逃がす(このパッケージの他箇所で同種の逃げ方が無いか確認した
     が前例が無かったため、最小限のキャストに留める)
4. `styles.css`:
   - `.side-panel__body` に `font-size: calc(16px * var(--side-panel-font-scale, 1))`
     を追加(既定値のフォールバックはインラインで確実に渡るので保険)
   - 設計メモ §6-4 に列挙されたパネル本文セレクタの明示 `font-size` を
     `calc(Npx * var(--side-panel-font-scale, 1))` に機械変換(上記の
     2つの例外を除く)
   - `.side-panel__font-controls` とボタン・現在値表示のスタイルを新設
     (`.side-panel__close` と同系の枠なし・控えめ発光)
5. `i18n/messages.ts`: 設計メモ §5 の3キーを `sidePanel.resizeHandle`
   の直後に追加。`sidePanel.fontReset` は `{value}` プレースホルダを
   持たせ、呼び出し側で `format()` する
6. `docs/ARCHITECTURE.md` §12.2 に幅と並べて文字サイズの永続化仕様を
   追記する

**実装時に決めた事項(設計メモが実装判断に委ねた点)**

- ボタン見た目: 文言は `A−` / `A+`(半角ハイフンマイナス)。現在値表示は
  `100%` 形式の丸め表示(`Math.round(scale * 100)}%`)
- `sidePanel.fontReset` のプレースホルダは `{value}` を使い、
  呼び出し側で `format(t("sidePanel.fontReset"), { value: \`${percent}%\` })`
  として埋める
- 上限 1.5 の ±1 段の微調整: UX設計メモの5段階
  (0.85/1.0/1.15/1.3/1.5)をそのまま採用し変更しない(実機確認済みの
  値を尊重する)

**テスト方針(1ファイル1責務)**

- `sidePanelFontScale.test.ts`: ステップ送り(端で停止)・スナップ・
  壊れた値のフォールバック・保存失敗
- `useSidePanelFontScale.test.ts`: increase/decrease/reset の状態遷移・
  保存タイミング・can フラグの境界
- `SidePanel.fontScale.test.tsx`: ボタン描画・押下でルートのカスタム
  プロパティが変わる・端で disabled・注入した storage に保存される・
  リセットボタンの挙動(新規ファイル。既存 `SidePanel.test.tsx` /
  `SidePanel.resize.test.tsx` には追加しない)

### 2026-07-18 Issue #377 実装完了(frontend)

- 担当: frontend
- ブランチ: issue-377-glossary-font-size
- 上記の実装設計メモどおりに実装した。追加・変更したファイル:
  - 新規: `side-panel/sidePanelFontScale.ts`(純ロジック)、
    `side-panel/sidePanelFontScale.test.ts`、
    `side-panel/useSidePanelFontScale.ts`(フック)、
    `side-panel/useSidePanelFontScale.test.ts`、
    `side-panel/SidePanel.fontScale.test.tsx`
  - 変更: `side-panel/SidePanel.tsx`(ヘッダーにステッパー追加、ルート
    div に `--side-panel-font-scale` カスタムプロパティを付与)、
    `styles.css`(`.side-panel__body` の基準 `font-size` 追加 +
    設計メモ §6-4 の21セレクタを `calc()` に変換)、
    `i18n/messages.ts`(3キー追加)、`docs/ARCHITECTURE.md` §12.2
- `pnpm lint && pnpm build && pnpm test` を全パッケージに対して実行し、
  通過を確認した(frontend: 213ファイル2764テスト成功。新規追加分は
  設計メモ記載の3ファイルで計34テスト)
- E2E は追加しなかった(設計メモの判断どおり、jsdom の unit test で
  操作・永続化・disabled 境界をカバーできる範囲のため)
- 実装中に見つけた点:
  - `comms-log-view__note` と `comms-log-entry__code` は実装設計メモの
    とおり、親要素の `calc()` 変換への継承だけで対応し、個別の
    `calc()` ルールは追加しなかった(既定 1.0 倍時の見た目は変えて
    いない)
  - `stepSidePanelFontScale`/`loadSidePanelFontScale` の最近傍スナップは
    距離が同点(例: 1.4 は 1.3 からも 1.5 からも 0.1 差)の場合、配列の
    先頭側(より小さい刻み)を採用する実装になっている。この挙動は
    `sidePanelFontScale.test.ts` に固定テストとして記録した(仕様として
    意図した挙動ではなく実装の帰結だが、実害は無い値なので許容した)
  - `--side-panel-font-scale` は `React.CSSProperties` の型に無いカスタム
    プロパティのため、`SidePanel.tsx` のルート `style` は
    `as React.CSSProperties` で型を最小限だけ逃がしている
- `docs/PLAN.md` のIssue #377チェックボックス更新は行っていない(運用
  ルールどおりレビュー・QA完了後に統括が行う)
- E2E: 設計メモの判断(jsdom の unit test で十分)を踏襲し追加しない

### 2026-07-18 Issue #377 テスト強化メモ(tester)

- 担当: tester
- ブランチ: issue-377-glossary-font-size
- 実装担当の基本テスト(sidePanelFontScale/useSidePanelFontScale/
  SidePanel.fontScale の3ファイル)を読み、ハッピーパスと主要な端の
  停止・スナップ・保存失敗は既にカバー済みであることを確認した。
  以下の観点で異常系・境界値のテストを追加する(新機能の実装はしない)。
- 追加する観点:
  1. `sidePanelFontScale.ts` のスナップ同点タイの一般化: 実装は「距離が
     同点なら配列の若い(小さい)刻みを採用」する。既存は 1.4 の1点のみ
     固定。0.925 / 1.075 / 1.225 の各境界でも同じ規則が成り立つことを
     追加で固定する。加えて空文字・空白文字の保存値は `Number("")===0`
     で有限値になり既定 1.0 ではなく最小刻み 0.85 にスナップされる
     (「非数→既定」ではない)実装の帰結をピン留めする
  2. `stepSidePanelFontScale` の範囲外入力(5 / -5 など刻み外の current)
     からの送り、非刻み値からの縮小方向、全刻みの降順ウォークを追加
  3. `useSidePanelFontScale` のリセット冪等性(既定からのリセット)・
     decrease→increase の往復・保存済み非刻み値(1.4)からの起動スナップ・
     can フラグが歩行に応じて更新されること
  4. `SidePanel.fontScale.test.tsx`: disabled ボタンのクリックが
     onClick を発火せず保存値も変わらないこと(キーボード/SR には native
     `disabled` で伝わる)、disabled でも aria-label を保持すること、
     リセットボタンは端でも決して disabled にならないこと、パネルを
     kind 切り替え相当で再マウントしても同じ storage から倍率が維持される
     こと(点4: kind 共通1値)
  5. `styles.css` の calc() 変換の回帰固定(新規 css テスト): パネル本文の
     全対象セレクタが `calc(Npx * var(--side-panel-font-scale))` を持つこと、
     および `comms-log-view__note`/`comms-log-entry__code` は明示 font-size
     を持たず親から継承する(点3: 実装担当の判断が正しいことを DOM 入れ子
     で確認済み。CSS 側でも個別 font-size を持たないことを固定)ことを
     ファイル内容の検査で固定する(`walletPopoverStyles.test.ts` の前例に倣う)
- 実装は変更しない。上記のうち空文字→0.85 のスナップは実害の無い
  防御挙動なので固定テストとして記録するに留める(バグ差し戻しはしない)。

### 2026-07-18 Issue #377 静的レビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-377-glossary-font-size
- 内容: フォントサイズ変更機能(sidePanelFontScale/useSidePanelFontScale/
  SidePanel ステッパー/styles.css の calc() 変換/i18n 3キー/
  ARCHITECTURE.md §12.2 追記)の静的レビュー
- レビュー結果: **差し戻し(軽微。テストコメントの事実誤認の修正のみ。
  実装の挙動・テストの期待値はすべて正しい)**

**確認して問題なしと判定した項目**

- `sidePanelWidth.ts`(Issue #362)とのパターン一致: ストレージキー命名
  (`chainviz.sidePanel.fontScale.v1`)・`KeyValueStorage` 注入・
  `Number.isFinite` ガード・保存失敗の try/catch + `console.warn` +
  理由コメント、いずれも幅の実装と同型で一貫している
- エラー握りつぶし: 意図的な握りつぶしは `saveSidePanelFontScale` の
  1箇所のみで、理由コメントあり・エラー内容を `console.warn` に添えて
  おり既存の防御的パターンどおり。他に catch して無視する箇所は無い
- calc() 変換の網羅性: パネル区画(styles.css 1483〜2060行付近)の
  `font-size` 宣言を全数照合した。calc() 変換は 23 ルール
  (`side-panel__body` 基準 16px + contract-source 4 + glossary 9 +
  comms-log 9(子孫セレクタ `.comms-log-filter-bar__node select` 含む))
  で漏れなし。未変換はヘッダーのクローム3件(`__title` 13px /
  `__close` 14px / `__font-button,__font-value` 11px)のみで設計どおり。
  `comms-log-view__note` / `comms-log-entry__code` は明示 font-size を
  持たず親(いずれも calc 12px)から継承する判断は正しい(css テストでも
  固定済み)。`body` に font-size 指定が無いため `side-panel__body` の
  基準 16px はブラウザ既定値と同値で、既定倍率 1.0 時の見た目を変えない
  (`select` 要素は font を継承しないため個別 calc が必要、これも対応済み)
- `as CSSProperties` キャスト: カスタムプロパティは `@types/react` 19 の
  `CSSProperties` に含まれないため型の逃げが必要なのは事実。使用箇所は
  1箇所のみで理由コメントもあり許容範囲。より型安全な代替は csstype の
  モジュール拡張(`declare module "csstype" { interface Properties {
  "--side-panel-font-scale"?: number } }`)で、カスタムプロパティの利用が
  複数箇所へ広がる場合はそちらへ移行するのが望ましい(今回は不要)
- 境界の遵守: frontend パッケージ内で完結。`packages/shared` 変更なし・
  チェーン固有語彙の漏れなし。i18n は `{ja, en}` 形式で3キー追加済み
- 環境状態依存の固定値: 5段階プリセット(0.85〜1.5)は実機確認に基づく
  設計定数で、UX設計メモに前提(1.4倍相当までレイアウト非破綻を確認)が
  記録されており問題なし
- ARCHITECTURE.md §12.2 の追記内容が実装(キー名・5段階・disabled・
  リセット兼用の現在値表示・カスタムプロパティ方式・クローム対象外)と
  一致。docs との齟齬なし
- コミット粒度: main..HEAD の8コミットはいずれも単一の関心事
  (UX設計メモ/実装設計メモ/純ロジック/フック/UI組み込み/実装完了記録/
  テスト強化/テスト強化メモ)で、Conventional Commits 形式にも準拠
- `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過を確認
  (shared 75 / collector 1660 / e2e 179 / frontend 214ファイル2808テスト)

**差し戻し指摘: 最近傍スナップの「タイ」に関するコメントの事実誤認**

レビュー時に node で実測した結果、テストコメントの記述が3箇所で
IEEE754 の実際の値と食い違っている。期待値(アサーション)はすべて
正しく通っているが、このテスト群の目的は「浮動小数点の微妙な丸め挙動を
正確に記録すること」なので、コメントの事実誤認は修正が必要。

実測値(Node.js):

- `|1.3 - 1.4|` = 0.09999999999999987、`|1.5 - 1.4|` = 0.10000000000000009
  → **1.4 は厳密なタイではない**。1.3 が「厳密に近い」から選ばれる
  (先発優先ルールは関与しない)
- `|1 - 1.075| === |1.15 - 1.075|`(両者とも 0.07499999999999996 で
  同一の倍精度値)→ **1.075 は厳密なタイである**。ここでは strict `<`
  比較により「先に見つかった(配列の若い=小さい)刻み 1.0 を採用」する
  先発優先ルールが実際に効いている

修正すべき箇所:

1. `sidePanelFontScale.test.ts` の
   「snaps to the earlier (smaller) step on an exact tie between two steps」
   (1.4 のテスト): テスト名とコメントが「1.4 は 1.3 からも 1.5 からも
   同じ距離(0.1)。実装は先に見つかった刻みを採用」と主張しているが、
   上記のとおり 1.4 はタイではなく 1.3 が厳密に近い。同ファイル内の
   境界一覧テストのコメント(「1.4 → 1.3 が僅かに近い」)と直接矛盾も
   している。タイ時の先発優先ルールを固定したいなら、真のタイである
   1.075 を例に使うべき
2. 同ファイルの境界一覧テストの導入コメント「十進では両隣と等距離に
   見えても IEEE754 では厳密な同距離(タイ)にならない」: 一般命題として
   誤り(1.075 は厳密なタイになる)。また 1.075 の行コメント
   「1.0 が僅かに近い」も誤りで、正しくは「厳密な同距離のタイで、
   strict `<` により先に見つかった小さい側 1.0 を採用」
3. `useSidePanelFontScale.test.ts` の
   「snaps a stored non-step value to the nearest step on mount」の
   コメント「1.4 は同点タイで若い刻み 1.3 に丸められる」: 同様に誤り。
   「1.4 は IEEE754 上 1.3 が僅かに近いため 1.3 へスナップされる」が正しい
4. (推奨)`sidePanelFontScale.ts` の `nearestFontScaleStepIndex` に
   タイ時の挙動を1行明記する: 「厳密な同距離の場合は strict `<` 比較に
   より先に見つかった(より小さい)刻みを採用する。ただし十進の中点が
   IEEE754 で厳密なタイになるかは値による(例: 1.075 はタイ、1.4 は
   タイでない)」の趣旨

いずれもコメント・テスト名のみの修正で挙動変更を伴わないため、修正後の
再確認は該当2〜3ファイルの読み直しと `pnpm lint && pnpm test`
(frontend)で足りる。なお本 worklog の実装完了記録・テスト強化メモにも
「1.4 は同点」「タイにならない」の記述があるが、履歴としてそのまま残し、
本エントリの実測値を正とする。
