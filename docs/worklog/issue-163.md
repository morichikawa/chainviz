### 2026-07-07 Issue #163 runWorkbenchOperationコマンド(transfer/deployContract/callContract)を実装

- 担当: collector
- ブランチ: issue-163-workbench-operations
- 内容: `runWorkbenchOperation`コマンド(transfer/deployContract/callContract)を、
  ワークベンチコンテナ内で`cast`/`forge`を実行する形で実装した。

  - `packages/collector/src/docker/operations.ts`: `DockerOperations`に
    `exec(containerId, cmd: string[]): Promise<ExecResult>`を追加した
    (`ExecResult = { exitCode, stdout, stderr }`)。`cmd`は配列で渡す契約とし、
    シェル文字列連結を行わないことをJSDocに明記した(コマンドインジェクション
    防止。設計時の申し送り事項)。
  - `packages/collector/src/docker/dockerode-operations.ts`: `exec`を
    dockerodeの`container.exec()` → `exec.start({ Tty: false })` →
    `exec.modem.demuxStream()`でstdout/stderrを分離 → `exec.inspect()`で
    終了コードを取得、という流れで実装した。`@types/dockerode`が`Exec.modem`
    を`any`型にしているため、実行時にのみ存在を前提にする最小限の型
    (`ExecModem`)を自前で定義した。
  - `packages/collector/src/adapters/ethereum/workbench-operations.ts`(新規):
    `WorkbenchOperation`をcast/forgeのコマンド列(配列)へ変換する
    `buildOperationCommand`、cast send/forge createの出力から
    トランザクションハッシュ・デプロイ先アドレスを抽出する
    `parseCastTxHash`/`parseForgeTxHash`/`parseForgeDeployedAddress`/
    `parseOperationOutcome`、エラーメッセージ用の`describeOperation`を実装した。
    Docker/dockerodeに依存しない純粋関数群のため、Dockerなしで単体テストできる。
  - `packages/collector/src/adapters/ethereum/node-lifecycle.ts`:
    `EthereumNodeLifecycle`に`runWorkbenchOperation(workbenchId, operation)`を
    追加した。処理の流れは (1) mnemonicが読めなければ即エラー、
    (2) `findWorkbenchContainer`で対象ワークベンチのコンテナIDと
    ウォレット導出インデックスを解決、(3) `buildOperationCommand`で
    コマンド列を組み立てて`DockerOperations.exec`を呼ぶ、
    (4) 終了コードが非0ならstderr(空ならstdout、それも空なら終了コード)を
    含む具体的なエラーをログに残しつつthrowする、(5) 成功時は
    `parseOperationOutcome`の結果(txHash等)を返す、というもの。
  - `findWorkbenchContainer`は、collectorが`addWorkbench`で作成した
    managedワークベンチだけでなく、`docker-compose.yml`の静的な`workbench`
    サービス(managedラベルを持たない)も対象にする必要があったため、
    メモリ上の`this.workbenches`レジストリには頼らず、compose project
    ラベルだけでコンテナを走査してstableId(`<project>/<service>`)の一致で
    絞り込む方式にした。ウォレット導出インデックスもコンテナのラベル
    (`workbenchWalletIndex`。無ければ既定の0)から決めるため、静的
    ワークベンチは自動的にプリマインの先頭アカウントを使うことになる。
  - `packages/collector/src/commands/lifecycle.ts`: `NodeLifecycle`に
    `runWorkbenchOperation`を追加し、その戻り値の型として
    `WorkbenchOperationResult { txHash?; deployedAddress? }`を新設した
    (collector内部のみで完結する型。`packages/shared`の型ではない)。
  - `packages/collector/src/commands/handler.ts`: `runWorkbenchOperation`の
    default節での`ok:false`固定を廃止し、実際に
    `lifecycle.runWorkbenchOperation`を呼ぶ実装に差し替えた。成功時は
    `WorkbenchOperationResult`の内容(txHash/deployedAddress)を
    `console.log`でログに残したうえで`{ ok: true }`を返す。

- 決定事項・注意点:
  - **commandResultの形は変更していない**(`{ ok, error }`のまま)。
    `docs/ARCHITECTURE.md` §3に「コマンドの実行結果(成功・失敗)は既存の
    `commandResult`で返し、実際の反映(txの出現、コントラクトカードの出現)は
    後続の観測 = `diff`で届く」と明記されている設計(既にレビュー・QA済み)に
    従った。`ServerMessage.commandResult`にtxHash等のフィールドを追加する
    ことは`packages/shared`のプロトコル型変更を伴うため、本Issueの範囲外の
    提案に留める(CLAUDE.md「packages/sharedの型定義自体を変更したい場合は
    ……その旨を報告し提案に留める」)。実行結果はcollector側のログ
    (成功時はconsole.log、失敗時はconsole.error)には確実に残るようにした。
  - **deployContractのcontractKeyの扱い**: `WorkbenchOperation.deployContract`
    は`contractKey: string`のみを持ち、コンストラクタ引数を渡すフィールドが
    無い。本Issueでは`contractKey`を`forge create`のCONTRACT引数
    (例: `"src/Counter.sol:Counter"`)としてそのまま渡す汎用的な実装にとどめ、
    カタログキー(例: `"chainviz-token"`)→forgeターゲットの解決は
    コントラクトカタログの読み込みを担う別Issue(#161)の範囲とした
    (`docs/PLAN.md`のcollector欄で#161が「コントラクトカタログの読み込みと
    デプロイ検知・追跡」と定義されている)。
  - **重要な指摘(統括・designer・reviewerへの報告事項)**: 上記の理由により、
    現状の`WorkbenchOperation.deployContract`型ではコンストラクタ引数を
    渡せない。並行実装中の`profiles/ethereum/contracts/ChainvizToken.sol`
    (Issue #158、別worktreeで作業中)はコンストラクタで`initialSupply`を
    要求するため、このコントラクトはGUIの`deployContract`操作では
    デプロイできない(手動`forge create`でのみ可能)。`Counter`は
    コンストラクタ引数が無いため問題ない。`constructorArgs?: string[]`
    のような任意フィールドを`WorkbenchOperation.deployContract`に追加する
    ことを提案するが、`packages/shared`の型変更のため実装はしていない
    (chainviz-designer/chainviz-reviewerとの調整が必要)。
  - **callContractのfunctionNameの扱い**: `cast send`は関数呼び出しの
    エンコードに完全なABIシグネチャ(例: `"transfer(address,uint256)"`)を
    要求する。`WorkbenchOperation.callContract.functionName`をそのまま
    cast へ渡す実装にしたため、呼び出し元(将来のfrontend操作パネルや
    #161/#162のカタログ連携)は関数名ではなくシグネチャ文字列を渡す必要が
    ある。引数(`args`)の型解釈(数値・アドレス等への変換)はカタログのABIを
    使う必要があるとARCHITECTURE.mdに明記されているが、これも#161/#162の
    範囲であり本Issueでは文字列をそのままcastへ渡すだけにとどめた。
  - `forge create`のマウントパスは`--root /contracts`を固定で使っている。
    これは並行作業中のIssue #158(`profiles/ethereum/contracts/`を
    ワークベンチへbind mountする作業。別worktree `chainviz-wt-158`で
    作業中、未マージ)がdocker-compose.ymlで選んだ`working_dir: /contracts`
    / `volumes: ./contracts:/contracts`と一致させた(実装前に該当worktreeの
    作業内容を確認して合わせた)。#158がマージされて実際に`/contracts`が
    存在するようになるまでは、deployContractの実行はコンテナ内に
    `/contracts`が無く失敗する(exec自体は正しく動くが、forgeが
    `foundry.toml`を見つけられずエラーになる)。これは想定内の暫定状態であり、
    本Issueのテストはいずれもコマンド組み立て・exec呼び出しの正しさを
    Dockerをモックして検証しており、実コンテナへの依存は無い。
  - `cast`/`forge`には明示的に`--rpc-url`(ロギングプロキシのURL)を渡す
    実装にした。ワークベンチコンテナの環境変数`ETH_RPC_URL`からも同じ値が
    拾えるため厳密には冗長だが、`profiles/ethereum/README.md`
    (Issue #158で追記されたサンプルコマンド)と同じ書き方に揃え、
    環境変数の設定漏れに対しても頑健にした。
  - `NodeLifecycle.runWorkbenchOperation`の追加に伴い、
    `packages/collector/src/commands/handler.test.ts`の`fakeLifecycle`と
    `packages/collector/src/adapters/ethereum/node-lifecycle.test.ts`の
    `fakeOps`にデフォルトのモック実装を追加した(型エラーで機械的に検出された
    箇所であり、既存テストの意図は変えていない)。
  - `pnpm --filter @chainviz/collector build`・
    `pnpm --filter @chainviz/collector test`(760件、うち新規41件)・
    `pnpm lint`(リポジトリ全体)がいずれも成功することを確認した。
  - `dockerode-operations.test.ts`の「exitCode ?? -1 のフォールバック」の
    回帰テストは、実装側の閾値を意図的に`?? 0`へ壊して当該テストが
    実際に失敗することを確認したうえで元に戻した(CLAUDE.mdの品質ゲート
    運用ルールに従った確認)。

### 2026-07-07 Issue #163 レビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-163-workbench-operations
- 内容: runWorkbenchOperation実装(collector担当)とテスト強化(tester担当)の
  静的レビューを実施した。結果は**条件付き合格**(下記の差し戻し1件を除き
  問題なし)。確認した観点と結果:

  - **コマンドインジェクション対策**: `buildOperationCommand`は
    `WorkbenchOperation`をトークンごとの配列として組み立て、
    `EthereumNodeLifecycle.runWorkbenchOperation`はその配列をそのまま
    `DockerOperations.exec`へ渡し、`dockerode-operations.ts`の実装は
    dockerodeの`Cmd`(配列)へそのまま渡す。経路のどこにもシェル文字列
    連結・シェル起動(`sh -c`等)が無いことをコードで確認した。テストも
    3層(コマンド組み立て単体・lifecycle経由のend-to-end・dockerodeの
    Cmd受け渡し)でシェル特殊文字が単一トークンのまま残ることを固定して
    おり、回帰検出として有効
  - **エラー握りつぶし**: 該当なし。非ゼロ終了時はstderr(空ならstdout、
    それも空なら終了コード)を含む具体的なエラーをconsole.errorに残した
    うえでthrowし、CommandHandlerがそのメッセージをcommandResult.errorへ
    そのまま載せる。exec自体のreject・ストリームエラーも伝播する
    (テストで固定済み)。`parseOperationOutcome`が抽出失敗を例外にしない
    のは「付随情報が取れなかっただけ」という意図がコメントで明示されて
    おり、操作の成否判定(終了コード)とは分離されているため妥当
  - **ChainAdapter境界**: cast/forgeの語彙は
    `adapters/ethereum/workbench-operations.ts`と同`node-lifecycle.ts`に
    閉じている。`commands/lifecycle.ts`・`commands/handler.ts`・
    `packages/shared`にEthereum固有の語彙は無い
  - **テストの質**: 境界値(空stdout・ExitCode null・重複行・CRLF・行頭
    アンカー)・異常系(exec reject・ストリームエラー・コンテナ不在・
    mnemonic欠落)・セキュリティ回帰が揃っており、期待値も実装をなぞる
    だけでなく契約(配列で渡す・エラー内容が伝わる)を固定している
  - **ビルド・テスト**: リポジトリ全体で `pnpm lint` / `pnpm build` /
    `pnpm test`(shared 40・e2e 34・collector 775・frontend 791)が成功

- 判断事項1(constructorArgs): `WorkbenchOperation.deployContract`へ
  `constructorArgs?: string[]` を**追加する判断とし、reviewerが
  `packages/shared/src/protocol/index.ts`の型変更を実施した**。理由:
  (1) `docs/ARCHITECTURE.md` §6.5はデプロイタブの選択肢として
  ChainvizTokenを明記しており、ChainvizToken(Issue #158)はコンストラクタで
  initialSupplyを要求するため、現状の型では`docs/PLAN.md`ステップ8の
  完了条件(GUIからのサンプルコントラクトのデプロイ)をChainvizTokenで
  満たせない。(2) 任意フィールドのため既存のcollector/frontendのビルドを
  壊さない(型変更後にリポジトリ全体のbuild/test/lintが通ることを確認済み)。
  (3) 命名・形式(文字列配列、型解釈はアダプタ側)は既存の
  `callContract.args`と一貫しており、チェーン固有語彙の漏れにもあたらない。
  **差し戻し(collector担当への追加作業)**:
  - `workbench-operations.ts`の`buildOperationCommand`で、
    `constructorArgs`が指定された場合に`forge create`へ
    `--constructor-args <args...>`として渡す実装と、そのテスト
    (指定あり・なし・シェル特殊文字の回帰)を追加すること
  - `docs/ARCHITECTURE.md` §3の`WorkbenchOperation`型スニペットに
    `constructorArgs?: string[]`を反映すること(sync-docs)
- 判断事項2(callContract.functionName): ABIを介さず完全なシグネチャ文字列
  (例: `transfer(address,uint256)`)をcast sendへ渡すスコープ分割は
  **妥当と判断**。ARCHITECTURE.md §6.5では関数フォーム定義(シグネチャを
  含むUI組み立て情報)をフロントの表現セット
  (`packages/frontend/src/chain-profiles/ethereum/`)が持つ設計であり、
  チェーン固有語彙の解釈を表現セットが担う既存の責務分担に沿う。
  ABI復号は#161/#162の範囲でよい
- 非ブロッキングの指摘(次の担当・統括への申し送り。今回の合否には影響
  させない):
  - `findWorkbenchContainer`はcompose projectラベルとstableIdの一致だけで
    コンテナを解決するため、ワークベンチ以外のサービス(例:
    `chainviz-ethereum/reth-a`)をworkbenchIdに指定してもexecが試みられる
    (cast/forgeが無いため実際は失敗し、エラーは正しく伝播する)。静的
    ワークベンチがcom.chainvizラベルを持たない以上ラベルだけでの厳密な
    判別は不可能だが、少なくとも`com.chainviz.role`ラベルを持つコンテナに
    ついては値が`workbench`であることを検証する部分的なガードは追加できる。
    改善の余地として記録する
  - `node-lifecycle.test.ts`の「falls back to stdout, then the bare exit
    code」テストはconsole.errorをspyしていないため、テスト実行ログに
    エラー出力が漏れる(他の失敗系テストはspyしている)。挙動には影響しない
  - ARCHITECTURE.md §6.5のデプロイタブUXにはコンストラクタ引数の入力・
    既定値の扱いが未定義。ChainvizTokenのinitialSupplyをフロントの
    フォーム定義データの既定値とするか入力欄を設けるかは、後続の
    frontend実装(操作パネル)前にUX側で決める必要がある
  - 本レビュー時点でブランチは未コミット。コミット時は関心事ごとに
    分割すること(目安: DockerOperations.exec追加 / workbench-operations
    新設とlifecycle・handler配線 / sharedの型追加とconstructorArgs実装 /
    docs更新)

### 2026-07-07 Issue #163 差し戻し対応: constructorArgsの実装(collector)

- 担当: collector
- ブランチ: issue-163-workbench-operations
- 内容: reviewerからの差し戻し(上記「判断事項1」の追加作業)に対応した。

  - `packages/collector/src/adapters/ethereum/workbench-operations.ts`の
    `buildOperationCommand`の`deployContract`ケースで、
    `operation.constructorArgs`が指定されている場合に`forge create`へ
    `--constructor-args <各要素>`をトークンごとに展開して渡すよう実装した。
    未指定(`undefined`)の場合は従来どおり何も付与しない。
  - **`forge create`のコマンド列内での`contractKey`(CONTRACT位置引数)の
    位置を変更した**: 従来はコマンド列の末尾に置いていたが、
    `--constructor-args`はFoundry(clap)側で値をいくつでも貪欲に取り込む
    可変長オプションのため、`--constructor-args`より後ろに他の位置引数や
    フラグを置くと誤って`--constructor-args`の値として取り込まれてしまう
    危険がある。Foundry公式のサンプル(`forge create <CONTRACT>
    --constructor-args ... --rpc-url ...`のように、CONTRACTを先頭・
    `--constructor-args`を可変長オプションとして最後に置く書き方)に倣い、
    `contractKey`を`"forge" "create"`の直後(先頭の位置引数)に、
    `--constructor-args <args...>`をコマンド列の最後に置く順序へ変更した。
    これに伴い、既存の`buildOperationCommand`のテスト
    (`workbench-operations.test.ts`)と、lifecycle経由のend-to-endテスト
    (`node-lifecycle.test.ts`の「builds the correct forge create command for
    deployContract」)の期待値(コマンド列の順序)を新しい順序に合わせて
    更新した。挙動としては同じコマンドが実行される(forgeはオプションの
    順序に依存しない)ため、`constructorArgs`が無い既存の呼び出しの実際の
    動作には影響しない。
  - テストを追加した:
    - `workbench-operations.test.ts`:
      `constructorArgs`未指定時に`--constructor-args`が付与されないこと、
      単一の`constructorArgs`が正しく末尾に付与されること、複数の
      `constructorArgs`が順序どおり渡されること、`constructorArgs`の値に
      シェル特殊文字(`; | & `command` $(cmd)`)を含めても他の引数と同様に
      単一トークンのまま(シェル文字列に連結されない)ことを検証する回帰
      テストを追加した。
    - `node-lifecycle.test.ts`: `runWorkbenchOperation`経由で
      `constructorArgs`付きの`deployContract`を渡した際に、実際に
      `DockerOperations.exec`へ渡されるコマンド列の末尾が
      `--constructor-args <値>`になることを確認するテストを追加した。
  - `docs/ARCHITECTURE.md` §3の`WorkbenchOperation`型スニペットに
    `constructorArgs?: string[]`を追記した(`packages/shared`の実装済みの
    型と一致させた。sync-docs)。
  - `pnpm --filter @chainviz/collector build`・
    `pnpm --filter @chainviz/collector test`(780件、既存の順序変更に伴う
    修正2件+新規6件)がいずれも成功することを確認した。

- 次の担当(reviewer)への申し送り:
  - 既存の`buildOperationCommand`のテストのうち、`deployContract`の
    コマンド列の順序を検証している箇所(contractKeyの位置)を変更した。
    差分を確認する際は「順序が変わっただけで、渡す引数の集合自体は
    従来と変わっていない」ことに注意。
  - reviewerからの非ブロッキングの申し送り事項(`findWorkbenchContainer`の
    stableId一致のみでの解決、`node-lifecycle.test.ts`の
    console.errorスパイ漏れ)は今回は対応していない(完了条件外・時間の
    都合による任意対応のため)。

### 2026-07-07 Issue #163 再レビュー: constructorArgs差し戻し対応の確認(reviewer)

- 担当: reviewer
- ブランチ: issue-163-workbench-operations
- 内容: 差し戻し(constructorArgsの`forge create`対応)の再レビューを実施した。
  結果は**合格**。確認した観点と結果:

  - **`forge create`の仕様との整合(実測で確認)**: ghcr.io/foundry-rs/foundry:latest
    の`forge create --help`で `Usage: forge create [OPTIONS] <CONTRACT>` /
    `--constructor-args <ARGS>...`(可変長)であることを確認した。さらに
    CLIのパース挙動を実測し、
    (1) 旧配置(`--constructor-args 100 src/Counter.sol:Counter`のように
    CONTRACT位置引数を`--constructor-args`より後ろに置く)では、位置引数が
    可変長オプションの値として貪欲に取り込まれ、
    `error: the following required arguments were not provided: <CONTRACT>`
    でパースに失敗すること、
    (2) 新配置(`forge create <CONTRACT> --root ... --rpc-url ... --broadcast
    --constructor-args <args...>`)では正しくパースを通過すること
    (ダミーRPC URLへの接続エラーまで到達)を確認した。collectorの報告どおり、
    コマンド列の構造変更(contractKeyを`create`直後、`--constructor-args`を
    末尾)は貪欲な取り込み問題を実際に解消している
  - **constructorArgs無しの既存動作への影響**: 引数の集合は従来と同一で、
    順序のみの変更(位置引数を前へ)。clapは位置引数がオプションの前に来る
    ことを許容するため影響なし。`node-lifecycle.test.ts`の「builds the
    correct forge create command for deployContract」がコマンド列全体を
    完全一致で固定しており、回帰も検出できる
  - **追加テストの検出力**: `workbench-operations.test.ts`の単一/複数
    constructorArgsのテストはコマンド列全体を`toEqual`(完全一致・順序込み)
    で固定しているため、`--constructor-args`が末尾以外へ移動した場合や
    contractKeyが`--constructor-args`より後ろへ戻った場合に確実に失敗する。
    `slice(-4)`による「末尾に置かれること」の直接検証、シェル特殊文字が
    単一トークンのまま残る回帰、lifecycle経由で実際に`DockerOperations.exec`
    へ渡るコマンド列の完全一致検証も揃っており、今回の問題(貪欲な可変長
    オプション)に対する回帰テストとして有効
  - **docsとの整合**: `docs/ARCHITECTURE.md` §3の`WorkbenchOperation`型
    スニペットが`packages/shared/src/protocol/index.ts`の実装と一致している
  - **ビルド・テスト**: リポジトリ全体で `pnpm lint` / `pnpm build` /
    `pnpm test`(shared 40・e2e 34・collector 780・frontend 791)がすべて成功

- 非ブロッキングの申し送り(合否には影響させない):
  - `--constructor-args`の値が`-`で始まる場合(負数等)は、clapが未知の
    フラグと解釈してforge側でパースエラーになる可能性がある(Foundry CLI
    自体の制約であり、コマンド組み立て側では解消できない)。エラーは
    stderr→commandResult.errorへ正しく伝播するため実害は限定的だが、
    将来カタログに負数のコンストラクタ引数を持つコントラクトを載せる
    場合は`--constructor-args-path`等の代替を検討すること
  - 前回レビューの非ブロッキング指摘(`findWorkbenchContainer`の部分的
    ガード、`node-lifecycle.test.ts`のconsole.errorスパイ漏れ)は未対応の
    まま(任意対応のため今回も合否に影響させない)
  - ブランチは依然として未コミット。コミット時は前回指摘どおり関心事
    ごとに分割すること(目安: DockerOperations.exec追加 /
    workbench-operations新設とlifecycle・handler配線 / sharedの型追加と
    constructorArgs実装 / docs更新)

### 2026-07-07 Issue #163 QA検証(合格)

- 担当: qa
- ブランチ: issue-163-workbench-operations
- 検証方法: 本物の稼働中スタック(既存の`chainviz-ethereum_*`ボリューム)に
  一切触れないため、独立プロジェクト名`chainviz-qa163`の合成環境を作って
  検証した。具体的には、main(Issue #158のサンプルコントラクトとdocker-compose.ymlの
  `/contracts`マウント、Issue #160を含む)を基点にした使い捨てworktreeへ、
  本ブランチの未コミットのcollector/sharedのコード変更を重ねて(mainの11コミットと
  #163の変更ファイルはコード上重複しないことを確認済み)、compose project名と
  collector側のcomposeProject/volume/network既定値を`chainviz-qa163`へ変更した
  隔離環境で実行した。collectorはポート4100(WS)/4101(proxy)で起動。
  検証後はスタックを`docker compose down -v`で破棄、worktreeを削除し、
  ユーザーの`chainviz-ethereum_*`ボリューム10個が無傷であることを確認した。
- コマンド送信: 既存のClientMessage(`{type:"command", commandId, command}`)を
  WebSocket経由で送り、`commandResult`を受け取る簡易クライアントで実行した。
- 検証結果(完了条件との対応):
  - **transfer**: ワークベンチ(`chainviz-qa163/workbench`、プリマイン
    アカウント`0x2BB7…d4c0`)から`0x…dEaD`へ1 ETHを送金。`commandResult.ok=true`、
    受取アドレス残高が0→1e18 wei、送信元nonceが0→1、collectorログにtxハッシュが
    記録され、RPC呼び出しがロギングプロキシ(172.28.0.3=workbench)を経由することを
    確認した。
  - **deployContract(constructorArgsあり)**: ChainvizToken
    (`src/ChainvizToken.sol:ChainvizToken`)を`constructorArgs:["1000000000000000000000"]`
    でデプロイ。`ok=true`、deployed to `0xc07C…70f1`。`cast code`でコードが
    存在(8173文字)、`totalSupply()`と`balanceOf(deployer)`がいずれも1e21
    (=指定したinitialSupply)であることを確認し、constructorArgsが実際に
    forge createへ渡って効いていることを実証した(reviewerの差し戻しで追加された
    検証ポイント)。
  - **deployContract(constructorArgsなし)**: Counter(`src/Counter.sol:Counter`)を
    引数なしでデプロイ。`ok=true`、deployed to `0x95df…EBc2`。
  - **callContract**: 上記CounterのincrementをfunctionName`"increment()"`,
    `args:[]`で呼び出し。`ok=true`、`count()`が0→1に変化することを確認した。
  - **失敗時の具体的なエラー**:
    - 存在しないワークベンチID(`chainviz-qa163/nope`): `ok=false`,
      error=`"workbench chainviz-qa163/nope not found"`。
    - 不正な送金先アドレス(`not-an-address`): `ok=false`、castの実エラー
      (`invalid value 'not-an-address' for '[TO]': invalid string length`)を
      操作説明・ワークベンチID付きで返す。
    - 存在しないコントラクト(`src/Nope.sol:Nope`): `ok=false`、forgeの実エラー
      (`"/contracts/src/Nope.sol": No such file or directory`)を返す。
    いずれも汎用メッセージへのすり替えではなく、原因が特定できる具体的な
    エラーが返ることを確認した。
- 静的確認: 本ブランチ(未改変)で`pnpm lint`・`pnpm build`・`pnpm test`
  (collector 780・frontend 791、いずれもpass)がすべて通ることを確認した。
- 判定: **合格**。`docs/PLAN.md`ステップ8の#163完了条件(transfer/deployContract/
  constructorArgs付きデプロイ/callContract/失敗時の具体的なエラー)をすべて満たす。
- 申し送り: 本ブランチはmainより11コミット遅れており、#158のサンプルコントラクトと
  docker-compose.ymlの`/contracts`マウント(ともにmain済み)を含まない。deployContractは
  コンテナ内`/contracts`の存在に依存するため、マージ前にmainを取り込む(または
  マージ後の状態にする)必要がある。上記QAはmain取り込み後相当の合成環境で
  実施しており、マージ後の実環境で動作することを確認済み。
