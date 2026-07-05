# Issue #63 作業記録

### 2026-07-04 Issue #63 コンテナ削除競合対策の実機検証(qa)

- 担当: qa
- ブランチ: issue-63-teardown-race
- 内容:
  - 実 Docker(profiles/ethereum の稼働中スタック)+ ビルド済み collector を
    子プロセスとして起動し、実際に動かして 409 競合の解消を検証した。
  - 静的確認: `pnpm lint`(クリーン)/ `pnpm build`(全4パッケージ成功)/
    `pnpm test`(collector 329・frontend 301 すべて通過)。
  - E2E: `pnpm test:e2e` 全9テスト成功(所要 約302秒)。他 worktree で
    vitest/test:e2e が動いていないことを事前に確認してから実行(#64 の
    ポート奪い合い回避)。最重要の「追加 reth が既存チェーンへブロック追従」
    (約244秒)も含め合格。
  - 409 競合の直接再現: addWorkbench / addNode で作成したコンテナに対し、
    同一 workbenchId / nodeId への removeWorkbench / removeNode を6並行で送信。
    修正後はいずれも全6件 ok:true を返した。collector ログには対象コンテナ
    ごとに「removal already in progress; treating as removed」warn が
    (勝者1を除く)5件ずつ出ており、良性の 409 が成功相当に畳まれていることを
    実ログで確認。unhandledRejection / uncaughtException のログは出ず、
    テスト中も collector プロセスは生存し続けた。
- 決定事項・注意点:
  - removeNode は consensus(beacon)→ execution(reth)の2コンテナを順に削除する
    ため、6並行 removeNode では beacon・reth の各コンテナで5件ずつ 409 が畳まれる
    (計3コンテナ分の warn を確認)。同一 ID への並行削除は node-lifecycle が
    findIndex→await の間に同じ containerId を捕捉するため、同一コンテナへ複数の
    remove が重なる = 本 Issue が想定する競合を確実に再現できる。
  - 検証後、テスト用に追加した managed コンテナはスクリプト内の
    removeNode/removeWorkbench ですべて削除され、`com.chainviz.managed=true` の
    残存は0件。profiles/ethereum の compose スタックは検証前から稼働していた状態を
    維持している(停止していない)。
  - 本 Issue は docs/PLAN.md のチェックボックスに紐づかないため、チェックの付与は
    なし。実機での 409 解消・E2E 安定動作をもって合格と判断した。

### 2026-07-04 Issue #63 コンテナ削除競合対策のレビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-63-teardown-race
- 内容:
  - collector の修正(409「削除進行中」の成功相当化 + プロセス安全網)を静的レビュー。
    `pnpm lint` / `pnpm build` / `pnpm test`(collector 329・frontend 301)すべて通過を確認。
    実環境での動作検証(E2E含む)は qa に委ねる。
  - 409 ハンドリング: `isRemovalInProgress` は statusCode 409 かつメッセージが
    「removal of container ... is already in progress」の場合だけを成功相当に畳み、
    無関係な 409 は従来どおり伝播させる実装であることを確認。仮に Docker 側の
    メッセージ文言が将来変わっても「修正前の挙動(ok:false)に戻るだけ」で安全側に
    倒れる点も良い。対応するユニットテストは正常系(warn ログ含む)・無関係 409 の
    伝播の両方をカバーしており、修正前のコードでは失敗する意味のあるテストになっている。
  - CommandHandler が全コマンド経路で例外を commandResult(ok:false) に変換している
    こと、node-lifecycle が「削除成功後に登録を外す」順序で再実行安全であることも
    合わせて確認した。
- 決定事項・注意点:
  - `installProcessSafetyNet` が uncaughtException 後もプロセスを維持する設計は、
    「監視・自動再起動が無く、プロセス消滅 = managed コンテナ全孤児化」という現状の
    制約下では**暫定策として妥当**と判断する。Node.js の一般的な推奨(uncaughtException
    後は再起動)から外れることは実装コメント・WORKLOG に明記されており、握りつぶしでは
    なく必ずログに残す実装になっている。ただしこれは恒久策ではない。
  - 恒久策として「collector 起動時に `com.chainviz.managed` ラベルで既存 managed
    コンテナを回収してレジストリを再構築する」をバックログ Issue 化することを推奨する
    (ラベルは既に全 managed コンテナへ付与済みで実現可能。collector 再起動で追加ノードが
    UI から削除不能になる既存の問題も同時に解消する)。回収の仕組みが入った後は、
    uncaughtException の方針を「ログ + 終了(fail-fast)」へ見直すべきである。
    ファイルベースの永続レジストリ案は、Docker 側の実態(ラベル)と二重管理になるため
    ラベル回収方式を推す。
  - コミットはレビュー時点で未実施。「1変更1コミット」に従い、(1) 409 ハンドリング
    (dockerode-operations + 対応テスト2ファイル)、(2) プロセス安全網(index.ts + テスト)、
    (3) docs(WORKLOG) の3コミットに分けること。

### 2026-07-04 Issue #63 コンテナ削除競合(HTTP 409)によるクラッシュと孤児蓄積の対策(collector)

- 担当: collector
- ブランチ: issue-63-teardown-race
- 内容:
  - `stopAndRemove`(dockerode-operations.ts)で、`remove({force:true})` が
    HTTP 409「removal of container ... is already in progress」を返した場合を
    成功相当として扱うようにした。既存の 404(削除済み)扱いに `isRemovalInProgress`
    による 409 判定を追加し、進行中である旨を `console.warn` に残したうえで
    正常終了させる。メッセージが「削除進行中」でない 409 は良性の競合ではない
    ため従来どおり例外を伝播させる。
  - collector プロセス起動時に安全網(`installProcessSafetyNet`, index.ts)を張り、
    どのハンドラにも紐づかない背景の非同期エラー(`unhandledRejection` /
    `uncaughtException`)でプロセス全体が落ちないようにした。検知した内容は
    必ずログに残す(握りつぶさない)。collector は managed コンテナの参照を
    メモリ上のレジストリだけで保持しているため、プロセスが落ちると作成済み
    コンテナがすべて孤児になる。この連鎖を断つのが目的。
  - 対応するユニットテストを追加(409 を成功相当に扱う/無関係な 409 は伝播
    させる/安全網が例外内容をログしプロセスを落とさない、など)。
- 原因の切り分け:
  - 現象を実 Docker で再現。稼働中の profiles/ethereum に対し collector を起動し、
    同一 workbenchId へ removeWorkbench を 4 本同時送信すると、修正前は 3 本が
    409(「removal of container ... is already in progress」)で ok:false を返して
    いた(削除自体は別の 1 本が完了させるため、本来はすべて成功扱いにできる)。
    修正後は 4 本とも ok:true になることを確認した。
  - CommandHandler は addNode/removeNode/addWorkbench/removeWorkbench の全経路で
    例外を try/catch し commandResult(ok:false) へ変換しており、コマンド経路から
    409 がそのまま未捕捉で漏れる箇所は無いことを確認した。したがって 409 は
    まず「本来消えるコンテナに対する不要なコマンド失敗」を生む問題であり、
    これを発生源(stopAndRemove)で成功相当に畳むのが主対策。
  - E2E を連続実行した際に一度だけ collector の WebSocket が切れる(プロセスが
    落ちる)不安定さを観測したが、同条件を単体で確定再現することはできなかった。
    背景の非同期エラー(Docker/WS ソケットで状態遷移中に遅れて発火する類)が
    プロセスを落とし得るため、上記の安全網で「落とさずログに残す」方針を採った。
    これは長時間稼働するデータ収集プロセスとして、1 コマンドの失敗より孤児の
    連鎖蓄積の方が被害が大きいという判断による。
- 検証:
  - collector パッケージ: `pnpm build` / `pnpm test`(329 tests)通過。`pnpm lint` 通過。
  - `pnpm test:e2e` を連続 3 回(back-to-back を含む)実行し、いずれも 9/9 通過。
    back-to-back 実行後に managed ラベルの孤児コンテナが残っていないことも確認。
- 注意点・申し送り:
  - `installProcessSafetyNet` は `uncaughtException` も含めてプロセスを維持する
    設計にしている。一般には uncaughtException 後は状態不整合の懸念から再起動が
    推奨されるが、本 collector には監視・再起動の仕組みが無く、落ちると managed
    コンテナが即孤児化する。ここは「落ちるより維持してログを残す」を選んだ判断で
    あり、方針の是非はレビューで議論の余地がある。
  - より根本的には、collector が作成した managed コンテナを永続レジストリ化する、
    もしくは起動時に `com.chainviz.managed` ラベルで既存コンテナを回収する仕組みが
    あれば、プロセス再起動時の孤児化そのものを無くせる(本 Issue の範囲外。別途
    バックログ化を推奨)。

