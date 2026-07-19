# Issue #401 ブロックハッシュの計算・親子連結・改ざん時の影響をインタラクティブに可視化する

### 2026-07-18 Issue #401 起票の経緯

- 担当: 統括
- ブランチ: issue-401-402-hash-signature-viz-backlog
- 内容: ユーザーから「チェーンがつながれるときの仕組みをもう少しわかり
  やすく可視化できないか。ハッシュがどう関連するとか、どこが計算して、
  どこに格納されるのか」という要望を受け、現状調査を実施した。
- 調査結果:
  - 親ハッシュによる連結自体は既に可視化済み: チェーンリボン(Issue #298)
    は`次.parentHash === 前.hash`が成立するときだけ隣接タイルを連結として
    描く。ポップオーバーの「親ブロック」行をホバーすると直前タイルが
    光る演出もある(Issue #351)
  - 手薄な点: (1)「ブロックの中身(親ハッシュ含む)からハッシュ自体が
    計算される」という暗号学的な理由がUI上どこにも説明されていない、
    (2)「hash」という概念自体の用語集エントリが存在しない、
    (3) ハッシュ計算はEthereumノード側(EL client)が行い、collectorは
    単に転記するだけ、という「どこで・誰が計算するか」の説明もない、
    (4) 改ざん検知の可視化的デモに相当する機能は無い
- ユーザーはAskUserQuestionで「改ざんデモ的なインタラクション(重量・
  新機能)」を選択。ブロックの主要フィールド→ハッシュ計算→出力の図解、
  親ハッシュを改ざんすると後続ブロックが無効になる体験を新規実装する
  方向で合意した。
- Issue #402(署名・検証の可視化)と同じ「暗号学的な仕組みが静的な説明は
  あるが動的に理解できない」というテーマのため、ユーザーの意向により
  別Issueとして起票しつつ、同じchainviz-uxに一括して検討させる方針。

### 2026-07-18 Issue #401・#402 起票・バックログ追記のレビュー

- 担当: reviewer
- ブランチ: issue-401-402-hash-signature-viz-backlog
- 判定: **合格**
- Issue本文とdocs/PLAN.md追記の一致、参照事実の実在確認
  (chainRibbon.tsの`connectedToPrevious`判定、TxLifecyclePopover.tsx、
  collectorがecrecoverを使わずeth_getTransactionByHashのfromを信頼して
  いること、glossaryにhashエントリが無いこと、ARCHITECTURE.mdの各節番号
  等)、docs/WORKLOG.md索引、コミット粒度、Conventional Commits形式、
  `pnpm lint && pnpm build && pnpm test`全パッケージ通過をすべて確認
- docs配下のみの変更のため、CLAUDE.mdの例外規定に基づきchainviz-qaは
  省略(reviewer合格のみ)

### 2026-07-19 Issue #401 UX設計メモ(改ざんデモ「ハッシュのしくみ」)

- 担当: ux
- ブランチ: issue-401-hash-computation-viz
- 内容: モックデータ環境(`pnpm --filter @chainviz/frontend dev`)で
  チェーンリボンの現状(タイル・ポップオーバー・「親ブロック」行ホバーでの
  直前タイル強調)を実際に操作して確認したうえで、改ざんデモのUX設計を
  まとめた。以下が実装担当(chainviz-frontend)への引き継ぎ内容。

#### 1. 何が伝わっていないか(実際に触って確認した課題)

- リボンは「連なっている」ことは見せるが、「なぜ連なりが改ざん耐性に
  なるのか」は体験できない。ポップオーバーの「ハッシュ」「親ブロック」は
  値の羅列で、「ハッシュはブロックの中身から計算される指紋であり、
  中身を変えると別の値になる」という因果がどこにも現れない
- ポップオーバーの「ハッシュ」ラベルには用語解説(GlossaryTerm)が
  付いておらず(「ブロック番号」「取り込まれた tx」等には付いている)、
  そもそも `hash` の用語集エントリが存在しない
- 「誰が・どこで計算し、どこに格納されるか」(ELクライアントが生成時に
  計算 → 受信ノードが再計算して検証 → collector は転記するだけ。
  ブロック自身のハッシュはブロックの中には格納されず、次のブロックの
  parentHash に格納される)がUI上どこにも説明されていない

#### 2. 設計判断(Issueの論点への回答)

- **表示場所: サイドパネルの新 kind として実装する**(モーダルや
  ポップオーバー内組み込みは採らない)
  - ポップオーバーはホバー寿命の一時UIで、テキスト入力を伴う操作型
    デモの器にならない(Issue #351 系のホバー維持問題も再燃する)
  - モーダルはキャンバスを遮る。サイドパネルなら実物のチェーンリボンを
    見ながら砂場を操作でき、「砂場と実物が同じ仕組み」という対応が
    視界の中で成立する
  - 既存の汎用サイドパネル機構(ARCHITECTURE.md §12.2、排他1枚・
    リサイズ・フォントスケール対応)に `kind: "hashChainDemo"` を
    追加するだけで載る。`SidePanelView` はフロント内部状態なので
    `packages/shared` に影響しない
- **データソース: 完全に独立した学習用の疑似データ(砂場)**
  - 実データを編集できるように見せると「実チェーンを書き換えられる」
    という誤解を生む。collector 経由でも改ざん操作は存在しないので、
    実データ連動は嘘の体験になる
  - 実ブロックの本物のハッシュは RLP エンコードしたヘッダ全体
    (15+フィールド)から計算され、フロントで再現するには全ヘッダ
    フィールドが必要(shared/collector の変更が必要)なうえ、学習者に
    は入力→出力の対応がかえって見えなくなる
  - 砂場は「ブロック番号・親ブロックのハッシュ・データ」の3フィールド
    の簡略ブロック3個(#1→#2→#3)で固定。モック環境でも実環境でも
    同一の体験になる
- **ハッシュ計算の表現: 記号的説明ではなく、実際に keccak256 を計算する**
  - 「1文字変えるとハッシュ全体が別物になる」(雪崩効果)は、本物の
    計算でこそ信じられる。記号的な図解では「変わることにしておく」
    だけになり、このデモの核が抜ける
  - keccak256 は Ethereum が実際にブロックハッシュに使う関数であり、
    処理帯に関数名を明示することで用語集(`hash`)とも接続する
  - 実装: `@noble/hashes`(監査済み・依存ゼロ・ESM)を frontend の
    dependencies に追加し、`@noble/hashes/sha3` の `keccak_256` を使う
  - 入力は `${番号}|${親ハッシュ(記録値)}|${データ}` を UTF-8 で連結した
    バイト列でよい(RLP までは再現しない。この簡略化はパネル内に注記
    する。§4 の文言 `hashDemo.simplifiedNote` 参照)

#### 3. デモパネル「ハッシュのしくみ」の仕様

**状態モデル**(パネル内ローカル state で完結。閉じたら破棄し、
開き直したら常に初期状態から始める — 学習デモは毎回同じ起点が明快):

```ts
interface DemoBlock {
  number: number;            // 1, 2, 3 固定(実リボンの#124等と混同しない小さい番号)
  storedParentHash: string;  // 「ブロックに格納されている」親ハッシュ(記録値)
  data: string;              // 自由編集できるテキスト。初期値は送金風の例文
}
// 導出値(stateに持たない):
//   hashOf(block)  = keccak256(`${number}|${storedParentHash}|${data}`)
//   isValid(i)     = i === 0 ? true : blocks[i].storedParentHash === hashOf(blocks[i-1])
```

- #1 の `storedParentHash` は全ゼロ(0x00…0。「この砂場の起点」と注記)
- `data` 初期値の例文(i18n): #1「Alice → Bob: 5 ETH」/
  #2「Bob → Carol: 2 ETH」/ #3「Carol → Alice: 1 ETH」

**レイアウト**(縦に3ブロック、上が古い):

- 各ブロックは「ブロックに格納されている情報」枠(番号・親ブロックの
  ハッシュ・データ入力欄)と、枠の**外**・下端の「このブロックの
  ハッシュ」(導出値)で構成する。**自分のハッシュは自分の中に格納
  されず、次のブロックに格納される**ことを配置そのもので伝える
- 枠と導出値の間に処理帯「keccak256 でハッシュ化」(f(x)風の関数
  アイコン+関数名)。「中身 → 関数 → 指紋」の因果を1ブロック内で図解
- ブロック間: 前ブロックの導出ハッシュから次ブロックの「親ブロックの
  ハッシュ」欄へ縦の連結線。一致していれば実線(リボンの連結と同じ
  視覚言語)、不一致なら途切れ+警告色(赤系。Issue #327 の状態色の
  意味体系に従い既存変数を再利用)
- 各ブロックに有効/無効バッジ(`isValid`)。無効時は赤系の枠+バッジ。
  色だけに頼らずアイコン+文言を併記(アクセシビリティ)
- ハッシュ値は 0x+64hex で長いので `shortHex` 相当の中略表示+
  `title` 属性で全文。親ハッシュ欄と前ブロックのハッシュが「同じ値だ」
  と見比べられることが目的なので中略で足りる
- ハッシュ値が変わった瞬間は短いフラッシュ(既存の新着ハイライトの
  流儀)で「今変わった」ことを目で追えるようにする

**操作フロー**:

1. 開いた直後: 3ブロックすべて有効・連結。導入文(砂場であること・
   実チェーンに影響しないこと・データを書き換えてみるよう促す)を表示
2. 任意のブロックの「データ」を1文字でも編集 → そのブロックの
   ハッシュが即座に全く別の値へ(実計算・フラッシュ) → 次ブロックの
   記録値と食い違い、**後続ブロックがすべて「無効」**+連結線が破断
3. 無効ブロックには「親ハッシュをつなぎ直す」ボタンが現れる。押すと
   その `storedParentHash` が親の現在ハッシュに書き換わり、その
   ブロックは有効に戻るが、**自身のハッシュも変わるため次はまだ無効**
   → 「改ざんを隠すには後続をすべて作り直す必要がある」を連鎖操作で
   体験させる
4. 全部つなぎ直して3ブロックとも有効に戻ると、まとめメッセージを表示:
   1台の中では辻褄を合わせられるが、実際のネットワークでは他ノードが
   元のチェーンを持ち、ブロックには提案者の署名と検証(attestation)が
   必要なので受け入れられない、という内容(#402 の署名・検証デモへの
   概念的な橋渡し。リンクはまだ張らない)
5. 「最初に戻す」ボタン(常設)で初期状態へ
6. パネル末尾に「どこで計算されるか」の短い説明(実行クライアントが
   計算・受信ノードが再計算して検証・collector は転記のみ)と、
   簡略化の注記(実ブロックはもっと多くの項目を含み RLP で並べて
   ハッシュ化する)を置く

**導線(入口)**:

1. チェーンリボンのポップオーバー末尾に「ハッシュのしくみを試す」
   ボタンを追加(ポップオーバーはホバー中クリック可能。クリックで
   `sidePanel.open({kind: "hashChainDemo"})`)
2. リボンカードに常設の小さな入口を1つ(発見性のため。subtitle 行の
   行末を第一候補とするが、正確な配置は実装時の裁量でよい。要件は
   「カード上に常設入口が1つ」+「ポップオーバー内に文脈導線が1つ」)
3. 用語集 `hash` エントリの定義文中で「『チェーン』カードから砂場で
   試せる」ことに言及(用語集→パネルの機構的ジャンプは既存機構に
   無いので今回は作らない)

#### 4. 用語集・ポップオーバーの軽量対応(デモと独立に効く改善)

- `glossary/ethereum/terms/c-transaction.yaml` に `hash` エントリを新設。
  定義に含めるべき要素: (a) 内容から計算される固定長の指紋、1文字でも
  変わると全く別の値・逆算不能 (b) ブロックのハッシュは中身(親ハッシュ・
  番号・時刻・tx など)から計算されるため、過去を書き換えると次ブロックの
  記録と食い違って露見する (c) 計算はブロックを作る実行クライアントが
  行い、受信した各ノードも再計算して検証する。chainviz の collector は
  報告値を転記するだけ (d) 砂場デモへの案内。
  `layer: c-transaction`、`relatedTerms: [block, transaction]`
- 既存 `block` エントリの `relatedTerms` に `hash` を追加
- `ChainRibbonPopover` の「ハッシュ」「親ブロック」ラベルに
  `GlossaryTerm`(`termKey="hash"`)を付ける(現状は素のラベル)
- 英語版定義は初稿を書き、chainviz-i18n のレビューを受ける

#### 5. 新設する i18n 文言(初稿。`hashDemo.*` 名前空間)

- `hashDemo.title`: ja「ハッシュのしくみ」/ en "How hashes chain blocks"
- `hashDemo.intro`: ja「ここは学習用の砂場です。実際のチェーンには影響
  しません。下の3つのブロックは、キャンバスの『チェーン』カードと同じ
  仕組みでつながっています。どれかのブロックの『データ』を書き換えて
  みてください。」
- `hashDemo.open`: ja「ハッシュのしくみを試す」/ en "Try how hashes work"
  (ポップオーバー・カード常設入口の両方で使う)
- `hashDemo.field.number` ja「ブロック番号」/ `hashDemo.field.parentHash`
  ja「親ブロックのハッシュ」/ `hashDemo.field.data` ja「データ」
- `hashDemo.storedLabel`: ja「ブロックに格納されている情報」(枠見出し)
- `hashDemo.compute`: ja「keccak256 でハッシュ化」/ en "Hashed with keccak256"
- `hashDemo.blockHash`: ja「このブロックのハッシュ」/ en "This block's hash"
- `hashDemo.badge.valid` ja「有効」 / `hashDemo.badge.invalid` ja「無効:
  親ブロックのハッシュと食い違っています」
- `hashDemo.relink`: ja「親ハッシュをつなぎ直す」/ en "Re-link parent hash"
- `hashDemo.reset`: ja「最初に戻す」/ en "Reset"
- `hashDemo.genesisNote`: ja「(この砂場の起点。親はいません)」
- `hashDemo.repairedSummary`: ja「全部つなぎ直せてしまいました。1台の
  マシンの中では、後続のブロックをすべて作り直せば改ざんの辻褄を
  合わせられます。しかし実際のネットワークでは、同じチェーンのコピーを
  他の多くのノードが持っており、各ブロックには提案者の署名と検証
  (attestation)も必要です。1人で作り直したチェーンは受け入れられません。」
- `hashDemo.whoComputes`: ja「実際のチェーンでは、このハッシュ計算は
  ブロックを作った実行クライアント(reth など)が行い、受け取った各
  ノードも自分で再計算して検証します。chainviz(collector)はノードが
  報告した値をそのまま表示しています。」
- `hashDemo.simplifiedNote`: ja「実際のブロックはここに出した項目の
  ほかにも多くの情報(state root など)を含み、決められた形式(RLP)で
  並べてからハッシュ化します。この砂場では『中身が変わればハッシュが
  変わる』ことに絞って簡略化しています。」
- 英語版はすべて初稿を用意し chainviz-i18n レビューへ

#### 6. Issue #402 と共有するUX骨格(今回は骨格の意識のみ、先回り実装はしない)

- 「暗号デモ」共通パターン: **編集できる入力 → 処理帯(実アルゴリズム名
  を明示し、本物の計算を実行) → 導出値 → 有効/無効の検証バッジ →
  改変の影響が伝播する様子を色・破断で表現 → リセット → 『実際の
  ネットワークでは誰がこれをやるか』の説明文**。#402(署名・検証)は
  入力=tx内容+鍵、処理=署名/検証、出力=署名と検証結果、で同型
- 置き場所の提案: `packages/frontend/src/crypto-demo/` フォルダを新設し、
  ハッシュデモのビュー(`HashChainDemoView.tsx`)・純粋ロジック
  (`hashChainDemo.ts`: 状態型・初期値・導出・relink/reset)・ハッシュ
  表示や検証バッジ等の部品をここに置く。`SidePanelHost` は kind
  `"hashChainDemo"` をこのビューへディスパッチするだけ。#402 のデモは
  同じフォルダに並べる想定。ただし**今回はハッシュデモが実際に使う
  部品だけを作る**(共通化のための推測的な props を先に作らない)
- サイドパネルの kind はデモごとに分ける(`"hashChainDemo"`、#402 で
  `"signatureDemo"` 等)。1ファイル1責務と kind ディスパッチの既存
  パターンに沿う

#### 7. 型変更の要否・影響範囲

- **`packages/shared` の型変更: 不要**。砂場は完全にフロント内で閉じる
  (疑似データ+フロント内 keccak256 計算)。collector 変更も不要。
  モック(`mockData.ts`)の変更も不要(デモはデータソース非依存)
- 変更対象: `packages/frontend`(サイドパネル kind 追加・crypto-demo/
  新設・ポップオーバーとリボンカードへの導線・i18n 文言・依存に
  `@noble/hashes`)、`glossary/ethereum/terms/c-transaction.yaml`
- `docs/ARCHITECTURE.md` への正式な節の追加(§15 想定)は実装時に
  sync-docs で行う。`docs/CONCEPT.md` の体験イメージには「暗号の
  しくみを砂場でさわって学べる」旨の1項目を今回追記した

#### 8. テスト観点(実装担当・tester への申し送り)

- 純粋ロジック(`hashChainDemo.ts`)のユニットテスト: 編集→後続の
  無効化の連鎖、つなぎ直し→次ブロックだけ無効が残る連鎖、全修復判定、
  リセット。keccak256 は既知の入力→既知の出力の参照ベクトルで1本
- コンポーネントテスト: バッジ表示・relink ボタンの出現条件・
  ポップオーバーのボタンからパネルが開くこと・ja/en 両方の文言キー
- 「修正が元の不具合を検出できること」ルールに準じ、無効判定の
  テストは意図的に一致させた状態と食い違わせた状態の両方を張る

#### 9. 決めきれていない点(実装時の裁量・確認事項)

- リボンカード上の常設入口の正確な配置(subtitle 行末を第一候補と
  するが、cadence 表示との視覚的競合は実装時に現物で判断してよい)
- 文言(§5)はすべて初稿。日本語の言い回しの調整は実装担当の裁量、
  英語版は chainviz-i18n のレビューで確定
- E2E シナリオ(SCENARIOS.md)への追加要否は tester/qa の判断に委ねる

### 2026-07-19 Issue #401 実装設計メモ

- 担当: frontend
- ブランチ: issue-401-hash-computation-viz
- UX設計メモ(上記§1〜§9)をそのまま採用する。以下は実装時に確定させた
  詳細。

#### 依存関係

- `@noble/hashes`(v2系、`^2.2.0`)を `packages/frontend` の
  dependencies に追加した。v2 は sub-path importに拡張子 `.js` が必須
  (`@noble/hashes/sha3.js` / `@noble/hashes/utils.js`)。
  `keccak_256`(`sha3.js`)・`bytesToHex`/`utf8ToBytes`(`utils.js`)を使う。
  既知ベクトル(keccak256("") / keccak256("abc"))を実際に計算して
  参照値を確認した上でテストに固定値として使う。

#### モジュール構成(`packages/frontend/src/crypto-demo/`)

- `keccak256.ts`: `keccak256Hex(input: string): string`。UTF-8文字列→
  keccak256→`0x`+64桁hexの薄いラッパー(1ファイル1責務。#402が同じ
  ラッパーを再利用できる)
- `hashChainDemo.ts`: 状態型・導出・純粋な操作関数のみ(React 非依存)。
  - `HashChainDemoBlock { number, storedParentHash, data }` /
    `HashChainDemoState { blocks }`
  - `deriveBlockHash(block)`: `${number}|${storedParentHash}|${data}` を
    UTF-8連結してkeccak256(RLPは再現しない簡略化。UX設計§2の合意どおり)
  - `createInitialHashChainDemoState()`: #1のstoredParentHashは全ゼロ
    (`GENESIS_PARENT_HASH`)、#2以降は直前ブロックの導出ハッシュを記録
    した、3ブロックすべて有効な状態
  - `isBlockValid(blocks, index)` / `isFullyRepaired(blocks)`:
    「自身のstoredParentHashが直前ブロックの現在の導出ハッシュと
    一致するか」のみを見る(index 0 は常に有効)
  - `updateBlockData(state, index, data)` / `relinkBlock(state, index)` /
    `resetHashChainDemoState()`
  - **確定させた挙動(重要)**: ハッシュは各ブロック自身のフィールドだけ
    から決まる。あるブロックの `data` を編集しても、それより後ろの
    ブロックの `storedParentHash` は書き換わらないため、**即座に無効に
    なるのは直後の1ブロックだけ**であり、その次のブロックは、直後の
    ブロックを「つなぎ直す」操作で直後ブロック自身のハッシュが変わった
    時点で初めて無効になる(1回の relink ごとに無効の先頭が1つずつ
    後ろへ進む「連鎖修復」)。UX設計§3の操作フロー3
    「そのブロックは有効に戻るが、自身のハッシュも変わるため次はまだ
    無効」の記述に合わせた(§3冒頭の要約「後続ブロックがすべて無効に」は
    高レベルな要約であり、実装は3の詳細な記述を正とする)。最後尾
    ブロック(#3)を編集しても、この砂場には#4が無いため何も無効に
    ならない(実チェーンでも「まだ誰も積み上げていない最新ブロックの
    改ざんはハッシュ連結だけでは検知されない」という正しい挙動と一致
    する)
  - 「全部つなぎ直したらまとめメッセージ」の判定(`hasEverEdited &&
    isFullyRepaired`)はコンポーネント側のローカル state(UIの一時状態)
    で持ち、pure logic には持ち込まない(初期状態は無編集で既に有効
    なので、判定に「一度でも操作したか」を混ぜないと開いた瞬間から
    まとめメッセージが出てしまうため)
- `HashChainDemoView.tsx`: パネル本体(状態は useState でローカル完結、
  閉じたら破棄=毎回 `createInitialHashChainDemoState()` から)。ハッシュ
  変化時のフラッシュは既存の `NEW_ARRIVAL_HIGHLIGHT_DURATION_MS` /
  `chainviz-new-arrival` キーフレームを再利用する(新しい演出を作らない)
- `HashChainBlockRow.tsx`: ブロック1件の表示(格納情報の枠・処理帯・
  導出ハッシュ・バッジ・relinkボタン)。View から分離し1ファイル1責務を
  保つ

#### サイドパネル配線

- `sidePanelView.ts` に `{ kind: "hashChainDemo" }` を追加(保持する
  データなし。ビュー自身が閉じるたびに状態を作り直す設計のため
  `SidePanelView` 側にも何も乗せない)
- `SidePanelHost.tsx` に kind 分岐を1つ追加するだけ(対象エンティティを
  持たないため commsLog と同じくダングリングガード対象外)

#### 導線

- チェーンリボンカードの `subtitle` 行を横並び(flex)にし、行末に
  常設の入口ボタンを1つ追加する(cadence 表示はヘッダ側にあり競合しない
  ため、決めきれていない点として挙げられていた配置はこれで確定)
- `ChainRibbonPopover` の末尾に文脈導線ボタンを1つ追加
- どちらも `useOptionalSidePanel()` を使う(`ChainRibbonCard`/
  `ChainRibbonPopover` の既存テストは `SidePanelProvider` 無しで
  レンダーしているため、`useSidePanel()` だと throw してしまう。
  `GlossaryTerm.tsx` と同じパターン)

#### 用語集・ポップオーバー

- `glossary/ethereum/terms/c-transaction.yaml` に `hash` エントリを
  新設、`block` の `relatedTerms` に `hash` を追加
- `ChainRibbonPopover` の「ハッシュ」「親ブロック」ラベルに
  `GlossaryTerm termKey="hash"` を付ける

#### テスト方針

- `hashChainDemo.ts`: pure logic のユニットテスト(初期状態の健全性、
  編集による直後1件だけの無効化、relink連鎖、全修復判定、reset、
  最後尾ブロック編集の無害さ)
- `keccak256.ts`: 既知ベクトル1本
- `HashChainDemoView`: コンポーネントテスト(編集→バッジ変化→relink→
  まとめメッセージ→reset の一連の流れ、ja/en 文言)。1ファイルに
  積みすぎないよう「操作フロー」と「文言・i18n」でテストファイルを分ける
- 導線(`ChainRibbonCard`/`ChainRibbonPopover` からパネルが開くこと)は
  既存ファイルに足すと既に400行超あるため、専用の
  `*.hashDemoEntry.test.tsx` を新設する
- `SidePanelHost` の kind 追加は既存の1kind1ファイル方針に従い
  `SidePanelHost.hashChainDemo.test.tsx` を新設する
- E2E: 完全にフロント内で閉じる砂場でチェーン進行や実データに依存
  しないため、Docker起動を要する既存のUI層E2Eの重さに対して得られる
  検証の増分が小さい(コンポーネントテストで操作フロー・状態遷移は
  ほぼ検証できる)。一方で「実際のブラウザで入口ボタンから最後まで
  一連の操作が通ること」は新規インタラクティブ機能として一度は
  実ブラウザで確認する価値があるため、軽量な1シナリオ
  (`UI-HASH-01`)だけ追加する(SCENARIOS.mdへの追記も行う)

### 2026-07-19 Issue #401 実装完了報告

- 担当: frontend
- ブランチ: issue-401-hash-computation-viz
- 実装内容(設計メモどおり):
  - 依存: `packages/frontend/package.json` に `@noble/hashes@^2.2.0` を追加
  - `packages/frontend/src/crypto-demo/`: `keccak256.ts`(薄いラッパー)・
    `hashChainDemo.ts`(状態型・導出・純粋な操作関数)・
    `HashChainBlockRow.tsx`・`HashChainDemoView.tsx`
  - `side-panel/sidePanelView.ts` に `{ kind: "hashChainDemo" }` を追加、
    `SidePanelHost.tsx` に分岐を1つ追加
  - `entities/ChainRibbonCard.tsx`(subtitle 行末の常設入口ボタン)・
    `entities/ChainRibbonPopover.tsx`(末尾の文脈導線ボタン、「ハッシュ」
    「親ブロック」ラベルへの `GlossaryTerm termKey="hash"` 付与)
  - `glossary/ethereum/terms/c-transaction.yaml`: `hash` エントリ新設、
    `block` の `relatedTerms` に `hash` を追加
  - `i18n/messages.ts`: `hashDemo.*` 名前空間を追加(ja確定・en初稿。
    chainviz-i18n レビュー待ち)
  - `styles.css`: `.hash-chain-demo*`(パネル本体)・
    `.chain-ribbon-card__hash-demo-open` /
    `.chain-ribbon-popover__hash-demo-open`(導線)を追加
  - `docs/ARCHITECTURE.md` に §15 を新設(データフロー・連鎖修復の
    仕組み・導線・#402との共有骨格)
  - `packages/e2e/SCENARIOS.md` に「ハッシュのしくみ」デモ(UI-HASH)節、
    `packages/e2e/src/ui/hash-chain-demo.spec.ts`(UI-HASH-01)を追加
- 実装中に確定させた挙動(設計時点でやや曖昧だった箇所): データ編集で
  即座に無効になるのは直後の1ブロックのみで、後続はrelinkのたびに
  1つずつ連鎖する(実装設計メモの節を参照。UX設計§3冒頭の要約「後続が
  すべて無効に」は高レベルな言い回しで、詳細な操作フロー3の記述と実装は
  一致させた)

### 2026-07-19 Issue #401 テスト強化メモ

- 担当: tester
- ブランチ: issue-401-hash-computation-viz
- 目的: 実装担当が書いた基本テスト(ハッピーパス中心)に対し、異常系・
  境界値・状態遷移の網羅性を補強する。新機能の実装は行わない。
- 既存テストの棚卸し結果(カバー済み):
  - `keccak256.test.ts`: 空文字列・"abc"の既知ベクトル、format、雪崩効果、決定性
  - `hashChainDemo.test.ts`: 初期状態の健全性、先頭ブロック編集→直後1件のみ
    無効、末尾ブロック編集の無害さ、relink連鎖、reset、不変性
  - `HashChainDemoView.test.tsx` / `.i18n.test.tsx`: 操作フロー・ja/en文言
  - `SidePanelHost.hashChainDemo.test.tsx`: kind振り分け・contractSourceとの
    排他・ダングリングガード対象外
  - 導線2種(カード常設入口・ポップオーバー文脈導線)のクリックでパネルが開くこと
- 抜けていた観点と追加方針(1ファイル1責務のため関心事ごとに新規ファイル):
  1. 状態遷移の全ブロック一貫性: 中間ブロック(index 1)編集のケースが未カバー。
     3ブロックすべてを対象にした編集の一貫性、tamper→元データに戻すと
     relinkなしで有効に戻る往復、同値編集の無害性、複数同時編集、
     already-valid ブロックへのrelinkの冪等性、範囲外indexの防御的挙動を
     `hashChainDemo.edgeCases.test.ts` に追加
  2. keccak256境界値: 長大文字列・多バイトUnicode・絵文字(サロゲートペア)・
     Unicode正規化差(合成/分解)・空白/改行差を `keccak256.boundary.test.ts` に追加
  3. サイドパネルkind共存: glossary/commsLogとの排他、および閉じて開き直すと
     デモ状態が初期化されること(kind切替で混線しないこと)を
     `SidePanelHost.hashChainDemo.test.tsx` に追記
  4. アクセシビリティ: 導線ボタン・relink・reset・データ入力のアクセシブル名/
     role(キーボード到達可能性)、無効バッジが色だけでなく文言で状態を伝える
     ことを検証。パネル内は `HashChainDemoView.a11y.test.tsx`、導線は各
     エントリテストにrole/name assertionを追記

### 2026-07-19 Issue #401 テスト強化 実施記録

- 担当: tester
- ブランチ: issue-401-hash-computation-viz
- 追加したテスト(既存実装への追加のみ。新機能の実装なし):
  - `crypto-demo/hashChainDemo.edgeCases.test.ts`(新規, 15ケース): 先頭・
    中間・末尾の全ブロック編集の一貫性(`it.each`)、中間ブロック編集で
    先頭が無関係なこと、改ざん→元データに戻すとrelinkなしで有効に戻る往復、
    同値編集の無害性、複数同時編集で2件同時に無効、deriveBlockHashが
    number/parentHash/data 各フィールドに依存すること、relinkの冪等性、
    範囲外index(負・末尾超・空配列)の防御的挙動、reset
  - `crypto-demo/keccak256.boundary.test.ts`(新規, 6ケース): 100k文字の
    長大入力、多バイトUnicode、絵文字(サロゲートペア)、Unicode正規化差
    (合成U+00E9 vs 分解e+U+0301)、空白/改行差、空文字列 vs 空白/NUL
  - `crypto-demo/HashChainDemoView.a11y.test.tsx`(新規, 5ケース): データ
    入力のlabelled textbox、reset/relinkのアクセシブル名付き<button>、
    無効バッジが色だけでなく文言で状態を伝えること、装飾要素のaria-hidden
  - `entities/ChainRibbonCard.hashDemoEntry.test.tsx` /
    `ChainRibbonPopover.hashDemoEntry.test.tsx`: 導線ボタンがアクセシブル名
    付きの実<button>(キーボード到達可能)であることのrole/name assertionを追記
  - `side-panel/SidePanelHost.hashChainDemo.test.tsx`: glossary/commsLogとの
    排他、および別kindへ切り替えて開き直すとデモ状態が初期化される
    (改ざん内容がkind切替で残らない)ことを追記
- 検証: `pnpm --filter @chainviz/frontend build` 通過、`pnpm lint`(リポジトリ
  全体)通過、`pnpm --filter @chainviz/frontend test` 通過
  (225 test files / 2924 tests。強化前は222 files / 2894 tests、+3 files / +30 tests)。
- 発見した懸念点(低severity・今回は修正せず記録のみ):
  - `deriveBlockHash` はフィールドを `|` 区切りで連結してハッシュ化する
    (`${number}|${storedParentHash}|${data}`)。`data` はユーザーが自由に
    編集でき `|` を含められるため、原理的には区切りの曖昧性による衝突が
    考えられる(例: parentHash="a", data="b|c" と parentHash="a|b", data="c"
    は同じ連結文字列になる)。ただし `storedParentHash` は常に `0x`+64hex
    (導出ハッシュか GENESIS_PARENT_HASH)で `|` を含まず、ユーザーは
    直接編集できない(relinkでのみ書き換わる)ため、実際に到達可能な衝突は
    無い。学習用の砂場であり実害はないため実装変更は不要と判断。将来
    フィールド構成を変える場合の注意点として記録する。
- テスト: `pnpm lint && pnpm build && pnpm test` をリポジトリ全体
  （shared/collector/e2e(unit)/frontend）で実行し全て通過
  （frontend: 222 test files / 2894 tests）。新規追加したユニット・
  コンポーネントテストは以下:
  - `crypto-demo/keccak256.test.ts`(既知ベクトル・雪崩効果・決定性)
  - `crypto-demo/hashChainDemo.test.ts`(初期状態・編集による直後1件の
    無効化・relink連鎖・reset。意図的に「編集前は全有効」を確認してから
    「編集後に直後だけ無効」を確認する形で回帰検出力を確保)
  - `crypto-demo/HashChainDemoView.test.tsx` /
    `HashChainDemoView.i18n.test.tsx`
  - `side-panel/SidePanelHost.hashChainDemo.test.tsx`
  - `entities/ChainRibbonCard.hashDemoEntry.test.tsx` /
    `entities/ChainRibbonPopover.hashDemoEntry.test.tsx`
- E2E(`UI-HASH-01`)の実行状況: `tsc --noEmit`(`packages/e2e`)は通過。
  実ブラウザでの実行はこの作業環境ではできなかった
  (`chrome-headless-shell: error while loading shared libraries:
  libnspr4.so`。ARCHITECTURE.md §8.6 が前提とする
  `playwright install-deps chromium` にはsudo権限が必要で、この作業
  環境には無い)。テストIDは実装側と一致していること・シナリオの
  各ステップがコンポーネントテスト(`HashChainDemoView.test.tsx`)で
  検証済みの状態遷移と1対1で対応していることを確認した。
  **chainviz-qa は実ブラウザでの `UI-HASH-01` 実行を必ず確認すること**
  （このIssueの完了条件の一部として残っている）
- 次の担当への注意点:
  - `hashDemo.*` の英語文言は初稿。chainviz-i18n のレビューで文言が
    変わる可能性がある(テストの `getByText` は日本語アサーションを
    主にしているため、英語文言変更の影響は
    `HashChainDemoView.i18n.test.tsx` の該当英語アサーションのみ)
  - チェーンリボンカードの常設入口配置は「subtitle 行末」に決めた
    (UX設計 §9 で決めきれていない点として挙げられていた項目)。cadence
    表示(ヘッダ側)とは競合しないことを確認済み
