# Issue #369 collectorのcomposeProjectが"chainviz-ethereum"にハードコードされており環境変数で上書きできない

### 2026-07-17 Issue #369 起票とバックログのIssueリンク付与のレビュー

- 担当: reviewer
- ブランチ: docs-issue-369-and-353-backlog
- 内容: `docs/PLAN.md` のバックログに以前から記載されていたが GitHub
  Issue 化されずに残っていた項目(collector の composeProject が
  "chainviz-ethereum" にハードコードされ環境変数での上書き口が無く、
  QA 検証時に独立した合成環境でワークベンチ経由の操作
  (runWorkbenchOperation 等)を検証できない)について、統括が新規に
  Issue #369 を起票し、既存のバックログ項目にリンクと経緯の補足
  (Issue 化されずに残っていた旨・2026-07-17 に Issue 化した旨)を
  追記した。その内容をレビューした。
- レビュー結果: 合格
  - Issue #369 本文と PLAN.md の項目(573行目付近)が過不足なく一致
    (ハードコード箇所・上書き口が無いこと・QA 検証への影響・
    対象パッケージ collector)
  - 追記フォーマットが既存バックログ項目(チェックボックス行+括弧書きの
    補足+末尾の Issue リンク行)と一貫
  - 同一コミットで行われた Issue #353 のバックログ追記漏れの修正も
    あわせて確認(詳細は docs/worklog/issue-313.md の追記を参照)。
    「バックログの記載漏れ修正」という単一の関心事であり、1コミットに
    まとまっていることは妥当と判断
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過
- 決定事項・注意点:
  - 本 Issue の実装(環境変数での上書き口の追加など具体的な実現方法)は
    未着手。着手時に設計判断が必要(Issue 本文にも明記あり)
  - docs 配下のみの変更のため、CLAUDE.md の例外規定に基づき
    chainviz-qa は省略(reviewer 合格のみ)

### 2026-07-18 設計メモ(designer)

- 担当: designer
- ブランチ: issue-369-compose-project-env
- 内容: composeProject を環境変数で上書きできるようにするための設計。
  ハードコード箇所の洗い出し・環境変数の命名・derived な名前
  (ネットワーク/ボリューム)の扱い・後方互換の方針を決定した。
  実装コードはまだ書いていない(collector 担当へ引き継ぐ)。

#### 現状調査の結果(ハードコード箇所の洗い出し)

`packages/collector/src` の非テストコードで `"chainviz-ethereum"` を
ハードコードしているのは **`adapters/ethereum/node-lifecycle.ts` の
`DEFAULTS` オブジェクト(1箇所に集約済み)のみ**:

- `composeProject: "chainviz-ethereum"`
- `networkName: "chainviz-ethereum_chain"`
- `genesisVolume: "chainviz-ethereum_genesis"`
- `clpeerVolume: "chainviz-ethereum_clpeer"`
- `elpeerVolume: "chainviz-ethereum_elpeer"`

上記以外は動的で、修正不要:

- `docker/observe.ts` の `computeStableId` はコンテナのラベル
  (`com.docker.compose.project`)を実測で読むため、別プロジェクト名でも
  そのまま追従する(A 層の観測はプロジェクト名でフィルタしていない)
- `recoverManagedContainers()` / `findWorkbenchContainer()` /
  `existingWorkbenchServiceNames()` のラベルフィルタは
  `this.cfg.composeProject` を参照しており、config 経由で切り替わる
- `node-lifecycle.ts` の 17 行目・379 行目のコメント内
  `"chainviz-ethereum/<service>"` は例示(実装時に「既定の compose project
  の場合」と分かる表現へ直すとよいが必須ではない)

スコープ外(今回は変更しない):

- `packages/e2e/src/helpers/docker.ts`・
  `packages/e2e/src/ui/support/serviceIds.ts` の `"chainviz-ethereum"` は
  「実プロファイル環境を対象にした E2E テスト」の前提値であり、Issue #369
  の対象(`packages/collector`)外。E2E を合成環境で回す必要が出たら別 Issue
  とする
- `packages/frontend` に該当なし(コメント内の言及のみ)

#### 設計

**環境変数: `CHAINVIZ_COMPOSE_PROJECT`**

- 既存の collector 実行時設定(`CHAINVIZ_COLLECTOR_PORT` /
  `CHAINVIZ_PROXY_PORT` / `CHAINVIZ_PROXY_TARGET` /
  `CHAINVIZ_WORKBENCH_RPC_HOST` / `CHAINVIZ_ETHEREUM_PROFILE_DIR`)と同じ
  `CHAINVIZ_` プレフィックスの命名に合わせる
- `COMPOSE_PROJECT_NAME` そのものは使わない。Docker Compose CLI 自身が
  解釈する変数のため、collector と同じシェルで `docker compose` を操作
  したときに双方へ効いてしまう。collector 専用の上書き口として分離する
- `CHAINVIZ_ETHEREUM_COMPOSE_PROJECT` も検討したが不採用。collector
  プロセスは現状 1 環境のみを観測・管理し、`resolve*` 系はプロセスレベル
  設定として `CHAINVIZ_<対象>` の命名で統一されている。マルチプロファイル
  対応時は設定体系ごと見直す(CLAUDE.md「先回り実装をしない」)

**解決関数: `resolveComposeProject()`(`packages/collector/src/index.ts`)**

既存の `resolvePort()` / `resolveProxyTarget()` と同じパターン:

```ts
export function resolveComposeProject(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.CHAINVIZ_COMPOSE_PROJECT;
  if (raw === undefined || raw.trim() === "") return DEFAULT_COMPOSE_PROJECT;
  return raw.trim();
}
```

- 既定値 `DEFAULT_COMPOSE_PROJECT = "chainviz-ethereum"` は Ethereum
  プロファイルの語彙なので `adapters/ethereum/node-lifecycle.ts` 側で
  export し、`index.ts` はそれを import して使う(ChainAdapter 境界)
- `main()` で lifecycle config に `composeProject: resolveComposeProject()`
  を渡す

**derived な名前の導出(`node-lifecycle.ts`)**

`networkName` / `genesisVolume` / `clpeerVolume` / `elpeerVolume` は
Compose の命名慣習 `<project>_<リソースキー>` に従い composeProject から
導出する。固定オブジェクト `DEFAULTS` を、composeProject を受け取って
既定 config を返す関数(例 `defaultConfigFor(composeProject)`)に変える:

- ``networkName: `${project}_chain` ``、``genesisVolume:
  `${project}_genesis` ``、``clpeerVolume: `${project}_clpeer` ``、
  ``elpeerVolume: `${project}_elpeer` ``
- イメージ名(rethImage 等)は project に依存しないので従来どおり固定
- config で `networkName` 等を明示指定した場合は導出値より優先する
  (既存の個別上書き口を維持。テストで使われている)
- **前提条件**(固定値ではなく導出にした理由と成立条件):
  `profiles/ethereum/docker-compose.yml` が network `chain`・volume
  `genesis`/`clpeer`/`elpeer` に固定の `name:` を付けていないこと。
  現状はトップレベルの `name: chainviz-ethereum` のみで、これは
  `docker compose -p <別名>` / `COMPOSE_PROJECT_NAME` で上書きされ、
  network/volume は `<project>_<キー>` に展開される。この前提は実装時に
  コード内コメントにも明記すること(CLAUDE.md「固定値の前提条件を明記」)

**コンストラクタの注意点**

現状の `this.cfg = { ...DEFAULTS, ...rest }` は、`composeProject:
undefined` という**キーだけ存在して値が undefined** の config を渡されると
既定値を undefined で潰す。実装時は
`const project = config.composeProject ?? DEFAULT_COMPOSE_PROJECT;` の
ように先に project を確定させてから `defaultConfigFor(project)` を
スプレッドの土台にし、undefined 値のキーが既定を潰さない形にする
(`resolveComposeProject()` は常に string を返すので `main()` 経路では
起きないが、テスト・将来の呼び出し元への安全のため)。

**後方互換**

- 環境変数未設定・空文字なら従来どおり `chainviz-ethereum` とその派生名
  (`chainviz-ethereum_chain` 等)になり、挙動は一切変わらない
- `packages/shared` の型変更は**不要**(`EthereumNodeLifecycleConfig` は
  collector 内部の型。ワールドステートのスキーマ・WS プロトコルに変化なし。
  stableId の形式 `<project>/<service>` も従来から project 可変の設計)

**テスト観点(実装担当が基本テストを書く。tester が強化)**

- `resolveComposeProject()`: 未設定→既定 / 空白のみ→既定 / 設定→trim 値
  (既存の `index.test.ts` の resolve 系テストと同じ流儀)
- lifecycle: `composeProject` を上書きした config で
  - `addNode` の ContainerSpec(コンテナ名・ラベル・binds のボリューム名・
    networkName)と登録される stableId が上書き値に追従する
  - `recoverManagedContainers()` / `findWorkbenchContainer()` のラベル
    フィルタが上書き値で走査する
  - `composeProject` 未指定なら従来値のまま(後方互換の回帰確認)

**影響範囲(変更するファイル一覧)**

- `packages/collector/src/index.ts` — `resolveComposeProject()` 追加、
  `main()` で lifecycle config へ渡す
- `packages/collector/src/adapters/ethereum/node-lifecycle.ts` —
  `DEFAULT_COMPOSE_PROJECT` の export、`DEFAULTS` の関数化
  (project からの導出)、コンストラクタの組み立て変更
- `packages/collector/src/index.test.ts` /
  `packages/collector/src/adapters/ethereum/node-lifecycle.test.ts`
  (または 1 ファイル 1 責務に沿った新設テストファイル) — 上記テスト観点
- `docs/ARCHITECTURE.md` — 「未確定のまま残す項目」の状態ストアの項に
  確定(Issue #369)として記載済み(本設計フェーズで反映済み)

- 決定事項・注意点:
  - 環境変数名は `CHAINVIZ_COMPOSE_PROJECT`(理由は上記)
  - network/volume 名は project 名から Compose 慣習で導出(個別上書きは維持)
  - `packages/shared` の変更なし。frontend への影響なし
  - e2e パッケージのハードコードは今回のスコープ外

### 2026-07-18 実装設計メモ(collector)

- 担当: collector
- ブランチ: issue-369-compose-project-env
- 設計メモ(上記)の方針をそのまま実装する。着手前に確認した実装上の
  具体的な手順は以下のとおり。

1. `node-lifecycle.ts`
   - `DEFAULT_COMPOSE_PROJECT = "chainviz-ethereum"` を export する
     （既定値の語彙をアダプタ側に置くという設計方針どおり）。
   - 現行の固定 `DEFAULTS` オブジェクトを `defaultConfigFor(composeProject:
     string)` 関数に置き換える。返り値は `composeProject` 自身を含む
     `Omit<ResolvedConfig, "profileDir" | "ethRpcUrl">` 相当のオブジェクトで、
     `networkName`/`genesisVolume`/`clpeerVolume`/`elpeerVolume` は
     `` `${composeProject}_chain|_genesis|_clpeer|_elpeer` `` から導出し、
     `rethImage`/`lighthouseImage`/`foundryImage` は project に依存しない
     固定値のまま。
   - コンストラクタは
     `const project = config.composeProject ?? DEFAULT_COMPOSE_PROJECT;`
     で先に project を確定させ、
     `this.cfg = { ...defaultConfigFor(project), ...rest, composeProject:
     project };` の順でスプレッドする（`rest` 内に
     `composeProject: undefined` というキーが残っていても、最後に明示
     代入することで既定を潰さないようにする。`networkName` 等の個別上書き
     キーは `rest` のスプレッドが `defaultConfigFor` の導出値より後に来る
     ため、従来どおり優先される）。
   - 17 行目・379 行目付近のコメント中の `"chainviz-ethereum/<service>"`
     という例示は、`DEFAULT_COMPOSE_PROJECT` を使った場合の例だと分かる
     形に軽く補記する（必須ではないが紛らわしさの解消として実施）。

2. `index.ts`
   - `resolveComposeProject(env)` を `resolvePort`/`resolveProxyTarget` と
     同じパターンで追加し、`node-lifecycle.js` から
     `DEFAULT_COMPOSE_PROJECT` を import して既定値に使う。
   - `main()` の `EthereumNodeLifecycle` 構築時に渡す config へ
     `composeProject: resolveComposeProject()` を追加する。

3. テスト
   - `index.test.ts`: `resolveComposeProject` の未設定/空白/trim
     テストを既存の `resolveProxyTarget` 等と同じ describe ブロックの
     並びに追加する。
   - lifecycle 側は 1 ファイル 1 責務の原則に従い、`node-lifecycle.test.ts`
     を肥大化させず新規ファイル
     `adapters/ethereum/node-lifecycle-compose-project.test.ts` に分離する
     （`node-lifecycle-workbench-naming.test.ts` と同じ切り出しパターン）。
     - `composeProject` を上書きした config で `addNode` の
       ContainerSpec（コンテナ名・ラベル・binds のボリューム名・
       networkName）と登録される stableId が上書き値に追従すること
     - `recoverManagedContainers()` のラベルフィルタが上書き値で走査
       すること
     - `findWorkbenchContainer()`（`runWorkbenchOperation` 経由）の
       ラベルフィルタが上書き値で走査すること
     - `composeProject` 未指定なら従来値 `chainviz-ethereum` のままである
       こと（回帰確認）
     - コンストラクタの安全策として、`composeProject: undefined` という
       キーを明示的に持つ config を渡しても既定値が保たれること
       （設計メモの「注意点」で挙げられた回帰ケース）

### 2026-07-18 テスト強化メモ(tester)

- 担当: tester
- ブランチ: issue-369-compose-project-env
- 実装担当が書いた基本テスト（`index.test.ts` の resolveComposeProject
  3ケース、`node-lifecycle-compose-project.test.ts` の9ケース）を土台に、
  異常系・境界値の観点で以下を追加する。実装ロジックには手を入れず、
  現状の挙動を固定するテストのみを追加する。
- 追加する観点:
  1. `resolveComposeProject`: タブ/改行のみの空白（`.trim()` が空白全般を
     除去し既定へ落ちること）、内部の空白は trim されず保持されること、
     Docker Compose project 名として不正な文字（大文字・アンダースコア・
     ドット・スラッシュ）がサニタイズされずそのまま通ること（＝この関数は
     検証を行わない設計であることの固定）。
  2. `defaultConfigFor`（コンストラクタ経由）: `composeProject: ""` を
     直接渡した場合の導出結果（`_chain`・`-reth3` 等の退化した名前になる。
     `?? ` は空文字を捕捉しないため既定へ落ちない）を固定する。
     resolveComposeProject 経由では空文字は既定に落ちるためこの経路は
     通常発生しないが、コンストラクタの直接呼び出しに対する現状の挙動を
     記録する。
  3. 個別上書きキーと composeProject 上書きの全組み合わせ:
     clpeerVolume/elpeerVolume の個別上書き、composeProject を上書きせず
     networkName だけ上書きした場合、といった既存テスト未カバーの組み合わせ
     での優先順位を固定する。
  4. recover のラベルフィルタ整合: 回収対象のコンテナが cfg と異なる
     project ラベルを持つ場合、stableId が cfg ではなくコンテナ自身の
     ラベルから組み立てられること（`toManagedContainer` の防御的挙動）を
     固定する。
- 発見した懸念点（実装は変更しない。報告に留める）:
  - resolveComposeProject / lifecycle とも composeProject の文字種を
    検証・サニタイズしない。operator が不正な project 名を与えると
    コンテナ名・ラベルが不正になり、Docker 作成時に失敗しうる。QA 用の
    operator 向け上書き口であり Docker 側で fail-fast するため許容範囲と
    判断するが、テストで現状挙動として固定した。
  - コンストラクタの `config.composeProject ?? DEFAULT_COMPOSE_PROJECT`
    は空文字を既定へ落とさない。main() 経路では resolveComposeProject が
    空文字を既定に変換するため到達しないが、直接呼び出しでは退化した
    導出名になる点をテストで固定した。
