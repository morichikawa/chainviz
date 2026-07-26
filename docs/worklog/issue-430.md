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
