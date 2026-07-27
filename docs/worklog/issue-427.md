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

### 2026-07-26 レビュー結果

- 担当: reviewer
- ブランチ: issue-427-block-detail-font-fix

#### 確認内容

- `main` との差分全体（`packages/frontend/src/styles.css` の1行修正 + テスト4ファイル
  + `docs/PLAN.md` / `docs/WORKLOG.md` / `docs/worklog/issue-427.md`）を確認した。
  修正は `.block-detail-view__parent-link` の `font: inherit` を
  `font-family: inherit` に限定するのみで、`BlockDetailView.tsx` 側のロジック変更は
  無い。フロントが Docker/ノードに直接触れる変更でもなく、チェーン固有語彙の
  漏れも無い。境界・チェーンプロファイル独立性・`packages/shared` 整合には抵触しない
- `pnpm lint` / `pnpm build` / `pnpm test` をリポジトリ全体で実行し、いずれも成功した
  （shared 75件・collector 1765件・e2e 185件・frontend 3959件、すべて成功）
- テストコードの質: 4ファイルとも実測（headless Chromium + `getComputedStyle`）に
  裏付けられた根拠を持ち、単一クラスの回帰固定（`blockDetailParentLinkFont`）・
  横断的な一般化ガード（`fontShorthandCollision`。全 TSX の className 組み合わせと
  CSS を突き合わせ、同種の衝突を将来検知する）・button の UA既定値による非継承
  プロパティの境界条件固定（`blockDetailParentLinkButtonDefaults`）・CSS 検査だけでは
  検出できない DOM 構造の変化に対するガード（`BlockDetailView.parentRowParity`）と、
  観点が重複せず補完し合っている。いずれも「検出器自体が空振りしていないか」
  「修正前の状態を意図的に再現して実際に検出できるか」を自己検証しており、
  実装の詳細をなぞるだけの無意味なテストではない
- コミット粒度: `git log main..HEAD` を確認。fix本体+回帰テスト1件を1コミット、
  横断テスト3件をそれぞれ独立コミット、docs更新を2コミットに分けており、
  「1つの変更内容 = 1コミット」の原則に沿っている

#### テスト強化担当からの申し送り3点への判断

1. `text-align` の流儀不揃い: 対応必要と判断し、レビュー側で直接修正した。
   `.block-detail-view__parent-link` に `text-align: left;` を追加し、他の
   ボタン化リセット（`.contract-list-panel__row` / `.mempool-panel__row` /
   `.mempool-panel__node-row`）と揃えた。現状の見た目（親hashが1トークンで
   折り返さない）には影響しないことを `pnpm test` で確認済み。あわせて
   `blockDetailParentLinkButtonDefaults.css.test.ts` の該当テストを、
   「リセットしていないことの前提条件」を固定するテストから
   「`text-align: left` が明示されていることを固定する」テストへ更新した
   （修正後の状態に合わせてテストの意図も追従させた）
2. `--side-panel-font-scale` 追従の部分性: Issue #427 が作った状態ではなく
   Issue #409 時点からの既存の積み残しであることをコード実測
   （`.block-detail-view__hash` のみ `calc()` 、`.infra-field` は固定 px で
   `WalletPopover`/`ChainRibbonPopover` と共有）で確認した。今回のスコープ外と
   判断する。別Issue化を検討する価値はあるが、今回のfix/PRの完了条件には含めない
3. テストヘルパー（`findStylesFile()`/`ruleBodyFor()`）の重複: 確認したところ
   `walletPopoverStyles.test.ts` / `sidePanelFontScale.css.test.ts` に既に
   同一実装が存在し、今回追加した2ファイルはこの既存の流儀を踏襲したものだった
   （Issue #427で新たに生んだ重複ではない）。機能上の欠陥ではなく、実装の詳細を
   なぞるだけの無意味なテストにもなっていないため、今回のマージをブロックする
   理由はないと判断した。ただし4ファイルに増えた時点でDRY違反が看過しにくい
   規模になっているため、共通テストユーティリティへの切り出しは別Issueとして
   検討する価値があると記録しておく

#### 判定

合格。上記1点（text-align）はレビュー側で軽微な修正を行った上で
`pnpm lint && pnpm build && pnpm test` の全通過を再確認した。commit・pushは
実施していない（統括が確認の上で実施する）。

### 2026-07-26 QA検証結果

- 担当: qa
- ブランチ: issue-427-block-detail-font-fix（検証用に origin の同一コミット
  `e99f3e0` を `qa-issue-427` としてチェックアウトして実施）

#### 検証環境

- `profiles/ethereum` の Docker スタック（reth1 / reth2 / beacon1 / beacon2 /
  validator1 / validator2 / workbench の7コンテナ）が稼働していることを確認した。
  workbench から `cast block-number` が 218 を返し、`eth_blockNumber` も 15秒間で
  0xc2 → 0xc3 と進行しており、チェーンが止まっていないことを確認した
- collector を port 4100（ロギングプロキシ 4101）、frontend（vite dev server）を
  port 5273 で起動した（既定の 4000 / 5173 は別作業のプロセスが使用中だったため、
  衝突しないポートを使った）。collector の WebSocket に接続し、`snapshot`
  （`chainType` / `timestamp` / `entities` / `edges`）と `diff`（`entityUpdated`・
  `nodeLinkActivity`）が仕様どおり流れることを確認した
- 実ブラウザは Playwright + headless Chromium（実装担当が用意した非rootの
  共有ライブラリ展開先を `LD_LIBRARY_PATH` で参照）。以降の数値はすべて
  実際に動いているアプリ（http://localhost:5273 ）の `getComputedStyle` と
  `getBoundingClientRect` の実測値

#### 確認内容と結果

1. 1個目のブロック（親が保持窓の外 = 親hash行が `<div class="infra-field">`）と
   2個目以降のブロック（親hash行が `<button class="block-detail-view__parent-link
   infra-field nodrag">`）の比較。チェーンリボンの最古タイルからブロック詳細を
   開き、「前のブロック」が disabled になるまで11回さかのぼって保持窓の最古
   ブロックを表示させ、その状態と、そこから「次のブロック」で1つ進めた状態の
   同じ「親ブロック」行を測った。
   - font-size: div 12px / button 12px（一致）
   - 値側 `.infra-field__value` の font-size: 12px / 12px（一致）
   - font-weight 400、line-height normal、letter-spacing normal、color
     rgb(231, 236, 244) がいずれも一致
   - 行のボックス: 左 1195 / 右 1586 / 幅 391 / 高さ 81 が完全に一致。ラベル幅も
     12px で一致。値テキストの描画開始 x 座標も 1219 で一致し、行数（1行、高さ
     14px）も同じ
   - text-align は div が `start`、button が `left`。LTR では算出結果が同じ値を
     指すため描画上の差は無く、実測でも値テキストの左端が一致している
   - 値のボックス幅だけ 488.3px / 483.7px と 4.6px 違うが、これは表示している
     hash の文字列自体が異なる（別ブロックの親hash）ことによる字形幅の差で、
     スタイルの差ではない
2. 修正が実際に効いていることの確認（不具合の再現と解消）。同じ画面に対して
   実行時に `.block-detail-view__parent-link { font: inherit; }` を注入すると
   親hash行だけ 12px → 16px（行の高さも 81px → 111px）に跳ね上がり、Issue #427
   の症状が再現した。注入した style を取り除くと 12px に戻った。修正後のコードが
   この症状を持たないことを、同一セッション内の前後比較として確認した
3. サイドパネルの文字サイズ設定（A- / A+）。A+ を2回押して
   `--side-panel-font-scale` が 1.3、`.side-panel__body` が 20.8px になった状態でも、
   ブロック詳細の `.infra-field` 3行（ハッシュ・親ブロック・時刻）はすべて 12px で
   一致していた。A- を3回押して 0.85（body 13.6px）にした場合も同様に3行とも 12px。
   親hash行だけが浮くことはなく、他の `.infra-field` 行と同じ挙動になっている
   （設計メモどおり `.infra-field` は font-scale に追従しない。この点は
   Issue #409 からの既存仕様で、本Issueの完了条件ではない）
4. 親hashボタンの機能。ボタンをクリックすると、表示中ブロックが親hash欄に
   出ていた hash のブロックへ切り替わることを確認した（クリック前
   `0x8980ed93...`、親hash欄 `0x75da6934...`、クリック後の表示ブロック
   `0x75da6934...` で一致）。サイドパネルは1枚のままで、パネルが重複して
   開くこともなかった
5. 本Issueで追加・変更されたテスト4ファイル（`fontShorthandCollision.css.test.ts` /
   `blockDetailParentLinkFont.css.test.ts` /
   `blockDetailParentLinkButtonDefaults.css.test.ts` /
   `BlockDetailView.parentRowParity.test.tsx`）を実行し、27件すべて成功することを
   確認した

#### 本Issueの範囲外として観測した点（差し戻しではない）

- 既定のサイドパネル幅（実測で行の幅 391px）では、`.infra-field__value` の
  フルhash（66文字）が折り返さずに行の右端（x=1586）を越えて x=1707 まで
  はみ出している。またラベル「親ブロック」が1文字ずつ縦に折り返して行の高さが
  81px になっている。いずれも div 版・button 版で完全に同一であり、Issue #427 の
  修正が作った状態ではない（親hash行だけの問題でもなく、ハッシュ行も同様）。
  気になる場合は別Issueで扱うのが適切

#### 判定

合格。`docs/PLAN.md` の該当項目は実装担当が既にチェック済みのため、追加の
チェック操作は不要だった。commit・push・PR作成・マージ・Issueクローズは
いずれも実施していない（統括の判断に委ねる）。
