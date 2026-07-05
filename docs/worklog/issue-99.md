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
</content>
</invoke>
