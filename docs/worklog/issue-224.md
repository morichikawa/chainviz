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
