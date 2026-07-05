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

