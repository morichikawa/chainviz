### 2026-07-07 Issue #158 サンプルコントラクト(ChainvizToken/Counter)のFoundryプロジェクト追加

- 担当: node-env
- ブランチ: issue-158-sample-contracts
- 内容: Phase 4(C層拡張)のコントラクトカタログ(`docs/ARCHITECTURE.md` §4)
  で決めたサンプルコントラクト一式を追加した。
  - `profiles/ethereum/contracts/foundry.toml`: `src`/`out`/`lib` の標準構成。
    `solc_version = "0.8.24"` を固定し、forge(svm)が初回ビルド時に自動
    ダウンロードする(ワークベンチイメージに solc は同梱されていない)。
  - `profiles/ethereum/contracts/src/ChainvizToken.sol`: 外部ライブラリ
    (OpenZeppelin 等)に依存しない自己完結の最小 ERC20。`name`(Chainviz
    Token)/`symbol`(CVZ)/`decimals`(18)を持ち、`transfer`/`approve`/
    `transferFrom`と`Transfer`/`Approval`イベントを実装。コンストラクタ引数
    `initialSupply`でデプロイ時供給、加えてデプロイヤー限定の
    `mint(address,uint256)`で任意アカウントへの追加供給に対応する
    (genesisプリマインアカウントへの供給にも使える)。
  - `profiles/ethereum/contracts/src/Counter.sol`: `increment()`/
    `incrementBy(uint256)`で`count`を変更し`Incremented`イベントを、
    `reset()`で`Reset`イベントを出す最小コントラクト。
  - `profiles/ethereum/docker-compose.yml`: `workbench`サービスに
    `./contracts:/contracts`のvolumeマウントと`working_dir: /contracts`を
    追加。
  - `profiles/ethereum/README.md`: 「サンプルコントラクト」節を新設し、
    構成・各コントラクトの役割・ワークベンチ内でのビルド/デプロイ手順
    (`forge build`/`forge create`の実例)を追記。
  - `.gitignore`: `profiles/*/contracts/{out,cache,lib}/`を追加(ビルド
    成果物はコミットしない。ソースと将来追加するcatalog.jsonのみコミット
    対象)。
  - `docs/PLAN.md`: ステップ8の該当チェックボックスにチェック。
- 実機確認(独立した合成環境。`docker compose -p chainviz-eth-test158`で
  スクラッチ領域にコピーしたprofileを起動し、本物の稼働中スタックには
  触れずに実施):
  1. `forge build`がワークベンチコンテナ内(マウント経由)で成功すること
     (solc 0.8.24を自動ダウンロードしてコンパイル成功)。
  2. チェーンがブロックを進め続けること(`cast block-number`で確認)。
  3. `forge create`でChainvizToken(初期供給100万CVZ)とCounterを
     genesisプリマインアカウント(`EL_AND_CL_MNEMONIC`のindex 0)から
     デプロイできること。
  4. デプロイ後、`name`/`symbol`/`decimals`/`totalSupply`/`balanceOf`が
     期待どおりであること。`transfer`が成功し`Transfer`イベントが
     ログに乗ること。デプロイヤー限定`mint`が成功する一方、非デプロイヤー
     からの`mint`は`ChainvizToken: caller is not the owner`でrevertする
     こと。
  5. Counterの`increment()`/`incrementBy(uint256)`が成功し、`count`の
     更新と`Incremented`イベントのログを確認。
  6. 確認後`docker compose down -v`でテスト用スタック・スクラッチ領域を
     破棄。
- 決定事項・注意点:
  - `catalog.json`と`build-catalog.sh`はこのIssueの範囲外(Issue #159で
    追加)。このIssueでは`contracts/`にソースとFoundry設定のみを置く。
  - 環境起動時の自動デプロイは行わない設計のまま
    (`docs/ARCHITECTURE.md` §4の決定どおり)。デプロイは手動の
    `forge create`または将来実装される`runWorkbenchOperation`の
    `deployContract`で行う。
  - `contracts/`はrwでbind mountしているため、ワークベンチ内で
    `forge build`すると`out/`・`cache/`がホスト側にも書き戻る。
    `.gitignore`で除外済みなので、通常の`git status`には出てこない。
  - `forge build`はネットワーク経由でsolcバイナリをダウンロードする
    (svmのキャッシュが無い初回のみ)。完全オフライン環境では初回の
    `forge build`が失敗する点に注意(このIssueの実機確認環境では
    ダウンロードが成功することを確認済み)。
  - ChainvizTokenの`mint`はデプロイヤー(`owner`。immutable、コンストラクタ
    実行時のmsg.sender)限定。ロール管理ライブラリ(AccessControl等)は
    使わず、シンプルな`onlyOwner`修飾子で自己完結させている。

#### レビュー(chainviz-reviewer)

- 判定: **合格**
- 確認内容:
  - `ChainvizToken.sol`: 標準ERC20インターフェース(name/symbol/decimals/
    totalSupply/balanceOf/transfer/approve/transferFrom/allowance、
    Transfer/Approvalイベント)がすべて実装されていることをソースと生成ABIの
    両方で確認。`mint`は`onlyOwner`(immutableな`owner`=デプロイヤー)限定で
    アクセス制御は正しい。ゼロアドレス宛のtransfer/mint拒否、残高・allowance
    不足時の具体的なエラーメッセージ付きrevert、無限allowance
    (type(uint256).max)の減算スキップも適切
  - `Counter.sol`: `increment()`/`incrementBy(uint256)`/`reset()`と
    `Incremented`/`Reset`イベント(callerはindexed)を持ち、#159(カタログ生成)・
    #162(呼び出し・イベント復号)に必要な関数シグネチャ・イベント定義として十分
  - コンパイル検証: scratchpad にコピーした contracts/ を
    `ghcr.io/foundry-rs/foundry:latest`(ローカル既存イメージ)の`forge build`で
    コンパイルし、solc 0.8.24 で警告なく成功することを静的に確認
  - `docker-compose.yml`: workbenchサービスには従来volumes/working_dirの指定が
    無く、`./contracts:/contracts`+`working_dir: /contracts`の追加は既存構成
    (env_file/extra_hosts/environment)と衝突しない。ARCHITECTURE.md §4の
    「bind mount」の決定どおり
  - `.gitignore`: `git check-ignore`でout/cache/libが除外され、src/・
    foundry.tomlは除外されないことを実測確認
  - `README.md`: コマンド例はcompose定義の環境変数(ETH_RPC_URL、
    EL_AND_CL_MNEMONIC)と整合。既存節の文体・参照スタイルとも一致
  - `foundry.toml`のsolc_version固定(0.8.24)は「固定値の前提条件を
    コメントとworklogに明記する」ルールに従い、pragma下限との対応が
    両方に記載されている
  - リポジトリ全体の`pnpm lint`/`pnpm build`/`pnpm test`(791件)がすべて通過
  - ARCHITECTURE.md §4との齟齬なし(catalog.json/build-catalog.shは#159の
    範囲として明示的に除外されており、READMEにもその旨の記載あり)
- 注意点(差し戻しではない):
  - レビュー時点で変更は未コミット。コミット時は「1つの変更内容=1コミット」に
    従い、少なくとも contracts一式+composeマウント+README(node-env実装)、
    .gitignore、docs(PLAN/WORKLOG/worklog) 程度の関心事の分離を推奨
  - 実機での forge build/デプロイ・イベント確認は chainviz-qa の検証に委ねる

#### QA検証(chainviz-qa)

- 判定: **合格**
- 検証環境: 独立した合成環境。worktree(`/home/zoe/workspace/chainviz-wt-158`)
  の`profiles/ethereum`を`docker compose -p chainviz-qa-158 up -d`で起動。
  本物の稼働中スタックには一切触れず、検証後に`down -v`でコンテナ・
  ボリューム・ネットワークを完全に破棄し、host側に書き戻ったビルド成果物
  (out/・cache/。いずれもgitignore対象)も削除してworktreeを元の状態に戻した。
- 確認結果(完了条件との対応):
  1. `contracts/`のFoundryプロジェクトがworkbenchにマウントされている:
     `docker inspect`で`.../contracts -> /contracts (bind)`を確認。
     コンテナ内`forge build`がhost側`contracts/out/`に成果物を書き戻す
     ことでもbind mountを実証。
  2. チェーンが起動しブロックが進行: `cast block-number`が5→13と増加。
  3. workbenchコンテナ内`forge build`成功: solc 0.8.24で2ファイルを警告なく
     コンパイル(`Compiler run successful!`)。
  4. `forge create`でデプロイ成功: ChainvizToken(initialSupply=1,000,000 CVZ)と
     Counterを、genesisプリマインアカウント(EL_AND_CL_MNEMONIC index 0、
     0x2BB7DcEe...)からデプロイ。
  5. ChainvizTokenのメタ情報確認: name="Chainviz Token"、symbol="CVZ"、
     decimals=18、totalSupply=1e24(=1,000,000e18)、balanceOf(deployer)=1e24。
     いずれも期待どおり。
  6. transfer検証: 1,000 CVZを別アドレスへtransfer→status=1(成功)、receiptに
     Transferイベント(topic0=keccak("Transfer(address,address,uint256)")、
     from=deployer/to=宛先がindexed、data=1000e18)を確認。宛先balanceOf=1000e18。
  7. Counter検証: `count`初期値0。`increment()`で0→1、`incrementBy(5)`で1→6、
     再度`increment()`で6→7と状態が変化。各txのreceiptにIncrementedイベント
     (topic0=keccak("Incremented(address,uint256)")、topic1=caller=deployer、
     data=newCount)を確認。
- 注意点(差し戻しではない・情報共有):
  - workbenchの既定`ETH_RPC_URL`はロギングプロキシ(collector、host:4001)を
    指すが、本Issueの検証範囲(コントラクトのビルド/デプロイ/挙動)では
    collectorは対象外のため、cast/forgeは`--rpc-url http://reth1:8545`で
    reth1に直接向けて検証した。プロキシ経由の疎通確認はcollector側Issueの範囲。
  - 実装未コミットのため`contracts/`ディレクトリ全体がgit未追跡(`??`)。
    コミット時はout/cache/libを含めずsrc/・foundry.tomlのみをaddすること
    (out/はgitignore済みであることを`git check-ignore`で確認済み)。
