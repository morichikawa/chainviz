# Issue #415 ロングレンジ攻撃のシミュレーション砂場を実装する

### 2026-07-25 Issue #415 UX設計メモ

- 担当: ux
- ブランチ: issue-415-long-range-attack-demo
- 前提: Issue #412 の設計フェーズ（`docs/ARCHITECTURE.md` §17、
  `docs/worklog/issue-412.md`）で概念モデル・判定ロジックの原則・視覚的
  結びつきの方針までは決定済み。本メモはその続きとして、具体的な図解
  レイアウト・操作フロー・文言・入口導線を実装着手できる粒度まで詰めた
  もの。実装コードは書いていない。

#### 1. 実機確認（モックデータ環境）

`pnpm --filter @chainviz/frontend dev`（`VITE_COLLECTOR_URL` 未設定、
モックデータ）を起動し、Playwright（`@playwright/test`。本リポジトリの
`packages/e2e` の依存を利用。ブラウザ実行にホストの共有ライブラリが
無かったため `mcr.microsoft.com/playwright` の Docker イメージ上で
`--network host` として実行し、既存の Issue #401「ハッシュのしくみ」
デモを実際に開いて確認した。確認できたこと:

- チェーンリボンカードの subtitle-row は、現状「新しいブロックが刻々と
  刻まれています」という比較的長い説明文 + 「ハッシュのしくみを見る」
  ボタン1つで、既にほぼ余白なく収まっている（デフォルト幅のカードで
  確認）。ここへボタンをもう1つ機械的に追加すると折り返し・はみ出しの
  リスクが高いことを実物で確認した（設計担当の懸念は実機でも裏付けられた）
- `HashChainDemoView` はサイドパネル内に3ブロックを**縦**に積んだカード
  （番号・親ハッシュ・データ入力欄 → 処理帯 → 導出ハッシュ → 有効/無効
  バッジ）で構成されており、1ブロックがパネル幅（既定420px）をほぼ
  使い切るサイズになっている。この「フル情報カード」をそのまま2列×
  複数ブロックの横並びレイアウトに転用すると、サイドパネルの幅（最小
  300px）に収まらないことを実測ベースで確認した → 今回の「並走する2本の
  履歴」は、HashChainBlockRow ではなくチェーンリボンの**コンパクトタイル**
  （`chain-ribbon-tile`。番号+短縮ハッシュのみ、最小幅62px）に準じた
  表現を採用する（§17.5.2 が両方を候補に挙げていたうち、幅制約から
  こちらを選ぶ）
- ChainRibbonPopover は既に「ブロック詳細を見る」「ハッシュのしくみを
  見る」の2ボタンを縦に積んでおり、ここへ3つ目のボタンを積むこと自体は
  横並びの subtitle-row と違って幅の問題にならない（縦積みなので）

#### 2. 疑似データ・概念モデルの具体化

`docs/ARCHITECTURE.md` §17.5.2 の「各3〜4ブロック程度」を踏まえ、以下に
確定する:

- **正規のチェーン**（canonical）: genesis を含め4ブロック。
  `#0`(genesis) → `#1` → `#2` → `#3`
- **攻撃者が作り直した履歴**（attacker）: `#0`・`#1` は正規チェーンと
  **完全に同一**（同じ `data`・同じ導出ハッシュ）。`#2` から内容が異なり、
  `#4` まで1ブロック余分に伸びる（5ブロック）。**攻撃者側が常に1ブロック
  長く見える**、という §17.5.2 の「一瞬で正規チェーンより長く/新しく
  見せかけられる」を疑似データの時点で体現する
- **分岐点（divergeIndex）= `#2`**: 攻撃者の履歴が正規チェーンと最初に
  異なるブロック番号。genesis そのものではなくあえて `#2` にした理由:
  分岐点を genesis 固定にすると「checkpoint が genesis より後かどうか」の
  二択（0 か非0か）しか体験できず、finality checkpoint を動かす操作の
  面白みが薄い。分岐点を genesis より後ろに置くことで、checkpoint の
  位置に応じて「まだ守られていない」「もう守られている」を複数段階で
  行き来でき、他の2砂場（51%攻撃のスライダー、eclipse攻撃の占有率）と
  同程度の「動かして体感する」インタラクション密度になる
- ハッシュは疑似データではあるが、Issue #401 と同じ簡略レシピ
  （`${番号}|${親ハッシュ(記録値)}|${データ}` を keccak256）で実際に
  計算する。理由: §17.5.2 の「本物の判定ロジックの原則」が要求している
  のはあくまで**分岐点と checkpoint を比較する採用可否ロジック**の実計算
  であり、ブロックハッシュ自体の実計算は必須ではない。しかし
  `crypto-demo/keccak256.ts`（`@noble/hashes` の薄いラッパー）は既に
  存在し呼び出すだけで済むため、追加コストがほぼゼロで「本物のブロック
  タイルらしさ」を強められる。やらない理由がないので推奨する（詳細は
  §7「決めきれていない点」）
- **物語性**: 正規チェーンは Issue #401 と同じ送金風の例文
  （Alice→Bob 等）、攻撃者側は分岐後を「なぜ書き換えたいのか」が伝わる
  文言にする（自分に残高を付け替える → 換金する、という筋）。攻撃の
  動機まで示すことで、「ハッシュの整合性が保たれていれば安全」という
  誤解（Issue #401 は改ざん検知の話で終わっており、動機の話が無い）を
  補い、「なぜ finality が要るのか」の実感につなげる

#### 3. 図解レイアウト

サイドパネル内、上から:

1. 導入文（`longRangeDemo.intro`）
2. **正規/攻撃者の2行タイル + finality checkpoint 選択チップ**を
   まとめた1つの領域（`longRangeDemo.diagram`）:
   - 上段: 「正規のチェーン」ラベル + タイル4枚（`#0`〜`#3`）を横一列
   - 中段: finality checkpoint の選択チップ列（`#0`〜`#3`、正規チェーンの
     列数と揃える。LayerFilterBar と同じ「チップ+`aria-pressed`」
     パターンを再利用）。見出し「確定(finality)はどこまで進んでいます
     か？」
   - 下段: 「攻撃者が作り直した履歴」ラベル + タイル5枚（`#0`〜`#4`）
   - **3段は同じ列位置（同じブロック番号は同じ列）に揃える**。正規の
     `#2` の真下に checkpoint の `#2` チップ、その真下に攻撃者の `#2` が
     来るようにし、「finality をどこまで進めるかによって、どのブロックの
     対立が防がれるか」を位置関係だけで直感的に示す。設計担当が候補に
     挙げていた「縦線または錠前アイコン」は、幅がリサイズ・スクロールで
     変わるサイドパネル内では絶対配置の線が壊れやすいため**採らない**。
     代わりに列を揃えた3段のグリッド（推奨: 共通の
     `grid-template-columns` を持つ1つのグリッドコンテナに3段を並べ、
     列数はブロック数の多い方＝5に揃える。正規チェーンの列は4つしか
     使わないので5列目は空になる）で位置関係を表現し、ヨコ幅が収まら
     ない場合はグリッド全体を1つの `overflow-x: auto` コンテナで
     まとめて横スクロールさせる（チェーンリボン本体の
     `.chain-ribbon-card__row` と同じ「はみ出したら横スクロール」の
     既存パターンを踏襲。3段を別々のスクロール領域にすると列がずれる
     ため、必ず1つの共有コンテナ・同期スクロールにする）
   - タイルの見た目は `.chain-ribbon-tile`（番号+短縮ハッシュ、最小幅
     62px、グラデーション背景）に準じたクラスを新設して再利用する
     （コンポーネント自体はホバー状態を持つ chain-ribbon 専用のものと
     結合しないよう、新規の軽量な提示専用コンポーネントにする）
   - 正規チェーンのタイルのうち、**checkpoint 位置以下（番号が
     checkpoint 以下）は「確定済み」の視覚（緑系。既存の `--synced` を
     使い、hashDemo の有効バッジと同系統の色）**を付ける。それより先は
     無印（まだ確定していない、というニュートラルな状態）
   - 攻撃者チェーンのタイルのうち、`#0`・`#1`（正規と共有）は無印、
     `#2`〜`#4`（分岐後）は既存のフォーク色パレット（§9.3の
     `--fork-color-a`。オレンジ系）で縁取る。**hashDemo の「無効」＝赤とは
     意図的に色を分ける**: この砂場では攻撃者側のハッシュ連結自体は
     内部的には矛盾なく繋がっており(=ハッシュ的には「無効」ではない)、
     問題は「どちらを正史として採用するか」という別の軸なので、
     hashDemo の invalid（赤）の語彙を流用すると誤解を招く
   - 攻撃者チェーンの `#1`→`#2` の連結線だけ、既存の
     `chain-ribbon-card__link--broken`（破線）相当のスタイルにし、
     「ここで枝分かれした」ことを線so示す。その他の連結線（`#0`→`#1`
     の共有区間、`#2`→`#3`→`#4` の攻撃者内部）はすべて実線（＝ハッシュの
     連結自体は途切れていない）
   - タイルの `#2` が正規・攻撃者の両方に存在し中身が違う点を見落とさ
     れないよう、攻撃者側 `#2` タイルの直下に小さな注記
     （`longRangeDemo.rivalNote`「同じ番号でも中身が違う、ライバルの
     ブロックです」）を1つだけ添える
3. **判定結果バナー**（`longRangeDemo.verdict`）: 2行構成
   - 1行目（常に同じ・警告色）: 「単純な『長い方を正しいとする』ルール
     なら」＋「攻撃者の履歴（`#4`まで）が採用されてしまいます」
   - 2行目（checkpoint 位置に応じて動的に切り替わる）: 「確定(finality)を
     考慮すると」＋ checkpoint が分岐点(`#2`)以上なら緑バッジ「正規の
     チェーンを維持できます」、未満なら赤バッジ「まだ `#2` が確定して
     いないため、この攻撃を防げません」
   - この2行の対比自体が「素朴な最長ルールだけでは見分けが付かない」
     （常に1行目で騙される）「finality を考慮すれば守れる場合がある」
     （2行目が checkpoint 次第で変わる）という §17.5.2 の核心を体験させる
4. リセットボタン（`longRangeDemo.reset`。checkpoint を初期値 `0` へ戻す。
   ブロックの中身自体はユーザーが編集する対象ではないため、hashDemo の
   ような「全ブロックの状態」ではなく checkpoint 1つを戻すだけで足りる）
5. フッター注記2本（`longRangeDemo.whoDecides` / `longRangeDemo.
   simplifiedNote`。書式は既存2砂場の `whoComputes` / `simplifiedNote` を
   踏襲）

#### 4. 操作フロー

1. 開いた直後: checkpoint は初期値 `0`（genesis のみ確定済み）。判定
   バナーの2行目も「まだ防げません」（赤）の状態から始まる。**「動かして
   直す」のではなく「まず問題が起きている状態を見せてから、finality を
   進めることで防げることに気づかせる」**という導入（hashDemo の
   「まず壊れていない→壊す→直す」の順とは逆で、こちらは「まず既に
   危険な状態→確定を進めて安全にする」という順）
2. ユーザーが checkpoint チップ（`#0`〜`#3`）をクリックして
   finality checkpoint を動かす。動かすたびに:
   - 正規チェーン側のタイルの「確定済み」表示が checkpoint 位置まで
     追従する
   - 判定バナーの2行目（動的な方）が実際に再計算されて切り替わる
     （`#0`・`#1` を選ぶと赤のまま、`#2`・`#3` を選ぶと緑に変わる）
3. リセットボタンで checkpoint を `0` に戻し、最初の状態から何度でも
   試せる
4. フッターで「実際のチェーンではバリデーターの投票(attestation)の
   積み重ねで確定が進む」「これは簡略化したモデルである」ことを説明し、
   締める

#### 5. 判定ロジック（実装への申し送り。純粋関数として実装する）

```ts
// 疑似データの分岐点（固定値。ユーザーは動かせない）
const DIVERGE_AT = 2;

// 常に「長い方を正しいとする」だけの素朴なルール。今回の疑似データでは
// 攻撃者の履歴(5ブロック)が正規(4ブロック)より常に長いため、常に
// attacker を返す“実際に比較計算する関数”として実装する(演出の固定
// テキストにしない。将来ブロック数を変えても壊れないように、決め打ち
// せず両チェーンの長さを比較する)。
function pickByNaiveLongestChainRule(
  canonicalLength: number,
  attackerLength: number,
): "canonical" | "attacker" {
  return attackerLength >= canonicalLength ? "attacker" : "canonical";
}

// finality を考慮したルール。checkpoint が分岐点以上まで進んでいれば
// 正規チェーンを維持する。
function pickByFinalityAwareRule(
  checkpointIndex: number,
  divergeAtIndex: number,
): "canonical" | "attacker" {
  return checkpointIndex >= divergeAtIndex ? "canonical" : "attacker";
}
```

- `checkpointIndex` は state（初期値 `0`）、`divergeAtIndex` は固定の
  疑似データ定数。どちらも `packages/shared` 型に影響しない（フロント
  内部の砂場 state）
- ブロック本体（正規4件・攻撃者5件、ハッシュ含む）は起動時に一度だけ
  導出して固定し、以後ユーザー操作では変わらない（checkpoint だけが
  変わる state）

#### 6. 入口導線（チェーンリボンカードの subtitle-row 混雑問題への回答）

設計担当からの申し送り「subtitle-row に機械的に3つボタンを追加すると
手狭になる。単一入口へ統合するかどうかを含めて判断してほしい」への
回答:

- **ドロップダウン/ドロワーのような新規UI部品は作らない**。今回1個
  しか実装しない砂場のために汎用メニュー機構を先回りして作るのは
  過剰実装（CLAUDE.mdの「先回り実装をしない」に反する）
- 代わりに、**チェーンリボンカードに subtitle-row とは別の新しい行
  （`.chain-ribbon-card__attack-demo-row`）を1本追加**し、subtitle-row
  （hashDemo 用）とは分離する。位置は subtitle-row の直下・タイル行の
  直上
  - この行は「攻撃について学ぶ」系の入口をまとめる**グループ**として
    設計する。今回は中身がボタン1つ（ロングレンジ攻撃）だが、行自体は
    `flex-wrap: wrap` にしておき、将来 #414（51%攻撃）が同種の入口を
    必要とした場合はこの行にボタンを1つ追加するだけで済み、新しい行や
    メニューを増やさずに済む
  - ラベル（小さな見出しテキスト、`chainRibbon.attackDemoRowLabel`）+
    ボタン（`longRangeDemo.open`）の構成。ラベルは「攻撃を学ぶ」/
    "Learn about attacks"
  - 実機確認の結果、既存 subtitle-row は既にほぼ余白なく1ボタン分の
    幅しかない（§1参照）ため、同じ行に押し込むのではなく行を分けるのが
    素直な解決であり、"3つ目のボタンで詰め込みすぎる" 問題を根本から
    回避できる
  - **#414（51%攻撃）のUX設計と並行進行中**であることを踏まえ、この
    判断はロングレンジ攻撃の入口についてのみ確定させる。#414側が
    独自に別の結論（例: InfraPopover 側にのみ置く等）を出した場合は
    この行に何も追加されないだけで矛盾は生じない。#414 側もこの行への
    合流を検討する場合は、chainviz-frontend/chainviz-reviewer が実装
    フェーズで両設計を突き合わせて調整する（Issue #412 設計メモの
    申し送りどおり）
- `ChainRibbonPopover`（タイルホバー時）にも文脈導線として同じボタンを
  追加する（既存の「ブロック詳細を見る」「ハッシュのしくみを見る」の
  下にもう1つ積むだけ。縦積みなので幅の制約は無い）
- 用語集 `longRangeAttack` エントリ（Issue #413で追加予定。§17.4で
  ChainRibbonCard/Popoverへのアンカーが既に指定されている）の定義文
  中でこの砂場に言及する（用語集→パネルの機構的ジャンプは作らない。
  Issue #401/#402 と同じ判断）

#### 7. 用語集との連携

- パネルタイトル・導入文中の「ロングレンジ攻撃」という語を
  `GlossaryTerm termKey="longRangeAttack"` でラップする（Issue #124
  「アンカーの無い用語を作らない」。#413 の用語追加が先にマージされて
  いる前提。依存関係は Issue #415 本文に既に明記済み）
- フッターの「バリデーターの投票(attestation)」部分は既存の
  `attestation` 用語（Issue #402 で追加済み）へアンカーする
  （`withTermAnchor` を使い、文中の当該語だけを差し替える）
- 「確定(finality)」という語のアンカー先: `docs/ARCHITECTURE.md` §17.3
  は `finality` の独立エントリ新設を保留し「実装時の文章量次第で判断」
  としていた。本砂場は checkpoint 見出し・チップ・判定バナーで
  「確定(finality)」を繰り返し使う中心概念のため、**独立エントリの
  新設を推奨する**（`glossary/ethereum/terms/b-network.yaml`、
  `longRangeAttack` の隣接語として）。ただし glossary のスキーマ判断
  自体は chainviz-designer の領分であり、ここでは「UXの観点からは
  欲しい」という要望として申し送るに留める。新設しない場合の代替として、
  checkpoint 見出し・「確定済み」バッジは `longRangeAttack` へフォール
  バックしてアンカーする（無アンカーにはしない）

#### 8. i18n 文言（初稿。`longRangeDemo.*` 名前空間 + チェーンリボン側1件）

- `chainRibbon.attackDemoRowLabel`: ja「攻撃を学ぶ」/ en "Learn about attacks"
- `longRangeDemo.open`: ja「ロングレンジ攻撃を体験する」/
  en "Try a long-range attack"（subtitle 新規行・ポップオーバー両方で使う）
- `longRangeDemo.title`: ja「ロングレンジ攻撃のしくみ」/
  en "How long-range attacks work"
- `longRangeDemo.intro`: ja「ここは学習用の砂場です。実際のチェーンには
  影響しません。同じ genesis から始まっていても、攻撃者は後から別の
  履歴を作り直すことができます。下の2本の履歴を見比べ、『確定(finality)
  をどこまで進めるか』を動かして、どちらの履歴が正しいと判定されるか
  確かめてください。」/ en "This is a learning sandbox. It doesn't affect
  the real chain. Even though both histories start from the same genesis,
  an attacker can later rebuild a different one. Compare the two chains
  below, and try moving how far finality has progressed to see which
  history gets accepted."
- `longRangeDemo.canonicalLabel`: ja「正規のチェーン」/ en "Canonical chain"
- `longRangeDemo.attackerLabel`: ja「攻撃者が作り直した履歴」/
  en "Attacker's rewritten history"
- `longRangeDemo.rivalNote`: ja「同じ番号でも中身が違う、ライバルの
  ブロックです」/ en "Same number, different contents — these blocks are
  rivals"
- `longRangeDemo.checkpointHeading`: ja「確定(finality)はどこまで
  進んでいますか？」/ en "How far has finality progressed?"
- `longRangeDemo.checkpointOption`: ja「#{number}まで確定」/
  en "Finalized through #{number}"（チップのラベル。`format()` で
  `{number}` を差し込む）
- `longRangeDemo.finalizedBadge`: ja「確定済み」/ en "Finalized"
- `longRangeDemo.verdict.naiveHeading`: ja「単純な『長い方を正しいと
  する』ルールなら」/ en "Under a naive 'longest chain wins' rule"
- `longRangeDemo.verdict.naiveResult`: ja「攻撃者の履歴（#{attackerMax}
  まで）が採用されてしまいます」/ en "The attacker's history (through
  #{attackerMax}) would be accepted"
- `longRangeDemo.verdict.finalityHeading`: ja「確定(finality)を考慮すると」
  / en "Once finality is taken into account"
- `longRangeDemo.verdict.protected`: ja「正規のチェーンを維持できます
  （#{divergeAt}はすでに確定済みのため、攻撃者の履歴は拒否されます）」/
  en "The canonical chain holds (#{divergeAt} is already finalized, so
  the attacker's history is rejected)"
- `longRangeDemo.verdict.vulnerable`: ja「まだ#{divergeAt}が確定して
  いないため、この攻撃を防げません」/ en "#{divergeAt} isn't finalized
  yet, so this attack can't be stopped"
- `longRangeDemo.reset`: ja「最初に戻す」/ en "Reset"
- `longRangeDemo.whoDecides`: ja「実際のPoS Ethereumでは、バリデーター
  の投票（attestation）の積み重ねによってブロックが確定します。一度
  確定したブロックより前を書き換える提案は、たとえ長くても採用されま
  せん。」/ en "In real PoS Ethereum, blocks become finalized as validator
  votes (attestations) accumulate. Once a block is finalized, no proposal
  that rewrites anything before it will be accepted, no matter how long
  it is."
- `longRangeDemo.simplifiedNote`: ja「この砂場は考え方を確かめるための
  簡略化したモデルです。実際のfinalityの仕組み（2/3以上の投票、epoch
  単位の確定など）はもっと複雑です。」/ en "This sandbox is a simplified
  model for exploring the idea. Real finality (two-thirds-plus voting,
  epoch-based finalization, etc.) is more involved."
- 英語版はすべて初稿。chainviz-i18n のレビューを受けること

#### 9. 実装への申し送り（モジュール構成の見取り図）

- `packages/frontend/src/attack-demo/longRangeAttackDemo.ts`: 疑似データ
  （正規4ブロック・攻撃者5ブロック）の生成、`checkpointIndex` を持つ
  state、`pickByNaiveLongestChainRule`/`pickByFinalityAwareRule`、
  `createInitialLongRangeAttackDemoState`/`resetLongRangeAttackDemoState`/
  `setCheckpoint`
- `packages/frontend/src/attack-demo/LongRangeAttackDemoView.tsx`: 中身
  本体（`kind: "longRangeAttackDemo"`）
- `packages/frontend/src/attack-demo/LongRangeChainRow.tsx`: 正規/攻撃者
  共通のタイル行描画（1ファイル1責務。`HashChainBlockRow.tsx` が
  `HashChainDemoView.tsx` から分離されているのと同じ切り方）
- ハッシュ導出: `crypto-demo/keccak256.ts` の `keccak256Hex` を
  `attack-demo/` からインポートして再利用することを推奨する（§17.5が
  「crypto-demo とは別フォルダ」としたのはデモの**性質**の分離
  であり、下位の汎用ユーティリティ（keccak256 という汎用暗号
  プリミティブのラッパー）まで複製する意図ではないと判断した）。
  reviewer が「名前空間分離の意図に反する」と判断した場合は、10行
  程度の薄いラッパーを複製するだけで解消できるので大きな手戻りには
  ならない
- `side-panel/sidePanelView.ts`: `{ kind: "longRangeAttackDemo" }` を
  追加（Issue本文どおり。対象データを持たない。ダングリングガード
  対象外）
- `side-panel/SidePanelHost.tsx`: 対応する case を追加
  （`t("longRangeDemo.title")` をタイトルに）
- `entities/ChainRibbonCard.tsx`: `.chain-ribbon-card__attack-demo-row`
  を新設し、ボタンを1つ配置
- `entities/ChainRibbonPopover.tsx`: 既存2ボタンの下にもう1つ追加
- `i18n/messages.ts`: §8の文言を追加
- `glossary/ethereum/terms/b-network.yaml`: （#413が先に対応するが）
  `finality` エントリ新設を推奨する旨をあらためて記載（§7参照）

#### 10. テスト観点（tester への申し送り）

- **境界値**: checkpoint = `divergeAt - 1`（vulnerable）と
  `divergeAt`（protected）の境界で判定が実際に切り替わること
- naive ルールは checkpoint に関わらず常に "attacker" を返すこと
  （固定文言ではなく、関数が実際に両者の長さを比較していることを、
  仮に将来ブロック数が変わっても壊れない形でテストする）
- 共有ブロック（`#0`・`#1`）の導出ハッシュが正規・攻撃者間で完全に
  一致すること（同じ `data` から同じハッシュが出る、という疑似データの
  前提の回帰確認）
- 分岐後のブロック（`#2`〜）は同じ番号でもハッシュが異なること
- reset で checkpoint が初期値へ戻ること
- 新規 i18n キーの ja/en 両方の存在確認（既存の i18n 整合性テストの
  パターンに合わせる）
- 用語アンカー（`longRangeAttack`、`attestation`）が実在すること
  （Issue #124 のアンカー無し用語禁止ルール。ただし `longRangeAttack`
  自体は #413 マージ後でないと glossary データが無いため、このテストは
  #413 マージ後に有効化する前提で書く）
- 入口: subtitle 直下の新設行のボタン・ポップオーバーのボタンが
  それぞれ `sidePanel.open({ kind: "longRangeAttackDemo" })` を呼ぶこと
- a11y: checkpoint チップに `aria-pressed`、キーボード操作（Tab+Enter/
  Space）で選択できること。`SidePanel` の `ariaLabel`/`title` が
  `longRangeDemo.title` と一致すること

#### 11. 決めきれていない点（実装時の裁量・確認事項）

- `finality` の独立 glossary エントリを新設するかどうか（§7参照。UX
  観点では欲しいが、最終判断は designer/実装時に委ねる）
- `crypto-demo/keccak256.ts` の再利用可否（§9参照。reviewer 判断で
  複製に切り替わっても実装コストは小さい）
- `.chain-ribbon-card__attack-demo-row` に #414（51%攻撃）のボタンが
  将来合流するかどうか（§6参照。#414 側のUX設計と独立に進めているため、
  実装フェーズでの突き合わせが必要になる可能性がある）
- 攻撃者側の物語文言（「Attacker → Attacker: 1,000,000 ETH」等）の
  具体的な金額・宛先表記は初稿。実装時に微調整してよい
- 「攻撃者の diverged ブロックが開いた瞬間にふわっと現れる」着地演出
  （既存の `chain-ribbon-tile--landing` keyframes の再利用）は、
  §17.5.2「一瞬で正規チェーンより長く/新しく見せかけられる」の体感を
  強める推奨演出だが、必須要件ではない（実装コストと相談して判断してよい）

### 2026-07-25 Issue #415 実装メモ・実装内容

- 担当: frontend
- ブランチ: issue-415-long-range-attack-demo

#### 設計メモ（着手前）

UX設計（上記）で図解レイアウト・判定ロジック・モジュール構成案が既に
実装粒度まで詰まっていたため、大きな設計判断の追加は無い。実装前に
以下を決めた:

- **共有グリッドは3段まとめて1つの CSS Grid**にする（3つの別々のグリッド
  コンテナを並べる案ではなく）。ブロック番号Nの列を `tileGridColumn(N) =
  2 + 2N`（列1はラベル列、以降2列ずつ「タイル列+コネクタ列」を消費）という
  純粋関数で決め、正規/checkpoint/攻撃者のどの行もこの同じ関数で列を
  決めることで「同じブロック番号は必ず同じ列」という不変条件を構造的に
  保証する。3段の連結線（ブロック間の実線/破線）も、専用のコネクタ列
  （タイル列の直後）に配置することで、列のズレを起こさずに表現できた
- ブロック本体（`CANONICAL_CHAIN`/`ATTACKER_CHAIN`）はユーザーが編集
  できないため、`hashChainDemo.ts` のように `useState` 初期化関数の中で
  毎回導出するのではなく、モジュールスコープの定数として一度だけ導出する
  設計にした（「起動時に一度だけ導出して固定」というUX設計の要求を
  そのまま満たす、より単純な実装）
- `packages/shared` の型変更・collectorの変更は無し（UX設計・
  ARCHITECTURE.md §17.2 の判断どおり）

#### 実装内容

- `packages/frontend/src/attack-demo/longRangeAttackDemo.ts`: 疑似データ
  （`CANONICAL_CHAIN` 4ブロック・`ATTACKER_CHAIN` 5ブロック、`#0`・`#1`は
  同じ文字列から同じハッシュが出ることを利用して共有区間を表現）、
  finality checkpoint の state（`createInitialLongRangeAttackDemoState`/
  `resetLongRangeAttackDemoState`/`setCheckpoint`/`isFinalized`）、2つの
  fork choice ルール（`pickByNaiveLongestChainRule`/
  `pickByFinalityAwareRule`、UX設計 §5 のシグネチャそのまま）、共有
  グリッドの列計算（`tileGridColumn`/`connectorGridColumnAfter`）
- `packages/frontend/src/attack-demo/LongRangeChainRow.tsx`: 正規/攻撃者
  共通のタイル行描画。呼び出し側が指定した `gridRow` のセルだけを埋め、
  グリッド自体は生成しない（グリッドの生成元を1箇所に保つことで列ズレを
  防ぐ）
- `packages/frontend/src/attack-demo/LongRangeAttackDemoView.tsx`:
  パネル本体。導入文 → 共有グリッド（正規行/checkpoint見出し+チップ行/
  攻撃者行）→ 判定バナー（2行）→ リセット → フッター注記2本、という
  UX設計どおりの構成
- `side-panel/sidePanelView.ts` に `{ kind: "longRangeAttackDemo" }` を
  追加、`SidePanelHost.tsx` に対応する case を追加（ダングリングガード
  対象外は `hashChainDemo`/`signatureDemo` と同じ理由）
- `entities/ChainRibbonCard.tsx`: `.chain-ribbon-card__attack-demo-row`
  を新規追加（着手時点で #414 のメニュー化実装はまだ存在しなかったため、
  UX設計どおり専用行として実装した。#414 が後から同種の入口を必要とする
  場合、この行にボタンを1つ追加するだけで済む設計にしてある。§6参照）
- `entities/ChainRibbonPopover.tsx`: 既存の「ハッシュのしくみを試す」
  ボタンの下にもう1つボタンを追加
- `i18n/messages.ts`: `chainRibbon.attackDemoRowLabel` + `longRangeDemo.*`
  をUX設計 §8のとおり追加（英語版は初稿のまま。chainviz-i18n のレビュー
  対象）
- `styles.css`: 共有グリッド・タイル・チップ・判定バナーのスタイルを新設

#### glossary アンカーについての判断（重要な申し送り）

UX設計 §7 は「`longRangeAttack` エントリは Issue #413 が先にマージされて
いる前提」としていたが、着手時点で **Issue #413（攻撃手法解説の土台）は
まだ `main` に未マージ**だった（実装自体は #413 のブランチに存在し、
`ChainRibbonPopover.tsx` に `longRangeAttack` へのアンカーを追加済み）。

このため、以下の方針で実装した:

- `GlossaryTerm` コンポーネントは、指定した `termKey` が glossary データに
  存在しない場合でも例外を投げず「未知の用語」として下線無しでそのまま
  表示する（`glossary/GlossaryTerm.tsx` の既存の防御的フォールバック）。
  これを踏まえ、`longRangeAttack`/`attestation` へのアンカーは**glossary
  データの存在を前提にせず**、UX設計どおりの箇所（パネルタイトル・
  checkpoint見出し・確定済みバッジ・フッターの attestation 説明）に
  `GlossaryTerm`/`withTermAnchor` を先に実装した
- `attestation` は Issue #402 で既に追加済みの既存用語のため問題なし
- `longRangeAttack` は #413 のマージ後に実データが揃う。#413 と #415 は
  どちらも `ChainRibbonPopover.tsx` を編集しているため、マージ時に
  コンフリクトが起きる見込み（#413が「親ブロック」行の下にヒント欄を
  追加、#415が末尾に導線ボタンを追加。編集箇所は異なる行のため機械的な
  マージ解決で問題ない見込みだが、統括のマージ時に要確認）
- **導入文（`longRangeDemo.intro`）自体には `longRangeAttack` のアンカーを
  付けなかった**。UX設計 §7 は「パネルタイトル・導入文中の『ロングレンジ
  攻撃』という語をラップする」としていたが、確定した導入文の文言
  （§8）には「ロングレンジ攻撃」という語自体が literal には含まれて
  いなかった（「攻撃者は後から別の履歴を作り直すことができます」という
  言い換えのみ）。文言を書き換えてまで無理に埋め込むより、literal に
  その語を含むパネルタイトル（`longRangeDemo.title`）側にアンカーを
  付ける方針にした。`SidePanel` の `title` prop は `ReactNode` を許容する
  ため、`ariaLabel`（スクリーンリーダー向けのプレーンテキスト）とは別に
  `title` だけを `withTermAnchor` でラップしている
- checkpoint見出し・確定済みバッジは、UX設計 §7 の「独立の `finality`
  エントリを新設しない場合の代替」どおり `longRangeAttack` へフォール
  バックしてアンカーした（#413のブランチを確認したところ、実際に
  `finality` の独立エントリは新設されていなかった）

#### テスト

- `attack-demo/longRangeAttackDemo.chain.test.ts`: `CANONICAL_CHAIN`/
  `ATTACKER_CHAIN` の形・共有区間（`#0`・`#1`）のハッシュ一致・分岐後
  （`#2`〜）のハッシュ不一致を固定
- `attack-demo/longRangeAttackDemo.state.test.ts`: checkpoint state の
  create/reset/set/isFinalized
- `attack-demo/longRangeAttackDemo.verdict.test.ts`: 2つの fork choice
  ルールの境界値（`checkpointIndex = divergeAt - 1` と `divergeAt` の境界
  で実際に切り替わること）と、naive ルールが決め打ちでなく実際に長さを
  比較していることの回帰確認（長さの前提を変えても壊れないことを直接
  確認）
- `attack-demo/longRangeAttackDemo.grid.test.ts`: グリッド列計算の不変
  条件（同じブロック番号は同じ列になる）
- `attack-demo/LongRangeChainRow.test.tsx`: タイル/連結線/注記の描画
- `attack-demo/LongRangeAttackDemoView.test.tsx`: checkpoint操作→判定
  バナーの実際の切り替わり、reset
- `attack-demo/LongRangeAttackDemoView.i18n.test.tsx`: ja/en文言
- `attack-demo/LongRangeAttackDemoView.a11y.test.tsx`: aria-pressed・
  キーボード到達可能性・色だけに頼らない状態伝達
- `attack-demo/LongRangeAttackDemoView.glossaryAnchor.test.tsx`:
  `longRangeAttack`/`attestation` アンカーの存在確認
- `entities/ChainRibbonCard.longRangeDemoEntry.test.tsx` /
  `entities/ChainRibbonPopover.longRangeDemoEntry.test.tsx`: 入口ボタンが
  `sidePanel.open({ kind: "longRangeAttackDemo" })` を呼ぶこと
- `side-panel/SidePanelHost.longRangeAttackDemo.test.tsx`: kindの振り分け・
  他パネルとの排他・ダングリングガード対象外・再オープン時の初期化・
  タイトルの用語アンカー

`pnpm lint && pnpm build && pnpm test`（frontend パッケージ、および
モノレポ全体の `pnpm build`）を実行し、全て成功することを確認済み。

#### 次の担当（reviewer/QA、および #414/#416 担当）への申し送り

- **#413マージ時**: `ChainRibbonPopover.tsx` のコンフリクト解消を確認
  （上記参照）。マージ後、`longRangeAttack`/`finality` 関連の glossary
  アンカーが実データで正しく機能することを実機/テストで再確認することを
  推奨する（現状のテストは glossary データをモックで注入しているため、
  実データとのキー不一致を検出できない）
- **#414（51%攻撃）**: `.chain-ribbon-card__attack-demo-row` は
  `flex-wrap: wrap` にしてあるので、#414が同じ行に入口ボタンを追加したい
  場合は `chain-ribbon-card__attack-demo-row` 内にボタンを1つ足すだけで
  レイアウトが壊れない想定。ただし #414 が `<details>`/`<summary>` の
  メニュー化を先に実装済みだった場合は、この専用行に無理に合流させず
  そちらのメニューへ統合する方が自然（統括からの申し送りどおり）
- **#416（eclipse攻撃）**: 本Issueとの直接の依存・競合は無い
  （`PeerNetworkLegend.tsx` を触る想定で、本Issueが触ったファイルとは
  重複しない）
