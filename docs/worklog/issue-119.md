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
