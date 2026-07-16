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
