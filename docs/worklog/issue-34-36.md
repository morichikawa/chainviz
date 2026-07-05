# Issue #34-36 作業記録

### 2026-07-04 Issue #34 追加ノードの EL P2P 対応(elpeer)の再レビュー

- 担当: reviewer
- ブランチ: issue-34-add-remove-node
- 内容: Issue #44(EL 間 P2P)・#46(lighthouse-bn.sh 修正)の main マージを
  受けて collector が行った追随変更(`rethSpec` への `RETH_ROLE=peer` /
  `RETH_P2P_IP` 付与、`elpeer` ボリュームの ro マウント、
  `EthereumNodeLifecycleConfig` への `elpeerVolume` 追加)を静的レビューした。
  - `reth-node.sh`(RETH_ROLE の解釈・`/elpeer/boot.enode` の待機)および
    docker-compose.yml の reth2(peer)の構成と一致しており、#44 レビュー時に
    連携事項として挙げた 3 点(RETH_ROLE / RETH_P2P_IP / elpeer:ro)を
    過不足なく満たす。beaconSpec の clpeer(BEACON_ROLE=peer + ro マウント)
    パターンとも一貫している。
  - ボリューム既定値 `chainviz-ethereum_elpeer` は compose プロジェクト名
    (`name: chainviz-ethereum`)から導出される実名と一致する。
  - `node-lifecycle.test.ts` に elpeer マウント・RETH_ROLE・RETH_P2P_IP の
    assertion が追加されており妥当。`pnpm lint` / `pnpm build` / `pnpm test`
    はリポジトリ全体で成功(collector 319 件・frontend 231 件)。
  - 前回レビューの残件(addWorkbench のラベル重複、レジストリのインメモリ性、
    resolveProfileDir のテスト不足)への新たな影響なし。removeNode の
    部分失敗対応(前回修正済み)にも変更なし。docs(CONCEPT.md のファイル共有
    方式の記述・ARCHITECTURE.md §3 の Command 型)との齟齬なし。
- 決定事項・注意点:
  - WORKLOG の collector エントリ(#34)に「追加ノードのブロック追従の
    エンドツーエンド確認まではできなかった」という記述が残っているが、
    今回の追随変更後に collector 担当が実機でブロック追従(reth1 と歩調一致)を
    確認済みであり、この記述は古い。コミット前に collector 担当が elpeer
    追随変更と実機確認結果のエントリを追記(または既存エントリを更新)すること。

### 2026-07-04 Issue #34・#35・#36 ノード/ワークベンチ追加・削除の静的レビュー(reviewer)
- 担当: reviewer
- ブランチ: issue-34-add-remove-node
- 内容: collector 側実装(#34・#35・#36)とテスト強化の静的レビューを実施した。
  境界の遵守・観測側コードとの整合・テストの質を確認し、tester が報告した
  removeNode の設計上の穴を修正した。
  - **レビュー結果(問題なしと確認した点)**:
    - ChainAdapter 境界: コンテナ構成の知識(イメージ・IP 帯・ボリューム・
      環境変数)は `adapters/ethereum/node-lifecycle.ts` に閉じており、
      `commands/`・`server/`・`docker/operations.ts` はチェーン非依存の語彙のみ。
      `packages/shared` の変更は不要(Command 型は設計フェーズ定義のままで
      docs/ARCHITECTURE.md §3 と一致)という判断も妥当。
    - compose 互換ラベル(project/service=reth<n>/beacon<n>)は observe.ts の
      `computeStableId`、targets.ts の `serviceNodeKey`(reth3/beacon3 → "3")、
      classify.ts の判定と整合する。IP 採番(172.28.1.n / 172.28.2.n、n>=3)は
      compose の固定 IP・ゲートウェイと衝突しない。
    - beacon の起動環境変数(BEACON_ROLE=peer / ENR_ADDRESS /
      EXECUTION_ENDPOINT)・ボリューム名・ネットワーク名は
      profiles/ethereum/docker-compose.yml と一致。
    - 循環依存なし。lint / build / test はリポジトリ全体で成功。
      tester 追加分のテストは異常系・境界値を実質的に検証しており妥当。
  - **修正(tester 指摘の removeNode の穴)**: `removeNode` がレジストリから
    先に splice してから削除する実装だと、consensus の削除失敗時に execution
    コンテナが孤立して再試行不能になり、実装コメント(再試行できるよう先に
    登録を外す)とも矛盾していた。以下のとおり修正した。
    - `node-lifecycle.ts`: removeNode / removeWorkbench とも「削除がすべて
      成功してから登録を外す」順序に変更。失敗時は登録が残るため同じ ID で
      再実行してリトライできる。
    - `dockerode-operations.ts`: `stopAndRemove` が remove の 404(既に削除
      済み)を成功扱いするよう修正。`operations.ts` の契約「既に停止・削除
      済みでも失敗しない」と実装が食い違っており、部分失敗後のリトライで
      削除済みコンテナへの再 stopAndRemove が永久に失敗する経路が残るため。
    - テスト 4 件追加(リトライで削除を完遂できること×ノード/ワークベンチ、
      途中失敗後の残り削除、remove 404 の成功扱い)。collector 315 → 319 件。
- 決定事項・注意点:
  - **軽微な指摘(今回は未修正。後続で対応を検討)**:
    1. addWorkbench のラベルが compose の既存 service 名と同じ場合
       (空ラベルの既定値 "workbench" が該当)、初回はコンテナ名衝突で失敗
       するが、リトライすると連番付きの名前で作成に成功し、compose 側
       ワークベンチと同じ安定 ID(chainviz-ethereum/workbench)が重複し得る。
       ラベルの一意化がレジスト済みワークベンチとの比較のみで、実際に
       動いているコンテナ(compose 起動分・collector 再起動前の追加分)を
       考慮していないため。フロント(#37)のラベル入力仕様と合わせて対応したい。
    2. 追加ノード/ワークベンチのレジストリはインメモリのため、collector を
       再起動すると追加済みコンテナが削除不能になる(removeNode がエラーを
       返す)。当面の制約として QA・フロント担当は把握しておくこと。
    3. `index.ts` の `resolveProfileDir`(環境変数上書き+パス導出)に対応する
       ユニットテストが無い。

### 2026-07-04 Issue #34・#35・#36 キャンバスからのノード/ワークベンチ追加・削除(collector側)
- 担当: collector
- ブランチ: issue-34-add-remove-node
- 内容: フロントからの操作コマンド(addNode / removeNode / addWorkbench /
  removeWorkbench)を collector が実処理するよう実装した。従来
  `websocket-server.ts` の onMessage はどのコマンドにも未実装エラーを返す
  スタブだったのを、コマンドディスパッチ層と Ethereum 固有のノード
  ライフサイクル層に配線した。
  - `packages/collector/src/docker/operations.ts` … コンテナのライフサイクル
    操作(作成起動・停止削除・ネットワークの使用中 IP 照会)のチェーン非依存な
    抽象 `DockerOperations`。観測用の `DockerClient`(types.ts)とは別の関心事
    として分離した。
  - `packages/collector/src/docker/dockerode-operations.ts` … 上記を dockerode で
    実装。`ContainerSpec` → dockerode の createContainer 引数への変換
    (`toCreateOptions`)、network.inspect() からの使用中 IP 収集
    (`collectNetworkIps`)を含む。dockerode 依存はこのファイルに閉じ込める。
  - `packages/collector/src/commands/lifecycle.ts` … コマンドが最終的に呼ぶ
    チェーン非依存のポート `NodeLifecycle` と結果型 `CommandResult`。
  - `packages/collector/src/commands/handler.ts` … `CommandHandler`。Command を
    NodeLifecycle の各操作へディスパッチし、例外を commandResult のエラーへ変換
    する(handle 自体は throw しない)。
  - `packages/collector/src/adapters/ethereum/node-lifecycle.ts` …
    `EthereumNodeLifecycle`。reth / lighthouse beacon / Foundry ワークベンチの
    コンテナ構成(イメージ・エントリポイント・環境変数・ボリューム・IP 帯)という
    Ethereum 固有の知識をここに閉じ込める。新規ノードは「バリデーターなしの
    フォロワー reth + beacon ペア」として追加し、追加したコンテナを内部レジストリ
    で管理する。
  - `websocket-server.ts` を `CommandProcessor` を受け取ってコマンドを
    ディスパッチするよう変更。`index.ts` で dockerode の DockerOperations →
    EthereumNodeLifecycle → CommandHandler → CollectorServer を配線。
- 決定事項・注意点:
  - **追加コンテナには compose 互換ラベル(project=chainviz-ethereum,
    service=reth&lt;n&gt;/beacon&lt;n&gt;)を付ける**。これにより観測側の
    `computeStableId` が既存ノードと同じ `chainviz-ethereum/&lt;service&gt;` 形式の
    安定 ID を割り当て、ネットワークのグルーピング・ピアエッジ・ブロック伝播の
    対応付け(targets.ts の役割プレフィックス剥がし)が既存ノードと同様に機能する。
    reth と beacon で同じ番号 n を共有することで両者が同じ論理ノードとして
    対応付く。追加識別用に `com.chainviz.managed=true` と `com.chainviz.role` も
    付与する。
  - **IP 採番**: reth は 172.28.1.n、beacon は 172.28.2.n(n>=3。1,2 は compose の
    ノードが使用済み)。addNode 時に network.inspect() で使用中 IP を取得し、
    両帯で同じ n が空いている最小の番号を選ぶ。既存 reth1/reth2/beacon1/beacon2 の
    慣習(README「ノードを増やすには」)に合わせた。
  - **removeNode の保護**: collector が addNode で作成したコンテナ(内部レジストリ
    にあるもの)だけ削除できる。compose 起動のバリデーター付きノード
    (reth1/reth2/beacon1/beacon2 等)への removeNode はエラーを返す。ノードは
    reth+beacon ペア単位で管理し、どちらの安定 ID を指定しても両方削除する。
  - **ワークベンチのラベル**: addWorkbench の label をそのまま compose service
    ラベルに使い、WorkbenchEntity.label に反映させる。同名が既に管理下にある
    場合は `-2`, `-3` を付けて一意化する。mnemonic は profiles/ethereum/values.env の
    EL_AND_CL_MNEMONIC を読み込んで環境変数に注入する(単一の出所を保つ)。
  - **profiles/ethereum 側の変更は不要だった**。reth-node.sh / lighthouse-bn.sh は
    環境変数だけで駆動する汎用スクリプトのため、collector が dockerode で
    そのまま bind mount して起動できた。`packages/shared` の型変更も不要。
  - コマンドは docs/ARCHITECTURE.md §3 のとおりワールドステートを直接書き換えず、
    実際の反映は後続のポーリング差分で届く。
  - **実機確認**: 実環境に対し WebSocket 経由で全コマンドを実行し検証した。
    addNode で reth3(172.28.1.3)+ beacon3(172.28.2.3)が正しいラベル・
    マウント・環境変数で起動(reth3 は RPC 稼働、beacon3 は新 genesis の正しい
    スロットから起動)。removeNode は compose の reth1 を保護(エラー)し、追加した
    ペアを両方削除。addWorkbench は Foundry コンテナを起動し `cast chain-id`=1337・
    `cast wallet address`(mnemonic 注入)が成功、removeWorkbench で削除できた。
  - **既知の環境問題(collector 範囲外・node-env へ要連携。解消済み)**:
    当初 `profiles/ethereum/scripts/lighthouse-bn.sh` の `set -f`(noglob)に
    起因するデータ初期化不具合(Issue #41)により、今回の実機確認時点では
    既存ネットワークが合意できず追加ノードのブロック追従のエンドツーエンド
    確認まではできなかった。また、EL(reth)同士の P2P がそもそも無効化
    されていたため(`--disable-discovery`)、チェーンが既に進行した後に
    参加する reth は過去のブロックをバックフィルする手段が無く、ブロック
    高 0 のまま停止する根本的な問題があった(chainviz-qa の統合検証で発覚)。
    node-env 側で EL 間 P2P を有効化(Issue #44)し、collector 側も
    `rethSpec` に `RETH_ROLE=peer`・`RETH_P2P_IP`・`elpeer` ボリューム
    マウントを追加して追随した結果、**実機でチェーン進行中(block 41 相当)に
    追加した reth+beacon ペアが履歴をバックフィルし、既存 reth と完全に
    歩調を合わせて追従することを確認した**(関連する `/data` 未マウント時の
    lighthouse-bn.sh クラッシュも Issue #46 で解消済み)。

### 2026-07-04 Issue #34・#35・#36 ノード/ワークベンチ追加・削除のテスト強化(tester)
- 担当: tester
- ブランチ: issue-34-add-remove-node
- 内容: collector 側実装(#34・#35・#36)の基本ユニットテストに対し、異常系・
  境界値・想定外シーケンスの観点でテストを追加した。実装コードは変更していない。
  テスト件数は 273 → 315(collector パッケージ)。
  - `docker/dockerode-operations.test.ts`: 空ポート配列で ExposedPorts を省くこと、
    labels/binds 未指定時の扱い、静的 IP なしでもエンドポイントが張られること、
    `collectNetworkIps` が空文字/欠損 IPv4Address をスキップすること、CIDR なしの
    素の IP をそのまま返すこと、複数 IPAM config からの Gateway 収集、
    `usedNetworkIps` の空ネットワーク・inspect 失敗の伝播、`stopAndRemove` の
    remove 失敗が伝播すること。
  - `adapters/ethereum/node-lifecycle.test.ts`: `parseMnemonic` の単一引用符/
    引用符なし/インデント/複数行/空値/別名変数、`allocateNodeIndex` の境界
    (254 まで埋まった場合・全枠使用時 undefined・execution/consensus 片側のみ
    使用中の扱い)、reth 作成自体が失敗した場合にロールバックも登録もしないこと、
    addNode 失敗時に index を消費せず再試行で同じ index を再利用できること、
    空きスロットなしで throw し何も作成しないこと、usedNetworkIps 由来の使用中
    IP を回避すること、同一 nodeId への二重 removeNode を拒否すること、未知 ID・
    名前がプレフィックス一致するだけの ID(reth / reth30)を誤削除しないこと、
    removeNode の stopAndRemove 失敗が伝播すること、空/空白ラベルの既定 service、
    ワークベンチのコンテナ名が seq で一意になること、二重 removeWorkbench の拒否、
    ラベル解放後の再利用、空レジストリでの removeWorkbench 拒否、values.env が
    読めない場合に mnemonic を省くこと・読める場合に注入すること。
  - `commands/handler.test.ts`: 不明 action 名がエラーに載ること、action 無しで
    "(none)"、不明 action で lifecycle を一切呼ばないこと、Error 以外の throw 値の
    文字列化。
  - `server/websocket-server.test.ts`: 同一 commandId の 2 コマンドがどちらも
    処理され id がエコーされること(重複排除しない)、command フィールド欠落の
    command envelope でも id をエコーして返すこと、配列ペイロードの無視。
- 決定事項・注意点:
  - **removeNode の部分失敗時のリーク(要確認・collector へ差し戻し候補)**:
    `removeNode` はレジストリから先に splice してから consensus → execution の
    順に `stopAndRemove` する。consensus の削除が throw すると execution は削除
    されず、かつレジストリからは既に外れているため removeNode 経由で再試行でき
    ない(execution コンテナが孤立する)。実装コメントは「片方の削除が失敗しても
    再試行できるよう先に登録を外す」と述べているが、外した後は再試行手段が無い
    ため意図と挙動が食い違う。dockerode 実装の `stopAndRemove` は stop 失敗を
    握りつぶし force remove するため実際に throw する頻度は低いが、設計上の穴
    として collector 担当へ確認を依頼したい。今回は現挙動(失敗が伝播すること)を
    テストで固定するに留め、実装は変更していない。

### 2026-07-04 ステップ5(#34-#39) 追加・削除機能の最終統合QA検証

- 担当: qa
- ブランチ: collector=issue-34-add-remove-node / frontend=issue-37-frontend-add-remove-ui
- 内容: Issue #44(EL間P2P有効化)・#46(lighthouse-bn.sh修正)main反映後の
  ステップ5全体を、起動中の profiles/ethereum 実環境に対して再検証した。
  前回不合格だった「追加rethがブロックに追従しない」問題の解消を含め、
  完了条件をすべて満たすことを確認した。合格。
  - collector を `pnpm --filter @chainviz/collector build` 後にポート4000で
    起動し、フロントと同一の WebSocket プロトコル(snapshot/diff/command/
    commandResult)でライフサイクル操作を実行して検証した。
  - addNode: commandResult ok を約0.6秒で受信。数秒後の差分で reth3
    (172.28.1.3)・beacon3(172.28.2.3)がエンティティとして出現し、
    consensus ネットワークに新エッジ beacon1→beacon3 が張られた。
  - ブロック追従(前回の不合格箇所): ワークベンチから
    `cast block-number --rpc-url http://172.28.1.3:8545` で reth3 を直接叩き、
    287→319→383→430→433 と履歴をバックフィルして先頭へ追いつき、以後
    reth1 と同一高(441==441, 444==444)を維持することを確認。EL間P2P
    (elpeer 経由の boot enode 接続 + RETH_ROLE=peer)が機能している。
  - removeNode(追加ノード): nodeId `chainviz-ethereum/reth3` を指定して
    ok。数秒後に reth3・beacon3 の両方がキャンバス(エンティティ)から消えた。
  - removeNode(既存composeノード): nodeId `chainviz-ethereum/reth1` は
    ok:false、error="node ... was not added via addNode and cannot be removed"
    を返し、reth1 は残存。既存バリデーター付きノードは削除できないこと確認。
  - addWorkbench/removeWorkbench: Foundry コンテナ
    (chainviz-ethereum-qa-wb-1)が追加・削除でき、削除後に managed ラベルの
    コンテナが残らないことを確認。
  - フロント側: コマンド送信コード(commands/)が
    {action:addNode,chainProfile:"ethereum"} 等プロトコルと一致し、削除ボタンは
    entity.id を渡す。vite を `VITE_COLLECTOR_URL=ws://localhost:4000` で起動し、
    index.html および main.tsx/App.tsx/CanvasToolbar.tsx が HTTP 200 で変換・
    配信されることを確認(当環境にヘッドレスブラウザが無いためクリック操作の
    ブラウザ実測は不可。UI挙動はユニットテスト301件通過と実プロトコル疎通で担保)。
  - `pnpm lint && pnpm build && pnpm test` は両ワークツリーで成功
    (collector側: collector 319 / frontend 231、frontend側: frontend 301)。
- 決定事項・注意点:
  - PLAN.md ステップ5のフロント項目 #37-#39 のチェックは、frontend ブランチが
    未コミット・未マージのため未着。frontend PR マージ時にチェックを付ける。
  - 検証後、起動した collector / vite プロセスを停止し、追加した
    reth3/beacon3/qa-wb コンテナを削除してクリーンな状態に戻した。

