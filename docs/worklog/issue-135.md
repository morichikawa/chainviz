# Issue #135 作業記録

### 2026-07-07 Issue #135 eth_subscribe WebSocket 切断時の自動再接続(collector)

- 担当: collector
- ブランチ: issue-135-eth-ws-reconnect
- 内容:
  - `packages/collector/src/adapters/ethereum/eth-ws-client.ts` の内部関数
    `subscribe()` に、WebSocket が切断（`"close"` イベント）された際の
    自動再接続処理を追加した。再接続時は元と同じ `wsUrl` /
    `subscribeParams` で新しい WebSocket を張り直し、`eth_subscribe` を
    やり直す。呼び出し側に渡す `onResult` / `onError` コールバックは
    再接続後も同じインスタンスをそのまま使い続ける。
  - `close()` が呼ばれた（購読解除の意図的な切断）場合は
    `closedByCaller` フラグを立ててから実際のソケットを閉じるようにし、
    その後の `"close"` イベントでは再接続をスキップするようにした。
    保留中の再接続タイマーがあれば `close()` 時にクリアする（切断直後の
    バックオフ待機中に `close()` された場合でも再接続しない）。
  - 再接続間隔は固定値 `RECONNECT_DELAY_MS = 2000`（ミリ秒）とし、
    ファイル内のコメントに前提条件を明記した。要点:
    - 対象は「docker compose でノードコンテナが再作成される」という
      chainviz 特有の運用シナリオ。同一ホスト上でのコンテナ再作成は
      通常数秒〜十数秒で完了するため、2 秒間隔なら数回の試行で復旧できる。
    - 指数バックオフは採用していない。対象がローカル Docker ネットワーク
      内の少数ノードに限られ、再接続コスト（TCP 接続 1 回）が小さいため、
      間隔を伸ばす実益が薄いと判断した。
    - リトライ回数の上限は設けず無期限に再接続を試み続ける設計にした。
      chainviz は学習・検証用の使い捨て環境であり、collector プロセスの
      稼働時間がノードコンテナの寿命より長くなることが普通にあるため、
      「N 回失敗したら諦める」実装だとノード復旧後も購読が死んだままに
      なり、Issue #135 で報告された事象そのものが再発してしまう。
  - テストで再接続間隔を短縮できるよう、`createWsEthClient()` に
    オプション引数 `{ reconnectDelayMs?: number }` を追加した（省略時は
    `RECONNECT_DELAY_MS`）。`EthWsClient` インターフェース自体
    （`packages/shared` の型ではなく collector 内部の型）は変更していない。
  - `subscribePeers`（`packages/collector/src/adapters/ethereum/index.ts`）
    についても、同種の「接続が切れたまま復旧しない」問題が無いか確認した。
    こちらは `setTimeout` による周期ポーリング方式で、毎回のティックで
    Beacon API へ新規の HTTP リクエストを送っている（持続的なコネクションを
    張らない）。1 回のポーリングが失敗しても `catch` でログを出したうえで
    次のティックを予約し続ける実装になっており、永続的な切断状態に陥る
    構造ではないことを確認した。修正は不要と判断した。
- テスト:
  - `packages/collector/src/adapters/ethereum/eth-ws-client.test.ts` に
    実際の `WebSocketServer`（"ws" パッケージ）を使った統合寄りのテストを
    追加した（`websocket-server.test.ts` の既存パターンに倣った）。
    - 「サーバー側から接続を強制切断（`terminate()`）した後、クライアントが
      再接続して同じ `subscribeParams`（`["newHeads"]`）で
      `eth_subscribe` をやり直すこと」「再接続後に届いた通知が、最初に
      渡した `onHeader` コールバックでそのまま受け取れること」を確認した。
    - 「呼び出し側が明示的に `close()` した場合は、待っても新しい接続が
      張られない（再接続を試みない）こと」を確認した。
  - 回帰検出能力の確認: 上記1件目のテストを実装前の状態（`"close"`
    ハンドラで何もしない状態）に一時的に戻して実行し、テストが
    タイムアウトで失敗することを確認してから、実装を元に戻した。
  - `pnpm build` / `pnpm test`（collector パッケージ）を実行し、
    全27ファイル640件のテストが通ることを確認した。
- 決定事項・注意点:
  - このworktreeでは本物の docker compose 環境を操作しない方針のため、
    実ノードでの動作確認はしていない。テストは実際の `ws` の
    `WebSocketServer` を使い、サーバー側から `terminate()` することで
    「正常なクローズハンドシェイクを経ない切断」を再現しており、
    docker コンテナ再作成時に近い切断パターンをカバーしている。
  - 次にこの領域を触る担当者向けメモ: `RECONNECT_DELAY_MS` を変更する
    場合は、このファイルとコード上のコメント両方を更新すること
    （CLAUDE.md の固定値ルール）。

### 2026-07-07 Issue #135 再接続まわりのエッジケーステスト強化(tester)

- 担当: tester
- ブランチ: issue-135-eth-ws-reconnect
- 内容: 実装担当が書いた基本テスト（切断→再接続→再購読、明示的
  close 時は再接続しない）を土台に、異常系・境界値の観点で
  `packages/collector/src/adapters/ethereum/eth-ws-client.test.ts` に
  describe ブロック "createWsEthClient reconnect edge cases (Issue #135)"
  を追加した。実装（`eth-ws-client.ts`）は変更していない。
- 追加したテストの観点（5件）:
  - 連続切断: 再接続で張り直した接続が resubscribe 直後に再び切れる状況を
    2 回繰り返し、無期限リトライにより 3 回目の接続で最終的に通知を
    受け取れることを確認。
  - 再接続タイマー待機中の close(): 切断後、バックオフ待機中
    （`reconnectDelayMs=300` の途中で 50ms 後に close()）に呼び出し側が
    close() した場合、保留中のタイマーがクリアされ再接続が起きないことを
    確認（close() 内の clearTimeout 分岐を通す）。
  - 複数購読の独立性: 同じ client から newHeads と
    newPendingTransactions を購読し、newHeads 側だけを切断しても
    pendingTx 側は切断・再接続されず通知を届け続けられること、
    かつ newHeads 側は独立に再接続することを確認（subscribe() ごとに
    ソケット・タイマー・closedByCaller を独立クロージャで持つことの検証）。
  - subscription id の変化: 再接続で eth_subscribe をやり直すとノードが
    別の subscription id を割り当てるが、クライアントは通知の result のみを
    見て id を照合しないため、id が変わっても通知を受け取れることを確認。
  - eth_subscribe のエラー応答: ノードが（通知ではなく）JSON-RPC エラー
    応答を返した場合、現実装では静かに無視され onError も onResult も
    呼ばれずクラッシュもしないことを確認（現状の挙動を固定するテスト。
    下記の制限に対応）。
- 既存実装で気づいた制限（バグではなく設計上の既知の穴。実装は変更せず
  報告に留める）:
  - `subscribe()` は eth_subscription 通知だけを解釈し、`eth_subscribe`
    そのものに対するエラー応答（例: ノードが未対応メソッドを
    -32601 で拒否）を検知しない。この場合、購読ハンドルは生きているが
    通知は永遠に届かず、onError も呼ばれないため、呼び出し側は購読が
    失敗したことに気づけない。newPendingTransactions を未対応の
    ノードに対して購読した場合などに顕在化しうる。Issue #135 の再接続
    実装で新たに入った不具合ではなく、以前からある挙動。対応するかは
    別途判断が必要（このworklogに記録のみ）。
- 確認: collector パッケージで `pnpm build` / `pnpm test` を実行し、
  全 27 ファイル 645 件（既存 640 + 追加 5）が通ることを確認した。

### 2026-07-07 Issue #135 静的レビュー1回目(差し戻し)(reviewer)

- 担当: reviewer
- 結果: **差し戻し**(lint 不合格。それ以外の観点は問題なし)
- 不合格の内容:
  - `pnpm lint` が失敗する。`packages/collector/src/adapters/ethereum/eth-ws-client.test.ts`
    の 342 行目、テスト「isolates a drop on one subscription from another
    subscription on the same client」内で `paramsB` に代入した値が未使用
    (`@typescript-eslint/no-unused-vars`)。`await nextJsonMessage(connB)` の
    待機自体は「connB 側の subscribe フレーム到達を待つ」意味があるので、
    変数に束縛せず `await nextJsonMessage(connB);` とするなどで解消できる
    (修正方法はテスト強化担当の判断に委ねる)
- 確認済みで問題なしと判断した観点:
  - `RECONNECT_DELAY_MS = 2000` の固定値: CLAUDE.md の固定値ルールが求める
    「成立する前提条件をコード上のコメントと worklog の両方に明記」を
    満たしている(eth-ws-client.ts のコメントと本ファイルの実装記録の
    双方に、docker コンテナ再作成が数秒〜十数秒で完了するという前提と
    バックオフ・上限なしの根拠が記載されている)
  - 無制限リトライ: 学習用の使い捨て環境で collector がノードコンテナより
    長寿命という前提では妥当。上限を設けると Issue #135 の事象が再発する
    という理由付けも筋が通っている。失敗時も ws の "error" イベントが
    onError に流れるため、エラーの握りつぶしにはなっていない
  - `closedByCaller` フラグ: `close()` でフラグを立ててから
    `clearTimeout` → `socket?.close()` の順に処理しており、"close"
    イベントハンドラ先頭の early return と合わせてロジックは正しい。
    subscribe() 呼び出しごとに独立したクロージャで持つため購読間の干渉も
    ない(テストでも検証済み)
  - `subscribePeers`(Beacon API 側): worklog の記載どおり setTimeout に
    よる周期ポーリングで、失敗時も catch でログを出して次のティックを
    予約する実装。永続接続を持たないため同種の問題はない。修正不要の
    判断は妥当
  - 境界の遵守: eth_subscribe / eth_subscription の語彙は
    adapters/ethereum/ 配下に閉じている。packages/shared・frontend への
    漏れなし。型変更なし
  - テストの質: 実装担当の基本テスト2件は回帰検出能力を確認済み
    (実装を意図的に戻してタイムアウト失敗を確認)。tester の5件も
    連続切断・バックオフ中の close・購読の独立性・subscription id 変化・
    エラー応答と、異常系・境界値を実質的にカバーしている
  - `pnpm build`: 成功。`pnpm test`: 全パッケージ成功(collector は
    27 ファイル 645 件で worklog の記載と一致)
  - docs との齟齬: なし。再接続は ChainAdapter 実装内部の詳細であり、
    docs/ARCHITECTURE.md の記述(subscribeBlocks が eth_subscribe(newHeads)
    を購読する)と矛盾しない
- コミット粒度について: 現時点で Issue #135 の変更はすべて未コミット。
  lint 修正後、少なくとも以下の単位に分けてコミットすること
  (1変更1コミットのルール):
  1. fix(collector): 再接続実装+実装担当の基本テスト
     (eth-ws-client.ts と test の基本2件)
  2. test(collector): tester のエッジケーステスト5件
  3. docs: worklog・WORKLOG.md 索引・PLAN.md チェックの更新
