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
