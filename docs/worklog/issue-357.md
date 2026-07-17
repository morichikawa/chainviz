# Issue #357: docker compose down -v後もEOA(ウォレット)が削除されずに残る

### 2026-07-17 原因調査(detective)

- 担当: detective
- ブランチ: issue-357-eoa-not-cleared-on-down
- 内容: 「`docker compose down -v` してもEOA(ウォレット)が削除されず残る」
  というユーザー報告の原因を、実測に基づいて調査した。**根本原因を特定済み。
  コードの不具合ではなく設計上の未考慮ケース(チェーンリセット検知の欠如)が
  主因で、修正には設計判断が必要。**

## 観測した事実(すべて実測)

1. **調査開始時点で docker は完全に空だった**(`docker ps -a`・
   `docker volume ls`・`docker network ls` に chainviz 関連ゼロ)。
   つまりユーザーの `down -v` はコンテナ・ボリューム・ネットワークの
   破棄自体には成功していた。
2. **その状態でも collector プロセス(PID 181930)は 13:25 から生き続けて
   いた**(ポート 4000/4001 を保持。`/proc/181930/cwd` はワークツリー
   `.claude/worktrees/agent-a69885edca92581fe` = Issue #315 QA時に起動された
   もの)。ホスト上のプロセスなので `docker compose down` の影響を受けない。
3. スタックを `up` し直した直後、この collector の WebSocket スナップ
   ショットに **workbench 1 件に対して wallet が 4 件**存在した。うち 3 件は
   `ownerWorkbenchId: null` で、残高は旧チェーンの値のまま凍結
   (例: `1000000000002000000000000000` wei — プリマイン 1e27 に旧セッションの
   送金 2e15 が加算された値。新チェーンではあり得ない)。さらに新チェーンに
   存在しない contract(ChainvizNFT, 0x47f8f007…)も残っており、NftTracker が
   毎周期 `Cannot decode zero data ("0x")` エラーを出し続けていた
   (ログ 5MB 超)。
4. コードレベルの裏付け: `packages/collector/src/world-state/diff.ts` の
   `computeWalletDiff` は wallet の `entityRemoved` を一切発行しない。
   ワークベンチ消滅時は `ownerWorkbenchId: null` に更新するだけで、
   エンティティ自体は残す。これは意図的な仕様
   (`docs/ARCHITECTURE.md` L231「ワークベンチ削除後も null にして残す」。
   EOA はワークベンチを消してもチェーン上に存在し続けるため)。
5. **補助的な第2の問題(隔離環境で実証)**: collector が `addWorkbench` /
   `addNode` で作るコンテナは compose 互換ラベル
   (`com.docker.compose.project` 等)を持つが compose の管理下にはなく、
   `docker compose down -v` では削除されない。最小 compose プロジェクト
   (`det-orphan-test`)+同一ラベル構成のコンテナで再現したところ、
   `down -v` 後もコンテナは稼働し続け、ネットワーク削除も
   「Resource is still in use」で失敗した。`--remove-orphans` を付けても、
   `com.docker.compose.oneoff=False` ラベルを足しても削除されなかった
   (Docker Compose v2.40.3 / Engine 29.1.3)。
   ※今回のユーザーのケースでは down 前に managed コンテナが
   (removeWorkbench 経由等で)消えていたため docker 側は空だったが、
   managed コンテナが残ったまま `down -v` するとこの経路でも EOA が残る。

## 特定した根本原因

**collector はホスト上の長寿命プロセスであり `docker compose down -v` の
影響を受けないが、「チェーン自体が破棄された(genesis が変わった)」ことを
検知してワールドステートの C 層エンティティ(wallet / contract)をパージする
仕組みが存在しない。** wallet はワークベンチ消滅時に所有者を null にして
残す仕様(チェーンが生き続ける前提では正しい)のため、`down -v` →
`up`(新 genesis)後も旧チェーンの EOA・コントラクトがワールドステートに
残留し、フロントに表示され続ける。

加えて `EthereumNodeLifecycle` のメモリ上レジストリ(workbench の
wallet-index 採番)もリセットされないため、リセット後に作った新ワーク
ベンチが旧セッションと同じ導出インデックス(= 同じアドレス)を再利用し、
残留ゴーストウォレットが新ワークベンチに「再所有」されて状態が混ざる
副作用もある。

なお Issue 本文の他の仮説は棄却:
- ホスト側ファイルへのウォレット永続化 → 無い(collector の fs 書き込みは
  values.env 読み取り・catalog 読み取り・build マーカーのみ)
- wallet-derivation のキャッシュ参照 → 無い(mnemonic + ラベルからの純導出)
- frontend localStorage → レイアウト座標(`chainviz.layout.v1`)と言語設定
  のみでエンティティは持たない。表示側の問題ではない

## 再現手順(要約)

1. スタック `up` + collector 起動 → `addWorkbench` で EOA を作る
2. collector を動かしたまま `docker compose down -v` → `up`
3. collector のスナップショットに旧 EOA(owner=null)と旧 contract が
   残り続ける(実測で確認)

## 推奨される次のアクション

1. **chainviz-designer に設計を依頼**(主修正): チェーンリセット
   (genesis 変更)の検知方法(例: block 0 のハッシュ変化・ブロック番号の
   後退検知)と、検知時の C 層エンティティ(wallet / contract / NFT 台帳・
   NodeLifecycle レジストリ含む)のパージ方針を決める。実装は
   chainviz-collector。
2. **第2の問題(managed コンテナが down -v で消えない)**は別 Issue 化を
   推奨: `--remove-orphans` でも消えないことを実測済みのため、profiles の
   README への注意書きと、ラベルベースの掃除スクリプト
   (`docker rm -f $(docker ps -aq --filter label=com.chainviz.managed=true)`
   相当)の提供が候補(node-env + docs)。
3. 運用面: QA・e2e 作業で起動した collector プロセスが作業後も残留する
   (今回 4 時間半稼働)。検証系エージェントの後片付け徹底も再発防止に有効。

## 調査時の注意点

- 調査中、共有環境で別エージェントの e2e(comms-log.spec.ts)が同じ
  collector・スタックを使用中だったため、実スタックへの `down -v` は行わず、
  第2の問題は隔離した最小 compose プロジェクトで検証した(検証後に掃除済み)。
- 調査用に起動したスタック(profiles/ethereum)は e2e が使用中のため
  起動したままにしてある。
