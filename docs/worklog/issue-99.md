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

### 2026-07-06 Issue #99 再レビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-99-wsl2-listen-host
- 内容: 前回の差し戻し2件への対応(コミット 8f41cb2 / 4049f28)を再レビューし、
  **合格**とした。
- 確認したこと:
  - 【要修正】worklog の `</content>` `</invoke>` 混入2行が 8f41cb2 で削除
    されている。ファイル全体を再確認し、残骸は残っていない(レビュー記録内の
    引用としての言及のみ)。
  - 【推奨】`docs/ARCHITECTURE.md` の Issue #99 確定事項の節に、`0.0.0.0`
    bind のセキュリティ上の含意(ローカル開発用ツールであること、修正前も
    `::` で全インターフェース待ち受けだったため露出は増えず、IPv4 限定に
    なる分むしろ狭まること)が 4049f28 で追記されている。内容は前回指摘の
    趣旨と一致し、実装とも整合。
  - lint / build / test をレビュー側でも全パッケージで再実行し、すべて通過
    (collector 500 テスト・frontend 411 テスト)。
  - コミット粒度: 対応2件がそれぞれ独立した docs コミットに分かれており適切。
- 結論: 指摘事項はすべて解消。実装・テスト・docs の整合に問題なし。
  次工程(chainviz-qa の実機検証)へ進んでよい。

### 2026-07-06 Issue #99 実機検証(qa)

- 担当: qa
- ブランチ: issue-99-wsl2-listen-host
- 結論: 合格。docs/PLAN.md に Issue #99 に対応するチェックボックスは無く
  (WSL2 環境向けのバグ修正であり計画ステップ外)、チェック対象は無い。
- 実施内容と結果:
  - 全パッケージで `pnpm lint` / `pnpm build` / `pnpm test` を実行し、すべて
    通過(shared 6・e2e 34・collector 500・frontend 411、lint/build エラー無し)。
  - ビルド済み dist の `CollectorServer` と `LoggingProxy` を実際に 4000 / 4001
    で起動し、`ss -tlnp` と `lsof -nP -iTCP -sTCP:LISTEN` の両方で bind アドレス
    ファミリを確認した。
    - 4000(WebSocket): `0.0.0.0:4000` / lsof で `IPv4`。
    - 4001(ロギングプロキシ): `0.0.0.0:4001` / lsof で `IPv4`。
    - いずれも修正前の IPv6(`::`) ではなく IPv4(`0.0.0.0`) で待ち受けている
      ことを実測で確認。
  - `ws://127.0.0.1:4000`(IPv4 loopback)へ接続し、接続直後に `type: "snapshot"`
    のメッセージを受信できることを確認。payload は
    `chainType` / `timestamp` / `entities` / `edges` の想定スキーマ(ARCHITECTURE
    §3)どおり。修正による既存 WS 疎通・スナップショット配信の破壊は無い。
  - ロギングプロキシ(4001)へ JSON-RPC(`eth_chainId`)を POST し、以下の2経路
    いずれも HTTP 200 で透過転送されることを確認:
    - `127.0.0.1:4001`(loopback)。
    - Docker bridge ゲートウェイ `172.17.0.1:4001`(ワークベンチコンテナが
      `host.docker.internal:4001` で解決する宛先と同一インターフェース)。
    - どちらの呼び出しも `[proxy] rpc call from <ip>: eth_chainId []` として
      観測ログに記録され、観測機能も維持されていることを確認した。
  - `0.0.0.0` bind によりプロキシは loopback だけでなく Docker bridge
    インターフェース上でも到達可能であり、コンテナ→プロキシのネットワーク
    ホップが壊れていないことをホスト側から実証した。ワークベンチコンテナから
    reth ノードまで通す `cast` の完全な E2E は稼働ノードを要するため範囲外
    (本修正の目的である bind アドレスファミリと既存経路への影響確認は充足)。
  - 補足: WSL2 + VS Code Remote 環境でのブラウザ側の実接続確認はユーザー環境
    での作業であり本検証の範囲外(依頼どおり)。本マシン内での IPv4 bind の
    実測と既存機能への無影響の確認をもって合格とする。
