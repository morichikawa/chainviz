# Issue #327 UI全体に透明感・グラデーションを意識したビジュアルデザインを取り入れる

### 2026-07-16 UX/ビジュアルデザイン設計（chainviz-ux）

- 担当: ux
- ブランチ: issue-327-visual-design
- 内容: 実際にアプリを動かして現状の見た目を評価し、「透明感・グラデーション」の
  具体的なCSS方針を設計した。モックモード（`pnpm --filter @chainviz/frontend dev`、
  `VITE_COLLECTOR_URL` 未設定）で起動し、Playwright（chromium headless、
  Issue #32 と同じ手順で libnspr4/libnss3/libasound2t64 をスクラッチパッドに
  展開して `LD_LIBRARY_PATH` 経由で実行）でスクリーンショットを取得。さらに
  提案CSSを `page.addStyleTag` で一時注入したプロトタイプでも見た目・可読性を
  確認した（リポジトリのコードには一切触れていない）。

#### 1. 現状評価（何が「おしゃれでない」か）

- 全要素がフラットな単色塗り（カード `--panel-2`、ポップオーバー `#0c1119`、
  パネル `rgba(26,32,48,0.9)`）で、グラデーション・すりガラス表現がゼロ。
  機能的だが奥行き・質感がなく、Miro/Figma 的なモダンさに欠ける
- パネル類は `0.9` の半透明だがぼかしが無いため、体感上ほぼ不透明で
  「透明感」として伝わらない
- 背景は完全に均一な紺一色 + ドット格子。画面全体に光のニュアンスがない
- 一方で、役割別の枠色（ワークベンチ紫・ウォレット琥珀・コントラクト
  インディゴ等）、エッジの色体系、状態色（--synced/--syncing）は
  よく整理されており、**この意味体系は変えてはいけない資産**

#### 2. 設計方針: 「静かな夜のガラス」

操作フロー・情報構造・役割色の意味体系は一切変えず、**質感だけを底上げする**。

- 透明感 = すりガラス（半透明 + backdrop-filter: blur）。ただし適用先を
  「重なりが発生する浮遊要素」（オーバーレイパネル・ポップオーバー・トースト）
  に限定する
- グラデーション = ①背景の淡い色光（アクセント青 + インディゴ）
  ②カード・ボタンの控えめな縦グラデーション ③送信ボタンのアクセント
  グラデーション ④タイトルのグラデーションテキスト
- **カード（`.infra-card` 等）には backdrop-filter を使わない**。カードは
  数が多く React Flow の transform されたペイン内にあるため、パン/ズーム中の
  再描画コストとレンダリング不具合のリスクがある。カードの透明感は
  「わずかな透過（α0.96〜0.97）+ 上端1pxのハイライト + 深めの影」で表現する

#### 3. 具体的なCSS方針（実装指示）

**(a) デザイントークンの追加（`:root`）**

```css
--glass-bg: rgba(26, 32, 48, 0.72);          /* オーバーレイパネルの地 */
--glass-popover-bg: rgba(10, 15, 24, 0.88);  /* ポップオーバーの地 */
--glass-border: rgba(201, 212, 232, 0.18);   /* ガラスの縁 */
--glass-highlight: rgba(255, 255, 255, 0.07); /* 上端1pxのハイライト */
```

**(b) 背景: キャンバスに淡い色光のグラデーション**

```css
/* .react-flow のキャンバス実背景に適用 */
background:
  radial-gradient(1100px 700px at 12% -8%, rgba(79, 157, 255, 0.10), transparent 60%),
  radial-gradient(900px 650px at 105% 108%, rgba(111, 125, 234, 0.09), transparent 55%),
  var(--bg);
```

- 現在は `Canvas.tsx` の `<Background bgColor="var(--bg)" />` がキャンバス
  全面を単色で塗るため、`bgColor` を `"transparent"` に変えた上でこの
  グラデーションをCSS側（`.react-flow` またはその親）に持たせる
  （プロトタイプではCSSの `!important` 上書きで同じ見た目を確認済み。
  実装では prop 変更のほうがクリーン）。`colorMode="dark"` が `.react-flow`
  自体に敷く `#141414` が透けないよう、`.react-flow` の背景をこの
  グラデーションで確実に上書きすること
- `Canvas.tsx` 内の該当コメント（#141414 の説明）と、`peerEdge.ts` /
  `styles.css` の「背景 #0f1420 の上に描かれる」系コメントの更新も必要

**(c) オーバーレイパネル: すりガラス化**

対象: `.canvas-toolbar` `.layer-filter-bar` `.p2p-legend`
`.contract-list-panel` `.toast`

```css
background: var(--glass-bg);
backdrop-filter: blur(14px) saturate(140%);
-webkit-backdrop-filter: blur(14px) saturate(140%);
border-color: var(--glass-border);  /* 現在は var(--divider) */
box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45), inset 0 1px 0 var(--glass-highlight);
```

**(d) ポップオーバー: ダークガラス化（枠色は各役割色のまま維持）**

対象: `.infra-popover` `.glossary-popover` `.peer-popover` `.deploy-popover`
`.internal-link-popover` `.operation-target-popover` `.tx-lifecycle-popover`
`.contract-activity-chip__popover` `.operation-panel`
（`.action-hint__popover` は glossary-popover の見た目を流用しているので自動で追従）

```css
background: var(--glass-popover-bg);  /* 現在は #0c1119 の単色 */
backdrop-filter: blur(16px) saturate(130%);
-webkit-backdrop-filter: blur(16px) saturate(130%);
box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), inset 0 1px 0 var(--glass-highlight);
```

- `border` の色は変更しない（glossary=アクセント、deploy=コントラクト色、
  operation-target=マゼンタ…という「枠色=役割」の意味体系を維持）
- ポップオーバーは PopoverPortal で body 直下に出るため backdrop-filter が
  素直に効き、同時表示は高々数個なので性能影響も無い

**(e) カード: 縦グラデーション + 上端ハイライト（backdrop-filter なし）**

```css
.infra-card, .chain-ribbon-card {
  background: linear-gradient(180deg, rgba(40, 48, 68, 0.96) 0%, rgba(31, 38, 55, 0.97) 100%);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45), inset 0 1px 0 var(--glass-highlight);
}
.chain-ribbon-tile {
  background: linear-gradient(180deg, rgba(32, 39, 58, 0.9), rgba(24, 30, 46, 0.95));
}
```

- 役割別の `border-color`（ワークベンチ紫・ウォレット琥珀・コントラクト
  インディゴ・未知コントラクト破線）、フォークの outline、`.ghost-card` の
  破線 + 半透明は**一切変更しない**
- `.infra-card--fork-*` / `.contract-card--settle-*` / `.infra-card--new` /
  `.infra-card--ribbon-highlight` は自前の box-shadow で上書きするため、
  発動中は inset ハイライトが消えるが、一時的な強調状態なので許容とする
  （余裕があれば各 box-shadow 末尾に `, inset 0 1px 0 var(--glass-highlight)`
  を足して統一してよい）

**(f) ボタン・チップ: 微グラデーション + ホバーグロー**

```css
.canvas-toolbar__button, .language-toggle, .infra-card__operate, .layer-filter-bar__chip {
  background: linear-gradient(180deg, #2a3450, #222a3e);  /* 現在は var(--panel-2) */
}
.canvas-toolbar__button:hover, .language-toggle:hover, .infra-card__operate:hover {
  box-shadow: 0 2px 10px rgba(79, 157, 255, 0.25);  /* 既存の border-color: --accent は維持 */
}
.operation-form__submit {
  background: linear-gradient(135deg, #6db1ff, #3f86e8);  /* 現在は var(--accent) 単色 */
}
```

- `.operation-form__submit:disabled`（--panel-2 のフラット）は変更しない
- `.layer-filter-bar__chip--active` の淡い青塗りは変更しない

**(g) ヘッダー: 縦グラデーション + タイトルのグラデーションテキスト**

```css
.app__header { background: linear-gradient(180deg, #1d2436 0%, #161c2b 100%); }
.app__title {
  background: linear-gradient(90deg, #e7ecf4 30%, #9cc4ff);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
```

**(h) フォールバック**

backdrop-filter 非対応環境では半透明の地だけが残り可読性が下がるため、
`@supports not (backdrop-filter: blur(1px))` で (c)(d) の背景を従来値
（`rgba(26,32,48,0.92)` / `#0c1119`）に戻す。

#### 4. 視認性の検算（Issue #32 の水準を維持）

WCAG相対輝度式で以下を確認済み（検算スクリプトはスクラッチパッド）:

| 対象 | 実効色（最悪ケース） | コントラスト比 | 判定 |
| --- | --- | --- | --- |
| 背景グラデーション最明部 vs `--border` | ≈#16203a | 2.24（元 2.56） | 色光の中心は画面外（-8%）にあり、画面内はこれより暗い。カード境界の判別は保たれる |
| ガラスパネル地 vs `--muted` | 明るいカードが背後でも ≈#1d2434 | 7.58〜8.14（元 6.85 以上） | 向上 |
| カードグラデーション上端 vs `--muted` | #283044 | 6.37（元 6.85） | AA(4.5) を大幅に上回る |
| ポップオーバー地 vs `--text` | 明るいカードが背後でも ≈#0e1420 | 15.5 | 十分 |
| 送信ボタン最暗部 #3f86e8 vs 文字 #0c1119 | — | 5.21（元 6.85） | AA を維持 |

- 背景の色光は **α ≤ 0.10（青）/ 0.09（インディゴ）を上限**とする。これ以上
  強くするとカード境界（--border）のコントラストが Issue #32 の改善幅を
  失うため、「もっと派手に」の要望が出ても背景ではなく発光・影の側で調整する

#### 5. スコープと工程

- 変更は `packages/frontend/src/styles.css` 中心 + `Canvas.tsx` の
  `<Background bgColor>` prop 1点（+ 関連コメント修正）。既存クラス構造・
  コンポーネント構成・ロジックの変更は無し
- ロジック変更を伴わない見た目のみの調整のため、CLAUDE.md の方針どおり
  新規ユニットテストは不要（chainviz-tester 経由も不要と判断。最終判断は統括）
- QA はモックモード + Playwright で「実背景がグラデーションになっている
  こと」「ポップオーバー/パネルのぼかしが効いていること」「上表のCSS変数・
  実効色」を確認するのが確実（Issue #32 のQA手順が流用できる）

#### 6. スコープ外（やらないこと）

- **ライトモードの新設**: 現状のフロントはダークテーマ1本のみで、テーマ
  切り替え機構（prefers-color-scheme 対応等）は存在しない。Issue 本文の
  「ダークモード/ライトモード双方での視認性」は「（唯一のテーマである）
  ダークテーマの視認性を Issue #32 の水準から落とさない」と読み替える。
  ライトモード追加は別の大きな機能であり、要望が出た時点で別Issueにする
- MiniMap / Controls の配色カスタム（`colorMode="dark"` のままで浮いていない）
- 新規アニメーションの追加（既存のパルス・発光で十分。装飾過多を避ける）

#### 7. 判断を統括・ユーザーに確認したい点

- タイトルのグラデーションテキスト（(g)）は好みが分かれる要素。推奨はする
  が、不要なら (g) の `.app__title` 部分だけ外しても他の設計に影響しない
- 背景の色光の色相（青 + インディゴ）は既存のアクセント色・コントラクト色
  から取った。別の色味の希望があれば α 上限の制約内で差し替え可能

### 2026-07-15 Issue #327 起票とバックログ追記のレビュー
- 担当: reviewer
- ブランチ: main(docs/PLAN.md のみの未コミット変更をレビュー。実装着手は後日)
- 内容: Issue #327 の起票内容と `docs/PLAN.md` バックログ節への追記1項目
  (Issue #328 分と同時追記)をレビューした。結果は**合格**(PLAN.md 追記は
  そのままでよい)。ただし Issue 本文に軽微な事実誤認が1点あり、修正を推奨
- 確認したこと:
  - Issue本文が要望(「UI全体を透明感やグラデーションを意識しておしゃれな
    感じにしたい」)と進め方(主観的判断を伴うため chainviz-ux で方向性を
    検討してから chainviz-frontend に引き継ぐ)を過不足なく伝えている。
    PLAN.md 追記の括弧書きとも整合している
  - PLAN.md の追記はバックログ節の既存項目とフォーマットが一貫している
    (未チェックのチェックボックス+タイトル、6スペースインデントの
    括弧書き補足、Issueリンク行、節末尾への追加)。タイトルはGitHub上の
    Issueタイトルと一致
  - docsのみの変更だが規定どおり `pnpm lint` / `pnpm build` / `pnpm test`
    をリポジトリ全体で実行し、全件通過(テスト計3779件パス)を確認した
- 指摘(非ブロッキング、Issue本文の修正を推奨):
  - Issue本文に「CLAUDE.mdの既存要望『ダークモードのUI視認性を改善する』
    #32 との整合」とあるが、#32 は CLAUDE.md ではなく `docs/PLAN.md` の
    バックログ項目であり、かつ既にクローズ済み(対応完了)。正しくは
    「対応済みのIssue #32 で改善したダークモード視認性を損なわないこと」
    という趣旨。着手時に chainviz-ux が CLAUDE.md を探して迷わないよう、
    `gh issue edit 327` での本文修正を推奨する(PLAN.md 側には影響なし)
- 決定事項・注意点:
  - 実装は後日。CSS/スタイル中心でロジック変更を伴わない可能性が高いが、
    chainviz-tester の要否は実装内容を見て判断する(Issue本文に明記済み)
