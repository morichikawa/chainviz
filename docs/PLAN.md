# chainviz 開発プラン（設計フェーズ〜Phase 1）

`docs/CONCEPT.md` のロードマップ（Phase 1〜9）が「何を作るか」を定めるのに対し、
このドキュメントは「直近をどの順番で・何を成果物として進めるか」を定める。
各ステップに**成果物**と**完了条件**を置き、上から順に進める。
ステップ・サブ項目はチェックボックスで管理し、完了したら都度チェックを付ける
（このチェックの状態がそのまま「今どこまで進んだか」になる。文章での
「現在地」の書き換えは不要）。完了ごとにコミットし、docs/ との齟齬を
sync-docs スキルで確認する。

## ステップ 0: 設計フェーズ — docs/ARCHITECTURE.md の作成

構想（CONCEPT.md）を実装可能な設計に落とし込む。コードはまだ書かない。

- [x] **0-1. リポジトリ構成の確定**
  - [x] モノレポツールの選定（pnpm workspace を第一候補） → pnpm workspace で決定
  - [x] パッケージ分割の確定（最低限: `shared`（ワールドステートの型・スキーマ）
        / `collector` / `frontend`） → この3分割で決定
  - [x] 各パッケージ内のフォルダ構成（ドメイン単位。CLAUDE.md の方針に従う）
        → `docs/ARCHITECTURE.md` §1 参照
- [x] **0-2. ワールドステートのスキーマ設計**
  - [x] エンティティの列挙と型定義（ノード、ワークベンチ、ウォレット、
        ピア接続、ブロック、tx、コントラクト…） → `docs/ARCHITECTURE.md` §2 参照
  - [x] チェーン非依存の語彙で命名し、`chainType` で拡張する構造の確定
        （CONCEPT.md「ChainAdapter」参照）
  - [x] 「全量スナップショット + 差分イベント」の差分イベント型の設計
- [x] **0-3. Collector ⇔ フロントの WebSocket プロトコル設計**
  - [x] 接続時スナップショット→以後差分、の流れの具体化 → `docs/ARCHITECTURE.md` §3 参照
  - [x] フロント→Collector の操作コマンド（ノード/ワークベンチの追加・削除）
        の形式設計
- [x] **0-4. チェーンプロファイルの形式設計**
  - [x] 「ノード環境テンプレート・ChainAdapter・フロント表現セット」の3点を
        コード上どう表現するか（ディレクトリ構成・インターフェース定義）
        → `docs/ARCHITECTURE.md` §4 参照
- [x] **0-5. glossary データ形式の設計**
  - [x] `glossary/` 配下のファイル構成（CONCEPT.md「データの置き場所」）
        → `docs/ARCHITECTURE.md` §5 参照
  - [x] スキーマ定義（`{ja, en}` 形式、関連サービス・出典・他チェーンでの違い）
- [x] **0-6. `docs/ARCHITECTURE.md` の執筆完了**

**成果物**: `docs/ARCHITECTURE.md`（上記 0-1〜0-5 を含む）
**完了条件**: CONCEPT.md の決定事項と齟齬がなく、ステップ 1 以降が
このドキュメントだけを見て着手できる状態

## ステップ 1: 開発環境の足場づくり

- [x] モノレポ初期化（pnpm workspace、TypeScript、lint / format、テストランナー）
      → pnpm workspace + TypeScript project references + vitest で構築
- [x] `shared` パッケージの作成（ARCHITECTURE.md §2〜4 の型を実装）
- [x] `collector` パッケージの作成（`shared` を参照）
- [x] `frontend` パッケージの作成（`shared` を参照）
- [x] ビルド・テストが通ることを確認 → `pnpm build` / `pnpm test` とも全パッケージ成功

**成果物**: ビルド・テストが通る空のモノレポ
**完了条件**: `shared` の型を `collector` と `frontend` の両方から import して
ビルドが通る

## ステップ 2: Ethereum プロファイルのノード環境

GitHub: [milestone](https://github.com/morichikawa/chainviz/milestone/1)

**実装(chainviz-node-env 担当)**: #1〜#3 は1つの環境を組み立てる不可分な
作業のため、1本のブランチ・1つのPR（`Closes #1, #2, #3`）にまとめる。

- [x] genesis 設定ファイル（genesis.json 等）の作成。バリデーター最小構成・
      slot time 短縮を反映（reth + lighthouse 向け）
      [#1](https://github.com/morichikawa/chainviz/issues/1)
- [x] その genesis を使って reth + lighthouse を2〜3ノード起動する
      compose ファイルの作成 [#2](https://github.com/morichikawa/chainviz/issues/2)
- [x] ワークベンチコンテナ（Foundry）×1 を同ネットワークに接続
      [#3](https://github.com/morichikawa/chainviz/issues/3)

**検証(chainviz-qa 担当)**: node-env の自己確認ではなく、qa が実際に
動かして検証した結果でクローズする。

- [x] `docker compose up` でチェーンが起動しブロックが進み続けることを確認
      [#4](https://github.com/morichikawa/chainviz/issues/4)
- [x] ワークベンチから `cast` で RPC 疎通確認
      [#5](https://github.com/morichikawa/chainviz/issues/5)

（ロギングプロキシはこの時点では置かない。Phase 3 で追加）

**成果物**: `profiles/ethereum/` のノード環境テンプレート
**完了条件**: `docker compose up` でチェーンが起動しブロックが進み続ける。
ワークベンチから `cast` で RPC が叩ける

## ステップ 3: Phase 1 実装 — A層（インフラ可視化）

GitHub: [milestone](https://github.com/morichikawa/chainviz/milestone/2)

**collector 側と frontend 側は互いに依存しないため並行して進める**。
それぞれ1本のブランチ・1つのPRにまとめる
（`issue-7-collector-a-layer` / `issue-10-frontend-a-layer` の想定）。
完了報告後は `chainviz-tester` → `chainviz-reviewer` → `chainviz-qa` の
順に通す。

**collector**:

- [x] dockerode で Docker Engine API（containers / top / stats）を
      3 秒間隔でポーリング [#7](https://github.com/morichikawa/chainviz/issues/7)
- [x] ポーリング結果をワールドステートに正規化
      [#8](https://github.com/morichikawa/chainviz/issues/8)
- [x] WebSocket でフロントへプッシュ（スナップショット + 差分）
      [#9](https://github.com/morichikawa/chainviz/issues/9)

**frontend**:

- [x] React Flow による無限キャンバスの土台
      [#10](https://github.com/morichikawa/chainviz/issues/10)
- [x] コンテナのカード表示 [#11](https://github.com/morichikawa/chainviz/issues/11)
- [x] ホバーで IP・プロセス・リソースのポップオーバー
      [#12](https://github.com/morichikawa/chainviz/issues/12)
- [x] 用語解説のインライン表示の仕組み
      [#13](https://github.com/morichikawa/chainviz/issues/13)
- [x] A層の用語データ（`glossary/ethereum/terms/a-infra.yaml`）
      [#14](https://github.com/morichikawa/chainviz/issues/14)
- [x] レイアウトの localStorage 永続化（キーは安定識別子。コンテナ ID は使わない）
      [#15](https://github.com/morichikawa/chainviz/issues/15)
- [x] UI 言語切り替え（ja / en）の仕組み
      [#16](https://github.com/morichikawa/chainviz/issues/16)

**成果物**: 動く Phase 1 デモ
**完了条件**: CONCEPT.md「ロードマップ」Phase 1 の記述どおりに動作する

## ステップ 4: Phase 2 実装 — B層（P2P グラフ）

GitHub: [milestone](https://github.com/morichikawa/chainviz/milestone/3)

このステップの実装時点ではreth(EL)同士のP2Pは`profiles/ethereum`でまだ
繋いでいなかったため、この段階のピア接続検出はlighthouse(CL)側のBeacon API
を対象にした。ブロック伝播の波アニメーションはCL側のP2Pゴシップだけで各
reth(EL)ノードへのEngine API経由の到達タイミングに差が出るため、EL間P2Pが
無くても実現できた(EL間P2Pは後のステップ5・Issue #44で有効化した)。

**collector**:

- [x] lighthouse Beacon APIをポーリングしピア接続をPeerEdgeへ正規化する
      [#19](https://github.com/morichikawa/chainviz/issues/19)
- [x] rethのeth_subscribe(newHeads)を購読し各ノードの受信時刻を記録する
      [#20](https://github.com/morichikawa/chainviz/issues/20)
- [x] reth(EL)のブロック受信時刻をbeacon(CL)のstableIdへ対応付ける
      [#28](https://github.com/morichikawa/chainviz/issues/28)
- [x] PeerEdgeとブロック伝播タイミングをworld-state store経由でフロントへ配信する
      [#21](https://github.com/morichikawa/chainviz/issues/21)

**frontend**:

- [x] フロントのworld-state storeがPeerEdgeを受信・保持できるようにする
      [#22](https://github.com/morichikawa/chainviz/issues/22)
- [x] React FlowでノードカードのあいだにP2Pエッジ(紐)を描画する
      [#23](https://github.com/morichikawa/chainviz/issues/23)
- [x] ネットワークID単位のグルーピング表示
      [#24](https://github.com/morichikawa/chainviz/issues/24)
- [x] ブロック伝播パルスアニメーションの実装
      [#25](https://github.com/morichikawa/chainviz/issues/25)

**成果物**: 動く Phase 2 デモ
**完了条件**: CONCEPT.md「ロードマップ」Phase 2 の記述どおりに動作する
（ノード同士がP2Pエッジで繋がり、ネットワーク単位でグルーピングされ、
ブロックが伝播するタイミングで実データに基づくパルスがエッジ上を伝わる）

## ステップ 5: キャンバスからのノード/ワークベンチ追加・削除

GitHub: [milestone](https://github.com/morichikawa/chainviz/milestone/4)

Phase 2 と Phase 3 の間に挟む機能。新規ノードは「バリデーターなしの
フォロワー reth+beacon ペア」として追加する(既存 genesis のバリデーター鍵は
固定数のため、バリデーター化には genesis 再生成が必要になり現実的でない)。

着手時点では`profiles/ethereum/scripts/{reth-node.sh,lighthouse-bn.sh}`が
環境変数だけで駆動するためnode-env側の変更は不要と見込んでいたが、実際には
reth(EL)同士のP2Pが無効化されており、チェーンが進行した後に参加する新規
rethが履歴をバックフィルできず追従しないという問題が統合QAで発覚した。
node-env側でEL間P2P同期を有効化し([#44](https://github.com/morichikawa/chainviz/issues/44)、
関連バグ修正 [#46](https://github.com/morichikawa/chainviz/issues/46))、
collector側もそれに追随することで解消した。

**collector**:

- [x] addNodeコマンドを実装する(バリデーターなしのフォロワーノード追加)
      [#34](https://github.com/morichikawa/chainviz/issues/34)
- [x] removeNodeコマンドを実装する
      [#35](https://github.com/morichikawa/chainviz/issues/35)
- [x] addWorkbench/removeWorkbenchコマンドを実装する
      [#36](https://github.com/morichikawa/chainviz/issues/36)

**frontend**:

- [x] キャンバスにノード/ワークベンチ追加ボタンのUIを実装する
      [#37](https://github.com/morichikawa/chainviz/issues/37)
- [x] ノード/ワークベンチカードに削除ボタンを実装する
      [#38](https://github.com/morichikawa/chainviz/issues/38)
- [x] コマンド失敗時のエラー表示を実装する
      [#39](https://github.com/morichikawa/chainviz/issues/39)

**成果物**: キャンバス上でノード/ワークベンチを追加・削除できるデモ
**完了条件**: UIから追加したノードが既存ネットワークに参加してブロックに
追従し、削除すると数秒後にキャンバスから消える。既存compose起動の
バリデーター付きノードは削除できない(エラーが返る)

## ステップ 6: E2E（結合）テストの導入

GitHub: [milestone](https://github.com/morichikawa/chainviz/milestone/5)

ステップ5(addNode)で「ユニットテストはすべて通っているが実環境では
動かない」不具合(EL間P2Pが無効でブロックに追従しない。Issue #44/#46)が
chainviz-qaの手動検証で初めて発覚した。この種の不具合を自動で検出できる
よう、実環境(Docker+collector)を使った結合テストを導入する
([#30](https://github.com/morichikawa/chainviz/issues/30)で導入方針を検討)。

- [x] packages/e2eパッケージの土台(Docker起動待ち・collector起動ヘルパー・
      WebSocketテストクライアント)を作る
      [#51](https://github.com/morichikawa/chainviz/issues/51)
- [x] A層・B層のE2Eテスト(スナップショット・ピアエッジ・ブロック伝播
      タイミング)を書く
      [#52](https://github.com/morichikawa/chainviz/issues/52)
- [x] ステップ5操作コマンドのE2Eテスト(addNode後の実際のブロック追従確認
      を含む)を書く
      [#53](https://github.com/morichikawa/chainviz/issues/53)
- [x] E2Eテストの実行方法をpnpm test:e2eとして配線しCONTRIBUTING.mdに
      記載する
      [#54](https://github.com/morichikawa/chainviz/issues/54)

**成果物**: `pnpm test:e2e`で実行できるE2Eテスト一式
**完了条件**: 実環境に対しA層・B層・ステップ5の操作コマンドが自動検証され、
`pnpm lint && pnpm build && pnpm test`(pre-pushフックの対象)には
E2Eテストが混入しない

上記の完了後、「すべてのケースを網羅する」ため以下を追加する(ユーザー
指示。異常系→再接続の順で着手):

- [x] 異常系シナリオ(不正なchainProfile・存在しないID・不正なコマンド)を
      追加する
      [#58](https://github.com/morichikawa/chainviz/issues/58)
- [x] 再接続シナリオ(切断→再接続後のスナップショット整合性)を追加する
      [#59](https://github.com/morichikawa/chainviz/issues/59)

## ステップ 7: Phase3実装 — C層（生きているチェーン）

GitHub: [milestone](https://github.com/morichikawa/chainviz/milestone/6)

CONCEPT.mdロードマップのPhase3: 「ブロック生成・tx投入をリアルタイム反映。
ブロック伝播パルス、txライフサイクル表示(C層完成)。tx投入はワークベンチ
から行い、ワークベンチ→ノードのRPC呼び出しもエッジとして描画する。
ワークベンチが持つウォレット(アドレス・残高・nonce)もこのタイミングで
可視化に加える」。コントラクト呼び出し・イベントログの詳細な可視化は
このステップの範囲外とし、必要になった時点で別途スコープする(先回り
実装をしない)。

**collector**:

- [x] reth WSでnewPendingTransactions/newHeadsを購読しtxライフサイクル
      (pending→included)を追跡する
      [#76](https://github.com/morichikawa/chainviz/issues/76)
- [x] ワークベンチのウォレット残高・nonceをポーリングしWalletEntityとして
      反映する
      [#77](https://github.com/morichikawa/chainviz/issues/77)
- [x] ワークベンチ→ノードのRPC呼び出しを観測するロギングプロキシを実装する
      [#79](https://github.com/morichikawa/chainviz/issues/79)
- [x] ロギングプロキシが観測したRPC呼び出しを操作エッジとしてworld-state
      に配信する
      [#80](https://github.com/morichikawa/chainviz/issues/80)

**node-env**:

- [x] ワークベンチの接続先をロギングプロキシ経由に変更する
      [#78](https://github.com/morichikawa/chainviz/issues/78)

**frontend**:

- [x] txライフサイクル(mempool投入→ブロック取り込み)のアニメーションを
      実装する
      [#81](https://github.com/morichikawa/chainviz/issues/81)
- [x] ウォレットのカード表示と所有エッジを実装する
      [#82](https://github.com/morichikawa/chainviz/issues/82)
- [x] ワークベンチ→ノードのRPC呼び出しエッジを描画する
      [#83](https://github.com/morichikawa/chainviz/issues/83)
- [x] C層向け用語データ(mempool・tx・nonce・EOA等)をglossaryに追加する
      [#84](https://github.com/morichikawa/chainviz/issues/84)

**成果物**: 動くPhase 3デモ
**完了条件**: CONCEPT.md「ロードマップ」Phase 3の記述どおりに動作する
(txがmempoolに入りブロックに取り込まれる様子がリアルタイムに見え、
ワークベンチからノードへのRPC呼び出しがエッジとして描画され、
ワークベンチが持つウォレットの残高・nonceが可視化される)

## ステップ 8: Phase4実装 — C層拡張（コントラクト呼び出し・イベントログ可視化）

GitHub: [milestone](https://github.com/morichikawa/chainviz/milestone/7)

CONCEPT.mdロードマップの新Phase 4（C層 完成）: ステップ7で範囲外とした
コントラクト呼び出し・イベントログの可視化と、送金・デプロイ等の定型操作の
GUI化。設計の全体像（型・データフロー・カタログの置き場所・決定事項）は
`docs/ARCHITECTURE.md` §2〜§4 と `docs/worklog/meta.md`（2026-07-07 の設計
記録）を参照。`packages/shared` の型変更（ContractEntity 拡張・
TransactionEntity のコントラクト関連フィールド・WalletEntity.tokenBalances・
runWorkbenchOperation コマンド・ChainAdapter.subscribeContracts）は設計時に
実装済みで、このステップの各担当は決定済みの前提として使ってよい。

**UX**（実装着手前に chainviz-ux が設計し、frontend に引き継ぐ）:

- [x] コントラクトカード・定型操作・イベントログ表示のUX設計（操作フロー・
      情報の見せ方・文言。「コントラクトは全ノードで実行される」の伝え方を
      含む）→ 設計済み。`docs/ARCHITECTURE.md` §6 が成果物（frontend への
      着手指示を兼ねる）。§6.10 の判断4点は確定済み
      [#157](https://github.com/morichikawa/chainviz/issues/157)

**node-env**:

- [x] サンプルコントラクト（最小ERC20のChainvizTokenとCounter）のFoundry
      プロジェクトを`profiles/ethereum/contracts/`に追加しワークベンチに
      マウントする
      [#158](https://github.com/morichikawa/chainviz/issues/158)
- [x] コントラクトカタログ（catalog.json: 表示名・ABI・tokenメタ情報）と
      再生成スクリプト（build-catalog.sh）を追加する
      [#159](https://github.com/morichikawa/chainviz/issues/159)

**collector**:

- [x] eth_getBlockReceiptsの正規化を拡張しコントラクト作成
      （contractAddress）とイベントログ（logs）を取得する
      [#160](https://github.com/morichikawa/chainviz/issues/160)
- [x] コントラクトカタログの読み込みとデプロイ検知・追跡を実装し
      ContractEntityをworld-stateへ配信する（subscribeContracts）
      [#161](https://github.com/morichikawa/chainviz/issues/161)
- [ ] カタログのABIで関数呼び出し・イベントログを復号しTransactionEntityの
      contractCall/contractEventsに載せる
      [#162](https://github.com/morichikawa/chainviz/issues/162)
- [x] runWorkbenchOperationコマンド（transfer/deployContract/callContract）
      をワークベンチコンテナ内のcast/forge実行として実装する
      [#163](https://github.com/morichikawa/chainviz/issues/163)
- [ ] 追跡中トークンコントラクトの残高をポーリングし
      WalletEntity.tokenBalancesへ反映する
      [#164](https://github.com/morichikawa/chainviz/issues/164)

**frontend**:

- [ ] ContractEntityのカード表示とポップオーバー（未知のコントラクトの
      表示を含む）を実装する
      [#165](https://github.com/morichikawa/chainviz/issues/165)
- [ ] コントラクト呼び出し・イベントログの可視化（復号済み関数名・引数・
      イベントの表示と、tx確定時のコントラクトカードへのアニメーション）を
      実装する
      [#166](https://github.com/morichikawa/chainviz/issues/166)
- [ ] ワークベンチカードから定型操作（送金・デプロイ・コントラクト呼び出し）
      を実行するUIを実装する
      [#167](https://github.com/morichikawa/chainviz/issues/167)
- [ ] ウォレットカードにトークン残高を表示する
      [#168](https://github.com/morichikawa/chainviz/issues/168)
- [x] C層拡張の用語データ（contract・デプロイ・ABI・イベントログ・EVM・
      トークン等）をglossaryへ追加する
      [#169](https://github.com/morichikawa/chainviz/issues/169)

**成果物**: 動くPhase 4デモ
**完了条件**: CONCEPT.md「ロードマップ」Phase 4の記述どおりに動作する
（キャンバスの定型操作またはワークベンチのforge/castでサンプルコントラクトを
デプロイするとコントラクトカードが現れ、トークンtransfer等の呼び出しが
関数名・引数付きで、発生したイベントログがイベント名付きで可視化され、
ウォレットのトークン残高の変化が見える。カタログ外のコントラクトも
「未知のコントラクト」として表示される。コントラクトが特定ノードではなく
全ノードで実行されることが用語解説・カード表現から分かる）

## ステップ 9 以降（概要のみ。詳細は着手時にこのドキュメントへ追記）

- [ ] Phase 5（D層: ノード内部）
- [ ] Phase 6（AA 可視化）
- [ ] Phase 7（Bitcoin プロファイル追加）
- [ ] Phase 8（Solana プロファイル追加、チェーン比較表示）
- [ ] Phase 9 以降（Cosmos 系プロファイル追加）

## バックログ（特定のステップに紐づかない、後日着手する課題）

- [x] ダークモードのUI視認性を改善する
      [#32](https://github.com/morichikawa/chainviz/issues/32)
- [x] beaconのみ再起動するとEL/CLが乖離しチェーンが完全停止する
      [#43](https://github.com/morichikawa/chainviz/issues/43)
- [x] 稼働中スタックにdocker compose up -dを再実行するとgenesisが
      再生成され既存ノードと不整合になる
      [#56](https://github.com/morichikawa/chainviz/issues/56)
- [x] lighthouse-bn.shのset -fがrm -rf /data/*のglob展開を無効化し
      データ初期化に失敗する
      [#41](https://github.com/morichikawa/chainviz/issues/41)
- [x] コンテナ削除処理の競合(HTTP 409)でcollectorプロセスがクラッシュし
      孤児コンテナが蓄積する
      [#63](https://github.com/morichikawa/chainviz/issues/63)
- [x] test:e2eを複数worktreeで同時実行するとcollectorのポート奪い合いで
      タイムアウトする
      [#64](https://github.com/morichikawa/chainviz/issues/64)
- [x] 起動時にcom.chainviz.managedラベルから既存managedコンテナを回収し
      レジストリを再構築する
      [#65](https://github.com/morichikawa/chainviz/issues/65)
- [x] WebSocket接続ごとにerrorリスナーを張り、ソケットエラーをプロセス
      全体の安全網に頼らせない
      [#68](https://github.com/morichikawa/chainviz/issues/68)
- [x] txライフサイクルにfailedステータスを実装する
      [#86](https://github.com/morichikawa/chainviz/issues/86)
- [x] P2Pエッジと所有エッジの色相が近く(ともにアンバー系)、線種でしか
      区別できない環境がある。色相を分離する
      [#95](https://github.com/morichikawa/chainviz/issues/95)
- [x] WSL2環境でcollectorのWebSocket/ロギングプロキシがVS Codeのポート
      転送経由で繋がらない
      [#99](https://github.com/morichikawa/chainviz/issues/99)
- [x] ノード/ワークベンチ追加時に仮の半透明カードと即時フィードバックを
      表示する
      [#102](https://github.com/morichikawa/chainviz/issues/102)
- [x] compose起動ノードの削除ボタンを押すと必ずエラーになる(UIで防げて
      いない)
      [#103](https://github.com/morichikawa/chainviz/issues/103)
- [x] reth(EL)同士のP2P接続がPeerEdgeとして描画されない
      [#106](https://github.com/morichikawa/chainviz/issues/106)
- [x] 仮カード(ゴーストノード)の配置indexが、削除を挟むと重なることがある
      [#113](https://github.com/morichikawa/chainviz/issues/113)
- [x] 定期更新のたびにノードカードが一瞬ちらつく(React Flowの再計測サイクル)
      [#119](https://github.com/morichikawa/chainviz/issues/119)
- [x] pnpm dev:upがdist/の古いビルドを検知せず気づかないまま起動してしまう
      [#121](https://github.com/morichikawa/chainviz/issues/121)
- [x] ノード/ワークベンチ追加時に、どこに何と繋がって追加されるか分からない
      [#123](https://github.com/morichikawa/chainviz/issues/123)
- [x] reth同士のP2Pメッシュ形成が分かりにくく、正しい状態か判断できない
      [#124](https://github.com/morichikawa/chainviz/issues/124)
- [x] ブロック伝播パルスが隣接カード間では移動距離が短すぎて点滅にしか
      見えない
      [#125](https://github.com/morichikawa/chainviz/issues/125)
- [x] pnpm dev:down --dockerがaddNode/addWorkbenchで動的追加したコンテナを
      削除しない
      [#126](https://github.com/morichikawa/chainviz/issues/126)
- [x] 動的追加ワークベンチのRPCがロギングプロキシを経由せずreth1に直結して
      いる(操作エッジが描画されない)
      [#129](https://github.com/morichikawa/chainviz/issues/129)
- [x] eth_subscribe(newHeads/newPendingTransactions)のWebSocket接続が
      切断時に自動再接続しない
      [#135](https://github.com/morichikawa/chainviz/issues/135)
- [x] PC停止等でチェーンが長時間停止すると、beacon再起動がweak
      subjectivity periodエラーで失敗する
      [#139](https://github.com/morichikawa/chainviz/issues/139)
- [x] reth(EL)同士のエッジにブロック伝播パルスが構造的に一切走らない
      [#141](https://github.com/morichikawa/chainviz/issues/141)
- [x] eth_subscribeのエラー応答(JSON-RPCエラー)を検知できず、購読失敗に
      気づけない
      [#143](https://github.com/morichikawa/chainviz/issues/143)
- [x] 長時間停止後の再起動で--ignore-ws-checkだけでは不十分(genesisからの
      再構築が1 slot以内に収まらずハング)
      [#148](https://github.com/morichikawa/chainviz/issues/148)
- [x] beaconStableIdForExecutionがdocker composeプロジェクトをスコープ
      しない(複数プロジェクト同時観測時にキー混線の恐れ)
      [#153](https://github.com/morichikawa/chainviz/issues/153)

## 運用ルール（全ステップ共通）

- 1 ステップ = 1 つ以上のコミット。Conventional Commits 形式
- サブ項目を完了したらその場でチェックを付ける（進捗はチェックボックスで
  管理し、まとめての更新はしない）
- ステップ完了時に sync-docs スキルで docs/ を確認する
- 各 Phase が単体で「動くデモ」になることを優先し、先の Phase のための
  先回り実装をしない（CLAUDE.md 参照）
