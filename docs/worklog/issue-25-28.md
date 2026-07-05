# Issue #25-28 作業記録

### 2026-07-04 Issue #25 ブロック伝播パルスアニメーションの実装
- 担当: frontend
- ブランチ: issue-25-block-propagation-pulse
- 内容: collector が記録するブロックの受信実時刻（`BlockEntity.receivedAt`）を
  もとに、P2P エッジ上をパルス（光の点）が伝播していくアニメーションを実装した。
  - `packages/frontend/src/entities/blockPulse.ts` … タイミング計算の純粋関数群。
    `computeBlockPulses(block, edges)` が受信時刻差からエッジ単位のパルス区間
    （出発点/到達点・進行方向・波の起点 t0 からの出発遅延・所要時間）を算出する。
    `waveOriginTime` / `latestReceiptTime` / `isFreshBlock`、および描画中パルスを
    エッジの `data.pulses` へひも付ける `attachPulsesToEdges` もここに置く。
  - `packages/frontend/src/entities/useBlockPulses.ts` … world-state のブロック
    集合を監視し、新しい伝播区間を検知して実時間へスケジューリングするフック。
    純粋計算（blockPulse.ts）と React/タイマー側の責務を分離している。
  - `packages/frontend/src/entities/PeerPropagationEdge.tsx` … `data.pulses` を
    SVG の `animateMotion` でエッジ上に走らせる React Flow カスタムエッジ。
    通常時は `BaseEdge` で紐を1本描くだけ。
  - `peerEdge.ts` に `EdgePulse` 型と `PEER_EDGE_TYPE` を追加し、
    `peerEdgesToFlowEdges` の出力に `type: "peer"` を付与。Canvas に edgeTypes を
    登録。App でブロックを抽出→`useBlockPulses`→`attachPulsesToEdges`→Canvas と
    つないだ。styles.css にパルスの発光スタイルを追加。
- 決定事項・注意点:
  - **最低表示時間フロア（`MIN_PULSE_DURATION_MS = 450`）**: 実環境ではノード間の
    受信差が数 ms しかなく、そのままでは瞬間移動になり波に見えない。docs/CONCEPT.md
    の方針に従い、演出の誇張ではなく「実差分が知覚不能なときの UX 上の最低表示
    時間」としてフロアを設けた。実差分がフロアより大きければ実データの差分を
    そのまま使う（tc netem で実遅延が数百 ms 単位になれば実データが支配する）。
    フロアはあくまで下限で、上限キャップは設けていない（実データを尊重する）。
  - **伝播方向の決め方**: 各エッジについて receivedAt の早い側を出発点・遅い側を
    到達点とする。エッジは端点を [小, 大]（source=小, target=大）に正規化して
    いるため、大側が先に受信した場合は `reverse=true` として animateMotion を
    逆走させる。片側しか受信していないエッジは方向が確定しないためパルスを
    描かない。
  - **波のスタッガーの2経路**: 差分がノードごとに逐次届く場合は、collector から
    届くタイミングそのものが実際の伝播スタッガーになる。複数ノード分の受信が
    1回の差分にまとまって届く場合は、各区間の `startDelayMs`（波の起点 t0 からの
    出発遅延）を使ってブラウザ側でスタッガーを再現する（ブロック初回検知時の
    ブラウザ時刻を波の起点にアンカーする）。
  - **鮮度ガード（`DEFAULT_FRESHNESS_MS = 6000`）**: 再接続時のスナップショットに
    含まれる過去ブロックを一斉に光らせないよう、最新受信時刻が現在から 6 秒以内の
    ブロックだけをアニメーション対象にする。現在の block 集合から消えたハッシュの
    アンカー/既知エッジはフックが掃除する（メモリ肥大の防止）。
  - **`packages/shared` の型変更は不要だった**。`BlockEntity.receivedAt` が既に
    ノード安定ID→受信実時刻の Record を持っており、そのまま使えた。
  - テスト: `blockPulse.test.ts`（純粋関数のタイミング計算・方向・フロア・
    startDelay・attach）と `useBlockPulses.test.tsx`（fake timers による
    スケジューリング・重複排除・鮮度ガード・除去）を追加。frontend 全体で
    207 tests 通過、`pnpm build` も通過。
  - これでステップ4（Phase 2 B層）の全 Issue（#19〜#25）が完了。完了条件
    「ノード同士が P2P エッジで繋がり、ネットワーク単位でグルーピングされ、
    ブロック伝播タイミングで実データに基づくパルスがエッジ上を伝わる」を満たす。

### 2026-07-04 Issue #25 ブロック伝播パルスのテスト強化
- 担当: tester
- ブランチ: issue-25-block-propagation-pulse
- 内容: 実装担当が書いた基本テストに対し、異常系・境界値・特殊遷移の観点で
  ユニットテストを追加した（新機能の実装・ロジック変更はしていない）。
  frontend 全体で 207 → 229 tests（+22）に増え、全件通過・`pnpm build` 通過を確認。
  - `blockPulse.test.ts`（+17）:
    - `waveOriginTime` / `latestReceiptTime`: 負の epoch オフセット、単一受信、
      NaN 混入時の挙動（min/max が NaN に汚染されることの特性テスト）。
    - `isFreshBlock`: 鮮度境界の等値（ちょうど 6000ms は fresh／inclusive）、
      `maxAgeMs=0`、判定が `block.timestamp` ではなく受信時刻のみを見ること、
      NaN 受信を安全側（stale）に倒すこと。
    - `computeBlockPulses`: 受信ノード同士を繋ぐエッジが無いケース、対象外エッジ
      混在時に対象のみ抽出、波に無関係な受信ノードの無視、フロア境界の等値・
      直下、逆走エッジでの startDelay 併用、負の epoch、NaN 直接呼び出し時の
      durationMs=NaN（防御が無いことの特性テスト）。
    - `attachPulsesToEdges`: 存在しないエッジ向けパルスの破棄と参照維持、
      別ブロック由来のパルスが同一エッジに同居するケース。
  - `useBlockPulses.test.tsx`（+5, fake timers）:
    - 別ハッシュの 2 ブロックが同一エッジ上で同時にパルスを走らせるケース、
      ブロックが store から消えて再登場した際に掃除済みで再スケジュールされること、
      アンマウント時に保留タイマーが片付き後続の setState が起きないこと、
      NaN 受信ブロックが鮮度ガードで弾かれること、
      ブロック更新後にエッジが届いても再計算しない設計上の制約（deps=[blocks]）。
- 決定事項・注意点:
  - **NaN 受信の扱いは 2 段階**: `isFreshBlock` が NaN を含むブロックを stale と
    判定するため、`useBlockPulses` 経由ではパルス計算に到達せず安全。一方で
    `computeBlockPulses` を純粋関数として直接呼ぶと NaN が `durationMs` へ伝播し、
    `animateMotion` の `dur` が `"NaNms"` になりうる。現状 collector は `Date.now()`
    由来のため実害は無いが、純粋関数側にサニタイズが無い点は堅牢性の改善余地
    として frontend 担当に共有（バグではなく防御の未実装。今回は実装は変更せず
    特性テストで挙動を固定するに留めた）。
  - 既存テスト・実装ロジックは一切変更していない。

### 2026-07-04 Issue #25 ブロック伝播パルスの静的レビュー（NaN サニタイズ修正を含む）
- 担当: reviewer
- ブランチ: issue-25-block-propagation-pulse
- 内容: Issue #25 の実装（frontend）とテスト強化（tester）を静的にレビューした。
  - 設計整合: 最低表示時間フロア（450ms）は「実データの相対順序・比率を尊重し、
    実差分がフロアを超えればそのまま使う」実装になっており、docs/CONCEPT.md
    「ブロック伝播のリアルタイム表現」の方針（演出として誇張しない・実データに
    基づく波）と矛盾しない。上限キャップを設けず tc netem 導入時に実データが
    支配する点も CONCEPT.md の決定事項どおり。
  - 境界: frontend は `BlockEntity.receivedAt`（チェーン非依存スキーマ）だけを
    参照しており、Docker / ノード API への直接アクセスやチェーン固有語彙の
    ロジックへの漏れはない。責務分離（純粋計算 blockPulse.ts / スケジューリング
    useBlockPulses.ts / 描画 PeerPropagationEdge.tsx）も適切で、循環依存なし。
  - `packages/shared` の型変更不要の判断は妥当（`receivedAt:
    Record<nodeId, epoch ms>` が既に必要十分）。
  - tester 申し送りの NaN 問題は「修正すべき」と判断し、レビューの一環として
    blockPulse.ts に反映した: 有限数でない受信時刻（NaN / ±Infinity）を
    「未受信」として扱う（`finiteReceiptTimes` ヘルパーを追加し
    `waveOriginTime` / `latestReceiptTime` が非有限値を無視、
    `computeBlockPulses` が非有限値の端点を持つエッジをスキップ）。
    純粋関数を直接呼んでも `dur="NaNms"` が生成されなくなり、壊れた受信値が
    1つあっても健全なエッジの波は描かれ続ける（優雅な劣化）。
    挙動変更に伴い特性テスト3件を新契約のテストに置き換え、
    latestReceiptTime の非有限値・部分的破損時の波継続の2件を追加
    （frontend 229 → 231 tests）。なお `isFreshBlock` は
    「有限な受信が1つでも鮮度ウィンドウ内なら fresh」に変わるが、
    非有限値側のエッジは computeBlockPulses が弾くため安全性は保たれる。
  - blockPulse.ts のコメントにあったチェーン固有語彙「newHeads」を
    「ブロック受信実時刻」に改めた（ChainAdapter 境界の語彙規約に合わせる。
    コメントのみで動作変更なし）。
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過を確認
    （collector 214 / frontend 231）。
- 決定事項・注意点:
  - まだ未コミット。コミット時は関心事ごとに分けること（実装 / テスト強化 /
    レビュー修正、少なくとも3コミット。docs 更新の扱いは規約に従う）。
  - 動作検証（実際にパルスが波として見えるか、再接続時に過去ブロックが
    光らないか）は chainviz-qa に委ねる。

### 2026-07-04 Issue #28 reth(EL)のブロック受信時刻をbeacon(CL)のstableIdへ対応付け（テスト強化）
- 担当: tester
- ブランチ: issue-25-block-propagation-pulse
- 内容: collector 側 #28 実装（`targets.ts` の `serviceNodeKey` /
  `beaconStableIdForExecution` / `ExecutionTarget.receivedAtKey`、
  `index.ts` の `subscribeBlocks` が `receivedAtKey` で記録）に対し、
  異常系・境界値・クロス汚染の観点でユニットテストを追加した
  （collector 221 → 233 tests）。実装コードは変更していない。
  - `targets.test.ts`（+9）:
    - `executionTargets`: 対応 beacon を持つ reth と持たない reth の混在で
      後者が自身の stableId にフォールバックしクロス汚染しないこと、全 reth が
      フォールバックする構成、非 reth（geth）でも beacon へ対応付くこと。
    - `beaconStableIdForExecution`: サフィックス無し reth が番号付き beacon を
      誤って掴まないこと、役割プレフィックスの大文字小文字非依存な剥離、
      数字以外のノード群キー（reth-a / beacon-a）での一致、observations 空配列、
      サービスラベル欠落の beacon 候補を飛ばすこと、同一ノード群キーの beacon が
      複数（別プロジェクト）ある場合は観測順で最初を返すこと。
  - `peer-block-adapter.test.ts`（+3、`gethFixture` 追加）:
    - beacon 皆無の EL only 構成で各 reth 自身のキーに束ねられること、
      beacon 対応 reth と非対応 reth が 1 ブロックの receivedAt に混在すること、
      2 つの execution（reth1 / geth1、ノード群キーがともに "1"）が同一 beacon に
      対応付く場合に receivedAt が 1 キーへ畳まれ初回受信時刻のみ残ること。
- 決定事項・注意点:
  - `beaconStableIdForExecution` はノード群キー（サービス名から役割プレフィックス
    を剥がした残り）だけで対応を取り、stableId のプロジェクト接頭辞を見ない。
    このため別プロジェクトに同名 beacon サービス（例: `beacon1`）が同時に存在
    すると観測順で最初にヒットした beacon を返す（クロスプロジェクト対応の
    可能性）。単一チェーンプロファイル運用では問題にならないが、複数プロファイル
    を同時に観測する構成を将来入れる場合は要注意。現時点ではバグではなく
    仕様上の制約として特性テストで挙動を固定した。
  - 同様に、ノード群キーが衝突する 2 つの execution（reth1 と geth1 など）が
    同一 beacon に対応付くと、`BlockPropagationTracker` のキーごと初回優先と
    相まって receivedAt が 1 キーに畳まれ片方のノードの受信時刻が失われる。
    通常構成（1 ノード群 = 1 EL + 1 beacon）では発生しないが、記録キーが
    論理ノード単位である以上の粒度差が生じる点を明示するテストを残した。
  - まだ未コミット。frontend 側 #25 の未コミット変更とは独立。
  - build（tsc -b）・collector 全 233 tests 通過を確認済み。

### 2026-07-04 Issue #28 reth→beacon ID対応付け修正の静的レビュー（#25との統合整合確認を含む）
- 担当: reviewer
- ブランチ: issue-25-block-propagation-pulse
- 内容: collector 側 #28 修正（`targets.ts` の `serviceNodeKey` /
  `beaconStableIdForExecution` / `ExecutionTarget.receivedAtKey`、`index.ts` の
  `subscribeBlocks`）と、tester の強化テストを静的にレビューした。コードの
  変更はしていない（本レビューでの修正なし）。
  - **境界の遵守**: reth/beacon の対応付け（compose サービス名から役割
    プレフィックスを剥がすノード群キーの導出を含む）は Ethereum 固有の知識
    として `adapters/ethereum/targets.ts` の中に閉じている。`packages/shared`
    や frontend にチェーン固有語彙の漏れはない。`BlockEntity.receivedAt` の
    キーは beacon の stableId（= NodeEntity.id）になり、ARCHITECTURE.md §2 の
    「`Record<nodeId, epoch ms>`」の記述とも引き続き整合する（docs 更新不要）。
  - **#25 との統合整合**: frontend の `computeBlockPulses` は
    `receivedAt[edge.source]` / `receivedAt[edge.target]` を引く。PeerEdge の
    端点は `peers.ts` が beacon の stableId で生成しており、#28 により
    receivedAt のキーも同じ beacon stableId に揃うため、ID 空間が一致し
    パルス算出が成立する。フォールバック時（対応 beacon 不在）は reth 自身の
    stableId になるが、これも NodeEntity.id であり型・スキーマ上の矛盾はない
    （その場合エッジ端点と一致せずパルスが出ないだけで、安全側に倒れる）。
  - **プロファイル整合**: `profiles/ethereum/docker-compose.yml` のサービス名
    （reth1/beacon1/validator1、reth2/beacon2/validator2）に対しノード群キー
    導出が正しく機能することをテストで確認済み。
  - **テストの質**: targets.test.ts（+9）・peer-block-adapter.test.ts（+3）は
    フォールバック・クロス汚染防止・大文字小文字・非数値キー・ラベル欠落・
    観測順依存などの異常系/境界値を実挙動ベースで検証しており、実装を
    なぞるだけの無意味なテストはない。
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過
    （collector 233 / frontend 231）。
- 決定事項・注意点:
  - tester 申し送りの 2 点は、現 Phase（単一 Ethereum プロファイル運用）の
    スコープでは**許容**と判断した:
    1. クロスプロジェクト対応の可能性（別プロジェクトの同名 beacon を観測順で
       掴む）は、そもそも DockerPoller がホスト上の全コンテナを無差別に観測して
       おり、プロジェクトによるスコープ制御は `beaconStableIdForExecution` 単独
       ではなく collector 全体の課題。この関数だけ直しても複数プロファイル同時
       観測は成立しないため、先回り修正はせず特性テストで挙動を固定した現状を
       是とする。複数プロファイル観測（Phase 6 以降など）に着手する際は、
       stableId のプロジェクト接頭辞（または compose project ラベル）の一致を
       条件に加えること。
    2. ノード群キーが衝突する 2 つの EL が同一 beacon に対応付くケース
       （receivedAt が 1 キーに畳まれる）は、想定構成（1 論理ノード = 1 EL +
       1 beacon）では発生しない。特性テストで挙動が固定されており許容。
  - まだ未コミット。コミット時は関心事ごとに分けること（少なくとも
    #25 実装 / #25 テスト強化 / #25 レビュー修正（NaN サニタイズ）/
    #28 collector 修正 / #28 テスト強化 の 5 つ。WORKLOG の追記は対応する
    変更のコミットに含めてよい）。
  - 実際にパルスが beacon 端点間で描画されるかの動作検証は chainviz-qa に
    委ねる。

### 2026-07-04 Issue #25・#28 ブロック伝播パルスの動作再検証（合格）
- 担当: qa
- ブランチ: issue-25-block-propagation-pulse
- 内容: #28（reth→beacon の stableId 対応付け修正）を取り込んだ状態で、
  前回不合格だった #25（ブロック伝播パルス）の実環境動作を再検証した。
  判定は合格。ステップ4（Phase 2 B層）の完了条件を全体として満たすことを確認した。
  - 前提: `profiles/ethereum` は起動中でチェーンが進行中（block 4168→4170 を
    cast で確認）。
  - collector をビルドしポート4000で起動、WebSocket クライアントで接続して
    配信内容を確認:
    - block エンティティの `receivedAt` のキーが
      `chainviz-ethereum/beacon1` / `chainviz-ethereum/beacon2`（beacon の
      stableId）になっていることを確認。前回は reth の stableId になっており
      PeerEdge 端点と交わらずパルスが描画されなかった。#28 の修正で解消。
    - snapshot payload の `edges` に
      `{kind:"peer", fromNodeId:"chainviz-ethereum/beacon1",
      toNodeId:"chainviz-ethereum/beacon2", networkId:"chainviz-ethereum-consensus"}`
      が1本あり、端点が `receivedAt` のキーと一致（ID空間が交わる）ことを確認。
    - 両 beacon の受信時刻に実データ由来の差（例: 505036ms vs 505040ms）があり、
      伝播タイミングの差分としてパルスに反映できる状態であることを確認。
  - このブランチの frontend を `VITE_COLLECTOR_URL=ws://localhost:4000` で起動し、
    Playwright（Chromium）でブラウザ相当の動作を検証:
    - beacon1↔beacon2 を結ぶ P2P エッジ1本が描画される
      （edge id: `peer-...::beacon1::beacon2`）。
    - 新しいブロックが到達するたびに `animateMotion` 付きの `<circle>`（r=4,
      dur=450ms）がエッジ上に出現し、ブロック間では消える挙動を繰り返し観測
      （約15秒の観察で複数回のパルス発生を確認）。circle の画面座標が
      エッジ上で変化しており、パルスがパスに沿って移動していることを確認。
    - コンソールエラーは favicon の 404 が1件のみで、response リスナーでは
      再現せず機能に影響なし。
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過
    （collector 233 / frontend 231）。
- 決定事項・注意点:
  - beacon1 と beacon2 のカードがデフォルトレイアウトで隣接配置されるため、
    両者を結ぶエッジが短く（画面上で約13px）、パルスの移動距離は視覚的に
    小さい。パルス機能自体は正しく動作しており、これはノード配置（キャンバス
    上でドラッグして離せる）に依存する見た目の問題。将来デフォルト配置を
    調整するとより見やすくなる。
  - 検証後、起動した collector / vite プロセスは停止しクリーンな状態に戻した。

