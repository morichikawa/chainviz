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
