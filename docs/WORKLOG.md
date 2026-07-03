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
