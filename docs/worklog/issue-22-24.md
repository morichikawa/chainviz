# Issue #22-24 作業記録

### 2026-07-04 Issue #22・#23・#24 B層（P2P ピア接続グラフ）のフロント描画
- 担当: frontend
- ブランチ: issue-22-frontend-peer-edges
- 内容: B層として、ノードカードのあいだに P2P ピア接続を「紐」（React Flow
  エッジ）として描画する仕組みを実装した。collector 側（#19-21）は未完成の
  ため、`packages/frontend/src/websocket/mockData.ts` に PeerEdge のサンプルを
  載せて実装・確認した。
  - #22: world-state store（`world-state/store.ts`）は既に `applySnapshot` /
    `applyDiff` で PeerEdge（edgeAdded / edgeRemoved）を受信・保持していた
    （既存実装）。エッジ配列を取り出す `listEdges(state)` アクセサを
    `listEntities` と対にして追加し、テストを足した。
  - #23: `entities/peerEdge.ts` を新設。`peerEdgesToFlowEdges(edges, presentNodeIds)`
    が PeerEdge を React Flow の Edge に変換する。`fromNodeId` / `toNodeId` は
    インフラエンティティの安定 ID（= React Flow ノードの id）に対応する。
    端点が両方カードとして存在する紐だけを描き（宙ぶらりんの紐を避ける）、
    P2P は無向なので同一 networkId・同一ペアは向きが逆でも 1 本にまとめる。
    エッジをカードに留めるため `InfraNodeCard` に source / target の Handle を
    追加した（CSS で不可視化）。`Canvas` は edges を受け取り、ノードと同じく
    ローカル state + `onEdgesChange` で保持する。`App` が state のエッジと
    現在のノード id からエッジを算出して Canvas に渡す。
  - #24: `networkId` 単位のグルーピング。`networkIdColor(networkId)` で
    networkId から決定的に色を選び、エッジの stroke と className に反映する。
    `groupEdgesByNetwork` で networkId ごとに集計できる。現状の Ethereum
    プロファイル 1 つでは networkId は 1 種類（`1337`、profiles/ethereum の
    CHAIN_ID と一致）のため既定のスナップショットの見た目には差が出ないが、
    将来の複数チェーン比較（Phase 6 以降）に備えて仕組みを用意した。
  - glossary: B層向けの用語ファイル `glossary/ethereum/terms/b-network.yaml`
    を追加（p2p / peer / discovery / gossip、layer: b-network）。`glossary/data.ts`
    でマージして読み込む。
- 決定事項・注意点:
  - `packages/shared` の型変更は不要だった。PeerEdge / DiffEvent（edgeAdded /
    edgeRemoved）は既に定義済み。
  - モックデータは、既定の `createMockSnapshot()` は実環境どおり networkId
    1 種類（reth-node-1 ⇄ reth-node-2 の 1 本）にとどめ、実環境の見た目に
    影響しないようにした。#24 のグルーピングを目視・テストで確認するための
    2 ネットワークのサンプルは別関数 `createMultiNetworkMockSnapshot()` として
    切り出し、既定の App では使わない。
  - #25（ブロック伝播パルスアニメーション）は今回のスコープ外。collector 側の
    ブロックタイミングデータ（#20-21）が固まってから別途着手する。
  - 検証: `pnpm --filter @chainviz/frontend build` / `test`（145 件全通過）/
    `eslint packages/frontend/src` がいずれも通ることを確認した。実データとの
    疎通確認は collector 側完成後に qa が行う。

### 2026-07-04 Issue #22・#23・#24 B層描画のテスト強化（異常系・境界値）
- 担当: tester
- ブランチ: issue-22-frontend-peer-edges
- 内容: 実装担当が書いた基本テストに、エッジケース・異常系・境界値のテストを
  追加した（実装コードは変更していない）。テスト件数は 145 → 171（+26）。
  - `entities/peerEdge.test.ts`:
    - `networkIdColor`: 空文字列・特殊文字（日本語/中国語/空白/タブ）・
      500 件の networkId でいずれもパレット範囲内の色を返すことを確認。
    - `networkClassToken`: 空文字列・全文字が不正な場合・既に安全な
      ハイフン/アンダースコアの保持。
    - `peerEdgesToFlowEdges`: 空配列、present が空、source 側端点の欠落、
      両端点の欠落、完全重複エッジの排除、1 バッチ内で自己ループ・宙ぶらりん・
      有効エッジが混在する場合の選別、逆向き × 別 networkId が別の紐になること、
      並べ替え後も data.networkId が元の値を保つこと、className だけが
      サニタイズされ id キーには生の networkId が使われること、
      クラストークンが衝突する networkId 同士を別扱いすること。
    - `groupEdgesByNetwork`: 同一 networkId の複数エッジが 1 バケットに
      まとまること、data 欠落エッジが空文字バケットへ落ちること。
  - `world-state/store.test.ts`（edgeAdded / edgeRemoved の差分適用）:
    - edgeAdded が入力配列を破壊しないこと、edgeRemoved の逆向き指定では
      一致しないこと、edgeRemoved が同一ペアの複数 networkId エッジを
      まとめて消すこと、edgeAdded の重複判定が networkId を無視すること、
      エッジとエンティティのイベント混在バッチ、別バッチでの追加→削除。
    - `listEdges`: 最後のエッジ削除後に空配列へ戻ること。
  - `websocket/mockData.test.ts`: `createMultiNetworkMockSnapshot()` を
    描画変換（peerEdgesToFlowEdges → groupEdgesByNetwork）まで通し、
    宙ぶらりんが出ず 2 グループに分かれることの結合テストを追加。
- 決定事項・注意点:
  - 差分プロトコル上、`edgeRemoved` は networkId を持たない
    （`DiffEvent` の定義）。store 側の edgeAdded 重複判定も (from, to) のみで
    networkId を見ないため、同一ペアで networkId 違いの 2 本目は追加されない。
    一方、描画側 `peerEdgesToFlowEdges` は networkId 違いを別の紐として扱う。
    この非対称性は、同一ノードペアが複数ネットワークで同時にピア接続する
    という稀なケースでのみ表面化する既知の制約として、store 側にテストと
    コメントで記録した（現状の実環境では networkId は 1 種類のため実害なし）。
  - 検証: `pnpm --filter @chainviz/frontend test`（171 件全通過）/ `build` /
    追加した 3 ファイルへの `eslint` がいずれも通ることを確認した。
### 2026-07-04 Issue #22・#23・#24 B層フロント描画のレビューとエッジ一致判定の修正
- 担当: reviewer
- ブランチ: issue-22-frontend-peer-edges
- 内容: frontend 実装（#22-24）と tester のテスト強化を静的レビューし、
  collector 側レビュー（#19-21）から申し送りされていた「frontend store の
  エッジ一致判定が networkId を見ない」問題を修正した。
  - `packages/frontend/src/world-state/store.ts` … `applyDiff` の
    edgeAdded / edgeRemoved の一致判定を fromNodeId / toNodeId / networkId の
    3 条件一致に修正（collector 側 `world-state/diff.ts` の `edgeKey()` と
    同じ同一性キー。ARCHITECTURE.md §2 の DiffEvent 定義と整合）。
  - `packages/frontend/src/world-state/store.test.ts` … tester が「現状挙動」
    として固定していた 2 テスト（edgeRemoved が同一ペアの全 networkId を
    巻き込んで消す / edgeAdded の重複判定が networkId を無視する）を、
    修正後の正しい契約（networkId 一致のみ削除 / networkId 違いは別エッジ
    として両方保持）のテストに書き換えた。networkId 違いの edgeRemoved では
    何も消えず参照が保たれる負のケースを 1 件追加（frontend 171→172 件）。
    型必須化により networkId を欠いていた edgeRemoved リテラル 4 箇所も補完。
  - 描画側 `entities/peerEdge.ts` の「networkId 違いは別の紐として 2 本描く」
    設計と store 側の保持ルールが一致することを確認した（従来は store が
    2 本目を落とすため描画に届かない非対称があった。今回の修正で解消）。
- レビュー結果（修正以外は指摘なし）:
  - 境界の遵守: frontend は Docker / ノード API に触れておらず、チェーン固有の
    RPC 語彙の漏れもない（`reth` / `lighthouse` は shared の `clientType` の
    データ値であり許容）。循環依存なし（madge で確認）。
  - glossary: `glossary/ethereum/terms/b-network.yaml` は ARCHITECTURE.md §5 の
    スキーマ（name/definition の {ja, en}、layer、relatedTerms）に整合。
    relatedTerms の参照先はすべて同ファイル内に存在する。
  - テストの質: tester 追加分（peerEdge の特殊文字 networkId・端点欠落・
    クラストークン衝突、mockData→描画変換の結合テスト等）は異常系・境界値を
    実質的に検証しており妥当。
  - `pnpm lint` / `pnpm build` / `pnpm test` 全通過
    （shared 39 / collector 214 / frontend 172）。
- 決定事項・注意点:
  - **main マージ直後の時点では `pnpm build` が通らない状態だった**
    （collector 側 PR #26 で `DiffEvent.edgeRemoved` の networkId が必須化
    されたのに対し、当ブランチの store.test.ts のリテラル 4 箇所が未追随）。
    今回の修正で解消したが、マージコンフリクト解消時はコンフリクトの有無に
    かかわらずルートで build まで回して確認すること。
  - feat コミット（8afaf21）に実装・テスト・glossary データ追加が同居している。
    A層では用語データを別 Issue（#14）にしていた前例があり、粒度としては
    分けるのが望ましかったが、B層は glossary 用の Issue が無く機能の一部と
    して追加された経緯のため許容と判断（履歴の書き換えはしない）。
  - 本修正はレビュー担当が直接実装した。shared の型変更（PR #26）が起点の
    契約整合の後始末であり、統括からの明示的な依頼に基づく例外的な対応。

### 2026-07-04 Issue #22・#23・#24 B層フロント描画（P2Pエッジ・グルーピング）実機検証
- 担当: qa
- ブランチ: issue-22-frontend-peer-edges
- 内容: reviewer の静的レビュー（networkId 一致判定の修正）まで反映済みの
  状態で、frontend を実際に起動して以下を検証した。判定はステップ4の
  完了条件のうち frontend が担う「ノード同士が P2P エッジで繋がる」
  「ネットワーク単位でグルーピングされる」の 2 点（#25 のパルスアニメーションは
  スコープ外）。
  - モック起動（`createMockSnapshot`）: Playwright でキャンバスを描画確認。
    reth-node-1 ↔ reth-node-2 の間にピアエッジが 1 本描画され、lighthouse-1 /
    workbench-alice には紐が付かない（宙ぶらりんの紐なし）ことを確認。
    エッジの class に networkId トークン（`peer-edge--net-1337`）が付き、
    stroke 色が networkId 由来の色になっていることを確認。
  - マルチネットワーク（`createMultiNetworkMockSnapshot` を流す一時エントリを
    作成して確認・確認後に削除）: networkId `1337`（黄 #f5b544）と `2337`
    （紫 #c77dff）の 2 本のエッジが別色で描画され、networkId 単位で
    見分けられることを確認。
  - 実 collector との統合: `profiles/ethereum` 稼働中の Docker に対し main
    ブランチの collector を起動（ポート 4000）、当 frontend ブランチを
    `VITE_COLLECTOR_URL=ws://localhost:4000` で起動。ノード 7 個（beacon1/2、
    reth1/2、validator1/2、workbench）が表示され、beacon1 ↔ beacon2 の間に
    ピアエッジ 1 本（networkId=`chainviz-ethereum-consensus`）が描画される
    ことを確認。ノードをドラッグするとエッジが端点に追従して曲線を描くことも
    確認した。ブラウザコンソール・ページエラーは 0 件。
  - `pnpm lint` / `pnpm build` / `pnpm test` 全通過（shared 39 / collector 214 /
    frontend 172）。
- 判定: #22・#23・#24 の完了条件を満たす。合格。
- 決定事項・注意点:
  - collector が配信する PeerEdge の `fromNodeId` / `toNodeId` は NodeEntity.id
    （例: `chainviz-ethereum/beacon1`）と一致しており、frontend の
    `peerEdgesToFlowEdges` が要求する「両端点が描画中ノードとして存在する紐だけ
    描く」条件を満たす。実データでの端点解決に問題はない。
  - 実環境の networkId は現状 1 種類（`chainviz-ethereum-consensus`）のため、
    複数ネットワークの色分けは実データでは再現できずモックで確認した。これは
    ARCHITECTURE / 実装の想定どおり。

