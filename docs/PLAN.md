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
- [x] カタログのABIで関数呼び出し・イベントログを復号しTransactionEntityの
      contractCall/contractEventsに載せる
      [#162](https://github.com/morichikawa/chainviz/issues/162)
- [x] runWorkbenchOperationコマンド（transfer/deployContract/callContract）
      をワークベンチコンテナ内のcast/forge実行として実装する
      [#163](https://github.com/morichikawa/chainviz/issues/163)
- [x] 追跡中トークンコントラクトの残高をポーリングし
      WalletEntity.tokenBalancesへ反映する
      [#164](https://github.com/morichikawa/chainviz/issues/164)

**frontend**:

- [x] ContractEntityのカード表示とポップオーバー（未知のコントラクトの
      表示を含む）を実装する
      [#165](https://github.com/morichikawa/chainviz/issues/165)
- [x] コントラクト呼び出し・イベントログの可視化（復号済み関数名・引数・
      イベントの表示と、tx確定時のコントラクトカードへのアニメーション）を
      実装する
      [#166](https://github.com/morichikawa/chainviz/issues/166)
- [x] ワークベンチカードから定型操作（送金・デプロイ・コントラクト呼び出し）
      を実行するUIを実装する
      [#167](https://github.com/morichikawa/chainviz/issues/167)
- [x] ウォレットカードにトークン残高を表示する
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

## ステップ 9: Phase5実装 — D層（ノード内部可視化）

GitHub: [milestone](https://github.com/morichikawa/chainviz/milestone/8)

CONCEPT.mdロードマップのPhase 5: 「EL/CL構成(Kurtosis検討)にしてEngine API・
同期ステージを可視化(D層)」。EL/CL構成は既存のcompose構成で実現済みで、
Kurtosisは不採用が確定している(CONCEPT.md未決事項参照)。可視化するのは
①CL→ELのEngine APIのやり取り(内部リンクエッジ+活動パルス)、②rethの
ステージ型同期の進行状況、③txpoolの内部状態、の3点。設計の全体像
(型・データフロー・観測方法・決定事項)は`docs/ARCHITECTURE.md` §7と
`docs/worklog/meta.md`(2026-07-08の設計記録)を参照。`packages/shared`の
型変更(NodeEntity.drivesNodeId/internals・NodeInternals・NodeLinkActivity・
DiffEventのnodeLinkActivity・ChainAdapter.subscribeNodeInternals)は設計時に
実装済みで、各担当は決定済みの前提として使ってよい。

**UX**（実装着手前に chainviz-ux が設計し、frontend に引き継ぐ）:

- [x] D層可視化のUX設計(内部リンクエッジ・活動パルス・同期ステージ・
      mempool内訳の見せ方、表示密度の制御、D層用語の文言。
      `docs/ARCHITECTURE.md` §7.5の委譲項目) → 設計済み。
      `docs/ARCHITECTURE.md` §7.6 が成果物（frontend への着手指示を
      兼ねる）。§7.6.10 の判断4点は確定済み
      [#183](https://github.com/morichikawa/chainviz/issues/183)

**node-env**:

- [x] rethのPrometheusメトリクスを有効化する(reth-node.shの共通起動
      オプションに--metricsを追加。compose起動ノードと動的追加ノードの
      両方に効くことを確認する)
      [#184](https://github.com/morichikawa/chainviz/issues/184)

**collector**:

- [x] rethのメトリクスエンドポイントを周期ポーリングしEngine API呼び出し・
      同期ステージ・txpoolをパースする(メトリクス名は実環境の/metrics出力で
      確定。欠落時はフィールド省略の縮退動作)
      [#185](https://github.com/morichikawa/chainviz/issues/185)
- [x] NodeInternals/drivesNodeIdをworld-stateへ反映しnodeLinkActivityを
      配信する(subscribeNodeInternalsの配線・storeのapplyNodeInternals・
      pollInfraでのdrivesNodeId解決)
      [#186](https://github.com/morichikawa/chainviz/issues/186)
- [x] ノードカードの同期状態・ブロック高(現在常にsyncing/0)をD層観測から
      更新する(情報源はステージcheckpointかnewHeads受信済み最新ブロックかを
      実測で確定。ARCHITECTURE.md §7.3)
      [#187](https://github.com/morichikawa/chainviz/issues/187)

**frontend**:

- [x] 内部リンクエッジ(beacon→reth)の常設描画とnodeLinkActivityの
      活動パルスを実装する
      [#188](https://github.com/morichikawa/chainviz/issues/188)
- [x] ノードカード/ポップオーバーに同期ステージ・mempool内訳を表示する
      [#189](https://github.com/morichikawa/chainviz/issues/189)
- [x] D層用語データ(d-internal.yaml: Engine API・EL/CL分離・ステージ型同期・
      txpool等)をglossaryへ追加する
      [#190](https://github.com/morichikawa/chainviz/issues/190)

**e2e**:

- [x] D層のE2Eテスト(NodeEntity.internals/drivesNodeIdの反映と
      nodeLinkActivityの受信)を追加する
      [#191](https://github.com/morichikawa/chainviz/issues/191)

**成果物**: 動くPhase 5デモ
**完了条件**: CONCEPT.md「ロードマップ」Phase 5の記述どおりに動作する
(beaconカードと対のrethカードが内部リンクエッジで結ばれ、Engine APIの
呼び出しがslotごとの活動パルスとして流れ続ける。rethノードの詳細に同期
ステージの進行状況とtxpoolのpending/queued件数が表示され、addNodeで追加
したフォロワーノードのバックフィル進行がステージの進みとして見える。
Engine API・ステージ型同期が用語解説から学べる)

## ステップ 10: E2E テストの Playwright 移行（UI シナリオテスト）

GitHub: [milestone](https://github.com/morichikawa/chainviz/milestone/9)

ユーザー指示（2026-07-08）: 「E2E テストは Playwright を使う。自然言語
ベース（箇条書き）のシナリオを作り、基本操作から異常系まで網羅する。
UI でやれるところは全部 UI でやる。これまでの分も見直し、これからも
追加し続ける」。既存の `packages/e2e`（WebSocket 直叩き）を棚卸しし、
UI で同等以上に検証できるシナリオは Playwright（実ブラウザで frontend を
操作）へ一本化する。設計の全体像（二層構成・起動トポロジ・シナリオ記法・
棚卸し結果）は `docs/ARCHITECTURE.md` §8 と `packages/e2e/SCENARIOS.md`
（シナリオカタログ。設計時に作成済み）を参照。`@playwright/test` の依存
追加とこの環境での chromium 実行可否の実証は設計時に完了している。

- [x] Playwright 基盤の導入(playwright.config.ts・globalSetup での排他
      ロック/Docker/collector 起動・webServer での vite dev 起動・
      pnpm test:e2e:ui の配線・CONTRIBUTING.md への前提記載)
      [#197](https://github.com/morichikawa/chainviz/issues/197)
- [x] frontend の計装(SCENARIOS.md の UI シナリオが参照する data-testid の
      追加: 接続バッジ・ツールバー・言語トグル・用語/インフラポップ
      オーバー)
      [#198](https://github.com/morichikawa/chainviz/issues/198)
- [x] 基本表示シナリオ(UI-CONN・UI-A・UI-B)の Playwright 実装
      [#199](https://github.com/morichikawa/chainviz/issues/199)
- [x] 操作シナリオ(UI-CMD: ノード/ワークベンチ追加・削除)の Playwright
      実装と、移行済み WS テストの整理(SCENARIOS.md §1 の棚卸しどおり)
      [#200](https://github.com/morichikawa/chainviz/issues/200)
- [x] C層シナリオ(UI-C: 送金・デプロイ・コントラクト呼び出し・トークン
      残高・未知コントラクト)の Playwright 実装
      [#201](https://github.com/morichikawa/chainviz/issues/201)
- [x] 異常系・複数クライアントシナリオ(UI-ERR・UI-MULTI)の Playwright
      実装と、移行済み WS テストの整理
      [#202](https://github.com/morichikawa/chainviz/issues/202)
- [x] D層 UI シナリオ(UI-D)の Playwright 実装(ステップ9の #188/#189 の
      実装完了が前提)
      [#203](https://github.com/morichikawa/chainviz/issues/203)

**成果物**: `pnpm test:e2e:ui` で実行できる Playwright の UI シナリオ
テスト一式と、更新された `packages/e2e/SCENARIOS.md`
**完了条件**: SCENARIOS.md の UI シナリオ(`保` を除く)が全て実装され
green になる。UI へ移行した WS テストが削除され、プロトコル層に残す
テスト(SCENARIOS.md §3)は引き続き green。`pnpm lint && pnpm build &&
pnpm test`(pre-push フックの対象)には UI 層テストが混入しない

**ステップ10 完了**(2026-07-10、#203 で全チェックボックス完了):
`packages/e2e/SCENARIOS.md` の UI シナリオ(`保` マーカーは無くなり、
全件 `済`)を実装し、`pnpm test:e2e:ui` で全32テストが green (実測
3.7分)。移行対象だった WS テストは各 Issue の実装時に削除済み。
プロトコル層(`pnpm test:e2e`)は PROTO-CMD-01 が長時間稼働スタック
特有の環境要因(#203 に起因する回帰ではない)で不安定な場合があったが、
[Issue #229](https://github.com/morichikawa/chainviz/issues/229) で
合格条件を「head への完全追従」から「開始高さから一定ブロック数以上、
停滞なく進行すること」に見直して解消した(詳細は
`docs/worklog/issue-229.md`)。`pnpm lint && pnpm build && pnpm test`
にはUI層テストは含まれない(想定どおり)。

## ステップ 11 以降（概要のみ。詳細は着手時にこのドキュメントへ追記）

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
- [x] collectorのcomposeProjectが"chainviz-ethereum"にハードコードされ
      環境変数での上書き口が無く、QA検証時に独立した合成環境で
      ワークベンチ経由の操作(runWorkbenchOperation等)を検証できない
      (以前から本ファイルに記載されていたがGitHub Issue化されずに残って
      いた項目。統括が2026-07-17にIssue化。環境変数CHAINVIZ_COMPOSE_PROJECT
      で上書き可能にし、実Docker環境でターゲット切替・既存スタックとの
      無干渉・不正値のfail-fastを確認。QA中に発見したaddWorkbenchの
      orphanコンテナ残留(既存の挙動)はIssue #385として分離)
      [#369](https://github.com/morichikawa/chainviz/issues/369)
- [x] デプロイのコンストラクタ引数にABI型と不一致な値を入力するとforgeの
      生エラーがそのままトーストに表示される
      [#209](https://github.com/morichikawa/chainviz/issues/209)
- [x] ワークベンチに複数ウォレットが紐づいているように見える
      （調査の結果、不具合ではなくモックデータの意図的な仕様と判明。
      コード変更なし）
      [#210](https://github.com/morichikawa/chainviz/issues/210)
- [x] コントラクトをデプロイしたらUI上でどう表現されるのか伝わりにくい
      [#211](https://github.com/morichikawa/chainviz/issues/211)
- [x] チェーンの繋がり方・署名中かどうか・状態の中身を可視化してほしい
      [#212](https://github.com/morichikawa/chainviz/issues/212)
- [x] ワークベンチからの操作でなにができるのかの説明がほしい
      [#213](https://github.com/morichikawa/chainviz/issues/213)
- [x] ブートノードとvalidator(2-1/1-1)がP2P接続確立中の表示のまま変化しない
      [#214](https://github.com/morichikawa/chainviz/issues/214)
- [x] rethとbeaconそれぞれの役割・関連性がUIから見えてこない
      [#215](https://github.com/morichikawa/chainviz/issues/215)
- [ ] beacon/rethを1個ずつペアでしか追加できない制約についての疑問
      [#216](https://github.com/morichikawa/chainviz/issues/216)
- [x] ノード追加ボタン付近に「reth+beaconのペアで追加される」ことの説明を
      添える（実装完了。詳細は docs/worklog/issue-251.md 参照）
      [#251](https://github.com/morichikawa/chainviz/issues/251)
- [x] エラー時のトースト通知が長文で右下のポップアップが崩れる
      [#217](https://github.com/morichikawa/chainviz/issues/217)
- [x] デプロイ済みのスマートコントラクト一覧を見れるようにしてほしい
      [#218](https://github.com/morichikawa/chainviz/issues/218)
- [x] ウォレットがスマートコントラクトに対して何ができるのか分かりにくい
      [#219](https://github.com/morichikawa/chainviz/issues/219)
- [x] ノード追加・ワークベンチ追加のボタンが作成中でも連打できてしまう
      [#220](https://github.com/morichikawa/chainviz/issues/220)
- [x] ノード等のホバーポップオーバーが、カードから離れる途中で消えて
      中の用語にホバーできない
      [#221](https://github.com/morichikawa/chainviz/issues/221)
- [x] ノード/ワークベンチ削除中に進行中であることを示すフィードバックが無い
      [#222](https://github.com/morichikawa/chainviz/issues/222)
- [x] パッケージごとにREADME(設計情報)を用意し、タスクのたびに更新する
      運用にしたい
      [#223](https://github.com/morichikawa/chainviz/issues/223)
- [x] docs/CONCEPT.md・docs/ARCHITECTURE.mdが文章のみで分かりにくいので
      図解(Mermaid等)を増やしたい
      [#224](https://github.com/morichikawa/chainviz/issues/224)
- [x] 確定時のコントラクトへのパルス/フラッシュがアドレス表記の
      食い違いで発火しない
      [#232](https://github.com/morichikawa/chainviz/issues/232)
- [x] UI-CMD系PlaywrightテストのafterAllクリーンアップが競合状態で
      無効化されうる
      [#233](https://github.com/morichikawa/chainviz/issues/233)
- [x] dev collector稼働中はpnpm test:e2eが起動不能(proxyポート衝突が
      listen判定をすり抜ける)
      [#254](https://github.com/morichikawa/chainviz/issues/254)
- [x] 長時間のUI層E2Eフルスイート実行中にcollectorがuncaughtExceptionで
      exitし、以降の全テストがカスケード失敗する
      [#238](https://github.com/morichikawa/chainviz/issues/238)
- [x] collector停止中に送信したaddNode/addWorkbenchはゴースト消滅のみで
      エラートーストが出ない
      [#235](https://github.com/morichikawa/chainviz/issues/235)
- [x] カードのホバーポップオーバーが隣接カードの下に描画され読めない
      [#245](https://github.com/morichikawa/chainviz/issues/245)
- [x] isValidatorServiceがサービス名のみで判定しており将来の別チェーン
      プロファイルで誤検出しうる
      [#246](https://github.com/morichikawa/chainviz/issues/246)
- [x] operationPendingのoperateボタンでaria-busy属性がブロック到達
      タイミング次第で欠落する
      [#237](https://github.com/morichikawa/chainviz/issues/237)
- [x] 送金フォーム(TransferForm)の宛先にクライアント側のアドレス形式
      バリデーションが無い
      [#236](https://github.com/morichikawa/chainviz/issues/236)
- [x] describeSyncStageがObject.prototypeの継承メンバを漏らす可能性がある
      (describeNodeRoleと同種の穴)
      [#258](https://github.com/morichikawa/chainviz/issues/258)
- [x] デプロイtxで発生したイベント(mintのTransfer等)が復号されず生チップ
      表示になる
      [#244](https://github.com/morichikawa/chainviz/issues/244)
- [x] glossaryのlookup/parseにプロトタイプ汚染的なガード漏れの可能性
      (describeNodeRole/describeSyncStageと同種)
      [#264](https://github.com/morichikawa/chainviz/issues/264)
- [x] validator clientノードの同期状態が永久に「同期中」(blockHeight 0)と
      表示される(調査の結果、#215のnodeRole/showsSyncStateで解消済みを
      確認。コード変更なし)
      [#243](https://github.com/morichikawa/chainviz/issues/243)
- [x] 削除ボタンのaria-busy(removalPending)にも#237と同種の欠落バグがある
      [#263](https://github.com/morichikawa/chainviz/issues/263)
- [x] UI-CMD-01のaddNode成功判定が#215のsubtitle形式変更に追従しておらず
      常に失敗する
      [#270](https://github.com/morichikawa/chainviz/issues/270)
- [x] CLノード(beacon)の同期状態が永久に「同期中」(blockHeight 0)と
      表示される(Beacon API /eth/v1/node/syncingを情報源に
      syncStatus/blockHeight(=head_slot)を埋め、consensus役割の高さ行を
      「ヘッドスロット」表示に切り替えた。docs/worklog/issue-274.md参照)
      [#274](https://github.com/morichikawa/chainviz/issues/274)
- [x] fetchBeaconSyncingのhead_slotパースが非準拠値(空文字/null等)を
      静かに0として受理する(10進整数文字列または非負整数のJSON数値のみ
      受理するparseHeadSlotを新設し、それ以外はthrowするよう統一。
      docs/worklog/issue-282.md参照)
      [#282](https://github.com/morichikawa/chainviz/issues/282)
- [x] validatorがbeaconと視覚的に関連付けられておらず「浮いて見える」
      (既存のdrivesNodeIdを再利用しvalidator→beaconにも内部リンクエッジを
      描くよう実装。ARCHITECTURE.md §7.6.11・docs/worklog/issue-285.md参照。
      collector側(beaconStableIdForValidator新設・resolveDrivesNodeIdの
      フォールスルー化)・frontend側(役割組ごとのポップオーバー文言切替・
      InfraPopoverの駆動元行の一般化)とも実装完了。レビュー・QAとも合格)
      [#285](https://github.com/morichikawa/chainviz/issues/285)
- [x] 長時間稼働スタックの短時間再起動でgenesisが古いまま再利用され
      beaconが追いつき不能になる(再生成判定を「停止時間」から「genesis
      年齢+生存サンプリング」に置き換えて対応。実機検証で修正前の再現・
      修正後の解消、および#56/#148の既存保護の回帰無しを確認済み。
      docs/worklog/issue-286.md参照)
      [#286](https://github.com/morichikawa/chainviz/issues/286)
- [x] fetchConsensusPeerNodesが失敗ノードをログ無しで無言除外している
      (EL側と対称なconsole.errorを追加。連続失敗時は間引いてログする。
      docs/worklog/issue-287.md参照)
      [#287](https://github.com/morichikawa/chainviz/issues/287)
- [x] P2P接続エッジが1回のタイムアウトで即座に消え表示がちらつく
      (PeerObservationCacheを新設し、CL側ピアポーリングの連続失敗が猶予
      〔3 tick〕以内なら直前の成功観測を代用してエッジを維持するように
      した。猶予超過時は従来どおりエッジが消える。#287の失敗カウントは
      統合。実機検証で修正前の再現・修正後のヒステリシス動作（単発失敗で
      維持・猶予超過で消滅・回復）を確認済み。docs/worklog/issue-288.md参照)
      [#288](https://github.com/morichikawa/chainviz/issues/288)
- [x] 動的に追加したワークベンチでコントラクトデプロイが常に
      No contract foundで失敗する(workbenchSpec()にprofiles/ethereum/
      contractsを/contractsへbind mountするbindsを追加。静的ワークベンチ
      は元々マウント済みのため変更なし。実機検証で修正前の再現・修正後の
      成功を確認済み。docs/worklog/issue-293.md参照)
      [#293](https://github.com/morichikawa/chainviz/issues/293)
- [x] 送金操作の残高不足エラーがwei単位の生数値のまま表示され分かりにくい
      (operation-error-summary.tsのinsufficientFundsパターンをETH単位表示に
      変更した。変換ロジックはpackages/shared共通化ではなくcollector側
      `adapters/ethereum/ether-display.ts`に軽量実装(小数最大6桁切り捨て・
      末尾ゼロ削り)。実機検証で残高不足送金時にETH単位表示になることを
      確認済み。docs/worklog/issue-295.md参照)
      [#295](https://github.com/morichikawa/chainviz/issues/295)
- [x] フォーク（一時的な分岐）の色分け表現が未実装
      (既存のNodeEntity.headBlockHashを活用。collectorはeth_subscribe(newHeads)
      からHeadTipCache経由で埋め、frontendはparentHashの祖先関係比較で
      フォーク判定・色分け表現を行う。追加RPC・shared型変更なし。
      docs/worklog/issue-296.md参照)
      [#296](https://github.com/morichikawa/chainviz/issues/296)
- [x] ブロックが連なって積み上がっていく様子を視覚表現する
      (チェーン全体で1本の常設「チェーンリボン」をキャンバス内カードとして
      追加。直近8タイルが横一列に落下・着地・発光。親ブロック行の強調で
      parentHash連結を確認できる。第1段階(基本表示・着地)・第2段階(txチップ
      ⇔ブロックタイルのホバー連動ハイライト)ともQA合格。collector側は
      WorldStateStoreにブロック番号ベースの保持窓(BLOCK_RETENTION=32)を追加。
      ホバー中は表示窓の前進を凍結しハイライト対象タイルの窓外流出を防ぐ。
      既存のブロック伝播パルス・txライフサイクル表示は維持(補完する新規要素)。
      docs/worklog/issue-298.md参照)
      [#298](https://github.com/morichikawa/chainviz/issues/298)
- [x] A〜D層が常時同一キャンバスに共存し情報が読み取りにくい
      (chainviz-uxが「レイヤーレンズ」方式を設計。既定は全層共存のまま、
      ツールバー直下のチップバーでレイヤーを1つ選ぶとその層以外を薄く
      (dim)する単一選択の絞り込みを実装した。HUDパネル・ゴーストカード・
      接続確立中エッジ・新着発光中カードはレンズ対象外(#102/#220の教訓を
      維持)。ヘッダー副題「(A層)」を「(A層〜D層)」に修正、ポップオーバー
      見出しに層バッジを追加、用語`visualization-layers`を追加。
      packages/shared・collectorの変更なし。docs/worklog/issue-299.md参照)
      [#299](https://github.com/morichikawa/chainviz/issues/299)
- [x] subscribeBlocksが起動時のみ対象列挙しaddNodeで追加したノードに
      newHeads購読が張られない
      (subscribeBlocksをsubscribePeers/subscribeNodeInternalsと同じ周期
      リコンサイルループへ変更。新設した汎用WsSubscriptionReconciler
      （stableIdキーの購読レジストリ）で毎tick executionTargetsを取り直し、
      新規出現ノードには購読を開き、消滅ノードはcloseする。signature
      （wsUrl+receivedAtKeys）が変われば張り直す。副次効果としてremoveNode
      後に死んだコンテナへ無期限再接続していた潜在リークも解消。実機検証
      でaddNode後に動的追加ノードへブロック伝播パルスが実際に届くこと、
      removeNode後に再接続ログが繰り返されなくなることを確認済み。
      packages/shared変更なし。docs/worklog/issue-301.md参照)
      [#301](https://github.com/morichikawa/chainviz/issues/301)
- [x] WorldStateStoreのTransactionEntityが無制限蓄積しメモリを圧迫し得る
      (種別ごとに2系統の保持窓を追加。included/failed tx(blockHash あり)は
      applyTransactionの入口ガードで対応blockがstoreに存在するときだけ
      取り込み、applyBlockのeviction(BLOCK_RETENTION=32)と同じ差分でblock
      退去に連動して削除する。pending tx(blockHashなし)はblock eviction
      対象外とし、件数上限PENDING_TX_RETENTION=256で挿入順に間引く。
      linkTransactionToWalletsはapplyTransactionが取り込んだ場合のみ呼ぶ
      よう配線を見直した。packages/shared・frontendの変更なし。実機検証で
      送金操作によるtxの正常な取り込み・ブロック退去に連動したtxの退去を
      確認済み。docs/worklog/issue-303.md参照)
      [#303](https://github.com/morichikawa/chainviz/issues/303)
- [x] 用語集パネル(サイドパネルでの全用語一覧・検索・ジャンプ)が未実装
      (CONCEPT.mdに構想として記載されているが未着手。インラインの
      ホバーポップオーバーのみだと定義文が長い用語が読みにくい。着手時は
      まずchainviz-uxのUX設計から。Issue #321の汎用サイドパネル機構に
      `{kind:"glossary"}`を追加して相乗り。検索(ja/en名・key・現在言語の
      定義)+A〜D層グループ(YAML記載順)+単一展開アコーディオン+関連用語
      ジャンプ+レイヤーレンズ連動のチップを実装。ヘッダーに開閉トグル
      ボタンを追加、インラインのGlossaryTermもクリック/Enter/Spaceで
      同じパネルを開くよう変更。既存ポップオーバーは6行クランプ+
      「クリックで用語集を開く」フッター+関連用語の生キー表示を用語名
      表示に修正して共存。packages/shared・glossaryスキーマの変更なし)
      [#313](https://github.com/morichikawa/chainviz/issues/313)
- [x] ERC-721(NFT)の所有関係を可視化する
      (各tokenIdとウォレットが1対1で対応する所有関係は、既存のERC-20残高
      表示・秘密鍵の所有エッジとは異なる概念で未対応。着手時はまず
      chainviz-designerの設計から)
      [#315](https://github.com/morichikawa/chainviz/issues/315)
- [x] ノード間のリクエスト・レスポンスをログとして別タブで監視できるように
      する
      (キャンバスのカード・パルスは「今の状態」を見せるのに適するが、
      時系列に流れるログとして遡って追うことはできない。着手時はまず
      chainviz-uxのUX設計から。Issue #313(用語集パネル)とパネル機構を
      共有できないか検討の余地あり)
      [#317](https://github.com/morichikawa/chainviz/issues/317)
- [x] ウォレットのtx履歴に各txのnonce値が表示されず送信順序が追いにくい
      (nonceは現在値が1つ表示されるのみで、各tx項目には表示されていない。
      packages/sharedの型追加・collector側の観測追加が必要になる可能性あり)
      [#319](https://github.com/morichikawa/chainviz/issues/319)
- [x] ウォレットのtx履歴が直近6件に固定されスクロールで遡れない
      (ポップオーバーは保持されている分を全件描画しスクロール対応、
      カード面のチップ表示は6件のまま維持。collector側の保持上限も
      20→32に引き上げ)
      [#320](https://github.com/morichikawa/chainviz/issues/320)
- [x] デプロイされたコントラクトのソースコードを直接見れるようにする
      (現状ABI・カタログ情報のみで、Solidityソース自体は見られない。
      着手時はまずchainviz-designerの設計から。#313/#317と同様の別パネル
      UIの共有を検討する余地あり)
      [#321](https://github.com/morichikawa/chainviz/issues/321)
- [x] slot timeを現実のEthereum値(12秒)に戻す
      (values.envの3変数を12に変更、genesis再生成後に実機で12秒間隔の
      ブロック生成を確認。E2Eの固定待ち時間をslot timeから動的導出する
      よう修正、Issue #286の閾値は変更不要(安全側にしか動かない)。
      インジケータ部分はIssue #343へ分割済み)
      [#322](https://github.com/morichikawa/chainviz/issues/322)
- [x] ブロック生成タイミングのインジケータをチェーンリボンに追加する
      (Issue #322から分割。フロント側のみでBlockEntity.timestampの差分から
      GCDでinterval/anchorを導出しチェーンリボンカードのヘッダにカウント
      ダウン+進捗バーを表示、shared型変更・collector観測追加なし。E2E
      (SCENARIOS.md追記・Playwrightテスト)はフロント実装完了後に別途対応)
      [#343](https://github.com/morichikawa/chainviz/issues/343)
- [x] dev-up.shがdist鮮度の警告のみでpnpm buildを自動実行しない
      (check_build_freshnessがdist古と判定した場合に自動でpnpm buildを
      実行するよう変更した。dist/が存在しない場合と同様の自動化)
      [#325](https://github.com/morichikawa/chainviz/issues/325)
- [x] UI全体に透明感・グラデーションを意識したビジュアルデザインを
      取り入れる
      (chainviz-uxが「静かな夜のガラス」方針を設計し、chainviz-frontendが
      実装。オーバーレイパネル・ポップオーバー・トーストにすりガラス
      (backdrop-filter)、カード群には縦グラデーション+上端ハイライト、
      背景に淡い色光のラジアルグラデーションを適用。役割別の枠色・エッジ色・
      状態色の意味体系は変更なし)
      [#327](https://github.com/morichikawa/chainviz/issues/327)
- [x] ノード/コンポーネントをドラッグ中にWebSocket更新で位置がガクンと
      ずれる/戻る
      (chainviz-detectiveが原因を特定: Canvas.tsxのuseEffectが親から渡された
      nodesでrfNodesを丸ごと置き換え、ドラッグ中のローカルposition・
      draggingフラグが破棄されていた。preserveMeasuredDimensionsと同系の
      マージ関数preserveDraggingStateを追加し、ドラッグ中ノードのみ
      position・dragging・selectedを直前のReact Flow内部状態から引き継ぐ
      よう修正)
      [#328](https://github.com/morichikawa/chainviz/issues/328)
- [x] mempool(未承認tx)全体を俯瞰できるビューが無い
      (pending txは局所表示のみだったため、mempool全体を俯瞰する常設
      パネルをfrontendに追加した。shared型変更・collector変更は不要。
      アドレス表記の大文字小文字差異照合バグをレビューで1回差し戻し・
      修正済み)
      [#330](https://github.com/morichikawa/chainviz/issues/330)
- [x] removeWorkbenchがaddWorkbenchで追加したワークベンチに対しても
      「追加されていない」エラーを返すことがある
      (Issue #319のQA検証中に偶発的に観測。chainviz-detectiveの調査により
      Issue #366と同一原因(stableId重複による操作の誤配送)の派生症状と
      判明。#366の修正で解消)
      [#334](https://github.com/morichikawa/chainviz/issues/334)
- [x] 英語モードでp2p-legendの凡例文が日英混在になっている
      (Issue #327のQA検証中に偶発的に観測。原因はglossary/ではなく、
      legend.hint.suffixの意図的な空文字en訳とpickLocale()の空文字
      フォールバック仕様の衝突。#327のCSS変更とは無関係の既存不具合。
      translate()をpickLocale()経由からentry[lang]直接参照に変更して
      修正し、pickLocale()自体はglossaryデータ向けの防御として現行維持)
      [#341](https://github.com/morichikawa/chainviz/issues/341)
- [x] UI層E2Eテストの一部が実.hover()依存・描画安定性不足でflakyになりうる
      (Issue #322のQA検証中に偶発的に観測。UI-C-04/UI-CMD-07/UI-ERR-02/
      UI-D-03で個別再現。slot time変更とは無関係の既存のテスト脆さ。
      UI-C-04/UI-D-03はIssue #245のportal化でlocatorスコープが壊れて
      いたことが判明し修正、UI-ERR-02はIssue #235の修正にテストが
      追随していなかったことが判明し修正。UI-CMD-07(削除ボタンが
      stableにならない)は原因不明のまま再現できず、Issue #373として分割し、
      #373の修正取り込み後にクリーンスタックで解消を確認)
      [#346](https://github.com/morichikawa/chainviz/issues/346)
- [x] UI-CMD-07: ワークベンチ削除ボタンがE2E上でstableにならないことがある
      (Issue #346から分割。chainviz-detectiveが独立した合成環境で原因を
      特定: 実際は削除ボタンがビューポート外にありPlaywrightのクリックが
      永久リトライしていた。根本原因はReact Flowの`fitView` propが
      ワールドステート到着前から存在するチェーンリボン1枚だけに対して
      発火し、zoomが最大値に張り付いたまま再フィットされないタイミング
      競合。`fitView` propをやめ、最初のスナップショット反映・全ノード
      計測完了後に`fitView({ maxZoom: 1 })`を1回だけ呼ぶ方式に変更して
      解消。この本質修正自体はQAが実Docker+実ブラウザで修正前後の挙動を
      確認済み。e2e側は`support/viewport.ts`の`fitCanvasView`ヘルパーを
      UI-MULTI-01・cleanup.tsの安全網に適用したが、QA検証でUI-MULTI-01への
      適用箇所(pageBロード後にdiffで追加されたカードが対象)に回帰が見つかり
      (フィット直後、対象カードがReact Flowの内部計測ストアへ未反映のまま
      フィットすると対象が視野外になる窓がある)、`fitCanvasView`を
      「対象が実際に視野内へ入るまでフィットボタンを再試行する」方式に
      差し戻し修正した)
      [#373](https://github.com/morichikawa/chainviz/issues/373)
- [x] チェーンリボンの「親ブロック」行ホバー強調が実質使えない
      (ホバーが約200msで閉じる。Issue #313のUX設計中にchainviz-uxが実測で
      発見。Issue #298の「既知の残課題」で既に言及されていた問題が今回
      顕在化。ポップオーバーをホバー対象タイルのReactツリー子として描く
      既存パターンへ合流し解消。1回目のQAで発見した二重強調(ホバー中
      タイル自身も同時に強調される)は自己強調抑制で解消し2回目のQAで
      合格。副次的に発見したUI-B-06の併走時flakyは#351非依存の既存課題
      としてIssue #388へ分離)
      [#351](https://github.com/morichikawa/chainviz/issues/351)
- [x] ノード間通信ログにRPC呼び出しのレスポンス(成否・所要時間)を追加する
      (Issue #317第1弾の設計時にchainviz-uxが分割した論点。
      OperationEdgeへのフィールド追加(shared型変更)とロギングプロキシからの
      レスポンス観測(collector変更)を伴うため、フロントのみで完結する
      第1弾からは分離。designer設計→collector/frontend並行実装→テスト強化→
      レビュー→i18nレビュー→QA(実Docker環境で成功/失敗両ケースの観測と
      表示を確認)まで完了)
      [#352](https://github.com/morichikawa/chainviz/issues/352)
- [x] docker compose down -v後もEOA(ウォレット)が削除されずに残る
      (原因特定済み: collectorがチェーンリセット(genesis変更)を検知して
      C層エンティティ(wallet/contract)をパージする仕組みが無い。詳細は
      docs/worklog/issue-357.md。collector側の実装完了。genesisハッシュの
      変化を検知するChainResetWatcherを追加し、検知時にアダプタ内部
      キャッシュとワールドステートのwallet/contract/block/transactionを
      パージする)
      [#357](https://github.com/morichikawa/chainviz/issues/357)
- [x] addNode/addWorkbenchで作成したmanagedコンテナがdocker compose
      down -vでも削除されない
      (根本原因を特定: `com.docker.compose.config-hash`ラベルが無い
      コンテナはproject/serviceラベルが正しくてもDocker Compose自体から
      一切認識されず、`--remove-orphans`を付けても孤児として検出されない。
      node-lifecycle.tsのaddNode/addWorkbenchが作るコンテナにこのラベルを
      追加し、`docker compose down -v --remove-orphans`で完全に片付く
      ことを実機確認(修正前後の差分を実際のコード・実Dockerで再現・
      解消確認)。READMEとdocker-compose.ymlの片付け手順も
      `--remove-orphans`必須に更新。詳細はdocs/worklog/issue-359.md)
      [#359](https://github.com/morichikawa/chainviz/issues/359)
- [ ] サイドパネル(コントラクトソース表示・用語集表示)の幅をリサイズ
      できるようにする
      (ユーザーからの要望。現状は幅固定(ARCHITECTURE.md §12.2に「400px
      目安」と記載)。ドラッグリサイズハンドル・幅の永続化要否・最小/
      最大幅が論点。`contractSource`/`glossary`/`commsLog`のkindによらず
      共通シェル(`SidePanel.tsx`)で一括対応できる見込み)
      [#362](https://github.com/morichikawa/chainviz/issues/362)
- [ ] サンプルコントラクトのトークンシンボル(CVZ等)がSolidityの定数で
      ハードコードされておりデプロイ時に変更できない
      (ユーザーからの指摘。ChainvizToken.solの`symbol = "CVZ"`が定数で、
      コンストラクタ引数はinitialSupplyのみ。「CVZ」が一般的なブロック
      チェーン用語に見えてしまう。name/symbolのコンストラクタ引数化、
      または表記変更が論点。catalog.json・operationCatalog.ts・
      mockData.ts等CVZに依存する既存コードへの影響範囲の洗い出しが必要)
      [#364](https://github.com/morichikawa/chainviz/issues/364)
- [x] 追加ワークベンチの命名が静的ワークベンチと衝突する
      (コンテナ名409・stableId重複による操作の誤配送)
      (ユーザーが実際のワークベンチ追加・送金操作で遭遇。chainviz-detective
      が原因調査済み(docs/worklog/meta.md)。静的ワークベンチがlifecycle
      レジストリから不可視なのに、コンテナ名・service名を占有している
      ことが根本原因。コンテナ名はDocker自身の名前衝突検出(409)を利用した
      リトライへ、service名(stableId)は静的ワークベンチを含むDocker上の
      実在コンテナとの照合へ変更して解消。実機の隔離環境で修正前の再現・
      修正後の解消(409にならない・stableId重複なし・removeWorkbenchが
      1回で完了)を確認済み。詳細はdocs/worklog/issue-366.md)
      [#366](https://github.com/morichikawa/chainviz/issues/366)
- [ ] GlossaryTermのキーボード操作(Space)でpreventDefaultが呼ばれず
      ページスクロールし得る
      (Issue #313のテスト強化中にchainviz-testerが発見した軽微なa11y
      問題。`role="button"`を持つ`<span>`でSpaceを押すとブラウザ既定の
      ページスクロールが起きうる。`GlossaryTerm.tsx`のSpace/Enter
      ハンドラにpreventDefault()を追加する)
      [#353](https://github.com/morichikawa/chainviz/issues/353)
- [ ] i18n translate()にObject.prototype由来キー(toString等)への防御が無い
      (Issue #341のレビュー中に発見。型`MessageKey`により通常のコードから
      到達不能で#341以前からの既存挙動だが、既存の`format()`と同じく
      `hasOwnProperty`ガードを追加する軽微な堅牢性向上)
      [#371](https://github.com/morichikawa/chainviz/issues/371)
- [ ] 用語集パネルのフォントサイズを変更できるようにする
      (ユーザーからの要望。フォントサイズ変更UIの要否・設定の永続化要否・
      他のサイドパネルへの適用範囲が論点)
      [#377](https://github.com/morichikawa/chainviz/issues/377)
- [ ] UI-C-06: workbenchのETH_RPC_URLがdev collectorプロキシ(4001)に固定で
      UI E2E単独実行時に到達できない
      (Issue #346の最終QA検証中に偶発的に観測。dev collectorを別途起動
      していないクリーン環境ではUI-C-06のセットアップ(forge create)が
      host.docker.internal:4001へConnection refusedで失敗する。E2E
      collector(4125/4126)とworkbenchのRPC向き先が一致しない環境結合。
      着手時はまずchainviz-designerによる設計を先行させる)
      [#381](https://github.com/morichikawa/chainviz/issues/381)
- [ ] addWorkbench(createAndStart)でcontainer.start()失敗時に作成済み
      コンテナがorphanとして残留する
      (Issue #369の最終QA検証中に偶発的に観測。存在しないネットワークを
      指定した場合等にstartが失敗しても、作成済みのCreated状態コンテナが
      削除されない。addNodeは事前にネットワーク存在確認をするためこの
      経路では発生しない。通常運用では発生しないが、Issue #369で
      「未用意のprojectを指させる」使い方が可能になったため顕在化しうる)
      [#385](https://github.com/morichikawa/chainviz/issues/385)
- [ ] UI-B-06(chain-ribbon.spec.ts)がUI-B-05との併走時に間欠的にflakyになる
      (Issue #351の最終QA検証中に偶発的に観測。単独実行では安定合格。
      #351のコード変更には起因せず、対象ブロックが表示窓から流れ出るまで
      の時間との既存由来のタイミング競合(issue-298.mdに既出)が、併走時の
      負荷で顕在化しやすくなると考えられる。Issue #346と同種の問題であり
      対応方針を踏襲できないか検討する)
      [#388](https://github.com/morichikawa/chainviz/issues/388)

## 運用ルール（全ステップ共通）

- 1 ステップ = 1 つ以上のコミット。Conventional Commits 形式
- サブ項目を完了したらその場でチェックを付ける（進捗はチェックボックスで
  管理し、まとめての更新はしない）
- ステップ完了時に sync-docs スキルで docs/ を確認する
- 各 Phase が単体で「動くデモ」になることを優先し、先の Phase のための
  先回り実装をしない（CLAUDE.md 参照）
- ステップ 10 以降、UI に見える機能を実装するステップには
  「`packages/e2e/SCENARIOS.md` への UI シナリオ追記 + Playwright テストの
  実装」のチェックボックスを含める（2026-07-08 ユーザー指示「これからも
  ちゃんと追加すること」。`docs/ARCHITECTURE.md` §8.4）
