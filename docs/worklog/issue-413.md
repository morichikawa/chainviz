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
