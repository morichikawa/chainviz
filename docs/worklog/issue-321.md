# Issue #321 デプロイされたコントラクトのソースコードを直接見れるようにする

### 2026-07-16 Issue #321 設計メモ（designer）

- 担当: designer
- ブランチ: issue-321-contract-source-view
- 内容: 実装着手前の設計。ワールドステートの型追加（`packages/shared` は
  本設計で実装済み）、データフロー、汎用サイドパネル機構の設計、実装分担の
  確定。設計の確定内容は `docs/ARCHITECTURE.md` §12（新設）・§2・§4 に
  反映済み。ここでは経緯・理由・実装担当への引き継ぎ詳細を残す。

## 評価（実際に動かして確認したこと)

frontend をモックモード（`VITE_COLLECTOR_URL` 未設定で `vite` 起動）+
Playwright で起動し確認した:

- コントラクトカードは既知（ChainvizToken / Counter）・未知の 3 枚が
  コントラクト行（キャンバス最下段）に出る。カード幅は fit 表示で約 140px
- カードのホバーポップオーバーは幅約 300px・高さ数行分。ソース全文
  （ChainvizToken.sol = 87 行 / Counter.sol = 31 行）を収める余地はなく、
  ホバー表示はスクロール操作とも相性が悪い → **専用パネル一択**と判断

## 決定事項と理由

1. **ソースの取得元はコントラクトカタログ（catalog.json）に同梱し、
   ワールドステート（`ContractEntity.sourceCode`）に載せて届ける**
   - `build-catalog.sh` が `src/*.sol` を各エントリの
     `source: { fileName, language, code }` として埋め込む。`src/` が単一の
     真実の情報源のまま（表示されるソース = デプロイに使う実物）
   - collector はカタログ照合（name/catalogKey/token を埋めるのと同じ箇所）で
     `sourceCode` へ転記するだけ。新しい観測・RPC・DiffEvent は増やさない。
     未知→既知昇格（Issue #244 の自己修復）でも同じ entityUpdated パッチに乗る
   - ABI をフロントへ渡さない ChainAdapter 境界とは矛盾しない: ABI は
     「復号のためのチェーン固有データ」だが、ソースは表示用の不透明テキスト。
     `language` は生の文字列で解釈はフロント表現セットの責務
     （operation/stage/nodeRole と同じパターン）
   - 採らなかった案:
     - フロント表現セットへの静的同梱（operationCatalog 方式）: ソース全文の
       二重管理になり「表示 ≠ デプロイ実物」の乖離リスク。フォーム定義
       （小さいメタ情報）とは許容できる重複の規模が違う
     - 要求応答型プロトコル（ソース取得コマンド）: 現在計約 5KB のデータに
       対し過剰。スナップショット同乗で十分。カタログ肥大化時に再検討
   - サイズ影響: 現カタログで約 5KB。同一カタログコントラクトを複数
     デプロイするとエンティティごとに複製されるが、学習用途の規模
     （ユーザー操作によるデプロイが数件）では無視できる
2. **表示は右ドックの専用サイドパネル**（ポップオーバー埋め込みは不採用。
   上記の実測理由）。CONCEPT.md「用語解説」の「画面右側のタブ」構想とも
   位置が整合する
3. **汎用サイドパネル機構をここで新設し、#313（用語集）・#317（通信ログ）が
   kind 追加だけで載れる形にする**
   - `SidePanelView` 判別共用体（今回は `{ kind: "contractSource";
     address: string }` のみ）+ `SidePanelContext`/`useSidePanel`
     （`view`・`open`・`close`）+ シェル `SidePanel`（ヘッダ・閉じる・Esc・
     スクロール・ガラス質感）と、kind ごとの中身コンポーネントを分離
   - 同時 1 枚（排他）。`open` は置き換え
   - タブバー・複数同時表示・下部ドロワー等は先回り実装しない（#313/#317 の
     設計時に必要なら拡張。位置の拡張余地は構造として残す）
   - レイヤーレンズの dim 対象外（既存の常設パネルと同じ扱い）
4. **未知のコントラクトにも「ソースコードを見る」ボタンは出す**。押すと
   パネル側で「チェーン上にあるのはバイトコードだけでソースは復元できない。
   カタログ掲載分のみ表示できる」を明示する（隠すより理由を学べる方が
   学習アプリとして価値がある。§6.4 の差別化方針と一貫）
5. **シンタックスハイライトは実施する**。実現は表現セット
   （`chain-profiles/ethereum/`）に置く自前の軽量トークナイザ（純関数、
   コメント/文字列/キーワード/型名/数値の 5 分類程度）。Prism/Shiki 等の
   ライブラリは、対象が自作サンプル 2 ファイル（計 118 行）で文法網羅が
   不要なこと・依存追加回避・純関数のテスト容易性から不採用（カタログが
   増えて保守が割に合わなくなったら再検討）。行番号付き・等幅で表示する

## shared の型変更（本設計で実装済み）

- `packages/shared/src/world-state/entities.ts`:
  - `ContractSourceCode`（`fileName` / `language` / `code`）を新設
  - `ContractEntity.sourceCode?: ContractSourceCode` を追加
    （省略 = ソースが手元に無い。旧スナップショット互換）
- テストは `entities.test.ts` が肥大化しているため関心事単位で分割し、
  `entities.contractSource.test.ts` を新設（JSON 往復・省略時の意味論・
  language 生文字列・空ソースの境界）
- `pnpm build && pnpm test && pnpm lint` 全パッケージ通過を確認済み
  （shared 68 / collector 1458 / frontend 2252）

## 実装分担（引き継ぎ）

依存順序: shared 型は確定済みなので、以下 3 つはほぼ並行可能。ただし
collector の実データ確認には catalog.json の再生成が先にあると楽。

### node-env（profiles/ethereum/contracts/）

- `build-catalog.sh`: `add_entry` にソース埋め込みを追加する
  （`jq --rawfile` で `src/<Name>.sol` を読み、
  `source: { fileName: "<Name>.sol", language: "solidity", code: <全文> }`
  をエントリに足す）。ファイルが無ければ既存の ABI 欠落時と同様にエラーで
  停止する
- `catalog.json` を再生成してコミット（ABI 部分に差分が出ないことを確認）

### collector（packages/collector/src/adapters/ethereum/）

- `catalog.ts`: `CatalogEntry` に `source?: { fileName: string;
  language: string; code: string }` を追加。検証（3 フィールドとも string で
  なければ source 無し扱い。**エントリ自体は落とさない**・理由をログに残す）
- `contracts.ts`: カタログ照合で `ContractEntity` を組み立てている箇所
  （name/catalogKey/token の転記と同じ場所。未知→既知昇格のパッチ生成も
  含む）で `sourceCode` を転記
- テスト: source 付きカタログの読み込み、不正 source の縮退、エンティティ/
  パッチへの転記、source 無しエントリで `sourceCode` が省略されること

### frontend（packages/frontend/src/）

- `side-panel/`（新設ディレクトリ）: `SidePanelView` 型・
  `SidePanelContext`/`useSidePanel`・シェル `SidePanel`（ヘッダ・閉じる
  ボタン・Esc クローズ・本文スクロール）。スタイルは infra-popover 系の
  ガラス質感に揃える。幅 400px 目安（実測で調整可）
- `side-panel/ContractSourceView.tsx`（名称は裁量）: アドレスで world state
  から `ContractEntity` を引き、`sourceCode` の有無で表示を分岐。
  行番号付き `<pre>`。エンティティが見つからない場合はパネルを閉じる
  （ダングリングガード)
- `chain-profiles/ethereum/`: Solidity 用軽量トークナイザ（純関数）と、
  `language` 文字列 → トークナイザの対応。未知 language はプレーン表示
- `entities/ContractCard.tsx`: 「ソースコードを見る」ボタン（nodrag）を追加
  し、`useSidePanel().open({ kind: "contractSource", address })` を呼ぶ
- i18n（`i18n/messages.ts`。文言は初稿、語調調整は裁量）:
  - `contract.viewSource`: 「ソースコードを見る」 / "View source code"
  - `sidePanel.close`: 「閉じる」 / "Close"
  - `contractSource.title`: 「ソースコード」 / "Source code"
  - `contractSource.unavailable`: 「このコントラクトのソースコードは
    chainviz の手元にありません。チェーン上にあるのはコンパイル済みの
    バイトコードだけで、そこから元のソースコード（関数やイベントの意味 =
    ABI を含む）は復元できません。カタログに載っているコントラクトだけ
    ソースを表示できます」 / 英訳は同趣旨（`withAbiAnchor` の流儀で ABI 語に
    用語解説アンカーを付けてよい）
- data-testid の目安: `side-panel` / `side-panel-close` /
  `contract-source-view` / `contract-source-unavailable` /
  `contract-view-source-<address>`
- モックデータ（`websocket/mockData.ts`）の既知コントラクトに `sourceCode`
  を足すと、collector 無しで見た目を確認できる
- テスト: パネル開閉（開く・閉じる・Esc・排他置き換え）、既知/未知の表示
  分岐、トークナイザ（純関数）、カードのボタン導線

## 実装時に判断してよい点（未決のまま渡す）

- パネルの正確な幅・ソース表示のフォントサイズ・折り返しの有無（実測で調整）
- 未知コントラクト説明文への用語解説アンカーの付け方（`withAbiAnchor`
  再利用の可否含む）
- トークナイザの分類粒度（5 分類は目安。テスト可能な純関数であれば増減可）
- `ContractSourceView` 内でのコントラクト名ヘッダ表示の細部
  （短縮アドレスの桁数など既存流儀に合わせる）

## 注意点

- ソース表示は「カタログの実物ソース」であり、フロントに別コピーを持たせ
  ない（乖離防止がこの設計の軸。ContractListPanel 等に流用する場合も
  必ず `ContractEntity.sourceCode` を参照する）
- `catalog.json` の再生成で ABI 部分に差分が出た場合は foundry イメージの
  solc バージョン差を疑うこと（`foundry.toml` が solc_version を固定して
  いるので通常は出ない)

### 2026-07-16 node-env 実装（node-env）

- 担当: node-env
- ブランチ: issue-321-contract-source-view（worktree
  `.claude/worktrees/agent-aeeabcecbb84906d6`）
- 内容: `build-catalog.sh` の `add_entry` に、`src/<ContractName>.sol` を
  そのまま読み込んで各エントリへ `source: { fileName, language, code }` を
  埋め込む処理を追加した。`language` は "solidity" 固定の生文字列（解釈は
  フロント側の責務、設計メモの決定どおり）。`code` は `jq --rawfile` で
  ソースファイル全文をそのまま文字列化している。ソースファイルが見つからない
  場合は、既存の ABI 欠落時と同様にエラーメッセージを出して停止するように
  した（`abi_path` の存在チェックと対になる `src_path` の存在チェックを追加）。
  既存の ABI 抽出・token フィールドのロジックには手を加えていない。
- 動作確認: ローカルに `forge`/`jq` が無い環境だったため、`jq` は
  https://github.com/jqlang/jq のリリースバイナリを作業用に取得して
  `PATH` に通し、`forge` は既存のフォールバック経路（`docker run
  ghcr.io/foundry-rs/foundry:latest`）をそのまま使って `build-catalog.sh`
  を実行した。結果:
  - `catalog.json` が再生成され、`ChainvizToken` / `Counter` の両エントリに
    `source.fileName` / `source.language` / `source.code` が追加された
  - `git diff` で ABI 部分（`abi` / `token` フィールド）に差分が出ていない
    ことを確認（既存ロジック無傷。foundry.toml の solc_version 固定どおり）
  - `jq -j '.<Name>.source.code'` で catalog.json から取り出した文字列と
    `src/<Name>.sol` の実ファイルを `diff` で突き合わせ、両コントラクトとも
    完全一致することを確認した（改行コードも含め、埋め込みが原文そのままで
    あることを実データで検証）
  - `sh -n build-catalog.sh` で構文エラーが無いことを確認
- 次の担当（collector）への引き継ぎ: `catalog.json` の各エントリに
  `source: { fileName: string; language: string; code: string }` が入って
  いる。`packages/shared` の `ContractSourceCode` と同じ形なので、
  collector 側は素直に転記できるはず。

### 2026-07-16 collector 実装（collector）

- 担当: collector
- ブランチ: issue-321-contract-source-view（worktree
  `.claude/worktrees/agent-aeeabcecbb84906d6`）

#### 設計メモ

- 変更対象は既存の name/catalogKey/token 転記と全く同じ2箇所のみ:
  - `packages/collector/src/adapters/ethereum/catalog.ts`: `CatalogEntry` に
    `source?: CatalogSource`（`fileName`/`language`/`code` の3フィールド）を
    追加。`readContractCatalog` の読み込みループで `source` を検証する
    `isValidSource` を新設し、3フィールドとも `string` でなければ
    `source` だけ落としてエントリ自体は生かす（token は無検証で素通しする
    既存方針とは異なり、ソースは全文テキストなので形が壊れているとフロント
    表示が壊れるため明示的に検証する。設計メモの指示どおり）
  - `packages/collector/src/adapters/ethereum/contracts.ts`:
    `ContractTracker.applyCatalog`（`recordDeployment` の pending 適用と
    `registerDeployment` の両経路から呼ばれる、name/token を転記している
    のと同じ private メソッド）で `catalogEntry.source` があれば
    `ContractEntity.sourceCode` へ転記する。新しい観測・RPC呼び出し・
    DiffEvent は追加していない（entityAdded/entityUpdated に相乗り）
- カタログに無い「未知のコントラクト」、およびカタログにあるがソース未同梱の
  エントリ（Counter 等、将来的にソース無しのカタログエントリが増えても）は
  `sourceCode` を省略したまま返す（既存の token 省略と同じ流儀）

#### 実施内容

- 上記2ファイルを変更
- テスト:
  - `catalog.test.ts` に、source が正しい形の場合に素通しされること・
    source フィールド自体が無い場合に省略されること・source の一部
    フィールドが欠落/型違い/非オブジェクトの場合にエントリは生かしたまま
    source だけ省略されログに残ることを追加（5ケース）
  - 新規ファイル `contracts.source-code.test.ts` を作成（既存
    `contracts.test.ts` が423行と大きいため、1ファイル1責務の原則に従い
    sourceCode 転記の観点だけを分離）。pending 適用経路・
    registerDeployment 経由の事後適用（未知→既知昇格）経路・ソース未同梱
    カタログエントリ・未知コントラクト・カタログ側オブジェクトを書き換えて
    いないこと（防御的コピー）の5ケース

#### 確認結果

- `pnpm --filter @chainviz/collector build` 通過
- `pnpm --filter @chainviz/collector test` 通過（65 test files / 1468
  tests、うち新規10件）
- `npx eslint` を変更ファイルに対して実行し警告無し

#### 次の担当への引き継ぎ

- frontend 側（別ブランチ `issue-321-contract-source-view-frontend`）が
  cherry-pick で合流する際、この collector 側の変更と `packages/shared` の
  既存の型変更（`ContractSourceCode`・`ContractEntity.sourceCode`）は
  そのまま整合するはずで、追加の型変更は不要
- `docs/PLAN.md` のチェックボックスは、frontend 側の実装・レビュー・QAが
  完了してから更新する想定のため、今回は更新していない

### 2026-07-16 Issue #321 frontend実装 設計メモ・実施記録

- 担当: frontend
- ブランチ: issue-321-contract-source-view-frontend
- 前提: designerが別ブランチ(issue-321-contract-source-view)で設計を実施済み。
  設計メモの全文は該当ブランチのworktreeに残っている
  (`packages/shared/src/world-state/entities.ts`の`ContractSourceCode`型・
  `ContractEntity.sourceCode?`フィールド、`ARCHITECTURE.md`§12「サイドパネル
  機構とコントラクトソース表示」)。本ブランチではまずその設計内容を確認し、
  `packages/shared`の型変更を同じ内容でこちらにも適用してから、frontend側の
  実装のみを行った。node-env(catalog.jsonへのソース埋め込み)・collector
  (catalog.json→ContractEntity.sourceCodeへの転記)は別ブランチ
  (issue-321-contract-source-view)で並行実装中で、本ブランチには含まれない。
  後日統括が3ブランチをまとめて合流させる想定。

## 設計メモ(着手前に立てた実装方針)

設計担当の決定事項(§12.1〜§12.4)をそのまま踏襲する。以下は実装ファイル構成・
関数構成の対応関係。

- **汎用サイドパネル機構**(`packages/frontend/src/side-panel/`。新設ディレクトリ):
  - `sidePanelView.ts`: 判別共用体`SidePanelView`(今回は
    `{ kind: "contractSource"; address: string }`のみ)
  - `SidePanelContext.tsx`: `SidePanelProvider` + `useSidePanel()`
    (`view`/`open`/`close`)。`RibbonHoverContext.tsx`と同じ「Contextが無ければ
    throw」パターン
  - `SidePanel.tsx`: シェル(ヘッダ・閉じるボタン・Escクローズ・本文スクロール)。
    `OperationPanel.tsx`のEscクローズの仕組みを流用するが、外側クリックでは
    閉じない(常設ドックパネルのため。コントラクトのソースを読みながら他の
    カードを操作し続けられるようにする設計判断)
  - `SidePanelHost.tsx`: `SidePanelView.kind`ごとの振り分け + ダングリング
    ガード(対象アドレスのエンティティがworld stateから消えたら自動的に閉じる)。
    今回は`contractSource`のみのcase。今後Issue #313/#317はここにcaseを足す
    だけで乗る想定
  - `ContractSourceView.tsx`: パネルの中身。`sourceCode`の有無で表示を分岐
- **シンタックスハイライト**(`packages/frontend/src/chain-profiles/ethereum/
  sourceTokenizer.ts`。新設): 自前の軽量トークナイザ(純関数)。
  - `tokenizeSolidity(code): SourceToken[]`: コメント/文字列/キーワード/型名/
    数値/プレーンの6分類(設計メモの「5分類程度」に対しplainを加えた6分類)。
    正規表現1本(優先順位: 行コメント→ブロックコメント→文字列→数値→識別子)+
    マッチしなかった区間をプレーンとして詰める方式。隣接するプレーン片は
    連結して無駄なspanを増やさない
  - `splitTokensIntoLines(tokens): SourceToken[][]`: トークン列を行ごとに
    分割する汎用関数(ブロックコメントのような複数行にまたがるトークンも
    正しく割る)。言語非依存(どのトークナイザの出力にも使える)
  - `resolveSourceLines(code, language): SourceToken[][]`:
    `ContractSourceCode.language`からの解決。`"solidity"`以外は全体を1つの
    plainトークンとして`splitTokensIntoLines`に渡すことで、装飾なしの行分割
    フォールバックを実現(この2段構成により専用のフォールバック実装が不要)
- **`ContractCard.tsx`**: 「ソースコードを見る」ボタン(nodrag)を追加。
  未知のコントラクトにも常に表示し、`useSidePanel().open({ kind:
  "contractSource", address })`を呼ぶ
- **配線**: `App.tsx`で`RibbonHoverProvider`の内側に`SidePanelProvider`を追加
  (`ContractCard`と`Canvas`内の`SidePanelHost`の共通の祖先)。`Canvas.tsx`は
  既存の`nodeEntitiesForMempool`と同じ「rfNodesをfilterするだけ」の流儀で
  `contractsByAddress`(address→ContractEntityの索引)を算出し、`SidePanelHost`
  に渡す
- **i18n**: `contract.viewSource`/`sidePanel.close`/`contractSource.title`/
  `contractSource.unavailable`を追加(設計メモの初稿文言をほぼそのまま採用)
- **既存コードの小さな汎用化**: `ContractPopover.tsx`の`withAbiAnchor`
  (文中の「ABI」だけにGlossaryTermアンカーを付ける処理)を
  `glossary/withTermAnchor.tsx`へ抽出し、`ContractSourceView.tsx`の
  「ソースが手元に無い」説明文でも同じ流儀を再利用した(設計メモが
  「`withAbiAnchor`再利用の可否含む」を実装時判断としていたため)

## 実施内容

- `packages/shared/src/world-state/entities.ts`:
  `ContractSourceCode`型・`ContractEntity.sourceCode?`フィールドを追加
  (designerブランチと同一内容)。テストは`entities.contractSource.test.ts`を
  そのままコピー(4件、JSON往復・省略時の意味論・language生文字列・空ソース)
- `packages/frontend/src/side-panel/`: 上記5ファイル(sidePanelView.ts/
  SidePanelContext.tsx/SidePanel.tsx/SidePanelHost.tsx/ContractSourceView.tsx)
  を新設
- `packages/frontend/src/chain-profiles/ethereum/sourceTokenizer.ts`を新設
- `packages/frontend/src/entities/ContractCard.tsx`: ボタン追加
- `packages/frontend/src/entities/ContractPopover.tsx`:
  `withAbiAnchor`を`withTermAnchor`呼び出しの薄いラッパーに変更
- `packages/frontend/src/glossary/withTermAnchor.tsx`を新設
- `packages/frontend/src/app/App.tsx` / `packages/frontend/src/canvas/
  Canvas.tsx`: `SidePanelProvider`/`SidePanelHost`の配線
- `packages/frontend/src/i18n/messages.ts`: i18nキー4件追加
- `packages/frontend/src/websocket/mockData.ts`: `chainvizTokenContract`に
  実カタログ(`profiles/ethereum/contracts/src/ChainvizToken.sol`)からの
  抜粋を埋め込み、collector無しでモックモードから見た目を確認できるように
  した。
  `counterContract`は意図的に`sourceCode`を持たせず、「カタログ既知だが
  ソース未同梱」のケースをオフラインで確認できるようにした
  (`unknownContract`の「未知かつソース無し」との対比)

## テスト

- `sourceTokenizer.tokenize.test.ts`/`.lines.test.ts`/`.resolve.test.ts`:
  関心事ごとに3ファイルへ分割(トークン分類/行分割/言語解決+フォールバック)
- `side-panel/SidePanelContext.test.tsx`/`SidePanel.test.tsx`/
  `SidePanelHost.test.tsx`/`ContractSourceView.test.tsx`: 状態管理・シェル・
  振り分け(ダングリングガード含む)・表示分岐(既知/未知/ソース有無/
  未知言語フォールバック)をそれぞれ分割してテスト
- `glossary/withTermAnchor.test.tsx`: 抽出したヘルパー自体のテスト
- `entities/ContractCard.test.tsx`: 既存テストを`SidePanelProvider`配下に
  変更(ContractCardが`useSidePanel`を読むようになったため必須)。加えて
  「ソースコードを見るボタン」の表示・クリックでの`open`呼び出しをテスト追加

## 既存テストへの副作用の修正

`ContractCard`が新たに`useSidePanel()`を読むようになったため、既存の
`ContractCard`を直接レンダーしていた以下のテストファイルで
`SidePanelProvider`が無く例外になった。いずれも`RibbonHoverProvider`の
内側に`SidePanelProvider`を追加して解消した(挙動そのものへの変更ではない):

- `entities/chainRibbonCrossHighlight.test.tsx`
- `interaction/popoverPortalConsistency.test.tsx`

## 確認したこと

- `pnpm --filter @chainviz/shared build && test`: 68件全通過
- `pnpm --filter @chainviz/frontend build && test`: 161ファイル・2301件全通過
- `pnpm build && pnpm test`(モノレポ全体): 全パッケージ通過
- `pnpm lint`: 通過
- モックモードでの実見た目確認: このサンドボックス環境にはヘッダレス
  Chromiumの依存ライブラリ(`libnspr4.so`等)が無く、Playwrightでの
  スクリーンショット取得ができなかった(sudoにパスワードが必要で
  インストール不可)。`vite`起動・HTTP応答(200)自体は確認済み。実際の
  見た目確認はQA(chainviz-qa)側で改めて行うことを想定する

- **`docs/ARCHITECTURE.md`の同期は本ブランチでは行っていない**: designer
  ブランチ(issue-321-contract-source-view)側で§12(サイドパネル機構と
  コントラクトソース表示)が既に書かれている。本ブランチの実際の実装
  (`SidePanelHost.tsx`によるkind振り分けの位置、`sourceTokenizer.ts`の
  `resolveSourceLines`によるフォールバック実現方法など、設計メモが
  「実装時に判断してよい点」としていた細部)との整合確認・最終的な文書
  反映は、3ブランチ(node-env/collector/frontend)を合流させる際にまとめて
  行うことを想定する(2つのブランチで同じ節を別々に編集すると合流時に
  コンフリクトするため、あえて本ブランチでは触れていない)

- **`docs/PLAN.md`のチェックボックスは更新していない**: Issue #321のチェック
  ボックスはnode-env・collector・frontendの3パッケージ分を合わせた1項目
  であり、本ブランチで完了しているのはfrontend分のみ。3ブランチが合流し
  Issue全体が完了した時点でチェックするのが適切と判断し、frontend単体の
  完了をもってチェックは付けていない

## 注意点(次の担当・レビュー担当向け)

- **合流時の型定義の一致確認**: 本ブランチの`entities.ts`変更は
  designerブランチ(issue-321-contract-source-view)からの手動コピーであり、
  git履歴上は独立した変更。マージ時に3ブランチ(node-env/collector/
  frontend)を合流させる際、`ContractSourceCode`型定義がコンフリクトなく
  一致することを確認すること
- **`contractsByAddress`の算出場所**: `App.tsx`は既に`contractsByAddress`を
  算出済みだったが、`Canvas.tsx`側でも`nodeEntitiesForMempool`と同じ
  「rfNodesをfilterする」流儀で独立に算出する設計にした(propとして
  二重に渡すより、Canvas内で完結させる方が既存パターンと一貫すると判断)。
  App.tsx側の`contractsByAddress`とは別物(値は同じになるはずだが参照は
  異なる)
- **モックの`sourceCode`はcollector未合流でも動く**: `mockData.ts`の
  `chainvizTokenContract`に実ソースを埋め込んだため、collector側の実装が
  合流していない現時点でも`pnpm dev`のモックモードでパネルの見た目を
  確認できる(実データでの確認はcollector合流後)
- **トークナイザの対象言語拡張**: `resolveSourceLines`は`"solidity"`のみを
  特別扱いし、それ以外は装飾なしのプレーン表示にフォールバックする。
  将来Vyper等に対応する場合は`sourceTokenizer.ts`に新しい`tokenizeXxx`と
  分岐を追加すればよい(既存のトークン分類・行分割の型はそのまま使える)

### 2026-07-16 テスト強化（tester）

- 担当: tester
- ブランチ: issue-321-contract-source-view（3者合流済み）
- 内容: node-env/collector/frontend の実装に対し、異常系・境界値のテストを
  追加した。実装コードには手を入れていない（テストの追加のみ）。実装の
  バグは見つからず、既存挙動を固定する回帰テストとして追加した。

#### collector

- `catalog.test.ts`: `isValidSource` のフィールド別検証を拡充。fileName/
  language の個別欠落、fileName/language の型違い、`source: null`（typeof
  object だが null チェックで弾かれる）、`source` が配列、全フィールドが
  空文字（空文字は valid string なので通す境界）、code に改行・タブ・
  Unicode を含む場合の verbatim 透過、非常に長い code の透過を追加。
- `contracts.source-code.test.ts`: 同一カタログキーを別アドレスに2回
  デプロイした場合に両エンティティが独立した sourceCode を持つこと、
  registerDeployment の再登録（冪等な no-op）で sourceCode が維持される
  こと、recordDeployment の重複検知で sourceCode が維持されることを追加。

#### frontend

- `sourceTokenizer.tokenize.test.ts`: 敵対的/不正入力向けの describe を追加。
  コメント/文字列内のキーワード風語を分類しないこと、入れ子ブロックコメントが
  最初の `*/` で閉じること、未終端の文字列・ブロックコメントで例外を投げず
  round-trip（全 text 連結 = 元ソース）が保たれること、数字＋英字が number に
  ならないこと、タブ・非ASCII の保持、末尾エスケープバックスラッシュ付き
  文字列の扱いを追加。round-trip 不変条件は splitTokensIntoLines の前提で
  あり、これが崩れると行分割で表示が壊れるため重点的に固定した。
- `SidePanelHost.test.tsx`: パネル表示中に対象エンティティが後続レンダーで
  消えるダングリング遷移そのもの（開いた瞬間から不在ではなく、存在→消滅の
  時系列）でパネルが閉じること、複数アドレスを連続で開いた際に前のパネルが
  置き換わり最後の1枚だけが残る排他動作を追加。
- `ContractSourceView.test.tsx`: sourceCode はあるが code が空文字の場合に
  「ソース無し」説明文ではなくソースブロック（1行の空行・ファイル名表示）に
  倒れる境界を追加。

#### 確認

- `pnpm build` / `pnpm test`（全パッケージ）通過。frontend 2301→2312件、
  collector 1468→1480件。

### 2026-07-16 レビュー（reviewer）

- 担当: reviewer
- ブランチ: issue-321-contract-source-view（3者合流＋テスト強化済みの状態）
- 判定: **概ね合格**。実装・テスト・設計整合に機能上の問題は無し。ただし
  マージ前に直すべき「コメント/記録の正確性」の軽微な指摘が3件ある
  （いずれも動作に影響しない文言修正。統括または frontend 担当が
  1コミットで対応できる規模）。

#### 確認した内容（問題なし）

- **境界の遵守**: `ContractSourceCode` は表示用の不透明テキストで、
  チェーン固有語彙（RPC メソッド名等）は shared/フロントに漏れていない。
  `language` は生文字列でその解釈（トークナイザ選択）は
  `chain-profiles/ethereum/sourceTokenizer.ts`（表現セット）に閉じている。
  ABI は従来どおりフロントへ渡していない
- **チェーンプロファイル独立性**: 変更は ethereum プロファイル
  （profiles/ethereum・adapters/ethereum・chain-profiles/ethereum）に
  閉じており、他プロファイルへの分岐追加は無い
- **node-env**: `build-catalog.sh` の `jq --rawfile` 埋め込みと `src_path`
  存在チェック（ABI 欠落時と対になるエラー停止）を確認。catalog.json の
  `source.code` と `src/*.sol` 実ファイルの完全一致を実データで検証
  （ChainvizToken / Counter とも MATCH）。ABI/token 部分に差分なし
- **collector**: `isValidSource` は3フィールドを個別に string 検証し、
  不正時はエントリを生かして source だけ落とし理由をログに残す
  （エラー握りつぶし無し）。`applyCatalog` の `sourceCode` 転記は
  name/token と同じ箇所・同じ省略流儀で、防御的コピーになっている。
  pending 適用・未知→既知昇格の両経路をテストが押さえている
- **frontend**: `SidePanelView` 判別共用体 + `SidePanelContext`/`useSidePanel`
  （排他1枚・置き換え）+ シェル `SidePanel`（kind を知らない）+
  `SidePanelHost`（kind 振り分け・ダングリングガード）の分離は設計どおりで、
  #313/#317 が kind とコンポーネント追加だけで相乗りできる構造。
  `withAbiAnchor`→`withTermAnchor` は挙動保存のリファクタで既存テストも通過
- **トークナイザ**: gap を plain で詰める方式のため round-trip 不変条件
  （全 text 連結 = 元ソース）が構造的に保たれ、未終端文字列/コメント等の
  敵対的入力でも欠落しないことをテストが固定している
- **テストの質**: collector/frontend とも異常系・境界値（フィールド別欠落・
  型違い・null/配列・空文字境界・ダングリング遷移・排他置き換え・空 code）
  を実挙動ベースで検証しており、「実装をなぞるだけ」のテストは見当たらない
- **docs**: ARCHITECTURE.md §12（§2・§4 含む）は実装と整合（パネル幅
  420px は「400px 目安・実測で確定してよい」の裁量内）。WORKLOG.md 索引に
  #321 の行あり
- **固定値依存・エラー握りつぶし**: 該当なし（タイムアウト等の環境依存
  定数は追加されていない）
- **コミット粒度**: main..HEAD の17コミットはいずれも単一の関心事
  （shared 型 / build-catalog.sh / catalog.json 再生成 / collector 転記 /
  トークナイザ / withTermAnchor 抽出 / サイドパネル機構 / ビュー / 配線 /
  カードボタン / モック / スタイル / worklog / テスト強化）に分かれている
- **lint/build/test**: リポジトリ全体で `pnpm lint && pnpm build && pnpm test`
  を再実行し全通過（shared 68 / collector 1480 / frontend 2312 / e2e 171）

#### 指摘（軽微・マージ前の修正を推奨）

1. **`packages/frontend/src/websocket/mockData.ts` のコメントが事実と不一致**:
   `CHAINVIZ_TOKEN_SOURCE` の doc コメントは「実カタログ
   （profiles/ethereum/contracts/src/ChainvizToken.sol）の全文と一致させる」と
   主張するが、実際の埋め込みは35行の抜粋（実ファイルは87行。mint/approve/
   transferFrom/_transfer/_mint と NatSpec の一部を省略）で一致しない。
   本 worklog の frontend 実施記録の「実カタログ…の全文を埋め込み」も同様に
   不正確。モック専用データなので動作上の問題は無いが、「一致させる」という
   宣言は将来の保守で誤解を生む。**コメント（と worklog の記述）を「抜粋」で
   ある旨に改めるか、実ファイル全文を埋め込むか、どちらかに揃えること**
2. **コード内コメントの参照先誤り（8箇所）**: `side-panel/` 各ファイル・
   `sourceTokenizer.ts`・`i18n/messages.ts` のコメントが
   「docs/worklog/issue-321.md §12.2/§12.3/§12.4」を参照しているが、
   §12 の節番号は `docs/ARCHITECTURE.md` のもの（worklog に §12 という節は
   無い）。`docs/ARCHITECTURE.md §12.x` へ訂正すること
3. **`SidePanelHost.tsx` の props コメントが実装と不一致**:
   `contractsByAddress` の説明が「App.tsx で既に算出済みのものを使う」と
   なっているが、実際は Canvas.tsx が独自に算出して渡している（本 worklog の
   frontend 記録にもその設計判断が明記されている）。コメントを実装に
   合わせて訂正すること

- レビュー担当自身はコード修正を行っていない（役割上、コードの書き換えは
  `packages/shared` の型更新に限るため）。上記3点の修正は統括または
  frontend 担当に委ねる。修正後の再レビューは、該当コメント/文言の差分
  確認のみで足りる（ロジック変更を伴わないため）

### 2026-07-16 再レビュー（reviewer。コミット 9192470 のコメント修正確認）

- 判定: **条件付き不合格（軽微な取りこぼし1件のみ。修正後は差分確認不要で
  合格扱いとしてよい）**
- 確認した内容:
  - 指摘1（mockData.ts「全文と一致させる」→「からの抜粋」、worklog の
    同記述の修正）: 反映を確認
  - 指摘2（コメントの参照先 `docs/worklog/issue-321.md §12.x` →
    `docs/ARCHITECTURE.md §12.x`）: 8箇所の置換を確認。
    `docs/ARCHITECTURE.md` 自身への誤爆は無し（同ファイルはコミットで
    未変更。§12冒頭の worklog への参照は元から正当な記述）。
    `docs/ARCHITECTURE.md` に §12.2/§12.3/§12.4 の節が実在することも確認
  - 指摘3（SidePanelHost.tsx の props コメント「App.tsx で既に算出済み」→
    「Canvas.tsx が rfNodes から算出する」）: 反映を確認
  - `pnpm --filter @chainviz/frontend build` / `test` 通過
    （161ファイル / 2312件）
- 取りこぼし（要修正）:
  - `packages/frontend/src/styles.css` 622〜623行目
    （`.contract-card__view-source` のコメント）に
    `docs/worklog/issue-321.md §12.3` が1箇所残っている。
    `docs/worklog/issue-321.md` と `§12.3` が改行をまたいでいるため、
    同一行前提の sed 置換から漏れたもの。`docs/ARCHITECTURE.md §12.3` に
    訂正すること
