### 2026-07-08 Issue #167 設計メモ（実装着手前）

- 担当: frontend
- ブランチ: issue-167-operation-ui
- 前提: `docs/ARCHITECTURE.md` §6.5（Issue #157で確定済み）、`WorkbenchOperation`
  型（`packages/shared/src/protocol/index.ts`、Issue #163で実装済み）。

**コンポーネント構成・データフローの方針**（実装前にまとめる）:

1. **フォーム定義データの置き場所**: §6.5/§6.10の決定どおり、
   `packages/frontend/src/chain-profiles/ethereum/operationCatalog.ts`
   （新設）に静的データとして持つ。ABIそのものではなく「UIフォーム組み立てに
   必要な最小情報」（表示名・一言説明・コンストラクタ引数・関数シグネチャ
   （`cast send`にそのまま渡す完全形。例: `transfer(address,uint256)`）・
   引数名・引数の入力補助種別（`address`のみUI補助対象）・payableか）に
   絞る。`catalogKey`は`profiles/ethereum/contracts/catalog.json`のキー
   （`ChainvizToken`/`Counter`）・collectorの`ContractEntity.catalogKey`/
   `WorkbenchOperation.deployContract.contractKey`と完全一致させる（値が
   ずれるとデプロイのforge解決・呼び出し対象の照合が両方壊れる）。
2. **ETH→wei変換**: `packages/frontend/src/operations/etherAmount.ts`に
   純粋関数`parseEtherToWei`を置く。送金の金額欄・呼び出しのpayable金額欄の
   2箇所から使う。コンストラクタ引数・呼び出し引数（address/uint等）は
   ABIの型情報をフロントが持たない設計のため、ETH換算はせず生のテキスト
   入力のまま渡す（§6.5の記述どおり「引数名をラベルにしたテキスト入力」）。
3. **候補一覧（既存ウォレット・呼び出し可能なコントラクト）の受け渡し**:
   React Flowのカスタムノード（`InfraNodeCard`）の内側から開くパネルが
   必要とするが、`data`経由（`entitiesToFlowNodes`の出力）には**乗せない**。
   理由: `App.tsx`は`stabilizeNodes`（Issue #119）で「entity/positionが
   変化していないノードは前回のオブジェクト参照を再利用する」ため、
   候補一覧をnode.dataに含めると、対象ワークベンチ自体に変化が無い間は
   新しいウォレット/コントラクトの出現が反映されない事故になる。代わりに
   `operations/OperationDataContext.tsx`という専用Reactコンテキストを新設し
   （`CommandActionsContext`と同じ「React Flowノードの内側からキャンバス
   全体の状態へアクセスする」パターン）、`App.tsx`が`entities`から
   `useMemo`で導出した最新の一覧を都度渡す。パネルが開いているときだけ
   このコンテキストを読むため、閉じているカードへの余分な再レンダーは
   発生しない。
4. **コンポーネント分割**（1ファイル1責務、テストファイルも分割）:
   - `chain-profiles/ethereum/operationCatalog.ts`: 型+静的データ（純粋）
   - `operations/etherAmount.ts`: ETH→wei変換（純粋）
   - `operations/walletCandidates.ts`: 送金先・アドレス引数の候補導出（純粋）
   - `operations/deployedContracts.ts`: 呼び出し対象コントラクトの候補導出
     （純粋。カタログ既知のみ）
   - `operations/OperationDataContext.tsx`: 上記2つの候補一覧を配るコンテキスト
   - `operations/AddressField.tsx`: アドレス入力の共通部品（`<datalist>`で
     候補提示+自由入力）
   - `operations/TransferForm.tsx` / `DeployForm.tsx` / `CallForm.tsx`:
     各タブのフォーム（値の組み立てのみ担当し、コマンド発行はしない。
     `onSubmit`で親に値を渡す）
   - `operations/OperationPanel.tsx`: 3タブの切り替え・Esc/外側クリック/
     ×での close・`useCommandActions().runWorkbenchOperation`の実際の発行
   - `entities/InfraNodeCard.tsx`: workbenchカードにのみ起動ボタンを追加し、
     開閉状態(`useState`)だけを持つ。ボタン自体はホバー予告
     （既存`ActionHint`パターン）+ 保留中スピナー（既存`isNew`と同じ
     「時間・状態に依存する派生フラグの後付け」方式）を持つ
5. **保留中スピナーの状態管理**: `useCommands.ts`に
   `pendingOperationWorkbenchIds: Set<string>`を追加する。addNode/
   addWorkbench時のゴースト管理と同様、`commandId -> Command`のpendingRef
   に加えて`workbenchId -> 保留中カウント`のstateを持ち、dispatch時に
   +1、`commandResult`（成否問わず）で-1する。カウントにするのは
   「二重送信防止ではない」（§6.5決定事項）ため同一ワークベンチから複数
   操作が同時に飛びうるのを許容するため。ノードの`data`への反映は
   `isNew`と同じ「stabilizeNodesの後段で後付け」方式（`App.tsx`）にする。
6. **デプロイの仮カード**: `entities/ghostNode.ts`の`GhostKind`に`"contract"`
   を追加し、`deployContract`コマンド送信時に`catalogKey`（=表示名兼用）を
   持つゴーストを`CONTRACT_GRID`へ配置する。`entityAdded`（contract）の
   到着時、`catalogKey`一致で対応するゴーストを消し、一致しなければ
   （§6.5「対応が取れないときはFIFO近似」）最古のcontractゴーストを消す
   （node/workbenchの既存フォールバック方式と同じ設計判断）。
7. **モックデータ**: `websocket/mockData.ts`の`runWorkbenchOperation`が
   現状`ok:false`固定なので、実際に成功/失敗をシミュレートするよう変更する
   （transfer: 宛先必須のみ検証、deployContract: カタログキーの存在検証+
   新規`ContractEntity`のentityAdded diff、callContract: 対象アドレスが
   デプロイ済み・カタログ既知か検証）。あわせて、既存モックの
   `catalogKey`が実カタログ（`chainviz-token`/`counter`）と食い違って
   いた不具合（本来は`ChainvizToken`/`Counter`と完全一致させる設計）も
   このIssueの範囲内で修正する（呼び出しタブの照合ロジックが実環境と
   噛み合わなくなるため）。

**未確定事項として実装時に判断すること**: なし（上記で設計判断は出尽くして
いる）。実装の途中で`packages/shared`の型変更が必要になった場合は
`chainviz-reviewer`と調整する方針（CLAUDE.md）を守る（が、想定では
`WorkbenchOperation`は既存のまま変更不要）。

---

### 2026-07-08 Issue #167 定型操作UI（送金・デプロイ・コントラクト呼び出し）の実装

- 担当: frontend
- 内容: 上記設計メモどおりに実装した。

**新規ファイル**:
- `packages/frontend/src/chain-profiles/ethereum/operationCatalog.ts`
  （+テスト）: `ContractCatalogEntry`/`OperationFunctionForm`/
  `OperationArgField`型と、`ETHEREUM_OPERATION_CATALOG`
  （ChainvizToken: constructor(initialSupply)、transfer/approve/
  transferFrom/mint。Counter: constructor無し、increment/incrementBy/
  reset）。関数は「呼び出す意味のある非view関数」のみ掲載（`cast send`で
  呼ぶ想定のため、view/pure関数は対象外）。
- `packages/frontend/src/operations/etherAmount.ts`（+テスト16件）:
  `parseEtherToWei`。10進の整数/小数のみ許可、18桁を超える小数部・符号・
  指数表記・空文字は`undefined`を返す。
- `packages/frontend/src/operations/walletCandidates.ts`（+テスト）:
  `deriveWalletCandidates(entities)`。ウォレットのアドレス+所有ワークベンチ
  ラベル（無ければアドレスのみ）を`shortHex`込みで返す。
- `packages/frontend/src/operations/deployedContracts.ts`（+テスト）:
  `deriveDeployedContracts(entities, catalog)`。`ContractEntity.catalogKey`
  がカタログに存在するもの（=呼び出しフォームを組み立てられるもの）のみ
  候補にする。
- `packages/frontend/src/operations/OperationDataContext.tsx`: 上記2つの
  候補一覧を配る専用コンテキスト（設計メモの理由により、React Flowノードの
  dataには含めない）。
- `packages/frontend/src/operations/AddressField.tsx`: アドレス入力の
  共通部品。`<input list=...>` + `<datalist>`で候補提示しつつ自由入力も
  許可する（ネイティブのdatalistを使うことでアクセシビリティ・実装量の
  両面で最小限に抑えた）。
- `packages/frontend/src/operations/TransferForm.tsx` /
  `DeployForm.tsx` / `CallForm.tsx`（各+テスト）: 各タブのフォーム。
  `CallForm`はpayableな関数を選んだときだけ金額欄を出し、呼び出し可能な
  コントラクトが0件のときは`operation.call.empty`メッセージ+「デプロイ」
  タブへの切り替えボタンを出す。
- `packages/frontend/src/operations/OperationPanel.tsx`（+テスト）:
  3タブの切り替え（`operation-tab-*`のtestid）、Esc・外側クリック（`document`
  へのグローバルリスナー）・×ボタンでの close、各フォームの送信時に
  `useCommandActions().runWorkbenchOperation(workbenchId, operation)`を
  呼んで即座にpanelを閉じる。`nodrag nowheel nopan`をルート要素に付与し、
  React Flowのドラッグ・ズームと競合しないようにした。
- `packages/frontend/src/entities/InfraNodeCardOperationButton.test.tsx`
  （新規）: `InfraNodeCard`の操作ボタン・パネル開閉・保留スピナーに絞った
  テスト（既存`InfraNodeCard.test.tsx`の肥大化を避けるため分割）。
- `packages/frontend/src/commands/useCommandsWorkbenchOperations.test.tsx`
  （新規）: `useCommands.ts`の`runWorkbenchOperation`保留追跡・デプロイの
  仮カード生成/削除に絞ったテスト（同様に既存`useCommands.test.tsx`を
  肥大化させないため分割）。
- `packages/frontend/src/websocket/mockData.workbenchOperations.test.ts`
  （新規）: モックの`runWorkbenchOperation`シミュレーションのテスト。
- `packages/frontend/src/app/App.workbenchOperations.test.tsx`（新規）:
  実際の`createMockClient`+`<App>`を丸ごとマウントし、「ワークベンチカードの
  ボタン→パネル→送信→モック応答→仮カードが実カードに置き換わる」までの
  配線をend-to-endに近い形で確認する統合テスト。jsdomに`ResizeObserver`が
  無いため、このファイルだけスタブを補っている（他の全テストは
  `ReactFlowProvider`のみでReact Flowの実ビューポート（`<ReactFlow>`本体）を
  マウントしないため今回初めて必要になった。グローバルなvitest設定は
  変更していない）。

**既存ファイルの変更**:
- `packages/shared/src/protocol/index.ts`: 変更なし（Issue #163で実装済み
  の`WorkbenchOperation`をそのまま使えた）。
- `packages/frontend/src/commands/useCommands.ts`: `CommandActions`に
  `runWorkbenchOperation`を追加。`pendingOperationCounts`
  （`Map<workbenchId, count>`）と、そこから導出する
  `pendingOperationWorkbenchIds: Set<string>`を追加し戻り値に含めた。
  `deployContract`送信時は`entities/contractNode.ts`の`CONTRACT_GRID`へ
  仮カード（`kind: "contract"`）を追加する（node/workbenchの仮カードと
  同じ「既存カード数を下限にした単調増加インデックス」方式だが、
  グリッドが異なるため専用の`contractGhostIndexRef`を持つ）。
- `packages/frontend/src/entities/ghostNode.ts`: `GhostKind`に`"contract"`
  を追加。`GhostNodeData`/`CreateGhostNodeParams`に`catalogKey`を追加。
  `ArrivedInfraEntity`を判別共用体化し`{kind:"contract", catalogKey?}`を
  追加、`removeGhostForArrivedEntity`に`catalogKey`一致優先→FIFO近似
  フォールバックの分岐を追加。
- `packages/frontend/src/entities/GhostNodeCard.tsx`: contract種別の表示
  （「デプロイ中… {name}」。サブタイトルは持たない）を追加。
- `packages/frontend/src/entities/infraNode.ts`: `InfraNodeData`に
  `operationPending?: boolean`を追加（`isNew`と同じ、時間/状態依存の
  派生フラグとして`entitiesToFlowNodes`自体は持たず、`App.tsx`が後付け）。
- `packages/frontend/src/entities/InfraNodeCard.tsx`: workbenchのみ
  「操作を実行…」ボタン（`ActionHint`で予告、保留中はスピナー+
  「(実行中…)」）+ 開閉状態 + `OperationPanel`を追加。ボタンの
  `width:100%`のためのCSSラッパー（`.infra-card__operate-wrapper`）を
  追加（`ActionHint`の`.action-hint`が共有クラスで`display:inline-block`
  のため、そのままだと中の`width:100%`ボタンが効かない問題への対応）。
- `packages/frontend/src/commands/commandMessages.ts`:
  `resolveWorkbenchOperationsHint`を追加（addNode/addWorkbenchの
  `resolveXxxHint`と同型。rpcTarget解決不能ならgenericへフォールバック）。
- `packages/frontend/src/app/App.tsx`: `OperationDataProvider`を
  `CommandActionsProvider`の内側に追加。`walletCandidates`/
  `deployedContracts`を`entities`から`useMemo`導出。
  `pendingOperationWorkbenchIds`を`useCommands`の戻り値に追加し、
  `infraNodesWithHighlight`の後付け処理に`operationPending`も合流させた
  （`isNew`と同じ場所・同じ「変化した時だけ新しいオブジェクトにする」方式）。
- `packages/frontend/src/i18n/messages.ts`: ARCHITECTURE.md §6.8の
  操作パネル関連キー一式（`action.workbenchOperations*`・
  `operation.tab.*`・`operation.transfer.*`・`operation.deploy.*`・
  `operation.call.*`・`operation.pending`・`ghost.contract.deploying`）
  を追加。加えて初稿には無かった`operation.close`
  （パネルの×ボタン用）・`operation.transfer.amount.invalid`
  （不正なETH入力時のバリデーションメッセージ）・
  `operation.address.freeInputHint`（未使用。将来アドレス欄に補足文言を
  出す場合に備えて用意したが今回のUIでは使っていない。**次の担当が
  使わないなら削除を検討してよい**）を追加した。
- `packages/frontend/src/styles.css`: `.infra-card__operate*`（起動ボタン・
  保留スピナー）・`.operation-panel*`（パネル本体・タブ・フォーム・
  バリデーションエラー）のスタイルを追加。
- `packages/frontend/src/websocket/mockData.ts`: `runWorkbenchOperation`を
  実際にシミュレートするよう変更（transfer: 宛先必須検証のみ。
  deployContract: `MOCK_DEPLOYABLE_CATALOG`（ChainvizToken/Counter）に
  存在するcontractKeyのみ成功し、新しい`ContractEntity`の`entityAdded`
  diffを返す。callContract: `deployedContractCatalogKeys`
  （初期スナップショットの2件+デプロイ成功のたびに追加）に存在する
  アドレスのみ成功）。あわせて既存の初期コントラクトサンプルの
  `catalogKey`（`chainviz-token`→`ChainvizToken`、`counter`→`Counter`）・
  `token.symbol`（`CVT`→`CVZ`）を実カタログ（`profiles/ethereum/contracts/
  catalog.json`）と完全一致するよう修正した（この不一致は本Issueで
  操作パネルの呼び出しタブを実装するまで実害が無かったため見過ごされて
  いたバグで、他の消費コードは無いことを確認済み）。

**決定事項・注意点**:
- **`WorkbenchOperation.deployContract.contractKey`は「forge createの
  CONTRACT位置引数」と「カタログ照合キー」を兼ねる**（collector側
  `workbench-operations.ts`/`node-lifecycle.ts`の既存実装どおり、Issue
  #163で確定済み）。したがって`operationCatalog.ts`の`catalogKey`は
  `profiles/ethereum/contracts/catalog.json`のトップレベルキーと1文字も
  違えず一致させる必要がある。今回`ChainvizToken`/`Counter`で統一した。
- **呼び出し関数はview/pure関数を除外**した（ChainvizTokenの`balanceOf`/
  `decimals`/`name`/`owner`/`symbol`/`totalSupply`/`allowance`は掲載せず、
  `transfer`/`approve`/`transferFrom`/`mint`のみ）。GUIの定型操作は
  `cast send`（tx送信）を前提としており、読み取り専用関数を送信すると
  無駄なガス消費になるだけで意味のある観測（tx確定・イベント）を生まない
  ため。将来「残高を読む」UIが欲しくなった場合は`cast call`相当の別経路
  （本Issueのスコープ外）が必要になる。
- **コンストラクタ引数・呼び出し引数はETH換算しない**。ETH単位入力+wei変換
  （§6.10決定事項3）が適用されるのは「送金」タブの金額欄と「呼び出し」タブの
  payable金額欄の2箇所のみで、それ以外の引数（例:
  ChainvizTokenのinitialSupply、transferのamount）はABI上の生の数値
  （トークン自身の最小単位）をそのままテキスト入力する。ARCHITECTURE.md
  §6.5の「引数はテキスト入力」という記述に沿った判断。
- **保留中フラグはワークベンチ単位のカウント**で管理し、bool一枚では
  なくした。「二重送信防止ではない」（§6.5）ため同一ワークベンチから
  複数の操作が並行して飛びうる。カウントが0に戻るまでスピナーを維持する
  ことで、片方が先に解決してももう片方が終わるまで「実行中…」が消えない
  ようにした。
- **デプロイの仮カードの対応付けは近似**（catalogKey一致→無ければFIFO）。
  無関係なコントラクトの到着でデプロイ中の仮カードが早期に消えることが
  ありうる（既存のnode/workbenchゴーストのclientType不一致フォールバックと
  同じ設計判断・同じ限界。`useCommandsWorkbenchOperations.test.tsx`の
  「removes a pending deploy ghost via FIFO fallback when a non-matching
  contract arrives」で挙動を明示的にテスト化している）。
- **操作パネルはワークベンチカードの`data`ではなくReact Contextから候補を
  読む**設計にした（設計メモの理由どおり）。もし将来他の目的でも同様の
  「カード内から最新のキャンバス全体状態を読みたい」ニーズが出た場合は、
  `CommandActionsContext`/`OperationDataContext`と同じパターンを踏襲する
  こと。
- 実際に`pnpm --filter @chainviz/frontend dev`でモックデータを起動し
  `curl`で200応答を確認、`vite build`（`build:web`）でも警告なく
  ビルドできることを確認した。ただし本セッションの環境には
  Playwright/Chromiumが用意できず実ブラウザでの目視確認は行っていない
  （Issue #166のworklogにある手順が今回は使えなかった）。代わりに
  `App.workbenchOperations.test.tsx`（実際の`createMockClient`+`<App>`を
  丸ごとマウントする統合テスト）で「ボタン押下→パネル操作→送信→
  モック応答→仮カードが実カードに置き換わる」までの実際の配線を
  検証した。**次のQA担当は実ブラウザでの目視確認を必ず行うこと**
  （フォームのレイアウト崩れ・ポップオーバーの位置など、DOM構造だけでは
  検証できない見た目の問題が無いか）。
- 新規・変更したテスト:
  `operationCatalog.test.ts`・`etherAmount.test.ts`・`walletCandidates.
  test.ts`・`deployedContracts.test.ts`・`AddressField`（専用テストは
  作らず、利用側の`TransferForm.test.tsx`/`CallForm.test.tsx`経由で
  カバー）・`TransferForm.test.tsx`・`DeployForm.test.tsx`・
  `CallForm.test.tsx`・`OperationPanel.test.tsx`（いずれも新規）、
  `ghostNode.test.ts`・`GhostNodeCard.test.tsx`・`commandMessages.test.ts`
  （既存ファイルへ追加）、`useCommandsWorkbenchOperations.test.tsx`・
  `InfraNodeCardOperationButton.test.tsx`・
  `mockData.workbenchOperations.test.tsx`・
  `App.workbenchOperations.test.tsx`（いずれも新規、既存の同名ファイルの
  肥大化を避けるため分割）。
- 確認結果: `pnpm lint`（clean）・`pnpm build`（shared/collector/frontend/
  e2e全パッケージ成功）・`pnpm test`（shared 40件・collector 34ファイル・
  frontend 73ファイル1119件・e2e 全件成功）をリポジトリ全体で確認した。
- `docs/PLAN.md`ステップ8の該当チェックボックスを更新した。

**次の担当（tester/reviewer/qa）への申し送り**:
- 未使用の`operation.address.freeInputHint`メッセージキーの要否を判断
  してほしい（上記参照）。
- `AddressField.tsx`自体には専用ユニットテストを置いていない（JSX組み立てのみで
  分岐ロジックが無いため）。`TransferForm`/`CallForm`のテストが実質的な
  カバレッジになっている。
- QAは実ブラウザでの目視確認を行うこと（本セッションではPlaywright/
  Chromiumが使えなかったため未実施）。

---

### 2026-07-08 Issue #167 テスト強化（tester）

- 担当: tester
- 内容: 実装担当が用意した基本テスト（ハッピーパス中心）に対し、異常系・
  境界値・エッジケースの観点でテストを追加した。実装コードは変更していない。

**追加したテスト**:
- `chain-profiles/ethereum/operationCatalog.test.ts`: `ETHEREUM_OPERATION_CATALOG`
  を実データ `profiles/ethereum/contracts/catalog.json` の ABI と機械的に
  突き合わせる回帰テストを4件追加（catalogKey の存在・コンストラクタ引数の
  名前/順序/型・state 変更関数の過不足（view/pure 除外）・各関数の引数名/型/
  payable 判定）。カタログ JSON はパッケージ外にあるため、実行時 cwd から
  上へたどって解決する。実装担当が報告した「catalogKey の食い違い修正」の
  回帰ガード。意図的に catalogKey を壊すと6件が失敗することを確認してから
  元に戻した。
- `operations/etherAmount.test.ts`: 境界値・不正入力を11件追加（先頭ゼロ、
  redundant な `00.5`、`0.0`→`0`、小数部の trailing zero、整数部+18桁小数の
  合わせ技、`+` 符号、桁間の空白、カンマ小数点/桁区切り、`0x` 始まりの16進）。
- `entities/ghostNode.test.ts`: contract ゴーストの同一 catalogKey 同時デプロイ
  で「最古の1枚だけ消し過剰に消さない」こと、別種ゴーストが先頭にあっても
  catalogKey 一致を優先し取り違えないことを2件追加（Issue #113 の教訓）。
- `commands/useCommandsWorkbenchOperations.test.tsx`: deployContract も
  ワークベンチを保留状態にすること、および CONTRACT_GRID でも「デプロイ→
  実体到着（count=1）→削除（count=0）→再デプロイ」で count が下がっても
  仮カードの位置が衝突しないこと（Issue #113 の算術回帰）を2件追加。
- `operations/CallForm.test.tsx`: functions が空のカタログでも落ちず送信不可に
  なること、引数なし非 payable 関数の最小送信パスを2件追加。
- `operations/DeployForm.test.tsx`: コンストラクタ引数はフロントで型検証せず
  生文字列のまま渡すこと、必須引数を空のまま送っても阻止しないこと
  （型不一致・欠落の判定は collector 側の設計）を2件追加。
- `i18n/i18n.test.ts`: 操作パネルで実際に参照している i18n キー群の訳の
  完全性（ja/en が非空かつ相違）と `ghost.contract.deploying` の `{name}`
  プレースホルダ保持を追加。

**`operation.address.freeInputHint` の要否について（申し送りへの回答）**:
- ソース全体を走査し、定義（`messages.ts`）以外に参照が無い（UI に配線されて
  いない）ことを確認した。現状は未使用のデッドキー。tester としては実装
  （メッセージ定義）の削除は行わず、削除提案として報告する。`i18n.test.ts` に
  「定義は well-formed だが未使用」という現状を明示的に固定するテストを追加
  した。最終的な削除判断は統括に委ねる。

**確認結果**:
- `pnpm --filter @chainviz/frontend test`（73ファイル1165件、全て成功。
  強化前は1119件）。
- `pnpm --filter @chainviz/frontend build`・`pnpm -r build`（shared/collector/
  frontend/e2e 全て成功）。

**バグらしき事象**: 見つからなかった。カタログ照合・仮カードの取り違え・
保留状態管理はいずれも設計どおりに動作しており、追加テストは全て初回から
グリーンだった（catalog 突き合わせテストのみ、意図的に壊して検出力を確認済み）。

---

### 2026-07-08 Issue #167 レビュー（reviewer）

- 担当: reviewer
- 判定: **合格**（軽微な修正1件はレビュー担当が直接実施済み。下記参照）

**確認した内容**:

- **UX設計（ARCHITECTURE.md §6.5/§6.10）との整合**: 操作パネルは
  ワークベンチカード脇のポップオーバー・送金/デプロイ/呼び出しの3タブ・
  Esc/外側クリック/×で閉じる構成で、§6.10決定事項4のとおり。金額入力は
  ETH単位＋`parseEtherToWei`によるフロントでのwei変換（決定事項3）。
  フォーム定義は`packages/frontend/src/chain-profiles/ethereum/
  operationCatalog.ts`の静的データで、collectorからの配布ではない
  （決定事項2）。view/pure関数の除外は§6.5に実装時判断として追記済みで
  実装と一致。起点ボタンのActionHint予告・rpcTarget解決不能時のgeneric
  フォールバック・失敗時の既存トースト（collectorのerror詳細付き）・
  保留スピナー・デプロイのみの仮カード、いずれも§6.5の記述どおり。
- **実カタログとの整合**: `operationCatalog.ts`の内容（catalogKey・
  コンストラクタ引数・state変更関数の過不足・引数名/型・payable判定）を
  `profiles/ethereum/contracts/catalog.json`のABIと独自に突き合わせて
  一致を確認した。`operationCatalog.test.ts`の機械的照合テストは
  catalog.jsonをfsで直接読んで比較する実効性のあるもの（決め打ちの
  期待値の複製ではない）で、二重管理の乖離を検出できる。
- **仮カード（ghost）の取り違え対策**: contractゴーストのグリッド位置は
  Issue #113と同じ「既存コントラクト数を下限にした単調増加インデックス」
  方式（専用の`contractGhostIndexRef`）で、削除を挟んだ再デプロイでも
  位置が衝突しないことが回帰テストで固定されている。catalogKey一致優先
  →FIFO近似フォールバックも既存node/workbenchゴーストと同じ設計。
- **既存パターンとの一貫性**: pendingRef/仮カード/トースト（addNode・
  addWorkbenchと同型）、`resolveWorkbenchOperationsHint`（既存
  `resolveXxxHint`と同型）、`operationPending`の後付け（`isNew`と同じ
  stabilizeNodes後段方式で、Issue #119対策を損なわない）、
  `OperationDataContext`（`CommandActionsContext`と同パターン。候補一覧を
  node.dataに乗せない理由も妥当）を確認した。
- **境界の遵守**: フロントはDockerやノードRPCに直接触れず、
  `runWorkbenchOperation`コマンドのみを発行する。チェーン固有の語彙
  （関数シグネチャ・catalogKey）はフロント表現セット
  `chain-profiles/ethereum/`に閉じており、`packages/shared`のプロトコル
  型は汎用のまま（型変更なし）。
- **エラー握りつぶし**: なし。モックの`runWorkbenchOperation`は失敗時に
  具体的なerror文字列（対象workbench不明・カタログキー不明・未デプロイ
  アドレス等）を返し、失敗トーストはcollectorのerror詳細を含む既存
  `describeCommandError`経路。catchして無視する箇所は無い。
- **環境状態依存の固定値**: 追加なし（タイムアウト・件数上限の類は無い）。
- **テストの質**: 実カタログ照合・Issue #113回帰・保留カウントの並行
  解決・FIFO近似・ETH入力の境界値（18桁小数・符号・指数表記等）・
  App丸ごとの統合テストまで、異常系/境界値を含む意味のあるテストに
  なっている。lint/build/testはリポジトリ全体で成功
  （frontend 73ファイル1164件）。

**レビュー担当が直接実施した修正**（統括からの委任範囲内の軽微な変更）:

- 未使用の`operation.address.freeInputHint`メッセージキーを削除した
  （`messages.ts`から定義を、`i18n.test.ts`から「未使用と記録する」
  テストを除去）。定義以外の参照が無いことをgrepで再確認済み。
  「先のための先回り実装をしない」（CLAUDE.md）に従い、使う予定が
  具体化していないデッドデータは残さない判断。将来アドレス欄に補足
  文言が必要になったら、その時に文言ごと再設計すればよい。
  削除後も`pnpm lint`/`pnpm build`/frontendテスト（1164件）が通る
  ことを確認した。

**非ブロッキングの注意点（次の担当への申し送り）**:

- `CallForm.tsx`は関数を切り替えても金額欄のstate（`amount`）を
  リセットしない。現在のカタログにpayable関数が1つも無いため実害は
  無い（金額欄自体が出ない）が、将来payable関数をカタログに載せる際、
  「payable関数で金額を入力→非payable関数へ切り替えて送信」で不要な
  `amount`が付くパスが生きる。payable関数を追加するIssueで関数切替時の
  `setAmount("")`を併せて入れること。
- ARCHITECTURE.md §6.8のi18n表は「初稿」の位置づけで、実装で追加した
  `operation.close`・`operation.transfer.amount.invalid`は表に無い
  （実装のmessages.tsが正）。表は初稿として残す判断とし、更新しない。
- ブランチは未コミットの状態でレビューした（コミット粒度は確認対象外）。
  統括がコミットする際は1変更1コミットに分けること（目安: カタログ+
  純関数群 / operations UIコンポーネント / useCommands・ghost拡張 /
  InfraNodeCard・App配線 / mockData修正 / i18n・CSS / docs）。
- QAへ: 実装担当の申し送りどおり、実ブラウザでの目視確認
  （ポップオーバー位置・レイアウト崩れ・datalistの候補表示）が未実施。

---

### 2026-07-08 Issue #167 QA検証（qa）

- 担当: qa（検証大地）
- 判定: **合格**
- 環境: `pnpm --filter @chainviz/frontend build:web` でビルドし、`preview`
  （ポート4317）で起動。VITE_COLLECTOR_URL 未設定のためモッククライアントを
  使用（`runWorkbenchOperation` が実際に成功/失敗をシミュレートする実装）。
  実ブラウザ確認は Playwright（Chromium 1228）で実施。Chromium の共有
  ライブラリ不足（libnspr4.so 等）は Issue #165/#166 QA と同じく、事前展開
  済みの deb 由来 .so 群を LD_LIBRARY_PATH に通して解消した。

**実ブラウザで確認した内容（完了条件との対応）**:

- 「操作を実行」ボタン（`infra-card-operate-workbench-alice`）でワークベンチ
  カード脇に操作パネルが開き、3タブ（送金／デプロイ／コントラクト呼び出し）が
  表示される。実装担当・reviewer が申し送っていた「実ブラウザでの目視未実施」
  について、パネル・各フォームのレイアウト崩れが無いことをスクリーンショットで
  確認した。
- 送金: 宛先アドレス（既存ウォレット候補を datalist で提示。0x5afe/0xa11ce/
  0xb0b0 の3件が候補に出る）と ETH 単位の金額を入力して送信でき、送信後は
  パネルが閉じ、エラートーストは出ない。
- デプロイ: ChainvizToken 選択時に `initialSupply` のコンストラクタ引数入力欄が
  出る。Counter 選択時は引数欄が0件になる。どちらもデプロイ後に新しい
  コントラクトカードがキャンバスに追加される（コントラクト関連 testid 数が
  デプロイのたびに増えることを確認）。
- コントラクト呼び出し: 対象ドロップダウンにデプロイ済み・カタログ既知の
  Counter / ChainvizToken が並ぶ。Counter.increment（引数なし）、
  ChainvizToken.transfer（address 型の `to` は datalist 候補付き、`amount` は
  テキスト入力。非 payable のため金額欄は出ない）のいずれも送信でき、
  パネルが閉じてエラートーストは出ない。関数一覧は transfer/approve/
  transferFrom/mint と increment/incrementBy/reset で、view/pure 関数は
  除外されている（カタログどおり）。
- 通知: 成功時は既存コマンド（addNode 等）と同様にトーストを出さず、
  キャンバス上の変化（デプロイカードの出現）で結果が伝わる設計。不正入力
  （金額に "abc"、19桁小数）は送信ボタンが無効化され、フォーム内に赤字で
  「0以上のETH数量を10進数で入力してください（例: 0.5）」という具体的な
  メッセージが表示される。
- Esc キー・×ボタンでパネルが閉じる。
- ページのJSエラーは favicon の404のみで、機能上のエラーは無し。

**制約として記録（機能不具合ではない）**:

- デプロイ時の「仮カード（デプロイ中…）→実カード置き換え」は、モックが
  コマンドをマイクロタスクで即時解決する（`commandLatencyMs` 既定0）ため、
  仮カードが1フレームも描画されず実ブラウザでは視覚的に捉えられなかった。
  これはモックの即時応答特性によるもので、addNode 等の既存ゴーストにも
  共通する。仮カード→実カードの遷移自体は `App.workbenchOperations.test.tsx`・
  `useCommandsWorkbenchOperations.test.tsx` の統合/単体テストで検証済み。
  実 collector 環境では forge create に実時間がかかるため仮カードは可視化
  される想定。
- コマンドレベルの失敗トーストは、現在のモック UI からは到達不能だった。
  各フォームが入力を有効値に制約しており（送金は宛先空を submit 無効化、
  デプロイ/呼び出しはカタログ既知の選択肢のみ）、モックが失敗を返す条件
  （空宛先・未知キー・未デプロイアドレス）にフォーム経由では到達できない。
  失敗トースト自体は addNode/removeNode 等と同一の describeCommandError／
  ToastStack 経路で、`mockData.workbenchOperations.test.ts` の ok:false ケースで
  カバーされている。実 collector 環境での失敗（revert・残高不足・RPCエラー）は
  この既存経路で通知される。UI から到達できる失敗系フィードバックとしては
  上記の金額バリデーション（具体的メッセージ）が機能している。

**静的チェック（独立実行）**:
- `pnpm lint`: 成功（clean）。
- `pnpm build`: shared/collector/frontend/e2e 全パッケージ成功。
- `pnpm test`: shared 40・e2e 34・collector 944・frontend 1164 件、全て成功。

**結論**: Issue #167 の完了条件（3タブの操作パネル・送金・デプロイ（引数あり/
なし両方）・コントラクト呼び出し・成功/失敗の通知）を実機で満たしていることを
確認した。差し戻しは不要。
