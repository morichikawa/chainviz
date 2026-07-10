# Issue #246 isValidatorServiceがサービス名のみで判定しており将来の別チェーンプロファイルで誤検出しうる

### 2026-07-11 Issue #246 設計メモ

- 担当: collector
- ブランチ: issue-246-validator-service-detection

#### 現状の問題点

`packages/collector/src/adapters/ethereum/targets.ts` の
`isValidatorService(obs)`（Issue #214 で追加）は、compose サービス名
（`com.docker.compose.service` ラベル）に `/validator/i` が部分一致するか
だけで「P2P に参加しない validator client (VC)」を判定している。

- 判定材料が名前の類推であり、実際のコンポーネント種別（クライアント
  プロセスが何であるか）を見ていない
- 消費側は `index.ts` の `toEntity` の `p2pRole` 導出のみで、`isBeaconService`
  のように「クライアント種別チェックとの二段構え」（`beaconTargets` /
  `isConsensusBeaconNode` が `CONSENSUS_CLIENTS` も併用する）になっていない
- 将来、別チェーンプロファイルで "validator" を含むが実際は P2P に参加する
  ノードの compose サービス名が使われた場合（例: `tx-validator`）、その
  ノードを誤って `p2pRole: "none"` に分類してしまう

現行の Ethereum プロファイルではこの問題は起きない（`isValidatorService` の
既存 JSDoc に前提条件として明記済み。VC サービス名は `validator1`/
`validator2` のみで、addNode は VC を作らない）ため不具合ではないが、
CLAUDE.md の「チェーン固有ロジックを ChainAdapter 実装の内側に閉じ込める」
「チェーンプロファイル単位で増やす」原則に照らすと、名前ベースの判定は
新チェーン追加のたびに衝突リスクを持ち込む設計になっている。

#### `ROLE_LABEL`（`com.chainviz.role`）との関係

`packages/collector/src/adapters/ethereum/labels.ts` に Issue #215 で
追加された `ROLE_LABEL`（`com.chainviz.role`）は、以下の性質を持つ:

- 静的コンテナ（compose テンプレート）・動的コンテナ（addNode/addWorkbench
  時に `node-lifecycle.ts` が付与）の**両方**に必ず付く
- 値は `execution` / `consensus` / `validator` / `workbench` で、
  `profiles/ethereum/docker-compose.yml` の validator1/validator2 サービスに
  `com.chainviz.role: "validator"` が明示的に設定済み
- `NodeEntity.nodeRole` の出所であり、collector は値の妥当性検証・解釈を
  せず生値をそのまま転記する方針（Issue #215 の設計判断）

つまり `isValidatorService` が本来見たい「compose 側が宣言した役割」は、
すでに `ROLE_LABEL` という明示的なラベルとして存在している。名前の部分
一致という間接的な手がかりに頼る理由はなく、`isBeaconService` や
`serviceNodeKey` のような「compose サービス名からの推測」を使い続けている
他の関数群とは別で、`isValidatorService` だけを `ROLE_LABEL` ベースの判定に
置き換えるのが最も頑健。

#### 修正方針

`isValidatorService(obs)` の実装を、compose サービス名の正規表現マッチから
`obs.labels[ROLE_LABEL] === "validator"` の厳密一致に変更する。

- ラベルが無い・想定外の値の場合は `false`（他のラベル判定
  `MANAGED_LABEL`・`P2P_ROLE_LABEL` と同じ「省略・想定外 = 安全側」の流儀に
  揃える）
- 大文字小文字の揺れは許容しない（`ROLE_LABEL` の値は collector が生成する
  ものではなく compose/`node-lifecycle.ts` が付与する固定値のみのため、
  旧実装にあった大文字小文字を無視する挙動は不要になる。Issue #215 の
  `nodeRole` 転記と同様、値の正規化はしない）
- `isValidatorService` は Ethereum アダプタ内（`targets.ts`）に留め、
  ChainAdapter 境界は崩さない。ワールドステートのスキーマ・フロントの
  語彙に "validator" 等のチェーン固有語を漏らす変更ではない
- `targets.ts` には既存の重複定義（`labels.ts` の `COMPOSE_SERVICE_LABEL` と
  同名・同値のローカル定数）があるが、これは Issue #214 時点からの既存の
  設計でありスコープ外（今回のIssueと無関係）。`ROLE_LABEL` は `labels.ts`
  から import して使う

#### 影響範囲

- `index.ts` の `toEntity` の `p2pRole` 導出（`isValidatorService(obs)` の
  呼び出し1箇所）はロジック変更不要（関数のシグネチャ・戻り値の意味は
  変わらない）
- 既存テスト（`targets.test.ts` の `isValidatorService` 系、`index.test.ts` の
  VC 関連 `p2pRole` テスト）は名前ベースの挙動を固定しているため、
  ラベルベースの挙動に合わせて全面的に更新する。特に「名前だけ
  "validator" を含み実際は execution ノード」のケースを「false になる」に
  反転させ、Issue #246 の回帰テストとして残す
- `beaconTargets`/`isBeaconService`/`serviceNodeKey` 等の他の名前ベース判定は
  本Issueのスコープ外（Issue本文も `isValidatorService` に限定した指摘）

### 2026-07-11 Issue #246 collector側実装

- 担当: collector
- ブランチ: issue-246-validator-service-detection
- 内容: 設計メモどおり実装した。

  1. `packages/collector/src/adapters/ethereum/targets.ts` の
     `isValidatorService(obs)` を、`obs.labels[COMPOSE_SERVICE_LABEL]` への
     `/validator/i` 部分一致から `obs.labels[ROLE_LABEL] === "validator"` の
     厳密一致に変更した。`labels.ts` から `ROLE_LABEL` を import した
     （`COMPOSE_SERVICE_LABEL` は `isBeaconService`/`serviceNodeKey` 等
     他の関数がまだ使うため変更していない）。
  2. JSDoc コメントを、`ROLE_LABEL` が静的・動的コンテナの両方に必ず付く
     ラベルであること、ラベル無し・想定外の値は false になること
     （`MANAGED_LABEL`/`P2P_ROLE_LABEL` と同じ流儀）、大文字小文字を
     正規化しないこと（`nodeRole` の生値転記、Issue #215 と同じ方針）を
     明記して更新した。
  3. `index.ts` の `toEntity` の `p2pRole` 導出コメントも、判定材料が
     compose サービス名からロールラベルに変わったことを反映して更新した
     （導出ロジック自体は無変更。`isValidatorService(obs)` の呼び出し1箇所
     のみで、戻り値の意味は変わらない）。

- テスト:
  - `targets.test.ts`: `isValidatorService` の describe ブロックを全面的に
    ロールラベルベースの契約に書き換えた。ラベル一致で true、ラベル欠落・
    他ロール（execution/consensus/workbench）で false、compose サービス名は
    無視され role ラベルのみが判定材料であることの確認（#246 の回帰テスト。
    "tx-validator1" という名前でも role が execution なら false、逆に
    "vc-a" という名前でも role が validator なら true）、大文字小文字を
    正規化しないことの確認を追加した。
  - `index.test.ts`: VC 関連の `p2pRole` テスト群を更新し、fixture に
    `com.chainviz.role` ラベルを追加した。新規に以下を追加した。
    - 名前に "validator" を含むが role ラベルが "execution" の execution
      ノードが `p2pRole: "peer"` のままであること（#246 の回帰テスト。
      修正前は誤って `"none"` になっていた）
    - role ラベルの大文字小文字を正規化しないこと（"VALIDATOR" は
      マッチしない）
    - role ラベルが全く無いノードが従来どおり `"peer"` になること
  - 修正前のコード（`isValidatorService` を旧実装の正規表現マッチに一時的に
    戻した状態）に対して新規テストを実行し、上記の回帰テスト4件
    （`targets.test.ts` 2件・`index.test.ts` 2件）が実際に失敗する
    ことを確認したうえで修正を元に戻した（回帰検出能力の確認）。

- 検証: `pnpm --filter @chainviz/collector build`・
  `pnpm --filter @chainviz/collector test`（43ファイル1156テスト）が
  すべて成功。変更ファイルに対する `pnpm exec eslint` も警告・エラー0件。

- 決定事項・注意点:
  - `beaconTargets`/`isBeaconService`/`serviceNodeKey` 等、他の compose
    サービス名ベースの判定ロジックは本Issueのスコープ外のため変更して
    いない。これらは `isValidatorService` と異なり `isConsensusBeaconNode`
    のようにクライアント種別チェックとの二段構えを持つ、または VC 判定と
    独立した目的（同一論理ノードの対応付け）のため、本Issueが指摘した
    誤検出リスクとは性格が異なる
  - `docs/PLAN.md` のバックログに #246 の行を追加し、チェック済みにした

### 2026-07-11 Issue #246 テスト強化

- 担当: tester
- ブランチ: issue-246-validator-service-detection
- 内容: 実装担当が書いた基本テストを異常系・境界値の観点で補強した。
  実装コードは変更していない（既存テストへの追加のみ）。

  `packages/collector/src/adapters/ethereum/targets.test.ts` の
  `isValidatorService` の describe ブロックに、`"validator"` に類似するが
  完全一致しない役割ラベル値（near-miss）で必ず false になることを固定する
  `it.each` を追加した。ケース: 先頭のみ大文字 `"Validator"`・混在
  `"vAlIdAtOr"`・末尾空白 `"validator "`・先頭空白 `" validator"`・前後空白
  `" validator "`・接尾辞 `"validator-2"`・数字続き `"validator1"`・複数形
  `"validators"`・接頭辞 `"tx-validator"`・末尾改行 `"validator\n"`・空文字
  `""` の11件。

  意図: 実装担当のテストは全ロール値（execution/consensus/workbench）と
  大文字化 `"VALIDATOR"` の1件で「厳密一致であること」を担保していたが、
  前後空白・接尾辞・空文字といった境界値が未カバーだった。これらを固定
  することで、将来 `isValidatorService` を `.includes` やトリム・大文字小文字
  無視へ緩めた場合に確実に検出できるようにする（`=== "validator"` の契約の
  回帰ガード）。

- 検討したが追加しなかったもの:
  - `index.test.ts` の `p2pRole` 導出（3分岐 bootnode > validator(none) >
    peer）は、実装担当の既存テストで validator→none・tx-validator1
    execution→peer（#246 回帰）・`"VALIDATOR"`→peer・bootnode ラベル優先・
    beacon consensus→peer・role ラベル無し→peer が網羅済み。統合レベルで
    near-miss を追加するのは単体レベルの新規テストと重複するため見送った。
  - ラベル値の型は `Record<string, string>`（`docker/types.ts`）で常に
    文字列のため、null/undefined 値のケースは型上発生しない。ラベルキー
    自体の欠落は実装担当の既存テスト（`labels: {}`）で担保済み。

- 検証: `pnpm --filter @chainviz/collector build` 成功。
  `pnpm --filter @chainviz/collector test`（43ファイル1167テスト、
  従来1156 + 追加11）がすべて成功。

- 実装のバグ疑い: なし。`isValidatorService` は設計メモどおり
  `obs.labels[ROLE_LABEL] === "validator"` の厳密一致で、依頼の観点
  （ラベル欠落時のフォールバック・near-miss 値・サービス名との独立性・
  p2pRole への影響）はいずれも仕様どおりの挙動を確認した。
