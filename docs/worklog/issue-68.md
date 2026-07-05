# Issue #68 作業記録

### 2026-07-04 Issue #68 WebSocket接続ごとのerrorリスナー(qa)

- 担当: qa
- ブランチ: issue-68-ws-error-listener
- 内容:
  - 実装を実際に動かして検証した。このIssueはdocs/PLAN.mdのチェック
    ボックスに紐づかないため、実動作をもって合否を判定した。合格と判断。
  - 静的確認: `pnpm lint` / `pnpm build` / `pnpm test` すべて通過
    (collector 333件・frontend 301件、websocket-server.test.ts 20件)。
  - 動作確認: ビルド済みdistのCollectorServerを実際に起動し、意図的に
    installProcessSafetyNet()を張らない状態(errorリスナーが無ければ
    未処理'error'でプロセスがクラッシュする条件)で以下を確認した。
    (1) クライアントAが接続しスナップショットを受信。生ソケットに不正な
    (マスクなし)WebSocketフレームを注入してサーバー側にソケットエラー
    (WS_ERR_EXPECTED_MASK)を発生させた。(2) onConnectionのerrorリスナー
    が発火し、`[collector] websocket connection error:`として発生源つきで
    ログに残った。(3) collectorプロセスは同一pidのまま生存し続けた。
    (4) その後に別のクライアントBを接続し、commandを送ると
    commandResult(ok:true)が正常に返り、1接続のエラーが他接続に影響
    しないことを確認した。
  - 反証確認: 同じ不正フレーム注入を、onConnectionでerrorリスナーを
    張らない素のWebSocketServer(修正前の状態を模擬)に対して行うと、
    未処理'error'イベントでプロセスがクラッシュ(exit 1)することを確認。
    本修正が実際に必要な問題を塞いでいることを裏付けた。
- 決定事項・注意点:
  - TCPの単純なRST(resetAndDestroy)ではサーバー側で'error'が発火せず
    (クリーンなclose扱いになる)ログに残らなかった。ソケットレベルの
    'error'を確実に起こすには不正フレーム注入が有効だった。手動での
    再現時の参考として記録する。
  - 検証に使った一時スクリプトは削除済み。ワークツリーはクリーン。

### 2026-07-04 Issue #68 WebSocket接続ごとのerrorリスナー(reviewer)

- 担当: reviewer
- ブランチ: issue-68-ws-error-listener
- 内容:
  - Issue #68(接続単位のerrorリスナー追加、listen()後のwssエラー監視、
    ServerLogger注入)の静的レビューを実施。`pnpm lint` / `pnpm build` /
    `pnpm test`(collector 333・frontend 301、websocket-server.test.ts は
    20件)すべて通過。合格と判断した。
  - 接続単位のリスナー: `onConnection` 冒頭で `ws.on("error", ...)` を
    張り、発生源つきでログに残す。握りつぶしではなくエラー本体を
    ログへ渡しており、#63 の安全網(installProcessSafetyNet)を
    「どのハンドラにも紐づかない背景エラーの最後の砦」に保つ設計意図
    (#59 レビュー時の指摘)と整合する。
  - listen() の付け替え: `once("error", reject)` → listening 発火時に
    同期的に removeListener + 恒久ログハンドラへ切り替えるため、
    エラーが未監視になる時間窓は存在しない。listening 前のエラーは
    従来どおり reject される。
  - ServerLogger 注入: `(message, detail)` 形式で
    installProcessSafetyNet の log 引数・startPollingLoop の onError と
    同じ既存パターン。省略時 console.error のオプショナル引数で
    呼び出し側(index.ts)の変更も不要。shared の型変更なしは妥当。
  - テストの質: 3件とも壊れたコードで落ちることを確認した。
    (1) リスナー未登録なら emit("error") が EventEmitter 規約で throw
    して失敗する。(2) 片方の接続のエラー後も他クライアントへの
    broadcastDiff が届くことを検証。(3) 旧実装(once の reject が残る)
    では throw しないがログに残らないため `logged.toContain` で失敗する。
    3件目が「reject 済み promise への握りつぶし」を正しく判別できている。
- 決定事項・注意点:
  - 非ブロッカーの推奨: listen() の起動時エラー経路(ポート衝突で
    reject)は今回の付け替えで構造が変わったが、対応するテストが
    従来から存在しない。同一ポートで2回 listen して reject を確認する
    テストの追加を chainviz-tester に推奨する。
  - テストが private フィールド `wss` へキャストでアクセスしている点は、
    サーバー側ソケットに error を注入する手段が他にないため許容。
  - 変更は未コミット。実装とテストは同一の関心事なので1コミットで
    まとめてよい(CLAUDE.md「テストは同じ変更の中で書く」)。

