### 2026-07-07 Issue #129 動的追加ワークベンチのRPCをロギングプロキシ経由にする
- 担当: collector
- ブランチ: issue-129-workbench-proxy-bypass
- 内容:
  - 不具合の原因: `packages/collector/src/adapters/ethereum/node-lifecycle.ts`
    の `EthereumNodeLifecycle`（`addWorkbench` が使うコンテナ構成の組み立て）
    は、ワークベンチが叩く `ETH_RPC_URL` の既定値
    (`DEFAULTS.ethRpcUrl = "http://172.28.1.1:8545"`) を reth1 の固定 IP に
    決め打ちしていた。静的ワークベンチ
    (`profiles/ethereum/docker-compose.yml` の `workbench` サービス、
    Issue #78 で対応済み) は `http://host.docker.internal:4001`
    (ロギングプロキシ) を指すのに対し、動的追加ワークベンチだけが reth1 に
    直結していたため、ロギングプロキシ (Issue #79/#80) が動的ワークベンチの
    RPC 呼び出しを観測できず、操作エッジ (`OperationEdge`) が一切描画され
    ない状態だった。
  - 修正方針: `EthereumNodeLifecycleConfig.ethRpcUrl` を任意項目から**必須
    項目**に変更し、アダプタ内部にreth直結の既定値を持たせないようにした。
    呼び出し元の `packages/collector/src/index.ts` の `main()` が、新設した
    `resolveWorkbenchRpcUrl()` で実行時にロギングプロキシの実際の待受設定
    から URL を導出し (`http://${resolveWorkbenchRpcHost()}:${resolveProxyPort()}`)、
    それを `ethRpcUrl` として渡す。
    - `resolveProxyPort()` は Issue #79 で実装済みの既存関数をそのまま使う
      (プロキシの実際の待受ポートと常に一致させるため、別の固定値を持た
      ない)。
    - 新設の `resolveWorkbenchRpcHost()` は、collector が動くホストマシンへ
      コンテナ内から到達するための Docker 標準の host-gateway 予約名
      `host.docker.internal`（静的ワークベンチと同じ値。
      `DEFAULT_WORKBENCH_RPC_HOST` として定数化）を既定にし、環境変数
      `CHAINVIZ_WORKBENCH_RPC_HOST` で上書きできるようにした
      (`resolveProxyPort`/`resolveProxyTarget` と同じ「環境変数優先、なければ
      既定値」のパターンに揃えた)。
  - コンテナ側で `host.docker.internal` を解決できるようにするため、
    `docker/operations.ts` の `ContainerSpec` に汎用の `extraHosts?: string[]`
    フィールド（Docker 共通の "hostname:ip" 形式、`docker run --add-host`
    相当）を追加し、`dockerode-operations.ts` の `toCreateOptions` で
    `HostConfig.ExtraHosts` へマッピングした。
  - `node-lifecycle.ts` の `workbenchSpec` に `workbenchExtraHosts()` を追加し、
    `ethRpcUrl` のホスト部がホスト名（IPv4 リテラルではない）なら
    `["<host>:host-gateway"]` を extraHosts として付与するようにした
    (静的ワークベンチの `docker-compose.yml` にある
    `extra_hosts: - "host.docker.internal:host-gateway"` と同じ効果)。
    IPv4 直指定（テストでの上書き等）ではホスト名解決が不要なので
    extraHosts は付与しない。ホスト部の抽出・判定に `extractHost` /
    `isIpv4Literal` を新設しユニットテストを追加した。
- 決定事項・注意点:
  - `ethRpcUrl` を必須項目にしたことで、`node-lifecycle.test.ts` の共有
    `config` 定数に `ethRpcUrl: "http://host.docker.internal:4001"` を追加
    した。ほとんどのテストはこの共有定数を使っているため、この1箇所の
    変更で波及した。個別にインライン config を書いていた2箇所
    (`profileDir` だけを渡すテスト) も `...config` を spread する形に統一
    した。
  - `resolveWorkbenchRpcUrl()` はロギングプロキシの実際の待受ポート
    (`resolveProxyPort()`) を都度参照する関数であり、値をどこにも固定
    埋め込みしていない。ポート番号の既定値 (`DEFAULT_PROXY_PORT = 4001`)
    自体は Issue #79 時点で確定した集約点であり、今回新設した関数からも
    その1箇所だけを参照する（重複定義していない）。
  - 実機（本物の Docker + reth/lighthouse + 動的ワークベンチ追加 →
    RPC 発行 → 操作エッジ描画の一連の流れ）での確認はこの worklog の
    範囲では行っていない。CLAUDE.md の運用ルールに従い、メイン作業
    ディレクトリで別の docker compose プロジェクトが稼働中でポート衝突の
    懸念があったため、独立した合成環境での検証、または統括による別途QA
    検証に委ねる。今回はユニットテスト（`extraHosts` の付与条件・
    `resolveWorkbenchRpcHost`/`resolveWorkbenchRpcUrl` の解決ロジック・
    `dockerode-operations` の `ExtraHosts` マッピング）で振る舞いを検証した。
  - `pnpm --filter @chainviz/collector build` / `pnpm --filter
    @chainviz/collector test`（653件）/ `pnpm lint`（リポジトリ全体）を
    すべて実行し成功を確認した。

### 2026-07-07 Issue #129 テスト強化（異常系・境界値）
- 担当: tester
- ブランチ: issue-129-workbench-proxy-bypass
- 内容: 実装担当が書いた基本テストに、異常系・境界値・分岐網羅の観点で
  ユニットテストを追加した（実装コードは変更していない）。653件 → 677件。
  - `index.test.ts`（`resolveWorkbenchRpcUrl` / `resolveWorkbenchRpcHost`）:
    - 既定値が静的ワークベンチの `http://host.docker.internal:4001`
      （`profiles/ethereum/docker-compose.yml`）と文字列一致することを固定。
    - ホストのみ上書き / プロキシポートのみ上書き / 両方上書き の各組み合わせ。
    - プロキシポート不正値（`"abc"`）時に既定ポートへフォールバックし
      `http://host:NaN` のような壊れた URL にならないこと。
    - `resolveProxyPort` に追従していること（同じ env での突き合わせ）。
    - `CHAINVIZ_WORKBENCH_RPC_HOST` が空白のみのとき未設定扱いになること。
  - `node-lifecycle.test.ts`（`extractHost` / `isIpv4Literal` /
    `workbenchExtraHosts`）:
    - `extractHost`: ポート・パス・クエリの除去、ホスト名の小文字正規化、
      空文字列 / スキーム無しの素のホスト名で undefined、IPv6 リテラルは
      角括弧付きで返る、スキームレス `host:port` は空文字列を返す（後述）。
    - `isIpv4Literal`: 3組/5組の却下、ポート付き却下、IPv6 却下、範囲外
      オクテット（`999.999.999.999`）を許容する現状の緩さを固定。
    - `workbenchExtraHosts`（addWorkbench 経由）: 任意のホスト名で
      host-gateway を付与、正規化済みホスト名で付与しつつ ETH_RPC_URL は
      未加工のまま渡す、パース不能な URL / 空ホスト名では extra_hosts を
      付けないが ETH_RPC_URL は設定される、addNode の reth/beacon spec には
      extra_hosts が付かない（Issue #129 の ContainerSpec 追加がノード側に
      漏れていない）ことを固定。
  - `dockerode-operations.test.ts`（`toCreateOptions`）:
    - extraHosts 複数エントリの順序保持、空配列をそのまま通す、extraHosts
      付与時に既存 HostConfig（Binds / NetworkMode）へ副作用が無いこと。
- テスト作成中に判明した挙動（バグではないが直感に反するため記録）:
  - `extractHost("host.docker.internal:4001")`（スキーム無しの `host:port`）は
    `new URL` が `host.docker.internal:` をスキーム・`4001` を opaque path と
    解釈してパースに成功してしまい、hostname が**空文字列**になる（undefined
    ではない）。`workbenchExtraHosts` は空文字列を falsy 判定で弾くため
    extra_hosts は付与されず実害は無い。当初 undefined を期待するテストを
    書いたが実挙動に合わせて修正し、回帰対象として固定した。
  - `isIpv4Literal` は各オクテットの 0..255 範囲を検査しないため
    `999.999.999.999` を IPv4 リテラル（= host-gateway 不要）と判定する。
    ホスト名解決の要否を分ける用途では数字4組をリテラル扱いにしても実害が
    無く、意図した緩さと判断した（実装は未変更、現状固定のテストのみ追加）。
  - いずれも実運用で通る経路ではない（Ethereum プロファイルは IPv4 帯
    172.28.x.x と host.docker.internal のみ使用）。実装バグは検出されなかった。
- `pnpm --filter @chainviz/collector build` / `test`（677件、全通過）/
  `pnpm lint`（リポジトリ全体）を実行し成功を確認した。

### 2026-07-07 Issue #129 静的レビュー（合格）
- 担当: reviewer
- 判定: **合格**（コード変更は不要。マージ前にコミット分割と、任意の docs 追記
  1点あり。下記参照）
- 確認内容:
  - 設計原則との整合:
    - `resolveWorkbenchRpcHost()` の既定値 `host.docker.internal` は
      「今観測できる環境の値」ではなく Docker 標準の host-gateway 予約名
      （Docker Engine 20.10+）であり、成立前提がコードコメントと本 worklog の
      両方に明記されている。ポートは `resolveProxyPort()`（Issue #79 の既存
      集約点）から都度導出しており、決め打ちの重複定義は無い。
      「固定値を埋め込まない」運用ルールに適合。
    - ChainAdapter 境界: `ContainerSpec.extraHosts` は Docker 共通概念として
      `docker/operations.ts` に置かれ、チェーン固有の語彙を含まない。
      `ETH_RPC_URL` / `ethRpcUrl` は `adapters/ethereum/` と collector の
      `index.ts` 内に閉じており、`packages/shared` / frontend への漏れは無い。
    - チェーンプロファイル独立性: 既存プロファイルへの分岐追加は無い。
      `addNode`（reth/beacon）側に extraHosts が漏れていないことはテストで
      固定済み。
  - `packages/shared` の変更が無いことを `git diff --stat` で確認した
    （collector 内部のみの変更）。
  - tester が記録した2つの「直感に反する挙動」への判断:
    - `extractHost("host:port")` が空文字列を返す件: 実運用の唯一の供給元
      `resolveWorkbenchRpcUrl()` は常に `http://` 前置きの URL を生成するため
      スキーム無し文字列はこの経路に入らない。仮に入っても
      `workbenchExtraHosts` が falsy 判定で弾き extra_hosts を付けないだけで
      失敗はしない。テストで現状固定済みであり**修正不要**と判断。
    - `isIpv4Literal` がオクテット範囲(0-255)を検査しない件: 範囲外の
      数字4組（例 `999.999.999.999`）はそもそも到達可能なホストではなく、
      これを「リテラル扱い＝extra_hosts 不要」に倒しても壊れ方は変わらない
      （逆に `999.999.999.999:host-gateway` を付与する方が誤り）。実運用は
      172.28.x.x と host.docker.internal のみ。**修正不要**と判断。
  - エラー握りつぶし: 差分中の catch は `extractHost` の「パース不能 →
    undefined」1箇所のみで、意図が JSDoc に明記されテストで固定されている。
    失敗を `ok:true` 相当にすり替える箇所も無い。
  - テストの質: 生成 URL が静的ワークベンチの
    `http://host.docker.internal:4001`（docker-compose.yml）と文字列一致する
    ことを固定するテストがあり、Issue の主眼（動的・静的の接続先一致）を
    実装の詳細ではなく観測可能な振る舞いで検証している。異常系
    （不正ポート・壊れた URL・空白 env）・境界値（IPv6・スキーム無し）も
    網羅されており、意味のあるテスト群と評価する。
  - `pnpm lint` / `pnpm build` / `pnpm test` をリポジトリ全体で実行し全通過
    （collector 677件、frontend 761件）。
- マージ前に統括へ依頼する事項:
  - **コミット分割**: 現状は全変更が未コミット。「1つの変更内容 = 1コミット」
    に従い、少なくとも (1) `fix(collector):` 実装＋実装担当の基本テスト、
    (2) `test(collector):` tester による強化テスト、(3) `docs:` worklog・
    PLAN.md・WORKLOG.md 索引、の3コミットに分けること（過去 Issue #124 等の
    分割粒度と同じ）。
  - **任意（非ブロッキング）**: `docs/ARCHITECTURE.md` のロギングプロキシ節は
    `CHAINVIZ_PROXY_PORT` / `CHAINVIZ_PROXY_TARGET` を明記しているため、
    今回新設の `CHAINVIZ_WORKBENCH_RPC_HOST`（動的ワークベンチの RPC 到達
    ホスト上書き）も1行追記すると docs と実装の対応が揃う。現状の記述と
    矛盾はしていないため合否には影響しない。
  - 実機での動作確認（動的ワークベンチ追加 → RPC 発行 → 操作エッジ描画）は
    未実施のため、chainviz-qa の検証が必須。
