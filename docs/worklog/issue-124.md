# Issue #124 reth同士のP2Pメッシュ形成が分かりにくく、正しい状態か判断できない

### 2026-07-06 Issue #124 UX設計(実環境での観察と設計の確定)

- 担当: ux
- ブランチ: issue-124-ux-design-p2p-mesh
- 内容: 実環境(Docker + collector + frontend)でノードを2台追加し、P2P
  メッシュが成長していく様子を実測したうえで、「これは正常な挙動だ」と
  ユーザーが判断できるようにするUX設計をまとめた。実装コードは書いて
  いない。実装は本記録の「実装仕様」をそのまま着手指示として使える

## 実測で確認したこと(設計の根拠)

検証手順: `profiles/ethereum` の2ノードスタック + collector + frontend を
起動し、Playwright(headless Chromium)で画面を操作。「+ ノードを追加」を
2回押し(→ reth3/beacon3・reth4/beacon4 が追加される)、以後15秒間隔で
peerエッジのDOMを6分間記録した。

観測されたエッジの時系列(時刻は観測開始からの経過):

| 経過 | 出来事 |
| --- | --- |
| 0:00 | 初期状態: reth1↔reth2(execution)、beacon1↔beacon2(consensus)の2本 |
| 0:20 | 追加直後: beacon1→beacon3、beacon1→beacon4、reth1→reth3、reth1→reth4 が一斉に出現(全て**ブートノード役への放射状**) |
| 1:05 | reth3↔reth4 が出現(ブートノードを介さない相互接続の1本目) |
| 1:36 | reth2↔reth4 が出現 |
| 以後5分 | 変化なし。reth2↔reth3 は最後まで張られなかった。consensus側はbeacon1を中心とした星型のまま |

つまりユーザーが指摘した「2-1(reth2)から新しくいろいろ線が出てきた」は
実測どおりの正常挙動で、次の3点が混乱の正体だと確認できた:

1. **時間差**: 追加直後は「新ノード→reth1」だけなのに、1〜2分かけて
   reth同士の線が「あとから勝手に」増える。画面には何の説明も出ない
2. **非対称・非決定的**: どのペアが繋がるかは毎回違う(今回の実測では
   reth2↔reth3 は張られず、consensus側は星型のままだった)。「完成形」が
   無いので、どの状態が正しいのか判断できない
3. **線の意味の手がかりゼロ**: シアンの線(execution)とオレンジの線
   (consensus)が別々の実在P2Pネットワークであることは、現状UIのどこにも
   書かれていない。B層の用語データ(p2p・peer・discovery・gossip)は
   `glossary/ethereum/terms/b-network.yaml` に既にあるが、**UI上に
   アンカー(GlossaryTermで参照する箇所)が1つも無く、ユーザーからは
   存在しない機能になっている**(termKey= で grep して確認)

補足の実測事実: ブートノードは compose の環境変数 `RETH_ROLE=boot`
(reth1)・`BEACON_ROLE=boot`(beacon1)で決まり、追加ノードは常に peer 役
(`node-lifecycle.ts`)。peer は起動時に boot の enode/ENR へ接続し、以後は
ノード発見(discv4/discv5)で相互に接続を広げる(`profiles/ethereum/scripts/
reth-node.sh` の `--bootnodes`/`--trusted-peers` 参照)。

## UX設計の考え方

「メッシュは時間とともに育ち、その育ち方は毎回違う。それが正常」という
事実を、(1)常時見える場所に一言で、(2)疑問を持った瞬間(線へのホバー)に
その場で、(3)中心に見えるノード(ブートノード)の役割として、の3経路で
伝える。既存の仕組み(GlossaryTerm・ポップオーバー・カードのピル型
バッジ・networkIdごとの色)だけで構成し、新しい表現形式は増やさない。

## 実装仕様

### A. ネットワーク凡例(レジェンド)パネル — frontend

- キャンバス右下(MiniMapの上)に小さなオーバーレイパネルを常時表示する。
  peerエッジが1本も無い場合は出さない
- 内容: networkIdごとに1行 —
  `[色チップ] [ネットワーク名] [接続数]`
  - 色チップ: `networkIdColor(networkId)`(既存)の塗り
  - ネットワーク名: networkId 末尾が `-execution` なら
    `network.execution` {ja: "実行ネットワーク", en: "Execution network"}、
    `-consensus` なら `network.consensus` {ja: "コンセンサスネットワーク",
    en: "Consensus network"}。どちらでもなければ networkId をそのまま表示。
    この対応付けはEthereumプロファイルのフロント表現セットの一部として
    小さな純粋関数に閉じ、コメントで「プロファイル追加時に差し替え単位に
    なる」旨を明記する
  - ネットワーク名は `GlossaryTerm`(termKey は下記Dの `execution-p2p` /
    `consensus-p2p`)で包み、ホバーで「これは何のネットワークか」が
    その場で読めるようにする
  - 接続数: 現在描画中のpeerエッジ本数。既存の `groupEdgesByNetwork`
    (`peerEdge.ts`。「凡例・集計向け」として実装済み・現在未使用)を使う
- パネル最下部に固定の1行キャプションを置く(これが Issue の
  「初回表示時のヒント」に相当。状態管理不要の常時表示):
  - `legend.hint` {ja: "ピア接続はノード発見により時間とともに自動で
    増えます", en: "Peer connections grow over time via node discovery"}
  - 「ノード発見」部分は `GlossaryTerm`(termKey="discovery")で包む
- 新規UI文言はすべて `messages.ts` に `{ja, en}` で追加する

### B. peerエッジのホバーポップオーバー + ホバー強調 — frontend

- `PeerPropagationEdge` にホバー対応を足す:
  - ホバー中はそのエッジを強調(strokeWidth 2→3.5・不透明度を上げる)。
    細い線でも狙えるよう、React Flow の `interactionWidth`(既定20)を
    利用する
  - エッジ中点付近にポップオーバーを表示(`EdgeLabelRenderer` を想定。
    見た目は `.infra-popover` の流儀を流用した `.peer-popover`)
- ポップオーバーの内容(実データは端点名のみ。ピアごとの動的情報は
  持ち込まない):
  1. ネットワーク名(Aと同じ表記・同じ `GlossaryTerm`)+ 色チップ
  2. 端点: `reth1 ↔ reth2` のような短い表記(stableId の service 部分)
  3. 固定の説明文 `peerEdge.hint` {ja: "ノード同士がノード発見で
     見つけ合って自動的につないだ接続です。線が時間差で増えたり、
     ノードごとに相手が違ったりするのは正常な動きです。",
     en: "A connection the nodes established automatically after finding
     each other via node discovery. It is normal for cords to appear over
     time and for each node to have different peers."}
- ブロック伝播パルスが走っている最中にホバーしても表示が壊れないこと

### C. ブートノードの明示 — shared + collector + node-env + frontend

- ノードカードのヘッダに小さなピル型バッジ「ブートノード」を表示する
  (reth1・beacon1 のみ)。`.wallet-card__orphan` と同じピル型の流儀だが、
  異常ではないので赤系は使わず中立的な配色(枠線+控えめな文字色)にする。
  バッジ文言は `GlossaryTerm`(termKey="bootnode")で包み、ホバーで
  「入口役であって特別な権限は無い。最初の1本目以外の接続は各ノードが
  自分で張る」ことが読めるようにする
- `InfraPopover` に行を追加: ラベル「役割」(`field.role` {ja: "役割",
  en: "Role"})、値「ブートノード」(`role.bootnode` {ja: "ブートノード",
  en: "Bootnode"})。この行はブートノードの場合のみ表示する
- データの流れ(frontend単独では完結しない。分担が必要):
  - **shared**: `NodeEntity` に任意フィールドを追加する。推奨は
    `p2pRole?: "bootnode"`(値はブートノードのときのみ設定。通常ピアは
    フィールド自体なし)。bootnode という語はチェーン非依存のP2P一般語彙
    (Bitcoinのseed node等も同系概念)なのでスキーマに置いてよいと判断
    したが、**フィールド名・値の最終決定は chainviz-designer が行う**
  - **node-env**: `profiles/ethereum/docker-compose.yml` の reth1・beacon1
    サービスに Docker ラベル(推奨: `com.chainviz.p2p-role: "bootnode"`)を
    追加する(2サービス各1行。スクリプト変更なし)。既存の
    `com.chainviz.role`(execution/consensus/workbench)はクライアント
    種別の別軸なので値を混ぜない。ラベル変更は既存コンテナの再作成を
    伴う点に注意(genesis再生成の不整合 #56 は解消済みだが、QAは既存
    スタックへの適用手順を一度実際に通すこと)
  - **collector**: コンテナ一覧の `Labels`(既に取得している)から上記
    ラベルを読み、`NodeEntity` へ正規化する。ラベルキー定数は
    `labels.ts` に追加する。addNode で追加するノードは常に peer 役なので
    付与しない(現状の `node-lifecycle.ts` のままでよい)
- なぜ必要か: 追加直後の「全ての新ノードがまず reth1/beacon1 に繋がる」
  放射状トポロジの**中心が誰で、なぜ中心なのか**を説明する唯一の
  手がかりになるため。凡例(A)・ホバー(B)だけでは「最初の線が全部
  reth1 に向かう」理由までは伝わらない

### D. 用語データの追加 — `glossary/ethereum/terms/b-network.yaml`

すべて `{ja, en}` の両言語で書く(英語は chainviz-i18n のレビュー推奨)。

- `bootnode`(新規): 新しく参加するノードが最初に接続する入口役のノード。
  既知の接続先としてここから他のピアの情報を教わり、以後は各ノードが
  ノード発見で自分の接続を広げていく(2本目以降の接続はブートノードを
  介さない)。chainviz の Ethereum プロファイルでは reth1(実行)と
  beacon1(コンセンサス)がこの役。relatedTerms: [discovery, peer, p2p]
- `execution-p2p`(新規): 実行クライアント(reth など)同士が devp2p という
  プロトコルで直接つながるP2Pネットワーク。トランザクションのゴシップや
  過去ブロックの取り寄せ(同期)に使われる。chainviz ではシアン系など
  networkId 固有色の紐として描く。relatedTerms: [p2p, peer, gossip]
- `consensus-p2p`(新規): コンセンサスクライアント(beacon)同士が libp2p で
  つながるP2Pネットワーク。新しいブロックや合意情報のゴシップに使われる。
  relatedTerms: [p2p, peer, gossip]
- 既存 `discovery` の relatedTerms に `bootnode` を追加(相互参照)

### E. モックデータの更新 — frontend

- `websocket/mockData.ts` の既定スナップショットが consensus 1種の
  networkId しか持たず、実環境(#106以降は execution + consensus の2種)と
  乖離している。execution 側の peer エッジと、reth1/beacon1 相当への
  `p2pRole`(Cのフィールド)を追加し、`VITE_COLLECTOR_URL` 未設定の
  UIのみ起動でも凡例2行・バッジ・エッジホバーが確認できるようにする
- あわせて `peerEdge.ts` の陳腐化コメント「現状の Ethereum プロファイル
  1つでは networkId は1種類だが」を修正する(#106 の reviewer が
  非ブロッキング指摘済みのフォローアップ)

## 見送ったこと(理由つき)

- **線の輻輳軽減の新規レイアウト**(エッジの束ね・力学配置等): 4+4ノード・
  peerエッジ8本の実測では、輻輳そのものより「意味の説明が無いこと」が
  課題の中心だった。Bのホバー強調が最小限の線トレース支援になる。
  ノード数がさらに増えて実害が出た時点で別Issueとして扱う
- **新規エッジ出現時のトースト通知**: メッシュ形成期は1分間に数本増える
  ため通知が騒がしい。凡例の本数カウント+固定ヒント文で代替
- **エッジの描画品質の問題**(今回の観察での新発見。別Issue起票を推奨):
  peerエッジは常に source=右ハンドル・target=左ハンドル固定のため、
  端点カードの位置関係によっては紐がカードへ巻き付くループ状に描かれる
  (reth1↔reth2 で実測)。また横に隣接するカード間の紐はカードの裏に
  ほぼ隠れる(beacon1↔beacon2 で実測)。「紐のつながり方がよくわからない」
  というユーザーの言葉にはこの描画問題も含まれている可能性が高いが、
  「正常性の伝達」という #124 の本質とは独立した課題(floating edge 等の
  対応になり規模も別)なので、このIssueには含めない

## 未決事項(統括の判断が必要)

1. **Cのスコープ**: shared/collector/node-env にまたがる。推奨は
   「#124 の同一ブランチで4パッケージまとめて実装」(各変更が小さく、
   分割すると「バッジUIだけあってデータが来ない」中間状態ができるため)。
   その場合 chainviz-designer による型・ラベルキーの最終確定を先に挟む
2. **Bを含めるか**: 推奨は「含める」(「この線は何?」への最直接の回答)。
   工数を絞る場合、A+C+Dだけでも最低限は伝わるが、疑問が湧く場所
   (線そのもの)から解説への導線が無くなる
3. **凡例の設置位置**: 推奨は右下(MiniMapの上)。左下(Controlsの上)でも
   成立する。実装時にフロント担当が見た目で決めてよい

## QA向け・完了条件の具体化

実環境でノードを2台追加し、(1)追加直後は新ノードからブートノードへの
放射状の線、(2)1〜2分後に reth 同士の線が増える、を再現しながら:

- 凡例に「実行ネットワーク」「コンセンサスネットワーク」が色チップ付きで
  並び、接続数が実際の描画本数と一致して増えること
- 任意の peer エッジへのホバーで、ネットワーク名・端点・「自動で増える
  のは正常」の説明が出ること(パルス走行中も壊れないこと)
- reth1・beacon1 のカードにだけブートノードのバッジが出て、ホバーで
  用語解説が読めること。UIから追加したノードには出ないこと
- 言語を English に切り替えると、凡例・ポップオーバー・バッジ・用語が
  すべて英語になること

## 検証環境についての注意(次の担当への申し送り)

- 今回の実測時、メイン作業ディレクトリ(`/home/zoe/workspace/chainviz`、
  main の 002ecdf)で起動済みの collector(port 4000)・frontend(port 5173)が
  生きており、worktree 側から `pnpm dev:up` した collector は EADDRINUSE で
  即死していた(`dev-up.sh` の `wait_for_port` は他プロセスのポートを見て
  成功と誤報告する。#121 と同種の罠)。観測はメイン側インスタンス
  (コードは main と同一)に対して行ったため設計判断への影響は無いが、
  worktree で動作確認する担当は `ss -ltnp` でどのプロセスに繋がって
  いるかを必ず確認すること
- 検証で追加した reth3/reth4(+beacon) は UI の削除ボタンで削除済み。
  スタックは初期2ノード構成に戻してある
- ヘッドレスブラウザでの確認は Playwright を一時ディレクトリに都度
  導入して行った。この環境では Chromium の実行に libnspr4/libnss3 が、
  日本語表示に CJK フォントが不足しており、ユーザー領域への展開
  (LD_LIBRARY_PATH と `~/.local/share/fonts` へのシンボリックリンク)で
  補った。リポジトリには何も追加していない

### 2026-07-06 Issue #124 node-env実装(reth1・beacon1へのbootnodeラベル追加)

- 担当: node-env
- ブランチ: issue-124-ux-design-p2p-mesh
- 内容: 上記UX設計(C. ブートノードの明示)の node-env 分担分を実装した。
  `profiles/ethereum/docker-compose.yml` の reth1・beacon1 サービスに
  Docker ラベル `com.chainviz.p2p-role: "bootnode"` を各1行追加した
  (compose の `labels:` キーとして、既存の `environment:` の直後に配置)。
  スクリプト(`reth-node.sh` / `lighthouse-bn.sh`)の変更はない。
  - 既存の `com.chainviz.role`(execution/consensus/workbench。クライアント
    種別の軸)とは別軸のラベルキーであり、値も混ぜていない。
  - collector 側は同じブランチで並行実装されており、
    `packages/collector/src/adapters/ethereum/labels.ts` に
    `P2P_ROLE_LABEL = "com.chainviz.p2p-role"` が既に追加されている
    ことを確認し、キー名を完全一致させた。
- 確認方法: このworktreeから稼働中の本物のDocker環境
  (メイン作業ディレクトリで動いている `chainviz-ethereum` プロジェクト)を
  壊さないよう、`docker compose up` 等の実起動コマンドは一切実行して
  いない。代わりに `docker compose -p chainviz-verify-124 config`
  (別プロジェクト名・パースのみで起動を伴わないコマンド)を実行し、
  reth1・beacon1 両方の解決済み設定に
  `com.chainviz.p2p-role: bootnode` が正しく含まれることを確認した。
- 申し送り:
  - ラベル変更は既存コンテナの再作成を伴う。稼働中の共有スタックへ
    実際に適用してラベルが `docker inspect` で見えること・
    collector がそれを拾って `NodeEntity.p2pRole` に正規化することの
    確認は、統括による別途のQA検証に委ねる(UX設計記録の申し送り
    どおり)。
  - reth2・beacon2(peer役)や動的追加ノードにはこのラベルを付けていない
    (設計どおり、bootnode 以外は付与しない)。

### 2026-07-06 Issue #124 collector実装(p2pRoleの正規化)

- 担当: collector
- ブランチ: issue-124-ux-design-p2p-mesh
- 内容: `docs/worklog/meta.md` のdesigner記録(Issue #123/#124共通の
  shared型設計)にある collector 側正規化ロジックの設計をそのまま実装した。
  - `packages/collector/src/adapters/ethereum/labels.ts` にラベルキー
    定数 `P2P_ROLE_LABEL = "com.chainviz.p2p-role"` を追加。
  - `packages/collector/src/adapters/ethereum/index.ts` の
    `toEntity()`(node を返す分岐)で、`obs.labels[P2P_ROLE_LABEL] ===
    "bootnode"` のときのみ `p2pRole: "bootnode"`、それ以外(ラベル無し・
    想定外の値すべて)は `p2pRole: "peer"` を設定するようにした。
  - `node-lifecycle.ts`(addNode)は変更していない。追加ノードは常に
    peer役であり、ラベルを付与しない設計のため(#124の設計どおり。
    managed ラベルは持つが p2p-role ラベルは持たないノードでも peer に
    なることをテストで固定した)。
- テスト: `packages/collector/src/adapters/ethereum/index.test.ts` に
  以下を追加(既存の `MANAGED_LABEL` 判定テスト群と同じ流儀・粒度に
  揃えた):
  - ラベル無し→peer
  - `"bootnode"` 完全一致→bootnode
  - 想定外の値(`"Bootnode"` `"BOOTNODE"` `"boot"` 空文字 前後空白入り)は
    すべてpeer(`it.each` で網羅)
  - `Labels` フィールド自体が無いコンテナ→peer
  - addNode相当(managedラベルあり・p2p-roleラベルなし)のノード→peer
    (managed かどうかと p2pRole が独立に判定されることの確認)
- 確認: `pnpm --filter @chainviz/collector build`・
  `pnpm --filter @chainviz/collector test`(634 tests, 追加6件含め全通過)・
  対象ファイルへの `eslint` を実行し、いずれも問題なし。
- 未実施(申し送り): 実際に `com.chainviz.p2p-role=bootnode` ラベルが
  付いた Docker 環境での動作確認(collectorが実際にラベルを読み取り
  `NodeEntity.p2pRole` へ反映すること)は行っていない。node-env側の
  実装(reth1/beacon1へのラベル付与)完了後、統括の別途QA検証に委ねる
  (Issue指示どおり)。

### 2026-07-06 Issue #124 frontend実装(A〜D)+統括による仕上げ

- 担当: frontend(セッションリミットで作業途中停止)→ 統括が引き継いで
  ビルドエラー修正・不足分の実装・テスト追加を行った。
- frontend担当が実装した範囲:
  - `packages/frontend/src/entities/NetworkLabel.tsx`(新規): networkId
    1件分の「色チップ+名前」表示。既知のexecution/consensusは
    `GlossaryTerm`で包み、それ以外は生のnetworkIdを表示。
  - `packages/frontend/src/entities/PeerNetworkLegend.tsx`(新規、UX設計A):
    キャンバス右下の常時表示ネットワーク凡例。`groupEdgesByNetwork`
    (既存実装済み・従来未使用だった関数)を活用し、networkIdごとの
    接続数を表示。最下部に固定ヒント文(「ピア接続はノード発見により
    時間とともに自動で増えます」、「ノード発見」部分はGlossaryTerm）。
  - `packages/frontend/src/entities/PeerEdgePopover.tsx`(新規、UX設計B):
    ピアエッジホバー時のポップオーバー中身。ネットワーク名・端点表記
    (`reth1 ↔ reth2`)・固定の「これは正常」説明文。
  - `packages/frontend/src/canvas/Canvas.tsx`: ピアエッジのホバー状態管理
    (`onEdgeMouseEnter`/`onEdgeMouseLeave`)、ホバー中のエッジへの
    `data.hovered`注入、`PeerNetworkLegend`の配置。
  - `packages/frontend/src/entities/PeerPropagationEdge.tsx`:
    `data.hovered`時にstrokeWidthを太くし(2→3.5)、`EdgeLabelRenderer`で
    `PeerEdgePopover`を中点に表示。パルス走行中でも壊れない設計。
  - `packages/frontend/src/entities/peerEdge.ts`: `describeNetwork()`
    (networkId末尾の`-execution`/`-consensus`からEthereumプロファイルの
    表示情報を導く純粋関数、UX設計A/B共有)を追加。
  - `packages/frontend/src/entities/InfraNodeCard.tsx`(UX設計C):
    `p2pRole === "bootnode"`のノードカードにピル型バッジを表示
    (`GlossaryTerm termKey="bootnode"`で包む)。
  - `packages/frontend/src/styles.css`: 凡例・ポップオーバー・バッジ・
    ホバー強調のスタイル追加。
- 統括が引き継いで対応した内容:
  1. **ビルドエラー修正**: 新規i18nメッセージキー(`role.bootnode` /
     `network.execution` / `network.consensus` / `legend.hint.prefix` /
     `legend.hint.term` / `legend.hint.suffix` / `peerEdge.hint`)が
     `packages/frontend/src/i18n/messages.ts`に未追加のままコンポーネント
     から参照されており、型エラーでビルドが失敗していた。UX設計
     (`legend.hint`を`GlossaryTerm`で挟むためprefix/term/suffixの3分割に
     した実装判断を汲み)に沿って追記し解消した。
  2. **glossary用語の追加**: UX設計§Dが指示する`bootnode` /
     `execution-p2p` / `consensus-p2p`の3用語が
     `glossary/ethereum/terms/b-network.yaml`に未追加だった(参照している
     コンポーネントは実装済みだったが、データが欠けていたため
     `GlossaryTerm`が「用語なし」表示にフォールバックしていた)。
     UX設計の定義文どおりに追加し、`discovery`の`relatedTerms`にも
     `bootnode`を相互参照として追加した。js-yamlで実際にパースできる
     ことを確認済み。
  3. **InfraPopoverへの役割行追加**: UX設計Cは「InfraPopoverに
     `field.role`(役割)/`role.bootnode`(値)の行を追加、ブートノードの
     場合のみ表示」を求めていたが、カードバッジ(InfraNodeCard)のみ
     実装され、ホバー詳細ポップオーバー(InfraPopover)側の行が
     未実装だった。`field.role`メッセージキーを追加し、
     `packages/frontend/src/entities/InfraPopover.tsx`に
     `entity.p2pRole === "bootnode"`のときだけ表示する行を追加した。
  4. **不足していた基本テストの追加**(CLAUDE.mdのユニットテスト必須
     ルールに従い、新規コンポーネント3件にテストが無かったため):
     - `NetworkLabel.test.tsx`(新規、4件): 既知networkId(execution/
       consensus)のGlossaryTerm包み、未知networkIdへのフォールバック、
       色チップの描画。
     - `PeerEdgePopover.test.tsx`(新規、3件): 端点表記、固定ヒント文、
       tooltipロール。
     - `PeerNetworkLegend.test.tsx`(新規、3件): エッジ0件時は非表示、
       networkIdごとのグルーピング・接続数、固定ヒント文とdiscovery
       用語の描画。
     - `InfraNodeCard.test.tsx`に4件追加: bootnodeバッジの表示/非表示
       (p2pRole=bootnode/peer/undefined)、workbenchカードには出ない
       ことの確認。
  5. **E(モックデータの更新)は今回スコープ外とした**: UX設計は
     `websocket/mockData.ts`のexecution/consensus2networkId化・
     bootnode設定を求めているが、既存の`createMockSnapshot()`は
     `MOCK_NETWORK_ID`(単一値)を前提にした複数の既存テストが
     `toEqual`で厳密比較しており、CL側(lighthouse)もノード1台のみで
     ピア接続を表現できない構成になっている。実環境相当への書き換えは
     既存モックデータ構造の大規模な作り直しを伴い、動作(実環境での
     見え方)には影響しない開発体験上の改善であるため、今回は見送り、
     別途対応することとした(A〜Dの本質的なUX改善は完了している)。
- 確認: `pnpm build && pnpm test`(collector 634・frontend 564・shared
  13・e2e 34)すべて通過。`pnpm lint`も通過。
- 未実施: `docs/PLAN.md`のIssue #124チェックボックス更新は、node-env側の
  ラベル付与が実際のDocker環境で機能することのQA確認後にまとめて行う。

### 2026-07-06 Issue #124 テスト強化(異常系・境界値の追加)

- 担当: tester
- ブランチ: issue-124-ux-design-p2p-mesh
- 内容: frontend実装の基本テスト(ハッピーパス中心)に対し、異常系・境界値・
  独立性の観点でユニットテストを追加した。実装コードは変更していない。
  以下の観点を追加した:
  - `peerEdge.ts` の純粋関数(従来テストが無かった)を新規カバー:
    - `describeNetwork()`: 既知の execution/consensus 接尾辞、空文字、
      接頭辞が空(`-execution` 等)、大文字接尾辞は非該当(case-sensitive)、
      ハイフン無しの裸語は非該当、末尾ではなく中間に含むだけの場合は非該当、
      両方の語を含む場合は末尾の接尾辞が優先されること。
    - `stableIdServiceName()`: スラッシュ無し・複数スラッシュ・末尾スラッシュ
      (空文字を返す)・先頭スラッシュ・空文字。
    - `isPeerFlowEdge()`: peer型は true、ownership/operation/type無しは false、
      混在エッジ配列から peer だけ抽出できること(Canvas の凡例抽出・ホバー
      注入・「ピア以外のエッジは無視」の前提を固定)。
  - `NetworkLabel`: 大文字接尾辞の生表示フォールバック、空 networkId で
    例外を投げず色チップは出て名前が空になること、英語ラベル、末尾接尾辞
    優先の UI レベル確認。
  - `PeerEdgePopover`: 端点が両方空(`["", ""]`)の防御的フォールバック、
    未知 networkId で用語ボタンが出ず生表示になること、英語ヒント文。
  - `PeerNetworkLegend`: エッジ1件のみ(境界)、多数(12件)の networkId、
    初出順の行順維持、未知 networkId の生表示、data/networkId 欠落エッジが
    空文字バケットに落ちて例外を投げないこと、英語ヒント文。
  - `PeerPropagationEdge`(新規テストファイル): ホバー強調(strokeWidth
    2→3.5・`peer-edge--hovered` クラス)、パルス円の描画数、パルスの
    方向(keyPoints)と duration、**ホバー強調とパルス走行の同時成立**
    (互いに打ち消さないこと。設計コメントの「パルス走行中でも壊れない」を
    テストで固定)、data が undefined でも例外を投げない防御的既定値。
    ホバーポップオーバー本体は `EdgeLabelRenderer`(React Flow 全体の
    ポータル先を要する)経由のため単体描画では出ず、中身の検証は
    `PeerEdgePopover.test.tsx` が担当する旨をコメントで明記した。
  - `InfraPopover`(新規テストファイル): 役割行(`役割`/`ブートノード`)が
    bootnode ノードのときのみ表示され、peer・undefined・workbench では
    出ないこと。役割行が removable・同期状態と独立して表示されること。
    英語ローカライズ。
  - `InfraNodeCard`: bootnode バッジが removable(削除ボタン)・同期状態と
    独立して表示されること、想定外の p2pRole 値(`"Bootnode"`)は
    `=== "bootnode"` の厳密比較で出さない防御的挙動。
- collector 側の `p2pRole` 正規化テストは既に想定外値(大小文字違い・
  `"boot"`・空文字・前後空白)・`Labels` フィールド欠落・managed との独立性を
  `it.each` で網羅済みであり、追加不要と判断した。
- Canvas.tsx のホバー状態遷移(enter→別エッジへ移動→leave で
  `hoveredPeerEdgeId` が常に1つだけを指すロジック)は `CanvasInner` 内の
  インラインコールバックとして実装されており、エクスポートされていない。
  jsdom では React Flow がノード計測を行わずエッジ DOM を安定して描画
  できないため、コンポーネント描画経由の遷移テストは信頼性が低い。実装を
  リファクタして切り出す必要があり、テスト強化担当の範囲(実装変更をしない)
  を超えるため今回は追加していない。遷移ロジックそのものはコード読解で
  確認済み(leave は `current === edge.id` のときのみ null 化するため、
  A→B へホバー移動した後の A の leave では B が消えない)。「ピア以外の
  エッジにホバーしても何も起きない」条件は、その前提となる型ガード
  `isPeerFlowEdge` のユニットテストで担保した。
- 実装バグの発見: なし。既存実装は防御的な既定値・厳密比較が適切に
  効いており、追加した異常系テストはいずれも期待どおり通過した。
- 確認: `pnpm --filter @chainviz/frontend build`・同 `test`(40ファイル・
  frontend 全体で 564→615 件に増加)・`pnpm lint`(root eslint)すべて通過。

### 2026-07-06 Issue #124 静的レビュー(合格・非ブロッキング指摘あり)

- 担当: reviewer
- ブランチ: issue-124-ux-design-p2p-mesh(worktree: chainviz-wt-124)
- 判定: **合格**。実装を直接動かしての検証は QA に委ねる。
- 確認したこと:
  - **境界の遵守**: frontend は Docker/ノード API に触れていない。
    ブートノード判定はノード環境(composeラベル)→ collector(正規化)→
    shared 型(`p2pRole`)→ frontend(表示のみ)の一方向で、チェーン固有の
    語彙(RPCメソッド名等)は shared/frontend に漏れていない。
    `describeNetwork()` の networkId 末尾判定(`-execution`/`-consensus`)は
    collector 側 `targets.ts` が付ける接尾辞と実際に一致することを確認。
    Ethereum プロファイルのフロント表現セットの一部である旨・差し替え
    単位である旨がコメントに明記され、未知 networkId は生表示への
    フォールバックで他チェーンでも安全に劣化する
  - **shared の型変更なし**: 作業ツリー・ブランチ差分とも
    `packages/shared` への新規変更は無い(`p2pRole?: "bootnode" | "peer"`
    は先行マージ済み PR #134 の範囲内)。collector の「ラベル無し・想定外値
    → peer」正規化は designer の設計記録・ARCHITECTURE.md の
    `p2pRole` コメントと一致
  - **エラー握りつぶし**: 新規 catch 節なし。防御的フォールバック
    (`data?.hovered ?? false`、endpoints 省略時の空表記等)はいずれも
    理由がコメントで説明され、テストで固定されている
  - **ビルド・テスト**: リポジトリ全体で `pnpm lint && pnpm build &&
    pnpm test` 全通過(collector 634 / frontend 615 / shared / e2e)
  - **テストの質**: describeNetwork の大文字・中間一致・裸語・空文字、
    p2p-role ラベルの想定外値網羅(`it.each`)、バッジ/役割行の
    removable・同期状態との独立性、ホバー強調とパルスの同時成立、
    data 欠落時の防御など、異常系・境界値が実挙動ベースで検証されており、
    壊れたコードでも通る「なぞりテスト」は見当たらない
  - **docs との齟齬なし**: ARCHITECTURE.md(`p2pRole` と導出元ラベルの
    記述)・CONCEPT.md(凡例・紐ホバー・ブートノードバッジの記述)は
    先行の設計 PR で反映済みで、今回の実装と一致している
- 統括からの申し送り3点への判断:
  1. **E(mockData更新)の見送りは妥当**。mockData は `VITE_COLLECTOR_URL`
     未設定の UI 単体起動でのみ使われ、実環境の表示経路(collector →
     WebSocket)には影響しない。既存テストが単一 `MOCK_NETWORK_ID` 前提で
     厳密比較している点も確認した。ただし放置すると UI 単体起動で
     凡例2行・バッジが確認できない状態が残るため、**PLAN.md バックログへの
     別 Issue 起票を推奨**(UX設計§Eの残件として)
  2. **Canvas.tsx のホバー遷移はインラインのまま許容**。enter で set、
     leave は `current === edge.id` のときのみ null 化という3行程度の
     遷移で、判定の要である型ガード `isPeerFlowEdge` と表示側の
     `hovered` 分岐は切り出されてテスト済み。実際のマウス操作での挙動
     確認は QA の実機検証で担保する。今後ホバー仕様が増える(遅延表示・
     タッチ対応等)場合は純粋関数への切り出しを検討すればよい
  3. **統括の追加実装は UX 設計・既存パターンと整合**。InfraPopover の
     役割行は UX 設計§Cの指示どおり node 分岐内・bootnode 時のみ表示。
     `legend.hint` の prefix/term/suffix 3分割は GlossaryTerm を文中に
     挟むための妥当な実装判断。glossary 3用語は§Dの定義どおりで
     `discovery` への相互参照も追加済み。追加テストも既存の流儀
     (testid・renderCard ヘルパ)に揃っている
- 非ブロッキング指摘(差し戻しはしないが統括の判断を仰ぐ):
  - UI 文言の ja が UX 設計の指定(「実行ネットワーク」「コンセンサス
    ネットワーク」)と異なり「実行層ネットワーク」「合意層ネットワーク」に
    なっている。glossary の既存語彙は「コンセンサスクライアント」であり
    「合意層」はこの変更で初出の言い換え。意味は通るが、学習支援アプリと
    して用語の揺れは避けたいので、QA 前後で ux / i18n に文言の最終確認を
    推奨(glossary 新規3用語の英語定義文も UX 設計が推奨する
    chainviz-i18n レビュー未実施)
  - `legend.hint.suffix` の en が空文字なのは語順の違いによる意図的な
    設計と読めるが、コメントが無い。気になるなら一言コメントを添えてよい
- コミット粒度への指示: 現状、実装一式が未コミット(ブランチ上は UX 設計
  記録の docs コミット1件のみ)。「1つの変更内容 = 1コミット」に従い、
  最低でも次の単位に分けてコミットすること:
  (1) feat(node-env): compose への bootnode ラベル追加、
  (2) feat(collector): p2pRole 正規化+テスト、
  (3) feat(glossary): b-network.yaml への3用語追加、
  (4) feat(frontend): 凡例+エッジホバー(A/B。peerEdge.ts・Canvas・
  新規3コンポーネント・styles・messages と対応テスト)、
  (5) feat(frontend): ブートノードバッジ+役割行(C。InfraNodeCard・
  InfraPopover と対応テスト)、
  (6) docs: worklog 追記。
  tester の強化テストを (4)(5) に含めるか `test(frontend)` として独立
  させるかは統括の判断でよい(過去の履歴ではどちらの前例もある)

### 2026-07-06 統括によるレビュー指摘対応

- レビュー(査読誠)の非ブロッキング指摘に対応:
  - ja文言をUX設計の指定どおりに修正
    (「実行層ネットワーク」→「実行ネットワーク」、
    「合意層ネットワーク」→「コンセンサスネットワーク」)。
    対応するテストの期待値も修正。
  - `legend.hint.suffix`のenが空文字である理由(GlossaryTermで挟む
    都合上3分割しているが、英語の文構造ではprefixで文が完結するため)
    をコメントで明記。
- コミットを以下の単位に分割した(レビュー時点で未コミットだった一式):
  1. `feat(node-env)`: reth1/beacon1へのブートノードラベル追加
  2. `feat(collector)`: p2pRole正規化+テスト
  3. `feat(glossary)`: bootnode/execution-p2p/consensus-p2p用語追加
  4. `feat(frontend)`: 凡例・ホバー・バッジ・役割行の実装一式
  5. `test(frontend)`: 基本テスト+境界値テストの追加一式
  6. 本コミット(docs)
- `pnpm lint && pnpm build && pnpm test`すべて通過を再確認済み。
- E(モックデータ更新)見送りは統括の判断でPLAN.mdバックログへ別Issue
  起票することとした(レビュー推奨事項)。
