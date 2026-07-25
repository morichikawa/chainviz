# Issue #414 51%攻撃のシミュレーション砂場を実装する

### 2026-07-25 Issue #414 UX設計メモ（51%攻撃デモ「51%攻撃のしくみ」）

- 担当: ux
- ブランチ: issue-414-fifty-one-percent-attack-demo
- 前提: Issue #412 の設計フェーズで概念モデル・判定ロジックの原則が
  決定済み（`docs/ARCHITECTURE.md` §17.5.1・§17.6、`docs/worklog/issue-412.md`）。
  本メモはその実装着手前の詳細UX設計。実装（`packages/frontend`）は
  行っていない
- 確認方法: `pnpm --filter @chainviz/frontend dev`（モックデータ）で実機を
  起動し、Playwright（`@playwright/test`。E2Eパッケージの devDependency を
  流用）でスクリーンショットを取得しながら、既存の暗号デモ砂場
  （`hashChainDemo`、Issue #401）の操作感・図解表現・チェーンリボンカードの
  実測サイズを確認した

#### 1. 何が伝わっていないか（実際に触って確認した課題）

- 既存のフォーク色分け（ARCHITECTURE.md §9）は「ノードがどちらの tip を
  見ているか」を色で示すが、**なぜ最終的にどちらか1本に収束するのか**
  （合意ルール・多数決の力学）はどこにも説明がない。フォーク自体も
  自然発生をほぼ観測できない環境のため、実チェーン上で仕組みを体験する
  手段がない
- 「51%攻撃」という名前から連想される「バリデーターの半分以上を握れば
  何でもできる」という漠然とした理解はあっても、**なぜ多数決なのか・
  具体的に何票差で結果が変わるのか**という因果を手を動かして確認する
  場所がない
- チェーンリボンカード（`ChainRibbonCard.tsx`）を実測したところ、
  カード幅は約315px、subtitle-row の余白は約298pxしかなく、既存の
  `hashDemo.open` ボタン1つ（日本語54px・英語69px）だけでほぼ埋まって
  いる（英語版はサブタイトル文と合わせるとほぼ折り返し寸前）。ここへ
  `fiftyOnePercentAttackDemo`・`longRangeAttackDemo`（Issue #415）の
  入口ボタンを機械的に追加すると、3つ目のテキストリンクで確実に折り返す
  かはみ出す。「手狭になる懸念」（Issue #412 設計側の申し送り）は実測で
  裏付けが取れた

#### 2. 概念モデルの具体化（Issue #412 で決定済みの範囲を実装可能な粒度に）

Issue #412 の設計（§17.5.1）が固定しているのは「5〜7個程度の疑似
バリデーター」「等しい重み1票」「攻撃者が支配するバリデーター数を
スライダー等で増減」「重みの合計が大きい枝が canonical になる簡略化
fork choice」「フォーク色パレットの流用」まで。以下は今回のUX設計で
具体化した点:

- **バリデーター数は7人に固定**する（「5〜7個程度」の上限を採用）。
  奇数にすることで多数決に厳密な同数（引き分け）が発生せず、判定ロジックの
  分岐が単純になる。7人なら「4人（約57%）」が逆転ラインになり、
  「51%という名前だが実際に必要な割合は総数次第」という学習ポイントを
  自然に持たせられる
- **各バリデーターは「誠実（枝Aを支持）」か「攻撃者が支配（枝Bを支持）」の
  どちらか**とし、誠実なバリデーターは常に枝A、攻撃者配下は常に枝Bを
  支持する単純化を採用する（枝Aを「もとの正しいチェーン」、枝Bを
  「攻撃者が押し通したいチェーン」と位置付ける、最も直接的な51%攻撃の
  シナリオ）。初期状態は攻撃者0人（7人全員が枝Aを支持、枝Bは0票）
- **操作方法はスライダーではなく、7人分のバリデーター個別トグルボタンに
  した**（Issue #412 の「スライダー等」の「等」の範囲内の判断として明記）。
  理由:
  - 対象は0〜7の8段階の離散値のみで、ドラッグで連続値を選ぶスライダーの
    利点（細かい値を素早く選べる）がそもそも活きない
  - 個々のバリデーターをクリックしてON/OFFする方が「このバリデーターが
    寝返った」という**個体の同一性**が視覚的に保たれる（V3をクリックしたら
    V3が枝Bへ移動する。スライダーで「攻撃者3人」と数値だけ動かすより、
    「誰が」という主語が残る）
  - 実装コストが低い（`<input type="range">` は本アプリで前例が無い新規
    UIパーツだが、トグルボタンは既存の `<button>` パターン（relink・
    reset 等）の延長で実装できる）
  - キーボード操作・スクリーンリーダーでの読み上げも、個別の
    `<button aria-pressed>` の方がレンジ入力よりアクセシブルにしやすい
    （状態が「誠実/攻撃者」の二値であることをそのままボタンの押下状態で
    表現できる）
  - この判断はUX側の裁量だが、chainviz-designer の意図（「ユーザーが
    攻撃者支配数を増減できる」という操作結果）は損なわない。実装時に
    レンジスライダーの方が適切と判断される場合は変更してよいが、その
    場合も「個体の同一性を保つ」（同じV1〜V7が両陣営間を移動する見た目）
    は維持すること

#### 3. 図解のレイアウト（分岐ツリー。§17.5.1「新しい図解要素」の具体化）

チェーンリボンのタイル表現は使わず、以下の構成にする（上から下へ）:

1. **導入文**（`attack51Demo.intro`。学習用砂場であること・実チェーンに
   影響しないことを明記。既存デモと同じ冒頭文の流儀）
2. **サマリ行**: 「攻撃者が支配するバリデーター: {attacker} / {total}人
   （{percent}%）」（`attack51Demo.summaryLabel` + 値。常時表示、
   バリデーターをトグルするたびに即座に更新）
3. **分岐ツリー本体**（このデモの中核）:
   - 最上段に小さな「共通の親ブロック」ノード（`attack51Demo.commonParent`）。
     フォーク発生前は1本の同じチェーンだったことを示す
   - そこから2本の線が下に分かれ、左に「枝A」ボックス、右に「枝B」
     ボックスへ接続する（単純なV字/Y字のコネクタ線。SVG または border
     を使った折れ線で十分、複雑なグラフ描画ライブラリは不要）
   - 各枝ボックスの中身:
     - 見出し「枝A」/「枝B」（`attack51Demo.branchA`/`branchB`）
     - 現在その枝を支持しているバリデーターのトグルボタン群
       （V1〜V7のうち、その枝に属するものだけがそのボックス内に描画
       される。**トグルボタン自体がそのバリデーターの現在の投票先を
       表す配置**であり、コントロールと可視化が同一の要素になる。
       ボタンをクリックすると、そのバリデーターは反対側の枝ボックスへ
       移動する）
     - 誰も支持していない場合は空状態の文言（`attack51Demo.branchEmpty`
       「まだ誰もこの枝を支持していません」）を出す（他画面の「発行済み
       NFTがまだ無い」等と同じ「省略せず空であることを明示する」流儀）
     - 「重み: {n}」（`attack51Demo.weight` + 数値。バリデーター数の
       単純合計）
     - 状態バッジ: 現在 canonical な枝には
       `attack51Demo.badge.canonical`（「正準」。既存の `fork` 用語集
       エントリが既に使っている「正準（canonical）」という訳語に合わせる。
       「正史」等の別訳は使わない）、そうでない枝には
       `attack51Demo.badge.notCanonical`（「非正準（捨てられる枝）」）
   - **色**: 枝Aは `--fork-color-a`（#ffcc00 amber）、枝Bは
     `--fork-color-b`（#00e0ff cyan）を境界線・バッジに使う（§9.3の
     フォーク色パレットをそのまま流用。ARCHITECTURE §17.5.1 の指定通り）。
     canonical な枝は実線の縁取り + 発光（`.infra-card--fork-0/1` と
     同系）、非canonicalな枝は細い/淡い縁取りにし、**色だけでなくバッジの
     文言でも正準/非正準を伝える**（a11y。既存の hashDemo バッジ
     「有効/無効」と同じ「色に依存しない」原則）
4. **逆転ラインのヒント文**（`attack51Demo.marginToFlip` /
   `attack51Demo.alreadyFlipped`。動的テキストで「枝Bが逆転するまであと
   {n}人」または「攻撃者はすでに枝Bを正準にしています」を出す。
   `aria-live="polite"` を付け、バリデーターをトグルして状態が変わった
   ときにスクリーンリーダーでも変化が伝わるようにする）
5. **fork choice ルールの説明**（`attack51Demo.forkChoiceRule`。
   「重みの合計が大きい枝が正準になる」という簡略化ルールを明示。
   `GlossaryTerm termKey="fiftyOnePercentAttack"` でこの行の中の
   語（または見出し）をラップし、パネル内からも用語集へ飛べるようにする）
6. **閾値の注記**（`attack51Demo.thresholdNote`。「51%」という名前と
   実際の必要割合（7人中4人=約57%）のズレを明記。誤解の予防）
7. **リセットボタン**（`attack51Demo.reset`。既存デモと同じ「最初に戻す」。
   全バリデーターを枝Aに戻す）
8. **フッター注記2つ**（既存デモの `whoComputes`/`simplifiedNote` と同型）:
   - `attack51Demo.simplifiedNote`: 実際の fork choice（LMD-GHOST）は
     attestation の指す対象や経過時間なども考慮するより複雑なルールで
     あり、ここでは「重みの合計」だけを見る単純化であることの注記
   - `attack51Demo.whoDecides`: 実際のネットワークでは攻撃者が過半数の
     バリデーターを握るには莫大なステークと経済的コストが必要であり、
     「バリデーターが少数に集中していないこと」自体が安全性の土台である
     ことを伝える（Issue本文の「合意の仕組みが少数のバリデーターに
     集中する怖さを伝えるトイモデル」という位置づけに対応する結び）

**アニメーション**: バリデーターをトグルした直後、そのバリデーターの
ボタンと、状態が変わった枝ボックスのバッジ・ヒント文を短時間フラッシュ
させる（`HashChainDemoView` が使っている `NEW_ARRIVAL_HIGHLIGHT_DURATION_MS`
と同じ「変化箇所を短く光らせる」パターンを再利用。新しいアニメーション
機構は作らない）。バリデーターアイコンを枝間で物理的に滑らせて移動させる
演出は、実装コストの割に学習効果への寄与が薄いため**採用しない**
（先回りしない。フラッシュ + DOM上の再配置で十分に「動いた」ことが伝わる）。

#### 4. 導線（入口）の設計: チェーンリボンカードの入口を単一メニューへ統合する

Issue #412 の設計担当から「チェーンリボンカードの subtitle-row に3つの
砂場の入口ボタンを機械的に追加すると手狭になる懸念があり、単一入口
（メニュー/ドロワー等）への統合をUX側で判断してほしい」という申し送りが
あった（`eclipseAttackDemo` は §17.4 の通り自然な置き場所が
`PeerNetworkLegend` 側になる見込みのため、この「3つ」は
`hashChainDemo`・`fiftyOnePercentAttackDemo`・`longRangeAttackDemo` の3つ
を指す）。上記1節の実測（カード幅約315px、subtitle-row余白約298px、
ボタン1つで既にほぼ埋まる）を踏まえ、**単一メニューへ統合する**と判断した。

- チェーンリボンカードの subtitle-row にある既存の「ハッシュのしくみを
  試す」ボタン（`chain-ribbon-card__hash-demo-open`、Issue #401）を、
  **`<details>`/`<summary>` による開閉式メニュー**に置き換える
  - `<summary>` のラベルは `chainRibbon.demoMenu.open`
    （「学習用の砂場」/ "Learning sandboxes"）。閉じているときは
    既存ボタンと同じ見た目（アンダーライン付きテキストリンク）にする
  - 展開すると、カードの手前に浮かぶ小さな縦並びメニューが現れ、
    利用可能な砂場の入口ボタンを1行ずつ列挙する:
    - 「ハッシュのしくみを試す」（既存の `hashDemo.open`。**テキスト・
      挙動・`data-testid="chain-ribbon-hash-demo-open"` は変更しない**。
      メニュー内へ移動するだけ）
    - 「51%攻撃のしくみを試す」（新規 `attack51Demo.open`。
      `data-testid="chain-ribbon-fifty-one-percent-demo-open"` を新設）
    - （Issue #415 が着手されたら「ロングレンジ攻撃のしくみを試す」を
      同じ並びに追加する。今回はそのための特別な拡張ポイントを
      先回りして作り込まない。ただの3項目目の追加として実装できる
      構造にしておけば十分）
  - いずれかの項目を選ぶと、対象の `sidePanel.open({ kind: ... })` を
    呼ぶと同時に `<details>` を閉じる（開いたままサイドパネルが表示
    されると見た目が窮屈なため）
  - `<details>`/`<summary>` を選んだ理由: ブラウザ標準の開閉状態管理・
    キーボード操作（Enter/Space で開閉）・スクリーンリーダーへの
    expanded/collapsed 通知を無償で得られる。独自の state 管理・
    aria 属性の手動付与・外側クリックでの close 処理を新設するより
    実装コストが低く、CLAUDE.mdの「先回りしない」「過剰に作り込まない」
    に整合する
  - 既知の制約（意図的に対応しない）: `<details>` は外側クリックで
    自動的には閉じない。メニューを開いたまま無関係な場所をクリックしても
    開いたままになるが、再度 `summary` をクリックすれば閉じられるため
    致命的な問題ではないと判断した。実装時に余裕があれば改善してよいが
    必須要件にはしない
  - 配置・見た目（z-index、背景等）は、既存のホバー用ポップオーバー
    （`PopoverPortal`）と同じ「他カードより手前に浮かぶガラス質感パネル」
    の流儀に合わせる。`PopoverPortal` をそのまま再利用できるかは
    実装判断に委ねる（クリックトリガーへの転用が容易ならそれでよいし、
    `.chain-ribbon-card` が既に `position: relative` を持つため、
    カード内で完結する単純な `position: absolute` でも成立する）
- **`ChainRibbonPopover`（タイルホバー時の文脈導線）は変更しない**。
  51%攻撃デモは「特定の1ブロック」ではなく「バリデーター集団の投票」
  という、ブロックそのものより一段抽象的な題材のため、hashChainDemo
  のような「このタイルのハッシュの裏側」という文脈的な結びつきが弱い。
  タイル単位の文脈導線は追加せず、カード単位の常設入口（今回のメニュー）
  だけで足りると判断した
- **`InfraPopover`（ノードカードの「見ている tip」行）への追加導線は
  任意（実装しなくてよい）とする**。§17.4 で決定済みの
  `fiftyOnePercentAttack`/`reorg` の用語集アンカーはこの行に既に
  乗る予定であり、それとは別に「このデモを開く」ボタンまで追加するのは
  過剰と判断した。もし実装時に「フォーク発生中のノードから直接デモへ
  跳べると良い」と判断すれば追加してよいが、必須要件にはしない

#### 5. 新設する i18n 文言（初稿。`attack51Demo.*` / `chainRibbon.demoMenu.*` 名前空間）

| キー | ja | en |
| --- | --- | --- |
| `chainRibbon.demoMenu.open` | 学習用の砂場 | Learning sandboxes |
| `attack51Demo.open` | 51%攻撃のしくみを試す | Try how a 51% attack works |
| `attack51Demo.title` | 51%攻撃のしくみ | How a 51% attack works |
| `attack51Demo.intro` | ここは学習用の砂場です。実際のチェーンには影響しません。7人の疑似バリデーターが、分岐した2つの候補（枝A・枝B）のどちらを正しいチェーンとして見ているかを表しています。バリデーターのボタンをクリックすると、そのバリデーターを攻撃者が支配している状態に切り替えられます。 | This is a learning sandbox. It doesn't affect the real chain. 7 pseudo-validators each regard one of two candidate branches (Branch A / Branch B) as the chain they follow. Click a validator's button to toggle whether the attacker controls it. |
| `attack51Demo.summaryLabel` | 攻撃者が支配するバリデーター | Validators controlled by the attacker |
| `attack51Demo.summaryValue` | {attacker} / {total}人（{percent}%） | {attacker} / {total} ({percent}%) |
| `attack51Demo.commonParent` | 共通の親ブロック | Common parent block |
| `attack51Demo.branchA` | 枝A | Branch A |
| `attack51Demo.branchB` | 枝B | Branch B |
| `attack51Demo.weight` | 重み | Weight |
| `attack51Demo.badge.canonical` | 正準 | Canonical |
| `attack51Demo.badge.notCanonical` | 非正準（捨てられる枝） | Not canonical (discarded) |
| `attack51Demo.branchEmpty` | まだ誰もこの枝を支持していません | No validator is backing this branch yet |
| `attack51Demo.validator.honest` | バリデーター{n}: 誠実（クリックで攻撃者が支配する状態に切り替え） | Validator {n}: honest (click to make attacker-controlled) |
| `attack51Demo.validator.attacker` | バリデーター{n}: 攻撃者が支配（クリックで誠実な状態に戻す） | Validator {n}: attacker-controlled (click to make honest) |
| `attack51Demo.forkChoiceRule` | fork choiceルール（簡略化）: 重みの合計が大きい枝が正準になります。 | Simplified fork-choice rule: the branch with the larger total weight becomes canonical. |
| `attack51Demo.marginToFlip` | 枝Bが逆転するまであと{count}人 | {count} more attacker-controlled validators would flip Branch B to canonical |
| `attack51Demo.alreadyFlipped` | 攻撃者はすでに枝Bを正準にしています | The attacker has already made Branch B canonical |
| `attack51Demo.thresholdNote` | 「51%攻撃」という名前ですが、実際に必要な割合はバリデーター総数によって変わります（この砂場では7人中4人、約57%で逆転します）。 | Despite the name "51% attack," the share actually needed depends on the total validator count (in this sandbox, 4 of 7 — about 57% — flips the outcome). |
| `attack51Demo.reset` | 最初に戻す | Reset |
| `attack51Demo.simplifiedNote` | 実際のfork choice（LMD-GHOST）は、各バリデーターの証明（attestation）が指すブロックや経過時間なども考慮する、より複雑なルールです。ここでは学習のため「重みの合計が大きい枝が勝つ」という単純化したルールだけを使っています。 | The real fork-choice rule (LMD-GHOST) is more complex — it also weighs which block each validator's attestation points to, how much time has passed, and more. This sandbox uses a simplified rule: the branch with more total weight wins. |
| `attack51Demo.whoDecides` | 実際のネットワークでは、1人の攻撃者がバリデーターの半数以上を握るには莫大なステーク（担保資産）を用意する必要があり、経済的コストが非常に高くなります。バリデーターが少数に集中していないことこそが、この仕組みの安全性の土台です。 | In a real network, an attacker would need an enormous amount of stake to control more than half the validators — an extremely costly undertaking. Keeping validators from concentrating in a few hands is exactly what makes this mechanism secure. |

`attack51Demo.summaryValue`/`marginToFlip`/`validator.honest`/`validator.attacker`
は既存の `format()` ヘルパー（`ChainRibbonCard.tsx` の `cadence` 表示等で
使用中）で `{placeholder}` を埋め込む想定。

#### 6. 状態モデル（実装への申し送り。`packages/frontend/src/attack-demo/` 想定）

- 純粋ロジック（`fiftyOnePercentAttackDemo.ts` 想定）:
  - `TOTAL_VALIDATORS = 7`（固定値。CLAUDE.mdの固定値ルールに従い、
    「実チェーンの観測値ではなく学習用砂場の疑似データの人数」という
    前提をコード上のコメントに明記すること。§17.5冒頭でレビュー担当も
    同種の固定値（疑似ブロック3個等）を問題視しない旨を確認済み）
  - state: 7人ぶんの `{ id: number; controlledByAttacker: boolean }`
    配列、または単純に `attackerValidatorIds: ReadonlySet<number>` の
    どちらでも良い（実装判断）。**「どのバリデーターか」という識別子を
    捨てて人数だけを state に持つ設計にはしない**こと（3節の「個体の
    同一性」要件のため）
  - 導出関数: `weightOfBranchA(state)` / `weightOfBranchB(state)`
    （それぞれ誠実勢・攻撃者勢の人数）、`canonicalBranch(state)`
    （weight の大小比較。同数は7人固定なら理論上発生しないが、念のため
    「同数なら枝Aを優先」等の決定的な規則をコードに明記しておく）、
    `marginToFlip(state)`（Bが逆転するまでの必要人数。既に逆転していれば
    0または負値ではなく「既に逆転済み」を表す別の戻り値にする）
  - `toggleValidator(state, id)`: 指定バリデーターの
    `controlledByAttacker` を反転する
  - `createInitialFiftyOnePercentAttackDemoState()`:
    全員 `controlledByAttacker: false`
  - パネルを閉じて開き直すと初期状態に戻る（既存2デモ・§17.5「パネルは
    開くたびに初期状態から始まる」の方針を踏襲。state はコンポーネント
    ローカルの `useState` に置き、`SidePanelView` 側には持たせない）
- View（`FiftyOnePercentAttackDemoView.tsx` 想定）は
  「導入文 → サマリ行 → 分岐ツリー（枝A/枝Bの2ボックスをそれぞれ
  レンダリングする共通サブコンポーネント、例 `AttackBranchBox.tsx`）→
  ヒント文 → fork choiceルール文 → 閾値注記 → リセット → フッター注記2つ」
  の構成。`HashChainBlockRow.tsx` がブロック1件の表示を担うのと同じ粒度で、
  枝1つの表示を `AttackBranchBox` に切り出すことを推奨する（1ファイル
  1責務。最終的な分割判断は実装担当に委ねる）

#### 7. `packages/shared` への影響: なし

Issue #412 の設計（§17.2）で既に「土台・3つの砂場のいずれも
`packages/shared` の型変更は不要」と判定済み。本UX設計もその前提の範囲内
（`fiftyOnePercentAttackDemo` の state は完全にフロント内で完結する疑似
データであり、ワールドステートのエンティティを参照しない）。

#### 8. 依存関係の確認（実装着手前に確認すること）

- Issue #413（攻撃手法解説の土台。glossary新規6語+アンカー5箇所）が
  **先にmainへマージされている必要がある**（`docs/worklog/issue-412.md`
  詳細設計 §2 の依存順序どおり）。本メモを書いた時点
  （2026-07-25）で `glossary/ethereum/terms/*.yaml` に
  `fiftyOnePercentAttack`/`reorg` キーはまだ存在しないことを実際に
  `grep` で確認した。`GlossaryTerm termKey="fiftyOnePercentAttack"` を
  デモ内に埋め込む実装は、このキーがglossaryに存在してから着手すること
- Issue #415（ロングレンジ攻撃デモ）・Issue #416（eclipse攻撃デモ）の
  UX設計も並行して別セッションで進行中。チェーンリボンカードの
  subtitle-row（本メモが単一メニュー化を決めた箇所）は#415の担当領域とも
  重なるため、実装フェーズ（chainviz-frontend）が最終的な整合を取る想定
  （統括からの申し送りどおり）。本メモの4節の設計はその際の初期案として
  扱ってよい

#### 9. テスト観点（実装担当・tester への申し送り）

- 7人の初期状態（全員誠実、枝A=7・枝B=0、canonical=A）
- 境界値: 攻撃者3人（枝A=4・枝B=3、canonicalはまだA、
  `marginToFlip`=1）→ 攻撃者4人（枝A=3・枝B=4、canonicalがBへ反転、
  `alreadyFlipped` 表示に切り替わる）の遷移
- 極端値: 攻撃者0人・7人（片方の枝が完全に空になる。空状態文言の表示）
- 同じバリデーターを2回クリックすると元に戻ること（トグルの往復）
- リセットで全員誠実状態に戻ること
- メニュー（`<details>`）を開いて項目を選ぶと対象の `SidePanelView` が
  開き、かつメニュー自体が閉じること
- 既存の `chain-ribbon-hash-demo-open`（Issue #401）のテストが、メニュー
  内へ移動した後も同じ `data-testid` ・同じクリック挙動で通ること
  （回帰）
- i18n: 新規キーすべてに ja/en 両方があり、既存の
  `i18n.empty-string.test.ts` 等の網羅テストに引っかからないこと
- a11y: バリデーターボタンが `aria-pressed` を正しく持つこと、
  canonical/非canonicalが色だけでなくバッジ文言で伝わること、
  ヒント文の `aria-live="polite"` が状態変化時に更新されること

#### 10. 決めきれていない点（実装時の裁量・確認事項）

- バリデーターの操作方法は7人分のトグルボタン案（2節）を推奨するが、
  実装時に7個のボタンが視覚的に窮屈と判断されれば、レンジスライダー
  （`<input type="range">`。本アプリでは前例が無い新規UIパーツになる）
  との併用など代替案へ変更してよい。ただし「個体の同一性を保つ」
  （3節。同じV1〜V7が両陣営間を移動する見た目）は維持すること
- メニューの位置決め実装（`PopoverPortal` 再利用 or カード内
  `position: absolute`）は実装判断に委ねる
- Issue #415（ロングレンジ攻撃）のUX設計が、本メモと異なる「単一メニュー」
  設計を提案した場合の最終調整は chainviz-frontend が吸収する
  （統括からの申し送りどおり）
- `docs/CONCEPT.md`「体験イメージ」の暗号デモ砂場に触れた既存の一文
  （Issue #401/#402完了後にまとめて追記されたもの）と同様に、51%攻撃・
  ロングレンジ攻撃・eclipse攻撃の3砂場をまとめて紹介する一文を将来追記する
  余地があるが、**今回は追記しない**。理由: 過去の実例
  （`8a48335 docs: 体験イメージに暗号デモ砂場を追記`）は#401と#402の
  両方が完了した後に統括がまとめて追記しており、3つの攻撃デモも同じ
  パターン（家族単位でまとめて1回）を踏襲するのが自然。#414単体の時点で
  CONCEPT.mdに手を入れると、並行して進んでいる#415/#416のUX設計と
  同じ箇所への重複編集・コンフリクトを招くおそれもある

### 2026-07-25 Issue #414 実装（frontend）

- 担当: frontend
- ブランチ: `issue-414-fifty-one-percent-attack-demo`
  （worktree の都合上、ローカルでは `issue-414-work` という別名ブランチで
  作業し、push 時に `issue-414-fifty-one-percent-attack-demo` へ向けて
  push した。origin 上のブランチ名は変わらない）
- 前提の確認: 着手前に `git merge-base --is-ancestor` で確認したところ、
  Issue #413（`fiftyOnePercentAttack`/`reorg` を含む glossary 追加）は
  この時点でまだ `main` へマージされていなかった。UX設計 §8 の指示どおり
  「マージされてから着手」を待つと並行作業が止まってしまうため、
  `GlossaryTerm` の既存の防御的フォールバック（未知語は下線無しの
  `glossary-term--unknown` としてそのまま表示し例外を投げない。
  `GlossaryTerm.tsx` 参照）に乗る形で `termKey="fiftyOnePercentAttack"`
  を先に実装した。#413 が先にマージされていれば正しくアンカーとして
  機能し、まだの場合も未知語表示に留まるだけで壊れない。この暫定挙動は
  `FiftyOnePercentAttackDemoView.glossaryAnchor.test.tsx`
  の2件目のテストケース（未知語のときの表示）で固定してある。**マージ
  順序（#413 → #414）が守られているかは統括がマージ時に再確認すること**

#### 設計メモ（実装方針）

- 純粋ロジックとView/表示を分離する既存パターン（`crypto-demo/
  hashChainDemo.ts` + `HashChainDemoView.tsx`）をそのまま踏襲し、
  `packages/frontend/src/attack-demo/` に以下を新設した:
  - `fiftyOnePercentAttackDemo.ts`: 状態は `attackerValidatorIds:
    ReadonlySet<number>`（バリデーター7人固定、id は1〜7）。個体の
    同一性を保つ要件（UX設計§6）を満たすため、人数だけを持つ設計には
    しなかった。`weightOfBranchA/B`・`canonicalBranch`（同数は枝A優先の
    決定的規則）・`marginToFlip`（あと何人でBが逆転するかを整数で返す。
    既に逆転済みなら `{flipped: true}` の別形にする判別共用体）・
    `toggleValidator`・`branchValidatorIds` を実装
  - `AttackBranchBox.tsx`: 枝1つぶんの表示（見出し・バリデーターボタン
    群・空状態・重み・canonical バッジ）。`HashChainBlockRow.tsx` と
    同じ「1エンティティ1ファイル」の粒度
  - `FiftyOnePercentAttackDemoView.tsx`: 状態は `useState` でコンポーネント
    ローカルに持ち、`SidePanelView` 側には持たせない（既存2デモと同じ
    「開くたびに初期状態」方針）。フラッシュ演出は
    `NEW_ARRIVAL_HIGHLIGHT_DURATION_MS` を再利用し、`HashChainDemoView`
    と同じ「Set + タイマーMap」パターンをバリデーター単位・バッジ単位で
    適用（新しいアニメーション機構は作らない）
- `sidePanelView.ts` に `{ kind: "fiftyOnePercentAttackDemo" }` を追加
  （対象データを持たない。既存2デモと同型）。`SidePanelHost.tsx` に
  振り分け case を追加し、ダングリングガードの対象外である旨のコメントを
  既存の hashChainDemo/signatureDemo と同じ書式で追記
- fork choice ルール説明文への用語集アンカー（UX設計§3-5「この行の中の
  語（または見出し）をラップ」）は、既存の `withTermAnchor` パターン
  （ja/en 訳文中の共通の部分文字列を差し替える）が使えなかった点が
  設計判断のポイント。ja「fork choiceルール」と en「fork-choice rule」は
  ハイフンの有無で完全一致する部分文字列を持たないため、文全体を
  `GlossaryTerm` の children にする方式にした（`ChainRibbonCard.tsx` が
  `t("chainRibbon.title")` という短い文字列全体を `GlossaryTerm` で
  ラップしている前例を、より長い文へ適用した形）
- 入口メニュー化（UX設計§4）: `ChainRibbonCard.tsx` の subtitle-row にあった
  単一ボタン（`hashDemo.open`）を `<details>`/`<summary>` に置き換えた。
  `<details>` の開閉は uncontrolled（ブラウザ標準）のままにし、メニュー
  項目クリック時だけ `useRef<HTMLDetailsElement>` 経由で `.open = false`
  を設定して明示的に閉じる（React state 化して `onToggle` で同期する
  方式より単純なため採用）。他Issue（#415/#416）が同じメニューへ
  項目を追加しやすいよう、`<div className="chain-ribbon-card__demo-menu-list">`
  内にボタンを並べるだけの単純な構造にした（特別な拡張ポイントは
  先回りして作り込んでいない。UX設計§4の申し送りどおり）
- 既存の `chain-ribbon-hash-demo-open`（Issue #401）の testid・クリック
  挙動は変更していない（ボタンは同じ属性のまま、親要素が `<details>` に
  変わっただけ）。既存の回帰テスト
  `ChainRibbonCard.hashDemoEntry.test.tsx` は「先に
  `chain-ribbon-demo-menu-open` をクリックしてメニューを開いてから」
  操作する形に更新した。jsdom 25 は `<details>`/`<summary>` の
  クリック開閉（activation behavior）を実装しているため、
  `fireEvent.click(summary)` で実際に `open` 属性が切り替わることを
  確認済み
- `packages/e2e/src/ui/hash-chain-demo.spec.ts`（Playwright）も、実ブラウザ
  では閉じた `<details>` の中身がレイアウト上非表示になり
  `getByTestId("chain-ribbon-hash-demo-open").click()` が単体では
  タイムアウトするため、先に `chain-ribbon-demo-menu-open` をクリックする
  よう最小限の修正を入れた（`packages/e2e/SCENARIOS.md` の該当記述も
  合わせて更新）。51%攻撃デモ自体の新規 e2e シナリオは今回のタスク範囲外
  （vitest ユニットテストのみを指示された）としてQA側の判断に委ねた

#### 実装したファイル

- 新規: `packages/frontend/src/attack-demo/fiftyOnePercentAttackDemo.ts`・
  `fiftyOnePercentAttackDemo.test.ts`・`AttackBranchBox.tsx`・
  `FiftyOnePercentAttackDemoView.tsx`・`FiftyOnePercentAttackDemoView.test.tsx`・
  `FiftyOnePercentAttackDemoView.a11y.test.tsx`・
  `FiftyOnePercentAttackDemoView.i18n.test.tsx`・
  `FiftyOnePercentAttackDemoView.glossaryAnchor.test.tsx`
- 新規: `packages/frontend/src/side-panel/SidePanelHost.fiftyOnePercentAttackDemo.test.tsx`
- 新規: `packages/frontend/src/entities/ChainRibbonCard.demoMenu.test.tsx`・
  `ChainRibbonCard.attack51DemoEntry.test.tsx`
- 変更: `packages/frontend/src/side-panel/sidePanelView.ts`（新規 kind 追加）・
  `SidePanelHost.tsx`（振り分け case 追加）・
  `packages/frontend/src/entities/ChainRibbonCard.tsx`（入口メニュー化）・
  `packages/frontend/src/entities/ChainRibbonCard.hashDemoEntry.test.tsx`
  （メニュー経由の操作に更新）・`packages/frontend/src/i18n/messages.ts`
  （`chainRibbon.demoMenu.open` と `attack51Demo.*` を追加）・
  `packages/frontend/src/styles.css`（メニュー・デモ本体のスタイル追加）
- 変更（e2e、影響を受けた既存シナリオの最小修正）:
  `packages/e2e/src/ui/hash-chain-demo.spec.ts`・`packages/e2e/SCENARIOS.md`
- 変更: `docs/PLAN.md`（該当チェックボックスにチェック）

#### 確認したこと

- `pnpm --filter @chainviz/frontend build` / `pnpm --filter @chainviz/frontend test`
  （264 test files / 3234 tests、全て成功）
- `pnpm build` / `pnpm test`（ルート、全パッケージ）・`pnpm lint` も実行し
  全て成功することを確認した

#### 次の担当（レビュー・QA）が知っておくべき注意点

- Issue #413（glossary の `fiftyOnePercentAttack`/`reorg` 追加）が
  `main` へマージされているかを確認してからマージすること。マージ順が
  逆になっても壊れはしない（未知語フォールバックで表示自体はできる）が、
  用語集アンカーとして機能しない状態でユーザーの目に触れることになる
- `ChainRibbonCard.tsx` の subtitle-row は Issue #415（ロングレンジ攻撃）も
  同じメニューへ項目を追加する見込みで、`ChainRibbonCard.hashDemoEntry.test.tsx`
  同様の更新が入る可能性が高い。マージ時にコンフリクトが出ることは
  想定済み（統括の申し送りどおり）
- `docs/PLAN.md` のチェックボックスは自分の作業分のみ更新した。他の
  攻撃デモ（#415/#416）のブランチも同じファイルの近傍行を編集する見込みの
  ため、マージ時に統括がコンフリクトを解消すること
