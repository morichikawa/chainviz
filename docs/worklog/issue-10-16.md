# Issue #10-16 作業記録

### 2026-07-04 Issue #10〜#16 Phase 1 フロントエンド（A層インフラ可視化）
- 担当: frontend
- ブランチ: issue-10-frontend-a-layer
- 内容: `packages/frontend/` に A層（コンテナのカード表示）の UI 一式を実装した。
  collector 経由の WebSocket（スナップショット + 差分）だけを見る設計を守り、
  Docker やノードには一切直接触れない。
  - ビルド基盤: フロントを React アプリ化した。React 19 + React Flow
    (`@xyflow/react`) + Vite を導入。`build` は従来どおり `tsc -b`（型チェック +
    宣言出力）、`build:web` に `vite build`（出力は `dist-web/`）を分けた。
    テストは vitest（jsdom 環境）。
  - `canvas/Canvas.tsx` … React Flow による無限キャンバス（ズーム/パン/ドラッグ、
    Background/Controls/MiniMap）。ドラッグ完了で位置を永続化する。[#10]
  - `entities/` … `infraNode.ts`（ワールドステート → React Flow ノードへの純変換。
    node/workbench のみ対象、containerName をキーに保存位置を引く、未保存は
    既定グリッド）、`InfraNodeCard.tsx`（カード本体）、`InfraPopover.tsx`
    （ホバー詳細: IP・ポート・プロセス・CPU/メモリ・クライアント種別・同期状態・
    ブロック高）。[#11][#12]
  - `glossary/` … インライン用語解説。`GlossaryTerm.tsx` は点線下線 + ホバー/
    フォーカスで定義ポップオーバー（未登録用語は下線なしのプレーン表示）。
    `parse.ts` は用語 YAML を `{ja,en}` 検証つきで Glossary に変換。[#13]
  - `glossary/ethereum/terms/a-infra.yaml` … A層の用語データ（container /
    port-mapping / el-client / cl-client / workbench）。ARCHITECTURE.md §5 の
    スキーマ（`{ja,en}` 形式・layer・relatedTerms）。[#14]
  - `layout/layoutStore.ts` … レイアウトの localStorage 永続化。キーは安定識別子
    （containerName）を使い、Docker コンテナ ID には依存しない。壊れた JSON・
    不正な座標は捨てて空マップにフォールバック。[#15]
  - `i18n/` … ja/en 切り替え。デフォルト日本語、`LanguageToggle` で画面隅から
    いつでも切り替え、選択言語は localStorage に永続化。UI 文言・用語とも
    `{ja,en}` 形式。[#16]
  - `websocket/` … `packages/shared` の protocol 型に従うクライアント。
    `client.ts`（snapshot/diff/commandResult を振り分け、操作コマンド送信）、
    `messages.ts`（受信テキストの検証パース・コマンド直列化）、`mockData.ts`
    （collector 未起動でも動くモッククライアント）。`VITE_COLLECTOR_URL` 未設定
    時はモックで起動する。
- 決定事項・注意点:
  - **用語データの取り込み方**: 用語の正となる置き場所は repo ルートの
    `glossary/`（パッケージ外）。Vite の alias `@glossary` + `?raw` インポートで
    ビルド時に YAML テキストを取り込み、`parseGlossaryYaml` でパースする
    （`glossary/data.ts`）。tsc は `*.yaml?raw` の ambient 宣言
    （`src/vite-env.d.ts`）で解決を短絡させる。テストは `parse.ts` を直接叩き、
    実ファイルを fs で読んで検証する（App/データ層に依存しない）。
  - **エンティティの安定 ID**: `DiffEvent` の entityUpdated/entityRemoved は
    `id: string` を前提にするが、共有スキーマ上 node/workbench 以外
    （wallet/block/tx/…）は共通の `id` フィールドを持たない。フロント側の
    `entityId()` で種別ごとに `id` / `address` / `hash` へ解決して吸収した
    （共有型は変更していない）。将来 C層以降でこの前提を詰める際、shared 側で
    エンティティ ID の統一表現を検討する余地がある（reviewer と要調整）。
  - **jsdom の制約**: この vitest/jsdom 構成では `localStorage` グローバルと
    file スキームの `import.meta.url` が使えない。前者は永続化 API を
    注入可能インターフェース（`KeyValueStorage`）にし、実行時は
    `platform/storage.ts` の `getBrowserStorage()` が localStorage 不在時に
    メモリ実装へフォールバックする形で回避。後者はテストで cwd から
    リポジトリルートの glossary を上方向探索して解決している。
  - 状態管理・データ変換・WebSocket クライアントなどロジック部分には vitest の
    ユニットテストを付けた（異常系・境界値含む）。純粋な見た目部分を除き、
    frontend 全体で 70 テスト。`pnpm --filter @chainviz/frontend build` /
    `test`、`vite build`、`eslint packages/frontend/src` が通ることを確認済み。
  - スコープは A層（コンテナのカード表示・ホバー詳細）まで。B層以降（ピア接続
    エッジ、ブロック伝播アニメーション等）は範囲外で未実装。

### 2026-07-04 Issue #10〜#16 frontend A層のテスト強化
- 担当: tester
- ブランチ: issue-10-frontend-a-layer
- 内容: frontend（描画担当）が実装と同時に書いた基本テスト（70件）に対し、
  異常系・境界値・想定外シーケンスの観点でテストを追加した（合計118件）。
  実装コードは変更していない。追加した観点は以下。
  - websocket/client: error イベントでの disconnected 遷移、disconnect 後の
    再 connect で新しい socket を開くこと、サーバー主導の close 後の再接続、
    未接続での sendCommand が例外を投げず id を返すこと、未接続での
    disconnect が no-op であること、ok:true の commandResult の error が
    undefined になること、diff payload が配列でない場合の無視。
  - world-state/store: 同一バッチ内で entityRemoved 後に entityUpdated が
    来ても復活しないこと（ARCHITECTURE.md §2）、add→update / add→remove の
    同一バッチ適用、連続 patch のマージと非対象フィールドの保持、
    ワークベンチ削除時のウォレット存続と ownerWorkbenchId の null 化、
    同一 id の entityAdded による上書き、空 store への remove、
    複数エッジからの対象 1 件のみ削除、逆方向エッジを別物として扱うこと。
  - layout/layoutStore: 0・負の座標の保持（境界値）、Infinity 座標の除外、
    値が null/配列のエントリの除外、保存 position からの余分プロパティ除去、
    壊れた既存ストレージからの復旧書き込み。
  - glossary/parse: 言語値が非文字列/name が文字列のエントリのスキップ、
    値が null のエントリのスキップ、前後空白のトリム、relatedTerms からの
    非文字列除去、layer が誤った型のときの空文字デフォルト、
    mergeGlossaries の同一キー上書きと引数なし。
  - i18n: 未知メッセージキーでキー文字列を返すこと、デフォルト言語が無くても
    要求言語を返すこと、両方無いときの空文字。
  - websocket/messages: 数値 JSON・snapshot payload が null/欠落・type 無しで
    null を返すこと、空配列 diff の受理、全コマンド種別の round-trip。
  - entities/infraNode: 空入力、グリッドの行折り返し、保存位置とグリッドの
    混在（ソート後 index 基準）、カスタムグリッド設定、id の辞書順ソート。
  - websocket/mockData: 接続中の二重 connect で snapshot を再送しないこと、
    disconnect/connect サイクルでの snapshot 再送、未接続 disconnect で
    状態変化を通知しないこと、負の intervalMs でタイマーを起動しないこと、
    二重 disconnect の安全性。
- 決定事項・注意点（実装担当への差し戻し候補となる指摘 2 件）:
  - **i18n `pickLocale` の空文字フォールバック不整合**: docstring は「対象言語の
    値が空/未定義ならデフォルト言語へフォールバックする」とあるが、実装は
    `localized[lang] ?? localized[DEFAULT_LANGUAGE] ?? ""` で `??` を使うため、
    値が空文字 `""` のときフォールバックせず `""` を返す。例:
    `pickLocale({ ja: "こんにちは", en: "" }, "en")` は "こんにちは" が期待だが
    実際は "" を返す。glossary/parse は値をトリムのみで空を弾かないため、
    空文字の翻訳が入りうる現実的な経路がある。実装 or docstring のどちらを
    正とするか frontend 担当の判断が必要なため、この挙動を固定するテストは
    追加していない。
  - **layout `saveLayout` / `saveNodePosition` の書き込み時例外**: `loadLayout`
    は壊れた JSON 等でも例外を投げない防御的設計だが、書き込み側は
    `storage.setItem` の例外（localStorage の容量超過 QuotaExceededError 等）を
    捕捉していない。ドラッグ完了時の保存で容量超過が起きるとハンドラごと
    例外が伝播する。読み取り側と同様に握りつぶす（または呼び出し側で捕捉する）
    のが望ましいと考えられるが、望ましい挙動の確定が必要なため、こちらも
    挙動を固定するテストは追加していない。
- 検証: `pnpm --filter @chainviz/frontend build`・`test`（118 件 pass）・
  追加テストファイルの eslint がいずれも通ることを確認済み。

### 2026-07-04 Issue #10〜#16 frontend A層 tester 指摘バグ 2 件の修正
- 担当: frontend
- ブランチ: issue-10-frontend-a-layer
- 内容: chainviz-tester がレビュー前に報告した 2 件の挙動不整合を修正した。
  いずれも前回の WORKLOG に「挙動の確定が必要」として記録されていたもの。
  - i18n `pickLocale` の空文字フォールバック: docstring（対象言語の値が
    空/未定義ならデフォルト言語へフォールバック）に実装を合わせた。従来の
    `localized[lang] ?? localized[DEFAULT_LANGUAGE] ?? ""` は `??` のため空文字
    `""` でフォールバックしなかった。空文字も「値なし」として扱うよう
    `value !== undefined && value !== ""` の判定に変更した。glossary/parse が値を
    トリムのみで空を弾かないため、空文字翻訳が入りうる現実的な経路がある。
    `packages/frontend/src/i18n/i18n.ts`。
  - layout `saveLayout` / `saveNodePosition` の書き込み時例外: `loadLayout`
    が壊れた JSON でも例外を投げない防御的設計であるのと対称に、書き込み側も
    `storage.setItem` の例外（localStorage 容量超過 QuotaExceededError 等）を
    try/catch で握りつぶし `console.warn` でログに残すだけにした。ドラッグ完了時
    の保存で容量超過が起きても呼び出し元へ例外が伝播しない。`saveNodePosition`
    は `saveLayout` 経由なので同時に保護される。
    `packages/frontend/src/layout/layoutStore.ts`。
  - 各挙動を固定するテストを追加した。i18n は要求言語が空文字のときデフォルトへ
    フォールバックすること・両方空のときは空文字を返すこと、layout は
    `saveLayout` / `saveNodePosition` が setItem の例外を投げず握りつぶすこと
    （`saveNodePosition` は例外時も更新後マップを返す）を確認する。
- 決定事項・注意点:
  - `pnpm --filter @chainviz/frontend build`・`test`（122 件 pass）が通ることを
    確認済み。

### 2026-07-04 Issue #10〜#16 frontend A層のレビュー
- 担当: reviewer
- ブランチ: issue-10-frontend-a-layer
- 内容: frontend A層実装（React Flow キャンバス、カード表示、ホバーポップ
  オーバー、用語解説インライン表示、A層用語データ、レイアウト永続化、
  UI 言語切替）と tester によるテスト強化を静的にレビューした。
  結果は**合格（差し戻しなし）**。軽微な指摘 3 件は下記のとおり
  （マージ前の対応推奨 2 件、申し送り 1 件）。
- 確認した内容:
  - 境界の遵守: frontend は Docker・ノード API に一切触れていない。通信は
    `packages/shared` の protocol 型（snapshot/diff/commandResult/command）に
    従う WebSocket クライアントのみ。`eth_getLogs` のようなチェーン固有の
    RPC 語彙の漏れなし。
  - 命名・用語: 可視化階層は「A層 / Layer A」で統一。UI 文言・用語データとも
    `{ja, en}` 形式。デフォルト日本語・画面隅トグルは CONCEPT.md の記述どおり。
  - レイアウト永続化: キーは `containerName`（安定識別子）。Docker コンテナ ID
    には依存していない（PLAN #15 の条件を満たす）。壊れた JSON・不正座標・
    書き込み例外への防御も確認。
  - glossary: データは repo ルート `glossary/`（コード分離の原則どおり）、
    スキーマは ARCHITECTURE.md §5 に一致。パーサは壊れたエントリを
    読み飛ばす防御的実装。
  - ビルド・lint・テスト: リポジトリ全体で `pnpm lint` / `pnpm build` /
    `pnpm test` すべて通過（frontend 122 件）。eslint が `.tsx` 11 ファイルを
    実際に対象としていることも確認した。
  - テストの質: store の差分適用（同一バッチ内の remove→update 非復活、
    イミュータビリティ、逆方向エッジの区別）、client の異常系（不正 JSON、
    サーバー主導 close 後の再接続、未接続での操作）、layoutStore の境界値
    （0・負・Infinity 座標、setItem 例外）、GlossaryTerm の未登録用語・言語
    切替など、実装の詳細をなぞるだけでない挙動ベースのテストになっている。
- 判断: `DiffEvent`（entityUpdated/entityRemoved の `id: string`）と
  wallet/block/tx が `id` フィールドを持たない件について、**現時点で
  `packages/shared` の型変更は不要**とする。理由: (1) Phase 1 の差分対象は
  node/workbench のみで、両者は `id` を持つため実害がない。(2) 全エンティティ
  への `id` 追加は ARCHITECTURE.md §2 の自然キー設計を崩し、collector 側の
  変更も要する先回り実装になる。ただし frontend の `entityId()`（wallet/
  contract→address、block/tx/userOp→hash）は collector と共有すべき
  プロトコル規約なので、**Phase 3（C層）着手時に entityId 相当のヘルパを
  `packages/shared` へ移し、ARCHITECTURE.md §2 に id 規約を明記すること**を
  条件として申し送る。
- 指摘（軽微・差し戻し対象外）:
  1. **ARCHITECTURE.md §1 と実装の構成差分（マージ前の更新推奨）**:
     frontend 実装には `app/`（App シェル・クライアント解決）、`platform/`
     （storage 抽象）、`world-state/`（snapshot/diff の畳み込み）が増えたが、
     §1 のフォルダ構成に記載がない（§1 の `websocket/` の説明にある
     「スナップショット/差分の反映」は実際には `world-state/` が担う）。
     sync-docs の観点で §1 を実装に合わせて更新すること。
  2. **WORKLOG.md のフォーマット逸脱（マージ前の修正推奨）**: 本ファイルの
     「## 2026-07-04 描画麗 (frontend): tester 指摘バグ 2 件の修正」の
     エントリが、規定の `### YYYY-MM-DD Issue #<番号> <タイトル>` +
     `担当:`/`ブランチ:` 箇条書きの形式でなく、見出しレベルも `##` で
     「## 記録」セクションと同格になっている。ペルソナ名は見出しに使わない。
  3. **`clientGlossaryKey` の置き場所（申し送り）**: `entities/InfraPopover.tsx`
     の `clientGlossaryKey()` が reth/geth/lighthouse/prysm という Ethereum
     固有のクライアント名を汎用コンポーネント側にハードコードしている。
     未知値は "container" にフォールバックするため現時点の動作に問題は
     ないが、第2チェーン追加時にこの関数へ分岐を足す形になると
     「既存プロファイルのコードに手を入れない」原則に反する。
     `packages/frontend/src/chain-profiles/ethereum/` を作る際（遅くとも
     Phase 6 の Bitcoin 対応時）にこのマッピングをそちらへ移すこと。

### 2026-07-04 Issue #10〜#16 frontend A層の実機検証
- 担当: qa
- ブランチ: issue-10-frontend-a-layer
- 内容: frontend A層実装（React Flow キャンバス、カード表示、ホバー
  ポップオーバー、用語解説インライン表示、A層用語データ、レイアウト
  localStorage 永続化、UI 言語切替）を実際にブラウザで動かして検証した。
  結果は**合格**。docs/PLAN.md ステップ3 frontend 側（#10〜#16）の完了条件と
  CONCEPT.md「体験イメージ」「用語解説」の記述どおりに動作することを確認した。
- 検証方法:
  - `pnpm --filter @chainviz/frontend build`（tsc -b）成功。
    `build:web`（vite build）も成功し dist-web を生成（js 434KB / css 18.8KB）。
    ユニットテスト 122 件すべて pass。
  - `vite` 開発サーバー（モッククライアント。`websocket/mockData.ts` の
    snapshot を使用）を起動し、Playwright（chromium headless）で実際に
    操作して確認。確認項目は 16 項目すべて pass。
- 確認した挙動:
  - 無限キャンバス（React Flow）上に reth×2・lighthouse×1・workbench の
    4 カードが表示される。
  - カードにホバーすると IP（172.20.0.x）・ポート・プロセス（reth node /
    lighthouse bn / foundry）・CPU%・メモリ MB・クライアント種別・同期状態・
    ブロック高のポップオーバーが出る。
  - ポップオーバー内の「ポート」「クライアント」やカードの種別ラベル
    （ノード/ワークベンチ）など用語解説対象の語にホバーすると、glossary の
    定義（例: コンテナの定義文）と関連用語がポップオーバー表示される。
  - UI 言語切替ボタンで ja→en に切り替わり、タイトル・カードラベル・接続
    ステータスなど画面全体の表示言語が変わる。切替結果は localStorage
    （`chainviz.lang`）に保存される。
  - カードをドラッグすると位置が localStorage（`chainviz.layout.v1`）に
    保存され、キーは安定識別子 containerName（コンテナ ID ではない）。
    リロード後も保存値が残り、カードが同じ位置（transform 一致）に復元される。
  - 実行中にコンソールエラーなし。
- 注意点:
  - 検証環境には日本語フォントが無く、スクリーンショット上では日本語が
    豆腐（□）で表示されるが、テキスト内容自体は DOM 上正しく（innerText で
    確認済み）、アプリ側の不具合ではない。
  - Playwright 実行のため chromium と不足システムライブラリ
    （libnspr4 等）をスクラッチパッドにローカル展開して使用した。リポジトリ
    には何も追加していない。
  - モックデータの edges は空のためピア接続エッジは描画されないが、これは
    Phase 2（B層）の対象であり A層の完了条件には含まれない。

### 2026-07-04 Issue #10 storage.test.ts のフォールバック検証を環境非依存に修正
- 担当: tester
- ブランチ: issue-10-frontend-a-layer
- 内容: `packages/frontend/src/platform/storage.test.ts` が特定環境で 1 件
  失敗していた問題を修正した。
  - 旧テストは「jsdom 環境では localStorage が未定義なのでメモリフォールバックが
    使われ、インスタンス間で共有されない」という前提だった。しかし
    `vite.config.ts` が jsdom に url を与えている（localStorage を使えるように
    する意図的な設定）ため、Node の experimental localStorage が有効な環境や
    テスト全体を通しての初期化順によっては実際の localStorage が返り、状態が
    共有されて 2 つ目のテスト（`expected '1' to be null`）が落ちていた。
  - テストを書き換え、各ケースの `beforeEach` で `globalThis.localStorage` を
    `Object.defineProperty` で明示的に差し替える方式にした。`afterEach` で元の
    ディスクリプタを復元する。これにより実行環境の localStorage 有無に依存せず、
    「使える localStorage があるときはそれを共有して使う」「無いときはメモリ
    フォールバックが返りインスタンス間で共有しない」の両分岐を決定的に検証する。
  - 追加観点として「localStorage へのアクセスが例外を投げる場合（プライベート
    モード相当）もフォールバックへ切り替わる」ケースを追加（`isUsable()` の
    try/catch 経路の検証）。テスト数は 2 → 5 に増加。
- 決定事項・注意点:
  - 実装（`storage.ts`）は変更していない。テストの前提が実装の設計意図
    （`isUsable()` が実際に使える storage を検出したら使う）とずれていたのが
    原因で、テスト側を実装に合わせた。
  - 検証は `pnpm --filter @chainviz/frontend build` と `test` が通ることに加え、
    global localStorage を注入する setupFiles（旧テストが必ず落ちる条件）付きの
    一時 vitest 設定でも 5 件全通過することを確認した。

