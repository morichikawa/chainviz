# Issue #224 docs/CONCEPT.md・docs/ARCHITECTURE.mdへの図解(Mermaid)追加

### 2026-07-11 Issue #224 docs/CONCEPT.md・docs/ARCHITECTURE.mdが文章のみで分かりにくいので図解(Mermaid等)を増やしたい

- 担当: designer
- ブランチ: issue-224-docs-diagrams
- 内容: 文章のみだった両ドキュメントに、GitHubのMarkdownレンダリングで
  表示されるMermaid記法の図を計8つ追加した。既存の文章は削らず、図は
  文章の理解を助ける併記として置いた(唯一の例外はCONCEPT.mdの
  アーキテクチャ案の既存ASCIIアート図で、これは内容を変えずにMermaidへ
  変換した)。追加した図は以下のとおり。
  - `docs/CONCEPT.md`(3図)
    1. 「アーキテクチャ案」: ノード環境→Collector→GUIフロントの全体
       データフロー(既存ASCII図のMermaid化。観察/操作の双方向を辺ラベルで
       明示)
    2. 「可視化の階層(レイヤー)」: A層〜D層のスタック図(各層の対象と
       データ源を1枚に集約)
    3. 「ロードマップ」: Phase 1〜9のフロー図(Phase 1〜6=Ethereum
       プロファイルの作り込み、Phase 7〜9=チェーンプロファイル追加、
       という2段階のまとまりをsubgraphで表現)
  - `docs/ARCHITECTURE.md`(5図)
    1. §2「エンティティ」末尾: エンティティ関連図(erDiagram)。エンティティ
       間の参照フィールド・エッジ型をカーディナリティ付きで図示。
       UserOperationEntity(AA・発展)は未実装のため省略と明記
    2. §2「差分イベント」: DiffEventの永続系(storeに畳み込み・snapshotに
       反映)と揮発系(passthrough配信のみ)の2系統の流れ図
    3. §3「WebSocketプロトコル」: 接続→snapshot→diffループ→command→
       commandResult→後続diffのシーケンス図
    4. §4「チェーンプロファイルの構成」: 3点セット(ノード環境テンプレート・
       ChainAdapter・フロント表現セット)とChainAdapter境界の模式図
       (チェーン固有の知識が3点セットの中に閉じることを図示)
    5. §7「Phase 5(D層)」冒頭: CL→EL Engine API駆動とCollectorのメトリクス
       スクレイプ→internalsパッチ/nodeLinkActivity配信のシーケンス図
- 決定事項・注意点:
  - 図はMermaidに統一した(Issue本文の「MermaidかHTMLか」の選択)。理由は
    GitHub上でそのままレンダリングされ、テキスト差分でレビューできるため
  - 全節を網羅せず、データフロー・エンティティ関係・境界・シーケンスなど
    「文章だけでは構造が追いにくい箇所」に絞った(レビュー負荷への配慮。
    Issueの指示どおり)。§6(Phase 4 UX)・§8(E2E)は表・箇条書きが既に
    構造化されているため図は追加していない
  - 8図すべてを mermaid v11 + jsdom の `mermaid.parse` で機械検証し、
    構文エラーが無いことを確認した(GitHubのレンダラと同じメジャー
    バージョン。レンダリングの見た目までは検証していないので、マージ後に
    GitHub上で一度目視確認するとよい)
  - CONCEPT.mdのアーキテクチャ図の「Docker(compose / Kurtosis)」という
    表記は原文のASCII図のまま維持した(Kurtosis不採用の決定は同ドキュメント
    の未決事項・ARCHITECTURE.md §7.1に記録済みで、図の変換で内容を
    改変しないことを優先した)
  - 図と本文の整合は通読で確認済み。今後スキーマ・プロトコル・Phaseの
    記述を変更する際は、対応する図も同じ変更で更新すること(sync-docsの
    確認対象に図も含める)

### 2026-07-11 Issue #224 レビュー(chainviz-reviewer)

- 担当: reviewer
- ブランチ: issue-224-docs-diagrams
- 内容: 追加された8図のMermaid図を、対応する本文・実装と照合してレビューした。
  判定は**合格**。確認した内容は以下のとおり。
  - エンティティ関連図(erDiagram)の全12関係のカーディナリティを
    `packages/shared/src/world-state/entities.ts` の型定義と突き合わせて確認。
    walletIds/ownerWorkbenchId(0..1対0..N)、rpcTargetNodeId(optional)、
    blockHash(optional)、receivedAt(Record=多対多)、tokenBalances、
    deployerAddress、contractCall、createdContractAddress/createdByTxHash
    (双方optional=0..1対0..1)いずれも型と整合
  - 差分イベント2系統の図を `packages/shared/src/events/index.ts` と照合。
    永続系5種・揮発系2種の分類がコード内コメントと完全に一致
  - WebSocketシーケンス図を `packages/shared/src/protocol/index.ts` と照合。
    snapshot→diff→command(commandId付き)→commandResult(ok/error)の流れが
    ServerMessage/ClientMessage型と整合。「3秒間隔」は collector の
    `PEER_POLL_INTERVAL_MS = 3000` と一致
  - D層観測フロー図の「slot 約2秒」は `profiles/ethereum/values.env` の
    `SLOT_DURATION_IN_SECONDS="2"`、「スクレイプ3秒」はARCHITECTURE.md
    §7.2の記述と一致
  - CONCEPT.mdのA〜D層スタック図のデータ源は各層の本文記述と一致。
    ロードマップ図のPhase 1〜9の要約も本文と一致
  - docs配下のみの変更であること、lint/build/test全通過(frontend 1817件
    含む)、コミット3件がConventional Commits準拠かつ1変更1コミットで
    あることを確認
  - 8図のmermaid.parse検証を実装担当のスクリプト
    (scratchpadのvalidate-mermaid-jsdom.mjs、mermaid 11.16.0)で再現し、
    全図OKを確認。`<chainName>`を`&lt;chainName&gt;`にエスケープするなど
    構文上の落とし穴への配慮も確認した
- 決定事項・注意点(非ブロッキングの軽微な指摘):
  - ER図は tx実行中のイベント発行(`TransactionEntity.contractEvents` →
    ContractEntity)の関係を省略している。前文が「主要な参照関係」と
    断っているため許容するが、UserOperationEntityと違い省略の明記が
    無い点は将来図を更新する際に補ってもよい
  - 内部駆動の0..1対0..1は、型上は「駆動される側が複数のノードから
    指される」ことを禁止していないが、設計意図(相方クライアントの対)
    としては本文と整合しており問題なし
  - レンダリングの目視確認は未実施(実装担当の申し送りどおり)。マージ後に
    GitHub上で一度確認すること
