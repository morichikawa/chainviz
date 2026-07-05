# Issue #80 作業記録

### 2026-07-05 Issue #80 に向けた shared 型設計の検討(reviewer)

- 担当: reviewer
- ブランチ: issue-79-logging-proxy
- 内容: ロギングプロキシの観測データ(`RpcObservation`)をworld-stateへ
  組み込むIssue #80で必要になる `packages/shared` の型設計を検討した。
  **この時点では設計方針の決定のみで、型の追加・変更は行っていない**
  (実際の変更は#80着手時にreviewerが両パッケージのビルドを確認しながら
  実施する)。
- 決定事項(設計方針):
  - **「集約された操作エッジ(永続)」+「呼び出し観測イベント(揮発)」の
    2段構え**とする。RPC呼び出しは一時的なリクエスト/レスポンスであり
    P2Pピア接続(`PeerEdge`)とは意味が異なるため、既存エッジの流用も、
    呼び出しごとのエッジadd/remove(TTL付き)も採らない
    1. `OperationEdge`(kind: "operation")を world-state に新設する。
       `fromWorkbenchId` / `toNodeId` と集約フィールド(`callCount`・
       `lastCalledAt`・`lastMethod` 等)を持つ恒久エッジ。初回呼び出しで
       edgeAdded、以降の呼び出しでは更新。スナップショットに含まれるため
       再接続クライアントにも「どのワークベンチがどのノードを操作して
       いるか」が復元される。時間経過で消すTTL方式にはしない(固定の
       時間定数への依存を避ける。CLAUDE.md運用ルール参照)
    2. `DiffEvent` に揮発性の単発イベント `operationObserved` を追加する
       (`fromWorkbenchId`・`toNodeId`・`method`・`category`・`timestamp`)。
       world-stateには蓄積せずスナップショットにも含めない。フロントは
       受信した瞬間に恒久エッジ上へパルスを1回走らせる。CONCEPT.mdの
       「エッジ+パルスで描画」は、1の恒久エッジの上を2のイベント起点の
       パルスが走る形で実現する
  - **エッジ型の一般化が必要**: `type WorldStateEdge = PeerEdge |
    OperationEdge` を導入し、`WorldStateSnapshot.edges` と `DiffEvent` の
    `edgeAdded.edge` をこのunionへ変更する。現行の `edgeRemoved` は
    PeerEdge専用フィールド(fromNodeId/toNodeId/networkId)を直接持つため、
    kindで判別できる形への再設計が必要(例:
    `{ type:"edgeRemoved"; kind:"peer"; ... } |
    { type:"edgeRemoved"; kind:"operation"; ... }`)。collectorの差分計算・
    frontendのエッジ描画の両方に影響するため、変更時は両パッケージの
    ビルド・テストを通して確認する
  - **境界の守り方**: `method`(例: eth_sendRawTransaction)は「表示用の
    未加工データ」としてstringのまま運ぶ(データとコードの分離。コードが
    分岐に使わなければスキーマへのチェーン固有語彙の漏れには当たらない)。
    フロントの描画ロジックが分岐に使う値は、ChainAdapter側で正規化した
    チェーン非依存の `category`(例: "read" | "write" | "other")とし、
    eth_* の判定はEthereumAdapter内に閉じる
  - 呼び出し元IP(`RpcObservation.callerIp`)→ワークベンチの解決は
    collector側で `InfraEntity.ip` と突き合わせて行う(#79の実機確認で
    remoteAddressがワークベンチのchainネットワーク上のIPになることを
    確認済み)。どのワークベンチにも一致しないIP(ホストからの直叩き等)の
    扱いは#80で決めるが、黙って捨てず最低限ログに残すこと

**注記**: 上記(2026-07-05 に向けた shared 型設計の検討)で提案していた「永続的な集約 OperationEdge(callCount 等の蓄積)+ 揮発イベント」の2段構え案は、実装着手時に単純化した(下記エントリ参照)。集約エッジは完了条件(呼び出し元・呼び出し先・種類が分かる)に対して過剰な先回り実装と判断し、揮発イベント(`operationObserved`)のみを採用している。`edgeAdded`/`edgeRemoved` の kind 判別可能な再設計も、この単純化により不要になった。

### 2026-07-05 Issue #80 操作エッジの共有型定義（reviewer）

- 担当: reviewer
- ブランチ: issue-80-operation-edges
- 内容:
  - `packages/shared/src/world-state/entities.ts` に `OperationEdge` と
    `WorldStateEdge = PeerEdge | OperationEdge` を追加した
  - `packages/shared/src/events/index.ts` の `DiffEvent` に
    `{ type: "operationObserved"; edge: OperationEdge }` を追加した
  - 対応するユニットテストを `entities.test.ts` に追加し、
    `events/index.test.ts` を新規作成した（判別ユニオンの絞り込みを
    コンパイル時 + 実行時に検証）
  - `docs/ARCHITECTURE.md` §2（ワールドステートのスキーマ・差分イベント）を
    更新した
  - `pnpm lint && pnpm build && pnpm test` を全パッケージで実行し通過を確認
    （shared 6 / collector 483 / frontend 353 / e2e 34）
- 決定事項（設計の理由）:
  - **`operationObserved` は揮発性イベント**。RPC 呼び出しは「観測された
    瞬間の出来事」であり、`PeerEdge` のような永続的な接続状態とは性質が
    異なる。そのため store の状態に畳み込まず、`WorldStateSnapshot` にも
    含めない（接続直後のスナップショットで過去の呼び出しを再現する意味が
    ない）。対応する削除イベントも設けない。フロントは受信時にエッジ＋
    パルスのアニメーションとして消費し、自身のタイミングで消す
    （CONCEPT.md「操作がエッジになる」）
  - **`edgeAdded` / `edgeRemoved` は再設計しない**。操作エッジは永続状態に
    ならないため追加/削除の対象にならず、既存の 2 イベントは `PeerEdge`
    専用のままでよい。kind 判別可能な形への再設計は不要と判断した
    （既存の collector/frontend の store 実装を壊さずに済む）
  - **`operation: string` は生の文字列**（JSON-RPC メソッド名など）を
    そのまま入れる。フィールド名・スキーマ自体はチェーン非依存の語彙で
    保ち、値がチェーン依存になるのは `NodeEntity.clientType`（"reth" 等）と
    同じ既存パターン。値の解釈・分類・表示はフロントのチェーンプロファイル
    表現セット（`packages/frontend/src/chain-profiles/<chainName>/`）の責務
  - **`params` / JSON-RPC `id` は含めない**。完了条件（呼び出し元
    workbench・呼び出し先 node・呼び出しの種類）に不要であり、チェーン
    依存の生ペイロードをワールドステートに持ち込まない。将来 D 層で必要に
    なった時点で追加を検討する（先回り実装をしない）
  - **一意 id フィールドは持たせない**。イベントであって状態ではないため
    同一性キーによる突き合わせが発生しない。フロントの描画用キーは
    ブロックパルスと同様にフロント側でローカル生成すればよい
- 次の担当（collector）への注意点:
  - ロギングプロキシの `RpcObservation`（`packages/collector/src/proxy/
    logging-proxy.ts`）からのマッピングは
    `method` → `operation`、`timestamp` → `observedAt`。
    `callerIp` → `fromWorkbenchId` の解決（IP からワークベンチエンティティの
    id を引く）と、プロキシの転送先ノードから `toNodeId` を決めるのは
    collector 側の配線の責務
  - 呼び出し元 IP がどのワークベンチにも解決できない観測をどう扱うか
    （読み捨てるか、ログに残すか）は配線実装時に決めて記録すること。
    黙って握りつぶさない（CLAUDE.md「品質ゲート」参照）
  - collector の `WorldStateStore.applyEvent` は `operationObserved` を
    状態に畳み込んではならない（passthrough で配信のみ）。frontend の
    `applyDiff` は現状 default 節で未知イベントを無視するため型追加だけ
    では挙動が変わらない。パルス描画側で消費する実装が別途必要

### 2026-07-05 Issue #80 shared 型定義のレビュー（reviewer）

- 担当: reviewer
- ブランチ: issue-80-operation-edges
- 内容: 統括による後処理（コミット分割・main マージ・worklog 統合）後の
  ブランチ状態を再レビューした。結果は合格
- 確認結果:
  - コミット粒度: `git log main..HEAD` は4コミット
    （feat(shared) 型+テスト / docs ARCHITECTURE.md / chore main マージ /
    docs worklog）。型とテストが同一コミットなのは CLAUDE.md
    「ロジック変更と同じ変更の中でテストを書く」に沿っており適切。
    各コミットの関心事の混在なし
  - worklog の橋渡し注記: 「2段構え案を実装着手時に単純化した」
    「edgeAdded/edgeRemoved の kind 判別化はこの単純化により不要になった」
    という記述は、下段エントリの設計理由（RPC 呼び出しは揮発性の出来事で
    あり永続状態にならない・スナップショット再現の意味がない・完了条件に
    対する先回り実装をしない）と一致しており、事実誤認・捏造なし
  - main マージ: merge-base が main の HEAD と一致し、
    `git diff main HEAD` の差分は本ブランチ由来の6ファイルのみ。
    コンフリクトマーカーの残留なし。`docs/WORKLOG.md` は索引のみの
    分割後構成になっており、#80 の索引行も存在する
  - `pnpm lint && pnpm build && pnpm test` 全パッケージ通過
    （shared 6 / collector 483 / frontend 353 / e2e 34）
- 軽微な指摘（差し戻し不要）:
  - `docs/WORKLOG.md` の #80 索引行の説明が「型設計の検討」のままで、
    型定義の実施まで進んだ現状よりやや古い（本レビューで更新済み）
  - `WorldStateEdge` union は現時点でテスト以外に利用箇所がないが、
    #80 本体のフロント描画で両 kind を扱う際の受け皿として
    ARCHITECTURE.md に記載済みのため許容する

### 2026-07-05 Issue #80 collector 側の観測→操作エッジ配信の配線（collector）

- 担当: collector
- ブランチ: issue-80-operation-edges
- 内容: ロギングプロキシが観測した RPC 呼び出し（`RpcObservation`）を
  `OperationEdge` へマッピングし、`operationObserved` イベントとして
  WebSocket で全クライアントへ配信する配線を実装した。
  - 新規 `packages/collector/src/proxy/operation-observer.ts`:
    - `parseProxyTargetHost(target)`: 転送先 URL（`CHAINVIZ_PROXY_TARGET`）
      から host 部を取り出す。`toNodeId` の解決に使う。
    - `resolveOperationEdge(observation, targetHost, resolver)`: 純粋関数。
      `method` → `operation`、`timestamp` → `observedAt`、`callerIp` →
      `fromWorkbenchId`（resolver でワークベンチ id を引く）、`targetHost`
      → `toNodeId`（resolver でノード id を引く）。どちらかの端点が引けなけ
      れば `ok:false`（`workbench-unresolved` / `node-unresolved`）を返す。
    - `createOperationObserver(deps)`: `RpcObserver` を生成する。解決できた
      観測だけ `broadcast([{ type:"operationObserved", edge }])` で配信し、
      解決に失敗した観測はどちらの端点が引けなかったかをログに残す（黙って
      握りつぶさない）。
  - `packages/collector/src/world-state/store.ts`:
    - 解決口として `findWorkbenchByIp(ip)` / `findNodeByIp(ip)` を追加。
      `WorldStateStore` が `OperationEndpointResolver` を満たす。
    - `applyEvent` に `case "operationObserved": break;`（明示的な no-op）を
      追加。揮発性イベントを store の状態へ畳み込まないことをコードとして
      明示した（passthrough は `broadcastDiff` 経由で行う）。
  - `packages/collector/src/index.ts` の `main()`: 転送先 host を
    `parseProxyTargetHost` で取り出し、`createOperationObserver` を
    `startLoggingProxy` の `onObserve` に渡して配線。host を取り出せない
    場合は操作エッジを配信しない旨を警告ログに残す。
- 決定事項（設計の理由）:
  - **端点の解決は観測ごとに store の現在状態へ問い合わせる**。プロキシ
    起動時点では対象ノード/ワークベンチのエンティティがまだ存在しない
    可能性があり、後から addNode/addWorkbench で増える。固定の解決結果を
    埋め込まず毎回引くことで追従する（CLAUDE.md「観測できる状態に依存した
    固定値を埋め込まない」）。
  - **解決失敗は配信せずログに残す**。呼び出し元 IP がどのワークベンチにも
    一致しない（ホストからの直叩き等）／転送先 host がどのノードにも一致
    しない観測は、どちらが引けなかったかを含めて `console.warn` する。
    完了条件（呼び出し元・呼び出し先・種類）を満たせない観測を無言で
    捨てないため。
  - **転送先の host 解決は IP マッチ**。既定の `CHAINVIZ_PROXY_TARGET` は
    Docker bridge 上の IP を指す。host 名を指定した場合はノード
    エンティティの `ip` に一致せずノード解決に失敗しログが残る（この
    制約は ARCHITECTURE.md にも記載）。
  - **`operationObserved` は store を素通しし `broadcastDiff` で直接配信**。
    observer は store の resolver 機能だけを使い、イベント自体は
    `server.broadcastDiff` へ直接渡す。store の状態には一切入らない。
- テスト:
  - `proxy/operation-observer.test.ts`（新規, 10 件）: `parseProxyTargetHost`
    の host 抽出、`resolveOperationEdge` の正常系マッピング・
    workbench-unresolved・node-unresolved、`createOperationObserver` の
    正常系配信・IP 解決失敗時のログ出力（broadcast されないこと）・
    後から追加されたワークベンチへの追従を検証。
  - `world-state/store.test.ts`: `findWorkbenchByIp` / `findNodeByIp` の
    解決・未解決・ノード IP をワークベンチとして誤解決しないことを追加。
- フロントへの影響確認: `frontend/src/world-state/store.ts` の `applyDiff`
  は未知イベントを `default` 節で無視するため、`operationObserved` の型
  追加だけでは挙動が変わらない（描画側の消費は Issue #83 で対応）。
  `pnpm build`（全パッケージ）・`pnpm test`（collector 498 / frontend 353）・
  `pnpm lint` の通過を確認済み。

### 2026-07-05 Issue #80 collector 配線のレビュー（reviewer）

- 担当: reviewer
- ブランチ: issue-80-operation-edges（未コミットの作業ツリーを検分）
- 内容: collector 担当が実装した「観測 → OperationEdge 解決 →
  operationObserved 配信」の配線を静的レビューした。結果は**合格**
  （軽微な指摘1件あり。下記）
- 確認結果:
  - 境界の遵守: `operation-observer.ts` は method を文字列のまま運ぶだけで
    eth_* による分岐なし。frontend への変更なし（`applyDiff` の default 節が
    未知イベントとして無視することを確認）。チェーン固有語彙のスキーマ/
    フロントへの漏れなし
  - エラーの握りつぶし: 解決失敗（workbench-unresolved / node-unresolved）は
    どちらの端点が引けなかったかを含めて warn ログに残す。`main()` で
    転送先 URL からホストを取り出せない場合も警告を出して観測配信のみ
    無効化する。`parseProxyTargetHost` の catch → undefined は呼び出し側で
    警告されるため握りつぶしに当たらない
  - 現在状態への依存: 端点解決は観測ごとに store の現在状態へ問い合わせる
    設計で、後から追加されたワークベンチにも追従する（追従テストあり）。
    固定タイムアウト等の決め打ち定数なし
  - operationObserved の非畳み込み: observer は `server.broadcastDiff` へ
    直接渡し store を経由しない。`broadcastDiff` は WebSocket 配信のみで
    store に触れないことを確認。`applyEvent` の `case "operationObserved":
    break;` は防御的な明示 no-op（本番経路で applyEvent に届くことはない）。
    スナップショットに混入する経路なし
  - テストの実効性: 変異テストで確認した。(1) 解決失敗時のログ呼び出しを
    削除 → 失敗系テスト2件が検出。(2) 失敗時の早期 return を削除（失敗でも
    配信）→ 3件が検出。いずれも有意味なテストであることを確認し、変異は
    ハッシュ照合のうえ完全に復元した
  - `pnpm lint && pnpm build && pnpm test` 全パッケージ通過
    （shared 6 / collector 498 / frontend 353 / e2e 34）
  - docs: ARCHITECTURE.md の追記・PLAN.md のチェック・WORKLOG.md 索引の
    更新はいずれも実装と整合
- 軽微な指摘（コミット前に対応すること）:
  - `packages/collector/src/index.ts` の `startLoggingProxy` の docstring
    （「現時点では観測データはログに残すだけで、world-state への組み込みは
    別 Issue（#80）で対応する」）が古いまま。この変更自体が #80 の組み込み
    実装なので、コメントを現状（onObserve に operation-observer を配線して
    operationObserved を配信する）に合わせて更新する
- コミット分割は未実施。「collector 配線実装+テスト」「docs 更新」の
  2コミット案は関心事の分離として妥当

### 2026-07-05 Issue #80 実機検証（qa）

- 担当: qa
- ブランチ: issue-80-operation-edges
- 内容: `docs/PLAN.md` の Issue #80 完了条件「workbench からの RPC 呼び出しが、
  フロントで受信する WebSocket 差分イベントとして観測できる（呼び出し元
  workbench・呼び出し先 node・呼び出しの種類が分かる形）」を、実際に Docker
  環境と collector を起動して検証した。結果は**合格**。
- 検証手順と結果:
  1. `profiles/ethereum` を `docker compose up -d` で起動。初回は既存の
     genesis ボリュームが残っており beacon が weak subjectivity で起動失敗した
     ため、`docker compose down -v` でボリュームを破棄してから作り直したところ
     チェーンが進行した（この失敗は Issue #56 で既知の genesis 再利用の問題で
     あり Issue #80 とは無関係）。block が 5〜35 と進行することを RPC で確認。
  2. collector（`node packages/collector/dist/index.js`）を起動。
     `WebSocket server listening on port 4000` /
     `logging proxy listening on port 4001 -> http://172.28.1.1:8545` を確認。
     ワークベンチの `ETH_RPC_URL` は `http://host.docker.internal:4001`（#78 で
     ロギングプロキシ経由に変更済み）であることを実物で確認。
  3. WebSocket クライアント（`ws://localhost:4000`）を接続し、接続時
     スナップショットに operation 系が一切含まれないこと
     （`"kind":"operation"` / `operationObserved` を含まない）を確認。
     スナップショット上のワークベンチ id は `chainviz-ethereum/workbench`
     （ip 172.28.0.2）、reth1 は `chainviz-ethereum/reth1`（ip 172.28.1.1）。
  4. ワークベンチから `cast chain-id` / `cast block-number` /
     `cast balance` / `cast send --value 1ether ...` を実行。いずれもプロキシ
     経由で正常応答（chain-id 1337、tx が block 127 に取り込まれた）。
  5. その間 WebSocket に `operationObserved` イベントが配信されることを確認。
     読み取り系 3 件（eth_chainId / eth_blockNumber / eth_getBalance）に加え、
     `cast send` では eth_getTransactionCount・eth_feeHistory・eth_estimateGas・
     **eth_sendRawTransaction**・eth_getTransactionReceipt 等の一連の RPC が
     すべて operationObserved として流れた。
  6. 各イベントの `edge`（OperationEdge）を確認。
     `fromWorkbenchId="chainviz-ethereum/workbench"`（呼び出し元 IP 172.28.0.2
     から正しく解決）、`toNodeId="chainviz-ethereum/reth1"`（プロキシ転送先
     172.28.1.1 から正しく解決）、`operation` は呼び出した JSON-RPC メソッド名
     そのまま、`observedAt` は epoch ms が入っていることを確認。
  7. 揮発性の確認: 一連の cast 呼び出しの後に新規 WebSocket 接続を張り、その
     接続時スナップショットの `edges` が peer エッジ 1 件のみで operation 系を
     一切含まないことを確認。store に畳み込まれていない（passthrough 配信のみ）
     ことを実機で確認した。
- lint/build/test: `pnpm lint && pnpm build && pnpm test` を全パッケージで実行し
  通過（shared 6 / collector 498（うち operation-observer.test.ts 10）/
  frontend 353 / e2e 34）。
- 判定: 完了条件を満たしている。差し戻しなし。
- 後片付け: 検証後に `docker compose down -v` でスタックを破棄し collector を
  停止した。
