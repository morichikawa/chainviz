# chainviz 開発プラン（設計フェーズ〜Phase 1）

`docs/CONCEPT.md` のロードマップ（Phase 1〜8）が「何を作るか」を定めるのに対し、
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

- [ ] genesis 設定ファイル（genesis.json 等）の作成。バリデーター最小構成・
      slot time 短縮を反映（reth + lighthouse 向け）
      [#1](https://github.com/morichikawa/chainviz/issues/1)
- [ ] その genesis を使って reth + lighthouse を2〜3ノード起動する
      compose ファイルの作成 [#2](https://github.com/morichikawa/chainviz/issues/2)
- [ ] ワークベンチコンテナ（Foundry）×1 を同ネットワークに接続
      [#3](https://github.com/morichikawa/chainviz/issues/3)
- [ ] `docker compose up` でチェーンが起動しブロックが進み続けることを確認
      [#4](https://github.com/morichikawa/chainviz/issues/4)
- [ ] ワークベンチから `cast` で RPC 疎通確認
      [#5](https://github.com/morichikawa/chainviz/issues/5)

（ロギングプロキシはこの時点では置かない。Phase 3 で追加）

**成果物**: `profiles/ethereum/` のノード環境テンプレート
**完了条件**: `docker compose up` でチェーンが起動しブロックが進み続ける。
ワークベンチから `cast` で RPC が叩ける

## ステップ 3: Phase 1 実装 — A層（インフラ可視化）

- [ ] collector: dockerode で Docker Engine API
      （containers / top / stats）を 3 秒間隔でポーリング
- [ ] ポーリング結果をワールドステートに正規化
- [ ] WebSocket でフロントへプッシュ（スナップショット + 差分）
- [ ] frontend: React Flow による無限キャンバスの土台
- [ ] コンテナのカード表示
- [ ] ホバーで IP・プロセス・リソースのポップオーバー
- [ ] 用語解説のインライン表示の仕組み
- [ ] A層の用語データ（`glossary/ethereum/terms/a-infra.yaml`）
- [ ] レイアウトの localStorage 永続化（キーは安定識別子。コンテナ ID は使わない）
- [ ] UI 言語切り替え（ja / en）の仕組み

**成果物**: 動く Phase 1 デモ
**完了条件**: CONCEPT.md「ロードマップ」Phase 1 の記述どおりに動作する

## ステップ 4 以降（概要のみ。詳細は着手時にこのドキュメントへ追記）

- [ ] Phase 2（B層: P2P グラフ + ブロック伝播の波）
- [ ] Phase 3（C層: tx ライフサイクル、ワークベンチ操作の可視化、ウォレット）
- [ ] キャンバスからのノード/ワークベンチ追加・削除（Phase 2〜3 の間に挟む。
      Collector の操作系 API はステップ 0-3 で設計だけ先に済ませておく）
- [ ] Phase 4（D層: ノード内部）
- [ ] Phase 5（AA 可視化）
- [ ] Phase 6（Bitcoin プロファイル追加）
- [ ] Phase 7（Solana プロファイル追加、チェーン比較表示）
- [ ] Phase 8 以降（Cosmos 系プロファイル追加）

## 運用ルール（全ステップ共通）

- 1 ステップ = 1 つ以上のコミット。Conventional Commits 形式
- サブ項目を完了したらその場でチェックを付ける（進捗はチェックボックスで
  管理し、まとめての更新はしない）
- ステップ完了時に sync-docs スキルで docs/ を確認する
- 各 Phase が単体で「動くデモ」になることを優先し、先の Phase のための
  先回り実装をしない（CLAUDE.md 参照）
