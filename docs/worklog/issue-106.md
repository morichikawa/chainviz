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
