# Issue #169 作業記録

### 2026-07-07 Issue #169 C層拡張の用語データ(contract/deploy/abi/event-log/evm/token)追加 (frontend)

- 担当: frontend
- ブランチ: issue-169-glossary-contract-terms
- 内容: Phase 4(C層拡張)向けの用語6件(`contract`・`deploy`・`abi`・
  `event-log`・`evm`・`token`)を `glossary/ethereum/terms/c-transaction.yaml`
  に追加した。新規ファイルは作らず既存の C層ファイルに追記している
  (`docs/CONCEPT.md` の「C層: transaction、mempool、gas、nonce、contract、
  ABI、calldata、イベントログ、デプロイなど(Contract系はここが中心)」という
  分類方針に合わせ、`layer: c-transaction` を踏襲)。
  - 各エントリは `docs/ARCHITECTURE.md` §6.9 の方針どおり「定義 → なぜ
    必要か → chainviz ではどう見える」の3拍子で ja/en 両方を書いた。
    §6.9 の表にある「定義に必ず含めるポイント」(全ノード実行・ABIが
    無いと復号できない理由・イベントログの役割等)をすべて盛り込んでいる。
  - `relatedTerms` は既存キー(`transaction`/`eoa`)と新規キー同士
    (`contract`⇄`evm`/`deploy`/`abi`/`token`、`abi`⇄`event-log`)の両方に
    張った。ダングリング参照(存在しないキーへの relatedTerms)は無い。
- 決定事項・注意点:
  - **UIアンカーは本Issueのスコープ外**。ARCHITECTURE.md §6.9 が挙げる
    アンカー(コントラクトカードの種別ラベル・「全ノードで実行」ピル等)は
    #165〜#168(ContractCard・呼び出し/イベント可視化・定型操作UI・
    トークン残高表示)で実装される。本Issue完了時点ではこの6用語は
    `<GlossaryTerm termKey="..." />` からまだ参照されていない
    (`docs/PLAN.md` ステップ8で frontend 側の担当を分割しており、
    データ追加が先行する運用)。Issue #124 の教訓(アンカー無しの用語は
    存在しないのと同じ)を踏まえ、#165〜#168 の実装担当は本Issueで追加した
    termKeyを実際にカード側から参照することを確認する必要がある。
  - **重複キー確認**(Issue #123のbootnode事故対策): 追加前後で
    `glossary/ethereum/terms/*.yaml` 全3ファイルを横断してキー名の重複が
    無いことをテキスト走査で確認した。既存の回帰テスト
    (`packages/frontend/src/glossary/parse.test.ts` の
    「real glossary data files」ブロック、Issue #123由来)もパスしている。
  - `packages/frontend/src/glossary/data.ts` は c-transaction.yaml を
    既にインポート済みのため変更不要。`parse.ts` のロジック変更も不要
    (新規ファイルを追加していないため)。
  - 動作確認: `pnpm --filter @chainviz/frontend dev` で vite dev server を
    起動し、200応答と `src/glossary/data.ts` の変換が例外なく行われることを
    確認した(このセッションではブラウザでのホバー表示までは未確認。
    既存の `GlossaryTerm.test.tsx` / `parse.test.ts` で表示ロジック自体は
    カバーされている)。
  - `pnpm --filter @chainviz/frontend build` / `pnpm --filter @chainviz/frontend
    test`(48ファイル791テスト)いずれも成功。
  - 英語訳の自然さは chainviz-i18n のレビュー待ち。

### 2026-07-07 Issue #169 追加6用語の英語訳レビュー (i18n)

- 担当: i18n
- ブランチ: issue-169-glossary-contract-terms
- 内容: `glossary/ethereum/terms/c-transaction.yaml` に追加された6用語
  (`contract`・`deploy`・`abi`・`event-log`・`evm`・`token`)の `en` フィールドを
  レビューし、以下3点を直接修正した。日本語側の定義内容(何を書くか)には
  手を入れていない。
  - `contract`: "executed identically by every node on the EVM" は
    「EVM上の各ノード」のようにも読める曖昧な語順だったため、
    "executed identically by the EVM on every node" に修正。
  - `deploy`: "sending a tx there afterward" の "there" が何を指すか
    文だけでは分かりにくかったため "sending a tx to that address afterward"
    に修正。
  - `evm`: "every node runs to the same specification" は文法的にこなれて
    おらず読みにくかったため "every node runs, built to the same
    specification," に修正。
  - `event-log`: "writes onto the chain" は英語として不自然
    (通常は "writes to the chain") なため修正。
  - `token`: "Unlike ETH, the protocol's own currency," は日本語の
    「プロトコル本体の通貨」の直訳寄りで硬かったため、より自然な
    "Unlike ETH, the network's native currency," に修正。
  - 上記に伴い折り返し位置がずれた行(`deploy`・`token`)は他エントリと
    同程度の幅(概ね78〜80桁)に合わせて再整形した。
  - 技術的な正確性(mempool/gas/nonce/ABI/EVM等の標準的な訳語の使用、
    ERC20・EOA・smart account等との整合)は問題なし。他の4用語
    (`abi`・`event-log`本文自体の内容・`deploy`本文の残り部分)は
    自然さ・正確さともに修正不要と判断した。
- 決定事項・注意点:
  - 直訳ではなく自然な英語表現を優先したが、意味・技術的内容は変更して
    いない(chainviz-frontend が書いた「なぜ必要か」「chainvizでどう
    見えるか」の3拍子構成はそのまま維持)。
  - UIアンカー実装(#165〜#168)側で `en` フィールドを参照する際、上記の
    表現変更を前提にしてよい(再レビューは不要)。

### 2026-07-07 Issue #169 レビュー (reviewer)

- 担当: reviewer
- 対象: ブランチ issue-169-glossary-contract-terms（レビュー時点では未コミットの
  ワーキングツリー。差分は c-transaction.yaml への6用語追加＋docs 3ファイル）
- 判定: **合格**
- 確認した内容:
  - 形式の一貫性: 既存エントリと同じスキーマ（`name`/`definition` の
    `{ja, en}`、`layer: c-transaction`、`relatedTerms`）・同じ `>-` ブロック
    記法・同程度の折り返し幅で書かれている。
  - キー重複（Issue #123 の bootnode 事故対策）: `glossary/` 配下の全3ファイル
    （計25用語）を YAML パーサで機械走査し、重複キーが無いことを確認した。
    あわせて全 `relatedTerms` が実在キーを指すこと（ダングリング参照なし・
    自己参照なし）、`layer` 値がファイル名と一致することも確認した。
    既存の回帰テスト（`parse.test.ts` の「real glossary data files」ブロック）は
    実ファイルを読むため、今回の追加分も自動的に検査対象に入っている。
  - 定義内容: 6用語すべて `docs/ARCHITECTURE.md` §6.9 の3拍子
    「定義 → なぜ必要か → chainviz ではどう見えるか」に沿っており、
    §6.9 の表「定義に必ず含めるポイント」（contract の全ノード実行と
    仲介者なしの約束事、abi の「カタログに無いと未知になる」理由、
    evm の状態一致の根拠、token の ERC20 共通口など）を全件カバーしている。
  - i18n 修正5箇所: 意味・技術的内容を変えない自然さの改善であることを確認。
  - `pnpm lint` / `pnpm build` / `pnpm test`（frontend 48ファイル791テスト含む
    全パッケージ）すべて成功。
- 申し送り・注意点:
  - **UIアンカー未実装は妥当なスコープ分割と判断**。`docs/PLAN.md` ステップ8は
    #165〜#168（UI実装）と #169（用語データ）を別Issueに分けており、§6.9 の
    アンカー表も各アンカーを #165〜#168 の成果物に割り当てている。データが
    同一ステップ内で先行するのは「先の Phase のための先回り実装」には
    当たらない。ただし Issue #124 の教訓どおり、ステップ8完了までに
    #165〜#168 側で6用語すべてが `<GlossaryTerm>` から実際に参照されることを
    確認する必要がある（ステップの完了条件で担保する）。
  - §6.9 の deploy 行にある「関連サービス TIPS に Foundry / Hardhat」は
    `glossary/services.yaml`（未作成の将来データ）側の話であり、本Issueの
    範囲外。定義本文に Foundry / Hardhat への言及があるため学習上の意図は
    満たされているが、services.yaml 導入時に deploy の TIPS へ両ツールを
    載せることを忘れないこと。
  - レビュー時点で未コミットのため、コミット粒度は未確認。コミット時は
    「用語データ追加（frontend）」「英語訳修正（i18n）」「docs 記録
    （PLAN/WORKLOG/worklog）」の関心事を1コミットに混ぜないよう分けることを
    推奨する（規約「1つの変更内容 = 1コミット」）。

### 2026-07-07 Issue #169 QA検証 (qa)

- 担当: qa
- 対象: ブランチ issue-169-glossary-contract-terms（未コミットのワーキングツリー）
- 判定: **合格**
- 前提: 追加6用語（contract/deploy/abi/event-log/evm/token）はまだUIカードから
  参照されていない（参照は #165〜#168 で実装予定）。今回のQAは「用語データが
  正しくパースされ、glossary機能自体が壊れていないこと」の確認に限定した。
  UIポップオーバー表示の確認は #165〜#168 完了後に別途必要。
- 実施した検証と結果:
  - 品質ゲート: `pnpm lint` / `pnpm build` / `pnpm test` を独立して実行し、
    すべて成功。frontend は48ファイル791テスト、collector は27ファイル719
    テストがパス。glossary の回帰テスト（`parse.test.ts` の「real glossary
    data files」ブロック、Issue #123由来）も含めてパスしている。
  - 6用語のパース確認: `js-yaml` で c-transaction.yaml を直接パースし、
    キーが13件（既存7＋新規6）で、追加6用語すべてが name.ja/name.en/
    definition.ja/definition.en/layer/relatedTerms を正しく持つことを確認した。
    3ファイル横断でダングリング relatedTerms（存在しないキーへの参照）が
    無いことも確認した。
  - モジュール初期化パスの非クラッシュ確認: `packages/frontend/src/glossary/
    data.ts` はモジュール読み込み時に3ファイルをパース＋マージする
    （ここで例外が出るとアプリ起動時にクラッシュする）。この経路を同じ
    手順で再現し、例外なく完了して合計25キーになることを確認した。
  - 実起動確認: `pnpm --filter @chainviz/frontend build:web`（vite本番ビルド）
    が252モジュールを変換して成功。`pnpm preview` で起動したプレビュー
    サーバーがルートに HTTP 200 を返し、生成された JS バンドルに追加6用語の
    本文テキスト（「スマートコントラクト」「イベントログ」「Application
    Binary Interface」「Ethereum Virtual Machine」「デプロイ」「トークン」）が
    埋め込まれていることを確認した。
  - 既存用語の非破壊確認: 既存の mempool/transaction/nonce 等を含む全用語が
    引き続きパースされ（マージ後25キー）、既存の GlossaryTerm/parse 系
    テストが全パスすることで、今回の追加が既存機能を壊していないことを確認した。
- 環境の制約: このQA環境にはヘッドレスブラウザ（Playwright/Puppeteer）が
  無いため、ブラウザ上での実際の用語ポップオーバー表示（ホバー動作）までは
  未確認。ただし前提のとおり6用語はまだUIから参照されておらず、今回の
  スコープ（データのパース・glossary機能の非破壊）は上記で充足している。
  ポップオーバー表示の確認は #165〜#168 実装時に持ち越す。
