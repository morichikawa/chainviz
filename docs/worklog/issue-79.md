# Issue #79 作業記録

### 2026-07-05 Issue #79 ロギングプロキシのボディサイズ超過時の413応答修正(collector)

- 担当: collector
- ブランチ: issue-79-logging-proxy
- 内容: reviewerが指摘したテスト未カバーの境界(`maxBodyBytes`超過・`listen`
  起動失敗)をtesterが強化する過程で、ボディサイズ超過時にクライアントへ
  HTTP 413が届かない不具合が判明したため修正した。
  - 元の実装は `readBody` でボディ長が `maxBodyBytes` を超えた時点で
    `req.destroy()` を呼んでソケットを破棄し、ハンドラ側で400を書き込む
    形だった。しかし `req.destroy()` はレスポンスを送出する前にTCP接続を
    リセットするため、クライアントには明示的なステータスコードが届かず、
    接続エラー(ECONNRESET)としてしか観測されない。
  - 修正: 超過検知時は `req.destroy()` ではなく `req.pause()` で読み取りだけ
    を止め、残りのボディは読まずにハンドラ側で明示的な応答を返すようにした。
    あわせて超過専用の `RequestBodyTooLargeError`(statusCode 413)を導入し、
    過大ボディ(413)と不正ボディ(400)を区別して返す。ボディを最後まで
    読み切っていない接続はkeep-aliveで再利用できないため `Connection: close`
    を明示する。
- 決定事項・注意点:
  - **なぜ `req.destroy()` ではなく `req.pause()` + 明示的な413応答にしたか**:
    このプロキシは透過中継が役割であり、クライアント(ワークベンチのRPC
    ツール)には「なぜ拒否されたか」を接続リセットではなくHTTPステータスで
    伝える必要がある。`req.destroy()` は応答書き込みより先に接続を切るため
    413を送れない。`req.pause()` は受信ストリームの読み取りを止めるだけで
    応答ストリームは生かすため、413応答をクライアントへ確実に届けられる。
    どちらの方式でも「過大ボディを上流ノードへ転送しない」(メモリ枯渇・
    透過性の観点で最重要)点は共通で守られる。
  - **回帰テストが実際に不具合を検出できることの確認**: 追加した回帰テスト
    「returns a 413 response body (not a socket reset) when the body is too
    large」が本当に修正を検証しているかを確かめるため、実装を意図的に
    元の `req.destroy()` に戻した状態でこのテストを実行し、クライアントが
    413ではなく接続リセット(fetchが投げるTypeError)を受けてテストが失敗
    することを確認したうえで、修正済みコードへ戻した。
  - 上限+1バイトの境界テスト(does not forward one byte over)は具体的な
    ステータスコードには踏み込まず「上流へ転送されないこと・2xxを返さない
    こと」のみを表明し、413そのものの検証はこの回帰テストに集約している。
  - `pnpm lint` / `pnpm build` / `pnpm test` はリポジトリ全体で通過。

### 2026-07-05 Issue #79 ロギングプロキシ実装のレビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-79-logging-proxy
- 内容: collectorが実装したワークベンチRPC観測用ロギングプロキシ
  (`packages/collector/src/proxy/logging-proxy.ts` ほか)を静的レビューした。
  結果は軽微な指摘付きの合格。
  - 透過性: 転送ボディ・返却ボディとも受信文字列を無改変で素通しし、観測用の
    JSONパースはコピーに対して行う設計であることをコード・テスト両面で確認。
    パース不能ボディでも転送が行われること、転送失敗時に502をJSON-RPCエラー
    形式で返しつつログに残すこともテストで担保されている
  - 境界: プロキシはcollector内に閉じており、`packages/shared`・frontendへの
    チェーン固有語彙の漏れはない。`RpcObservation.method`/`params`は未加工の
    観測データとして保持するのみで分岐に使っていない
  - 固定値: 既定転送先 `http://172.28.1.1:8545` は profiles/ethereum の
    docker-compose.yml のreth1固定IPと一致し、前提条件がコードコメントと
    WORKLOG(#79実装記録)の両方に明記され、環境変数で上書き可能。運用ルール
    「固定値の前提条件を明記」を満たす
  - テストの実効性: 新規テストのafterEachにある `vi.unstubAllGlobals()` を
    意図的に外して同ファイルを実行し、実ソケット統合テスト2件が漏れたfetch
    スタブを掴んで失敗することを確認したうえで原状復帰した(修正が「意味の
    あるテスト」であることを実証)
  - `pnpm lint` / `pnpm build` / `pnpm test` はリポジトリ全体で通過
    (collector 379件・frontend 301件)
- 決定事項・注意点(実装担当への軽微な指摘。ブロッカーではない):
  - `docs/ARCHITECTURE.md` の「実装しながら詰める」一覧にある「ロギング
    プロキシの具体的な実装形態(別コンテナか collector 内蔵か)」が未決の
    まま残っている。本Issueで「collector内蔵・既定ポート4001・
    CHAINVIZ_PROXY_PORT/CHAINVIZ_PROXY_TARGETで上書き」に確定したので、
    Issue #65の項目と同様に確定内容を追記すること
  - 「既存テストの後始末不備の修正」は実際には新規の
    `logging-proxy.test.ts` 内のafterEachにのみ適用されている。既存の
    `adapters/ethereum/http-client.test.ts` にも同じパターン
    (`vi.stubGlobal("fetch")` + `restoreAllMocks` のみ)が残るが、vitestの
    ファイル分離と各テストが自前でスタブを張ることから現状は無害。
    一貫性のため同様の `vi.unstubAllGlobals()` 追加を推奨(別途でも可)
  - テスト未カバーの境界: `maxBodyBytes` 超過時に400を返すパス、
    `listen` の起動失敗(ポート使用中)パス。テスト強化(tester)での追加が
    望ましい
  - コミット未実施のため、コミット分割の目安を提示: (1) proxy本体+テスト
    (2) index.tsの配線+テスト (3) docs更新、の3コミット程度が妥当

### 2026-07-05 Issue #79 レビュー指摘への対応(collector)

- 担当: collector
- ブランチ: issue-79-logging-proxy
- 内容: 上記reviewerの軽微な指摘のうち、collector担当分に対応した。
  - `docs/ARCHITECTURE.md` の「実装しながら詰める」一覧にあった「ロギング
    プロキシの具体的な実装形態(別コンテナか collector 内蔵か)」に、
    Issue #65と同様の確定注記を追記した。確定内容は「collector内蔵・
    既定待受ポート4001・既定転送先は既定ワークベンチが叩くノードの
    JSON-RPCエンドポイント・環境変数 `CHAINVIZ_PROXY_PORT` /
    `CHAINVIZ_PROXY_TARGET` で上書き可能」。
  - 既存の `packages/collector/src/adapters/ethereum/http-client.test.ts`
    の `afterEach` に、新規 `logging-proxy.test.ts` と同じ
    `vi.unstubAllGlobals()` を追加した。vitestのファイル分離により現状は
    無害だが、`vi.stubGlobal("fetch")` の後始末を一貫させるための対応。
- 決定事項・注意点:
  - 指摘3(境界値テストの欠落: `maxBodyBytes` 超過→400、`listen` 起動失敗)は
    tester担当分のためこの対応には含めていない。
  - `pnpm lint` / `pnpm build` / `pnpm test` はリポジトリ全体で通過
    (collector 379件・frontend 301件)。

### 2026-07-05 Issue #79 ワークベンチRPC観測用ロギングプロキシの実装(collector)

- 担当: collector
- ブランチ: issue-79-logging-proxy
- 内容: ワークベンチ→ノードのJSON-RPC呼び出しを観測するロギングプロキシを
  collectorプロセス内に実装した。
  - `packages/collector/src/proxy/logging-proxy.ts` を新規追加。HTTP POSTで
    来るJSON-RPCリクエストを受け、呼び出し内容(呼び出し元IP・メソッド名・
    パラメータ・タイムスタンプ)を観測データ(`RpcObservation`)として記録・
    発行しつつ、リクエストボディをそのまま実ノード(reth)へ転送し、
    レスポンスもそのまま返す透過プロキシ。
  - 透過性の担保: 転送するボディ・返すボディは受け取ったバイト列を改変せず
    素通しする。観測用にはボディのコピーを別途JSONパースする(パース失敗や
    method欠落時も転送自体は妨げない)。単発リクエストとバッチ(配列)の
    両方を観測できる。
  - `index.ts` に `startLoggingProxy`・`resolveProxyPort`(既定4001、
    collector本体のWebSocket 4000と衝突回避)・`resolveProxyTarget`
    (既定 `http://172.28.1.1:8545`)を追加し、`main()` で起動するよう配線。
  - 観測データはIssue #80でworld-stateへ組み込むため、今回は `onObserve`
    コールバックで外へ渡せるようにしたうえで、既定ではログ出力にとどめた。
  - ユニットテスト(`logging-proxy.test.ts`・`index.test.ts` に追記)を追加。
    collector全体で379テスト通過、`pnpm lint`/`pnpm build` も通過。
- 実機確認: 稼働中の `profiles/ethereum` に対し、実プロキシを別ポート4002で
  起動し(4001は並行作業中のnode-envの検証用スタンドインが占有していたため)、
  ワークベンチコンテナから `cast chain-id`・`cast block-number`・
  `cast send`(送金tx)を `host.docker.internal:4002` 経由で実行した。
  chain-idは直結時と同じ1337を返し、送金txも `status:0x1` で取り込まれた
  (透過転送を確認)。プロキシログには `eth_sendRawTransaction` を含む一連の
  呼び出しがメソッド名・パラメータ・呼び出し元IP付きで記録された。
- 決定事項・注意点:
  - **コンテナ→ホスト到達性**: ワークベンチコンテナは
    `extra_hosts: host.docker.internal:host-gateway`(node-envのIssue #78で
    設定)により `host.docker.internal` を `172.17.0.1`(docker0ゲートウェイ=
    ホスト)へ解決し、ホスト上のプロキシへ到達できることを実機で確認した。
    追加のcompose変更は不要だった。
  - **呼び出し元の識別**: プロキシがホスト側で観測する `remoteAddress` は
    ゲートウェイIP(172.17.0.1)ではなく、ワークベンチコンテナ自身の
    chainネットワーク上のIP(172.28.0.3)になる。Issue #80では、この
    呼び出し元IPを `InfraEntity.ip` と突き合わせて WorkbenchEntity へ
    紐付けられる見込み。
  - **shared型の変更について(#80向けの申し送り)**: CONCEPT.mdは
    「ワークベンチ→ノードのJSON-RPC呼び出しをエッジ+パルスで描画」と
    するが、既存の `PeerEdge`(kind:"peer")はP2Pピア接続用であり、
    ワークベンチ→ノードの操作呼び出しとは意味的に別物。この観測データを
    world-stateへ組み込む(操作エッジ等の新エンティティ/イベント型を導入
    する)Issue #80では `packages/shared` の型追加が必要になる見込み。
    今回のIssue #79自体ではshared型は変更していない。型の設計・変更は
    chainviz-reviewerと調整する。
  - プロキシのポート(CHAINVIZ_PROXY_PORT)・転送先(CHAINVIZ_PROXY_TARGET)は
    環境変数で上書き可能。既定の転送先を現状のワークベンチ接続先である
    reth1の内部IPに固定している点は、複数ノードへ振り分けたくなった時点で
    見直しが必要(現状は #78 と揃えてreth1のみ)。
### 2026-07-05 Issue #79 ロギングプロキシの境界値・異常系テスト強化(tester)

- 担当: tester
- ブランチ: issue-79-logging-proxy
- 内容: collector実装・reviewerレビュー済みのロギングプロキシに対し、
  reviewer指摘の未カバー境界(`maxBodyBytes`超過、`listen`起動失敗)を含む
  異常系・境界値テストを `packages/collector/src/proxy/logging-proxy.test.ts`
  に6件追加した。実装コードは変更していない。
  - maxBodyBytes境界: ちょうど上限(32バイト)のボディは無改変で転送され200が
    返ること、上限+1バイトのボディは上流へ転送されず(`forward`未呼び出し)
    サイズ超過がログに残ること、成功(2xx)を返さないことを検証。
  - listen起動失敗: 既に使用中のポートで待ち受け開始すると `listen` の
    Promiseが `EADDRINUSE` で reject されることを検証。
  - 追加観点: バッチPOSTを実ソケット越しに送ると要素数分(3件)の観測が
    `onObserve` に発行され、本体は1度だけまとめて転送されること。上流が
    接続拒否した場合に実ソケット越しでも502をJSON-RPCエラー形式で返すこと。
    PUT/DELETEが405で拒否され転送されないこと。
  - `pnpm --filter @chainviz/collector build` / `test` 通過(collector 385件)。
- 決定事項・注意点(実装担当=collectorへの差し戻し。潜在バグの可能性):
  - `maxBodyBytes` 超過時、コードは400を返す意図だが実際にはクライアントへ
    400が届かない。`readBody` がサイズ超過を検知した際に `req.destroy()` で
    ソケットを破棄してから catch 側で `res.writeHead(400)` を試みるため、
    レスポンス送信前に接続がリセットされ、クライアントには接続エラー
    (undiciでは `UND_ERR_SOCKET`)として観測される。再現手順: 小さな
    `maxBodyBytes`(例32)でプロキシを起動し、上限超過の本体をPOSTすると
    fetchが `fetch failed`(cause code `UND_ERR_SOCKET`)で reject される。
    セキュリティ上重要な「過大ボディを上流へ転送しない」不変条件は満たされて
    いるため、追加テストは「2xxを返さない/転送されない」ことのみを表明し、
    400を返す実装に修正しても成立するようにしてある。413/400を明示的に返して
    から接続を閉じたい場合は `req.destroy()` を `req.pause()`+レスポンス後の
    クローズに変える等の対応が必要。実装方針の判断はcollector側に委ねる。

### 2026-07-05 Issue #79 maxBodyBytes超過時413応答修正の再レビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-79-logging-proxy
- 内容: testerが差し戻した「maxBodyBytes超過時に400が返らずソケットが
  切断される」バグへのcollectorの修正(`RequestBodyTooLargeError` 追加、
  `readBody` の `req.destroy()` → `req.pause()` 化、`onRequest` catchでの
  413/400の明示応答 + `Connection: close`)を再レビューした。結果は合格。
  - 修正の妥当性: `req.pause()` は読み取りだけを止めてソケットを生かす
    ため、レスポンス(413)をクライアントへ届けてから接続を閉じられる。
    ボディを読み切っていない接続はkeep-alive再利用できないため
    `Connection: close` を明示するのは正しい(Nodeのhttpサーバーは
    レスポンス送出後にソケットを閉じ、未読データは破棄される)。
    レスポンス送出前に `headersSent` を確認する防御も問題ない
  - `settled` フラグ: サイズ超過後のdata再発火での蓄積継続、
    end/errorの二重settleをすべて防いでおり妥当。reject後にerrorが
    発火してもリスナーが登録済みのため未処理errorでのクラッシュもない
  - テストの実効性: `req.pause()` を意図的に `req.destroy()` へ戻して
    新設の413テストを実行し、`fetch failed`(接続リセット)で実際に
    失敗すること(26件中1件失敗)を確認したうえで原状復帰し、全26件
    通過を再確認した。回帰テストとして機能している
  - `pnpm lint` / `pnpm build` / `pnpm test` はリポジトリ全体で通過
    (shared 2・collector 386・frontend 301・e2e 34)
- 決定事項・注意点:
  - collectorによる413修正そのものの作業記録がWORKLOG.mdに未追記
    だった(最後の記録はtesterの差し戻し)。コミット前に追記すること
  - 400経路のメッセージ "invalid request body" はクライアント起因の
    接続エラー(ECONNRESET等)にも使われるため厳密には不正確だが、
    その場合クライアントはレスポンスを受け取れないため実害はない。
    具体的なエラーはログに残っており握りつぶしには当たらない
  - 全変更が未コミットのまま。前回レビューで提示したコミット分割の
    目安に「tester強化テスト」「413修正+回帰テスト」を加えた分割
    (例: proxy本体+基本テスト / index配線+テスト / tester強化テスト /
    413修正+回帰テスト+既存テスト後始末 / docs更新)を推奨する

