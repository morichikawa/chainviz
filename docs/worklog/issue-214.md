# Issue #214 ブートノードとvalidator(2-1/1-1)がP2P接続確立中の表示のまま変化しない

### 2026-07-10 Issue #214 原因調査（調査記録）

- 担当: detective（原因究明）
- ブランチ: issue-214-p2p-connecting-stuck
- 内容: 「P2P接続を確立中...」表示が validator1-1 / validator2-1 とブート
  ノードのあいだで固着する症状の原因調査（コード修正なし）

#### 再現した症状

稼働中の chainviz-ethereum スタック（7コンテナ、約1.6時間稼働）と
collector（:4000）に対して確認した。

- collector の WebSocket スナップショットを直接観測すると、
  `chainviz-ethereum/validator1` と `chainviz-ethereum/validator2` が
  `kind: "node"`, `clientType: "lighthouse"`, `p2pRole: "peer"` の
  NodeEntity として存在する
- PeerEdge は `beacon1↔beacon2`（consensus）と `reth1↔reth2`（execution）
  の2本のみ。validator を端点とするエッジは存在しない
- frontend の実コード（`connectingEdge.ts` の `connectingEdgesToFlowEdges`、
  `connectionTargets.ts` の `resolveBootNodes`、`clientCategory.ts`。
  ロジック無改変）をこのライブスナップショットへ適用すると、
  `validator1 → beacon1`・`validator2 → beacon1` の2本の
  「接続確立中」エッジ（ラベル「P2P接続を確立中...」）が導出された。
  数分空けて再実行しても同じ2本が導出され続ける（固着の再現）。
  報告どおり「ブートノード（beacon1）と validator2-1 / validator1-1」の
  組み合わせと一致する
- 注: この環境にはヘッドレスブラウザ用の共有ライブラリ（libnss3 等）が
  無く Playwright の chromium を起動できなかったため、ブラウザの
  スクリーンショットではなく「frontend が実際に使う導出ロジック +
  ライブのワールドステート」での決定的な再現とした

#### 検証した仮説と実測結果

1. 「実際に P2P 接続が確立していない」説 → **棄却**。
   beacon1 の Beacon API（`GET /eth/v1/node/peers`）で beacon2
   （172.28.2.2）が `state: "connected"`。EL 側も `reth1↔reth2` の
   PeerEdge が配信されており、実 P2P はどちらの層も確立済み
2. 「validator コンテナが不調」説 → **棄却**。
   `docker logs` で validator1/validator2 とも attestation の発行・
   ブロック提案（`Successfully published block`）を継続しており完全に健全。
   チェーン自体も進行中（slot 2900 台）
3. 「collector の配信漏れ（確立済みなのに反映されない）」説 → **棄却**。
   collector は設計上 validator コンテナをピア取得対象から除外している
   （`targets.ts` の `beaconTargets` が compose サービス名に "beacon" を
   含むものだけを対象にする。VC は Beacon API を持たないため）。
   つまり「反映漏れ」ではなく「そもそも観測対象外」であり、collector の
   動作は設計どおり
4. 「frontend の導出ロジックと実体のミスマッチ」説 → **採用（根本原因）**。
   下記のとおり

#### 根本原因（設計上のミスマッチ）

validator1/validator2 は `lighthouse vc`（validator client）であり、
libp2p の P2P ネットワークに参加しないコンポーネント（beacon へ HTTP の
Beacon API で接続する）。それにもかかわらず:

- collector（`packages/collector/src/adapters/ethereum/classify.ts`）は
  イメージ名 `sigp/lighthouse` から `clientType: "lighthouse"` を与え、
  `index.ts`（`p2pRole: obs.labels[P2P_ROLE_LABEL] === "bootnode" ?
  "bootnode" : "peer"`）で VC にも `p2pRole: "peer"` を与える
- frontend（`packages/frontend/src/entities/clientCategory.ts`）は
  `clientType` に "lighthouse" を含むだけで `consensus` 層のノードと
  判定し、`connectingEdge.ts` が「実 PeerEdge を1本も持たない consensus
  ノード」から consensus ブートノード（beacon1）へ「P2P接続を確立中...」
  エッジを描く
- しかし collector は VC のピア情報を決して観測しない（できない）ため、
  VC を端点とする PeerEdge は永久に生まれず、接続確立中エッジは
  永久に解消されない

つまり「実際に未接続」でも「表示の更新漏れ」でもなく、**P2P に参加しない
validator client を P2P 参加ノードと同一視して『接続確立中』の対象に
含めてしまっている、collector のエンティティ属性と frontend の導出
ロジックの設計上のミスマッチ**が根本原因。

#### 対応方針の見立て（実装は別担当）

前提として、ワールドステートには VC と beacon を区別する情報が現状無い
（どちらも `clientType: "lighthouse"`、`p2pRole` は "bootnode"/"peer" の
2値のみ。`NodeEntity` に役割区分のフィールドが無い）。そのため frontend
だけで正しく除外する手掛かりが不足しており、修正は shared/collector 側
から入れるのが筋がよい。案:

- 案A（推奨）: `packages/shared` の `NodeEntity` に「P2P ネットワークに
  参加しないノード」を表現できる区分を追加する（例: `p2pRole` に
  `"none"` を追加、または VC を表すノード役割フィールドを追加）。
  collector（`packages/collector/src/adapters/ethereum/index.ts` の
  p2pRole 導出。compose サービス名 "validator" の判定は `targets.ts` の
  `isBeaconService` と同系のロジックで Ethereum アダプタ内に閉じる）が
  VC にそれを設定し、frontend（`packages/frontend/src/entities/
  connectingEdge.ts`）は P2P 非参加ノードを接続確立中エッジの対象から
  除外する。型変更を伴うため chainviz-designer での設計を経るのが適切
- 補足: VC→beacon の実際の関係（Beacon API での接続）は、D層の内部リンク
  エッジ（`drivesNodeId` 由来の beacon→reth と同系の「一般関係」）として
  可視化する余地があるが、これは本 Issue の範囲を超える拡張なので
  別 Issue とするのが妥当
- 修正対象の見立て: `packages/shared`（型）+ `packages/collector`
  （VC の役割判定と属性設定）+ `packages/frontend`（connectingEdge の
  除外条件）。担当は designer → collector → frontend の流れ

#### 次の担当への注意点

- 実 P2P・チェーン進行・VC の職務遂行はすべて正常。ユーザー環境の問題や
  ノード環境（profiles/）の問題ではない
- `connectingEdge.ts` は「現在の実エンティティ・実エッジから毎回導出」する
  設計なので、collector が正しい属性を配信すれば frontend の修正は
  除外条件の追加だけで済む見込み
- 再現・検証には本記録の手順（collector WS スナップショットの entities/
  edges 確認 + `connectingEdgesToFlowEdges` への適用）がそのまま使える
