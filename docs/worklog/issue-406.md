# Issue #406 ハッシュ・署名デモの f(x) の入力(x)が不明瞭 / keccak256 の規格説明が無い

### 2026-07-19 Issue #406 UX設計メモ

- 担当: ux
- ブランチ: issue-406-hash-input-clarity
- 内容: ユーザー指摘2点(「f(x) の x に何が入るのか分かりにくい」
  「keccak256 がどんな規格のハッシュなのか説明が欲しい」)に対するUX設計。
  実装は chainviz-frontend が本メモを引き継いで行う。

#### 1. 実際に触って確認した課題

モックデータで frontend を起動し(`pnpm --filter @chainviz/frontend dev`、
`VITE_COLLECTOR_URL` 未設定)、Playwright(packages/e2e の chromium)で
両デモを操作して確認した。

- ハッシュデモ: 処理帯には「f(x) keccak256 でハッシュ化」とだけあり、
  すぐ上に並ぶ3つのフィールド(ブロック番号・親ブロックのハッシュ・
  データ)が f(x) の入力だとはどこにも書かれていない。特に「親ハッシュも
  入力に含まれる」ことが読み取れないと、relink 後に自分のハッシュまで
  変わる連鎖(このデモの核心)が「なぜそうなるのか」不明のまま進む
- 署名デモ: 「f(x) secp256k1 で署名」の x が「内容(送信者|宛先|金額)を
  keccak256 したハッシュ」であることは画面のどこにも出てこない。
  検証側「f⁻¹(x)」も、届いた署名と「届いた内容から計算し直したハッシュ」
  の2つが入力であること(改ざん検知が成立する理由そのもの)が読めない
- keccak256 という語は処理帯・`sigDemo.addressNote` 等に素のテキストで
  登場するが、用語集エントリが無くホバー解説も出ない。既存の `hash`
  エントリは「ハッシュとは何か」の一般概念で、keccak256 という規格の
  説明(SHA-3 との関係・出力長・イーサリアムでの用途)は無い
- 処理帯全体が `aria-hidden="true"` のため、「keccak256 でハッシュ化」
  「secp256k1 で署名」という実質的な説明文言までスクリーンリーダーから
  隠れている(装飾は f(x) トークンだけのはずが、帯ごと隠している)

#### 2. 設計判断

- **x の中身は常時表示にする**(ホバー/クリック格納にしない)。
  「ハッシュは何から計算されるか」はこのデモの学習内容そのもので、
  隠すべき補足ではない。ホバー依存はタッチ環境でも失われる
- 表示は数式の続きとして「x = …」の1行を処理帯の2行目に足す形にする。
  f(x) という既存の装飾がそのまま「左辺」として意味を持つようになり、
  文言も実装(`deriveBlockHash` / `messageHash` の `|` 連結)と字面どおり
  一致させられる(表示している式が嘘にならない)
- ハッシュデモでは3ブロックそれぞれの処理帯に繰り返し出す。冗長ではなく、
  「各ブロックのハッシュが自分の3項目(親ハッシュ含む)から決まる」という
  連鎖の仕組みの反復強調になる
- **keccak256 は用語集エントリを新設する**(既存 `hash` の拡充ではなく)。
  理由: (a) `hash` は一般概念、keccak256 は特定の規格で関心事が別。
  `hash` の定義は既に長く、規格の詳細を足すとポップオーバーの6行
  クランプから核心があふれる (b) 画面上の「keccak256」という語に
  アンカーを付けたとき、開くべきは keccak256 自体の説明であるべき
  (c) relatedTerms で `hash` と相互リンクすれば両方に自然に辿り着ける
- 文言中の keccak256 へのアンカー付けは既存の `withTermAnchor`
  (`glossary/withTermAnchor.tsx`)をそのまま使う。ja/en どちらの訳文にも
  「keccak256」という部分文字列が現れるため機構がそのまま効く
- 署名デモに中間値「tx のハッシュ」の表示行を新設することも検討したが、
  今回は見送る。x 行の文言だけで「ハッシュに署名する」ことは伝わり、
  行を増やすとゾーンが縦に伸びて改ざん体験の往復(上下ゾーンの見比べ)が
  しづらくなる。必要になったら別Issueで判断する

#### 3. f(x) の x を明示する見せ方(情報の見せ方の仕様)

処理帯(`.hash-chain-demo__compute` / `.signature-demo__compute`)を
2行構成にする:

```
f(x)  keccak256 でハッシュ化          ← 既存行(keccak256 にアンカー)
x = ブロック番号 | 親ブロックのハッシュ | データ   ← 新設の x 行
```

- x 行の「x =」部分は f(x) トークンと同じ見た目(monospace・アクセント色)
  で対にし、残りは既存の説明文言と同じ muted・11px。パネル幅で自然に
  折り返してよい
- x 行に使う項目名は、直上に表示されているフィールドラベルの文言と
  完全一致させる(ja: ブロック番号/親ブロックのハッシュ/データ。
  en も同様)。読者が「上のあの欄のことだ」と照合できることが目的
- 区切り文字は実装と同じ半角 `|` を使う(実際の連結記号そのもの)
- 署名デモ・署名側: `x = keccak256(送信者 | 宛先 | 金額)` に加え、
  「内容をまずハッシュ化し、そのハッシュに署名する」ことを短文で補う
  (指摘2の「x は keccak256 済みのハッシュ」への直接の回答)
- 署名デモ・検証側(f⁻¹(x))にも同型の x 行を足す:
  「届いた署名」と「届いた内容から計算し直したハッシュ」の2入力。
  検証がハッシュを**届いた内容から**再計算することは改ざん検知の
  成立理由なので、ここを省かない

a11y(aria-hidden の扱い):

- 処理帯コンテナの `aria-hidden="true"` は**外す**。アルゴリズム名と
  x 行は読み上げ対象の実コンテンツになる。また x 行内の keccak256 に
  `GlossaryTerm`(フォーカス可能)を置くため、aria-hidden 内に
  フォーカス可能要素を置く違反を避ける意味でも必須
- `f(x)` / `f⁻¹(x)` トークン単体は、読み上げが不自然になるようなら
  トークンの span だけ `aria-hidden` を残してよい(実装時に判断)。
  その場合も x 行・説明文言は必ず読み上げ対象に保つ

#### 4. keccak256 用語集エントリ(新設)

`glossary/ethereum/terms/c-transaction.yaml` に追加(層は、この語が
主に登場する tx・ブロックの文脈に合わせ c-transaction):

- キー: `keccak256`
- name: ja「keccak256(ケチャック256)」/ en "keccak256"
- definition に含める要素(ja 初稿):
  「イーサリアム全体で使われているハッシュ関数。どんな長さの入力からも
  256bit(32バイト)の値を計算する。SHA-3 の標準化のもとになった Keccak
  を、NIST が標準化(その際にパディング方式を変更)する前の仕様のまま
  採用しているため、同じ入力でも標準の SHA-3-256 とは別の値になる。
  ブロックや tx のハッシュのほか、アドレスの導出(公開鍵のハッシュの
  末尾20バイト)、ステート/ストレージを格納する Merkle Patricia Trie の
  キー、イベントログの topic など、イーサリアムのあらゆる場所でこの
  関数が使われている。chainviz の『ハッシュのしくみ』『署名と検証の
  しくみ』砂場デモでは、この keccak256 を実際に計算している。」
- en は同内容の初稿を書き、chainviz-i18n のレビューへ回す
- ポップオーバーは6行クランプされるため、規格の核心(用途・出力長・
  SHA-3 との違い)を定義文の前半に置く
- relatedTerms: `[hash, signature, block]`
- 既存エントリの相互リンク: `hash` の relatedTerms に `keccak256` を
  追加(`[block, transaction, keccak256]`)。`signature` にも追加
  (アドレス導出・メッセージハッシュの両方で関係が深い)

アンカーを付ける場所(いずれも `withTermAnchor(text, "keccak256",
"keccak256")` で最初の1箇所):

1. ハッシュデモ処理帯の `hashDemo.compute`(keccak256 でハッシュ化)
2. 署名デモ・署名側の新設 x 行(`sigDemo.computeInput.sign`)
3. 署名デモ・検証側の新設 x 行(`sigDemo.computeInput.verify`)
4. `sigDemo.addressNote`(アドレス導出の説明。既に keccak256 が登場)

#### 5. 新設する i18n 文言(初稿。調整は実装担当の裁量)

- `hashDemo.computeInput`:
  - ja「x = ブロック番号 | 親ブロックのハッシュ | データ(上の3項目を
    この順につなげた文字列です)」
  - en "x = block number | parent block's hash | data (the three fields
    above, joined in this order)"
- `sigDemo.computeInput.sign`:
  - ja「x = keccak256(送信者 | 宛先 | 金額)。内容をまず keccak256 で
    ハッシュ化し、そのハッシュに署名します。」
  - en "x = keccak256(sender | to | amount). The content is hashed with
    keccak256 first, and that hash is what gets signed."
- `sigDemo.computeInput.verify`:
  - ja「x = 届いた署名 と keccak256(送信者 | 宛先 | 金額)。ハッシュは
    届いた内容から計算し直します。」
  - en "x = the received signature and keccak256(sender | to | amount),
    recomputed from the content that arrived."
- 既存キー(`hashDemo.compute` 等)の文言自体は変更不要。英語版は
  chainviz-i18n レビュー対象

#### 6. 型変更の要否・影響範囲・docs 整合

- **`packages/shared` の型変更: 不要**。collector・モックデータの変更も
  不要(デモはデータソース非依存。#401/#402 と同じ)
- 変更対象: `packages/frontend`(HashChainBlockRow.tsx /
  SignatureDemoView.tsx / messages.ts / styles.css)、
  `glossary/ethereum/terms/c-transaction.yaml`
- `docs/CONCEPT.md`: 変更不要と確認した。体験イメージの「砂場」
  「用語解説」の記述と整合し、矛盾する決定事項は無い
- `docs/ARCHITECTURE.md`: 実装時に sync-docs で以下を追記する方針。
  §15.4(暗号デモ共通骨格)の処理帯の記述を「アルゴリズム名(用語集
  アンカー付き)+ 入力 x を明示する行」に更新し、keccak256 エントリの
  新設を §15.3 または §5(用語集)の文脈に反映する

#### 7. テスト観点(実装担当・tester への申し送り)

- コンポーネントテスト: 両デモの処理帯に x 行が ja/en 両言語で
  表示されること。`glossary-term-keccak256` のアンカー testid が
  ハッシュデモ・署名デモ双方に存在すること
- aria-hidden を外した回帰: 処理帯の説明文言が accessibility tree に
  乗ること(`getByText` が `hidden: true` 無しで取れる等)を1本張る
- 用語集: keccak256 エントリが読み込まれ `GlossaryTerm` で解決される
  こと。relatedTerms の相互参照(hash/signature 側への追加)が既存の
  参照解決(`resolveRelatedTermLabel`)で生キー表示にならないこと
- 文言変更で `withTermAnchor` の部分一致が外れるとアンカーが静かに
  消える(防御的フォールバック)ため、ja/en 双方でアンカー存在を
  明示的にテストする

#### 8. 決めきれていない点(実装時の裁量)

- x 行の折り返し・字間などの見た目の微調整(パネル幅 420px 前後で
  2行に折り返しても可読なこと、を満たせば裁量でよい)
- `f⁻¹(x)` トークンの読み上げ(§3 の a11y 項のとおり、トークン span
  単体の aria-hidden 残置は実装時にスクリーンリーダーの実挙動で判断)
- 文言初稿の言い回し調整(意味を変えない範囲で裁量。英語は
  chainviz-i18n レビューで確定)
