# Issue #19-21 作業記録

### 2026-07-04 Issue #19・#20・#21 Phase 2 collector（B層 P2Pグラフのデータ収集）
- 担当: collector
- ブランチ: issue-19-peer-edges-lighthouse
- 内容: `packages/collector/` に B層（P2Pグラフ）のデータ収集を実装した。
  A層と同じく collector が唯一の集約点として振る舞い、Ethereum 固有の語彙
  （Beacon API・eth_subscribe・reth/lighthouse・ポート番号）は
  `adapters/ethereum/` の内側に閉じ込め、共通層（world-state/）には PeerEdge /
  BlockEntity のチェーン非依存な型でしか出さない。
  - **#19 ピア接続 → PeerEdge**: lighthouse beacon の Beacon API を周期
    ポーリングして接続関係を PeerEdge へ正規化する。
    - `adapters/ethereum/http-client.ts` … GET 専用の JSON HTTP クライアント抽象
      （`HttpClient`）と fetch 実装。IO 境界なのでモック可能にし本体はテスト対象外
      （dockerode-client.ts と同じ扱い）。
    - `adapters/ethereum/beacon-api.ts` … `GET /eth/v1/node/identity`（自ノードの
      peer_id）と `GET /eth/v1/node/peers?state=connected`（接続中ピアの peer_id）を
      叩く。Beacon API のパス・レスポンス形状はここに閉じる。`BEACON_API_PORT=5052`。
    - `adapters/ethereum/targets.ts` … Docker の観測値から到達先を決める。ビーコン
      対象は「consensus クライアント（lighthouse 等）かつ compose サービス名に
      `beacon` を含む」もの。**validator コンテナは同じ lighthouse クライアントだが
      Beacon API を持たない**ため、サービス名で除外するのが要点（classify.ts の
      detectClientType は beacon/validator を区別できない）。
    - `adapters/ethereum/peers.ts` … `toPeerEdges()`。全ノードの peer_id → 安定識別子
      （NodeEntity.id）対応表を作り、接続先 peer_id を安定識別子へ解決してエッジ化。
      観測対象外ピアは落とし、自己ループを除外し、A→B と B→A は無向エッジ 1 本に
      畳む（from/to は安定 ID 昇順に正規化）。peer_id はワールドステートに漏らさない。
    - networkId は安定識別子の project 部分から `<project>-consensus` を導く
      （例: `chainviz-ethereum-consensus`）。frontend #24 のネットワーク単位
      グルーピング用。将来 Phase 3 で EL 間 P2P を足すときに consensus/execution を
      別ネットワークとして区別できるよう suffix を付けてある。
  - **#20 ブロック受信時刻の記録**: 各 reth(EL) の eth_subscribe(newHeads) を購読し、
    collector がブロックを受信した実時刻をノード単位で記録する。
    - `adapters/ethereum/eth-ws-client.ts` … WS JSON-RPC クライアント抽象
      （`EthWsClient`）と ws 実装。eth_subscribe / eth_subscription の語彙はここに閉じる。
      IO 境界なのでモック可能。EL の WS ポートは `EXECUTION_WS_PORT=8546`。
    - `adapters/ethereum/blocks.ts` … `BlockPropagationTracker`。ブロックハッシュを
      キーに、どのノードがいつ受信したかを `receivedAt: Record<nodeId, epochMs>` へ
      マージしていく純粋トラッカー。同一ノードの再通知では最初の受信時刻を保持
      （波の起点を安定させる）。newHeads ヘッダの hex（number/timestamp）を数値化。
      保持数の上限（既定 200、超過で古いブロックから eviction）でメモリを抑える。
  - **#21 world-state store 経由の配信**:
    - `world-state/diff.ts` … `computeEdgeDiff()` と `edgeKey()` を追加。エッジの
      同一性は from/to/networkId の 3 つ組で判定し、追加は edgeAdded、消滅は
      edgeRemoved（shared の型どおり from/to のみ載せる）。エッジには「更新」概念を
      設けない（差異＝別エッジ）。ブロックは既存 computeDiff にそのまま乗る
      （hash キーのエンティティ）。
    - `world-state/store.ts` … `applyPeers(edges)` と `applyBlock(block)` を追加し、
      `applyEvent` の edgeAdded/edgeRemoved を「A層では扱わない」スキップから実装へ
      置き換えた。applyPeers は前回エッジ集合との差分を計算・適用。applyBlock は
      当該ブロックだけを差分計算し他エンティティ・エッジには触れない。
    - `index.ts` … main() で `adapter.subscribePeers(...)`（差分を applyPeers →
      broadcast）と `adapter.subscribeBlocks(...)`（applyBlock → broadcast）を配線。
    - `adapters/ethereum/index.ts` … `pollPeersOnce()`（1 巡ポーリングして PeerEdge[]）、
      `subscribePeers()`（自己スケジューリングの周期ループ。startPollingLoop と同じ
      重複実行防止）、`subscribeBlocks()`（EL ノードを列挙し各ノードへ永続 WS 購読）、
      `dispose()`（ループ停止・購読 close）を実装。http/ws クライアントと時刻ソースは
      コンストラクタから注入可能（既定は実装、テストでモック）。
- 決定事項・注意点:
  - **shared の型変更は不要**だった。PeerEdge・BlockEntity・DiffEvent の
    edgeAdded/edgeRemoved・BlockEntity.receivedAt はすべて既存定義のまま使えた。
  - **ChainAdapter インターフェースには subscribeBlocks が無い**。ブロック伝播は
    B層だが、shared の ChainAdapter は subscribePeers（B層）と subscribeChainEvents
    （C層 Phase 3）しか持たない。ブロック受信時刻の購読は EthereumAdapter の
    具象メソッド `subscribeBlocks()` として追加した（index.ts は具象型を参照して
    いるので shared 変更なしで済む）。将来 shared に B層のブロック購読を正式に
    加えるか要検討（reviewer と調整の余地）。
  - **receivedAt のマージは adapter 側で行う**。computeDiff の patch はトップレベル
    フィールド単位の置換なので、ノードごとに別々の receivedAt を投げると上書きで
    消えてしまう。BlockPropagationTracker が hash 単位でマージ済みの完全な
    receivedAt を毎回投げ、store はそれを丸ごと反映する形にした。
  - **collector はホストで直接動き、Docker ブリッジ上のコンテナ内部 IP に到達
    できる**前提。Beacon API（5052）も reth WS（8546）もホスト非公開ポートだが
    `http://<内部IP>:5052` / `ws://<内部IP>:8546` で直接叩ける。到達先 IP・ポートは
    Docker 観測値から組み立てる。
  - **subscribeBlocks は起動時に一度だけ EL ノードを列挙して永続 WS を張る**。
    ノード再起動で IP が変わった場合の再購読は未対応（Phase 2 デモの範囲では
    ノードは安定している前提）。必要になれば周期再列挙を足す。
  - テスト: 純粋ロジック（peers / blocks / targets / beacon-api / diff の edge /
    store の applyPeers・applyBlock）と adapter の pollPeersOnce・subscribePeers・
    subscribeBlocks をモック（HttpClient / EthWsClient / DockerPoller）で単体化。
    collector 全体で 180 テスト pass、`pnpm --filter @chainviz/collector build` /
    `test` 通過。加えて起動中の `profiles/ethereum` に対する実機スモークで、
    beacon1↔beacon2 の PeerEdge 検出と、12 ブロックすべてで reth1/reth2 両方の
    receivedAt が数 ms 差で記録されることを確認した。

### 2026-07-04 Issue #19・#20・#21 B層 collector 実装のテスト強化（異常系・境界値）
- 担当: tester
- ブランチ: issue-19-peer-edges-lighthouse
- 内容: collector 実装担当が書いた基本テスト（ハッピーパス中心、180件）に対し、
  異常系・境界値・想定外入力の観点でユニットテストを追加した（新機能の実装は
  行っていない）。collector 全体で 180 → 213 テストに増加し、build / test /
  該当ファイルの lint がすべて通ることを確認した。
  - `http-client.test.ts`（新規）: 実装担当が「IO 境界のためテスト対象外」と
    していた `createFetchHttpClient` を、グローバル fetch をスタブして検証。
    2xx で JSON を返す / 4xx・5xx で status 付きエラーを投げる / JSON パース失敗を
    伝播する / タイムアウトで AbortController が発火する / 期限内に解決した
    リクエストは abort しない、をカバー。
  - `beacon-api.test.ts`: `data` が null のケース、全ピア disconnected、
    peer_id が空文字列・非文字列（数値/null）のフィルタ、fetchConnectedPeerIds の
    エラー伝播を追加。
  - `targets.test.ts`: compose サービスラベルが無い lighthouse の除外、
    サービス名の大文字小文字非依存（"BEACON1"）、"beacon" を含むが execution
    クライアントの紛らわしいコンテナの除外、project prefix を持たない stableId
    からの networkId 導出、空観測セット、ラベル無しでも execution ノードを
    選ぶことを追加。
  - `peers.test.ts`: 空入力、networkId が報告元ノード由来であること、自己参照が
    実ピアに混在した場合の自己ループ除外、同一 peer_id を複数ノードが名乗った
    場合の後勝ち解決を追加。
  - `blocks.test.ts`: parseHexNumber の大文字 hex・bare "0x"、eviction 上限
    ちょうど（追い出し無し）、maxBlocks=1、既定 200 件境界、ノードが逆順時刻で
    報告してもノードごとに最初の受信時刻を保つケースを追加。
  - `diff.test.ts`（computeEdgeDiff）: from/to を入れ替えたエッジが別物として
    扱われること（無向化は生成側の責務）、入力の重複エッジが edgeKey で畳まれる
    ことを追加。
  - `store.test.ts`: 同一ブロック再適用で差分が出ないこと、receivedAt を 3 回に
    分けて追記したとき patch が receivedAt のみになること、applyPeers のエッジ
    churn がブロックエンティティを消さないことを追加。
- 決定事項・注意点:
  - **潜在バグ（collector へ差し戻し候補）**: 同一 from/to ペアで networkId
    だけが異なるエッジの遷移で、エッジが誤って消える。`edgeRemoved` イベントは
    shared スキーマ上 from/to のみを持ち（networkId を落とす）、store.applyEvent
    の edgeRemoved が from/to 一致で全エッジを削除するため。computeEdgeDiff は
    edgeAdded を先に emit するので、`applyPeers([net-a])` 後に
    `applyPeers([net-b])`（同一ペア）を適用すると、edgeAdded(net-b) の直後に
    edgeRemoved(from,to) が net-b ごと削除し、エッジが 0 本になる（本来 net-b が
    残るべき）。実運用では toPeerEdges が from/to ペア単位で dedup し、
    networkId はペアに対し決定的（`<project>-consensus`）なので、この遷移は
    project 名が変わるなどの稀ケースでのみ発生し、次ポーリングで自己回復する
    軽微な一過性の不整合。ただし diff/store の契約としては誤りなので、
    edgeRemoved に networkId を持たせる（shared 型変更 → reviewer 調整）か、
    store で edgeKey 一致による削除に変える修正を推奨。今回は再現テストのみ
    確認し、実装は変更していない（テストにも buggy 挙動を固定化しないよう
    エンコードしていない）。

### 2026-07-04 Issue #19〜#21 B層 collector 実装のレビューと edgeRemoved 型の修正
- 担当: reviewer
- ブランチ: issue-19-peer-edges-lighthouse
- 内容: collector 実装（#19〜#21）と tester のテスト強化を静的レビューした。
  ChainAdapter 境界（Beacon API・eth_subscribe・reth/lighthouse・ポート番号と
  いった Ethereum 固有語彙が `adapters/ethereum/` の内側に閉じ、world-state /
  shared にはチェーン非依存の型しか出ていない）、1ファイル1責務、循環依存
  なし、既存プロファイルへの分岐追加なし、をいずれも問題なしと確認。
  `pnpm lint` / `pnpm build` / `pnpm test` の全通過も確認した
  （collector 214・frontend 125・shared 全通過）。
- 修正（tester 報告の networkId バグへの対応）:
  - `packages/shared/src/events/index.ts` の `edgeRemoved` に
    `networkId: string` を必須フィールドとして追加した。エッジの同一性キーは
    from/to/networkId の 3 つ組（collector の `edgeKey()` と同義）なのに、
    削除イベントだけがキーの一部（networkId）を欠いており、同一ペア別
    networkId のエッジを巻き込んで消す契約上の欠陥だったため。frontend
    （#22）がこのイベントを消費し始める前の今が最小コストで直せる時点と判断。
  - `packages/collector/src/world-state/diff.ts` … `computeEdgeDiff()` が
    edgeRemoved に networkId を載せるよう修正。
  - `packages/collector/src/world-state/store.ts` … `applyEvent()` の
    edgeRemoved 処理を from/to/networkId の 3 条件一致に修正。
  - collector のテスト期待値を更新し、tester 報告の再現手順
    （`applyPeers([net-a])` → 同一ペアで `applyPeers([net-b])` でエッジが
    0 本になる）を退行防止テストとして `store.test.ts` に追加（213→214）。
  - `packages/frontend/src/world-state/store.test.ts` の edgeRemoved リテラル
    3 箇所に networkId を追記した（**型互換のための機械的変更のみ**。frontend
    の `applyDiff` が edgeRemoved / edgeAdded の一致判定に networkId を
    使っていない同種の問題は残っており、issue-22 ブランチ側で対応すること）。
  - `docs/ARCHITECTURE.md` §2 の DiffEvent スニペットを実装に同期した。
- 判断事項:
  - `subscribeBlocks()` を ChainAdapter インターフェースへ載せず
    EthereumAdapter の具象メソッドとした実装は**妥当**と判断。現状プロファイル
    は 1 つで、`index.ts` は具象型を配線しており、先回りのインターフェース
    拡張は CLAUDE.md「先の Phase のための先回り実装をしない」に反する。
    2 つ目のチェーンプロファイル追加（Phase 6）の際に `subscribeBlocks` /
    `dispose` の ChainAdapter への昇格を再検討する。
- 注意点（差し戻しはしないが後続で扱うべき事項）:
  - `WorldStateStore` はブロックエンティティを無制限に蓄積する
    （`BlockPropagationTracker` は 200 件で eviction するが store 側に上限が
    ない）。長時間運用でスナップショットとメモリが際限なく成長するため、
    store 側にもブロック保持上限を入れる後続 Issue を推奨。
  - `eth-ws-client` に再接続処理はなく、`subscribeBlocks` の対象列挙も起動時
    1 回のみ（collector の記録どおり。Phase 2 デモの範囲では許容）。

### 2026-07-04 Issue #19・#20・#21 B層P2Pグラフ（collector）実機検証
- 担当: qa
- ブランチ: issue-19-peer-edges-lighthouse
- 内容: 未コミットの collector 実装（Beacon API ポーリングによる PeerEdge 正規化、
  reth の eth_subscribe(newHeads) 購読によるブロック受信時刻記録、world-state
  store 経由の WebSocket 配信）を実環境で動かして検証した。
  - `profiles/ethereum` の全コンテナ起動を確認（reth1/reth2/beacon1/beacon2/
    validator1/validator2/workbench）。ホストから各コンテナIP経由で Beacon API
    (5052) と reth HTTP(8545) に到達可能なことを確認した。
  - `pnpm --filter @chainviz/collector build` および全体 `pnpm build` 成功。
  - `packages/collector/dist/index.js` を起動し、ポート4000で待ち受け・エラー
    ログなしを確認。
  - WebSocket クライアントで接続し、初回スナップショットの `edges` に
    beacon1↔beacon2 の PeerEdge（networkId=chainviz-ethereum-consensus）が
    含まれることを確認。
  - ブロック伝播タイミング: スナップショットの各 BlockEntity.receivedAt に
    reth1・reth2 両方の stableId がキーとして記録され、15ブロックすべてで
    2ノード分・3〜6ms の意味のある差分を持ち、先着ノードが reth1/reth2 で
    入れ替わる実データになっていることを確認。
  - `docker stop chainviz-ethereum-beacon2-1` で edgeRemoved が配信され、
    `docker start` で edgeAdded が再配信されることを確認。ピア消失中も
    collector はエラーを出さずグレースフルに継続した。
  - `pnpm lint && pnpm build && pnpm test` 全通過（collector 214 / frontend 125）。
- 判定: ステップ4のうち collector 側が担う完了条件「ノード同士がP2Pエッジで
  繋がる」「ブロック伝播タイミングの実データが取れている」を満たす。#19・#20・#21
  合格。frontend側統合（#22-25）は別ブランチで進行中のため対象外。
- 注意点: WORKLOG に既記載の後続事項（store側のブロック保持上限、
  eth-ws-client の再接続なし・購読対象の起動時1回列挙）は Phase 2 デモ範囲では
  許容と判断。検証上の問題は検出しなかった。

