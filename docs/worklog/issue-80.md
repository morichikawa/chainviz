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
