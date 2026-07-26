# Issue #427 作業記録

### 2026-07-26 Issue #427 ブロック詳細パネルで親ブロックの行のフォントが2個目以降だけ異常に大きくなる

- 担当: frontend
- ブランチ: issue-427-block-detail-font-fix

#### 設計メモ（着手前）

Issue本文に統括による事前調査結果（原因・修正方針案）が記載されており、実装方針自体は
ほぼ確定していた。着手前に以下を確認・判断した。

- 原因: `packages/frontend/src/styles.css` の `.block-detail-view__parent-link`
  （`BlockDetailView.tsx` で `parent !== undefined` の場合のみ使われる `<button>` 要素、
  `.infra-field nodrag` と併用）に `font: inherit;` が指定されている。`font` ショートハンドは
  `font-size` を含む全サブプロパティを一括で `inherit` に上書きする。このルールは
  CSSファイル中で `.infra-field { font-size: 12px; }` より後（3974行目付近、`.infra-field`
  は2325行目）に定義されており、同じ詳細度（単一クラスセレクタ）のため CSS のカスケード
  規則（同一詳細度なら後に書かれた宣言が勝つ）により `font-size` が上書きされ、button は
  サイドパネル本文（`.side-panel__body`、`font-size: 16px` 相当）の大きいフォントサイズを
  継承してしまっていた
- 1個目のブロック（`navigation.parent === undefined`）は通常の `<Field>` コンポーネントで
  描画され `<div>` になるため、`.block-detail-view__parent-link` クラスを持たず影響を
  受けない。2個目以降だけ症状が出るのはこのため
- 修正方針: `font: inherit;` を `font-family: inherit;` に変更する。button 要素の
  デフォルトフォントファミリー（多くのブラウザで `system-ui` 相当）だけをリセットし、
  `font-size` には触れないようにすることで `.infra-field` の `font-size: 12px` を
  上書きしなくなる。`color: inherit` は既存のまま維持する（`font` ショートハンドは
  `color` を含まないため、この行は今回の不具合とは無関係）
- 検証方法: jsdom はスタイルシートのカスケードを評価しないため、コンポーネントテストでは
  実レイアウトの `font-size` を計算できない（既存の `sidePanelFontScale.css.test.ts` の
  知見と同じ）。そのため実ブラウザ（Playwright + headless Chromium）で実際に DOM を
  組んで `getComputedStyle` を確認し、修正前後の違いを目視ではなく数値で確認する。
  回帰テストは `sidePanelFontScale.css.test.ts` と同じパターン（styles.css を文字列として
  読み込み、対象クラスの宣言ブロックを正規表現で抽出して検証する）を踏襲する

#### 対応内容

1. 実ブラウザでの再現確認: このマシンには Playwright の Chromium 実行に必要な共有
   ライブラリ（`libnspr4.so` 等）が入っておらず、かつ `sudo` が使えない環境だった。
   `apt-get download` で該当パッケージの `.deb` を取得し `dpkg-deb -x` で
   非rootの作業ディレクトリに展開、`LD_LIBRARY_PATH` でそこを指す形で headless
   Chromium を起動できるようにした。修正前の `styles.css` を使い、
   `.side-panel__body` 相当の親要素の中に `.infra-field` の `<div>`（1個目相当）と
   `.block-detail-view__parent-link.infra-field` の `<button>`（2個目以降相当）を
   配置したところ、`getComputedStyle` 上で1個目は `12px`、2個目は `16px` となり、
   Issue記載の症状を実測で再現した
2. `.block-detail-view__parent-link` の `font: inherit;` を `font-family: inherit;` に
   変更した。修正後、同じ検証で1個目・2個目とも `12px` になることを確認した。あわせて
   `font-family`・`color` が親から正しく継承されること（button のデフォルト値に
   戻っていないこと）も別途確認済み
3. 回帰テスト `packages/frontend/src/side-panel/blockDetailParentLinkFont.css.test.ts`
   を追加した。`styles.css` を読み込み `.block-detail-view__parent-link` の宣言ブロックが
   `font` ショートハンドを含まないこと・`font-size` を宣言していないこと・
   `font-family: inherit` を持つことを検証する。`.infra-field` の `font-size: 12px` が
   維持されていることも合わせて固定した。このテストが実際に元の不具合を検出できることを
   `font-family: inherit` を一時的に `font: inherit` に戻して確認済み（4テスト中2件が
   期待どおり失敗した）
4. `pnpm lint` / `pnpm --filter @chainviz/frontend build` / `pnpm --filter
   @chainviz/frontend test`（313ファイル・3936テスト）がすべて成功することを確認した

#### 決定事項・注意点

- 修正は `packages/frontend/src/styles.css` の1行のみ（`font:` → `font-family:`）で完結し、
  `BlockDetailView.tsx` 側のロジック変更は不要だった
- `packages/frontend` の `node_modules` がこのworktreeに存在しなかったため `pnpm install`
  を実行してから検証を行った
- Playwright 実行用に取得・展開した `.deb` パッケージと展開先ディレクトリは
  リポジトリ外のスクラッチ領域に置き、コミット対象には含めていない

### 2026-07-26 テスト強化（異常系・境界値の追加）

- 担当: tester
- ブランチ: issue-427-block-detail-font-fix

#### 追加したテストと、その根拠になった実測

実装担当と同じ手順（`apt-get download` で `libnspr4` / `libnss3` /
`libasound2t64` を取得し `dpkg-deb -x` で非rootのスクラッチ領域へ展開、
`LD_LIBRARY_PATH` を通して headless Chromium を起動）で実ブラウザを用意し、
`.side-panel__body` の中に1個目相当の `<div class="infra-field">` と
2個目以降相当の `<button class="block-detail-view__parent-link infra-field">`
を並べて `getComputedStyle` を比較した。修正前後・`--side-panel-font-scale`
が 1 と 1.5 の場合の4通りを測定した結果は次のとおり。

- 修正前: div 12px に対し button 16px（scale 1.5 では 24px）、行の高さも
  21px 対 27px（scale 1.5 では 38px）とずれる
- 修正後: font-size・font-family・font-weight・line-height・letter-spacing・
  padding・display・justify-content・gap・color・行の高さ（21px）がすべて
  一致する

この実測を踏まえ、以下の3ファイルを追加した。

1. `packages/frontend/src/fontShorthandCollision.css.test.ts`
   - Issue #427 を一般化した横断ガード。`styles.css` の全ルールを解析して
     「`font` ショートハンドを宣言するクラス」と「`font-size` を宣言する
     クラス」を集め、`src/**/*.tsx` の `className` に静的に書かれた
     クラスの組み合わせ全件と突き合わせて、同一要素上で両者が衝突して
     いないことを検証する
   - 検出器自体が空振りしていないことの確認（ショートハンド使用クラスが
     1件以上ある、多クラス組み合わせが1件以上ある）と、修正前の CSS を
     組み立てたときに Issue #427 の組み合わせを実際に検出できることを
     同じファイル内で確認している
   - 残る3件の `font: inherit`（`.contract-list-panel__row` /
     `.mempool-panel__row` / `.mempool-panel__node-row`）は調査の結果
     Issue #427 とは別物と判断した。いずれも単独クラスで使われ、
     font-size は親（`.contract-list-panel` / `.mempool-panel` の 11px）
     から継承する設計のため。この前提（親側が font-size を持つこと）も
     テストで固定した
2. `packages/frontend/src/side-panel/blockDetailParentLinkButtonDefaults.css.test.ts`
   - `<button>` の UA スタイルは `font: 400 13.333px Arial` という
     ショートハンドなので、**button は line-height / font-weight /
     font-style / letter-spacing を祖先から継承しない**。現状これらが
     div 側と一致しているのは「祖先が一切宣言しておらず UA 既定値と
     たまたま同じ」という条件付きの一致にすぎない。実際に
     `.side-panel__body` に `line-height: 1.8; font-weight: 300;
     letter-spacing: 2px` を足して測ると div 21.6px/300/2px に対し
     button は normal/400/normal、行の高さも 28px 対 21px にずれた
   - そこで祖先セレクタ（`:root` / `body` / `.app` / `.side-panel` /
     `.side-panel__body`）がこれらを宣言していないことを前提条件として
     固定した。誰かが後から足すと Issue #427 と同種のズレが再発する
   - `.block-detail-view__parent-link` が `.infra-field` の持つ
     レイアウト系プロパティ（display / justify-content / gap / padding /
     margin）を再宣言していないこと、`.infra-field` 側が実際にそれらを
     持っていることも両方向から固定した
   - `--side-panel-font-scale` との関係: 修正後、親ブロック行は
     `.infra-field` の固定 12px に揃い、文字サイズ設定では拡大しなく
     なる。これは1個目の行（同じく固定 12px）と揃えるという
     Issue #427 の目的どおりの挙動なので仕様として妥当と判断した。
     ボタン側にだけスケール参照を足し直さないことをテストで固定し、
     あわせて `.block-detail-view__hash` の既存のスケール挙動が
     壊れていないことも確認している
3. `packages/frontend/src/side-panel/BlockDetailView.parentRowParity.test.tsx`
   - CSS の内容検査だけでは、button の `className` から `infra-field` が
     落ちる変更を検出できない（font-size の供給源が消えて
     `.side-panel__body` の 16px を継承する = Issue #427 と同じ症状に
     戻るが、CSS テストは緑のまま）。実際に `BlockDetailView.tsx` から
     `infra-field` を一時的に外して確認したところ、既存の
     `blockDetailParentLinkFont.css.test.ts` は4件とも成功したままだった
   - レンダリング結果に対して、親あり分岐が `<button>` かつ
     `block-detail-view__parent-link` / `infra-field` / `nodrag` を持つこと、
     親なし分岐が `<div class="infra-field">` であること、両分岐の
     label / value の子構造が同じであることを固定した

#### 実装への差し戻し（なし）・気づいた点

実装の変更が必要なバグは見つからなかった。以下は本 Issue の範囲外の
気づきとして記録しておく（対応するなら別 Issue）。

- `.block-detail-view__parent-link` は `text-align` をリセットしていない
  ため、`<button>` の UA 既定 `text-align: center` が残っている。他の
  ボタン化リセット（`.contract-list-panel__row` /
  `.mempool-panel__row` / `.mempool-panel__node-row`）はいずれも
  `text-align: left` を明示しており、そこだけ流儀が揃っていない。
  ただし親hashは空白を含まない1トークンなので現状は折り返しが起きず、
  flex item が内容幅に縮むため見た目には出ない（実測でも1行のときは
  完全に一致）。`.infra-field__value` に `overflow-wrap: anywhere` 等を
  足して折り返しを許した瞬間、button 側だけ最終行が中央寄せになる
  （実測で 34px ずれた）。この前提条件をテストで固定してある
- ブロック詳細パネルは `--side-panel-font-scale` への追従が部分的で、
  ヘッダーの短縮 hash（`.block-detail-view__hash`）だけが calc() で
  拡大し、`.infra-field` の各フィールド行・受信ノード一覧・tx 一覧・
  前後ボタンは固定 px のまま拡大しない。`.infra-field` は
  `WalletPopover` / `ChainRibbonPopover`（キャンバス上のポップオーバー。
  サイドパネルの文字サイズ設定の対象外）と共有しているため単純に
  calc() 化はできない。Issue #427 の修正が作った状態ではなく
  Issue #409 の時点からの積み残しだが、文字サイズ設定を使うユーザーには
  分かりにくいので別途検討の余地がある
- CSS 内容検査テストで使う `findStylesFile()` / `ruleBodyFor()` が
  同一実装のまま4ファイルに複製されている（既存3ファイル + 今回追加分）。
  既存の流儀に合わせて今回も複製したが、これ以上増えるなら共通の
  テストヘルパーに切り出したほうがよい
