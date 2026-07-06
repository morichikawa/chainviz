### 2026-07-06 Issue #119 定期更新のたびにノードカードが一瞬ちらつく(React Flowの再計測サイクル)
- 担当: frontend
- ブランチ: issue-119-node-flicker
- 内容:
  - 症状の再現: Playwright + `requestAnimationFrame` で `.infra-card` / ウォレットカード
    の親 `.react-flow__node` の computed style を高頻度サンプリングし、
    `pnpm dev`(モックデータ)起動中に `visibility` が周期的に `hidden` → `visible`
    を繰り返すことを実際に確認した。データが一切変わらないカード(モックの
    `lighthouse-1`、`bobWallet` 等)でも発生することを確認し、「ワールドステートの
    実データが変わったから再描画される」のではなく、無関係な更新のたびに
    ノードオブジェクトが作り直されることそのものが原因であると特定した。
  - 根本原因の特定: `@xyflow/system` の `adoptUserNodes`(ノード配列を React Flow
    の内部ストアへ取り込む処理)は、渡されたノードオブジェクトの参照が前回と
    同一かどうかで「計測結果(`measured`: width/height)を引き継げるか」を判定する。
    参照が変わると `measured` を `{width: undefined, height: undefined}` にリセット
    してから ResizeObserver で再計測するため、その間 `NodeWrapper` は
    `visibility: hidden` を出す。
    `packages/frontend/src/canvas/Canvas.tsx` は親(`App.tsx`)から受け取った
    `nodes` プロパティが変わるたびに `setRfNodes(nodes)` で React Flow に渡す
    ノード配列をまるごと入れ替えていたが、この `nodes` には React Flow 自身が
    書き戻した `measured` が含まれていない(`App.tsx` 側は関知しない情報のため)。
    そのため、ワールドステート更新(3秒間隔の tick/ポーリング、または tx 確定
    フラッシュ演出のタイマー等、内容に関係のない更新も含む)のたびに、変化して
    いないカードまで `measured` が失われ再計測サイクルに入っていた。
  - 検証の過程で、当初想定していた「`entitiesToFlowNodes`/`walletsToFlowNodes` が
    毎回新しいノードオブジェクトを作ること自体」を直しただけ(内容が同じ
    entity なら同一参照を返すようにする)では、Canvas.tsx の `setRfNodes(nodes)`
    がノード配列をまるごと入れ替える構造である限り、React Flow 側が
    `measured` を蓄積している内部状態(`rfNodes`)と親から渡された配列が
    乖離し続けるため、ちらつきは解消しないことを実測で確認した(fixした
    つもりで実際に `pnpm dev` + Playwright で再現できず→原因を追加調査、という
    手順を踏んだ)。
  - 最終的な修正は2段構え:
    1. **本質的な対策**(`packages/frontend/src/entities/canvasNode.ts` の
       `preserveMeasuredDimensions` + `packages/frontend/src/canvas/Canvas.tsx`):
       親から渡された最新の `nodes` を React Flow へ反映する直前に、Canvas が
       直近まで保持していた `rfNodes`(React Flow 自身が計測して book-keeping
       した `measured` を含む)から id ベースで `measured` を引き継ぐ。これに
       より、ノードオブジェクトの参照が変わっても `measured` が失われず、
       再計測(≒ちらつき)が起きなくなる。
    2. **補完的な最適化**(`packages/frontend/src/entities/nodeStability.ts`
       の `stabilizeNodes` + `infraNode.ts`/`walletNode.ts` の
       `isSameInfraNode`/`isSameWalletNode` + `App.tsx`): ワールドステートの
       エンティティ自体に変化がなければ `entitiesToFlowNodes`/
       `walletsToFlowNodes` の出力ノードオブジェクトも前回と同一参照を再利用
       するようにし、無関係な更新のたびに全ノードを作り直す無駄を減らした。
       こちらは (1) が無くても (1) 単体で十分ちらつきは直るため必須ではない
       補完策だが、React 側の不要な再レンダーを避けられるため実装した。
  - 修正後、同じ手順(Playwright + 高頻度サンプリング、修正前後の両方を
    `pnpm dev` を再起動して比較)で、インフラカード(データが変化しない
    `lighthouse-1`・毎tick変化する `reth-node-1` の両方)・ウォレットカード
    (データが変化しない Bob・毎tick変化する Alice の両方)のいずれも、
    12秒間のサンプリングで `visibility` が `hidden` になることが無くなった
    ことを確認した。
- 決定事項・注意点:
  - `preserveMeasuredDimensions` は id が一致し、かつ次のノード自身が
    まだ `measured` を持っていない場合にだけ前回の値を引き継ぐ(次のノード
    側が既に `measured` を持っていればそちらを優先し、新規ノードには何も
    付与しない=通常の初回計測に任せる)。
  - `stabilizeNodes`(`nodeStability.ts`)は React Flow 固有の型
    (`@xyflow/react` の `Node`)に依存する汎用のノード配列安定化ヘルパーとして
    切り出した。`isSameInfraNode`/`isSameWalletNode` は各エンティティの
    ドメイン知識(何が変われば見た目が変わるか)を持つ比較関数として、それぞれ
    `infraNode.ts`/`walletNode.ts` に置いた。
  - 調査時、React Flow(`@xyflow/react`)・その依存(`@xyflow/system`)の
    ソース(`node_modules` 配下)を読んで `adoptUserNodes`/`NodeWrapper` の
    実装を直接確認した。今後同種の「参照が変わると内部状態がリセットされる」
    系の不具合を調べる際の参考になる。
  - 動作確認には Playwright(Chromium)を使ったが、このサンドボックス環境では
    `pnpm dlx playwright install` の展開(zip解凍)が io_uring 関連と思われる
    理由で無限に停止する事象があった。ダウンロード自体は完了していたため、
    `python3 -m zipfile` で手動展開し `INSTALLATION_COMPLETE` マーカーを置く
    ことで回避した。また `libnspr4.so`/`libnss3.so` 等の共有ライブラリが
    システムに無く起動できなかったため、`.deb` を `dpkg-deb -x` で展開し
    `LD_LIBRARY_PATH` で読ませて回避した(この環境固有の対処であり、
    プロダクトコードには影響しない)。

### 2026-07-06 テスト強化(異常系・境界値)
- 担当: tester
- ブランチ: issue-119-node-flicker
- 内容: 実装担当が書いた基本テストに、異常系・境界値・特殊遷移の観点で
  ユニットテストを追加した(実装は変更していない)。合計25件追加。
  - `entities/canvasNode.test.ts`(`preserveMeasuredDimensions`、6件追加):
    next 配列の並び順維持、前回に一致 id がある要素にだけ measured を付ける
    (新規ノードは触らない)、next 側の measured が部分的(width のみ・height 欠落)
    な場合に前回の完全な measured で置き換える、同一 id が削除→再追加されたとき
    stale な measured を引き継ぐ挙動の明文化、同一 id で type が変わる異常
    ケースでも id ベース突き合わせが安全に動く、infra/wallet 混在配列で id ごとに
    measured を引き継ぐ。
  - `entities/nodeStability.test.ts`(`stabilizeNodes`、5件追加):
    追加・削除・更新が同一 tick で混在するケース、長さが同じでも id が入れ替わった
    場合に前回配列を誤って返さない、長い配列の中間要素が変化したときの新参照、
    内容不変ノードが index 移動したときの参照再利用と配列新参照、削除のみでも
    配列は新参照になる。
  - `entities/infraNode.test.ts`(`isSameInfraNode`、6件追加):
    x のみ/y のみ変化の検出、position を値比較する(別オブジェクト同値なら同一)、
    resources のような入れ子フィールドの変更を store の新 entity 参照経由で
    検出できる(浅い比較で深い変更を見逃さない)、同一 entity 参照のときのみ
    同一と判定する(参照ベースであることの明文化)。
  - `entities/walletNode.test.ts`(`isSameWalletNode`、8件追加):
    x のみ/y のみ変化の検出、position の値比較、内容が同じでも tx 要素の参照が
    変われば変化として検出、transactions の長さ変化の検出、transactions と
    settlingHashes の並び替えを変化とみなす(順序依存)、balance のような
    entity フィールド変更を新 entity 参照経由で検出。
- 決定事項・注意点:
  - `isSameInfraNode`/`isSameWalletNode` は entity を参照比較する設計のため、
    「深い内部フィールドの変更」は WorldState 側が変更時に必ず新しい entity
    オブジェクトを作る(参照が変わる)という契約に依存して検出している。
    仮に store が同一参照のまま内部を書き換える実装になると変更を取りこぼす
    ため、その契約が崩れないことが前提であることをテストのコメントに明記した。
  - `preserveMeasuredDimensions` は純粋関数として id のみで突き合わせるため、
    同一 tick 内で同じ id が削除→再追加された場合は旧ノードの measured を
    引き継ぐ。実運用では削除と再追加が別 tick に分かれ、その時点の previous
    (Canvas の rfNodes)に当該 id が無いため問題にならない。この境界挙動を
    テストで固定した。

### 2026-07-06 静的レビュー(査読)
- 担当: reviewer
- ブランチ: issue-119-node-flicker
- 判定: **合格**
- 確認した内容:
  - **store の参照契約**: `packages/frontend/src/world-state/store.ts` の
    `applyDiff` は `entityUpdated` で必ず `{...existing, ...event.patch}` と
    新しいオブジェクトを作り、`entityAdded` も受信イベント由来の新オブジェクトを
    格納する。エンティティをその場で書き換える(同一参照のまま内容を変える)
    箇所は frontend パッケージ全体を grep して存在しないことを確認した。
    実 WebSocket 経路は JSON デシリアライズで毎回新オブジェクトになり、
    モック(`websocket/mockData.ts`)も毎 tick 新しい patch オブジェクトを
    生成するため、`isSameInfraNode`/`isSameWalletNode` が依存する
    「内容が変わったら参照も変わる」契約は両経路で成立している。
    なお内容が変わらない patch でも新参照になるが、これは「更新を取りこぼす」
    方向ではなく「余分に再生成する」方向の誤差であり安全側。
  - **stale measured の安全性**: `@xyflow/react`(12.11.1)のソースを確認し、
    ノードの DOM 要素には ResizeObserver が張られ続けており、実サイズが
    変わればその時点で dimension change → `onNodesChange` →
    `applyNodeChanges` で `measured` が更新されることを確認した。
    `preserveMeasuredDimensions` が引き継ぐ値は「再計測までの初期値」で
    しかなく、サイズが実際に変わるケースでも自己修正される。tick をまたぐ
    削除→再追加では Canvas の `rfNodes` から当該 id が消えているため
    stale 値の引き継ぎ自体が起きない。
  - **修正機構の妥当性**: `@xyflow/system`(0.0.78)の `adoptUserNodes` を
    確認し、参照が変わったノードでも `userNode.measured` があればそれを
    内部ノードに採用し `nodesInitialized` が保たれる(=hidden 化しない)
    ことをソースで裏付けた。
  - **パフォーマンス**: `stabilizeNodes` は Map 構築込みで O(n)。比較関数は
    インフラカードが O(1)、ウォレットカードが直近 tx 件数分の参照比較のみで、
    エンティティ数の増加に対して線形。毎 tick 全ノードを新規生成していた
    従来と比べ増分は無視できる。
  - **テストの実効性**: ミューテーションテストで確認した。
    (1) `preserveMeasuredDimensions` を素通しにする → canvasNode.test.ts 失敗、
    (2) `stabilizeNodes` を素通しにする → 11件失敗、
    (3) `isSameInfraNode` の position 比較を外す → 3件失敗、
    (4) `isSameWalletNode` の transactions 比較を外す → 4件失敗。
    いずれも検出でき、テストは実装を壊せば落ちる実効的なものである。
    確認後はすべて元に戻し、作業ツリーがクリーンであることを確認した。
  - **品質ゲート**: `pnpm lint` / `pnpm build` / `pnpm test`(frontend 539件
    含む全パッケージ)がすべて通ることを確認した。
  - **エラー握りつぶし・固定値**: 今回の変更に catch 節は無く、環境状態に
    依存した決め打ち定数も無い(純粋関数と ref によるメモ化のみ)。
  - **docs との整合**: ARCHITECTURE.md はフォルダ構成・スキーマ・プロトコルの
    粒度で書かれており、今回の変更(frontend 内部の描画最適化)は境界・
    スキーマ・プロトコルのいずれにも影響しないため反映不要と判断した。
    経緯の詳細は本 worklog に十分記録されている。
  - **コミット粒度**: 5コミット(本質的対策 fix / 補完的最適化 perf /
    実装 worklog docs / テスト強化 test / テスト worklog docs)で、
    いずれも単一の関心事に収まっており Conventional Commits 形式。
- 軽微な指摘(非ブロッキング、次回改善で可):
  - `sameByReference` が `entities/nodeStability.ts`(export、ただし
    プロダクションコードからは未使用でテストのみが参照)と
    `entities/walletNode.ts`(private で同一実装を重複定義)の2箇所にある。
    walletNode.ts が nodeStability.ts から import するか、未使用 export を
    整理するのが望ましい。動作には影響しない。
  - `App.tsx` の `useMemo` 内で `previousInfraNodesRef.current = next` と
    ref を書き換えるのはレンダーフェーズの副作用であり、React の並行
    レンダリングで破棄されたレンダーの結果が ref に残り得る。ただし
    再利用されるオブジェクトは内容が同一のものに限られ、本質的対策
    (preserveMeasuredDimensions)はこれに依存しないため実害は無い。

### 2026-07-06 実機検証(QA)
- 担当: qa
- ブランチ: issue-119-node-flicker
- 判定: **合格**
- 検証手順と結果:
  - `pnpm dev`(VITE_COLLECTOR_URL 未設定=モッククライアント)で frontend を
    起動し、Playwright(chromium)で `http://localhost:5199/` を開いて
    `.react-flow__node` の computed style を `requestAnimationFrame` で
    16秒間・961フレーム高頻度サンプリングした。全ノード(lighthouse-1、
    reth-node-1、reth-node-2、workbench-alice、スマートアカウント、
    Alice EOA、Bob EOA)について `visibility:hidden` / `display:none` /
    `opacity:0` になったフレームは 0 件で、ちらつきが解消されていることを
    実測で確認した。モックは3秒間隔でブロック高と tx ライフサイクルを
    進めるため、サンプリング中に5回程度の tick が発生しているが、
    毎tick underlying entity が作り直される reth-node-1 や Alice EOA を
    含めて一度も hidden にならなかった。
  - サンプリング手法が実際に hidden を検出できることを負のコントロールで
    確認した(あるノードに強制的に `visibility:hidden` を設定し、同じ
    getComputedStyle 判定で検出できることを確認)。したがって上記の
    「hidden 0件」は検出漏れではなく真に発生していないことを意味する。
  - 参照安定化で更新が止まっていないことを確認した。Alice EOA カードは
    16秒間で残高 5.0000→4.9998 ETH、nonce 3→8、直近 tx リストに新しい
    `0xfeed…` ハッシュが5件反映されるなど、データ変化が正しく見た目に
    反映されていた。変化しないカード(lighthouse-1、Bob EOA、スマート
    アカウント、workbench-alice)はテキストが不変で正しい。
  - reth のインフラカード券面は仕様上 blockHeight を表示せず(表示は
    ホバー時の InfraPopover のみ)コンテナ名・クライアント種別・sync
    状態のみのため、reth カードのテキストが tick で変化しないのは正しい
    挙動であり回帰ではない。
  - `pnpm lint` / `pnpm build` / `pnpm test` を全パッケージで実行し、
    lint はクリーン、build は shared/collector/frontend/e2e すべて成功、
    test は frontend 539件・collector 584件を含め全て pass した。
- 備考:
  - この環境では Playwright ブラウザに必要な共有ライブラリ
    (libnspr4/libnss3 等)が未インストールのため、既存の展開済みライブラリを
    `LD_LIBRARY_PATH` で読ませて chromium を起動した(環境固有の対処であり
    プロダクトコードには影響しない)。
