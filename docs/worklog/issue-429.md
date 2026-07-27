# Issue #429 51%攻撃デモで共通の親ブロックから枝A/枝Bへの接続線が分かりにくい

### 2026-07-26 Issue #429 設計メモ（着手前）

- 担当: frontend
- ブランチ: issue-429-attack51-connector-fix
- 前提: Issue #414 で実装した「51%攻撃のしくみ」デモ（`FiftyOnePercentAttackDemoView.tsx`）
  の接続線表現（`packages/frontend/src/styles.css` の
  `.attack51-demo__connector`、border を使った簡易な折れ線）が対象。統括の
  事前調査により、実機計測で以下が判明済み（Issue本文参照）:
  - `.attack51-demo__connector` の `width: 42%` が大きすぎ、`--a`/`--b` の
    border 位置がコンテナ中央付近にほぼ収束してしまっている
  - `left: 8%` / `right: 8%` というオフセットも、実際の枝ボックスの中心
    位置（後述するが実測で約24.4%/75.6%）とかけ離れている
- 対応方針（着手前に立てた設計判断）:
  - マークアップ（`FiftyOnePercentAttackDemoView.tsx`）は変更しない。
    `.attack51-demo__branches` が `display: flex; gap: 10px` で2つの枝を
    等分割しているため、各枝ボックスの中心 x 座標はコンテナ幅を `w`・
    gap を `g` とすると `(w - g) / 4`（枝A側。枝B側はその左右反転）で
    正確に計算できる。この式を `calc()` で `.attack51-demo__connector--a`/
    `--b` の `left`/`right`/`width` にそのまま反映し、実測値を当てはめた
    固定パーセンテージ（`8%`/`42%`)ではなく、実際のレイアウトから導出
    した値にする
  - gap の値（`10px`）は `.attack51-demo__branches` と connector 側の
    calc() の両方から参照する必要があるため、`.attack51-demo__tree` に
    CSS カスタムプロパティ `--attack51-branch-gap` を定義し両方から参照
    する（値のハードコード重複を避ける。CLAUDE.mdの「今この瞬間に観測
    できる状態に依存した固定値を埋め込まない」の趣旨に沿い、実際の
    レイアウト制約から導出する）
  - border を使った折れ線という既存アプローチ自体は維持する（Issue本文の
    修正方針どおり）。ただし縦線（border-left/right）は要素の高さ全体
    （0〜height）に伸びる性質があるため、「共通の親ブロック直下（トランク、
    コンテナ中央）」と「各枝ボックスの真上（枝の中心）」のどちらに縦線を
    置くかで見た目が変わる。トランク側に縦線を置くと2本の connector の
    縦線が同じx座標に重なって「共通の親ブロックから伸びる1本の幹」に
    見え、横線（border-bottom、枝の直上に配置）がそこから左右の枝の中心
    へ分かれる形になる。これが最も明確に「共通の親ブロックから各枝へ
    直接繋がっている」ことを示せると判断し、この配置を採用する（横線を
    `border-top`ではなく`border-bottom`にすることで、横線の高さを
    枝ボックスの直上=接続線ストリップの下端に合わせる）
  - SVGへの置き換えは行わない。border方式のままで実際の枝中心と正確に
    一致させられることを確認できたため、より複雑な実装への変更は不要と
    判断した
  - 確認方法: 実際の DOM 構造・CSS クラス名を再現したスタンドアロン
    HTML（`.side-panel` 相当のラッパーごと再現）を作り、
    `packages/e2e` の devDependency である `@playwright/test` を使って
    ヘッドレス chromium で実機計測する。frontend は Docker/collector に
    直接触れない制約があり、また本バグは CSS レイアウトのみに起因し
    データに依存しないため、collector を経由した実際のワールドステート
    接続は不要と判断した

### 2026-07-26 Issue #429 対応内容

- 担当: frontend
- ブランチ: issue-429-attack51-connector-fix
- 実施内容:
  1. 実際の DOM 構造（`FiftyOnePercentAttackDemoView.tsx`・
     `AttackBranchBox.tsx` と同じクラス名・入れ子構造）と実際の
     `styles.css` を組み合わせたスタンドアロン HTML を用意し、Playwright
     （ヘッドレス chromium、viewport 1600x1000）で `.attack51-demo__branches`・
     `.attack51-demo__connector--a`/`--b` の `getBoundingClientRect()` を
     実測した。修正前の状態で、Issue本文に記載された実測値
     （`branches` x=1195 width=391、`connector--a` x=1226.27 width=164.22、
     `connector--b` x=1390.52 width=164.22）と一致することを確認し、
     再現が取れていることを確かめた
  2. `packages/frontend/src/styles.css` を修正。`.attack51-demo__tree` に
     `--attack51-branch-gap: 10px` を定義し、`.attack51-demo__branches` の
     `gap` と `.attack51-demo__connector--a`/`--b` の位置計算の両方から
     参照するようにした。connector の位置は
     `calc(25% - (var(--attack51-branch-gap) / 4))` を基準にし、枝の中心
     からコンテナ中央（共通の親ブロックの直下、トランク）までを1本の
     ボックスにした。縦線（`border-right`/`border-left`）はトランク側の
     辺に、横線（`border-bottom`）は枝の直上に配置し、共通の親ブロックから
     伸びる1本の幹が接続線ストリップの下端で左右に分かれてそれぞれの枝の
     中心へ繋がる形にした
  3. 修正後、同じ Playwright スクリプトで再計測し、
     `connector--a` の左端が `branchA` の中心と、`connector--a`/`--b` の
     互いに接する端点が `commonParent` の中心と、`connector--b` の右端が
     `branchB` の中心と、それぞれピクセル単位で一致することを確認した
     （側パネル幅 420px・300px・700px の3パターンで確認。いずれも一致）。
     スクリーンショットでも「共通の親ブロックから1本の幹が伸び、下端で
     左右の枝の中心へ分かれる」見た目になっていることを目視確認した
  4. `FiftyOnePercentAttackDemoView.tsx`・`AttackBranchBox.tsx` は変更して
     いない（純粋な CSS 修正のため）。CLAUDE.md の例外規定
     （「純粋な見た目調整のみの変更」）に該当するため、新規ユニット
     テストは追加していない
  5. `pnpm lint`・`pnpm build`（全パッケージ）・`pnpm test`（全パッケージ、
     shared 75件・collector 1765件・e2e 185件・frontend 3932件）が
     すべて成功することを確認した
- 決定事項・注意点:
  - `.attack51-demo__branches` の `gap` の実値を変更する場合は
    `--attack51-branch-gap` も同時に変更すること（connector の位置計算が
    この変数を参照しているため、`gap: 10px` だけを書き換えると再びズレる）
  - 枝の中心座標の式 `(w - gap) / 4` は「2要素・`flex: 1`・等しい gap」
    という現在のレイアウト構成に依存している。枝の数を増やす・
    `flex` の比率を変える等のレイアウト変更をする場合は、この calc() も
    合わせて見直す必要がある

### 2026-07-26 Issue #429 レビュー(reviewer)

- 担当: reviewer
- 判定: 合格
- 確認したブランチ: `issue-429-attack51-connector-fix`(コミット
  `5d18a48` fix、`6bfb8a5` docs。2コミットとも1変更=1コミットの原則に
  沿っており、混在なし)
- 確認内容:
  1. 差分は `packages/frontend/src/styles.css` のみ(38行の変更)。
     マークアップ(`FiftyOnePercentAttackDemoView.tsx`)・ロジックは
     無変更であることを diff で確認した
  2. `.attack51-demo__connector--a`/`--b` の `calc()` 式を手計算で
     再検証した。`.attack51-demo__branches` は `flex: 1` の2要素+
     `gap` の等分割で、枝1個の中心x座標はコンテナ幅を `w`・gapを `g`
     とすると `(w - g) / 4`(枝A側)。`calc(25% - g/4)` は「コンテナ幅の
     25%(px換算)から `g/4`(絶対px)を引く」という計算になり、
     `0.25w - g/4` と一致するため、この式は正確に成立する。全要素に
     `* { box-sizing: border-box; }` が効いているため、`border-right`/
     `border-left` を追加してもボックスの外形(left/width で計算した
     座標)はずれない。トランク側の縦線(`border-right`/`border-left`)が
     x=50%上で重なり1本の幹に見える設計、横線(`border-bottom`)が
     枝の直上に来る設計も、実際の要素の親子構造(`.attack51-demo__tree`
     直下に `.attack51-demo__connectors`・`.attack51-demo__branches`が
     並ぶ)と整合していることをマークアップで確認した
  3. `--attack51-branch-gap` は `.attack51-demo__tree` にのみ定義され、
     CSSカスタムプロパティのスコープは子孫要素に継承されるため
     `.attack51-demo__connectors`・`.attack51-demo__branches`(いずれも
     `.attack51-demo__tree` の直接の子)から参照できる。`styles.css`
     全体を検索し、この変数名が他のセレクタと衝突していないことも
     確認した
  4. `pnpm lint` / `pnpm build`(全パッケージ)/ `pnpm test`(shared 75件・
     collector 1765件・e2e 185件・frontend 3932件)がすべて成功する
     ことを確認した
  5. 新規ユニットテストを追加していない判断は妥当と判断した。変更が
     `styles.css` のみで、対応するReactコンポーネント・純粋ロジックの
     変更を伴わないため、CLAUDE.mdの「純粋なUIの見た目調整や設定ファイルの
     変更など、ロジックを伴わない変更は対象外」の例外規定に該当する
  6. 実機でのブラウザ・Playwright確認を試みたが、本レビュー環境には
     Playwrightのheadless chromiumの実行に必要なシステム共有ライブラリ
     (`libnspr4.so`等)が入っておらず起動できなかった。その代替として、
     `.attack51-demo__connector--a`/`--b` の `calc()` 式が実際のflex
     レイアウトの中心座標と数学的に一致することを手計算で検証した
     (上記2.)。実装担当の報告に記載されたPlaywright実測値(修正前の
     ズレ・修正後の一致)は実装担当の設計メモ・対応内容の記述と整合して
     おり、この手計算による裏付けと合わせて妥当と判断した
  7. Issue本文の完了条件(「実際にブラウザで見て分かりやすい形になって
     いる」「修正前後の見た目をPlaywright等で確認する」)について、
     後者は実装担当が実施済みの記録がある。前者は見た目の主観評価を
     伴うため、静的レビューでの数学的検証に加えて実機での最終確認は
     QA(chainviz-qa)に委ねる
- 指摘事項: なし

### 2026-07-27 Issue #429 検証(qa)

- 担当: qa
- 判定: 合格
- 検証したコミット: `e9963f1`(`issue-429-attack51-connector-fix` の先端)
- 検証環境の起動手順:
  1. `profiles/ethereum` の Docker スタックが稼働していることを確認した
     (`docker compose ps` で beacon1/beacon2/reth1/reth2/validator1/
     validator2/workbench の7コンテナが running)。ワークベンチ経由の RPC
     (`eth_blockNumber`)を数回叩き、ブロック高が進み続けている
     (0x3 → 0x4)ことを確認した
  2. collector をポート 4712(ロギングプロキシ 4713)で起動した。他の
     エージェントが既定ポート(4000/4300)を使用中だったため、衝突しない
     ポートを選んだ。起動ログに
     `WebSocket server listening on port 4712` が出ることを確認した
  3. `ws://127.0.0.1:4712` へ WebSocket で接続し、1通目に `snapshot`、
     以降 `diff` が継続して届くことを確認した
  4. frontend(vite dev server)をポート 5712 で起動し、
     `VITE_COLLECTOR_URL=ws://127.0.0.1:4712` を指定した
  5. Playwright(chromium、viewport 1600x1000)で
     `http://127.0.0.1:5712/` を開き、チェーンリボンカードの学習用デモ
     メニュー(`chain-ribbon-demo-menu-open`)から
     「51%攻撃のしくみを試す」(`chain-ribbon-fifty-one-percent-demo-open`)
     を開いた。背景のキャンバスに実ノードのカード
     (`chainviz-ethereum-reth1-1` 等)が描画されていることから、
     collector 経由のワールドステートが実際に流れている状態で確認できている
- 補足: 本検証環境にも Playwright の headless chromium に必要な
  `libnspr4.so` 等が入っていなかったが、`/home/zoe/chrome-deps/root/usr/
  lib/x86_64-linux-gnu` に展開済みの共有ライブラリがあったため
  `LD_LIBRARY_PATH` に指定することで実機起動できた。レビュー担当が
  実機確認できなかった箇所を、この方法で実際のブラウザ描画として確認した
- 確認内容:
  1. 修正後の見た目。共通の親ブロックの下端中央から1本の幹が下り、
     接続線ストリップの下端で左右に分かれてそれぞれの枝ボックスの真上
     中央に到達する Y 字型になっていることを、拡大スクリーンショット
     (deviceScaleFactor 4 および 8)で目視確認した。腕の先端は枝ボックス
     上辺の中央にぴったり接しており、隙間・はみ出しは無い
  2. 座標の実測。サイドパネル幅 300px / 420px / 700px の3パターンで
     `getBoundingClientRect()` を計測し、いずれも
     - `connector--a` の左端 == 枝Aの中心x
     - `connector--a` の右端 == `connector--b` の左端 == ツリーの中心x
       (= 共通の親ブロックの中心x)
     - `connector--b` の右端 == 枝Bの中心x
     が小数点以下まで完全一致することを確認した(例: 幅420pxのとき
     枝A中心=1290.25 / connector--a 左端=1290.25、ツリー中心=1390.50 /
     connector--a 右端=connector--b 左端=1390.50、枝B中心=1490.75 /
     connector--b 右端=1490.75)
  3. 修正前との比較。`styles.css` だけを修正前(`6e6ed2d`)の内容へ一時的に
     戻して同じ計測とスクリーンショットを取り直した。修正前は幅420pxで
     `connector--a` が x=1226.27・width=164.22(右端 1390.49)、
     `connector--b` が x=1390.52・width=164.22 となり、Issue 本文に
     記載された実測値と一致した。見た目もストリップ上端をほぼ横断する
     長い水平線と、中央でほぼ重なった2本の縦線という「⊥」型で、枝には
     一切繋がっていないことをスクリーンショットで確認した。修正後は
     この症状が解消している。確認後、`styles.css` は元(修正後の状態)へ
     戻し、作業ツリーに差分が残っていないことを `git status` で確認した
  4. サイドパネル幅の変更。リサイズハンドルを実際にドラッグして
     幅 300 / 460 / 620 / 840 / 1120 / 1420px(最大幅=ビューポートの90%)
     まで連続的に変化させ、各段階で上記2.の一致条件が保たれること・
     レイアウトが崩れないことを確認した。すべての幅で一致した
  5. バリデーターの移動。枝Aの先頭バリデーターを5回連続でクリックし、
     枝Bが正準に反転するまで操作した。枝ボックスの高さがバリデーター
     ボタンの折り返し行数に応じて 138px → 116px → 138px と変化しても、
     接続線ストリップの高さ(20px)と接続線の端点の一致は保たれたまま
     だった。正準/非正準のバッジ・枠色の切り替えも含めてレイアウトの
     崩れは無かった
- 気づいた点(不具合ではない):
  - 幹の縦線は `connector--a` の `border-right` と `connector--b` の
    `border-left` が隣接して描かれるため、実質 4px 幅になる(横線は 2px)。
    8倍拡大で見ると幹がやや太いが、1倍の実表示では「1本の幹」として
    自然に読める範囲であり、むしろ幹と枝の主従が分かりやすい
  - サイドパネルを最大幅(ビューポートの90%)まで広げると枝ボックスが
    非常に横長になり、接続線の横棒もその分長くなる。座標の一致は
    保たれておりレイアウトも崩れないが、Y字というより幅広の「T字」に
    見える。これは枝ボックスの中心を正しく指している結果であり、
    現状の仕様どおりの挙動
- 差し戻し: なし
