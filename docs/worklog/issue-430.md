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
