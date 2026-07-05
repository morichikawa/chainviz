### 2026-07-06 Issue #99 WSL2環境でcollectorのWebSocket/ロギングプロキシがVS Codeのポート転送経由で繋がらない
- 担当: collector
- ブランチ: issue-99-wsl2-listen-host
- 内容:
  - `packages/collector/src/server/websocket-server.ts` の `listen()` を
    `new WebSocketServer({ port })` から `new WebSocketServer({ port, host: "0.0.0.0" })` に変更。
  - `packages/collector/src/proxy/logging-proxy.ts` の `listen()` を
    `server.listen(port)` から `server.listen(port, "0.0.0.0")` に変更。
  - 両ファイルに、なぜ `0.0.0.0` を明示指定するのかの前提条件をコメントで明記。
  - `docs/ARCHITECTURE.md` のロギングプロキシ実装形態の節に確定事項（Issue #99）として追記。
  - 各ファイルにユニットテストを追加（下記）。
- 根本原因（究明徹の実測で確定）:
  - host を省くと ws / Node は IPv6 の `::` に bind する。WSL2 + VS Code Remote
    環境の localhost 転送は、WSL 側 listener のアドレスファミリをそのまま
    Windows 側リレーへ写す。IPv6 bind だと Windows 側には `[::1]` 宛リレーしか
    立たず、ブラウザが `ws://127.0.0.1:4000`（IPv4）へ接続すると確定的に拒否される。
  - vite（5173）は `127.0.0.1`（IPv4）を明示 bind しているため繋がっていた。
    対比により collector 側だけ IPv6 bind だったことが原因と特定された。
- 決定事項・注意点:
  - WebSocket サーバー（4000）は `127.0.0.1` でも WSL2 の問題は解決するが、
    ロギングプロキシ（4001）は `127.0.0.1`（loopback 限定）にしてはならない。
    ワークベンチコンテナが Docker bridge の IPv4 ゲートウェイ経由で
    `host.docker.internal:4001` を叩くため、loopback 限定にするとコンテナからの
    転送リクエストが届かなくなる。全 IPv4 アドレスで待ち受ける `0.0.0.0` が必要。
    統一のため WebSocket サーバーも `0.0.0.0` にした。
  - この固定値（`0.0.0.0`）が成立する前提（WSL2 の NAT 転送がアドレスファミリを
    そのまま写す）は、CLAUDE.md の運用ルールに従いコード上のコメントと本 WORKLOG の
    両方に明記した。
- 検証:
  - この環境（WSL2）で `lsof -nP -iTCP:<port> -sTCP:LISTEN` を用い、host 省略時は
    `IPv6`（`::`）に、`0.0.0.0` 指定時は `IPv4`（`0.0.0.0`）に bind されることを
    WebSocket サーバー・HTTP サーバーの両方で実測確認した。
  - 追加したテストは、修正前（host 省略）の状態では実際に
    `expected 'IPv6' to be 'IPv4'` で失敗することを確認済み（回帰検出できることを
    確認してから修正後の状態に戻した）。
  - テストは `WebSocketServer.address()` / `http.Server.address()` の返す
    `family`・`address` を検証する形にし、既存テストの実ソケット + `internalWss`
    ヘルパーの作りを踏襲している（新しいモック機構は導入していない）。

### 2026-07-06 Issue #99 レビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-99-wsl2-listen-host
- 内容: コミット3件(a9e2c90 / 3530ae7 / 477652d)を静的レビューした。
  結果は**条件付き差し戻し**(要修正1件・推奨1件。実装本体は合格水準)。
- 確認したこと:
  - lint / build / test をレビュー側でも全パッケージで実行し、すべて通過
    (frontend 411 テスト含む)。
  - 回帰テストの実効性: レビュー側でも `host: "0.0.0.0"` 指定を一時的に
    元(host 省略)に戻し、追加された2テストがどちらも
    `expected 'IPv6' to be 'IPv4'` で実際に失敗することを確認してから
    復元した(CLAUDE.md の回帰テストルールに適合)。
  - 対応漏れなし: collector 内の listen 箇所は `websocket-server.ts` と
    `logging-proxy.ts` の2箇所のみで、`index.ts` は両クラス経由
    (grep で確認)。
  - 固定値ルール: `0.0.0.0` の前提条件(WSL2 の localhost 転送が listener の
    アドレスファミリをそのまま Windows 側リレーに写す)がコード上のコメントと
    本 worklog の両方に同じ内容で明記されている。
  - `docs/ARCHITECTURE.md` の追記(Issue #99 確定事項)は実装と整合。
    プロキシを `127.0.0.1` にできない理由(ワークベンチコンテナが Docker
    bridge の IPv4 ゲートウェイ経由で叩く)もコード・docs で一致。
  - コミット粒度: 3コミット(websocket-server / logging-proxy / docs)は
    適切。fix と対応テストが同一コミットなのも「1つの変更内容=1コミット」に
    適合。
  - 安全性: 修正前の host 省略時は IPv6 `::` へのデュアルスタック bind で、
    もともと全インターフェース待ち受けだった。`0.0.0.0` への変更で露出は
    増えない(IPv6 分はむしろ狭まる)ため、既存動作(フロントの WS 接続・
    ワークベンチのプロキシ経由 RPC)を壊す方向の変化はない。
- 指摘事項:
  - 【要修正】`docs/worklog/issue-99.md` の担当記録の末尾に、ツール呼び出しの
    残骸とみられる `</content>` `</invoke>` の2行が混入したままコミットされて
    いる(477652d)。削除すること。
  - 【推奨】`0.0.0.0` は全インターフェースからの接続を受け付けるが、その
    セキュリティ上の含意への言及がコード・docs のどちらにもない。「開発用
    ツールであり、修正前の暗黙の `::` bind 時点で既に全インターフェース
    待ち受けだったため露出は増えていない(IPv4 限定になる分むしろ狭まる)」
    旨を、logging-proxy.ts のコメントか ARCHITECTURE.md の該当節に一文
    追記するのが望ましい。上記の要修正対応と同時に行うこと。
