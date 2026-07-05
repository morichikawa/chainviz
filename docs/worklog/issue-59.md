# Issue #59 作業記録

### 2026-07-04 Issue #59 E2E再接続シナリオのQA検証(qa)

- 担当: qa
- ブランチ: issue-59-e2e-reconnect
- 内容: 実環境(profiles/ethereum、稼働中)+実collectorに対し
  `pnpm test:e2e`を実行し、全20件(既存15件+新規5件)成功を確認した。
  再接続時のスナップショット整合性、追加ワークベンチの削除、複数
  クライアント同時接続時の差分配信、接続直後のコマンド取りこぼし無し、
  未接続クライアントへのsendCommand即時拒否、いずれも実データで確認。
  `pnpm lint && pnpm build && pnpm test`(pre-pushフック対象)にE2Eが
  混入しないことも確認。実行前に他worktreeでのtest:e2e同時実行が無い
  ことを確認済み(#64のポート奪い合い回避)。
- 決定事項・注意点: `docs/PLAN.md`の#58・#59チェックボックスに重複・
  欠落が無いことを確認した。差し戻しなし。

### 2026-07-04 Issue #59 E2E再接続シナリオのレビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-59-e2e-reconnect
- 内容:
  - Issue #59(E2E再接続シナリオ)の静的レビューを実施。`pnpm lint` /
    `pnpm build` / `pnpm test`(shared 2・collector 330・frontend 301・
    e2e 14 件)はすべて通過。実行前に `ps aux` で他 worktree の vitest
    同時実行がないことを確認した(#64 のポート奪い合い回避)。
  - `reconnect.test.ts` の5シナリオ、および `ws-client.ts` の
    `connect()` での `snapshotReceived` リセット修正を確認。リセットの
    影響範囲は `connect()` 内の「最初の snapshot」判定のみで、他の
    呼び出し箇所(harness.ts)は接続1回のため影響なし。再接続時は
    `applySnapshot` がエンティティ/エッジの Map をクリアするため古い
    状態も残らない。修正は妥当と判断した。
  - テストの質: シナリオ1(再接続後スナップショット整合性)は修正前の
    ヘルパーではタイムアウトで失敗する(壊れたコードで通らない)こと、
    シナリオ2(複数クライアント差分配信)は送信者だけに差分を返す誤実装
    では B 側の waitForState が失敗することを確認。待機はすべて
    タイムアウト上限つきポーリングで、環境の現在値への決め打ち依存なし。
- 決定事項・注意点:
  - **個別接続の error リスナー欠如(collector からの報告)は「直すべき」と
    判断**。理由: (1) `installProcessSafetyNet` のコメント自身が安全網を
    「どのハンドラにも紐づかない背景の非同期エラーだけを受け止める最後の
    砦」と定義しており、発生源が特定できている接続ソケットの error を
    恒常的に安全網へ流すのはこの設計意図と矛盾する。(2) error リスナー
    未登録のまま throw → uncaughtException で受けると、ws 内部の
    クリーンアップ処理を含む呼び出しスタックが中断され、ソケットの
    後始末が不完全になり得る(長時間稼働の collector でのリーク要因)。
    (3) `CollectorServer` の健全性が index.ts のグローバルハンドラに
    暗黙依存する見えない結合になっており、安全網のないユニットテスト
    実行時は ECONNRESET 等でテストワーカーごと落ちるフレークの芽になる。
    ただしサイレント握りつぶしではなく実害も未発生のため #59 の合否には
    影響させない。`onConnection` での `ws.on("error", ...)` によるログ
    出力+対応ユニットテストを、本ブランチとは別の関心事として収集悟に
    依頼する(あわせて `listen()` 後の wss 自体の error が `once` のみで
    listening 後は未監視である同種の点も確認を推奨)。
  - 軽微な指摘(非ブロッカー): シナリオ「追加したワークベンチを削除でき、
    観測から消える」は再接続とは無関係の後片付けの test 化で
    commands.test.ts と重複気味(後片付けの成否を明示検証する意図として
    許容)。「未接続クライアントへの sendCommand 拒否」は collector では
    なくテストヘルパーの契約の検証(ヘルパーがサイレント無視しない保証
    として許容)。
  - 既存問題の発見: `ws-client.ts` は複合キーの区切りにリテラルの NUL
    文字を含んでおり、git が binary 扱いにして diff がレビューできない。
    今回の変更由来ではないが、`"\u0000"` エスケープへの置換を別途推奨。
  - まだ未コミットのため、コミット時は「ヘルパー修正」「テスト追加」
    「docs 更新」の関心事ごとにコミットを分けること。

### 2026-07-04 Issue #59 E2E に再接続・複数クライアントシナリオを追加(collector)

- 担当: collector
- ブランチ: issue-59-e2e-reconnect
- 内容:
  - `packages/e2e/src/reconnect.test.ts` を新規追加(テスト5件)。
    - 再接続時のスナップショット整合性: クライアントを接続→切断し、切断中に
      別経路(共有クライアント)で addWorkbench した変更が、同一クライアントの
      再接続後の新しいスナップショットに反映されることを確認する(古い状態の
      まま止まらないこと)。続けて removeWorkbench で消えることも確認。
    - 複数クライアント同時接続時の差分配信: クライアント A・B を同時接続し、
      A が送った addNode の entityAdded 差分が B にも配信され、B が送った
      removeNode の entityRemoved 差分が A にも配信されることを確認する。
    - 接続シーケンスのタイミング異常系: WebSocket open 直後(snapshot 受信を
      待たず)に最初のフレームとしてコマンドを送っても取りこぼされず
      commandResult が返ること、および未接続クライアントへの sendCommand が
      サイレント無視されず即座に拒否されることを確認する。
  - `packages/e2e/src/helpers/ws-client.ts` の `connect()` を修正。接続のたびに
    `snapshotReceived` をリセットするようにした。従来は 2 回目以降の connect()
    が「最初の snapshot」判定に永久に一致せず解決しなかったため、同一
    クライアントインスタンスでの切断→再接続が表現できなかった。
- 決定事項・注意点:
  - 再接続テストの操作にはワークベンチを使った。差分/スナップショットの生成
    経路はコマンド種別に依らず共通であり、addNode/removeNode 固有の実データ
    追従は commands.test.ts が別途検証しているため。複数クライアント差分配信
    テストは指示どおり addNode/removeNode で検証した。
  - 実行結果: `pnpm test:e2e` は全 20 件(既存 15 + 新規 5)成功(所要
    約499秒)。実行前に `ps aux | grep vitest` で他プロセスの同時実行が
    ないことを確認(#64 のポート4123奪い合い回避)。e2e のユニットテスト
    (`pnpm --filter @chainviz/e2e test`)も 14 件成功。
  - エラーハンドリング握りつぶし調査(websocket-server.ts / ws-client.ts):
    握りつぶしによる実害は確認されなかった。詳細は下記のとおり。
    - `onMessage` の JSON.parse 失敗時 return・非 command type の無視は
      仕様どおり(不正フレームには返信しない)で、error-paths.test.ts が
      「不正フレーム後も後続コマンドを処理できる」ことを検証済み。
    - `ws.on("message", (data) => void this.onMessage(...))` は onMessage が
      reject した場合に unhandled rejection になりうるが、現状の
      CommandHandler.handle() は全例外を捕捉して commandResult(ok:false) を
      返すため reject しない。仮に reject しても index.ts の
      installProcessSafetyNet(#63) がログに残してプロセスを維持するため、
      サイレントには消えない。
    - 個々の接続 ws に error リスナーが張られていない(onConnection)。ソケット
      レベルの error は上記の安全網(uncaughtException)がログに残して受け止め
      るため、サイレント握りつぶしにもクラッシュにもならない。潜在的な設計の
      改善余地(接続単位の error ハンドラ)ではあるが、実害がなく判断に迷う
      ため今回は変更せず報告に留めた。

