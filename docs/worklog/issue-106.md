# Issue #106 reth(EL)同士のP2P接続がPeerEdgeとして描画されない

### 2026-07-06 Issue #106 バックログ登録のレビュー

- 担当: reviewer
- ブランチ: docs-plan-add-106-backlog
- 内容: Issue #106 の起票と `docs/PLAN.md` バックログへの追加（コミット
  0d69649、docs のみの変更）をレビューし、合格とした
- 確認したこと:
  - `gh issue view 106` で Issue が OPEN であり、タイトル
    「reth(EL)同士のP2P接続がPeerEdgeとして描画されない」が PLAN.md の
    バックログ記載と一致すること。`collector` ラベル付与も適切
  - 統括の技術的判断の妥当性をコードで検証した。
    `packages/collector/src/adapters/ethereum/peers.ts` の `toPeerEdges` は
    `BeaconNodePeers`（CL側）のみを入力とし、呼び出し元
    `packages/collector/src/adapters/ethereum/index.ts` の `pollPeersOnce`
    も `beaconTargets()`（compose サービス名に "beacon" を含む consensus
    クライアントのみ抽出）を対象に Beacon API を叩いている。リポジトリ全体を
    grep しても `admin_peers` を扱うコードは存在せず、「reth(EL)側の
    admin_peers を一切扱っていない」という判断は正しい
  - validator に線が無いのは正常という判断も妥当。validator クライアントは
    libp2p の P2P に参加せず自分の beacon と HTTP で通信するのみで、
    `targets.ts` の `beaconTargets` も validator コンテナを明示的に除外して
    いる（Beacon API を持たないため）
  - `docs/ARCHITECTURE.md` は B層のピア収集を「Beacon API のポーリング」と
    して記述しており、EL側ピア収集を実装済みと主張する記述は無い。
    docs と実装の齟齬ではなく、純粋な機能不足（未実装）である
  - `pnpm lint` が通ること
  - コミット粒度: docs のみの1コミットで問題なし
- 決定事項・注意点: 実装時は Issue 本文の対応方針にある通り、CL側
  networkId（`<project>-consensus`）と EL側ピアの networkId の扱いを設計時に
  決める必要がある。EL側の `admin_peers` は enode ID ベースなので、
  peer_id → stableId の解決も CL側（libp2p peer_id）とは別系統になる

### 2026-07-06 EL ピアエッジの設計（実装引き継ぎ用）

- 担当: 設計
- ブランチ: issue-106-el-peer-edges
- 内容: EL（reth）間の devp2p 接続を PeerEdge として描くための設計を確定し、
  型定義・純粋関数の骨格と `docs/ARCHITECTURE.md` への反映まで実施した。
  ポーリングの配線（`pollPeersOnce` への組み込み）と RPC 呼び出しヘルパーは
  collector 実装担当へ引き継ぐ
- 決定した仕様上の判断:
  - **識別子の解決**: CL と同じ「各ノードが自己申告した識別子 → stableId の
    対応表」方式。EL の正準識別子は enode URL（`enode://<128桁hex>@host:port`）
    から抽出した公開鍵（小文字・0x なし）とし、enode が取れない場合のみ
    `id` フィールドを同じ表記へ正規化して使う。`id` を主にしないのは、
    クライアント実装（reth/geth）間で `id` の形式が揺れる可能性があるのに
    対し、enode は `admin_nodeInfo`・`admin_peers` の双方に必ず載り形式が
    一意なため。形式が食い違った場合はエッジが描かれないだけで、誤った
    エッジは生まれない（安全側）
  - **networkId**: EL は `<project>-execution` とし、CL の
    `<project>-consensus` と分ける。libp2p と devp2p は物理的に別の P2P
    ネットワークであり、フロントは networkId 単位で色分け・グルーピング
    するので、その事実をそのまま見せる。フロントのコード変更は不要
    （色はハッシュで決定的に導出され、既定プロジェクト名では EL=水色系・
    CL=橙系で衝突しないことを確認済み。グルーピングも新 ID に自動追従）
  - **エッジの端点**: Execution コンテナ自身の stableId（reth カード間に
    描く）。CL エッジの端点は beacon の stableId なので端点集合が重ならず、
    同一性キー（from/to/networkId）の衝突・重複表示は構造的に起きない
  - **ブロック伝播パルス**: EL エッジには乗せない（現状維持）。
    `BlockEntity.receivedAt` のキーは beacon の stableId に揃えてあり
    （`targets.ts` の `receivedAtKey`）、パルスは端点が receivedAt キーと
    一致するエッジにしか乗らないため、EL エッジは接続の可視化のみになる。
    これは意図した挙動として ARCHITECTURE.md に明記した
- 実施した実装（骨格のみ）:
  - `peers.ts`: `BeaconNodePeers` を層非依存の `NodePeers` へリネーム
    （`toPeerEdges` のロジックは識別子の名前空間に依存せず変更なし）。
    CL と EL は識別子の体系が違うので、混ぜずに別々に `toPeerEdges` を
    呼んで連結する使い方をコメントに明記
  - `el-peers.ts`（新規）: `enodePublicKey` / `normalizeAdminNodeInfo` /
    `normalizeAdminPeers` の純粋関数とテスト
  - `targets.ts`: `ExecutionPeerTarget` 型・`executionPeerTargets`・
    `executionNetworkId` を追加（`beaconTargets` と同じ選別基準・
    同ファイルの流儀に合わせた）。テストも追加
  - 全パッケージで `pnpm lint && pnpm build && pnpm test` が通ることを確認
- collector 実装担当への引き継ぎ:
  - `el-peers.ts` に fetch ヘルパーを追加する:
    `fetchExecutionPeerIdentity(rpc, rpcUrl)`（`admin_nodeInfo` を叩いて
    `normalizeAdminNodeInfo`）と
    `fetchConnectedExecutionPeerIdentities(rpc, rpcUrl)`（`admin_peers` を
    叩いて `normalizeAdminPeers`）。トランスポートは既存の
    `EthRpcClient`（`eth-rpc-client.ts`）をそのまま使う（`rpc.call(url,
    "admin_nodeInfo", [])` / `rpc.call(url, "admin_peers", [])`）。
    profile の reth は `--http.api` に `admin` を含むため HTTP 8545 で
    到達できる（`profiles/ethereum/scripts/reth-node.sh` 参照）
  - `index.ts` の `pollPeersOnce` を拡張する: 既存の `beaconTargets` 分に
    加えて `executionPeerTargets(observations)` を列挙し、各ターゲットへ
    上記 2 ヘルパーを並行に投げて `NodePeers`（stableId / peerId /
    networkId / connectedPeerIds）を組み立てる。個々のノードの失敗は
    CL 側と同様そのノードだけ落として継続する。最後に
    `[...toPeerEdges(clNodes), ...toPeerEdges(elNodes)]` のように CL/EL を
    別々に正規化して連結する（識別子の名前空間を混ぜないため）。
    `EthereumAdapter` は `this.ethRpc` を既に持っているので依存の追加は不要
  - 差分計算（`world-state/diff.ts` の `computeEdgeDiff`）・WebSocket
    プロトコル・フロントは変更不要。決定済みの前提としてよい
  - 実装時に判断してよいこと: `pollPeersOnce` 内の CL/EL の並行化の粒度
    （ターゲット単位で一括 Promise.all にするか、ネットワーク単位で
    分けるか）、`admin_peers` の失敗ログの文言

### 2026-07-06 EL ピアエッジの実装（collector）

- 担当: collector
- ブランチ: issue-106-el-peer-edges
- 内容: 設計フェーズで引き継がれた骨格に、実際の RPC 呼び出しと
  `pollPeersOnce` への配線を実装した
- 実施したこと:
  - `el-peers.ts` に `fetchExecutionPeerIdentity` /
    `fetchConnectedExecutionPeerIdentities` を追加。既存の `EthRpcClient`
    （`eth-rpc-client.ts`）の `rpc.call(url, "admin_nodeInfo"/"admin_peers", [])`
    をそのまま使い、既存の正規化関数（`normalizeAdminNodeInfo` /
    `normalizeAdminPeers`）に通す。`admin_nodeInfo` が識別子を返せない場合は
    例外を投げる（呼び出し側でそのノードだけ落とす設計のため、ここで
    握りつぶさない）
  - `index.ts` の `pollPeersOnce` を、CL（`fetchConsensusPeerNodes`、既存の
    Beacon API 呼び出しをそのまま private メソッドへ切り出しただけで挙動は
    変更なし）と EL（`fetchExecutionPeerNodes`、新規）を並行に取得し、
    `toPeerEdges` を CL/EL それぞれ別々に呼んでから連結する形に拡張した。
    並行化の粒度は「CL 全体」と「EL 全体」を `Promise.all` で並べ、各層の
    内部はターゲット単位でさらに `Promise.all` する 2 段構成にした（層を
    跨いだ待ち合わせを避け、CL が遅くても EL の結果に引きずられない）。
    `EthereumAdapter` は既存の `this.ethRpc` をそのまま使い、依存追加なし
  - EL 側の個々のノード失敗は `console.error` でログを残しつつそのノードを
    落として継続する（`[ethereum] execution peer poll failed for <stableId>:`）。
    CL 側の失敗ハンドリングは既存のまま（ログなしで握る）変更していない
  - テスト: `el-peers.test.ts` に 2 ヘルパーの正常系・RPC 例外の伝播・
    識別子が取れない場合の例外化を追加。`peer-block-adapter.test.ts` に
    EL 単独のエッジ生成・EL 個別ノード失敗時の継続とログ出力・CL/EL 混在
    トポロジでの名前空間分離（`chainviz-ethereum-consensus` /
    `chainviz-ethereum-execution` それぞれ独立にエッジが立つこと）を追加した
  - 既存テストの副作用修正: EL ポーリングが有効になったことで、
    `ethRpcClient` を明示しない既存テスト（reth コンテナを含みつつ
    `pollPeersOnce` を呼ぶもの）が、実装のデフォルト
    `createFetchEthRpcClient()`（実際に `fetch` する）経由で存在しない
    アドレスへ本物のネットワークリクエストを送り、3 秒のタイムアウトまで
    待つようになっていた（1 テストが約 3 秒に肥大化するのを確認して修正）。
    該当テストに `ethRpcClient` のスタブを追加して修正し、修正後は該当
    テストが数ミリ秒で終わることを確認した
- 実機確認（このバグの発端の再現・解消確認）:
  - 稼働中の `profiles/ethereum` スタック（reth1=172.28.1.1、
    reth2=172.28.1.2）に対し、reth1 の `admin_peers` を直接 curl で叩き、
    reth2 の enode（`enode://a8beb52c...@172.28.1.2:30303`）が接続相手として
    返ることを確認した
  - collector を実際に起動（`CHAINVIZ_COLLECTOR_PORT=4123` で一時起動）し、
    WebSocket でスナップショットを取得したところ、
    `{ kind: "peer", fromNodeId: "chainviz-ethereum/reth1", toNodeId:
    "chainviz-ethereum/reth2", networkId: "chainviz-ethereum-execution" }`
    が edges に含まれることを確認した。同時に CL 側の
    `chainviz-ethereum-consensus` の beacon1↔beacon2 エッジも独立して
    存在しており、名前空間が混ざっていないことを確認した。これにより
    Issue #106 の発端（reth1↔reth2 の P2P 接続はあるのに画面に線が出ない）
    が解消されたことを実データで確認できた
  - 確認後、一時起動した collector プロセスは停止し、検証用の一時
    スクリプトも削除した
- 品質ゲート: `pnpm lint && pnpm build && pnpm test`（ルートから全パッケージ
  対象）が通ることを確認済み
- 次の担当（tester → reviewer → qa）への申し送り:
  - `docs/ARCHITECTURE.md` は設計フェーズで既に更新済み（EL ピア収集・
    networkId 分離・ブロック伝播パルスを乗せない旨を記載済み）なので、
    実装差分によるドキュメント齟齬は無いはず。念のため sync-docs 観点で
    確認してほしい
  - 固定値として `EXECUTION_RPC_PORT`（8545）を使っているが、これは
    `targets.ts` で既存の `executionRpcUrls` / `executionTargets` が
    既に使っている値の再利用であり、本 Issue で新規に導入した固定値では
    ない

### 2026-07-06 EL ピアエッジの異常系・境界値テスト強化（tester）

- 担当: tester
- ブランチ: issue-106-el-peer-edges
- 内容: 実装担当が書いた基本テスト（ハッピーパス中心）に、異常系・境界値・
  部分失敗の分離を確認するテストを追加した。実装コードは変更していない
- 追加したテスト（計 18 件）:
  - `el-peers.test.ts`（`enodePublicKey`）: 公開鍵長の境界値（127 桁で不足・
    129 桁で超過はいずれも不一致）、`@host` 区切りの欠落、スキーム大文字
    `ENODE://` の非一致（case-sensitive）、先頭空白による非一致、enode 内で
    公開鍵に `0x` を付けた場合の非一致
  - `el-peers.test.ts`（`normalizeAdminNodeInfo`）: `id` の接頭辞が大文字
    `0X` の場合は剥がされず不正になる挙動、空文字の `id`、接頭辞 `0x` のみで
    桁が無い `id`、enode が空文字でも例外にせず `id` フォールバックで解決する
    ケース
  - `el-peers.test.ts`（`normalizeAdminPeers`）: 同一 peer が重複して返って
    きた場合に正規化段では重複を残すこと（重複排除は下流 `toPeerEdges` の
    責務）、自ノード自身が peer として返る異常系でも正規化段では落とさない
    こと（自己ループ除去も `toPeerEdges` の責務）、enode 由来と `id`
    フォールバックが混在する場合
  - `peer-block-adapter.test.ts`（`pollPeersOnce`）: EL 側の admin_* 呼び出しが
    全ノード失敗しても CL 側の beacon エッジは配信されること、逆に CL 側の
    Beacon API が全滅しても EL 側の reth エッジは配信されること（`Promise.all`
    の片側失敗が他方を巻き込まない層の分離）
  - `targets.test.ts`（`executionPeerTargets`）: reth 以外の execution
    クライアント種別（geth）も対象に含めること（reth 専用でない）、
    プロジェクト名に `-consensus` を含んでも EL の `-execution` と CL の
    `-consensus` は衝突しないこと、あるプロジェクトの EL networkId が別
    プロジェクトの CL networkId と偶然一致しないこと（末尾の
    `-execution` / `-consensus` が必ず異なるため）
- 品質ゲート: ルートから `pnpm lint && pnpm build && pnpm test` が通ることを
  確認した（collector 550 件・frontend 411 件などすべて成功）。テスト追加前は
  collector 532 件だったので純増 18 件
- 実装のバグは見つからなかった。既存実装は enode 形式の揺れ・部分失敗・
  networkId 分離のいずれについても安全側に倒れており、追加テストはその
  挙動を回帰として固定するもの
