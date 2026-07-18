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
  #346の修正範囲外(UI-C-04のみ変更)。
