### 2026-07-17 Issue #352 ノード間通信ログにRPC呼び出しのレスポンス(成否・所要時間)を追加する（起票・バックログ追記のレビュー）

- 担当: reviewer
- ブランチ: docs-issue-351-352-backlog
- 内容: Issue #317（ノード間通信ログタブ）のUX設計時に第1弾スコープから
  分割された論点のIssue起票と、`docs/PLAN.md` バックログへの追記
  （docsのみの変更、Issue #351と同一コミット）のレビュー。
  - Issue #352本文と`docs/PLAN.md`追記の照合: 分割の経緯（Issue #317
    第1弾の設計時にchainviz-uxが分割）・分割理由（OperationEdgeへの
    shared型変更とロギングプロキシからのレスポンス観測というcollector
    変更を伴い、フロントのみで完結する第1弾と単位が異なる）・依存関係
    （Issue #317マージ後に着手）・着手時はchainviz-designerの設計を
    先行させる方針のいずれも一致し、過不足なし
  - Issue本文が参照する事実の実在確認: 設計メモ
    `docs/worklog/issue-317.md` は未マージのブランチ
    `issue-317-comms-log-panel` 上に実在し、その §8「第2弾（本Issueに
    含めるか統括の判断待ち): レスポンスの観測」に実現案の下書き
    （collector: `handleRpcRequest` でのレスポンス観測、shared:
    `OperationEdge` へのoptionalフィールド追加、frontend: 成否アイコンと
    所要時間の表示）が実在する。追記の記述はこの §8 の内容と整合
  - `docs/PLAN.md` の追記フォーマットは直前の #351 項目・#346 項目と一貫
    （チェックボックス+6スペースインデントの補足+Issueリンク行）。
    配置（バックログ節末尾・「## 運用ルール」の直前）も適切
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過を確認
- 決定事項・注意点:
  - レビュー結果は合格。コード変更を伴わないためCLAUDE.mdの例外規定に
    基づきchainviz-qaは省略可
  - `docs/worklog/issue-317.md` はレビュー時点でmain未マージ
    （ブランチ `issue-317-comms-log-panel` 上）。Issue #352 に着手する
    頃には #317 がマージ済みのはず（依存関係どおり）なので参照は成立する
  - 実装着手は後日。shared型変更を伴うため、着手時はまず
    chainviz-designerに設計を依頼する
