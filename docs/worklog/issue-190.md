# Issue #190 作業記録

### 2026-07-08 Issue #190 D層用語データ(d-internal.yaml)の設計メモ (frontend)

- 担当: frontend
- ブランチ: issue-190-d-layer-glossary
- 対応する仕様: `docs/ARCHITECTURE.md` §7.6.9(用語解説(D層)の方針)。
  §7.6.9 の表(termKey・主なアンカー・定義に必ず含めるポイント)と
  relatedTerms 配線の指定をそのまま踏襲する。

#### 実装方針(各用語の説明内容の要点)

新規ファイル `glossary/ethereum/terms/d-internal.yaml` を作成し、
`layer: d-internal` で4用語を追加する。既存 c-transaction.yaml の
Issue #169 の書き方(定義 → なぜ必要か → chainviz ではどう見えるか、の
3拍子を `>-` ブロックで ja/en 両方書く)をそのまま踏襲する。

1. `engine-api`(Engine API)
   - 定義: 合意(CL)と実行(EL)を繋ぐ内部API。CLが「このブロックを実行して」
     「チェーンの先端はここ」とELへ指示することでチェーンが進む。
   - なぜ必要か: The Merge 以降、合意と実行が別プロセス(別クライアント)に
     分かれたため、両者を結ぶ結び目が必要になった。
   - chainvizでは: beacon→rethの内部リンクの紐と、その上を流れるパルス。
     パルス1本は「観測間隔内に1回以上の呼び出しがあったこと」を示す
     ハートビートであり、呼び出し回数の内訳はホバーのポップオーバーで
     見えることを明記する(§7.6.4の増分観測に誠実な表現にする指示に対応)。
   - relatedTerms: `el-cl-separation`, `el-client`, `cl-client`

2. `el-cl-separation`(EL/CL分離)
   - 定義: 1つのEthereumノードがEL(実行)とCL(合意)という2つの別プロセスの
     組で構成されること(The Merge以降の標準構成)。
   - なぜ必要か: PoS移行で合意の仕組みを丸ごと差し替える際、実行部分を
     温存しつつ合意だけを別プロセスへ分離した。役割分担により各クライアント
     実装を独立に開発・交換できる。
   - chainvizでは: ノードを追加すると必ずreth+beaconの2枚のカードが対で
     現れ、内部リンクのエッジで結ばれる。
   - relatedTerms: `engine-api`, `el-client`, `cl-client`

3. `staged-sync`(ステージ型同期)
   - 定義: 追いつき同期を「ヘッダ取得→実行→索引作成…」という段階に分け、
     ブロック範囲ごとにまとめて処理する方式(rethが採用)。
   - なぜ必要か: 1ブロックずつ全処理を繰り返すより、段階ごとにディスク
     アクセスがまとまり、桁違いに速く追いつける。
   - chainvizでは: 同期中のrethカードとその詳細(ポップオーバー)に、各段階が
     どのブロック高まで進んだかがバーの列として見える。
   - relatedTerms: `el-client`(§7.6.9 は「block系」への配線も示唆しているが、
     現状の glossary には `block` という termKey が存在しないため、
     存在しないキーへのダングリング参照は作らない。`block` 用語が将来
     追加された際に relatedTerms へ追記する)

4. `txpool`(txpool)
   - 定義: ノードが自分の中に持つ、ブロック未取り込みtxの置き場
     (mempoolのノード内実体)。pending=すぐ取り込める状態のtx、
     queued=nonceの飛び等の前提条件待ちのtx。
   - なぜ必要か: txはブロックに入るまでどこかに保持される必要があり、
     それは各ノードのローカルな仕事(だからノードごとに中身が違う)。
   - chainvizでは: rethノードの詳細にpending/queuedの実数が表示される。
   - **既存 `mempool`(c-transaction.yaml)との関係**: 「mempoolはチェーン
     全体の概念としての待機列、txpoolはこのノードが実際に抱えている実数
     (ノード内部の実体)」という概念⇄実体の対応を定義文に明記し、
     relatedTerms で相互リンクする。
   - relatedTerms: `mempool`, `transaction`, `nonce`

#### 既存用語への逆リンク追加

§7.6.9 の指示どおり、既存 `el-client` / `cl-client` / `mempool` の
relatedTerms にも新用語への逆リンクを追記する:

- `a-infra.yaml` の `el-client`: `[cl-client, container]` →
  `[cl-client, container, engine-api, el-cl-separation, staged-sync]`
- `a-infra.yaml` の `cl-client`: `[el-client, container]` →
  `[el-client, container, engine-api, el-cl-separation]`
- `c-transaction.yaml` の `mempool`: `[transaction, gas]` →
  `[transaction, gas, txpool]`

#### 重複キー確認(Issue #123の教訓)

追加前に既存3ファイル(a-infra/b-network/c-transaction)全キーと新規4キー
(engine-api/el-cl-separation/staged-sync/txpool)を突き合わせ、重複が
無いことを確認してから追記する。`packages/frontend/src/glossary/
parse.test.ts` の「real glossary data files」回帰テスト(Issue #123由来)は
d-internal.yaml を含む4ファイル横断へ対象を拡張する(後述)。

#### パースロジック・テストへの影響

- `packages/frontend/src/glossary/data.ts` は d-internal.yaml を新規
  インポートしてマージ対象に加える必要がある(新規ファイル追加のため
  必須の変更。`parse.ts` 自体のロジック変更は不要)。
- `parse.test.ts` の「real glossary data files」回帰テスト(Issue #123の
  bootnode重複事故対策)は、`glossary/data.ts` が実際に読む全ファイルを
  対象にする設計のため、d-internal.yaml を4件目としてリストに追加する。
  これを追加しないと新規ファイルが回帰テストの保護範囲から漏れるため、
  今回のテスト変更は「ロジックを伴う変更」に該当すると判断し実施する。

以下、実装を進める。

#### 実施結果

設計メモどおりに実装した。

- `glossary/ethereum/terms/d-internal.yaml` を新規作成し、4用語
  (`engine-api`/`el-cl-separation`/`staged-sync`/`txpool`)を
  `layer: d-internal` で追加した。各エントリは既存ファイルと同じ
  `>-` ブロック記法・「定義 → なぜ必要か → chainviz ではどう見えるか」の
  3拍子で ja/en 両方を書いている。
- `glossary/ethereum/terms/a-infra.yaml` の `el-client` / `cl-client` の
  `relatedTerms` に新用語への逆リンクを追加した(`el-client` は
  `engine-api`/`el-cl-separation`/`staged-sync`、`cl-client` は
  `engine-api`/`el-cl-separation`)。
- `glossary/ethereum/terms/c-transaction.yaml` の `mempool` の
  `relatedTerms` に `txpool` を追加し、C層の概念(mempool)とD層の実体
  (txpool)の相互リンクを張った。
- `staged-sync` の relatedTerms について、§7.6.9 は「block系」への配線も
  示唆しているが、現状の glossary 全体(4ファイル)に `block` という
  termKey が存在しないため追加しなかった(存在しないキーへのダングリング
  参照を作らないため)。`block` 用語が将来追加された際に追記する必要が
  ある旨をここに記録しておく。
- 重複キー確認(Issue #123の教訓): 追加前に既存3ファイル+新規4キーを
  突き合わせ、重複が無いことをテキスト走査で確認してから追記した。
- `packages/frontend/src/glossary/data.ts` に d-internal.yaml の
  `?raw` インポートを追加し、`mergeGlossaries` の対象に加えた
  (`parse.ts` 自体のロジック変更は不要だった)。
- `packages/frontend/src/glossary/parse.test.ts` の「real glossary data
  files」回帰テスト(Issue #123由来)に d-internal.yaml を4件目として
  追加し、`parses every real glossary file without throwing`・
  `has no duplicate term keys`・`merges all real files into a single
  glossary without key collisions` の3テストが新規ファイルもカバーする
  ようにした。
- 動作確認:
  - `pnpm --filter @chainviz/frontend dev` で vite dev server を起動し、
    ルートへの HTTP リクエストが 200 を返すこと、サーバーログに例外が
    無いことを確認した(=`data.ts` のモジュール初期化時のパース+マージが
    新規ファイル追加後も例外なく完了することの確認)。
  - `pnpm --filter @chainviz/frontend build`(`tsc -b`)成功。
  - `pnpm --filter @chainviz/frontend build:web`(vite本番ビルド)成功。
    生成された JS バンドルに4用語の本文テキスト(`Engine API`・
    `EL/CL`・`ステージ型同期`・`Staged sync`)が埋め込まれていることを
    grep で確認した。
  - `pnpm --filter @chainviz/frontend test`: 76ファイル1205テストすべて
    成功(`glossary/parse.test.ts` は17テスト)。
  - **UIアンカーは本Issueのスコープ外**。§7.6.9 が挙げるアンカー
    (内部リンクエッジポップオーバーの見出し、InfraPopoverの「同期
    ステージ」「txpool」ラベル等)は #188/#189 で実装される。Issue #124の
    教訓(アンカー無しの用語は存在しないのと同じ)を踏まえ、#188/#189の
    実装担当は本Issueで追加した4 termKeyを実際に `<GlossaryTerm>` から
    参照することを確認する必要がある(ステップ9の完了条件で担保)。
  - 英語訳の自然さは chainviz-i18n のレビュー待ち(Issue #169の precedent
    どおり)。
- 変更ファイル: `glossary/ethereum/terms/d-internal.yaml`(新規)、
  `glossary/ethereum/terms/a-infra.yaml`、
  `glossary/ethereum/terms/c-transaction.yaml`、
  `packages/frontend/src/glossary/data.ts`、
  `packages/frontend/src/glossary/parse.test.ts`、
  `docs/PLAN.md`(ステップ9チェック)、`docs/WORKLOG.md`(索引)。

### 2026-07-08 Issue #190 D層用語データ - 英語訳レビュー
- 担当: i18n
- ブランチ: issue-190-d-layer-glossary
- 内容: `glossary/ethereum/terms/d-internal.yaml` の4用語
  (`engine-api`/`el-cl-separation`/`staged-sync`/`txpool`)の `en`
  フィールドについて、自然さ・技術的正確さをレビューした。日本語側の
  定義内容(何を書くべきか)はレビュー対象外(frontend の担当)。
- 修正した箇所(直接編集):
  - `engine-api`: "this API became the join that ties the two together"
    の `join` は名詞としての用法が不自然だったため、`seam`(つなぎ目)に
    差し替えて "the seam that ties the two back together" とした。
  - `el-cl-separation`: 冒頭が "The fact that one Ethereum node is made
    of two separate processes..." となっており、他の用語エントリ(例:
    `a-infra.yaml` の `container`・`b-network.yaml` の各エントリ)が
    名詞句で書き始める文体と揃っていなかったため、"The arrangement in
    which a single Ethereum node consists of two separate processes..."
    に書き換えて文体を統一した。
  - `txpool`: 冒頭の "The place a node keeps transactions it holds that
    have not yet been included in a block" が keeps/holds で意味が重複
    しており不自然だったため、"The place inside a node where
    transactions that have not yet been included in a block are held"
    に整理した。あわせて括弧書き "(the mempool's per-node reality)" は
    意味が伝わりにくかったため "(the node's local counterpart to the
    mempool)" に変更した。
- 技術的な正確さの確認: Engine API・EL/CL分離・reth のステージ型同期
  (staged sync。Erigon由来の設計をrethが採用)・txpool(geth/rethで
  共通に使われる用語)のいずれも実際の Ethereum/reth の用語法と矛盾しない
  ことを確認した。`name.en` 自体(用語名)は変更していない。
- 注意点: `relatedTerms` による既存エントリ(`el-client`/`cl-client`/
  `mempool`)への逆リンク追加分はテキストを含まないためレビュー対象外。
  次にこのファイルへ用語を追加する担当者は、今回統一した「名詞句で
  書き始める」文体("The fact that..." を避ける)を踏襲すると一貫性が
  保てる。
- 本レビューは英語テキストのみの変更であり、ロジック変更を伴わないため
  ユニットテストの追加は不要。

### 2026-07-08 Issue #190 D層用語データ - レビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-190-d-layer-glossary(レビュー時点で未コミット)
- 判定: **合格**(コード・データの修正指摘なし)
- 確認した内容:
  1. 形式の一貫性: d-internal.yaml は既存3ファイルと同じ構造
     (冒頭コメント、`name`/`definition` の `{ja, en}`、`>-` ブロック記法、
     `layer` がファイル名と一致する `d-internal`、`relatedTerms` 配列)で
     書かれており一貫している。
  2. キー重複(Issue #123 の教訓): glossary/ 配下の全4ファイル
     (terms/ 以外に yaml ファイルは存在しない)を js-yaml で実際に
     パースし、全29キーに重複が無いことをスクリプトで確認した。
     parse.test.ts の回帰テスト(単一ファイル内重複・マージ後の
     キー数一致)も d-internal.yaml を対象に拡張済み。
  3. 定義内容: 4用語とも docs/ARCHITECTURE.md §7.6.9 の表の
     「定義に必ず含めるポイント」を漏れなく含み、「定義 → なぜ必要か →
     chainviz ではどう見えるか」の3拍子で書かれている(engine-api の
     「パルス1本 = 観測間隔内に1回以上」のハートビート意味論、txpool の
     pending/queued と mempool との概念⇄実体の対応関係も明記されている)。
  4. relatedTerms の整合性: 全ファイル横断で参照先の存在をスクリプトで
     確認し、ダングリング参照は0件。§7.6.9 の配線指定
     (engine-api ↔ el-cl-separation ↔ el-client/cl-client、
     txpool ↔ mempool/transaction/nonce、既存 el-client/cl-client/mempool
     への逆リンク)はすべて実施されている。staged-sync の「block系」を
     追加しなかった判断は正しい(glossary に `block` という termKey が
     存在せず、GlossaryTerm のポップオーバーは relatedTerms のキーを
     そのまま表示するため、ダングリングキーは無意味な文字列として
     ユーザーに露出してしまう)。将来 `block` 用語を追加する際に
     staged-sync への配線を忘れない旨は worklog に記録済み。
  5. スコープ分割: UIアンカー(#188/#189)を別Issueとする分割は、
     docs/PLAN.md ステップ9で #188/#189/#190 がそれぞれ独立した
     チェックボックス(=1 Issue)になっている構成と一致しており妥当。
     Issue #124 の教訓(アンカー無しの用語は存在しないのと同じ)は
     同一ステップ内の #188/#189 完了時に充足される前提で、その旨の
     申し送りも worklog に明記されている。
  6. `pnpm lint` / `pnpm build` / `pnpm test` をリポジトリ全体で実行し、
     すべて成功(shared 58 / e2e 34 / collector 944 / frontend 1205 テスト)。
- 非ブロッキングの所見(本Issueの修正対象ではない):
  - docs/ARCHITECTURE.md §5 のスキーマ例が `layer: c-tx` と書かれているが、
    実データは `layer: c-transaction` / `a-infra` 等ファイル名準拠で統一
    されている(main 時点からの既存の齟齬)。docs 側の例を直す軽微な
    追従を別途検討してよい。
  - relatedTerms のダングリング参照を検出するユニットテストは現状無い
    (今回はレビュー時のスクリプトで確認)。今回の `block` の件のような
    判断をテストとして固定したければ、マージ後の glossary 全体で
    relatedTerms の参照先存在を検証するテストを将来追加するとよい。
- 統括への注意: ブランチは未コミットのため、コミット時は
  「glossaryデータ+data.ts+テスト拡張」と「docs更新(PLAN/WORKLOG/worklog)」
  など関心事ごとにコミットを分けること(1変更1コミット)。

### 2026-07-08 Issue #190 D層用語データ - QA検証(qa)

- 担当: qa
- ブランチ: issue-190-d-layer-glossary(検証時点で未コミット)
- 判定: **合格**(完了条件を満たしている)
- 前提: 追加した4用語はまだUIカードから参照されていない(参照は #188/#189 で
  実装予定)。本QAで検証したのは「用語データが正しくパースされ、glossary
  機能自体が壊れていないこと」。
- 実施した検証:
  1. glossary/ 配下の全4ファイル(a-infra/b-network/c-transaction/
     d-internal)を js-yaml で実パースし、全29キーに重複が無いこと、
     relatedTerms のダングリング参照が0件であることを確認した。追加4用語
     (engine-api/el-cl-separation/staged-sync/txpool)はいずれも layer=
     d-internal、name/definition の ja/en が両方存在し、relatedTerms も
     設計どおりであることを確認した。
  2. `pnpm lint` / `pnpm build` / `pnpm test` をリポジトリ全体で独立して
     実行し、すべて成功(lint はエラーなし、build は shared/collector/e2e/
     frontend すべて完了、test は shared 58 / e2e 34 / collector 944 /
     frontend 1205、うち frontend の glossary/parse.test.ts 17件・
     GlossaryTerm.test.tsx 5件が成功)。
  3. `pnpm --filter @chainviz/frontend build:web` で本番バンドルを生成し、
     `vite preview` で実際に配信。ヘッドレス Chromium(Playwright)で
     ルートを読み込み、実アプリが起動することを確認した:
     - ページタイトル "chainviz" を取得、body にコンテンツが描画される。
     - GlossaryTerm 要素が28個描画され、未知語(glossary-term--unknown)は
       0件。用語(例: 「ノード」)にホバーするとポップオーバーが表示され、
       定義文と relatedTerms が正しく出ることを確認した(既存の用語解説
       機能が今回の追加で壊れていないことの確認)。
     - 既存 `mempool` のポップオーバーの relatedTerms に、今回追加した
       逆リンク `txpool` が実際に表示されることを確認した(新用語の配線が
       ライブUIまで正しく流れている)。
     - 実行時の JS 例外(pageerror)は0件。唯一のコンソールエラーは
       ブラウザが自動要求する `/favicon.ico` の404で、これは index.html に
       favicon 宣言が無いことによる main 由来の既存事象であり、#190 とは
       無関係(ルート `/` は 200)。
- 差し戻しなし。統括はコミット時に「glossaryデータ+data.ts+テスト拡張」と
  「docs更新」を関心事ごとに分けること(査読の申し送りどおり)。
