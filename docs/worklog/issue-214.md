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

### 2026-07-10 Issue #214 frontend側実装

- 担当: frontend
- ブランチ: issue-214-p2p-connecting-stuck
- 経緯: 本Issueのfrontend側は別セッションで着手していたが、ウィンドウ
  再起動によりセッションが中断した。ワーキングツリーに未コミットの
  変更が残っていたため、そこから継続した（ゼロから作り直していない）。

#### 実装内容

設計メモの「frontend側の変更方針」どおり、`connectingEdgesToFlowEdges`
（`packages/frontend/src/entities/connectingEdge.ts`）のノード走査ループに
`if (node.p2pRole === "none") continue;` を1行追加した。`connected`
チェック（実PeerEdgeを持つノードの除外）の直後、クライアントカテゴリ
判定の前に置いている。関数冒頭のコメント（対象外の列挙）にも、P2P非参加
ノードは対象外である旨と`p2pRole`省略時（undefined）は従来どおり対象に
含める旨を追記した。

テスト（`connectingEdge.test.ts`）に以下の2ケースを追加した。

- `p2pRole: "none"` の consensus ノードから接続確立中エッジが導出されない
  こと（VC相当。ブートノードは存在するがエッジが1本も出ないことを確認）
- `p2pRole` 省略（undefined）時は従来どおり接続確立中エッジが導出される
  こと（既存挙動が変わっていないことの確認。旧collectorとの組み合わせでの
  非退行を担保する）

さらに、collector無しでの目視確認ができるように以下を追加した。

- `packages/frontend/src/websocket/mockData.ts`: `p2pRole: "none"` の
  validator client相当ノード（`validator-1`/`validator-2`）を2枚、既定の
  モックスナップショットに追加した（`validatorNode(n)`ヘルパー）。
  PeerEdgeを一切持たない状態を定常状態として持たせている。削除不可
  ノード集合（`NON_REMOVABLE_NODE_IDS`）と`createMockClient`の
  `nodeIds`初期値にも追加し、既存の追加・削除ロジックと矛盾しないように
  した
- `mockData.test.ts`: 追加した2ノードが`p2pRole: "none"`であること、
  どのPeerEdgeの端点にもならないことを確認するテストを追加した
- `packages/frontend/src/app/App.connectingEdgeP2pNone.test.tsx`
  （新規ファイル）: `App`を実際にマウントし（モッククライアント経由）、
  validator-1/validator-2のカードが表示された状態で「接続確立中」の
  エッジ（`.connecting-edge`）・ラベル（「P2P接続を確立中…」）が
  1つも存在しないことを確認するE2Eに近い統合テスト。個々の除外条件は
  `connectingEdge.test.ts`で検証済みなので、ここでは実際に配線された
  キャンバス全体で症状が再現しないことだけを確認する目的で分離した
  （1ファイル1責務。既存の`App.internalLink.test.tsx`と同じ理由で
  ResizeObserver/DOMMatrixReadOnlyのスタブが必要）

#### 検証

- `pnpm build && pnpm test`（frontend）が通ることを確認した
  （94ファイル1426テスト、すべてパス）。lintはルートの
  `eslint packages/frontend/...`（対象ファイル指定）で確認し、
  エラー0件だった
- 修正前のコード（`if (node.p2pRole === "none") continue;`を外した状態）
  に対して新規テスト2件（`connectingEdge.test.ts`の"none"除外ケースと
  `App.connectingEdgeP2pNone.test.tsx`）を実行し、実際に失敗する
  （connecting-edgeが描画される）ことを確認したうえで修正を戻した
  （回帰検出能力の確認）
- 実機（devサーバー起動）でのブラウザ目視は、本環境にPlaywright用の
  共有ライブラリ（`libnspr4.so`等）が無くChromiumを起動できないため
  実施できなかった（`chainviz-detective`の調査記録と同じ制約。
  `sudo apt-get install`にはパスワードが必要でこのセッションからは
  実行できない）。代替として、Viteの開発サーバーを実際に起動しHTTP
  200が返ることを確認した上で、`App.connectingEdgeP2pNone.test.tsx`
  （実際の`App`コンポーネント・実際のCanvas・実際の
  `connectingEdgesToFlowEdges`導出ロジックをモッククライアント経由で
  丸ごとマウントするテスト）で「接続確立中」表示が一切現れないことを
  確認した。ラベル文言（`i18n/messages.ts`の`"P2P接続を確立中…"`）が
  実際のUI文言と一致していることも確認済み

#### 完了状態

- collector側・frontend側の両方が完了したため、`docs/PLAN.md`の
  バックログ項目（#214）にチェックを付けた
- Issue自体のクローズはPR本文の`Closes #214`によるマージ時の自動
  クローズに委ねる（実装担当は`gh issue close`しない）

### 2026-07-10 Issue #214 テスト強化記録

- 担当: tester（テスト強化）
- ブランチ: issue-214-p2p-connecting-stuck
- 内容: collector/frontend が書いた基本テスト（ハッピーパス中心）に対し、
  異常系・境界値・特殊な組み合わせのテストを追加した。実装ロジックには
  手を入れていない。

#### 追加したテストの観点

- collector `targets.test.ts`（`isValidatorService`）
  - "validator" の部分一致（接頭辞・接尾辞・中間に含む派生命名も true）
  - "valid"/"validate" 等の紛らわしい部分語は false（誤検出しないこと）
  - 判定が **compose サービス名のみ**に依存し、実際のクライアント種別を
    見ないという現状の限界を固定するテスト（"validator" を含む execution
    ノードも true になる）。この頑健性の論点は #246 として起票した
- frontend `connectingEdge.test.ts`（Issue #214）
  - `p2pRole: "none"` のノードと、同じ層の未接続の通常ノードが共存する
    場合、除外はノード単位で働き（`continue` がループを打ち切らない）、
    通常ノードのエッジは正しく描かれること（node の並び順に依存しない
    よう VC を先頭に置いて確認）
  - ノード自身がブートノードかつ `p2pRole: "none"` の場合、none 判定が
    自己ループ判定より前段でも結果は「描かない」で一致すること
  - `p2pRole: "none"` のノードに万一実 PeerEdge が付いても、`connected`
    判定が先に効いて接続確立中エッジが出ないこと

#### 回帰検出能力の確認

frontend の除外行（`if (node.p2pRole === "none") continue;`）を一時的に
外すと、追加した「共存」テストと既存の "none" 除外テストが実際に失敗する
（接続確立中エッジが描画される）ことを確認したうえで元に戻した。collector
側の `isValidatorService` テストは既に正しい純粋関数の挙動を固定する
（回帰検出ではなく仕様の固定・文書化）性格のもの。

#### E2E / SCENARIOS

- `packages/e2e/SCENARIOS.md` に UI-B-04「P2P 非参加ノード（validator）に
  接続確立中エッジが固着しない」を追加した。UI-B-01 が正のピアエッジ描画を
  確認するのに対し、UI-B-04 は VC への誤ったエッジが**出ない**ことを確認
  する（重複しない負の確認）。
- `packages/e2e/src/ui/p2p-graph.spec.ts` に UI-B-04 を実装した。P2P グラフ
  確立後（beacon 間ピアエッジ描画後）にキャンバス上の `.connecting-edge` が
  0 件であることを確認する。修正前は validator 由来の接続確立中エッジが
  固着していたため、このシナリオで回帰を検出できる。
- 本環境には Playwright 用の共有ライブラリが無く Chromium を起動できない
  ため、E2E の実行（`test:e2e:ui`）は未実施（detective/frontend の記録と
  同じ制約）。`pnpm build`（e2e は `tsc --noEmit` で型検査）は通ることを
  確認済み。実行は Playwright が使える環境での QA に委ねる。frontend の
  ロジックは `App.connectingEdgeP2pNone.test.tsx` と `connectingEdge.test.ts`
  で既に検証済みで、UI-B-04 は実 collector 出力（実 validator の
  `p2pRole: "none"`）に対する追加の確認という位置づけ。

#### 検証

- `pnpm build && pnpm lint`（ルート）が通ることを確認した。
- `pnpm --filter @chainviz/collector test`（42 ファイル 1137 テスト）・
  `pnpm --filter @chainviz/frontend test`（94 ファイル 1429 テスト）が
  すべてパスすることを確認した。

#### 起票した Issue

- #246: `isValidatorService` が compose サービス名のみで判定しており、
  将来の別チェーンプロファイルで "validator" を含む P2P 参加ノードを
  誤って `p2pRole: "none"` に分類しうる頑健性の論点（現行 Ethereum
  プロファイルでは前提条件が JSDoc に明記されており不具合ではない）。

### 2026-07-10 レビュー（ブランチ issue-214-p2p-connecting-stuck / 2f981da）

- 担当: reviewer（静的レビュー）
- 結果: **合格**（軽微な指摘1件あり。マージ前の修正を推奨。下記）
- 確認した内容:
  - `packages/shared` の型変更（`p2pRole` に `"none"` 追加）: 既存の利用
    箇所はすべて `=== "bootnode"` の判定のみ（`InfraNodeCard.tsx` /
    `InfraPopover.tsx` / `connectionTargets.ts`）で、`"none"` 追加による
    既存挙動への影響なし。省略（undefined）＝「不明」との意味の区別も
    コメント・テスト両方で明確
  - collector の優先順位（ラベル bootnode → VC 判定 → peer）: `toEntity`
    の三項演算子の順序どおり。`isValidatorService` は `isBeaconService` と
    同系（compose サービス名への `/validator/i`）で、beacon 判定と衝突
    しない（beacon1 が peer のままであることの回帰テストあり）。判定の
    前提条件（compose の validator1/validator2 命名、addNode は VC を
    作らない）はコード上の JSDoc と worklog の両方に明記されており、
    compose のサービス名・`node-lifecycle.ts`（reth<n>/beacon<n> のみ
    生成）の実装と照合して裏を取った
  - frontend の除外: `connectingEdgesToFlowEdges` への
    `if (node.p2pRole === "none") continue;` 1行 + コメント追記のみで、
    設計メモの方針どおり。省略時の非退行テストもある
  - テストの質: 単体（除外・非除外・共存・優先順位・大文字小文字・
    ラベル欠落）、統合（App マウントで connecting-edge が出ない）、
    部分一致の限界の固定（#246 起票済み）まで揃っており、collector /
    frontend とも「修正前のコードで新規テストが実際に失敗する」ことを
    確認した記録がある。決め打ち定数の追加・エラー握りつぶしの追加は
    どちらもなし
  - E2E: UI-B-04 は §8.4 の「前提/操作/確認」記法に従い、UI-B-01（正の
    ピアエッジ描画）との重複なし（負の確認として役割分担が明記済み）
  - `pnpm build` / `pnpm lint` / `pnpm test` 全通過（shared 59、collector
    1137、frontend 1429、e2e 77）
  - コミット粒度: 13コミットが shared / collector / frontend / e2e / docs
    に関心事ごとに分割されており混在なし
- 指摘（マージ前の修正を推奨）:
  - `docs/ARCHITECTURE.md` 114行目（本ブランチで追記）の
    「『接続確立中』エッジ（§7）」の相互参照が誤り。§7 は「Phase 5
    （D層: ノード内部）の設計」であり、接続確立中エッジ（Issue #123/#124
    の B層機能）を定義する節ではない（§7.6 冒頭で既存の流儀として一言
    触れているだけ）。ARCHITECTURE.md に接続確立中エッジの専用節は無い
    ため、「（§7）」の削除または正しい参照への差し替えが必要
- 参考（対応必須ではない軽微な点）:
  - `packages/e2e/SCENARIOS.md` の UI-B-04 が UI-B-02 と UI-B-03 の間に
    置かれており番号順でない（接続系でまとめた意図は理解できるが、他節は
    番号順）
  - UI-B-04 の確認3点目（UI-B-01 との役割分担の説明）は検証可能な
    アサーションではなくメタ注記であり、spec の `test.step` に対応しない
    （§8.4 は各箇条書きを step にする規約。注記は「確認」の外に置く方が
    記法に忠実）
  - `docs/WORKLOG.md` の #214 索引行が「調査と対処設計」までの記述で
    止まっており、ブランチが修正一式（collector/frontend/E2E）を含む
    現状をやや過小に要約している
  - ブランチの分岐後に main が進んでいる（#210 の PR マージ）。
    `docs/PLAN.md` の変更行は離れており競合しない見込みだが、PR 作成前に
    main の取り込み（rebase または merge）を推奨
