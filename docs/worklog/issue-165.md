### 2026-07-08 Issue #165 ContractEntityのカード表示とポップオーバー

- 担当: frontend
- ブランチ: issue-165-contract-card
- 内容: `docs/ARCHITECTURE.md` §6.2〜§6.4（コントラクトカードのUX設計。
  Issue #157で確定済み）に従い、C層拡張のコントラクトカードとポップオーバー
  （未知のコントラクトの差別化を含む）を実装した。
  - `packages/frontend/src/entities/contractNode.ts`（新規）:
    `ContractEntity`を React Flow のノードへ変換する。既存の
    `walletNode.ts`/`infraNode.ts`と同じ構成（`ContractFlowNode`型、
    `CONTRACT_NODE_TYPE`、`contractsToFlowNodes`、`isSameContractNode`）。
    `CONTRACT_GRID`はインフラ行(originY=0)・ウォレット行(originY=520)に続く
    3段目としてoriginY=1040を採用（§6.2の目安値どおり）。
  - `packages/frontend/src/entities/ContractCard.tsx`（新規）: カード本体。
    ヘッダに種別ラベル「コントラクト」(GlossaryTerm: contract)・「全ノードで
    実行」ピル(GlossaryTerm: evm)・カタログ外の場合のみ「カタログ外」ピルを
    表示する。削除ボタンは置かない（チェーン側の状態は削除できないため、
    Issue #103の流儀を踏襲）。名前は`entity.name`、無ければ「未知の
    コントラクト」。サブタイトルはアドレス短縮表示＋`token`があれば
    「・トークン {symbol}」(GlossaryTerm: token)。カタログ未登録
    （`name`省略）のコントラクトは`infra-card--contract-unknown`クラスで
    破線ボーダー＋muted色にし、既知カードと区別する（§6.4）。
  - `packages/frontend/src/entities/ContractPopover.tsx`（新規）: ホバーの
    詳細ポップオーバー。冒頭に「全ノードで実行される」誤解防止の説明文を
    置き（未知コントラクトの場合は「ABIを復号できない」旨の説明文に差し替え、
    文中の「ABI」の語だけにGlossaryTerm(termKey: abi)のアンカーを付ける）、
    アドレス・デプロイした人(GlossaryTerm: deploy)・作成tx・トークン情報
    (GlossaryTerm: token)を、観測できたフィールドのみ表示する
    （WalletPopoverと同じ「省略時は行ごと出さない」流儀）。
  - `packages/frontend/src/entities/deployEdge.ts` /
    `DeployEdge.tsx` / `DeployEdgePopover.tsx`（新規）: ウォレット→コントラクト
    の「デプロイエッジ」(§6.3)。`ContractEntity.deployerAddress`から都度導出し
    （`OwnershipEdge`と同じ設計）、デプロイ元ウォレットがキャンバス上に
    存在する場合のみ描く（ダングリング参照ガード）。ホバーで
    「{address} がデプロイしたコントラクト」のポップオーバー
    (`PeerEdgePopover`と同型、GlossaryTerm: deploy)を出す。ホバー状態の管理は
    既存の`PeerPropagationEdge`のパターン(`hoveredPeerEdgeId`)を踏襲し、
    `Canvas.tsx`に`hoveredDeployEdgeId`を追加した。色は所有エッジ(琥珀)・
    操作エッジ(マゼンタ)と混同しないインディゴ系の新CSS変数
    `--contract-edge`を追加して使う。
  - `packages/frontend/src/entities/canvasNode.ts`: `CanvasFlowNode`に
    `ContractFlowNode`、`CanvasFlowEdge`に`DeployFlowEdge`を追加。
    `canvasNodeLayoutKey`が`contract`種別も`address`をキーにするよう修正。
  - `packages/frontend/src/canvas/Canvas.tsx`: `nodeTypes`/`edgeTypes`に
    コントラクトカード・デプロイエッジを登録し、デプロイエッジのホバー
    状態管理を追加。
  - `packages/frontend/src/app/App.tsx`: コントラクトエンティティの抽出・
    レイアウト解決・新着発光・デプロイエッジ算出を配線した。コントラクト行は
    ウォレット行と異なり、インフラ行と同じ「初出時に空きスロットを確定して
    即layout保存」ルール（§6.2の明記どおり）を適用するため、既存の
    `resolveLayoutPositions`をコントラクトのaddress配列＋`CONTRACT_GRID`で
    再利用する専用の`useEffect`を追加した。新着発光（`useNewArrivalHighlight`）
    は既存のインフラ用と同じ1つのフックにコントラクトのaddressも合流させて
    判定する。
  - `packages/frontend/src/i18n/messages.ts`: `docs/ARCHITECTURE.md`
    §6.8のうち、本Issueで使うメッセージキー（`card.contract`・
    `contract.unknown`・`contract.badge.everyNode`・
    `contract.badge.uncataloged`・`contract.popover.description`・
    `contract.popover.unknownDescription`・`field.deployer`・
    `field.createdByTx`・`field.token`・`edge.deployedBy`）を追加した。
    定型操作関連のキー（`operation.*`等）はIssue #167等の担当範囲のため
    追加していない。
  - `packages/frontend/src/websocket/mockData.ts`: モックスナップショットに
    サンプルのコントラクト3件（カタログ既知・トークン持ちの
    ChainvizToken、カタログ既知・トークン無しのCounter、カタログ未登録の
    未知コントラクト）を追加した。ChainvizTokenはAliceが、Counterは
    所有者削除済みのBobがデプロイした体にし、デプロイエッジが
    ownerPresentの有無に関わらずウォレットカードの生存だけで張られる
    ことをオフラインで確認できるようにした。
  - `glossary/`のcontract/deploy/abi/event-log/evm/tokenの各用語は
    既にIssue #169で追加済みで、コード変更は不要だった。今回の実装で
    これらのうちcontract/deploy/abi/evm/tokenがコントラクトカード・
    ポップオーバー・デプロイエッジから実際に参照されるようになった
    （Issue #169の「まだUIから参照されていない」という申し送りの解消）。
    `event-log`はコントラクトの「直近の呼び出し・イベント」チップ列
    （Issue #166の範囲）で参照する予定でありこの実装では未参照のまま。

- 決定事項・注意点:
  - **コントラクト呼び出し・イベントログのチップ列は実装していない**。
    ARCHITECTURE.md §6.6は Issue #166「コントラクト呼び出し・イベントログの
    可視化」の担当範囲であり、本Issueのタスク一覧（カード・ポップオーバー・
    未知コントラクトの差別化・新着発光・モックデータ）に含まれないため、
    カードには「直近の呼び出し・イベント」欄を追加していない。次の担当
    （Issue #166）がここにチップ列を足す前提でカードの構造を組んでいる。
  - **デプロイエッジの実装はタスク一覧に明記されていなかったが実装した**。
    ARCHITECTURE.md §6.3「コントラクトカード」の節に「デプロイエッジ
    （常設）」として仕様が確定済みで記載されており、コントラクトカードの
    UXと不可分（デプロイ元の視覚的な手がかり）と判断したため、カード・
    ポップオーバーと同じスコープとして実装した。
  - **`abi`用語のアンカー方法**: `contract.popover.unknownDescription`は
    ARCHITECTURE.md §6.8の完結した1文のメッセージキーのまま保ち、i18n
    データ自体は変更していない。表示側（`ContractPopover.tsx`の
    `withAbiAnchor`）で文中の部分文字列"ABI"を検出しGlossaryTermで
    差し替える方式にした（ja/en どちらの訳文にも"ABI"がそのまま含まれる
    ため機能する）。"ABI"という部分文字列が見つからない場合はアンカー無しの
    プレーンテキストへ防御的にフォールバックする。
  - **CONTRACT_GRIDのoriginY=1040**: ARCHITECTURE.md §6.2の目安値をそのまま
    採用した。実測での確定は行っていない（インフラ行・ウォレット行の
    カード数が少ない現状のモックデータでは十分な余白があることを
    `pnpm --filter @chainviz/frontend test`のApp統合的な手動確認で確認
    済みだが、将来カード数が大幅に増えた場合はこの値の見直しが必要になる
    可能性がある）。
  - **視覚検証の制約**: 実行環境にPlaywrightのChromiumは配置済みだったが、
    `libnspr4.so`等のシステム共有ライブラリが不足しており（sudoのパス
    ワードが必要でパッケージの追加インストールができなかった）、実際の
    ブラウザでのスクリーンショット確認はできなかった。代わりに
    `pnpm --filter @chainviz/frontend dev`でVite開発サーバーを起動できる
    ことをHTTP応答で確認したうえで、`@testing-library/react`による
    コンポーネント単体テスト・`App`全体をモックデータで描画する一時的な
    手動確認テスト（成果物には含めていない。確認後削除した）で、
    ChainvizToken/Counter/未知のコントラクトのカードと「全ノードで実行」
    ピルが実際にDOMへ描画されることを確認した。
  - 新規・変更したテスト: `contractNode.test.ts`、`deployEdge.test.ts`、
    `ContractCard.test.tsx`、`ContractPopover.test.tsx`、
    `DeployEdge.test.tsx`、`DeployEdgePopover.test.tsx`（いずれも新規）、
    `canvasNode.test.ts`（`canvasNodeLayoutKey`のコントラクト分岐を追加）。
  - `pnpm --filter @chainviz/frontend build`・
    `pnpm --filter @chainviz/frontend test`（845件、うち新規54件）・
    `pnpm lint`（リポジトリ全体）がいずれも成功することを確認した。

### 2026-07-08 Issue #165 レビュー（合格）

- 担当: reviewer
- ブランチ: issue-165-contract-card（レビュー時点で未コミット）
- 内容: frontend 実装（コントラクトカード・ポップオーバー・デプロイエッジ）
  と tester のテスト強化の静的レビュー。`git diff main`（新規ファイル含む）
  の全体確認と `pnpm lint` / `pnpm build` / `pnpm test` の実行。
- 確認結果（すべて問題なし）:
  - **UX設計（ARCHITECTURE.md §6.2〜§6.4・§6.10）との整合**: コントラクト
    行は3段目の帯（`CONTRACT_GRID` originY=1040、§6.2の目安値）、レイアウト
    キーは address、初出時の空きスロット確定＋即保存（`resolveLayoutPositions`
    の再利用）、新着発光の合流、いずれも設計どおり。カードの構成（種別
    ラベル＋「全ノードで実行」ピル＋削除ボタン無し・名前・サブタイトル）、
    ポップオーバー（冒頭の誤解防止文＋観測できたフィールドのみ表示）、
    未知コントラクトの差別化（破線＋muted・「カタログ外」ピル・説明文
    差し替え・ピルとデプロイエッジは既知と同様）も §6.3/§6.4 のとおり。
    §6.10 の決定（全ノードへのエッジは張らない）も遵守されている。
    「確定タイミングの同期」（3経路目）は §6.6 = Issue #166 の担当範囲で
    あり、本実装のコードコメントにもその旨が明記されている
  - **既存UIパターンとの一貫性**: ContractCard は WalletCard と同型
    （hover state・Handle 構成・testid 命名・header/name/subtitle 構造）、
    デプロイエッジの導出は OwnershipEdge と同じ「エンティティから都度導出」
    方式、Canvas のホバー管理は PeerPropagationEdge のパターンを踏襲。
    i18n 文言は §6.8 の初稿と一字一句一致
  - **glossary 参照**: contract / deploy / abi / evm / token の5用語が
    実際に GlossaryTerm として参照されている（キーの実在も
    `glossary/ethereum/terms/c-transaction.yaml` で確認）。`event-log` を
    未参照のまま残した判断は妥当（§6.9 でのアンカーは「直近の呼び出し・
    イベント」ラベルで、これは §6.6 = Issue #166 の範囲）
  - **デプロイエッジのスコープ判断**: 妥当。Issue #165 本文が「UX設計
    (§6.2〜6.4)に従う」と明記しており、デプロイエッジは §6.3 内の確定
    仕様。Issue #166 は §6.6 のみを参照するため、ここで実装しなければ
    どのIssueにも属さず漏れていた
  - **tester 指摘（contractsToFlowNodes の未保存フォールバックが索引
    ベースで infraNode の findFreeGridPosition と異なる件）の判断**:
    対応不要（許容）とする。理由: (1) 恒久位置は App.tsx の
    `resolveLayoutPositions`（衝突回避あり）が初出時に確定・保存するため、
    索引ベースの位置は useEffect 発火までの1描画フレームの暫定表示に
    限られる (2) walletNode.ts の既存実装と同じ方式であり、本Issueで
    新たに導入した逸脱ではない (3) 起こり得る最悪ケースも「保存済み
    カードの上に新カードが1フレーム重なって見える」瞬時の視覚ノイズで、
    レイアウトデータは壊れない。また、インフラ用とコントラクト用の2つの
    レイアウト解決 useEffect が同一コミットで連続発火するケース（新規
    インフラと新規コントラクトが同時に現れる）も机上で追ったが、
    `resolveLayoutPositions` が既存レイアウトをスプレッドで引き継ぐため
    ユーザーがドラッグ済みの位置が失われることはなく、1フレーム余分に
    再解決が走るだけで収束する。将来 QA や実利用でちらつきが観測された
    場合は、infraNode.ts の `entitiesToFlowNodes` と同じ
    `findFreeGridPosition` 方式へフォールバックを揃える改善を別Issueで
    行えばよい（wallet 行も同時に揃えるのが望ましい）
  - **エラーの握りつぶし・決め打ち定数**: 新規コードに catch 節は無く、
    唯一の防御的フォールバック（`withAbiAnchor` の "ABI" 不一致時に
    プレーンテキストへ戻す）は理由がコメントに明記されている。固定値
    originY=1040 は成立前提（現状のカード実測高さ）がコード内コメントと
    本 worklog の両方に記録済みで、運用ルールを満たす
  - **テストの質**: 新規テスト（contractNode 18 / deployEdge 13 /
    ContractCard 16 / ContractPopover 14 / DeployEdge 5 /
    DeployEdgePopover 3 / canvasNode・i18n 追加分）は、異常系・境界値
    （name 空文字と undefined の境界、deployerAddress 空文字、ダングリング
    ガード、data undefined の防御、en/ja 両言語、Issue #113/#119 の回帰
    観点）を実質的に検証しており、実装の詳細をなぞるだけの無意味なテストは
    見当たらない
  - `pnpm lint` / `pnpm build` / `pnpm test` がリポジトリ全体で成功
    （shared 40 / collector 944 / frontend 872 / e2e 34 件）
- 軽微な観察（差し戻し対象ではない。記録のみ）:
  - デプロイエッジ（`stroke-dasharray: 5 4`）と所有エッジ（`6 4`）は
    どちらも破線で、識別は主に色（インディゴ vs 琥珀）・透明度（0.55 vs
    0.9）・太さ（1.4 vs 1.8）に依る。§6.3 の「アンバー破線と混同しない
    見た目」の要件（コントラクト色・低彩度）は満たしているが、実画面での
    見分けやすさは QA の目視確認に委ねる
  - `i18n.test.ts` の ja≠en チェックが `edge.deployedBy` を除外して
    いるが、実際には両言語の文が異なるため除外は不要（テストがわずかに
    緩いだけで実害なし）
  - レビュー時点で変更は全て未コミット。コミット時は「1つの変更内容 =
    1コミット」の規約に従い、関心事（カード/ポップオーバー・デプロイ
    エッジ・App/Canvas 配線・i18n・モックデータ・テスト・docs）を適切に
    分割すること（統括が実施）

### 2026-07-08 Issue #165 QA検証（合格）

- 担当: qa
- ブランチ: issue-165-contract-card（検証時点で未コミット）
- 検証方法: `pnpm --filter @chainviz/frontend build:web` でビルド後、
  `pnpm --filter @chainviz/frontend preview`（ポート4317、モックモード=
  VITE_COLLECTOR_URL未設定）で起動し、Playwright（playwright-core を
  scratchpad に導入し、キャッシュ済み Chromium のバイナリを executablePath
  指定で直接起動）で実ブラウザ描画・ホバー操作・スクリーンショットを取得
  して確認した。実装担当が報告していた Chromium の共有ライブラリ不足
  （libnspr4/libnss3/libnssutil3/libsmime3/libasound）は、`apt-get download`
  で該当 deb を取得しローカル展開して LD_LIBRARY_PATH に通すことで解消し、
  sudo なしで実ブラウザ起動に成功した。
- 完了条件の確認結果（すべて満たす）:
  - コントラクトカード3件が正しく描画される。ChainvizToken（カタログ既知・
    トークン持ち、サブタイトルに「トークン CVT」表示）、Counter（カタログ
    既知・トークン無し）、未知のコントラクト（0xdead01、名前は「未知の
    コントラクト」）の3種がいずれも表示された。
  - コントラクトカードがインフラ行（最上段）・ウォレット行（中段）に続く
    第3の帯（最下段）として配置されていることをオーバービュー画面で目視
    確認した。
  - 「全ノードで実行」ピルが3枚のカードすべてに表示される。
  - 未知のコントラクトが視覚的に区別される。DOM 上で
    `infra-card--contract-unknown` クラスが付与され、実画面でカード枠が
    破線ボーダー＋muted 色で描画されること、「カタログ外」ピルが未知
    カードにのみ表示されることを確認した。
  - glossary 用語が UI から実際に参照でき、ホバーで解説が出る。カード種別
    ラベル「コントラクト」にホバーするとスマートコントラクトの用語解説
    ツールチップ（関連語 EVM/DEPLOY/ABI/TOKEN 付き）が表示された。カード
    には contract / evm / token、ポップオーバーには deploy、未知ポップ
    オーバーには abi のアンカーがあり、glossary の5用語がUIから参照されて
    いることを確認した。
  - デプロイエッジ（ウォレット→コントラクト）が表示される。Alice→
    ChainvizToken、Bob（所有者削除済み）→Counter の2本が描画された。未知
    コントラクト（デプロイ元不明）にはデプロイエッジが張られない（正しい
    挙動）。
  - ポップオーバー: ChainvizToken ホバー時に「チェーンに複製され、全ノード
    が同じ実行をするプログラムです…」の誤解防止説明＋アドレス・デプロイ
    した人・作成 tx・トークン（CVT / decimals 18）を表示。未知コントラクト
    ホバー時は「chainviz のカタログに載っていないため、関数やイベントの
    意味（ABI）を復号できません。存在と呼び出しの発生だけを表示します」の
    説明＋アドレスのみを表示することを確認した。
  - デプロイエッジと所有エッジの識別: DOM の computed style で確認。
    デプロイエッジ = インディゴ rgb(111,125,234)・幅1.4px・破線 5,4。
    所有エッジ = 琥珀 rgb(224,169,79)・幅1.8px・破線 6,4。両者とも破線だが
    色（インディゴ vs 琥珀）が明確に異なり、太さも差があるため実画面で
    見分けられることを目視確認した。
  - `pnpm lint` / `pnpm build` / `pnpm test` をリポジトリ全体で独立実行し、
    いずれも成功（frontend 872 / collector 944 テスト等すべて pass、lint
    指摘なし、全パッケージ build 成功）。
- 判定: 合格。Issue #165 の完了条件をすべて満たしている。
