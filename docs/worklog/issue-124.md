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
