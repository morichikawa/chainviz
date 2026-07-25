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

---

### 2026-07-25 Issue #413 QA検証結果（不合格。差し戻し1件）

- 担当: qa
- 対象: `origin/issue-413-attack-glossary-foundation`（コミット `e695c0c`。
  実装・テスト強化・レビュー合格までを含む状態）
- 検証環境: QA専用のworktreeで `pnpm install` と
  `pnpm --filter @chainviz/shared build` / `pnpm --filter @chainviz/frontend build`
  を実行し、frontendを vite dev（port 5199、`VITE_COLLECTOR_URL=ws://localhost:4000`）
  で起動して検証した。`profiles/ethereum` のDockerスタック（7コンテナ）と
  collector（port 4000）は既に起動中のものを使用した。本Issueは
  collector・node-envに変更が無いため、collectorはmain相当のビルドで問題ない
- 実ブラウザでの確認はPlaywright（chromium）を
  `LD_LIBRARY_PATH=/home/zoe/chrome-deps/root/usr/lib/x86_64-linux-gnu` 付きで
  起動して行った（このホストはchromiumの共有ライブラリが未導入のため。
  docs/worklog/issue-406.md・issue-420.md の既存手順と同じ）
- 検証用の一時スクリプト・スクリーンショットはすべてリポジトリ外
  （スクラッチパッド）に置いており、リポジトリにファイルを追加していない。
  commit・pushは行っていない（統括が実施する）

#### 0. 環境の生存確認

- ワークベンチから `cast block-number --rpc-url http://reth1:8545` が
  940 → 941 と進行することを確認（チェーンは稼働中）
- frontendの接続バッジが「接続済み」になり、collectorのスナップショットで
  node 6件・workbench 2件・wallet 2件・contract 1件・block 32件・
  transaction 1件を受信していることを確認

#### 1. 5箇所のアンカーの実機確認（ja/en 両方）

いずれも実際にホバーして用語ポップオーバー（用語名・定義文・関連用語・
「クリックで用語集を開く」フッター）が開き、クリックで用語集パネルが
その用語を選択した状態で開くことを確認した。

| 箇所 | アンカー | 表示条件 | 結果 |
| --- | --- | --- | --- |
| `PeerNetworkLegend` | `eclipseAttack` | 常設（peerエッジがある間） | ja/en とも表示・ポップオーバー・パネル遷移すべてOK |
| `MempoolPanel` | `frontRunning` | 常設（0件でも） | ja/en とも表示・ポップオーバー・パネル遷移すべてOK |
| `ChainRibbonPopover` | `longRangeAttack` | 常設 | ja/en とも表示・ポップオーバー・パネル遷移すべてOK |
| `TxLifecyclePopover` | `doubleSpend` | 常設 | ja/en とも表示・ポップオーバー・パネル遷移すべてOK |
| `InfraPopover` | `fiftyOnePercentAttack` / `reorg` | フォーク検知中のみ | ja/en とも表示・ポップオーバー・パネル遷移すべてOK（下記のとおり合成スナップショットで再現） |

配置順も設計どおりであることを実際のDOM順で確認した。

- `ChainRibbonPopover`: ブロック番号 → ハッシュ → 親ブロック →
  **関連する用語（ロングレンジ攻撃）** → 時刻 → 取り込まれた tx → 受信したノード
- `TxLifecyclePopover`: ヘッダ → 段階リスト(UL) →
  **ダブルスペンドのヒント(P)** → 「署名と検証のしくみを試す」ボタン
- `InfraPopover`: … ブロック高 → 見ている tip →
  **関連する用語（51%攻撃 / リオーグ）** → 駆動元（合意ノード） → 同期ステージ
- `MempoolPanel`: ヘッダー → **フロントランニングのヒント** → tx一覧/空メッセージ
- `PeerNetworkLegend`: 既存ヒント（ノード発見）の次の行

`InfraPopover` のアンカーは既存の `fork` アンカーと同じ表示条件
（`forkColorIndex` が数値、かつ `headBlockHash` が非空）を共有するため、
稼働中の2バリデーター構成では自然発生しなかった（セッション中フォーク色分けの
付いたカードは0件で、「見ている tip」欄自体が一度も出なかった）。そのため
実collectorから受信した本物のスナップショットを取得し、そのうちの1ブロックを
分岐させた合成スナップショット（reth2/beacon2 だけを高さ N-1 の別ハッシュの
枝に向ける）をPlaywrightの `page.routeWebSocket` でフロントに流し込んで
フォーク状態を再現した。結果、reth1/reth2 の両カードにフォーク色が付き、
両方の `InfraPopover` で「見ている tip」欄の直後に
「関連する用語 51%攻撃（多数派支配） / リオーグ（reorg）」の行が出た。

#### 2. 用語集パネルからの到達性（6語すべて）

ヘッダーの「用語集」ボタンからパネルを開き、以下を確認した。

- 層グループ: `fiftyOnePercentAttack` / `longRangeAttack` / `eclipseAttack` /
  `reorg` の4語が B層グループに、`doubleSpend` / `frontRunning` の2語が
  C層グループに、それぞれ1回だけ現れる（「その他」グループには落ちていない）
- 検索: 「51%」「多数派」「リオーグ」「reorg」「REORG」（大文字）「eclipse」
  「Eclipse攻撃」「ダブルスペンド」「double-spend」「doubleSpend」「front」
  「フロントランニング」「ロングレンジ」「long-range」「longRangeAttack」
  「fiftyOnePercentAttack」のいずれでも対象語がヒットする（ja名・en名・生キー・
  定義文中の語のいずれからでも引ける）
- 英語表示に切り替えた状態でも6語すべてが en 名で一覧に出る

#### 3. MempoolPanel の0件時の表示

mempoolが空（pending 0件）の状態で、フロントランニングのヒント行と
「保留中の tx はありません（滞りなく取り込まれています）」の空メッセージが
共存して表示されることを確認した。ヒントは常に1件のみ。
実際に操作パネルから 0.01 ETH の送金を実行して pending tx が1件ある状態にしても、
ヒントは1件のまま重複しなかった。

#### 4. 定義文と実際のUI表示の整合

- `reorg`: 定義文が案内する「見ている tip」欄は、実際の `InfraPopover` の
  表示名（ja「見ている tip」/ en「Following tip」）と一致していた
- `doubleSpend`: 定義文が案内する「取り込み済み」は、実際の
  `TxLifecyclePopover` のステータス表示（「取り込み済み」）と一致していた
- `frontRunning`: 定義文が案内する mempoolパネルの表示名（ja「mempool」/
  en「Mempool」）・「全ノードのpending tx一覧を俯瞰できる」という記述は、
  実際のパネル（ヘッダー + ノード別 txpool 欄）と一致していた
- `eclipseAttack`: 定義文の「chainviz のP2P凡例（画面隅）で見えている
  『ピア接続が時間とともに自動で増えていく』」は、実際の凡例の文言
  （「ピア接続はノード発見により時間とともに自動で増えます」）と一致していた

#### 5. 発見した不具合（差し戻し対象。担当: frontend）

**5-1. MempoolPanel のヒント追加でパネルが上に伸び、ビューポート高が
低いときにパネルのヘッダー行が層フィルターバーに覆われる（退行）**

- 再現手順:
  1. ビューポート 1280x720（`packages/e2e/playwright.config.ts` が使う
     Desktop Chrome プリセットと同じサイズ）でフロントを開く
  2. 画面左のmempoolパネルを見る
- 期待: パネルのヘッダー行（`mempool` 用語アンカー + pending件数バッジ）が
  見えていて、アンカーをクリックすれば用語集パネルが開く
- 実際: ヘッダー行が `.layer-filter-bar`（半透明・`pointer-events: auto`）に
  覆われて見えず、`mempool` アンカーのクリックが
  「element intercepts pointer events」でタイムアウトする
- 原因: `.mempool-panel` は `bottom: 385px` 固定でパネルの下端が固定され、
  内容が増えると上方向に伸びる。本Issueで追加したヒント行（2行 + margin）が
  高さを約41px増やしたため、パネル上端が層フィルターバーの下端（y=175）より
  上に来る
- 実測（1280幅・各ビューポート高でのヘッダー行の被覆判定。
  `document.elementFromPoint` がパネル外の要素を返すかで判定）:

  | ビューポート高 | 本ブランチ | ヒント行を display:none で隠した状態（#413前相当） |
  | --- | --- | --- |
  | 700 | 覆われる | 覆われない |
  | 720 | 覆われる | 覆われない |
  | 730 | 覆われない | 覆われない |
  | 900 | 覆われない | 覆われない |

  同じ1280x720で、ヒント行をCSSで隠すと `mempool` アンカーのクリックが
  成功することも確認した（=本Issueの変更が引き金であることを両方向で確認）
- 補足: 根本原因である `bottom: 385px` / `max-height: 260px` という決め打ちの
  レイアウトは本Issue以前から存在し、mempoolにtxが多数並んでパネルが
  max-heightまで伸びた場合は #413 以前でも同じ重なりが起きる。本Issueの変更で
  「アイドル状態（0件）でも重なる」ようになった点が退行にあたる。修正方法
  （ヒント行を1行に縮める / `bottom` の値を見直す / パネルを表示領域内に
  収める機構を入れる）は frontend 担当の判断に委ねる。別Issueとして切り出す
  判断も統括に委ねる

**5-2. P2P凡例の `eclipseAttack` 用語ポップオーバーが画面下端で21px切れる（軽微）**

- 再現手順: P2P凡例（画面右下）の2行目「Eclipse攻撃」にホバーする
- 期待: 用語ポップオーバー全体（定義文 + 関連用語 + 「クリックで用語集を開く」
  フッター）が読める
- 実際: ポップオーバーの下端がビューポート下端を21px超え、フッター
  「クリックで用語集を開く」がほぼ見えない（1600x1000・1280x720 の両方で同じ21px）
- 原因: `PopoverPortal` / `computePopoverPosition` は常にアンカーの下に
  ポップオーバーを置き、画面外に出る場合の上側への反転を持たない。本Issueの
  ヒントは画面右下に固定された凡例の最下行になるため、既存の1行目
  （`discovery` アンカー、はみ出し0px）と違って必ず画面外に掛かる
- 影響: 定義文本体と関連用語は読めるので致命的ではない。ただしフッターは
  「クリックできる」ことを伝えるための固定表示（Issue #313 UX設計 §3.7-2）
  なので、そのディスカバリー手段が失われる

#### 6. 指摘（差し戻しは不要と判断。ただし記録に残す）

**6-1. 定義文に内部識別子（ARCHITECTURE.mdの節番号・Reactコンポーネント名）が
そのまま出ている**

- `reorg`（ja/en）の定義文に「§9」「§10」と「InfraPopover」が、
  `frontRunning`（ja/en）の定義文に「§11」が、利用者向けの用語ポップオーバー・
  用語集パネルにそのまま表示される
- `main` 時点の既存47語には、この種の内部識別子を利用者向け本文へ出している
  ものは無い（各YAMLの先頭コメントに `docs/ARCHITECTURE.md §5` の参照はあるが
  これはYAMLコメントで表示されない）。UIには「§9」も「InfraPopover」も
  現れないため、読者が対応を取れる語彙になっていない
- 指している欄の表示名そのもの（「見ている tip」/「Following tip」）は
  実UIと一致しているので、内容の矛盾ではなく表記の問題

**6-2. 3語の定義文が、まだ存在しない「独立シミュレーション砂場」を案内している**

- `fiftyOnePercentAttack` / `longRangeAttack` / `eclipseAttack` の定義文は
  「独立シミュレーション砂場で…確かめられる」と書いているが、その砂場は
  Issue #414/#415/#416 で未実装。本Issue単体がmainに入った時点では、UIが
  存在しない機能を案内している状態になる
- これは `docs/ARCHITECTURE.md` §17.3 が明示的に指定した書き方であり、実装・
  レビューでも意図として確認済みのため差し戻し理由にはしない。3砂場の実装
  完了までの間だけ生じる過渡的な状態である点を記録に残す

**6-3. `reorg` の「常設で観察できる」という記述が実環境の見え方より強い**

- `reorg` の定義文は「フォーク色分け（§9、InfraPopover の『見ている tip』欄）と
  チェーンリボン（§10）の両方で、この現象を常設で観察できる」と書いているが、
  実際にはフォークが検知されている間だけ「見ている tip」欄自体が現れる仕様
  （既存の Issue #296 の設計）。今回の稼働中の2バリデーター構成では
  セッション中フォークは一度も発生せず、フォーク色分けもtip欄も出なかった
- `fiftyOnePercentAttack` の「フォークが1本の枝に収束する様子は…日常的に
  見られる」も同様に、この規模のネットワークでは実際には日常的には見られない
- 用語アンカーとして「アンカーの無い用語を作らない」（Issue #124）の形式的な
  要件は満たしているが、通常運用では到達できないアンカーであることは
  3砂場（#414）のUX設計時に再考する価値がある

**6-4. `packages/e2e/SCENARIOS.md` へのUIシナリオ追記が無い**

- 直近のUI機能追加（#401/#402/#409）はいずれもUI層E2Eシナリオを追加している
  一方、本Issueと最も似た変更（#406 の keccak256 アンカー追加）は追加して
  いない。`docs/PLAN.md` の運用ルールは「ステップ」に対する要求のため、
  バックログ項目である本Issueに必須とは判断しなかった。追加するかどうかは
  統括の判断に委ねる

#### 判定

**不合格（差し戻し1件）**。

- Issue本文・`docs/ARCHITECTURE.md` §17.3/§17.4 が求める完了条件
  （6語の追加・5箇所へのアンカー配置・ja/en両方での表示・用語集パネルからの
  到達性・MempoolPanelの0件時の常設表示）は、実機ですべて満たしていることを
  確認した
- ただし、5-1 の退行（1280x720 でmempoolパネルのヘッダー行と既存の
  `mempool` 用語アンカーが層フィルターバーに覆われ操作できなくなる）は本Issue
  の変更が引き金であり、既存のアンカーが使えなくなる実害があるため、
  そのままの合格判定は出さない。`chainviz-frontend` へ差し戻す
- 5-2 は軽微。5-1 と同じ「ポップオーバー・パネルが表示領域に収まらない」系の
  課題であるため、まとめて扱うか別Issueにするかは統括の判断に委ねる
- `docs/PLAN.md` のチェックボックスは、5-1 の対応が済むまで本QAでは触っていない
  （#413 の行は実装担当が既にチェック済みの状態のまま）

---

### 2026-07-25 Issue #413 差し戻し対応（5-1 のみ。担当: frontend）

- 担当: frontend
- ブランチ: `issue-413-attack-glossary-foundation`（実体は別 worktree に
  checkout されていたため、作業は同じリモートブランチを追跡するローカル
  ブランチ `issue-413-fix-worktree` 上で行い、`git push` 時に
  `issue-413-attack-glossary-foundation` へ反映する）
- 対応したのは QA 検証結果の 5-1（mempool パネルのヘッダー行が層フィルター
  バーに覆われる退行）のみ。5-2（P2P凡例の `eclipseAttack` ポップオーバーが
  画面下端で切れる）は対応方針を検討したが見送った（理由は下記）

#### 設計メモ（着手前）

- 原因は `.mempool-panel`（`packages/frontend/src/styles.css`）が
  `bottom: 385px` 固定で、内容が増えると上方向に伸びる作りであること。
  Issue #413 で追加した `frontRunning` ヒント行が高さを増やし、ビューポート
  高が低いとき（1280x720 を含む）にパネル上端が `.canvas-overlay-top`
  （キャンバスツールバー + レイヤーフィルターバー）より上に出るように
  なった
- 対応方針の候補を3つ検討した:
  1. ヒント行のテキストを短くして高さを抑える
  2. パネルの配置・最大高さの計算方法を見直す
  3. 上記の組み合わせ
  - 候補1は、パネル幅（220〜280px）に対してヒント文はどのみち2行に
    折り返すため、意味のある文言のままでは高さの削減効果が薄いと判断し
    見送った
  - 候補2を採用した。実測（Playwright、後述）で「アイドル状態（0件）でも
    重なる」原因はヒント行だけでなく、既存の「ノード別 txpool」欄
    （`nodeEntries.length > 0` で常に描画される。6ノード構成では常時
    表示される）も高さの主要因であることを確認した。ヒント行だけを
    削らず、パネル全体の上限高さをビューポート高に応じて動的に絞る方が
    根本的な解決になると判断した
- 実装方針: `.mempool-panel` の `max-height` を `min(260px, calc(100vh -
  585px))` に変更する。`585px` は「このパネルの `bottom` オフセット
  (385px) + `.canvas-overlay-top` 下端に対する安全マージン込みの予約領域
  (200px)」。ビューポートが十分高い（900px 以上目安）場合は従来どおり
  `260px` が上限のまま変わらず、低いビューポートでのみ上限が絞られて
  パネル内部のスクロール（既存の `overflow-y: auto`）に content が
  逃げる形にする。`200px` は 1280 幅で実測した `.canvas-overlay-top` の
  下端（約175px）に25pxの余裕を足した値で、固定値であることをCSSの
  コメントに明記し、ツールバー/チップバーの行数が将来増えた場合は
  見直しが必要である旨も記載した
- 5-2（P2P凡例ポップオーバーのはみ出し）は見送った。原因は
  `PopoverPortal`（`packages/frontend/src/interaction/PopoverPortal.tsx`）
  が常にアンカー下にポップオーバーを配置し、画面外に出る場合の上方向への
  反転を持たないこと。`PopoverPortal` は9箇所（`InfraPopover` /
  `ChainRibbonPopover` / `WalletPopover` / `ContractPopover` /
  `ContractCard` / `ChainRibbonCard` / `TxLifecyclePopover` / `ActionHint` /
  `GlossaryTerm`）から使われている共通コンポーネントで、反転ロジックを
  追加するとアプリ全体のポップオーバー配置に影響する。QA が明確に
  「軽微・推奨だが必須ではない」と切り分けているため、差し戻し対応の
  スコープ（5-1 の退行解消）を超えると判断し、別 Issue（統括判断）に
  委ねることにした

#### 実際に確認した手順（CLAUDE.md「直したはず」で済ませないルールに従う）

1. `pnpm --filter @chainviz/shared build` / `pnpm --filter @chainviz/collector
   build` の後、`VITE_COLLECTOR_URL` を稼働中の collector に向けて
   `vite` を dev 起動し、Playwright（chromium、
   `LD_LIBRARY_PATH=/home/zoe/chrome-deps/root/usr/lib/x86_64-linux-gnu`）で
   ビューポート 1280x720/700/720/730/900 の `.mempool-panel` /
   `.layer-filter-bar` の `getBoundingClientRect()` を実測し、QA報告と
   同じ座標（700/720で重なる、730/900で重ならない）を再現した
2. `mempool` 用語アンカーを Playwright の `locator.click()` で実際にクリック
   し、修正前は QA と同じ `element intercepts pointer events` タイムアウトで
   失敗することを確認した
3. `styles.css` の `max-height` を修正した後、同じ手順で全ビューポート幅で
   重なりが解消し、クリックも成功することを確認した
4. `packages/e2e/src/ui/mempool-panel-layout.spec.ts`（新規、後述）を
   `pnpm exec playwright test`（`globalSetup` が実 Docker スタック + 専用
   collector + vite dev server を起動する既存の仕組み）で実行し、修正前の
   CSS に戻すと（`git stash` で `styles.css` のみ一時的に戻す）このテストが
   実際に失敗し、修正を戻すと通過することを確認した（CLAUDE.md の
   「回帰テストは意図的に壊した状態で一度失敗を確認してから元に戻す」を
   実施）

#### 追加した自動テスト

- `packages/e2e/src/ui/mempool-panel-layout.spec.ts`（新規。
  `packages/e2e/SCENARIOS.md` に `UI-OVERLAY-01` として追記）: mempool
  パネルのヘッダーが層フィルターバーの下端より下にあること・
  `mempool` 用語アンカーのクリックが他要素にブロックされず用語集パネルを
  開くことを実ブラウザで検証する。jsdom は実際のレイアウト（座標計算）を
  行わないため、この種の「要素同士の重なり」はユニットテスト（vitest）
  では代用できず、Playwright の UI 層 E2E に置いた
- 実装時の注意点: ページ読み込み直後は「ノード別 txpool」欄
  （`NodeEntity.internals.mempool` 由来、D層のスクレイプで数秒後に埋まる）
  がまだ空で、パネルの実際の高さが本来より低く出る。これを待たずに
  座標を測定すると、パネル高さが低いために退行を誤って「無い」と判定して
  しまう（実際に本番相当の稼働時間が長い collector に接続した状態と、
  起動直後の collector に接続した状態とで測定値が大きく異なることを実測で
  確認した）。テストは「ノード別 txpool」欄が表示されるまで待ってから
  座標を測定するようにしている
- `pnpm test:e2e:ui` は全19ファイルを対象にすると重い（実 Docker スタックを
  要する）ため、今回は対象を `mempool-panel-layout.spec.ts` に絞って実行し
  確認した。全体（`pnpm test`）には Playwright UI E2E は含まれないため
  （`packages/e2e` の `test` スクリプトはプロトコル層の vitest のみ）、
  今回追加したテストは `pnpm test` の対象には含まれない（既存の
  `test:e2e:ui` 配下の全テストと同じ扱い）

#### 変更したファイル

- `packages/frontend/src/styles.css`: `.mempool-panel` の `max-height` を
  `min(260px, calc(100vh - 585px))` に変更し、根拠をコメントに追記
- `packages/e2e/SCENARIOS.md`: 「浮遊オーバーレイパネルのレイアウト
  重なり回避（UI-OVERLAY）」節と `UI-OVERLAY-01` を追加
- `packages/e2e/src/ui/mempool-panel-layout.spec.ts`（新規）: 上記の実装

#### 確認済み

`pnpm lint && pnpm build && pnpm test`（リポジトリ全体）がすべて成功
することを確認した（frontend 267ファイル3380件、shared 6ファイル75件、
collector 92ファイル1765件、e2e（プロトコル層）16ファイル185件、いずれも
失敗なし）。

#### 次の担当が知っておくべきこと

- 5-2（P2P凡例ポップオーバーの下端はみ出し）は未対応のまま。対応するなら
  `PopoverPortal`/`computePopoverPosition` に「画面外に出る場合は上方向へ
  反転する」ロジックを追加する形になるが、9箇所の呼び出し元すべてに
  影響するため、別Issueとして切り出し、既存の各ポップオーバー配置の
  回帰確認も合わせて行うべきと判断した
- `.mempool-panel` の `max-height` に使った `585px`（385 + 200）は、
  現在の `.canvas-overlay-top` の実際の高さ（1280幅で下端が約175px）を
  前提にした固定値。将来 `CanvasToolbar` / `LayerFilterBar` の内容が増えて
  行数が増える（例: レイヤー種別が増えてチップが折り返す）と、この
  200px の余裕を超える可能性がある。その場合はこの値の見直しが必要
- より根本的には、`.mempool-panel` の `bottom: 385px` 固定というレイアウト
  自体（`.contract-list-panel` との積み上げ計算に基づく決め打ち）が、
  ビューポートの変化に弱い設計になっている。今回はその場しのぎではなく
  「ビューポート高に応じて動的に絞る」形にしたが、`.canvas-overlay-top`
  の実際の高さを JS で測定して反映するような、より頑健な仕組みへの
  刷新は本対応のスコープ外とした（QAの「過剰な作り込みは避け、今回の
  退行を解消する範囲に留める」という指示に沿った判断）
