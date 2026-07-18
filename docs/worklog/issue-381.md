# Issue #381 workbenchのETH_RPC_URLがdev collectorプロキシ(4001)に固定でUI E2E単独実行時に到達できない

### 2026-07-18 Issue #381 起票の経緯

- 担当: 統括
- ブランチ: issue-381-workbench-rpc-url-backlog
- 内容: Issue #346の最終QA検証(docs/worklog/issue-346.md「2026-07-18 Issue #346
  最終QA検証」節)でchainviz-qaが偶発的に観測した非ブロッキングの環境問題を
  Issue化し、`docs/PLAN.md`のバックログ節末尾に追記した。
- 事実関係: `contract-lifecycle.spec.ts`のUI-C-06のセットアップ
  (`docker compose exec workbench forge create`)が、dev collectorを
  別途起動していないクリーン環境では`host.docker.internal:4001`への
  Connection refusedで失敗する。原因はcompose定義のworkbenchの
  `ETH_RPC_URL`がdev collectorのロギングプロキシ(4001)に固定されている
  一方、UI E2Eのcollectorは4125/4126で動作するため。dev collectorを
  4000/4001で起動した状態で再実行するとUI-C-06も通過することをqaが確認済み。
  Issue #346自体のホバー/描画flakinessとは無関係の既存の環境結合であり、
  #346の修正範囲外(`contract-lifecycle.spec.ts`内ではUI-C-04のみ変更)。

### 2026-07-18 Issue #381 起票・バックログ追記のレビュー

- 担当: reviewer
- ブランチ: issue-381-workbench-rpc-url-backlog
- 判定: **合格**(1回の差し戻しを経て解消)
- 1回目: `docs/worklog/issue-381.md`を新規作成したにもかかわらず
  `docs/WORKLOG.md`索引への1行追加が漏れていたため差し戻し
  (CLAUDE.md開発ルール「新規ファイルを作った場合はdocs/WORKLOG.mdにも
  1行追加する」への違反)。それ以外の確認項目(Issue本文とPLAN.md追記の
  一致、参照事実の実在確認(`profiles/ethereum/docker-compose.yml`の
  ETH_RPC_URL固定値・`packages/e2e/src/helpers/playwright-global-setup.ts`
  のE2E collectorポート4125/4126)、コミット粒度、lint/build/test全通過)
  はすべて合格水準だった
- 2回目: 索引行(コミット04c18e5)を追加し再確認を依頼したところ合格。
  差分1行のみの追加でフォーマット・配置・記載内容とも既存確認済み事実と
  齟齬なし
- docs配下のみの変更のため、CLAUDE.mdの例外規定に基づきchainviz-qaは
  省略(reviewer合格のみ)
