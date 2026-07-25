# Issue #413 攻撃手法解説の土台（glossary + 既存可視化アンカー）

### 2026-07-25 Issue #413 設計メモ（着手前）

- 担当: frontend
- ブランチ: issue-413-attack-glossary-foundation
- 内容: 実装着手前に読んだドキュメント（`docs/ARCHITECTURE.md` §17.1〜
  §17.4・§17.7、`docs/worklog/issue-412.md`）と、実装方針をここに記録する。

#### 1. データフロー・作業範囲の確認

- `packages/shared`・collector・node-env の変更は無し（§17.2 で確定済み）。
  `glossary/` へのYAML追記と、`packages/frontend/src/entities/` 5ファイル
  へのアンカー追加のみで完結する
- 新規語6語はすべて既存の「A層〜D層」区分の既存ファイルに追記する
  （新規ファイルは作らない）。`glossary/data.ts` は既に4ファイルを
  import 済みのため変更不要

#### 2. glossaryエントリの文章構成

既存エントリ（`fork`・`hash`・`keccak256`等）と同じ「定義 → なぜ起きるか/
何が問題か → chainvizではどう見えるか」の3拍子に揃える。「chainvizでは
どう見えるか」の欄は、Issue本文の指定どおり:

- リオーグ: §9（フォーク色分け）・§10（チェーンリボン）で既に可視化済み
  である旨を明記
- ダブルスペンド: 「なぜ成立しないか」（finality）を説明する
- フロントランニング: mempool可視化（§11）+ 複数ワークベンチからの競合tx
  送信の組み合わせで体感できる旨を説明する
- 51%攻撃・ロングレンジ攻撃・eclipse攻撃: 「独立シミュレーション砂場
  （Issue #414/#415/#416で並行実装中、本Issue時点ではまだ存在しない）で
  体験できる」ことを明記する。実際のリンクは張らない（sidePanelの新規
  kindはまだ存在しないため）

#### 3. relatedTerms（双方向リンク）の方針

Issue本文・ARCHITECTURE.md §17.3が明示する3組
（`fiftyOnePercentAttack`↔`fork`↔`reorg`、`eclipseAttack`↔`peer`/`p2p`/
`discovery`、`doubleSpend`↔`transaction`/`nonce`、`frontRunning`↔
`mempool`/`transaction`/`gas`）はすべて双方向（新語→既存語・既存語→新語の
両方）で張る。Issue #406の`keccak256`実装時と同じ流儀（相互リンクの
テストで固定する）を踏襲する。

`longRangeAttack`は設計文書がrelatedTermsを明示していないため、最も
文脈が近い`block`（ChainRibbonCard/Popoverが扱うエンティティ）とだけ
双方向リンクを張り、`fiftyOnePercentAttack`/`reorg`へは片方向（同じ
「フォーク選択を歪める攻撃」という括りで参照はするが、設計が明示した
`fork`↔`fiftyOnePercentAttack`↔`reorg`の三角形を勝手に広げない）とする。

`validator`/`attestation`（`a-infra.yaml`）からの`relatedTerms`導線は
ARCHITECTURE.md §17.4が「検討する」としていたため、双方向で追加する
（51%攻撃はバリデーターの投票権限の偏りが主題のため）。

#### 4. アンカー配置の実装方針

5ファイルとも、既存の関連フィールド行の直後に「関連する用語」的な
小さなヒント行を1行追加する形にする（新規の重いUIブロックは作らない）。
`PeerNetworkLegend.tsx`の既存ヒント（`legend.hint.prefix/term/suffix`の
3分割パターン、Issue #341）をそのまま踏襲し、他の4ファイルにも同型の
prefix/term/suffix i18nキー3つ組を追加する。

- `InfraPopover.tsx`: 「見ている tip」欄（`fork`アンカー、forkColorIndex
  が数値のときだけ出る）の直後に、`fiftyOnePercentAttack`/`reorg`の2つの
  アンカーを並べた行を追加。同じ表示条件（forkColorIndex is number &&
  headBlockHash !== ""）に揃える
- `ChainRibbonPopover.tsx`: 「親ブロック」行（`hash`アンカー）の直後に
  `longRangeAttack`アンカーの行を追加。表示条件なし（常に出る）
- `PeerNetworkLegend.tsx`: 既存の固定ヒント（`discovery`アンカー）の直後
  に`eclipseAttack`アンカーの2行目ヒントを追加
- `TxLifecyclePopover.tsx`: 段階リスト（4段階）の直後・砂場ボタンの手前
  に`doubleSpend`アンカーの行を追加。表示条件なし
- `MempoolPanel.tsx`: ヘッダー直後（tx一覧の前）に`frontRunning`アンカー
  の行を追加。パネル自体が0件でも常設描画する方針（§11.3）にあわせ、
  ヒントも条件無しで常に表示する

#### 5. テスト方針

- glossary: 新規6語専用の統合テストファイル
  `glossaryAttackTermsIntegrity.test.ts`を新設（既存の
  `glossaryRelatedTermsIntegrity.test.ts`はIssue #406のkeccak256専用の
  ため、そちらに追記せず分割する）。スキーマ（layer・{ja,en}非空・
  ja≠en）と設計が指定した双方向リンクを固定する
- frontend: 5ファイルそれぞれに専用のアンカーテストファイルを新設
  （`InfraPopover.attackAnchors.test.tsx`等、既存の`*.forkTip.test.tsx`
  等と同型の「1ファイル1責務」パターンを踏襲）。既存の大きい
  `*.test.tsx`には追記しない

---

### 2026-07-25 Issue #413 実装

- 担当: frontend
- 内容: 上記設計どおりに実装した。

#### 実装したファイル

- `glossary/ethereum/terms/b-network.yaml`: `fiftyOnePercentAttack`/
  `longRangeAttack`/`eclipseAttack`/`reorg`の4語を追加。`fork`/`peer`/
  `p2p`/`discovery`のrelatedTermsに双方向リンクを追加
- `glossary/ethereum/terms/c-transaction.yaml`: `doubleSpend`/
  `frontRunning`の2語を追加。`block`/`transaction`/`nonce`/`mempool`/
  `gas`のrelatedTermsに双方向リンクを追加
- `glossary/ethereum/terms/a-infra.yaml`: `validator`/`attestation`の
  relatedTermsに`fiftyOnePercentAttack`への片方向リンクを追加（設計メモ
  §3のとおり、こちらは新語側から既存語側への逆参照は張らない。バリデー
  ター票の偏りという主題への言及であり、`fiftyOnePercentAttack`本体の
  relatedTermsは既に`fork`/`reorg`/`validator`/`attestation`で構成済み）
- `packages/frontend/src/entities/InfraPopover.tsx`:
  「見ている tip」欄の直後に`fiftyOnePercentAttack`/`reorg`アンカー行
- `packages/frontend/src/entities/ChainRibbonPopover.tsx`:
  「親ブロック」行の直後に`longRangeAttack`アンカー行
- `packages/frontend/src/entities/PeerNetworkLegend.tsx`:
  既存ヒントの2行目に`eclipseAttack`アンカー行
- `packages/frontend/src/entities/TxLifecyclePopover.tsx`:
  段階リスト直後に`doubleSpend`アンカー行
- `packages/frontend/src/entities/MempoolPanel.tsx`:
  ヘッダー直後に`frontRunning`アンカー行（0件時も表示）
- `packages/frontend/src/i18n/messages.ts`: 上記5箇所に対応する
  i18nキー（`field.headTipAttackHint`・`chainRibbon.popover.longRangeHint`・
  `legend.eclipseHint.*`・`tx.lifecycle.doubleSpendHint.*`・
  `mempoolPanel.frontRunningHint.*`）を追加
- `packages/frontend/src/styles.css`: 新規ヒント行の最小限のスタイル
  （`.infra-field`の枠組みを再利用できない箇所（`TxLifecyclePopover`の
  独立した`<p>`・`MempoolPanel`のヒント行）だけ個別にCSSを追加）

#### テスト

- `packages/frontend/src/glossary/glossaryAttackTermsIntegrity.test.ts`
  （新規）
- `packages/frontend/src/entities/InfraPopover.attackAnchors.test.tsx`
  （新規）
- `packages/frontend/src/entities/ChainRibbonPopover.longRangeAttackAnchor.test.tsx`
  （新規）
- `packages/frontend/src/entities/PeerNetworkLegend.eclipseAttackAnchor.test.tsx`
  （新規）
- `packages/frontend/src/entities/TxLifecyclePopover.doubleSpendAnchor.test.tsx`
  （新規）
- `packages/frontend/src/entities/MempoolPanel.frontRunningAnchor.test.tsx`
  （新規）

`pnpm lint && pnpm build && pnpm test`（frontendパッケージ）がすべて
通ることを確認済み。

#### 決定事項・注意点（次の担当が知っておくべきこと）

- Issue #414/#415/#416（3つのシミュレーション砂場）の実装時、
  `fiftyOnePercentAttack`/`longRangeAttack`/`eclipseAttack`の3語の定義文
  中で「独立シミュレーション砂場で体験できる」と説明しているが、実際の
  砂場入口ボタン・リンクは本Issueでは実装していない（設計メモのとおり、
  砂場自体がまだ存在しないため）。3砂場の実装担当は、必要であれば定義文
  自体は変更せずに（説明として既に成立しているため）、`ChainRibbonCard`
  等への入口ボタン追加だけを行えばよい
- `longRangeAttack`のrelatedTermsは設計文書が明示していなかったため、
  実装時の判断で`block`とだけ双方向リンクにし、`fiftyOnePercentAttack`/
  `reorg`へは片方向とした（詳細は設計メモ§3）。3砂場のUX設計時により
  適切なリンク構成が判明した場合は見直してよい
- 「finality」は今回も独立エントリを新設していない（`doubleSpend`・
  `longRangeAttack`・`reorg`の説明文中で概念として触れるに留めた）。
  3つの砂場の実装で説明量が増えるようなら、その時点で独立エントリ化を
  再検討する

---

### 2026-07-25 Issue #413 テスト強化

- 担当: tester
- ブランチ: issue-413-attack-glossary-foundation
- 内容: 実装担当が書いた6ファイルのテストを読み、異常系・境界値の観点で
  不足していたものを追加した。実装（`glossary/`のYAML・
  `packages/frontend/src`の5コンポーネント・`messages.ts`）は変更していない。

#### 追加したテストの観点

用語データ（`glossary/`）側:

- **relatedTermsの導線**（`glossaryAttackTermsIntegrity.test.ts`に追加）:
  `validator`/`attestation`から`fiftyOnePercentAttack`への導線が
  どのテストからも見られていなかった（実装は双方向で張られている）。
  あわせて、relatedTermsに重複が無いこと（用語ポップオーバーは
  relatedTermsをそのまま連結表示するため重複すると同じ用語名が2回並ぶ）と、
  `longRangeAttack`から`fiftyOnePercentAttack`/`reorg`への参照が片方向で
  あるのは実装時の判断（設計メモ§3）であり張り忘れではないことを固定した
- **ja/en文言の異常系**（`glossaryAttackTermsLocalization.test.ts`、新規）:
  用語名のja/en一致（en欄に和名を残した状態）・en側への和文混入・ja定義文の
  未翻訳・定義文が用語名の使い回し・折りたたみブロックスカラー（`>-`）の
  取り違え（`|`にすると改行が残り、6行でクランプされる用語ポップオーバーの
  見え方が崩れる）・定義文中のバッククォート参照の参照切れ
- **定義ファイルの配置と層グループ**（`glossaryAttackTermsPlacement.test.ts`、
  新規）: 既存テストはマージ後の`layer`文字列だけを見ていたため、(1)
  `layer: b-network`の語が別ファイルに紛れ込んでいる、(2) `layer`の綴りを
  崩すと用語集パネルがA〜D層のどのグループにも入れず「その他」へ静かに
  落とす（`resolveGlossaryLayerGroupKey`）、(3) 同じキーを2ファイルに
  重複定義すると`mergeGlossaries`（`Object.assign`）が後勝ちで黙って
  上書きする、の3つを検出できなかった
- **用語集パネルからの到達性**（`glossaryAttackTermsSearch.test.ts`、新規）:
  アンカーを踏まずにパネルを開いて探す経路（検索窓・層グループ一覧）が
  未検証だった。ja名/en名/生キー（大文字小文字を問わず）での一致、空クエリ
  （空白のみを含む）で全件表示に含まれること、層グループに1度だけ現れること
- **用語データとUI文言の整合**（`glossaryAttackTermsUiConsistency.test.ts`、
  新規。Issue #420の`internalLinkKinds.glossaryConsistency.test.ts`と同じ
  狙い）: アンカーの表示テキスト（3分割キーの`*.term`）が用語名と一致して
  いること、定義文が案内しているUIの表示名が実際の文言と一致していること
  （`reorg`→`field.headTip`、`doubleSpend`→`tx.status.included`、
  `frontRunning`→`mempoolPanel.title`）、砂場前提の3語と既存可視化で
  体感する2語の書き分けが逆転していないこと

i18n（`messages.ts`）側:

- **3分割キーの整合**（`i18n.attackHintTrios.test.ts`、新規）: prefix/term/
  suffixは「文の途中に`GlossaryTerm`を挟む」ための実装上の分割なので、キー
  単位で見ても壊れていることが分からない。組み立てた1文として、jaが3つとも
  埋まっていること・enに和文が混入しないこと・アンカーの表示テキスト（term）
  が空にならないこと（空だとホバーもクリックもできない導線になる）・連結部に
  二重空白が出ないことを固定した
- **意図的な空文字の境界**（`i18n.empty-string.test.ts`に追加）: 既存の
  「意図的な空文字の一覧」テストはIssue #413で追加された
  `legend.eclipseHint.suffix.en`を正しく含む形に更新されていたが、一覧の
  突き合わせだけでは、このキーで`translate`がjaへフォールバックしても
  検出できない（英語表示のP2P凡例の文末に「になります」が現れる。Issue #341
  の再発）。`legend.hint.suffix`と同じ`translate`/`pickLocale`の対比を
  新しいキーでも確認するケースを追加した

アンカー（`packages/frontend/src/entities/`の5ファイル）側:

- **配置順**: アンカー行が意図した欄の直後にあること（近傍に置くこと自体が
  「どの欄に対する関連用語か」を伝える設計意図のため）。`InfraPopover`は
  「見ている tip」欄の直後、`ChainRibbonPopover`は「親ブロック」行と「時刻」
  行の間、`TxLifecyclePopover`は段階リストと署名デモボタンの間、
  `MempoolPanel`はヘッダーとtx一覧の間、`PeerNetworkLegend`は既存ヒントの
  次の行
- **件数の境界**: `MempoolPanel`は0件時に空メッセージとヒントが共存する
  こと・上限超過表示（`overflowCount > 0`）やノード別txpoolのみがある
  組み合わせでもヒントが1つだけ出ること。`PeerNetworkLegend`は複数
  ネットワークでもヒントは1つ、peerエッジ0本なら凡例ごと出ない
- **データ欠損時の縮退**: 用語エントリが読み飛ばされた（`parse.ts`が
  `{ja,en}`の揃わないエントリを落とした）場合でも行自体は消えず、
  `GlossaryTerm`のunknownフォールバックになるだけであること。表示テキストを
  渡している3箇所（`PeerNetworkLegend`/`TxLifecyclePopover`/`MempoolPanel`）
  では生キーが露出せず文として成立し、渡していない2箇所
  （`InfraPopover`/`ChainRibbonPopover`）では生キーが出ること
- **表示条件の他の分岐**: `InfraPopover`はワークベンチカードでは出ない
  こと、`ChainRibbonPopover`はgenesisタイル（親を持たない先頭。まさに
  ロングレンジ攻撃の対象）でも出ること、`TxLifecyclePopover`は`failed`
  （4段目が別文言に分岐する）でも出ること
- **英語表示**: `InfraPopover`/`ChainRibbonPopover`の見出しと用語名が英語に
  なること、`TxLifecyclePopover`のヒントに和文が混入しないこと

#### テスト支援モジュールの追加

同じ6語を見るテストファイルが5つに増えたため、用語YAMLの読み込み
（cwdから親方向へrepoルートの`glossary/`を探す既存の流儀）と対象キーの
一覧を`packages/frontend/src/glossary/realGlossaryFixture.ts`・
`attackTermsFixture.ts`へ切り出し、既存の
`glossaryAttackTermsIntegrity.test.ts`もこれに載せ替えた（検証内容は
変更なし）。ファイル単位でパースした結果も返せるようにしている
（「どのファイルに定義されているか」「`layer`値と定義ファイルが食い違って
いないか」はマージ後のGlossaryでは判定できないため）。

#### 追加したテストが実際に不具合を検出できることの確認

CLAUDE.md「『直したはず』で済ませず、実際に再現して確認する」に従い、
実装側を意図的に壊した12パターンを一時的に作り、対応するテストが失敗する
ことを確認してから元に戻した（作業ツリーはクリーンな状態に戻してから
コミットしている）。確認したパターン: `layer`の綴り崩し、en定義文への和文
混入、定義文中のバッククォート参照の綴り崩し、`validator`→
`fiftyOnePercentAttack`リンクの削除、relatedTermsの重複、キーの重複定義、
`field.headTip`を改名して定義文を放置、アンカー表示テキストと用語名の不一致、
`legend.eclipseHint.suffix.en`へのja値の混入（フォールバック相当）、
`MempoolPanel`のヒント削除、`InfraPopover`のヒント行を「見ている tip」欄
から引き離す、`TxLifecyclePopover`のヒント位置のずらし。

#### 実装の問題として見つかったもの（差し戻しは不要と判断）

- **バグは見つからなかった**。実装は設計メモどおりで、テストを追加した
  範囲では期待どおりの挙動だった
- 観察: 用語YAMLの定義文は折りたたみブロックスカラー（`>-`）で書かれて
  いるため、行の折り返し位置に半角空白が入る。日本語は語間に空白を置か
  ないので、UI上は文中に不自然な空白が現れる（例:
  「攻撃者が用意したノードだけで 埋め尽くしてしまう」）。ただしこれは
  Issue #413固有ではなく既存47語のうち42語が同じ状態であり（#413以前の
  41語中36語）、repo全体の書き方の特性のため本Issueでは修正対象にせず、
  テスト側で空白を落として比較する方針にした。気になる場合は用語データ
  全体の整形として別Issueで扱うのが妥当
- 観察: `legend.eclipseHint`のenは`suffix`が空で文末に句点が無い
  （"...it becomes an eclipse attack"）。これは踏襲元の
  `legend.hint`（Issue #341）と同じ書き方であり、既存の流儀に沿っている
  ためテストで句点を強制していない
- 注意点（次の担当へ）: `field.headTipAttackHint`と
  `chainRibbon.popover.longRangeHint`はどちらも「関連する用語 / Related
  terms」という同じ値を持つ別キー。値が同じことに依存したテストは書いて
  いないので、片方だけ文言を変えても問題ない

---

### 2026-07-25 Issue #413 レビュー結果（合格）

- 担当: reviewer
- ブランチ: `issue-413-attack-glossary-foundation`（レビューは同一コミットを
  指す一時ブランチ `review-issue-413` 上で実施。push・コミットは行っていない）

#### 確認した内容

- `main` との差分全体（`git diff main..HEAD`）を読み、Issue本文・
  `docs/ARCHITECTURE.md` §17.3・§17.4の設計内容と突き合わせた:
  - glossary新規6語（`b-network.yaml`4語・`c-transaction.yaml`2語）の
    配置ファイル・`layer`・relatedTermsの相互リンク
    （`fiftyOnePercentAttack`↔`fork`↔`reorg`の三角形、`eclipseAttack`↔
    `peer`/`p2p`/`discovery`、`doubleSpend`↔`transaction`/`nonce`、
    `frontRunning`↔`mempool`/`transaction`/`gas`、`validator`/
    `attestation`→`fiftyOnePercentAttack`の双方向）がすべて設計どおり
  - 既存UI5箇所（`InfraPopover.tsx`/`ChainRibbonPopover.tsx`/
    `PeerNetworkLegend.tsx`/`TxLifecyclePopover.tsx`/`MempoolPanel.tsx`）
    への用語アンカー追加が、§17.4が指定した配置（近傍・表示条件）と一致
  - `packages/shared`・collector・node-envへの変更が無いこと（設計どおり
    frontendのみで完結）を確認
- 設計原則との整合: 境界（フロントはDocker/ノードに非接触）・チェーン固有
  語彙の非漏出（`eth_getLogs`等をgrep、該当なし）・データとコードの分離
  （用語はYAMLのみに追加、コードはアンカー配置のみ）をすべて確認。既存
  47語との整合性チェック（重複定義・layer不一致・dangling参照）も既存
  テストが引き続きカバーしている
- 「品質ゲートを骨抜きにしない運用ルール」の観点:
  - `catch`して握りつぶす・エラーを汎用メッセージへすり替える変更は無し
    （そもそも本Issueはロジックを持たない静的なUI/データ変更）
  - 「今観測できる値」に依存する決め打ち定数は無し。テスト支援モジュール
    の`findRepoFile`（親方向へ最大6階層探索してrepoルートを探す）は既存
    テスト（`glossaryRelatedTermsIntegrity.test.ts`）と全く同じ既存パターン
    の踏襲であり、新規の環境依存を持ち込んでいない
  - Issue自動クローズの検証は統括のマージ作業時に別途行うべき事項のため
    ここでは対象外
- コミット粒度: `git log main..HEAD`で15コミットを確認。glossaryデータ
  追加・i18nメッセージ追加・UIアンカー追加・各テストファイル追加が
  それぞれ独立したコミットに分かれており、「1つの変更内容 = 1コミット」
  の原則を満たす。i18nメッセージ追加コミット（4c47845）が既存の
  `i18n.empty-string.test.ts`の「意図的な空文字は1箇所のみ」という
  不変条件テストも同じコミットで更新しているが、これは新しい意図的な
  空文字（`legend.eclipseHint.suffix.en`）を追加する変更と不可分（更新
  しないとそのコミット単体でテストが壊れる）であり、関心事の混在とは
  判断しなかった
- `pnpm lint && pnpm build && pnpm test`をリポジトリ全体で実行し、
  すべて成功することを確認（frontend 267ファイル3380件、shared 75件、
  collector 1765件、e2e 185件、いずれも失敗なし）
- テストコードの質: 実装側を意図的に壊すハッピーパスのみのテストではなく、
  異常系（glossaryエントリ欠損時の縮退・関連語の重複・キー重複定義・
  layer綴り崩し・折りたたみブロックスカラーの取り違え・和文混入・
  用語データとUI文言の食い違い）を広くカバーしている。実装の詳細を
  なぞるだけの無意味なテストは見当たらなかった。テスト強化担当が
  「実装側を意図的に壊した12パターンでテストが失敗することを確認して
  から元に戻した」と報告している手順もCLAUDE.mdの運用ルールに沿っている

#### 「観察のみ2点」の判断確認

依頼にあった2件について、テスト強化担当の「本Issueの範囲外」という判断は
妥当と判断した:

1. 折りたたみブロックスカラー（`>-`）による行末半角空白: 実際に
   repoの全4YAMLファイルを機械的に走査したところ、既存47語のうち42語
   （新設6語含む）が同じ状態であることを確認した。Issue #413固有の
   問題ではなく、repo全体の用語データの書き方の特性であり、本Issueの
   スコープ（新規6語の追加）を超えて既存データ全体を書き直す話になる。
   別Issueで扱うべきという判断に同意する
2. `legend.eclipseHint`のenで文末句点が無い件: 踏襲元の`legend.hint`
   （Issue #341）を実際にコード上で確認したところ、同じ「prefixに文を
   寄せてsuffixを空にする」書き方であることを確認した。既存の流儀に
   意図的に揃えたものであり、この1箇所だけ句点を足すと踏襲元との対称性
   が崩れる。対応不要という判断に同意する

#### 判定

**合格**。設計・実装・テストのいずれにも指摘事項なし。統括によるコミット・
push・PR作成・マージの判断に委ねる。
