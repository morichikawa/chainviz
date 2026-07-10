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

### 2026-07-10 Issue #214 設計メモ

- 担当: designer（設計）
- ブランチ: issue-214-p2p-connecting-stuck
- 内容: 調査記録の案A（`p2pRole` に P2P 非参加区分を追加）を採用した設計。
  `packages/shared` の型変更と対応テストはこの時点で実装・コミット済み。
  collector / frontend の実装は後続担当に引き継ぐ

#### 型変更（実装済み）

`packages/shared/src/world-state/entities.ts` の `NodeEntity.p2pRole` を
`"bootnode" | "peer" | "none"` の3値に拡張した。

- `"bootnode"`: P2P に参加し、新規参加ノードの入口役を担う（従来どおり）
- `"peer"`: P2P に参加する通常ピア（従来どおり）
- `"none"`（新設）: **P2P ネットワークに参加しないノード**。チェーンの
  クライアントプロセスではあるが P2P の観測対象にならないコンポーネント
  （Ethereum プロファイルでは validator client。beacon へ HTTP の Beacon API
  で接続するだけで libp2p に参加しない）。このノードを端点とする PeerEdge は
  決して観測されないため、フロントは P2P 接続を前提にした表示（「接続確立中」
  エッジ等）の対象から除外する
- 省略（undefined）: 従来どおり「不明」（旧スナップショット互換）。
  `"none"` = 「参加しないと判明している」とは意味が異なるので混同しない

設計判断とその理由:

- **新フィールド追加ではなく既存 `p2pRole` の値の拡張にした**。「P2P 上の
  役割」と「P2P に参加するか」は同じ軸の情報であり、フィールドを分けると
  `p2pRole: "peer"` かつ「非参加」のような矛盾した組み合わせが型上表現
  できてしまう。1フィールドに寄せれば矛盾が構造的に起きない
- **値の名前は `"none"`**。「P2P 上の役割: なし」という素直な読みになり、
  チェーン非依存の語彙（"validator" のようなチェーン固有語を値に使わない =
  ChainAdapter 境界の維持）。他チェーンで P2P 非参加の補助コンポーネントが
  現れた場合も同じ値に正規化する
- ユニットテスト（`entities.test.ts`）に「`"none"` が JSON 往復で保持される」
  「既存の `=== "bootnode"` / `=== "peer"` 判定に該当しない」ケースを追加した

#### collector 側の変更方針（未実装・実装担当へ）

対象: `packages/collector/src/adapters/ethereum/`

1. **VC 判定ヘルパの追加**。compose サービス名に "validator" を含むかを
   判定する `isValidatorService(obs)` 相当を Ethereum アダプタ内に追加する
   （`targets.ts` の `isBeaconService` と同系のロジック。判定は
   `COMPOSE_SERVICE_LABEL` の値への `/validator/i`）。置き場所は「コンテナが
   何であるかの分類」なので `classify.ts` を推奨するが、`isBeaconService` の
   隣（`targets.ts`）でもよい。実装担当の判断に委ねる
2. **`index.ts` の `toEntity` の p2pRole 導出変更**（現在は 340 行付近の
   `obs.labels[P2P_ROLE_LABEL] === "bootnode" ? "bootnode" : "peer"`）。
   導出順は: ラベルが "bootnode" → `"bootnode"`、VC 判定に該当 → `"none"`、
   それ以外 → `"peer"`
3. **成立前提のコメント明記**（CLAUDE.md の運用ルール）。この判定は
   「Ethereum プロファイルの compose が VC のサービス名を "validator" を
   含む名前にしている」（`profiles/ethereum/docker-compose.yml` の
   validator1/validator2）ことが前提。addNode が作るノードは reth+beacon の
   ペアのみで VC を作らない（`node-lifecycle.ts` に validator 生成は無い）
   ため、現行構成ではサービス名判定で漏れなく判定できる。この前提を
   コード上のコメントと本 worklog の実装記録の両方に残すこと
4. ユニットテスト: `index.test.ts` に「サービス名 validator* のコンテナが
   `p2pRole: "none"` になる」「beacon/reth は従来どおり」のケースを追加

補足（決定済みの判断）: ラベル `com.chainviz.p2p-role: "none"` を compose に
付与する案も検討したが、採用しない。「P2P に参加しない」は VC という
コンポーネント種別に内在する性質（デプロイ時の選択ではない）なので、
ブートノード指定（デプロイ構成の選択 = ラベルが真実の情報源）とは性格が
異なり、アダプタ内の分類として導出するのが筋。また、ラベル方式だと既存の
稼働中スタックはコンテナ再作成まで直らないが、サービス名判定なら collector
更新だけで即座に直る。

#### frontend 側の変更方針（未実装・実装担当へ）

対象: `packages/frontend/src/entities/connectingEdge.ts`

- `connectingEdgesToFlowEdges` のノード走査ループに
  `if (node.p2pRole === "none") continue;` の除外を追加する（`connected`
  チェックの直後・カテゴリ判定の前が自然）。関数冒頭のコメント（対象外の
  列挙）にも「P2P 非参加ノード（p2pRole: "none"）は対象外」を追記する
- `connectingEdge.test.ts` に「`p2pRole: "none"` の consensus ノードから
  接続確立中エッジが導出されない」ケースを追加する。調査記録のライブ
  スナップショット相当（VC が PeerEdge を持たない状態）を再現するとよい
- 省略時（undefined）の挙動は変えない（従来どおり導出対象。旧 collector
  との組み合わせでも表示が今より悪化しない）

#### 影響範囲の洗い出し結果

`p2pRole` を参照する実装コードは以下の4箇所（テスト・モックを除く）。

| 箇所 | 現在の判定 | "none" 追加の影響 |
| --- | --- | --- |
| `collector/adapters/ethereum/index.ts`（toEntity） | `=== "bootnode" ? : "peer"` | **要変更**（上記方針） |
| `frontend/entities/connectingEdge.ts` | 参照なし（clientCategory のみ） | **要変更**（除外条件の追加） |
| `frontend/entities/connectionTargets.ts`（resolveBootNodes） | `!== "bootnode"` で continue | 変更不要（"none" は自然に除外される） |
| `frontend/entities/InfraNodeCard.tsx` / `InfraPopover.tsx` | `=== "bootnode"` のみ（バッジ・役割行） | 変更不要（"none" では何も表示されない = 現状維持で正しい） |

- `frontend/websocket/mockData.ts`: 変更必須ではないが、モックに
  `p2pRole: "none"` の validator 相当ノードを1枚足すと、collector 無しでの
  目視確認（接続確立中エッジが出ないこと）ができる。実装担当の判断でよい
- `packages/e2e/src/ui/infra-display.spec.ts`: bootnode バッジの検証のみで
  "none" の影響なし。#214 の修正確認用 E2E（validator に接続確立中エッジが
  出ないこと）を足すかはテスト強化担当の判断
- collector の `diff.ts` / `store.ts`: p2pRole は値としてそのまま比較・配信
  されるだけで、値の種類に依存しない。変更不要

#### 作業順序と引き継ぎ

1. shared（済・コミット 8990f0b）
2. collector と frontend は互いに依存しないので並行着手可。ただし症状の
   解消には両方が必要（collector が "none" を配信し、frontend が除外する）
3. 検証は調査記録の手順（collector WS スナップショット確認 +
   `connectingEdgesToFlowEdges` への適用、またはブラウザ目視）がそのまま使える

#### 派生して起票した Issue

- #243: VC の同期状態が永久に「同期中」（blockHeight 0）と表示される問題。
  #214 と同根（VC を通常ノードと同一視）だが、「同期という概念を持たない
  ノードの表現」という別の設計判断が要るため分離した
- 調査記録が触れている「VC→beacon の Beacon API 接続の可視化」は本 Issue の
  範囲外。reth/beacon の役割の伝わりにくさを扱う #215 と関連するため、
  取り組む場合は #215 の設計と合わせて検討するのがよい（未起票）

### 2026-07-10 Issue #214 collector 側実装

- 担当: collector
- ブランチ: issue-214-p2p-connecting-stuck
- 内容: 設計メモの「collector 側の変更方針」どおりに実装した。

  1. `packages/collector/src/adapters/ethereum/targets.ts` に
     `isValidatorService(obs)` を追加した（`isBeaconService` と同系。compose
     サービス名への `/validator/i` 判定）。既存の `isBeaconService` と同じ
     ファイルに置いた（分類ロジックの置き場所が既に targets.ts に集まって
     いるため一貫させた。classify.ts は「node/workbench の別」「クライアント
     種別」の判定に専念させている）
  2. `packages/collector/src/adapters/ethereum/index.ts` の `toEntity` の
     `p2pRole` 導出を、ラベルが `"bootnode"` → `"bootnode"`、
     `isValidatorService(obs)` に該当 → `"none"`、それ以外 → `"peer"` の
     優先順位に変更した
  3. 判定の前提条件（compose の VC サービス名が "validator" を含むこと、
     addNode は VC を作らないこと）を `isValidatorService` の JSDoc コメント
     と本記録の両方に明記した

- テスト: `targets.test.ts` に `isValidatorService` 単体のケース（validator
  で true、beacon/execution で false、ラベル欠落で false、大文字小文字
  無視）を追加。`index.test.ts` に `pollInfra` 経由で
  validator サービス名のコンテナが `p2pRole: "none"` になること、大文字
  小文字を無視すること、`p2p-role: bootnode` ラベルが VC 判定より優先される
  こと（現行構成では起きない組み合わせだが契約として固定）、beacon
  コンテナ（同じ lighthouse クライアント）が誤って `"none"` にならないこと
  を追加した。修正前のコードに対してこれらの新規テストを実行し、
  `p2pRole: "none"` を期待するテスト2件が実際に `"peer"` で失敗すること
  （＝不具合を検出できること）を確認したうえで修正を戻した。

- 実機検証: 稼働中の `chainviz-ethereum` スタック（Docker、7コンテナ）に
  対し、修正前の collector（main ブランチ、ポート4000で稼働中だったもの）と
  修正後の collector（本ブランチをビルドし、ポート4100/4101で同じ Docker
  スタックに向けて起動）の両方に WebSocket で接続し、スナップショットの
  `entities` を直接比較した。
  - 修正前: `validator1`/`validator2` とも `clientType: "lighthouse"`,
    `p2pRole: "peer"`
  - 修正後: 同じ2ノードが `p2pRole: "none"` に変わり、`reth1`/`reth2`
    （`peer`）・`beacon1`（`bootnode`）・`beacon2`（`peer`）は変化しない
    ことを確認した
  - 検証用の一時 collector プロセスは確認後に停止済み。既存の main
    ブランチ側 collector（ポート4000、他セッションが使用中の可能性がある
    もの）には触れていない

- `pnpm build && pnpm lint && pnpm test` はすべて成功（collector: 42
  ファイル1134テスト）

- 決定事項・注意点:
  - この修正は collector 側の属性配信のみ。frontend
    （`connectingEdge.ts` の除外条件追加）は別途 chainviz-frontend の
    担当であり、frontend 側の対応が完了するまでは symptom（「接続確立中」
    エッジが解消されない）自体はまだユーザーには直っていない
  - `docs/PLAN.md` のバックログ項目（#214）は frontend 側が完了して
    Issue 全体の完了条件を満たすまでチェックを付けていない
  - `targets.ts` は既に独自の `COMPOSE_SERVICE_LABEL` 定数
    （`labels.ts` の同名定数とは別定義の重複）を持っており、
    `isValidatorService` もこの既存の重複定義に合わせて実装した
    （新規に持ち込んだ問題ではなく、既存の設計。追加の是正はスコープ外
    としたため手を入れていない）
