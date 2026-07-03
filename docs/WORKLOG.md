# chainviz 作業記録

各タスクの完了時に、担当したエージェントが追記する記録。
`docs/PLAN.md` のチェックボックスは「どこまで進んだか」を示すだけなので、
「何を・なぜ・どう実施したか」「実装中に判明した注意点」はこちらに残す。
commit ログとあわせて読むことで、後から経緯を追えるようにする。

この記録は平易で正確な日本語で書く(担当エージェントのペルソナの口調は
使わない)。

## 記入フォーマット

```
### YYYY-MM-DD Issue #<番号> <タイトル>
- 担当: <collector | frontend | node-env | reviewer | qa>
- ブランチ: issue-<番号>-<スラッグ>
- 内容: 何を実装・変更したか
- 決定事項・注意点: 実装中に判明した仕様の詳細、次の担当が知っておくべきこと
```

## 記録

### 2026-07-04 Issue #1・#2・#3 Ethereum プロファイルのノード環境
- 担当: node-env
- ブランチ: issue-1-genesis-pos-net
- 内容: `profiles/ethereum/` にノード環境テンプレート一式を作成した。
  - `values.env` … genesis 生成設定（実質的な genesis 設定ファイル）。
    CHAIN_ID=1337、バリデーター 64、slot time 2 秒、Electra まで有効・Fulu 以降
    無効、EL プリマイン 8 アカウント。
  - `docker-compose.yml` … reth(EL)+ lighthouse(CL beacon + validator)を
    2 ノード、Foundry ワークベンチ 1 つ、genesis 生成サービス。
  - `scripts/` … 各コンテナの起動スクリプト（genesis 生成、reth、beacon、
    validator）。
- 決定事項・注意点:
  - **genesis は静的コミットせず起動時に生成する**。genesis.json / genesis.ssz は
    生成時刻を埋め込むため、古い時刻でコミットすると lighthouse が過去/未来
    スロットの計算で破綻する。`genesis` サービスが `docker compose up` のたびに
    現在時刻で生成し直し、共有ボリューム `genesis` に置く。全ノードがこれを
    マウントして共有する（CONCEPT「genesis を静的ファイルとしてマウント共有」に
    対応。共有ボリュームの中身がその実体）。
  - genesis 生成は `ethpandaops/ethereum-genesis-generator` を採用（EL/CL 両方の
    genesis と各種予備コントラクトを一括生成でき、Kurtosis と同じ実績のある
    経路）。バリデーター鍵は同イメージ同梱の `eth2-val-tools` で mnemonic から
    導出し、ノード数ぶんに分割する。
  - **ノードのデータディレクトリも起動時に毎回初期化する**。genesis が毎回
    変わるため、古い chain データが残ると genesis 不一致で起動できない。
    各起動スクリプトが `rm -rf` してから init/start する。したがって `up` の
    たびにまっさらな chain で始まる（devnet として想定どおり）。
  - **CL の P2P bootstrap**: reth/lighthouse のイメージには curl 等の HTTP
    クライアントが無いため、runtime の API 取得は使えない。代わりに beacon1 が
    lighthouse の書き出す enr.dat を共有ボリューム `clpeer` へコピーし、beacon2 が
    それを `--boot-nodes` に渡す方式にした。ENR に載せる IP は docker の固定 IP
    （`--enr-address`）。これで 2 ノードが単一 chain として合意する。
  - **EL(reth)同士の P2P は未接続**。ブロックは CL が Engine API で各 EL に渡す
    ため両 EL の canonical chain は一致する（起動テストで両 reth の head hash 一致を
    確認済み）。mempool の相互伝播が要る Phase 3 で追加する。ロギングプロキシも
    Phase 3。
  - シェルの落とし穴: `--http-allow-origin *` を変数経由で unquoted 展開すると
    `*` がコンテナのルート直下に glob 展開されて不正な引数（boot 等）が混入する。
    beacon 起動スクリプトで `set -f`（glob 無効）を入れて回避した。
  - 起動確認（node-env 自己確認。最終合否は qa 担当）: `docker compose up` で
    ブロックが約 2 秒ごとに進行、finality も epoch 3 まで到達、両 reth の head 一致、
    ワークベンチから `cast chain-id / block-number / balance / send`（プリマイン
    アカウントから送金し status 0x1・残高反映）まで確認した。
  - ワークベンチの送金鍵はチェーンと同じ mnemonic。導出パスが Foundry 既定と
    同じなのでプリマインアカウントをそのまま使える。

### 2026-07-04 Issue #1・#2・#3 レビュー（Ethereum プロファイルのノード環境）
- 担当: reviewer
- ブランチ: issue-1-genesis-pos-net
- 内容: `profiles/ethereum/` 一式と `docs/PLAN.md`・`docs/WORKLOG.md` の変更を
  静的レビューした。境界の遵守（packages/* 無変更、フロント・collector への
  チェーン固有ロジックの漏れなし）、チェーンプロファイルの独立性（新規
  ディレクトリ追加のみ）、ARCHITECTURE.md §4 のテンプレート配置、CONCEPT.md の
  決定事項（slot time 2 秒、reth + lighthouse の PoS、Foundry ワークベンチ×1、
  ロギングプロキシの Phase 3 送り）との整合を確認。結果は条件付き合格
  （実装の差し戻しなし。下記 2 点の対応を推奨）。
- 決定事項・注意点:
  - **CONCEPT.md との齟齬（要 docs 更新）**: CONCEPT.md「新規ノード追加時の
    P2P 参加方法」は「genesis は静的ファイルとしてマウント共有」としているが、
    実装は「起動時に生成して共有ボリュームで共有」。生成時刻を埋め込む genesis の
    性質上、実装側が正しい。sync-docs の観点で CONCEPT.md の該当決定事項の
    文言を実態（起動時生成 + 共有ボリューム）に合わせて更新すべき。
  - **mnemonic の二重管理（修正推奨）**: docker-compose.yml の `ETH_MNEMONIC` に
    ハードコードした mnemonic は、generator イメージ（`:master` タグ）内
    `/defaults/defaults.env` の `EL_AND_CL_MNEMONIC` 既定値との一致に依存している。
    イメージ更新で既定値が変わると、プリマインとワークベンチ鍵が静かに食い違う。
    `values.env` で `EL_AND_CL_MNEMONIC` を明示的に export し出所を一本化すべき。
  - イメージタグがすべて `latest` / `master`。特に genesis-generator は
    `/work/entrypoint.sh` 等のイメージ内部パスにも依存しており、タグ変動の
    影響を最も受けやすい。再現性のためピン留めを検討（必須とはしない）。
  - #1〜#3 を 1 ブランチ・1 PR にまとめる運用は CLAUDE.md「Issue ごとに
    ブランチを切る」からの逸脱だが、不可分な作業である旨が PLAN.md に
    明記されており妥当と判断。
  - 動作面（ブロック進行・finality・cast 疎通）の最終合否は qa 担当に委ねる。

### 2026-07-04 Issue #4・#5 検証（Ethereum プロファイルのノード環境）
- 担当: qa
- ブランチ: issue-1-genesis-pos-net
- 内容: `profiles/ethereum/` を実際に `docker compose up` して、ステップ2の
  完了条件（Issue #4・#5）を実機で検証した。結果は両 Issue とも合格。
  検証後 `docker compose down -v` で環境（コンテナ・ボリューム・ネットワーク）を
  完全に後片付け済み。
- 検証環境: Docker 29.1.3 / Docker Compose 2.40.3（Linux WSL2）。イメージは
  すべて `latest` / `master` タグを当日 pull した状態。
- Issue #4（起動・ブロック進行）: 合格。
  - `genesis` サービスが起動時に genesis を生成し exit 0 で正常終了。ログで
    バリデーター鍵 64 個を 2 ノードに 32 個ずつ分割生成しているのを確認。
    データボリュームは毎回まっさらから生成される仕様どおりに動作。
  - ブロックが約 2 秒ごとに継続進行することを確認（block-number を複数回
    サンプリングし単調増加: 8→10→13→15→17、その後も 40→74→109→153 と継続）。
  - 両 EL（reth1/reth2）が同一 head hash・同一 block-number で一致。CL の P2P が
    接続され（beacon peer_count=1 = 相互接続）単一チェーンとして合意している。
  - finality: 起動直後は epoch 1 が justify されず finalized_epoch=0 のままだったが、
    これは起動時の peer 接続待ちによる初回のみの遅延。epoch が進むと
    current_justified が epoch 2→3 と連続 justify され、finalized も epoch 2 まで
    前進することを beacon API（`/eth/v1/beacon/states/head/finality_checkpoints`）で
    確認。finality は正常に機能している。完了条件（ブロック進行）には影響なし。
- Issue #5（ワークベンチからの cast RPC 疎通）: 合格。
  - workbench コンテナ内で compose 設定の `ETH_RPC_URL=http://reth1:8545` に対し
    `cast chain-id`=1337、`cast block-number`（進行中の値）、
    `cast rpc web3_clientVersion`=reth/v2.3.0、`cast gas-price` が正常応答。
  - プリマインアカウント（mnemonic index 0）の残高照会 `cast balance --ether`=
    1000000000 ether を確認。
  - `cast send`（プリマインから fee recipient へ 1 ether 送金）が status=0x1 で
    採掘され、受取アドレス残高が 0 → 1.000000000000021000 ether（送金分＋ブロック
    提案報酬）に反映されることを確認。
- 差し戻し: なし。ステップ2の完了条件を満たしているため Issue #4・#5 はクローズ可。
  reviewer が挙げた docs 更新（CONCEPT.md の genesis 記述）・mnemonic 二重管理・
  タグピン留めは動作に影響しないため本検証の合否とは独立（別途対応判断）。

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

### 2026-07-04 Issue #1 レビュー対応（mnemonic の出所を values.env に一本化）
- 担当: node-env
- ブランチ: issue-1-genesis-pos-net
- 内容: reviewer が挙げた「mnemonic の二重管理」を修正した。
  - `values.env` に `export EL_AND_CL_MNEMONIC="..."` を明示的に追加し、mnemonic の
    出所をこのファイル1箇所に一本化した。値は generator イメージ
    （`ethpandaops/ethereum-genesis-generator:master`）の `/defaults/defaults.env`
    の既定値と同一の文字列を明示指定（既存のプリマインアドレス・バリデーター鍵を
    変えないため）。
  - `docker-compose.yml` のワークベンチから、ハードコードしていた `ETH_MNEMONIC`
    環境変数を削除し、代わりに `env_file: ./values.env` で同じ mnemonic を読み込む
    形に変更した。`ETH_RPC_URL` は従来どおり `environment:` に残す。
  - `README.md` の cast 例を `$ETH_MNEMONIC` → `$EL_AND_CL_MNEMONIC` に更新。
- 決定事項・注意点:
  - **なぜ env_file か**: ワークベンチへの値の渡し方として、entrypoint で
    `. values.env` して再 export する案も検討したが、`docker compose exec` は
    entrypoint プロセスの実行時 export を引き継がない（新プロセスがコンテナの
    設定 env を継承する）ため、対話 shell の `$ENV` 経由でしか値が渡らず
    非対話の `exec sh -c 'cast ...'`（QA や自動化が使う）で空になる。`env_file` は
    コンテナの設定 env に入るため対話・非対話どちらの exec でも確実に参照できる。
    これを実機で確認した上で env_file を採用した。
  - env_file は values.env の全変数（CHAIN_ID や SLOT_DURATION 等の genesis 用
    変数）もワークベンチ env に載せるが、cast / forge はこれらを参照しないため
    無害。ワークベンチが参照するのは `ETH_RPC_URL` と `EL_AND_CL_MNEMONIC` のみ。
  - 生成側（genesis サービス）は従来どおり generate-genesis.sh が
    `. /config/values.env` でシェル source する経路。明示 export により
    イメージ既定値への暗黙依存が解消され、バリデーター鍵導出・EL プリマインとも
    values.env の値を使う。
  - 再確認: 修正後に `docker compose up` → ブロック進行（block-number 9→12）、
    `cast chain-id`=1337、プリマイン index 0 残高=10 億 ETH、
    `cast send --mnemonic "$EL_AND_CL_MNEMONIC"` で送金し受取残高反映まで
    非対話 exec で確認。`docker compose down -v` で後片付け済み。

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

### 2026-07-04 Issue #7・#8・#9 A層（インフラ可視化）の collector 実装
- 担当: collector
- ブランチ: issue-7-collector-a-layer
- 内容: `packages/collector/` に A 層（コンテナ・プロセス・リソース）の
  観察パイプラインを実装した。ARCHITECTURE.md §1 のドメイン単位のフォルダ構成に
  沿って以下を追加。
  - `docker/` … Docker Engine API のポーリング。`types.ts` で dockerode を薄く
    抽象化した `DockerClient` インターフェースと観測値の型を定義。`observe.ts` は
    生レスポンス→観測値の純粋変換（安定 ID 算出・IP/ポート抽出・top のプロセス
    解析・CPU%/メモリ MB 計算）。`poller.ts` の `DockerPoller.pollOnce()` が
    `/containers/json`→各コンテナの `/top`・`/stats` を集約。`dockerode-client.ts`
    が実 dockerode を `DockerClient` へ橋渡し。
  - `adapters/ethereum/` … ChainAdapter 実装。`classify.ts` に reth/lighthouse/
    foundry 等の Ethereum 固有の判定を閉じ込め、`index.ts` の `EthereumAdapter`
    が観測値を `NodeEntity`/`WorkbenchEntity` へ正規化。`subscribePeers`/
    `subscribeChainEvents` は B/C 層で実装するため no-op スタブ。
  - `world-state/` … `diff.ts`（前回比較で `DiffEvent[]` を生成する純粋関数 +
    エンティティ安定キー抽出 `entityId`）と `store.ts`（インメモリ store。
    `applyInfra` は infra 系のみ差分対象にし、他層のエンティティは残す）。
  - `server/` … `CollectorServer`（ws）。接続時に `snapshot` を1回、以後
    `broadcastDiff` で `diff` を配信。プロトコルは shared の `ServerMessage`/
    `ClientMessage` に準拠。
  - `index.ts` … dockerode→poller→adapter→store→server を配線し、3 秒間隔
    （`POLL_INTERVAL_MS`）でポーリング→差分配信するループ。直接実行時のみ起動。
  - vitest を各モジュールに追加（計 63 ケース。ハッピーパス＋異常系・境界値）。
- 決定事項・注意点:
  - **安定識別子（InfraEntity.id）**: docker compose の
    `com.docker.compose.project`/`service` ラベルから `project/service` を生成し、
    無ければコンテナ名、それも無ければコンテナ ID にフォールバック。コンテナ ID は
    再起動で変わるため最終手段（ARCHITECTURE.md §2 の要求）。実 Docker で
    `cvtest/reth1` のようにコンテナ ID 非依存の ID になることを確認済み。
  - **ChainAdapter 境界**: reth/lighthouse/foundry 等のチェーン固有語彙は
    `adapters/ethereum/classify.ts` に限定。`docker/` 配下と world-state の
    スキーマはチェーン非依存に保った。
  - **A 層のプレースホルダ**: `NodeEntity` の `syncStatus`/`blockHeight`/
    `headBlockHash` は A 層では取得しないため `syncing`/`0`/`""` を入れる。
    これらは B/C 層（RPC 購読）で埋める。
  - **top/stats の異常系**: 一覧取得後にコンテナが消える等で個別の top/stats が
    失敗しても、そのコンテナだけ空プロセス・ゼロリソースにフォールバックし
    収集全体は落とさない設計（ユニットテストで担保）。
  - **CPU%**: docker 標準式（cpuDelta/systemDelta × onlineCpus × 100）。差分が
    取れない初回や負値は 0。メモリはページキャッシュ分を差し引いた MB。
  - **操作コマンド（addNode 等）は未実装**。プロトコル準拠のため受信時に
    `commandResult ok:false`（未実装）を返すだけにした。実装はステップ 4 以降。
  - **依存追加とビルド設定**: `dockerode`・`ws`（+ 型）を collector に追加。
    dockerode が引く SSH トランスポート用ネイティブ依存（cpu-features・ssh2・
    protobufjs）はローカルソケット接続では不要なため、`pnpm-workspace.yaml` の
    `allowBuilds` でこれらを `false`（ビルドしない）に設定した。プレースホルダ
    （"set this to true or false"）のままだと `pnpm install` が
    `ERR_PNPM_IGNORED_BUILDS` で失敗し build/test の事前チェックを通せないため。
  - 実機確認: reth/lighthouse/foundry/busybox イメージのコンテナを compose 風
    ラベル付きで起動し、`EthereumAdapter.pollInfra()`→`store.applyInfra()` を実行。
    node/workbench の分類、published+exposed ポート収集、IP 解決、初回 3 件の
    `entityAdded`、安定した 2 回目ポーリングで差分空、を確認。確認後コンテナ・
    ネットワークは削除済み。
  - `pnpm build`・`pnpm test`・`pnpm lint` を全パッケージで通ることを確認。

### 2026-07-04 Issue #7・#8・#9 A層 collector のテスト強化（異常系・境界値）
- 担当: テスト強化（試験学）
- ブランチ: issue-7-collector-a-layer
- 内容: 既存の 63 ケース（ハッピーパス中心）に対し、異常系・境界値・想定外
  シーケンスのテストを追加した（63→118 ケース）。実装コードは変更していない。
  - `docker/observe.test.ts` … 空文字ラベルでの安定 ID フォールバック、
    空/undefined の IP をスキップして次の非空を選ぶ挙動、Ports 欠落、
    PrivatePort 採用、Titles/Processes 欠落時の parseTopProcesses、CMD 列より
    行が短い場合、online_cpus=0、precpu 欠落、丸め、cache 欠落など。
  - `docker/poller.test.ts` … top と stats が同時失敗しても観測を落とさない、
    listContainers 自体の失敗が pollOnce まで伝播する、安定 ID が重複する
    2 コンテナを両方返す（重複排除は上位に委ねる）。
  - `adapters/ethereum/classify.test.ts` … 大文字小文字を無視した判定、
    node/tool 両方の語が出た場合に workbench 判定が優先されること、compose
    サービス名からのクライアント種別判定、判別材料ゼロ時の node フォールバック。
  - `adapters/ethereum/index.test.ts` … top が空でもイメージから clientType を
    保ちつつ代表プロセスは unknown、クライアント種別に一致しない場合の先頭
    プロセス採用、安定 ID が無い場合のコンテナ ID 使用、poller 失敗の伝播。
  - `world-state/diff.test.ts` … add/update が remove より前に来る順序保証、
    両入力空、next/prev の重複 ID 畳み込み（後勝ち・単一イベント化）、多数
    フィールド同時変更、kind 固有フィールド（label）のみの変更。
  - `world-state/store.test.ts` … 消えたエンティティが同じ ID で戻ると
    entityUpdated ではなく entityAdded になること（entityRemoved 後の再出現）、
    1 回の poll に重複 ID があると後勝ちで 1 件に畳まれること、複数 poll に
    またがる更新の蓄積、getSnapshot の返り値配列を外部で変更しても内部が
    汚染されないこと。
  - `server/websocket-server.test.ts` … 複数クライアントへの同報、状態変化後に
    接続したクライアントが最新スナップショットを受け取ること、1 クライアント
    切断後も残りへ配信継続、command 以外の整形式メッセージ・JSON プリミティブ
    （null/数値/文字列）を無視、listen 前の broadcastDiff/close が例外を投げない。
  - `index.test.ts`（新規）… ポーリングループのテスト。初回即時実行と差分配信、
    interval ごとの再スケジュール（fake timers）、stop() 後の停止、poll 失敗時に
    onError 通報しつつループ継続、前回未完了時に次回がスケジュールされない
    （非重複）、変化なし時に空差分を転送、entities 欠落時に空観測として扱う。
- 決定事項・注意点:
  - **潜在バグ（collector へ差し戻し候補）**: `classify.ts` の `WORKBENCH_TOOLS`
    は部分一致（`includesAny`）で判定するため、`"cast"` が `"broadcast"` の部分
    文字列にマッチする。ノードのプロセス/イメージ名に "broadcast" 等が含まれると
    ワークベンチと誤分類される。同様に `"forge"`→"forged" 等の誤検知リスクあり。
    再現: `classifyContainer` に image/process で "broadcast" を含む観測を渡すと
    `kind: "workbench"` が返る。対策案は語境界を見る／既知トークンの完全一致に
    する等。現状の挙動をテストで固定はしていない（バグを固定化しないため）。
  - ポーリングループの「前回未完了時スキップ」は、実装が「await 完了後に次回を
    setTimeout する」方式のため、正確には「前回が完了するまで次回を予約しない」
    挙動。解決しない poll を与えても pollInfra が 1 回しか呼ばれないことで担保した。
  - store の `applyInfra` が非 infra エンティティ（wallet 等）を残すロジックは、
    現状 wallet を注入する公開 API がないためユニットテストでは直接検証できない。
    B/C 層実装時にテストを追加する余地として残す。
  - `pnpm build`・`pnpm test`（118 passed）・`eslint`・`prettier --check` を
    collector で通ることを確認。

### 2026-07-04 Issue #7 classify.ts の部分一致誤分類バグ修正
- 担当: collector
- ブランチ: issue-7-collector-a-layer
- 内容: `adapters/ethereum/classify.ts` のワークベンチ／クライアント判定が
  部分文字列一致（`includesAny`）だったため、"broadcast" に含まれる "cast"、
  "forged" に含まれる "forge" などにマッチし、ノードをワークベンチと誤分類
  していた（試験学からの差し戻し）。判定を単語境界ベースに変更した。
  - `includesAny` を `findWord` に置き換え、needle ごとに `\b<needle>\b`
    （大文字小文字無視）の正規表現でマッチさせる。イメージ名・サービス名で
    使われる区切り文字（`/ : - .` 空白）はいずれも `\b` 境界として扱われる
    ため、"geth-mainnet" の "geth" や "ghcr.io/.../reth:latest" の "reth"、
    "foundry" イメージ上の "cast" プロセスは従来どおり正しく検出される。
  - `classify.test.ts` に回帰テストを追加:「broadcast を含む process/service は
    workbench に誤分類されない」「forged は forge に一致しない」「区切り文字を
    挟んだツール語（foundry イメージパス・cast プロセス）は workbench として
    検出される」の3ケース。
- 決定事項・注意点:
  - `\b` は `[A-Za-z0-9_]` を単語構成文字とみなすため、アンダースコア区切り
    （例: `reth_node`）は境界にならず一致しない点に注意。現状のイメージ名・
    サービス名・プロセス名では `-`/`/`/`:`/`.` 区切りが使われており実害はないが、
    将来アンダースコア区切りのトークンを判定対象にする場合は境界定義の見直しが要る。
  - `pnpm build`・`pnpm test`（121 passed）が collector で通ることを確認。

### 2026-07-04 Issue #7・#8・#9 A層 collector 実装のレビュー（静的整合性）
- 担当: reviewer
- ブランチ: issue-7-collector-a-layer
- 内容: collector の A 層実装（Docker ポーリング・ワールドステート正規化・
  WebSocket 配信）と、テスト強化・classify.ts のバグ修正を静的にレビューした。
  結果は**合格**（差し戻しなし）。
  - 境界の遵守: チェーン固有語彙（reth/lighthouse/foundry 等）は
    `adapters/ethereum/` に閉じている。`docker/` 配下は Docker 共通の語彙のみで
    チェーン非依存。`packages/shared`・`frontend` への変更はなし（lockfile 除く）。
  - ARCHITECTURE.md との整合: §1 のフォルダ構成（docker/ adapters/ world-state/
    server/）、§2 の安定識別子要求（コンテナ ID 非依存）、§3 のプロトコル
    （接続時 snapshot 1回→以後 diff、command は commandResult で応答）に準拠。
    `proxy/`・`commands/` が無いのは後続 Phase の範囲なので問題ない
    （先回り実装をしない原則にも合致）。
  - CONCEPT.md との整合: ポーリング間隔 3 秒（CONCEPT の決定事項）を
    `POLL_INTERVAL_MS` で反映。
  - テストの質: 121 ケースを確認。異常系（top/stats 個別失敗、daemon 到達不能、
    不正 JSON、切断後の同報継続）・境界値（online_cpus=0、空 Titles、重複安定 ID、
    削除後再出現）をカバーし、classify の部分一致バグの回帰テスト
    （broadcast/forged）も実装の修正と対応している。実装をなぞるだけの
    無意味なテストは見当たらない。
  - `pnpm-workspace.yaml` の `allowBuilds`: cpu-features / ssh2 / protobufjs は
    いずれも dockerode 経由の推移的依存であることを `pnpm why` で確認。
    ローカルソケット接続のみの用途でビルド不要とする判断は妥当。
  - `pnpm install --frozen-lockfile`・`pnpm lint`・`pnpm build`・`pnpm test`
    （shared 2 / collector 121 / frontend 1、全パス）をリポジトリ全体で確認。
- 決定事項・注意点（いずれも軽微・非ブロッキング）:
  - `pnpm-workspace.yaml` のコメントと本 WORKLOG の前エントリで protobufjs を
    「SSH トランスポート用ネイティブ依存」と説明しているが、protobufjs は
    @grpc/proto-loader 経由の gRPC 系依存で、ネイティブビルドではなく
    postinstall スクリプトを持つだけ。ビルド不要の判断自体は正しいが、
    コメントの由来説明はやや不正確（次に触るときに直せばよい）。
  - `index.ts` の `startPollingLoop` の第1引数が具象型 `EthereumAdapter` に
    なっている。使うのは `pollInfra` のみなので、shared の `ChainAdapter` 型で
    受けるほうがチェーンプロファイル独立の意図に沿う。新チェーン追加時までに
    直せば十分。
  - `.claude/worktrees/` が未追跡で残っている。コミット時に含めないこと
    （`.gitignore` への追加を推奨）。
  - コミットは未実施のため、コミット粒度の確認は行っていない。コミット時に
    「1 変更 = 1 コミット」（実装 / テスト強化 / バグ修正 / 依存設定を分ける）を
    適用すること。

### 2026-07-04 Issue #7・#8・#9 A層 collector 実装の動作検証（SQA）
- 担当: qa
- ブランチ: issue-7-collector-a-layer
- 内容: collector の A 層実装（Docker ポーリング・ワールドステート正規化・
  WebSocket 配信）を実際に起動して検証した。結果は**合格**（差し戻しなし）。
  - `pnpm --filter @chainviz/collector build` が成功することを確認。
  - `main(port)` を任意ポート（4111）で起動し、WebSocket サーバーが listening
    になりポートが開くことを確認。
  - compose ラベル（project=qatest, service=node1/node2/foundry）付きの
    busybox コンテナ 3 個を立てた状態で、3 秒間隔ポーリングが Docker Engine
    API から実データを取得することを確認。スナップショットに実 IP
    （172.17.0.x）・resources（memMB=0.42）・process.name=sleep が反映され、
    stableId が compose ラベル由来（`qatest/node1` 等、コンテナ ID 非依存）で
    生成されていた。service=foundry のコンテナは classify で workbench に、
    それ以外は node に正しく分類された。
  - WebSocket クライアントで接続直後に snapshot が 1 回届くことを確認
    （ARCHITECTURE §3）。接続保持中に node2 を削除し node3 を追加したところ、
    次のポーリング周期で `entityAdded(qatest/node3)`・
    `entityRemoved(qatest/node2)` の 2 件を含む diff が配信された。resources に
    変化がない間は差分が飛ばない（round2 によるノイズ抑制）ことも確認。
  - 別クライアントで後から接続すると、その時点の最新状態（node2 削除・node3
    追加後）の snapshot が届き、store が周期ポーリングで最新化されていることを
    確認。
  - `command`（addWorkbench）を送ると `commandResult`（commandId 一致・
    ok=false・"command handling is not implemented yet"）が返ることを確認。
    操作系は後続 Phase の範囲であり、A 層時点でスタブ応答なのは仕様どおり。
- 決定事項・注意点:
  - 検証で使った busybox コンテナは node と分類され clientType が代表プロセス名
    "sleep" になる。実プロファイル（reth/lighthouse/foundry）では KNOWN_CLIENTS/
    WORKBENCH_TOOLS に一致するため、実環境での clientType/kind 判定はステップ 2 の
    ノード環境と合わせて別途確認する余地がある（本検証はダミーコンテナでの
    A 層パイプライン疎通の確認）。
  - テスト用コンテナ・起動した collector プロセスはいずれも後片付け済み。
  - PLAN.md ステップ 3 の collector 項目（#7〜#9）は qa/collector で担当が
    明示的に分かれていないため、collector が付けたチェックはそのままとする
    （本検証で完了条件を満たすことを確認済み）。

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

### 2026-07-04 Issue #22・#23・#24 B層（P2P ピア接続グラフ）のフロント描画
- 担当: frontend
- ブランチ: issue-22-frontend-peer-edges
- 内容: B層として、ノードカードのあいだに P2P ピア接続を「紐」（React Flow
  エッジ）として描画する仕組みを実装した。collector 側（#19-21）は未完成の
  ため、`packages/frontend/src/websocket/mockData.ts` に PeerEdge のサンプルを
  載せて実装・確認した。
  - #22: world-state store（`world-state/store.ts`）は既に `applySnapshot` /
    `applyDiff` で PeerEdge（edgeAdded / edgeRemoved）を受信・保持していた
    （既存実装）。エッジ配列を取り出す `listEdges(state)` アクセサを
    `listEntities` と対にして追加し、テストを足した。
  - #23: `entities/peerEdge.ts` を新設。`peerEdgesToFlowEdges(edges, presentNodeIds)`
    が PeerEdge を React Flow の Edge に変換する。`fromNodeId` / `toNodeId` は
    インフラエンティティの安定 ID（= React Flow ノードの id）に対応する。
    端点が両方カードとして存在する紐だけを描き（宙ぶらりんの紐を避ける）、
    P2P は無向なので同一 networkId・同一ペアは向きが逆でも 1 本にまとめる。
    エッジをカードに留めるため `InfraNodeCard` に source / target の Handle を
    追加した（CSS で不可視化）。`Canvas` は edges を受け取り、ノードと同じく
    ローカル state + `onEdgesChange` で保持する。`App` が state のエッジと
    現在のノード id からエッジを算出して Canvas に渡す。
  - #24: `networkId` 単位のグルーピング。`networkIdColor(networkId)` で
    networkId から決定的に色を選び、エッジの stroke と className に反映する。
    `groupEdgesByNetwork` で networkId ごとに集計できる。現状の Ethereum
    プロファイル 1 つでは networkId は 1 種類（`1337`、profiles/ethereum の
    CHAIN_ID と一致）のため既定のスナップショットの見た目には差が出ないが、
    将来の複数チェーン比較（Phase 6 以降）に備えて仕組みを用意した。
  - glossary: B層向けの用語ファイル `glossary/ethereum/terms/b-network.yaml`
    を追加（p2p / peer / discovery / gossip、layer: b-network）。`glossary/data.ts`
    でマージして読み込む。
- 決定事項・注意点:
  - `packages/shared` の型変更は不要だった。PeerEdge / DiffEvent（edgeAdded /
    edgeRemoved）は既に定義済み。
  - モックデータは、既定の `createMockSnapshot()` は実環境どおり networkId
    1 種類（reth-node-1 ⇄ reth-node-2 の 1 本）にとどめ、実環境の見た目に
    影響しないようにした。#24 のグルーピングを目視・テストで確認するための
    2 ネットワークのサンプルは別関数 `createMultiNetworkMockSnapshot()` として
    切り出し、既定の App では使わない。
  - #25（ブロック伝播パルスアニメーション）は今回のスコープ外。collector 側の
    ブロックタイミングデータ（#20-21）が固まってから別途着手する。
  - 検証: `pnpm --filter @chainviz/frontend build` / `test`（145 件全通過）/
    `eslint packages/frontend/src` がいずれも通ることを確認した。実データとの
    疎通確認は collector 側完成後に qa が行う。

### 2026-07-04 Issue #22・#23・#24 B層描画のテスト強化（異常系・境界値）
- 担当: tester
- ブランチ: issue-22-frontend-peer-edges
- 内容: 実装担当が書いた基本テストに、エッジケース・異常系・境界値のテストを
  追加した（実装コードは変更していない）。テスト件数は 145 → 171（+26）。
  - `entities/peerEdge.test.ts`:
    - `networkIdColor`: 空文字列・特殊文字（日本語/中国語/空白/タブ）・
      500 件の networkId でいずれもパレット範囲内の色を返すことを確認。
    - `networkClassToken`: 空文字列・全文字が不正な場合・既に安全な
      ハイフン/アンダースコアの保持。
    - `peerEdgesToFlowEdges`: 空配列、present が空、source 側端点の欠落、
      両端点の欠落、完全重複エッジの排除、1 バッチ内で自己ループ・宙ぶらりん・
      有効エッジが混在する場合の選別、逆向き × 別 networkId が別の紐になること、
      並べ替え後も data.networkId が元の値を保つこと、className だけが
      サニタイズされ id キーには生の networkId が使われること、
      クラストークンが衝突する networkId 同士を別扱いすること。
    - `groupEdgesByNetwork`: 同一 networkId の複数エッジが 1 バケットに
      まとまること、data 欠落エッジが空文字バケットへ落ちること。
  - `world-state/store.test.ts`（edgeAdded / edgeRemoved の差分適用）:
    - edgeAdded が入力配列を破壊しないこと、edgeRemoved の逆向き指定では
      一致しないこと、edgeRemoved が同一ペアの複数 networkId エッジを
      まとめて消すこと、edgeAdded の重複判定が networkId を無視すること、
      エッジとエンティティのイベント混在バッチ、別バッチでの追加→削除。
    - `listEdges`: 最後のエッジ削除後に空配列へ戻ること。
  - `websocket/mockData.test.ts`: `createMultiNetworkMockSnapshot()` を
    描画変換（peerEdgesToFlowEdges → groupEdgesByNetwork）まで通し、
    宙ぶらりんが出ず 2 グループに分かれることの結合テストを追加。
- 決定事項・注意点:
  - 差分プロトコル上、`edgeRemoved` は networkId を持たない
    （`DiffEvent` の定義）。store 側の edgeAdded 重複判定も (from, to) のみで
    networkId を見ないため、同一ペアで networkId 違いの 2 本目は追加されない。
    一方、描画側 `peerEdgesToFlowEdges` は networkId 違いを別の紐として扱う。
    この非対称性は、同一ノードペアが複数ネットワークで同時にピア接続する
    という稀なケースでのみ表面化する既知の制約として、store 側にテストと
    コメントで記録した（現状の実環境では networkId は 1 種類のため実害なし）。
  - 検証: `pnpm --filter @chainviz/frontend test`（171 件全通過）/ `build` /
    追加した 3 ファイルへの `eslint` がいずれも通ることを確認した。
