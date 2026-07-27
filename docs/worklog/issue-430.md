# Issue #430 ロングレンジ攻撃デモの入口を「学習用の砂場」メニューに統合する

### 2026-07-26 Issue #430 実装メモ・実装内容

- 担当: frontend
- ブランチ: issue-430-unify-demo-menu

#### 経緯（Issue本文の要約）

Issue #414（51%攻撃）はチェーンリボンカードの入口を`<details>`/`<summary>`
による単一メニュー「学習用の砂場」に統合する設計で実装された。一方
Issue #415（ロングレンジ攻撃）は#414のマージ前に並行して開発が進んでいた
ため、独自の専用行（`chain-ribbon-card__attack-demo-row`、「攻撃を学ぶ」
ラベル + 「ロングレンジ攻撃を体験する」ボタン）という別設計のまま実装
された。マージ時（統括作業）にこの食い違いを認識しつつも、テストの整合性
を優先して「両方が別々のUI要素として共存する」形で解消したが、ユーザー
からこの不統一が分かりにくいとの指摘を受けた。

#### 設計メモ（着手前）

現状のコードを確認したところ、既存の設計判断（Issue #414のUX設計・
#415のUX設計 §6）自体に矛盾は無く、単に2つのIssueが同じUI領域に対して
別々の結論を出したまま両方実装されてしまった状態だった。今回は新規の
設計判断を要する変更ではなく、既存の2つの入口実装を1つの構造へ統合する
リファクタリングとして扱う。方針:

- ロングレンジ攻撃デモのボタンを、`chain-ribbon-card__demo-menu-item`と
  同じクラス・同じ`onClick`パターン（`sidePanel?.open(...)` →
  `closeDemoMenu()`）でメニュー内に追加する。他の2項目（ハッシュの
  しくみ・51%攻撃）と挙動を完全に揃える
- 専用行（`chain-ribbon-card__attack-demo-row`とその中の
  `chain-ribbon-card__attack-demo-label`・
  `chain-ribbon-card__long-range-demo-open`）は削除する
- `data-testid="chain-ribbon-long-range-demo-open"`は変更しない
  （既存のe2e/ユニットテストとの互換性を保つため。今回は「どこに
  置かれているか」が変わるだけで、ボタン自体のtestid・文言・クリック時の
  挙動は変えない）
- `ChainRibbonPopover.tsx`側の文脈導線（タイルホバー時のポップオーバー内
  ボタン）は今回のIssueのスコープ外。専用行と違って幅の制約が無い縦積み
  レイアウトであり、Issue #415のUX設計 §6でも「ハッシュのしくみデモと
  同じ文脈導線パターン」として意図的に独立させている。クラス名
  （`chain-ribbon-popover__long-range-demo-open`）も
  `chain-ribbon-card__long-range-demo-open`とは別名のため、専用行削除の
  影響を受けない
- `chainRibbon.attackDemoRowLabel`というi18nキーは専用行の削除に伴って
  完全に不要になるため削除する（他に参照箇所が無いことを確認済み）
- `packages/e2e/SCENARIOS.md`を確認したところ、51%攻撃・ロングレンジ
  攻撃デモの操作フローを扱うE2Eシナリオはまだ存在しない（ハッシュの
  しくみデモ（UI-HASH-01）のみ）。そのため今回のIssueでE2E仕様書・spec
  ファイルの更新は発生しない
- `packages/shared`の型変更は不要

#### 実装内容

- `packages/frontend/src/entities/ChainRibbonCard.tsx`: メニュー内の
  51%攻撃ボタンの直後に、ロングレンジ攻撃デモを開く3つ目のボタンを追加
  （`sidePanel?.open({ kind: "longRangeAttackDemo" })` →
  `closeDemoMenu()`、testidは既存のまま）。直後にあった専用行
  （`chain-ribbon-card__attack-demo-row`とその中身）を削除
- `packages/frontend/src/styles.css`: 専用行のCSSクラス
  （`.chain-ribbon-card__attack-demo-row`・
  `.chain-ribbon-card__attack-demo-label`・カード側の
  `.chain-ribbon-card__long-range-demo-open`）を削除。ポップオーバー側の
  `.chain-ribbon-popover__long-range-demo-open`は別クラスでまだ使われて
  いるため残した
- `packages/frontend/src/i18n/messages.ts`: 未使用になった
  `chainRibbon.attackDemoRowLabel`キーを削除
- 既存テストの更新:
  - `ChainRibbonCard.longRangeDemoEntry.test.tsx`: メニューを開いてから
    ボタンをクリックする構成に書き換え（`ChainRibbonCard.attack51DemoEntry
    .test.tsx`と同じパターン）。3つの入口が独立して開閉できることを確認
    するケースを追加
  - `ChainRibbonCard.demoMenu.test.tsx`: メニューを開いたときの一覧確認・
    メニューを閉じる確認にロングレンジ攻撃の入口を追加
  - `ChainRibbonCard.demoMenu.structure.test.tsx`: 「両方の入口」を
    前提にしていた構造テスト（`<details>`内に含まれること・`nodrag`が
    効いていること・並び順）を「3つの入口」に拡張
  - `messages.longRangeDemo.test.ts`: 削除したi18nキー用のdescribeブロック
    を削除

#### 実機確認

`VITE_COLLECTOR_URL`未設定（モックデータ）で`pnpm --filter
@chainviz/frontend dev`を起動し、Playwright（`packages/e2e`の
`@playwright/test`を利用。ホストのChromiumが共有ライブラリ不足で起動
できなかったため、既存セッションが展開済みだった依存ライブラリ
（`/home/zoe/chrome-deps/root/...`）を`LD_LIBRARY_PATH`に指定して起動）
で確認した。

- 「学習用の砂場」メニューを開くと、ハッシュのしくみを試す・51%攻撃の
  しくみを試す・ロングレンジ攻撃を体験する、の3項目が縦に並ぶ
- 専用行（旧`chain-ribbon-card__attack-demo-row`）は画面上に存在しない
  （`document.querySelector`で不在を確認）
- メニューからロングレンジ攻撃の項目をクリックすると、サイドパネルに
  「ロングレンジ攻撃のしくみ」が正しく開く

#### テスト・ビルド

`pnpm lint && pnpm build && pnpm test`をリポジトリルートで実行し、
全パッケージ（shared/collector/frontend/e2e）で成功することを確認した
（frontend: 312ファイル3932ケース）。

### 2026-07-26 Issue #430 テスト強化

- 担当: tester
- ブランチ: issue-430-unify-demo-menu

#### 既存テストの棚卸し

実装担当が更新した4ファイル（`ChainRibbonCard.demoMenu.test.tsx`・
`.demoMenu.structure.test.tsx`・`.longRangeDemoEntry.test.tsx`・
`messages.longRangeDemo.test.ts`）を読み、以下が未カバーだった。

- 3項目それぞれの「ラベル」と「開くサイドパネルのkind」の対応付けが、
  項目ごとに別々のファイルで確認されているだけで、横並びの表として
  突き合わせられていない。#430はボタンを別の場所から移設した変更なので、
  移設先で`sidePanel.open`の引数が隣の項目とずれても（testidと文言は
  そのままなので）既存テストの組み合わせでは見つけにくい
- メニューを開いた状態で項目をクリックしたあとメニューが閉じることは、
  ハッシュ（`.hashDemoEntry`）・51%（`.demoMenu`）・ロングレンジ
  （`.demoMenu`・`.longRangeDemoEntry`）とファイルが散っており、
  「3項目とも同じ挙動である」という形では固定されていない
- 砂場を続けて切り替えたときに前の`kind`が残らないことは、
  ハッシュ→51%の1方向しか見ていない
- キーボード操作は「本物の`<button>`である」ところまでで、実際にTabで
  フォーカスが移ること・Enter/Spaceで起動できることは見ていない
- 削除した専用行のCSSクラス・i18nキーが消えていることを機械的に
  確かめる手段が無い（消し忘れはlintでもビルドでも検出されない）
- タイルが0件のときしかメニューを操作していない

#### 追加したテスト（3ファイル47ケース）

- `ChainRibbonCard.demoMenu.entryRouting.test.tsx`（21ケース）:
  3項目を1つの表（testid・kind・ja/enラベル）にまとめ、
  - メニュー内のボタンが表と完全に一致すること（並び順込み。項目の
    追加・改名にテストが追随していない状態を検出する）
  - 各項目がラベルどおりのkindを開き、かつメニューが閉じること
  - 3項目を順に押したとき観測されるkindが3種類とも異なること
    （隣の項目のkindをコピペした事故の検出）
  - 6通りの順序対すべてで砂場を切り替えても前のkindが残らないこと
  - タイル0件・1件・12件のいずれでも正しく動き、カード側の入口が
    それぞれ1つだけであること（境界値。専用行の復活で二重になれば落ちる）
  - `SidePanelProvider`が無い状態でも例外にならず、かつメニューは
    閉じること（`sidePanel?.open()`の後の`closeDemoMenu()`まで到達
    していることの確認。3項目とも）
  - 英語UIでも英語ラベルとkindの対応が保たれること
- `ChainRibbonCard.demoMenu.keyboard.test.tsx`（13ケース）:
  `@testing-library/user-event`で実際にTab・Enter・Spaceを送り、
  - summaryがフォーカス可能であること
  - Tabが3項目を並び順どおりに移動し、最後の項目の次でメニューの外へ
    抜けること（フォーカストラップが無いこと）
  - 3項目とも`disabled`・`tabindex="-1"`・`aria-hidden`でタブ順から
    外れていないこと
  - 3項目ともEnter・Spaceで起動でき、起動後にメニューが閉じること
  - キーボードだけでメニューを2周操作できること（`details.open`を
    ref経由で直接書き換えているため、2周目に開き直せるかを確認）
- `ChainRibbonCard.demoMenu.legacyRowRemoval.test.tsx`（13ケース）:
  削除した専用行の痕跡をDOM・CSS・i18nの3層で確認する。
  - 専用行の3クラスがDOMに現れないこと、ロングレンジの入口が1つだけで
    メニュー内にあり他2項目と同じクラスを持つこと、カード直下の行構成が
    header/subtitle-row/本文だけであること
  - `styles.css`から3クラスのルールが消えていること、逆に
    `.chain-ribbon-card__demo-menu-item`と
    `.chain-ribbon-popover__long-range-demo-open`は残っていること
  - `messages.ts`に`chainRibbon.attackDemoRowLabel`が無いこと、
    `longRangeDemo.open`（メニューとポップオーバーの共用）は残っていること

#### 検出力の確認（ミューテーション）

意図的に実装を壊し、追加したテストが実際に落ちることを確認してから
元に戻した。

1. ロングレンジの`onClick`のkindを`fiftyOnePercentAttackDemo`に変更
   → 15ケース失敗（うち新規11）
2. ロングレンジの`onClick`から`closeDemoMenu()`を削除 → 9ケース失敗
3. 専用行を復活（メニュー外にボタンを再追加）→ 6ケース失敗。同じ
   testidも付けた場合は28ケース失敗
4. `styles.css`に専用行のルールを復活・`messages.ts`にi18nキーを復活・
   ロングレンジのボタンに`tabIndex={-1}`を付与 → 5ケース失敗

なお、CSSクラスの残存確認は最初`toContain`で書いたところ
`.chain-ribbon-card__demo-menu-item`を`…-itemX`にリネームしても
部分一致で通ってしまったため、単語境界付きの正規表現に直した
（この改善自体もミューテーションで確認済み）。

#### 横断確認・所見

- 削除されたクラス（`chain-ribbon-card__attack-demo-row`・
  `chain-ribbon-card__attack-demo-label`・
  `chain-ribbon-card__long-range-demo-open`）とi18nキー
  （`chainRibbon.attackDemoRowLabel`）をリポジトリ全体にgrepし、
  `packages/`配下（`ChainRibbonPopover.tsx`を含む）・`glossary/`・
  `packages/e2e`のいずれにも参照が残っていないことを確認した。
  ヒットするのは`docs/WORKLOG.md`と`docs/worklog/issue-415.md`・
  `issue-430.md`の経緯の記述のみ（履歴なのでそのままでよい）
- 実装のバグは見つからなかった。`SidePanelProvider`不在時にメニューが
  閉じないのではないかという懸念も、実際に確認したところ問題なかった
- jsdomの制約として、`<summary>`にEnter/Spaceを送っても`<details>`は
  開閉しない（ネイティブのactivation behaviorが未実装）。また閉じた
  `<details>`の中身もレイアウトが無いためTabで到達できてしまう。
  そのため「summary自体のキーボード開閉」「閉じている間は到達しない」は
  ユニットテストでは固定できず、キーボードテストのファイル冒頭に
  その旨をコメントで明記した（実ブラウザ側の挙動であり、
  `<details>`/`<summary>`を使っていること自体は
  `.demoMenu.structure.test.tsx`が固定している）
- 新しいテストは`@testing-library/user-event`を初めて使う（依存には
  既に入っていたが`packages/frontend/src`での利用例は無かった）。
  `userEvent.tab()`は`<summary>`をタブ順に含めないため、Tabの検証は
  「3項目の相対的な順序」で行っている（絶対的なタブ順を固定すると
  この環境依存の挙動を仕様として固めてしまうため）

#### テスト・ビルド

`pnpm lint && pnpm build && pnpm test`をリポジトリルートで実行し、
全パッケージで成功することを確認した（frontend: 315ファイル3979ケース。
テスト強化前は312ファイル3932ケース）。

### 2026-07-26 Issue #430 レビュー

- 担当: reviewer
- 対象コミット: `e243706`（`origin/issue-430-unify-demo-menu` の先頭。
  `main..HEAD` で8コミット）

#### 確認した観点と結果

- **境界の遵守**: 変更は `packages/frontend` の UI のみ。Docker/ノードAPI
  への直接アクセスや、`eth_getLogs` 等チェーン固有語彙の混入は無い
- **チェーンプロファイルの独立性**: 本Issueはチェーンプロファイルに関わる
  変更を含まない（UIの入口統合のみ）ため該当なし
- **`packages/shared` の型整合**: `packages/shared` への変更は無い
  （設計メモどおり）。ビルドへの影響なし
- **`ChainRibbonPopover.tsx`の文脈導線クラス
  (`chain-ribbon-popover__long-range-demo-open`)**: `git diff main..HEAD --
  packages/frontend/src/entities/ChainRibbonPopover.tsx` で差分ゼロを確認。
  `styles.css`・`ChainRibbonPopover.tsx`双方にクラスが残っており、削除の
  巻き込みは無い。実装担当の判断（対象外・維持）は妥当
- **削除物の痕跡**: `chain-ribbon-card__attack-demo-row` /
  `__attack-demo-label` / `__long-range-demo-open`（カード側）と
  `chainRibbon.attackDemoRowLabel` を `packages/` 全体・`docs/`（worklogの
  経緯記述を除く）にgrepし、他に参照が残っていないことを確認
- **ビルド・lint・テスト**: リポジトリルートで
  `pnpm lint && pnpm build && pnpm test` を実行し、全パッケージ
  （shared/collector/frontend/e2e）が成功することを確認
  （frontend: 315ファイル3979ケース、他パッケージも全件成功）
- **テストコードの質**: 追加された3ファイル（`entryRouting`・
  `keyboard`・`legacyRowRemoval`）を読んだ。表形式で3項目のラベル・
  kindを突き合わせて取り違えを検出する設計、6通りの切替順序、タイル
  0/1/12件の境界値、`SidePanelProvider`不在時の異常系、jsdomの
  `<details>`activation behavior未実装という制約を回避しつつキーボード
  到達性・起動を実機同等に確認する設計、CSS/i18nの消し忘れを単語境界付き
  正規表現で検出する設計など、いずれも実装の詳細をなぞるだけの空虚な
  テストではなく、意図的な破壊（ミューテーション）で検出できることを
  worklogに残したうえで書かれている。既存テストの更新も含め、無意味な
  テストは見当たらなかった
- **エラーの握りつぶし**: 新規・変更コードに catch 節や汎用エラー
  メッセージへのすり替えは無い（純粋なUI移設のため該当箇所自体が無い）
- **現在の環境状態への依存**: タイムアウト・件数上限等の決め打ち定数は
  本変更に含まれない
- **docsとの齟齬**: `docs/ARCHITECTURE.md`・`docs/CONCEPT.md`に
  `chain-ribbon-card__attack-demo-row`等への直接言及は無く、齟齬は生じて
  いない。`docs/PLAN.md`・`docs/WORKLOG.md`への追記も内容と一致
- **コミットの粒度**: `main..HEAD`の8コミットを確認。実装1コミット
  （プロダクションコード変更＋その変更に伴う既存テストの更新をまとめて
  1つ、これは同じ関心事のため妥当）、テスト強化3コミット（ファイルごとに
  分離）、docs更新3コミット（作業記録追加・PLAN.mdチェック更新・テスト
  強化記録追記）で、異なる関心事が1コミットに混在している箇所は無かった

#### Issue本文の完了条件との照合

- チェーンリボンカードに「学習用の砂場」メニューが1つだけあり、ハッシュの
  しくみ・51%攻撃・ロングレンジ攻撃の3項目が入っている → 確認済み
  （`ChainRibbonCard.tsx`の差分、`demoMenu.entryRouting.test.tsx`等のテスト）
- 専用行が無くなっている → 確認済み（`chain-ribbon-card__attack-demo-row`
  のDOM/CSS/i18nすべてからの削除をテストで固定）
- 既存の各デモの動作にデグレが無い → 確認済み（既存テストの更新版が全件
  成功、`ChainRibbonPopover.tsx`側は無変更）

#### 判定

合格。修正指示なし。実装担当への差し戻しは無い。

`chainviz-qa`による実機検証に進めることを推奨する。

### 2026-07-27 Issue #430 QA検証

- 担当: qa
- 対象コミット: `57b3828`（`origin/issue-430-unify-demo-menu` の先頭）

#### 検証環境

`profiles/ethereum` のDockerスタック（reth1/reth2・beacon1/beacon2・
validator1/validator2・workbench）が稼働している状態で、対象ブランチを
チェックアウトした作業ツリーで `pnpm install` → `pnpm build` を実行し、
collector（WebSocket 4300 / ロギングプロキシ 4301）と frontend の vite dev
サーバー（5373、`VITE_COLLECTOR_URL=ws://127.0.0.1:4300`）を起動した。
モックデータではなく実チェーンに接続した状態で、Playwright の Chromium
から実際にブラウザ操作して確認した。チェーンが進行していることは
`eth_blockNumber` のポーリングと、画面上のチェーンリボンのブロック番号が
#48 → #63 → #71 と増えていくことで確認した。

#### 確認内容と結果

1. 「学習用の砂場」メニューの内容（日本語UI）

   - チェーンリボンカードの `summary` は1つだけで、文言は「学習用の砂場」
   - 開くと `.chain-ribbon-card__demo-menu-item` が3つ並び、上から
     「ハッシュのしくみを試す」（`chain-ribbon-hash-demo-open`）・
     「51%攻撃のしくみを試す」（`chain-ribbon-fifty-one-percent-demo-open`）・
     「ロングレンジ攻撃を体験する」（`chain-ribbon-long-range-demo-open`）
     の順で、想定どおりの文言・順序だった

2. 旧「攻撃を学ぶ」専用行の不在

   - 実ブラウザのDOM上で
     `.chain-ribbon-card__attack-demo-row` ・
     `.chain-ribbon-card__attack-demo-label` ・
     `.chain-ribbon-card__long-range-demo-open` の3クラスがいずれも
     0件であることを確認した
   - メニューを閉じた状態のカードのスクリーンショットでも、
     「攻撃を学ぶ」のラベル行は表示されていなかった

3. 3項目のクリックで開くサイドパネル（取り違えの有無）と、メニューが
   閉じること

   各項目について「メニューを開く → クリック → サイドパネルの
   `aria-label` と `<details>` の `open` を読む」を実施した。日本語UIでの
   結果は次のとおりで、いずれもラベルどおりのデモが開き、クリック直後に
   メニューは閉じていた（`open` が `true` から `false` に変化）。

   - ハッシュのしくみを試す → 「ハッシュのしくみ」
   - 51%攻撃のしくみを試す → 「51%攻撃のしくみ」
   - ロングレンジ攻撃を体験する → 「ロングレンジ攻撃のしくみ」

   ロングレンジ攻撃のパネルは、正規のチェーンと攻撃者の履歴の2本の行・
   finality のスライダー・判定メッセージが正しく描画されていた。

4. 英語UI

   ヘッダーの言語切り替えで英語に変えたうえで同じ手順を繰り返した。
   `summary` は "Learning sandboxes"、項目は上から
   "Try how hashes work" ・ "Try how a 51% attack works" ・
   "Try a long-range attack" の3つで、それぞれ
   "How hashes chain blocks" ・ "How a 51% attack works" ・
   "How long-range attacks work" のパネルが開き、いずれもクリック後に
   メニューが閉じた。

5. `ChainRibbonPopover` の文脈導線のデグレ確認

   チェーンリボンのタイルにホバーしてポップオーバーを表示し、
   「ブロック詳細を見る」「ハッシュのしくみを試す」「ロングレンジ攻撃を
   体験する」の3つの導線と「関連する用語: ロングレンジ攻撃」のヒント行が
   従来どおり表示されることを確認した。ポップオーバー側の
   `.chain-ribbon-popover__long-range-demo-open` は1件存在し、クリックで
   「ロングレンジ攻撃のしくみ」パネルが開いた。専用行の削除に巻き込まれた
   デグレは無い。

6. 実ブラウザでのキーボード操作（ユニットテストではjsdomの制約で
   固定できなかった部分）

   `summary` にフォーカスして Enter を押すとメニューが開き、そこから Tab を
   3回押すと ハッシュ → 51%攻撃 → ロングレンジ攻撃 の順にフォーカスが移り、
   3つ目で Enter を押すと「ロングレンジ攻撃のしくみ」が開いてメニューが
   閉じた。閉じたあと `summary` をもう一度クリックすれば開き直せることも
   確認した。テスト強化担当がjsdomでは固定できないと記録していた
   「`summary` 自体のキーボード開閉」は、実ブラウザでは期待どおり動作する。

なお、操作中にブラウザコンソールへのエラー出力・未捕捉例外は
一度も発生しなかった。

#### 参考情報（本Issueの不具合ではない）

メニューを開いたままキャンバスの別の場所をクリックしても、メニューは
開いたままになる（`<details>` の標準挙動で、外側クリックで閉じる処理は
実装されていない）。これは Issue #414 でメニューを導入した時点からの
挙動であり、#430 の変更によるものではないため今回は不合格の理由と
しない。気になる場合は別Issueとして扱うのがよい。

#### 判定

合格。Issue #430 の完了条件（砂場メニューに3項目が正しい順序・文言で
並ぶ／専用行が無くなっている／各項目が対応するデモを開きメニューが
閉じる／英語UIでも同様／ポップオーバー側の導線にデグレが無い）は
すべて満たしている。差し戻しは無い。

`docs/PLAN.md` の該当チェックボックスは実装時に既にチェック済みで、
QA向けの独立した項目は無いため追加の更新は行っていない。
