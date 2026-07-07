### 2026-07-07 Issue #159 コントラクトカタログ(catalog.json)と再生成スクリプト(build-catalog.sh)の追加

- 担当: node-env
- ブランチ: issue-159-contract-catalog
- 内容: Issue #158 で追加した Foundry プロジェクト(ChainvizToken/Counter)
  から、`docs/ARCHITECTURE.md` §4「コントラクトカタログ」で決めたデータ
  ファイル一式を追加した。
  - `profiles/ethereum/contracts/catalog.json`: `forge build` の成果物
    (`out/<Name>.sol/<Name>.json`)の `.abi` フィールドをそのまま抽出した
    データファイル。コントラクト名(`ChainvizToken`/`Counter`)をキーにし、
    各エントリは `{ name, abi, token? }`。`name` は表示名、`abi` は
    viem の `decodeFunctionData`/`decodeEventLog` にそのまま渡せる標準の
    ABI JSON 配列、`token` は ERC20 系のみ持つ `{ symbol, decimals }`
    (`packages/shared` の `ContractEntity.token` と同じ形)。カタログキーは
    Solidity のコントラクト名をそのまま使う(kebab-case 等への変換ロジックを
    書くと変換ミスの余地が生まれるため、forge の出力パスと完全に一致する
    値を単一の真実の情報源にした)。
  - `profiles/ethereum/contracts/build-catalog.sh`: `catalog.json` の
    再生成スクリプト。`forge build` → `out/` 配下の ABI JSON を `jq` で
    読み取り → `catalog.json` を作り直す。`forge` がローカルに無い場合は
    `docker-compose.yml` の `workbench` と同じ `ghcr.io/foundry-rs/foundry`
    イメージを docker 経由で使うフォールバックを入れた(`foundry.toml` が
    `solc_version` を固定しているため、どちらの経路でビルドしても同じ ABI
    になることを実機で確認済み。下記参照)。`jq` が無ければエラーで停止する
    (jq 自体は docker では持たせず、ホスト側に必要な前提とした。理由は
    「実機確認」参照)。ChainvizToken の `token.symbol`/`token.decimals` は
    ABI から機械的に導出できない(constant の値であって関数シグネチャでは
    ないため)ので、スクリプト内にコメント付きで手動で対応させている。
  - `profiles/ethereum/README.md`: 「サンプルコントラクト」節に
    `catalog.json`/`build-catalog.sh` の説明と、「コントラクトカタログの
    再生成」小節(使い方)を追加。Issue #158 時点で「別Issueで追加する」と
    書いていた forward reference を実体の説明に置き換えた。
  - `docs/PLAN.md`: ステップ8の該当チェックボックスにチェック。
- 決定事項・注意点:
  - **catalog.json はコミットする成果物**(実行時生成にしない)。
    `docs/ARCHITECTURE.md` §4 に明記された決定事項どおり。ABI はソースが
    決まれば決定的でコンパイル時刻に依存しないため、コミットして差分
    レビューできる方が安全という判断(CLAUDE.md「データとコードの分離」の
    延長)。`profile.default` の `solc_version` を固定していることも、この
    決定的性質を支える前提(`foundry.toml` 参照)。
  - `build-catalog.sh` はホスト側で使う開発用スクリプト(`generate-genesis.sh`
    のようなコンテナのエントリポイントではなく、`restart-node.sh` と同じ
    位置づけ)。`profiles/ethereum/contracts` ディレクトリで実行する想定
    (`docker compose exec workbench` 経由の実行は想定していない。workbench
    イメージには `jq` が入っていないため)。
  - jq が無い場合の代替として docker 経由の jq イメージ等を検討したが、
    「forge が無ければ docker、jq が無ければ即エラー」という非対称な設計に
    した。理由: forge は特定バージョンの solc 込みで重い依存(初回ダウンロード
    が伴う)ため docker フォールバックを用意する価値が大きい一方、jq は
    一般的な開発ツールとして広く入っており、無い場合はエラーメッセージで
    素直にインストールを促す方がスクリプトの複雑度に見合う。
- 実機確認(独立した合成環境。実際に動いているスタックには触れていない):
  - `profiles/ethereum/contracts/` を一時ディレクトリへコピーし、
    `docker run --rm -v <dir>:/contracts -w /contracts ghcr.io/foundry-rs/foundry:latest forge build`
    で実際にビルドできること、`out/<Name>.sol/<Name>.json` に標準の
    `abi` フィールドが入ることを確認した。
  - ホスト(このセッションの実行環境)には `forge` も `jq` も入っていない
    状態で `build-catalog.sh` を実行し、(1) forge 未検出 → docker
    フォールバックでビルド成功、(2) jq 未検出 → エラーメッセージを出して
    exit 1 で停止、の両方を確認した(握りつぶさず明示的に停止することを
    確認)。
  - `ghcr.io/foundry-rs/foundry:latest` イメージ上で `--user root` かつ
    `apt-get install -y jq` した使い捨てコンテナ内で `build-catalog.sh` を
    最初から最後まで実行し、`catalog.json` が生成されることを確認した。
    生成結果(`ChainvizToken`/`Counter` の2エントリ、ABI・token メタ情報)を
    目視で検証し、`jq -e '.'` で有効な JSON であることも確認した。
  - 同じ入力から `build-catalog.sh` を2回実行し、生成される `catalog.json`
    が完全に同一(バイト単位で diff なし)であることを確認した(冪等性・
    決定性の確認)。
  - 上記の手順で生成した `catalog.json` を実際に
    `profiles/ethereum/contracts/catalog.json` としてコミット対象に配置した
    (このファイル自体は本 Issue の作業ディレクトリ上で `docker compose up`
    している稼働中スタックとは無関係な、独立した使い捨てコンテナで生成した
    ものであり、稼働中スタックには一切触れていない)。
- 次の担当への注意点:
  - Issue #161(デプロイ検知・カタログ読み込み)は `catalog.json` を
    コントラクト名キーで読み、`ContractEntity.catalogKey` にそのまま
    そのキーを入れる想定。`name` フィールドを表示名として、`token` が
    あればトークンとして扱う。
  - Issue #162(呼び出し・イベント復号)は `catalog.json` の `abi` を
    そのまま viem の `decodeFunctionData`/`decodeEventLog` に渡せる。
  - `src/` 配下のコントラクトを追加・変更したら、必ず
    `./build-catalog.sh` を再実行して `catalog.json` の差分をコミットに
    含めること(自動化はしていない。CIも回さない方針のため)。

### 2026-07-07 Issue #159 レビュー(chainviz-reviewer)

- 担当: reviewer
- 判定: **合格**(ブロッキングな指摘なし)
- 確認内容:
  - **catalog.json のフォーマット整合**: トップレベルがカタログキー
    (Solidity コントラクト名)→ `{ name, abi, token? }` のマップで、
    `packages/shared/src/world-state/entities.ts` の `ContractEntity`
    (`name?: string` / `catalogKey?: string` / `token?: { symbol: string;
    decimals: number }`)へそのまま写像できる。`token.decimals` は数値型
    (18)で型と一致。ABI はカタログ(アダプタが読むデータファイル)側に
    閉じており、shared / frontend にチェーン固有語彙は漏れていない
    (ChainAdapter 境界を維持)。後続 #161(キー→catalogKey、name→表示名、
    token→トークン扱い)・#162(abi を viem の decodeFunctionData /
    decodeEventLog に直接渡す)はこの形をそのまま使える
  - **コミット判断**: `docs/ARCHITECTURE.md` §4 に「ソース(src/)と
    catalog.json は両方コミットする」と明記されており、コミット対象と
    した解釈は正しい。`out/` / `cache/` / `lib/` はルート `.gitignore` で
    除外済みであることも確認
  - **ABI の内容**: catalog.json の全エントリを Issue #158 のソースと
    突き合わせた。ChainvizToken は constructor(initialSupply)・
    transfer/approve/transferFrom/mint と public 変数のゲッター
    (name/symbol/decimals/totalSupply/owner/balanceOf/allowance)・
    Transfer/Approval イベント(indexed 指定含む)がすべて一致。Counter は
    count/increment/incrementBy/reset と Incremented(caller indexed,
    newCount)/Reset(caller indexed) がすべて一致。token メタ
    (symbol="CVZ"/decimals=18)もソースの定数と一致
  - **build-catalog.sh の品質**: `#!/bin/sh` + 先頭コメントで前提・役割を
    説明する既存 scripts/ の流儀に一致。forge 未検出→docker フォールバック、
    docker も無ければ具体的メッセージで exit 1、jq 未検出も exit 1、
    ABI JSON が見つからない場合も原因候補を添えて exit 1 と、エラーの
    握りつぶしは無い。`set -e` + mktemp + trap による一時ファイル管理も
    適切。環境の現在状態に依存する決め打ち定数(タイムアウト等)も無い
  - **再現性・冪等性(静的観点)**: `foundry.toml` の `solc_version = "0.8.24"`
    固定と `jq -S`(キーの決定的ソート)により、ローカル forge / docker の
    どちらの経路でも決定的な出力になる設計。実装担当の「2回実行で
    バイト単位同一」の報告と整合する。docker イメージタグが `:latest` で
    あるのは docker-compose.yml の workbench と同じ既存方針であり、ABI の
    決定性は solc バージョン固定側で担保されているため許容
  - **docs との齟齬**: README.md の追記内容は ARCHITECTURE.md §4 の記述
    (両方コミット・再生成タイミング・collector の読み込み)と矛盾なし
  - `pnpm lint` / `pnpm build` / `pnpm -r test`(shared 40 / collector 743 /
    frontend 791 / e2e 34)すべて合格(exit 0 を確認)
- 指摘なしの観察事項(非ブロッキング。対応は任意):
  - jq の存在チェックが forge build の後にあるため、jq 欠落時はビルド分の
    時間が無駄になる(停止自体は正しく行われる)。チェックを先頭に移すと
    親切
  - `jq '.abi'` は `.abi` キーが無い場合に null を返して続行する
    (`jq -e '.abi'` なら set -e で停止する)。forge の出力スキーマが
    変わらない限り顕在化せず、仮に null が混入しても #161/#162 の読み込み
    側で失敗が表面化するため許容
  - docker フォールバックでビルドすると Linux では `out/` が root 所有に
    なり、後からローカル forge に切り替えた際に権限エラーになり得る
    (workbench コンテナ経由ビルドと同じ既知の性質。out/ は gitignore 済み)
- 統括への申し送り:
  - 変更は未コミットのため、コミット粒度は未レビュー。コミット時は
    関心事ごと(実装: catalog.json + build-catalog.sh + README / 進捗・
    記録: PLAN.md + WORKLOG.md + worklog)に分割すること
  - 実機での再生成・冪等性の再確認(docker フォールバック経路の実行)は
    chainviz-qa に委ねる

### 2026-07-07 Issue #159 QA検証(chainviz-qa)

- 担当: qa
- 判定: **合格**(完了条件をすべて満たす)
- 検証環境: worktree `/home/zoe/workspace/chainviz-wt-159`(ブランチ
  issue-159-contract-catalog)。稼働中のスタックには一切触れず、独立して
  再現・検証した。ホストには forge / jq が未インストールだったため、
  build-catalog.sh の docker フォールバック(`ghcr.io/foundry-rs/foundry:latest`)
  でビルドし、jq は検証用に静的バイナリ(jq 1.7.1)をスクラッチパッドへ
  用意して PATH に通して実行した(プロジェクトには何も追加していない)。
- 検証手順と結果:
  1. **再生成の再現**: 既存の `catalog.json` を退避(リネーム)し、`out/` を
     消したうえで `./build-catalog.sh` を実行。forge 未検出 → docker
     フォールバックでビルド成功、ChainvizToken/Counter の2エントリを
     追記して `catalog.json` を再生成、exit 0 で完了することを確認した。
  2. **退避ファイルとの一致**: 再生成された `catalog.json` は退避した
     元ファイルとバイト単位で完全一致(`diff` で差分なし、どちらも7646バイト)。
     冪等・決定的に再生成できることを独立に再確認した。
  3. **ABI の実用性(viem)**: `packages/collector` の viem(2.54.2)を使い、
     catalog.json の ABI 配列を実際に以下へ渡して動作を確認した。
     - ChainvizToken: `transfer(address,uint256)` を encodeFunctionData →
       decodeFunctionData でラウンドトリップ(関数名・引数が復元される)、
       `Transfer(from,to,value)` を encodeEventTopics/encodeAbiParameters →
       decodeEventLog で復号(indexed の from/to と非 indexed の value を復元)。
     - Counter: `incrementBy(uint256)` の decodeFunctionData、
       `Incremented(caller,newCount)` の decodeEventLog を確認。
     - `getAbiItem` で approve/Approval/Reset 等の関数・イベント定義が
       引けることも確認。ABI が標準の ABI JSON 形式として関数呼び出し・
       イベントログの復号に使えることを実地で確認した。
  4. **ContractEntity 型との一致**: ChainvizToken エントリは
     `{ name:"ChainvizToken", abi:[...], token:{symbol:"CVZ", decimals:18} }`、
     Counter エントリは `{ name:"Counter", abi:[...] }`(token フィールドなし)
     で、`packages/shared` の `ContractEntity`(name?/catalogKey?/token?)へ
     そのまま写像できる形であることをスクリプトで検証した。decimals は
     数値 18。
  5. **静的チェック**: `pnpm lint` / `pnpm build` / `pnpm test` を独立して
     実行し、すべて合格(collector 743 / frontend 791 テスト passed)。
     本 Issue は TypeScript コードを変更していないことも確認した。
  6. **後片付け**: 退避ファイルと docker ビルドで生じた `out/`・`cache/`
     (どちらも .gitignore 済み)を削除し、`catalog.json` が検証前の内容と
     一致することを確認して worktree を元の状態に戻した。
- 補足(非ブロッキング、完了条件外の観察):
  - カタログのトップレベルキーは Solidity コントラクト名(`ChainvizToken` /
    `Counter`)。後続 #161 が `deployContract` の contractKey とどう突き合わせ
    るか(protocol のテストでは kebab-case の `chainviz-token` 例がある)は
    #161 側の設計事項であり、本 Issue のデータファイル仕様としては問題ない。
