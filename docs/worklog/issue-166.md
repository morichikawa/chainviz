### 2026-07-08 Issue #166 コントラクト呼び出し・イベントログの可視化

- 担当: frontend
- ブランチ: issue-166-call-event-visualization
- 内容: `docs/ARCHITECTURE.md` §6.6（Issue #157で確定済み）に従い、復号済み
  関数名・引数・イベントの表示と、tx確定時のコントラクトカードへの
  アニメーションを実装した。
  - `packages/frontend/src/entities/contractActivity.ts`（新規）: コントラ
    クトカードの「直近の呼び出し・イベント」チップ列を導出する純粋関数
    `deriveContractActivity`。確定済み（`status !== "pending"`）の tx から
    `contractCall.contractAddress`/`contractEvents[].contractAddress` が
    一致するものだけを抜き出し、新しい順（`blockHash` から
    `BlockEntity.number` を引いた降順。引けない場合は -1 として tx hash の
    辞書順にフォールバック）に整列し、既定6件に制限する。復号済みなら
    `functionName`/`eventName`、そうでなければ `rawFunctionId`/`rawEventId`
    を短縮表示する。`ContractEntity` 自体には専用フィールドを追加しない
    （§6.6の決定どおり）。`sameContractActivity`（内容比較。チップは毎回
    新しいオブジェクトとして作られるため参照比較ではなく内容比較にした）も
    ここに置く。
  - `packages/frontend/src/entities/contractSettlement.ts`（新規）: tx確定
    がどのコントラクトへの出来事かを解決する純粋関数
    `resolveContractSettlementEvent(s)`。優先順は
    `createdContractAddress`（デプロイ）→`contractCall.contractAddress`→
    `to` と既知コントラクトアドレスの照合（§4の制約対応。pending を経ずに
    観測した呼び出しでは `contractCall` が省略されることがあるため）。
    対象コントラクトがキャンバス上に存在しない場合は null（ダングリング
    ガード）。
  - `packages/frontend/src/entities/contractCallPulseEdge.ts`（新規）+
    `ContractCallPulseEdge.tsx`（新規）: ウォレット→コントラクトへの
    揮発性パルスエッジ。`operationEdge.ts`/`OperationPulseEdge.tsx` と同型
    （CSSの`offset-path`でエッジ上を走らせる。Issue #125のパターン）だが、
    対象がワークベンチ→ノードではないため別ファイルに分離した。色は
    コントラクト識別色（`--contract-edge`）。パルス表示時間は「操作パルスと
    同程度」の指示どおり`OPERATION_PULSE_DURATION_MS`をそのまま再利用する。
  - `packages/frontend/src/entities/useContractSettlementEffects.ts`
    （新規）: tx確定を監視し、(1)対象コントラクトへウォレットからの揮発
    パルスを1本走らせ、(2)パルス完了のタイミングでコントラクトカードへ
    確定フラッシュ（`success`/`failed`）を当てるフック。遷移検知は
    `useTxLifecycle`と同じ`detectTxSettlements`（pending→確定）を再利用
    するため、pendingを経ずに確定を観測したtxは対象外になる制約も共通。
    ウォレットが不在（追跡外アドレスからの呼び出し）ならパルスを省き
    フラッシュのみ即座に当てる。コントラクトが不在なら何もしない。
  - `packages/frontend/src/entities/contractNode.ts`: `ContractNodeData`に
    `activity`（チップ列。必須）と`flashKind`（確定フラッシュの演出フラグ。
    `isNew`と同じくApp.tsxがstabilizeNodesの後段で後付けする時間依存の
    派生状態）を追加。`ContractNodeContext`に`transactions`/
    `blockNumberByHash`（省略可）を追加し、`contractsToFlowNodes`が
    `deriveContractActivity`で都度導出する。`isSameContractNode`は
    `sameContractActivity`で内容比較するよう変更（isNew/flashKindは比較
    対象外のまま）。
  - `packages/frontend/src/entities/ContractCard.tsx`: 「直近の呼び出し・
    イベント」チップ列（`event-log`のGlossaryTerm）を追加。チップは
    復号済みなら関数名/イベント名、未復号ならraw識別子の短縮表示。
    イベントチップは「◆」プレフィックスで呼び出しチップと見分ける。
    ホバーで引数一覧（`name: value`）、または未復号の場合は
    `GlossaryTerm(termKey: abi)`でラップした「カタログに定義が無いため
    復号できません」メッセージを表示する。チップが1件も無ければ
    「まだ呼び出しがありません」。`flashKind`に応じて
    `contract-card--settle-success`/`contract-card--settle-failed`の
    CSSクラスを付与する。
  - `packages/frontend/src/app/App.tsx`: `blocks`から`blockNumberByHash`
    （blockHash→number）を導出し`contractsToFlowNodes`へ渡す。
    `useContractSettlementEffects(transactions, contracts, walletAddressIds)`
    を呼び出し、返る`pulseEdges`を`edges`配列に、`flashing`を
    `contractNodesWithHighlight`の後付け（`isNew`と同じ場所）に合流させた。
  - `packages/frontend/src/entities/canvasNode.ts` /
    `packages/frontend/src/canvas/Canvas.tsx`: `CanvasFlowEdge`に
    `ContractCallPulseFlowEdge`を追加し、`edgeTypes`に登録した。
  - `packages/frontend/src/i18n/messages.ts`: §6.8のうち本Issueで使う
    `contract.activity`・`contract.noActivity`・`contract.chip.undecoded`
    を追加した。
  - `packages/frontend/src/styles.css`: チップ列・ホバーポップオーバー・
    確定フラッシュ（`contract-card-settle`/`contract-card-settle-failed`
    キーフレーム）・パルスエッジ（`.contract-call-pulse-edge`/
    `.contract-call-pulse`）のスタイルを追加した。
  - `packages/frontend/src/websocket/mockData.ts`: Issue #165で追加された
    ChainvizToken/Counter/未知コントラクトと組み合わせて使えるサンプルを
    追加した。
    - `tokenTransferCallTx`: Aliceが`ChainvizToken.transfer`を呼び出し
      確定した tx（関数名・引数・`Transfer`イベントすべて復号済み）。
    - `unknownContractCallTx`: Bobがカタログ外コントラクトを呼び出した
      tx（`rawFunctionId`/`rawEventId`のみ、未復号の表示を確認できる）。
    - `tokenDeployTx`/`counterDeployTx`: 各コントラクトのデプロイ tx
      本体（`createdContractAddress`）。Issue #165時点では
      `ContractEntity.createdByTxHash`が指すtxエンティティ自体が
      スナップショットに存在しておらず、ダングリング参照になっていたので
      合わせて追加した。
    - `aliceWallet`/`bobWallet`の`recentTxHashes`にこれらを組み込んだ。
    - live シミュレーション（`createMockClient`の定期tick）も拡張し、
      3回に1回`ChainvizToken.transfer`の呼び出しを生成するようにした
      （実データの分布を模したものではないUX上の演出頻度。tx確定時の
      パルス・確定フラッシュをオフラインで継続的に確認できるようにする
      ため）。
- 決定事項・注意点:
  - **タスク説明で明示された3項目（チップ列・確定アニメーション・
    event-log用語）に絞り、§6.6内の他2項目は今回実装しなかった**。
    ARCHITECTURE.md §6.6には「ウォレットのtxチップのラベルを『意味』
    優先にする」「WalletPopoverのtx一覧に呼び出し内容を追記する」も
    含まれているが、これらはタスク説明の3項目（コントラクトカードの
    チップ列・tx確定アニメーション・event-log用語）に含まれておらず、
    後者はWalletPopoverへのコントラクト名解決の配線（`WalletCard`→
    `WalletPopover`への追加props、`walletNode.ts`のcontext拡張）を伴う
    別スコープの変更になるため、今回のPRでは見送った。次にこの領域へ
    着手する担当（Issue #167か、あるいは統括の判断で新規Issue化）は
    この2点を実装候補として検討してほしい。
  - **チップの並び順は`BlockEntity.number`から導出し、tx到着順など
    「観測時点に依存する固定値」には頼らない**設計にした（品質ゲート
    「今この瞬間に観測できる状態に依存した固定値をロジックに埋め込まない」
    に対応）。`blockHash`が解決できない場合はrank=-1（最古扱い）とし、
    その場合同士はtx hashの辞書順にフォールバックする。モックデータには
    `BlockEntity`が1件も含まれていない（既存の制約。Issue #165時点でも
    未対応）ため、モック上での並び順は主に辞書順フォールバックで決まる。
    実収集環境（`BlockEntity`が実際に配信される）では意図どおりブロック高
    降順になる。
  - **入れ子ホバーポップオーバーの設計**: コントラクトカード自体がホバーで
    `ContractPopover`を表示する既存の挙動があり、チップの個別ホバー
    ポップオーバーはこれと重ねて表示されうる（実ブラウザで確認済み。
    後述のスクリーンショット確認を参照）。これは新しいバグではなく、
    既存の`GlossaryTerm`が他の各種ポップオーバー（`ContractPopover`・
    `WalletPopover`等）の内側でも独立してホバー表示される、この
    コードベース既存の「入れ子ホバー」の流儀と同じものと判断し、
    `stopPropagation`等での抑制はしなかった。
  - **`useContractSettlementEffects`の遷移検知は`useTxLifecycle`と同じ
    `detectTxSettlements`を再利用**しており、「pendingを経ずに確定を
    観測したtx」では確定パルス・フラッシュが発火しない制約を継承する
    （既存の仕様と一貫。新しい制約ではない）。
  - 実際に`pnpm --filter @chainviz/frontend dev`でモックデータを起動し、
    Playwright（`playwright-core`が`pnpm dlx`のキャッシュに存在したため
    それを利用。Chromiumバイナリは`~/.cache/ms-playwright`に配置済み
    だったが共有ライブラリ`libnspr4.so`等が不足しており、scratchpadに
    以前のセッションが展開済みだったdebパッケージ由来の共有ライブラリを
    `LD_LIBRARY_PATH`で読み込むことで起動できた）で実ブラウザ描画を
    確認した。
    - ChainvizTokenカードに`transfer`（呼び出し）・`◆ Transfer`
      （イベント）チップが表示され、ホバーで引数一覧（`to: 0x...`、
      `amount: ...`/`from`/`to`/`value`）が出ることを確認した。
    - 未知コントラクトカードに生の識別子（`0xa9059cbb`・
      `0xddf252...b3ef`）のチップが表示され、ホバーで「カタログに定義が
      無いため復号できません」メッセージが出ることを確認した。
    - Counterカード（活動なし）に「まだ呼び出しがありません」が表示
      されることを確認した。
    - liveシミュレーション開始後 約11.6秒でAliceウォレット→
      ChainvizTokenへのインディゴの揮発パルスエッジが、約12.5秒で
      ChainvizTokenカードへの確定フラッシュ（`contract-card--settle-*`
      クラス）が実際にDOMへ現れることを確認した（タイミングは
      `createMockClient`の既定`intervalMs=3000`と`txSeq % 3 === 0`の
      演出頻度から導出される値であり、固定タイムアウトをテストや実装に
      埋め込んではいない）。
  - 新規・変更したテスト: `contractActivity.test.ts`・
    `contractSettlement.test.ts`・`contractCallPulseEdge.test.ts`・
    `ContractCallPulseEdge.test.tsx`・`useContractSettlementEffects.test.tsx`
    （いずれも新規）、`ContractCard.test.tsx`・`contractNode.test.ts`・
    `canvasNode.test.ts`（既存ファイルへ追加）。
  - `pnpm --filter @chainviz/frontend build`・
    `pnpm --filter @chainviz/frontend test`（59ファイル956件、すべて
    成功）を確認した。リポジトリ全体の`pnpm lint`は実行していない
    （frontendパッケージ配下の変更ファイルに対して`npx eslint`で個別に
    確認し、指摘なし）。

### 2026-07-08 Issue #166 レビュー（差し戻し）

- 担当: reviewer
- 判定: **差し戻し（スコープ不足）**。実装済み部分の品質には問題なし。
- ビルド・lint・テスト: リポジトリ全体で `pnpm lint` / `pnpm build` /
  `pnpm test` すべて成功（shared 40件・collector 944件・frontend 975件・
  e2e 34件）。
- 差し戻し理由（スコープ判断）:
  - Issue #166 の本文は「UX設計(`docs/ARCHITECTURE.md` §6.6)に従う」と
    §6.6 全体を指しており、§6.6 の表題「コントラクト呼び出し・イベント
    ログの可視化」はそのまま Issue #166 のタイトルでもある。§6.6 は
    4項目（1. ウォレット tx チップの「意味」優先表示、2. WalletPopover の
    tx 一覧への呼び出し内容追記、3. 確定時のコントラクトへのパルス、
    4. コントラクトカードのアクティビティチップ列）で構成されるが、
    今回の実装は 3・4 のみで 1・2 が未実装。
  - ステップ8の残 Issue（#167=定型操作UI・#168=トークン残高=§6.7）の
    どちらも 1・2 をカバーしておらず、このまま #166 を閉じると 1・2 は
    どの Issue にも紐付かないまま脱落する。1・2 は §6.1 の課題3
    「tx の中身（何をしたか）がどこにも出ない。WalletPopover の tx 一覧も
    hash + status のみ」への直接の回答であり、UX設計（#157 成果物）の
    到達点として省略できない。
  - docs との齟齬: 未実装のまま main へ入ると、`docs/ARCHITECTURE.md`
    §6.6 の前半2項目と §6.8 の `tx.chip.deploy`（ウォレット tx チップの
    「デプロイ」ラベル用文言）が「実装に存在しない挙動の記述」として
    残る。また `mockData.ts` には「Issue #166: 『意味』優先の tx チップ
    表示を確認できる組み合わせ」というコメント付きでモックデータが既に
    仕込まれており、現状では存在しない機能を参照するコメントになっている
    （1・2 を実装すれば正しい記述になる）。
  - なお「Phase 4 完了条件の文言（関数名・引数付きの可視化）はコントラクト
    カード側チップだけでも字義上は満たせる」という読みは可能だが、Issue の
    スコープは PLAN.md のチェックボックス1行 = §6.6 全体であり、完了条件の
    文言を根拠に設計項目を黙って落とすことはできない。別 Issue 化する道も
    あるが、その判断は統括に委ねる（レビューとしての推奨は同一 Issue 内での
    追加実装）。
- frontend への修正指示:
  1. §6.6 1項目め: ウォレット tx チップのラベルを「意味」優先にする。
     優先順は `contractCall.functionName`（例: `transfer()`）→
     `createdContractAddress` があれば「デプロイ」（i18n: `tx.chip.deploy`、
     §6.8）→ `rawFunctionId` の短縮表示 → 従来どおり hash 短縮。
     ステータス色・pending 明滅・確定フラッシュは従来のまま。
  2. §6.6 2項目め: WalletPopover の tx 一覧に呼び出し内容を追記する。
     関数名（引数の先頭1〜2個のプレビュー）＋宛先コントラクト名
     （未知なら短縮アドレス）。コントラクト名の解決に walletNode.ts の
     context 拡張（contracts の参照）が必要になる点は実装担当の worklog
     記載のとおり。
  3. 追加ロジックに対応するユニットテストを同じ変更内で書く
     （境界値: functionName 無し・rawFunctionId のみ・デプロイ・素の送金・
     宛先コントラクト未知/不在、の各分岐）。
- 実装済み部分の確認結果（再作業不要。合格水準）:
  - 境界の遵守: 新規コードにチェーン固有語彙の漏れなし。導出はすべて
    `packages/shared` の汎用フィールド（contractCall/contractEvents/
    createdContractAddress）に基づく。`packages/shared` の型変更なし。
  - チップ列導出（contractActivity.ts）: 確定済みのみ・新しい順・上限は
    `DEFAULT_RECENT_TX_LIMIT`(6) を再利用しウォレット tx チップと一致
    （§6.6 どおり）。並び順は `BlockEntity.number` 降順から導出し、到着順
    等の観測時点依存の値に頼らない。同一 tx 内は呼び出しチップ→イベント
    チップ順で、§6.6 の趣旨（呼び出し優先）に沿う。
  - tx確定解決（contractSettlement.ts）: 優先順
    `createdContractAddress` → `contractCall.contractAddress` → `to` 照合
    フォールバックは §6.6 の記述（デプロイまたはコントラクト宛て、
    contractCall 無ければ to 照合）と整合。デプロイ tx は `to` が null で
    呼び出しと同居しないため、優先順の入れ替わりによる実害はない
    （テストで優先順位を回帰固定済み）。Issue #141 の `reverse` 判定は
    双方向ピアエッジの正規化順の話であり、本パルスエッジは
    ウォレット→コントラクトの単方向専用エッジ（source/target 固定）
    なので競合しない。
  - tester の申し送り（1 tx につき 1 コントラクトのみ解決、contractEvents
    の発行元は確定パルス対象外）: §6.6 は「揮発パルスを1本」と明記して
    おり設計どおり。ルーター経由等で他コントラクトがイベントを発する
    ケースでも、その発行元コントラクトの活動チップには
    `deriveContractActivity` がイベントを表示するため、情報が失われる
    実害はない。
  - エラー握りつぶし・タイマーリーク: catch して無視する箇所なし。
    `useContractSettlementEffects` はアンマウント時に全タイマーを解除。
    パルス時間は `OPERATION_PULSE_DURATION_MS` の再利用で §6.6
    「操作パルスと同程度」の指示どおり。
  - テストの質: 22件の境界値テストを含め、異常系（pending除外・
    ダングリング・未復号・blockHash未解決・limit超過・同時多発確定・
    フラッシュ中の再確定・failed への昇格・アンマウント）を実質的に
    検証しており、実装をなぞるだけの無意味なテストは見当たらない。
- 軽微な指摘（差し戻し対応時に併せて検討。単独では差し戻し理由にしない）:
  - `ContractCard.tsx` の `ActivityChip` が引数一覧の React key に
    `arg.name` を使っている。ABI 上の無名引数などで名前が重複・空に
    なると key が衝突しうるため、`${index}-${arg.name}` 等にする方が安全。
  - tester の作業記録がこのファイルに未追記（CLAUDE.md のタスク完了時
    記録ルール）。差し戻し対応の完了時に併せて残すこと。
- コミット粒度: レビュー時点で全変更が未コミットのため履歴は未評価。
  コミット時は関心事ごと（チップ列導出・確定パルス/フラッシュ・
  モックデータ・docs）に分けること。

### 2026-07-08 Issue #166 差し戻し対応（§6.6 前半2項目の実装）

- 担当: frontend
- 対応内容: reviewer 指摘の未実装2項目と軽微な指摘を追加実装した。
  1. **ウォレット tx チップの「意味」優先表示**
     - `packages/frontend/src/entities/transaction.ts` に
       `txChipLabel(tx)` を新設。優先順位
       `contractCall.functionName` → `createdContractAddress`（デプロイ）
       → `contractCall.rawFunctionId` の短縮表示 → 従来どおり tx hash の
       短縮表示、を1つの純粋関数にまとめた。`kind: "deploy"` の場合は
       `text` を空文字にして返し、i18n訳語（`tx.chip.deploy`）への
       置き換えは呼び出し側（WalletCard）に委ねる設計にした（この
       ファイルはReactの`t()`に依存しないテスト容易性を保つため）。
     - `packages/frontend/src/entities/WalletCard.tsx`: tx チップの表示
       テキストを `shortHex(tx.hash, 4, 3)` 決め打ちから `txChipLabel`
       経由に変更。tx hash 自体は `title` 属性（ネイティブツールチップ）
       に残しているため、hash を辿る手段は失っていない。デバッグ・
       テスト用に `data-label-kind`（`function`/`deploy`/`raw`/`hash`）を
       チップに付与した。
  2. **WalletPopover への呼び出し内容追記**
     - `packages/frontend/src/entities/txCallPreview.ts`（新規）:
       `deriveTxCallPreview(tx, contractsByAddress)` という純粋関数を
       新設。`tx.contractCall` があれば `kind: "call"`
       （`label`=関数名→`rawFunctionId`短縮→tx hash短縮のいずれか、
       `argsPreview`=引数の先頭 `MAX_ARG_PREVIEW`(=2) 件、
       `contractName`=`contractsByAddress` から解決）を、
       `tx.createdContractAddress` があれば `kind: "deploy"` を返す。
       どちらも無い素の送金は `undefined`（呼び出し内容を追記しない）。
     - `packages/frontend/src/entities/WalletPopover.tsx`: 内部コンポー
       ネント `TxCallPreviewLine` を追加し、tx 一覧の各行に
       「{関数名}({引数プレビュー}) → {宛先コントラクト名}」
       （deployなら「デプロイ → {コントラクト名}」）を1行追記した。
       宛先コントラクト名は未解決なら `shortHex(contractAddress)` に
       フォールバックする。引数値は `shortHex()` を通すが、この関数は
       `0x` 始まりでない文字列（wei建ての数値文字列など）はそのまま
       返すため、アドレス型の引数だけが自然に短縮される。
     - コントラクト名解決には `ContractEntity` の索引
       （`address -> ContractEntity`）が必要なため、配線を1本追加した:
       `walletNode.ts` の `WalletNodeContext`/`WalletNodeData` に
       `contractsByAddress`（省略可・既定は空 Map）を追加し、
       `walletsToFlowNodes` が全ウォレットに同一の Map 参照を配る
       （Issue #119 の参照安定化を壊さないため、ウォレットごとに新しい
       Map を作らない）。`isSameWalletNode` にも比較対象として追加した。
       `WalletCard.tsx` は受け取った `contractsByAddress` をそのまま
       `WalletPopover` へ渡すだけで、カード自体の tx チップ表示には
       使わない（そちらは tx 単体の情報で完結する）。
     - `packages/frontend/src/app/App.tsx`: `contracts`/`contractsByAddress`
       の算出をウォレット関連の memo より前に移動し（従来はコントラクト
       行の memo と一緒に後段にあった）、`walletsToFlowNodes` の呼び出しに
       `contractsByAddress` を渡すよう変更した。`contracts` の実体は1箇所
       のみで、コントラクトカード側の `contractsToFlowNodes` 呼び出しは
       そのまま同じ変数を参照する（二重定義はしていない）。
  3. 軽微な指摘対応: `ContractCard.tsx` の `ActivityChip` 内、引数一覧の
     React key を `arg.name` 単独から `` `${chip.key}-arg-${index}-${arg.name}` ``
     に変更した（名前の重複・空文字での衝突を避ける）。
  4. `packages/frontend/src/i18n/messages.ts` に `tx.chip.deploy`
     （ja: 「デプロイ」/ en: "Deploy"）を追加した（§6.8 で定義済みだが
     前回未実装だったため実体が無かった）。
  5. モックデータ（`mockData.ts`）の変更は無し。reviewer が指摘した
     「Issue #166: 『意味』優先の tx チップ表示を確認できる組み合わせ」
     コメント付きサンプル（Alice の `recentTxHashes` = 素の送金・
     `ChainvizToken.transfer`呼び出し・デプロイの3種、Bob の
     `recentTxHashes` = 素の送金・未復号呼び出し・デプロイの3種）は
     前回実装時点で既に仕込まれており、今回の実装でそのまま4パターン
     （function/deploy/raw/hash）を実際に表示確認できる状態になった。
- 追加・変更したテスト:
  - `transaction.test.ts`: `txChipLabel` の優先順位テスト6件
    （function優先・deploy優先・deployがrawFunctionIdより優先・
    raw fallback・plain送金でのhash fallback・contractCallはあるが
    何も復号されていない場合のhash fallback）。
  - `txCallPreview.test.ts`（新規）: `deriveTxCallPreview` の7件
    （plain送金でundefined・function+argsでcall・args 3件を2件に
    キャップ・rawFunctionIdへのfallback・デプロイでkind deploy・
    未知コントラクトでcontractName未解決）。
  - `WalletPopover.test.tsx`（新規）: 表示文言の組み立てをレンダリング
    レベルで6件（plain送金で追記なし・function+args+コントラクト名・
    未知コントラクトへのfallback表示・args 2件キャップ・deploy+
    コントラクト名解決・deploy+コントラクト未解決でアドレスfallback）。
  - `WalletCard.test.tsx`: チップラベルの優先順位を実レンダリングで
    確認する4件（function/deploy/raw/hash、`data-label-kind`込み）。
    既存の `data()` ヘルパーに `contractsByAddress: new Map()` を追加。
  - `walletNode.test.ts`: `contractsByAddress` の配線確認2件
    （全ウォレットへ同一参照が伝播すること・省略時に空Mapへ
    フォールバックすること）と、`isSameWalletNode` に
    `contractsByAddress` の参照変化を検出する1件を追加。既存の `ctx()`
    ヘルパーの既定値にモジュールレベルの `EMPTY_CONTRACTS`（単一の
    空Map）を追加した（`new Map()` を都度作ると、同じ内容でも参照が
    毎回変わり、Issue #119 の「再計算しても変化なしなら同一とみなす」
    既存テストを壊すため）。
  - `canvasNode.test.ts`: `WalletNodeData` に必須フィールドが増えた影響で
    既存のリテラルへ `contractsByAddress: new Map()` を追加（挙動変更は
    無し、型エラーの解消のみ）。
- 確認結果: `pnpm lint`・`pnpm --filter @chainviz/frontend build`・
  `pnpm --filter @chainviz/frontend test`（61ファイル1001件）すべて成功。
- 次の担当への申し送り:
  - WalletPopover の呼び出し内容行（`.wallet-popover__tx-call`）に
    専用CSSを追加していない（既存の `wallet-popover__tx-hash`/
    ステータスチップも同様に無地のまま運用されていたため、今回もその
    流儀を踏襲した）。将来的に見た目を詰める場合は独立した見た目調整
    タスクとして着手してよい（ロジック変更を伴わないため）。
  - `MAX_ARG_PREVIEW`（=2）は `txCallPreview.ts` にエクスポート済みの
    定数として定義した。ARCHITECTURE.md §6.6 の「先頭1〜2個」という
    記述に基づく固定値であり、tx の観測件数や実行時の状態に依存する
    値ではないため、品質ゲートの「今この瞬間に観測できる状態に依存した
    固定値」には該当しないと判断した。

### 2026-07-08 Issue #166 再レビュー（差し戻し対応の確認）

- 担当: reviewer
- 判定: **差し戻し（1点のみ。他はすべて合格水準）**。
- ビルド・lint・テスト: リポジトリ全体で `pnpm lint` / `pnpm build` /
  `pnpm test` すべて成功（shared 40件・collector 944件・frontend 1001件・
  e2e 34件）。
- 前回指摘への対応確認（いずれも合格水準）:
  - §6.6 1項目め（ウォレット tx チップの「意味」優先表示）: `txChipLabel` の
    優先順位（`contractCall.functionName` → デプロイ → `rawFunctionId` 短縮 →
    hash 短縮）は ARCHITECTURE.md §6.6 の記述と完全に一致。deploy の訳語を
    i18n（`tx.chip.deploy`。§6.8 と一致）へ委ね、純粋関数側は `kind` だけを
    返す分離も適切。tx hash を `title` 属性に残しており情報の喪失はない。
  - §6.6 2項目め（WalletPopover への呼び出し内容追記）: `deriveTxCallPreview`
    は関数名＋引数プレビュー（`MAX_ARG_PREVIEW`=2。§6.6「先頭1〜2個」由来の
    設計値であり観測状態依存の固定値ではない）＋宛先コントラクト名（未解決
    なら短縮アドレスへフォールバック）を返し、§6.6 の記述どおり。素の送金には
    何も追記しない。表示は既存の `infra-popover` / GlossaryTerm / testid /
    i18n の流儀と一貫している。
  - コントラクト名解決の配線: `WalletNodeContext.contractsByAddress`
    （省略可・既定空 Map）→ 全ウォレットへ同一参照を配布 → `WalletCard` は
    素通しで `WalletPopover` にのみ渡す、という最小限の配線で境界も適切。
    App.tsx の `contracts`/`contractsByAddress` の前方移動は二重定義なし・
    useMemo の依存配列も正しい（ビルドで use-before-declare も検出されない
    ことを確認）。
  - `ActivityChip` の React key 修正（`${chip.key}-arg-${index}-${arg.name}`）:
    無名・重複引数名での衝突が解消されており適切。
  - テストの質: `txChipLabel` 6件は優先順位の全分岐（function/deploy/
    deploy>raw/raw/hash/contractCall はあるが未復号）を回帰固定しており、
    `deriveTxCallPreview` 7件・`WalletPopover.test.tsx` 6件・
    `WalletCard.test.tsx` 4件も異常系（未知コントラクト・未観測デプロイ先・
    引数キャップ・素の送金）を実質的に検証している。無意味なテストは無い。
  - mockData.ts の「意味」優先チップ確認用サンプル: Alice
    （pending素の送金=hash / `transfer`=function / デプロイ=deploy）と Bob
    （素の送金=hash / 未復号呼び出し=raw / デプロイ=deploy）で4種すべての
    ラベル種別が実際に表示される状態になり、前回指摘した「存在しない機能を
    参照するコメント」は解消した。
- 差し戻し理由（1点）: **`contractsByAddress` の参照が state 更新のたびに
  変わり、ウォレットノードの参照安定化（Issue #119）を実質無効化する**。
  - 経路: `useWorldState` は差分イベントのたびに `applyDiff` で新しい
    `state` を作る → `entities`（`listEntities(state)` の useMemo）が新配列
    → `contracts`（`entities.filter`）が新配列 → `contractsByAddress`
    （useMemo 依存 `[contracts]`）が**内容不変でも毎回新しい Map** になる。
  - `isSameWalletNode` は今回 `contractsByAddress` を参照比較に加えたため、
    ウォレット・コントラクトと無関係な差分（ブロック到着・tx status 更新
    など、実運用で数秒おきに起きる）でも全ウォレットノードが「変化した」と
    誤判定され、`stabilizeNodes` が毎回新しいノードオブジェクトを返す。
    entity 参照・tx 要素参照の比較など既存の安定化条件が実運用上すべて
    死に、全 WalletCard がワールドステート更新のたびに再レンダーされる。
  - 見た目のちらつき自体は Canvas.tsx の `preserveMeasuredDimensions`
    （本質対策）が防ぐため視覚的なバグにはならないが、App.tsx のコメントに
    明記された stabilizeNodes の補完目的（不要な再レンダーの回避）が
    ウォレットに関して無効になる。実装担当自身が walletNode.test.ts の
    `EMPTY_CONTRACTS` ヘルパーで「`new Map()` を都度作ると参照が変わり
    誤検出する」とこの故障モードを正確に認識していながら、本番の App.tsx が
    まさにその形（毎回新しい Map）になっている。worklog の「Issue #119 の
    参照安定化を壊さないため」という記述も現状では成立していない。
- frontend への修正指示:
  1. App.tsx で `contracts`（または `contractsByAddress`）の参照を安定化
     する。例: `nodeStability.ts` が export 済みの `sameByReference` を使い、
     前回の `contracts` 配列と要素参照が完全一致なら前回の参照を返す
     （`previousInfraNodesRef` と同じ ref + useMemo パターン）。これで
     コントラクト集合が実際に変わったときだけ Map の参照が変わり、
     `isSameWalletNode` の比較が意図どおり機能する（コントラクト追加・
     更新時にはポップオーバーの名前解決も正しく更新される）。
  2. 安定化ロジックに対応するユニットテストを同じ変更内で書く（要素参照が
     全一致なら同一参照を返す・要素が増減/差し替えされたら新参照を返す、の
     両分岐。App.tsx 内に直書きせずテスト可能なヘルパーに切り出すことを推奨）。
- 軽微な指摘（差し戻し理由ではない。対応は任意）:
  - `deriveTxCallPreview` は `contractCall` を `createdContractAddress` より
    先に判定するため、仮に両方を持つ tx があると `txChipLabel`（deploy が
    raw より優先）と表示が食い違う。デプロイ tx は `to: null` で
    `contractCall` と同居しない（shared の型のセマンティクス上）ため実害は
    無いが、優先順を txChipLabel と揃えておくと将来の混乱を避けられる。
- コミット粒度: 全変更が未コミットのため今回も履歴は未評価。コミット時は
  前回指摘どおり関心事ごとに分けること（今回の差し戻し対応分も「ウォレット
  txチップ」「WalletPopover追記」等で分けられる粒度がある）。

### 2026-07-08 Issue #166 差し戻し対応（contractsByAddress の参照安定化）

- 担当: frontend
- 対応内容: 前回の再レビューで指摘された1点（`contractsByAddress` の参照が
  state 更新のたびに変わり、Issue #119 の参照安定化を無効化する問題）を
  修正した。
  1. **再現テストを先に書いて失敗を確認してから修正した**（CLAUDE.mdの原則）。
     `packages/frontend/src/entities/walletNode.test.ts` に
     `contractsByAddress reference stability across recomputations
     (Issue #166 regression)` という describe ブロックを追加し、
     App.tsx 修正前の派生パターン（`entities.filter(isContractEntity)` の
     結果をそのまま `new Map(...)` する）を模したテストが
     `isSameWalletNode` を `false` にしてしまうこと（バグの再現）を先に
     確認した。
  2. **安定化ロジックをテスト可能なヘルパーに切り出した**:
     `packages/frontend/src/entities/nodeStability.ts` に
     `stabilizeArrayReference<T>(next: T[], previous: T[]): T[]` を追加。
     既存の `sameByReference` を使い、`next` の全要素が `previous` と
     参照レベルで完全一致するなら `previous` をそのまま返す（一致しなければ
     `next` を返す）純粋関数。既存の `previousInfraNodesRef` 等と同じ
     ref + useMemo パターンで使うことを想定している。
  3. `packages/frontend/src/app/App.tsx` の `contracts`
     （`entities.filter(isContractEntity)`）の算出に、`previousContractsRef`
     （`useRef<ContractEntity[]>([])`）+ `stabilizeArrayReference` を適用。
     これにより `contracts` の内容（要素参照）が変わっていない限り配列
     自体の参照も安定し、それに依存する `contractsByAddress`
     （`useMemo(() => new Map(...), [contracts])`）の Map インスタンスも
     連動して安定するようになった。既存の `previousInfraNodesRef` /
     `previousWalletNodesRef` / `previousContractNodesRef` と同型のパターン。
  4. ユニットテストを追加した:
     - `nodeStability.test.ts`: `stabilizeArrayReference` の単体テスト6件
       （要素参照が全一致→前回参照を返す・空配列同士→前回参照を返す・
       要素の差し替え/増加/減少→新しい参照を返す・前回出力が無い初回呼び出し
       →新しい参照を返す）。
     - `walletNode.test.ts`: 上記の再現テストに加え、App.tsx の修正後の
       派生パターン（`stabilizeArrayReference` を使ったクロージャ）を模した
       テストで、無関係な再計算をまたいで `contractsByAddress` の Map 参照が
       維持され `isSameWalletNode` が `true` を返すことを確認する回帰テスト
       を追加した。
- 軽微な指摘（任意対応。対応した）: `deriveTxCallPreview`
  （`packages/frontend/src/entities/txCallPreview.ts`）の判定順序を
  `txChipLabel`（`transaction.ts`）と揃えた。優先順位を
  「`contractCall.functionName` → `createdContractAddress`（デプロイ）→
  `contractCall`（`rawFunctionId` 短縮、無ければ tx hash 短縮）→ undefined」
  に変更（従来は `contractCall` の有無を `createdContractAddress` より先に
  判定していた）。デプロイ tx は `to: null` で `contractCall` を持たない
  ため実際の表示に影響はないが、優先順位の食い違いを解消した。
  `txCallPreview.test.ts` に、両方のフィールドを同時に持つ tx を与えても
  deploy が優先されることを確認する回帰テストを1件追加した。
- 確認結果: `pnpm lint`・`pnpm --filter @chainviz/frontend build`・
  `pnpm --filter @chainviz/frontend test`（61ファイル1010件）すべて成功。
- 次の担当への申し送り: 特になし。今回の修正で reviewer 指摘の1点は解消
  したはずだが、最終判断は次の `chainviz-reviewer` に委ねる。

### 2026-07-08 レビュー3回目（chainviz-reviewer、差し戻し対応の再確認）: 合格

- 担当: reviewer
- 前回差し戻しの指摘（`contractsByAddress` の参照不安定化による Issue #119
  の参照安定化無効化）への対応を確認した。判定は**合格**。
- 確認内容:
  1. `stabilizeArrayReference`（`nodeStability.ts`）の実装を確認。既存の
     `sameByReference` による全要素参照一致の判定で、一致時のみ前回配列を
     返す純粋関数。既存の `stabilizeNodes` + `previousXxxRef` パターンと
     一貫しており、docstring に Issue #119/#166 との関係も明記されている。
  2. 修正の有効性の前提となる「無関係な差分適用時にエンティティ自体の参照が
     維持されること」を `world-state/store.ts` の `applyDiff` で確認した
     （変更イベントの対象でないエンティティは同一オブジェクト参照のまま
     引き継がれる）。よって `entities.filter(isContractEntity)` →
     `stabilizeArrayReference` → `useMemo` の Map 化、という App.tsx の
     派生チェーンで `contractsByAddress` の参照は実際に安定し、
     `isSameWalletNode` の参照比較が正しく機能する。コントラクト自体が
     更新された場合は entity 参照が変わるため Map も作り直され、変更は
     正しく検出される（安定化しすぎて更新を取りこぼすことはない）。
  3. 回帰テスト（`walletNode.test.ts` の「Issue #166 regression」describe）
     が、修正前の素朴な派生パターンでバグが再現すること（`isSameWalletNode`
     が false になる）と、修正後のパターンで Map 参照が維持され true に
     なることの両方を検証しており、意味のあるテストになっている。
     `stabilizeArrayReference` 単体のテスト6件も境界（空配列同士・初回・
     要素の差し替え/増減）をカバーしている。
  4. 軽微な指摘だった判定順序の統一も確認。`txChipLabel`（transaction.ts）と
     `deriveTxCallPreview`（txCallPreview.ts）がともに
     「functionName → createdContractAddress（デプロイ）→ rawFunctionId/hash」
     の順で判定するよう揃い、両フィールド同居時に deploy が優先されることの
     回帰テストも追加されている。
  5. リポジトリ全体で `pnpm lint` / `pnpm build` / `pnpm test` を実行し
     すべて成功（shared 40件・collector 944件・frontend 1010件・e2e 34件）。
- 補足（対応不要）: tx チップ（`txChipLabel` は `shortHex(raw, 4, 3)`）と
  ポップオーバー（`deriveTxCallPreview` は既定の `shortHex` = 6,4）で
  rawFunctionId の短縮桁数が異なるが、表示スペースの違いによる表現上の
  差であり優先順位の食い違いではないため問題としない。
- 申し送り: 変更は依然すべて未コミット。コミット時は「1つの変更内容 =
  1コミット」（活動チップ列・確定アニメーション・txチップ意味優先表示・
  WalletPopover追記・参照安定化の差し戻し対応、等の関心事単位）に分ける
  こと。push / PR / マージは統括の判断に委ねる。この後は `chainviz-qa` の
  動作検証へ。

### 2026-07-08 QA検証（chainviz-qa、実ブラウザ動作確認）: 合格

- 担当: qa
- 判定: **合格**。Issue #166 の完了条件（§6.6 全4項目）をすべて実ブラウザで確認した。
- 検証環境: worktree `chainviz-wt-166`（ブランチ `issue-166-call-event-visualization`、
  未コミット）。`pnpm --filter @chainviz/frontend build:web` でビルド後、
  `vite preview`（port 4318、モックデータ）で起動。VITE_COLLECTOR_URL 未設定のため
  `resolveDefaultClient` がモッククライアントを選択する。Playwright（playwright-core
  1.56 + キャッシュ済み chromium-1193、不足共有ライブラリは scratchpad に展開済みの
  deb 由来ライブラリを LD_LIBRARY_PATH で補完）で描画・ホバー・時間経過を確認した。
  headless Chromium に日本語フォントが無いため画面上の日本語グリフは豆腐表示に
  なるが、DOM のテキスト内容を直接抽出して正しい日本語を確認済み。
- 確認結果（完了条件ごと）:
  1. コントラクトカードの「直近の呼び出し・イベント」チップ列: ChainvizToken カードに
     復号済みチップ `transfer`（呼び出し）と `◆ Transfer`（イベント）、未知コントラクト
     （0xdead01…）カードに未復号チップ `0xa9059cbb`（呼び出し）と `◆ 0xddf252…b3ef`
     （イベント）が表示された。Counter カード（活動なし）は「まだ呼び出しがありません」
     を表示。呼び出しチップのホバーで引数一覧（`to: 0xb0b0…`, `amount: 1000…`）、
     未復号チップのホバーで「カタログに定義が無いため復号できません（生の識別子）」を確認。
  2. tx確定時のパルス・確定フラッシュ: live シミュレーション開始後、約10.7秒で
     Alice ウォレット→ChainvizToken への揮発パルスエッジ（`.contract-call-pulse`）が、
     約11.5秒で ChainvizToken カードへの確定フラッシュ（`contract-card--settle-success`
     クラス）が DOM に現れることを確認。スクリーンショットでもエッジ上を走る発光ドットを
     確認した。タイミングはモックの `intervalMs=3000` × `txSeq%3` に由来する実測値。
  3. ウォレット tx チップの「意味」優先表示: Alice のチップは hash（`0xa11c…000`）/
     function（`transfer`）/ deploy（`デプロイ`）、Bob のチップは hash（`0xb0b0…000`）/
     raw（`0xa9059cbb`）/ deploy（`デプロイ`）で、`data-label-kind` 属性も
     hash/function/deploy/raw の4種すべてを確認。優先順（関数名→デプロイ→raw短縮→hash短縮）
     どおり。
  4. WalletPopover への呼び出し内容追記: Alice のポップオーバーに
     `transfer(to: 0xb0b000…0000, amount: 1000000000000000000) → ChainvizToken` と
     `デプロイ → ChainvizToken`、Bob のポップオーバーに `0xa9059cbb() → 0xdead01…0000`
     （未知コントラクトは短縮アドレスへフォールバック）と `デプロイ → Counter` を確認。
     素の送金（pending）行には呼び出し内容の追記が無いことも確認。
  5. glossary 用語 `event-log`: コントラクトカードの活動ラベル内の GlossaryTerm を
     ホバーすると、用語名「イベントログ」と定義（「コントラクトが実行中にチェーン上へ
     書き残す記録…」）のポップオーバーが表示された。`glossary-term--unknown` ではなく
     正しく解決されている。
- 静的ゲート（独立実行）: リポジトリ全体で `pnpm lint`（clean）/ `pnpm build`（成功）/
  `pnpm test`（shared 40・collector 944・frontend 1010・e2e 34、すべて成功）を確認。
  collector のテストログに出る「failed to decode …」等は異常系テストの意図的な
  エラーパス出力でありテスト失敗ではない。
- 申し送り: push / PR作成 / マージ / Issue クローズは統括の判断・実行に委ねる。
  変更は依然すべて未コミット。コミット時の粒度分割は reviewer の申し送りどおり。
