### 2026-07-07 Issue #143 eth_subscribeのエラー応答を検知できない不具合の修正
- 担当: collector
- ブランチ: issue-143-eth-subscribe-error
- 内容:
  - `packages/collector/src/adapters/ethereum/eth-ws-client.ts` の `subscribe()`
    が、ノードが `eth_subscribe` リクエスト自体を JSON-RPC エラー
    （例: 未対応メソッドで `-32601`）で拒否した場合に、そのエラー応答を
    静かに無視してしまう不具合を修正した。従来は `eth_subscription` 通知の
    形（`method: "eth_subscription"`）だけを解釈する `parseSubscriptionResult`
    しかなく、エラー応答は `method` を持たないため誰にも検知されなかった。
  - `JsonRpcMessage` 型に `error?: { code: number; message: string }` を追加し、
    新たに `parseSubscribeError(raw)` 関数を実装。WebSocket の `message`
    イベントハンドラで、通知の解釈より先に `parseSubscribeError` を試し、
    エラー応答であれば `onError` を `Error` オブジェクト（コードとメッセージを
    含む）で呼ぶようにした。
  - 応答の `id` が `eth_subscribe` リクエストの `id`（固定値 `1`）と一致するかは
    確認していない。この接続では `eth_subscribe` 以外のリクエストを送らない
    ため、届いた応答に `error` フィールドがあればそれは常に `eth_subscribe`
    由来のエラーとみなしてよく、Issue本文の指示どおり単純な判定に留めた
    （再接続で `eth_subscribe` を複数回送る場合でも同様の理由で問題ない）。
  - Issue #135 で追加された自動再接続ロジック（`socket.on("close")` での
    `RECONNECT_DELAY_MS` 待ち→再接続→再購読）と同じ `connect()` 関数内の
    `message` ハンドラに実装したため、再接続後に送り直した `eth_subscribe`
    がエラーで拒否された場合も同様に検知できる。
- テスト:
  - `parseSubscribeError` 単体のテスト（エラー応答からのエラー抽出、正常
    応答・通知・不正JSONでは `undefined` を返すこと）を追加。
  - 既存の「エラー応答は無視される（現状の挙動を記録するテスト）」を、
    実際に `onError` が呼ばれることを確認するテストに置き換えた。
  - エラー検知が正常な `eth_subscription` 通知の処理に影響しないことを
    確認するテストを追加。
  - 一度切断→再接続した後の `eth_subscribe` 再送がエラーで拒否された場合も
    `onError` が呼ばれることを確認するテストを追加。
  - 修正前のコードに対してこれらの新規テストを実行し、実際に失敗する
    （回帰を検出できる）ことを確認した上で、修正後のコードに戻して
    全テストが通ることを確認した。
- 決定事項・注意点:
  - `onError` が呼ばれても、この関数はソケットを明示的に閉じたり再接続を
    強制したりしない（ノードからの応答であり、TCP接続自体は生きているため）。
    呼び出し側（`packages/collector/src/adapters/ethereum/index.ts`）は
    既存の `onError` コールバックで `console.error` するのみで、この挙動は
    変更していない。今後、購読エラー時に接続を切って再接続を試みるべきか
    どうかは別途の設計判断が必要（本Issueのスコープ外）。
  - `pnpm build` / `pnpm test`（collector パッケージ）、リポジトリ全体の
    `pnpm lint` を実行し、いずれも成功することを確認済み。

### 2026-07-07 Issue #143 テスト強化（異常系・境界値）
- 担当: tester
- 対象: `packages/collector/src/adapters/ethereum/eth-ws-client.test.ts`
- 追加したテスト観点:
  - `parseSubscribeError` の境界値（純粋関数）:
    - `error` が空オブジェクト `{}` のとき、そのまま `{}` を返す（undefined
      ではなく「エラー応答」と判定される）ことを記録。
    - `error` に `message` が欠けている / `code` が欠けている応答でも、
      error オブジェクトをそのまま返すこと。
    - `result` と `error` を同時に含む不正な応答で、error の抽出を優先すること。
    - `method: eth_subscription` と `error` を同時に含む不正なフレームでも、
      error を抽出すること。
  - 統合（`createWsEthClient` の message ハンドラ経由）:
    - `error` の中身が空（code/message 欠落）でも onError が必ず呼ばれ、
      購読失敗が静かに無視されないこと。通知（onResult）は呼ばれないこと。
    - 通知の形と error を同時に持つ不正フレームで、error 検知が通知解釈より
      先に働き onError が呼ばれ onResult は呼ばれないこと（防御的優先順位）。
    - 同一クライアントで newHeads と newPendingTransactions を購読していて、
      片方が eth_subscribe をエラー拒否されても、もう片方は通知を届けられる
      こと（購読間の分離）。
    - 同じ接続で連続してエラー応答が届いた場合、そのたびに onError が呼ばれる
      こと（最初の1回だけ処理して以降を握りつぶさない）。
    - エラー応答の後にノード都合で切断されても、購読が死んでおらず再接続・
      再購読が働くこと（エラー検知が Issue #135 の再接続ロジックを壊さない）。
  - collector パッケージで `pnpm build` / `pnpm test` を実行し、
    661 passed / 1 skipped で成功することを確認（下記の既知不具合の回帰
    テストを `it.skip` で1件追加したため skipped が1件）。
- 発見した不具合（collector 担当へ差し戻し・実装は未修正）:
  - ノードが success 応答に `error: null` を含めて返す（JSON-RPC 2.0 仕様上は
    result と error は排他だが、`error: null` を常に含める実装が実在する）と、
    `parseSubscribeError` が `null` を返し、`subscribe()` の message ハンドラの
    `subscribeError !== undefined` 判定を通過してしまう。続く
    `subscribeError.message` で `TypeError: Cannot read properties of null
    (reading 'message')` が発生し、この例外は onError にも渡されず
    uncaughtException として collector プロセスを落とす。
    - 再現手順: FakeNodeServer で eth_subscribe に対し
      `{ jsonrpc: "2.0", id, result: "0x1", error: null }` を送ると、
      process の uncaughtException で上記 TypeError を観測（実測で確認済み）。
    - 修正方針の案: `parseSubscribeError` で `error` が null / 非オブジェクト
      のときは「エラー応答ではない」とみなして `undefined` を返す、あるいは
      message ハンドラ側で error がオブジェクトであることを確認してから
      onError に渡す。修正後に、テスト中の
      `it.skip("treats error:null as a non-error reply and does not crash")`
      を有効化して回帰検出に使う想定（現状は skip）。

### 2026-07-07 統括によるバグ修正対応

- testerが発見した「`error: null`でcollectorがクラッシュする」不具合を修正した。
  `parseSubscribeError`で`message.error`が`typeof !== "object"`または`null`の
  場合は「エラーなし」として`undefined`を返すよう変更。
- 修正前の状態(if文を一時的に除去)で実際にuncaughtException(TypeError)が
  発生することを確認してから、修正を元に戻した。
- `it.skip`だった回帰テスト「treats error:null as a non-error reply and does
  not crash」を有効化。collector 662件・frontend 787件全通過を確認。
- コミットを3つに分割: `feat(collector)`実装、`test(collector)`テスト強化、
  `docs`worklog。

### 2026-07-07 Issue #143 静的レビュー(合格)
- 担当: reviewer
- 確認内容:
  - `parseSubscribeError` の判定を確認。`typeof message.error !== "object" ||
    message.error === null` により、正当なエラーオブジェクト(`{code, message}`、
    code/message の一方が欠けた不完全なオブジェクト、空オブジェクト `{}` も
    含む)は引き続き「エラー応答」として検知され、`error: null` や error
    フィールド自体が無い応答だけが「エラーなし」として除外されることを
    テスト(境界値9件 + 統合8件)と実装の両面で確認した。
  - Issue #135 の再接続ロジックとの相互作用: エラー検知は `connect()` 内の
    同じ message ハンドラに実装されており、再接続後の `eth_subscribe` 再送が
    拒否された場合も検知できる。「エラー応答後にノード都合で切断されても
    再接続・再購読が働く」テストも存在し、再接続ロジックを壊していない。
  - `packages/shared` の変更が無いことを差分(変更ファイルは collector 2件・
    docs 3件のみ)で確認した。
  - エラーの握りつぶし: 呼び出し側(`adapters/ethereum/index.ts`)は onError で
    対象ノードの stableId とエラー内容を具体的に `console.error` しており、
    汎用メッセージへのすり替えは無い。onError へ渡す Error にはエラーコードと
    メッセージが含まれる。`error: null` を「エラーなし」扱いにするのは
    JSON-RPC 2.0 のセマンティクス(success 応答)どおりで握りつぶしではない。
  - `pnpm lint` / `pnpm build` / `pnpm test` をリポジトリ全体で実行し、
    collector 662件・frontend 787件を含め全て成功(skip 無し。tester が
    `it.skip` にしていた回帰テストが有効化済みであることも確認)。
  - コミット粒度: feat(実装のみ)・test(テストのみ)・docs 2件の計4コミットで、
    いずれも単一の関心事に収まっている。
- 補足(合否に影響しない注意点):
  - 中間コミット `49d6cbe`(feat)単体の時点では、旧テスト「エラー応答は無視
    される(現状の挙動を記録)」がまだ残っているためテストが通らない。HEAD では
    全通過しており pre-push フックも HEAD で走るため実害は無いが、bisect の
    観点では feat と test を1コミットにするか順序を工夫する余地がある。
  - `error` が文字列や数値など「null 以外の非オブジェクト」である不正応答は
    「エラーなし」として静かに読み飛ばされる。JSON-RPC 2.0 仕様上 error は
    オブジェクトであり実在の実装で問題になる可能性は低いが、意図はコード
    コメントに明記済み。
  - レビュー中に origin/main が先へ進んでいる(Issue #129 の PR #147 マージ)。
    `eth-ws-client.*` は触れられていないが、`docs/PLAN.md` / `docs/WORKLOG.md`
    は双方で編集されているため、マージ時にこの2ファイルで衝突する可能性が
    高い。統括はマージ前に rebase 等での解消を想定しておくこと。
