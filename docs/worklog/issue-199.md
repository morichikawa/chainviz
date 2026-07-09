### 2026-07-09 Issue #199 基本表示シナリオ(UI-CONN・UI-A・UI-B)のPlaywright実装(設計メモ)

- 担当: collector
- ブランチ: issue-199-ui-scenarios-conn-a-b

#### 設計メモ(着手前)

`packages/e2e/SCENARIOS.md`「2. UI層シナリオ」節の以下9件を実装する。
`docs/ARCHITECTURE.md` §8.4 の実装規約(`test()` タイトルは
`<シナリオID>: <タイトル>`、各箇条書きは `test.step()`)に従う。

- UI-CONN-01, UI-A-01〜UI-A-05, UI-B-01〜UI-B-03

**ファイル分割方針**(1ファイル1責務):

- `src/ui/connection.spec.ts`: UI-CONN-01(接続・初期表示)
- `src/ui/infra-display.spec.ts`: UI-A-01〜UI-A-05(A層カード表示)
- `src/ui/p2p-graph.spec.ts`: UI-B-01〜UI-B-03(B層P2Pグラフ)
- `src/ui/support/serviceIds.ts`: 3ファイル共通で使う
  `chainviz-ethereum/<service>` 形式のエンティティ id 組み立てヘルパー
  (既存の `a-b-layer.test.ts` の `id()` と同じ考え方。エンティティ id は
  collector 側で `${project}/${service}` の形式になる)

**ロケータ方針**(ARCHITECTURE.md §8.5 に準拠):

- カード本体の総数確認は `data-testid` の前方一致では
  `infra-card-bootnode-*` / `infra-card-remove-*` / `infra-card-operate-*`
  も `infra-card-` で始まり誤って一致するため、CSS クラス `.infra-card`
  (カードのルート要素にのみ付く)で数える。個別カードの特定は
  `page.getByTestId("infra-card-<entity.id>")`(完全一致なので誤マッチ
  しない)を使う
- `glossary-term-container` は reth/beacon/validator の全ノードカードで
  同じ termKey を使う(既存実装。#198 テスト強化の worklog に記載の
  「同一termKey重複時はgetByTestIdが例外」制約と一致)ため、必ず
  特定のカード配下に scope した `locator.getByTestId(...)` で取得する
- ドラッグ位置の検証(UI-A-04)は、画面上のピクセル座標(`boundingBox()`)
  ではなく React Flow のノードラッパー(`.react-flow__node[data-id=...]`)
  の inline style `transform: translate(Xpx, Ypx)` を直接読む。この値は
  React Flow が `node.position`(= 永続化される論理座標)をそのまま
  transform に使っており、`fitView` によるパン/ズームの影響を受けない
  (`@xyflow/react` dist/esm/index.js の該当行で確認: `transform:
  translate(${internals.positionAbsolute.x}px,...)`)。ドラッグ前後・
  リロード後の3点を比較し、「ドラッグ後 ≠ ドラッグ前」「リロード後 ==
  ドラッグ後(実質不変)」を確認する
- B層エッジは ARCHITECTURE.md §8.5 の方針どおり追加計装せず、
  `data-id`(`peer-<networkId>::<lo>::<hi>` 形式。`lo`/`hi` は
  entity id の文字列比較昇順)で特定する。CSS 属性セレクタの部分一致
  (`[data-id^="peer-"][data-id*="beacon1"][data-id*="beacon2"]`)で
  該当ペアを一意に絞り込む
- 伝播パルス(`UI-B-03`)は `data-testid` 計装が無く、既存の CSS クラス
  `.peer-pulse`(`PeerPropagationEdge.tsx`)がそのまま「伝播パルス要素」
  を指す(ARCHITECTURE.md §8.5 で edge 自体への追加計装は不要と判断
  済みの延長。パルスの `<circle>` も edge の描画物なので同じ扱いとする)

**タイムアウトの根拠**(CLAUDE.md「今この瞬間に観測できる状態に依存した
固定値をロジックに埋め込まない」に対応):

- A層カード出現待ち: collector の A 層ポーリング間隔は
  `packages/collector/src/index.ts` の `POLL_INTERVAL_MS = 3000`(3秒)。
  初回反映を安全に待つため 20 秒(約6.5ポーリング分)を待ち上限にする
- B層ピアエッジ出現待ち: `PEER_POLL_INTERVAL_MS = 3000`(同ファイルの
  `adapters/ethereum/index.ts`)。スタックは既に長時間稼働しピア確立
  済みの前提(globalSetup が既存スタックを再利用)のため 20 秒で十分
  だが、初回コールドスタート分の余裕も見て 30 秒にする
- UI-B-03(伝播パルス)のタイムアウトは `profiles/ethereum/values.env` の
  `SLOT_DURATION_IN_SECONDS=2`(1スロット=2秒)を根拠にする。パルスは
  新しいブロックが2ノード以上に受信されるたびに毎スロット発生しうる
  ため、理論上は次のスロットで観測できるはずだが、Playwright の
  expect ポーリング間隔・パルスの表示時間フロア(`MIN_PULSE_DURATION_MS
  = 450ms`)を考慮し、スロット時間の15倍(30秒)を待ち上限にする。
  **前提条件**: この値は `SLOT_DURATION_IN_SECONDS=2` を前提にした
  「スロット時間の15倍」という比率で決めており、プロファイルの
  スロット時間が変わった場合はこの倍率を保ったまま値を見直すこと
  (コード側にも同じコメントを残す)
- UI-A-04(ドラッグ)はネットワーク待ちが無いローカルDOM操作のみのため
  固定タイムアウト不要(Playwright既定のアクションタイムアウトのみ)

**削除**: `src/ui/foundation-smoke.spec.ts` は UI-CONN-01 実装後に重複する
ため削除する(#197 worklog に明記済みの方針)。

**言語依存ロケータの例外**: UI-A-03(言語切り替え)のみ、ヘッダタイトル
(`.app__title` テキスト)を言語別の文言で確認する(ARCHITECTURE.md §8.5の
明示的な例外)。他シナリオでは文言に依存しない。

#### 実施結果

設計メモどおり4ファイル(`connection.spec.ts` / `infra-display.spec.ts` /
`p2p-graph.spec.ts` / `support/serviceIds.ts`)を新規作成し、9シナリオ
(UI-CONN-01, UI-A-01〜05, UI-B-01〜03)をすべて実装した。
`src/ui/foundation-smoke.spec.ts` は UI-CONN-01 の実装により重複したため
削除した。`SCENARIOS.md` の該当9見出しから `` `予` `` マークを削除した。

**実装時に見つかった設計メモとの差分(ロケータ選定ミス)**:

UI-A-01 のカード総数確認に当初 `.infra-card` クラスをそのまま使ったところ、
実機実行(`pnpm test:e2e:ui`)で「Expected 7, Received 8」の失敗を実際に
確認した。原因は `WalletCard.tsx` / `ContractCard.tsx` / `GhostNodeCard.tsx`
がいずれも見た目を揃えるためベースクラス `infra-card` を共有しており
(`infra-card infra-card--wallet` 等)、稼働中ワークベンチのプリセット
ウォレット1枚が誤って数えられていたため。`InfraNodeCard.tsx` だけが付ける
種別修飾クラス `infra-card--node` / `infra-card--workbench` に絞り込む
`infraCards(page)` ヘルパーへ変更し、修正後に7件ちょうどになることを
実機で確認した(修正前に実際に失敗が再現すること・修正後に green に
なることの両方を確認済み)。

**動作確認**:

- `pnpm --filter @chainviz/e2e build`(`tsc --noEmit`)・`pnpm lint`
  (リポジトリ全体)がいずれも通ることを確認した
- `pnpm test`(リポジトリ全体のユニットテスト)が全パッケージ green
  であることを確認した(shared 58 / collector 1084 / frontend 1368 /
  e2e 50、いずれも既存のテスト数と変わらず)
- `pnpm test:e2e:ui` を実際に実行し、globalSetup(既存の稼働中
  chainviz-ethereum スタックを再利用、collector を UI 層専用ポート
  4125 で起動)からテスト実行・globalTeardown まで通して、9件全てが
  green になることを確認した(1 worker、合計約19秒)。個別ファイル
  単位での再実行(`playwright test src/ui/infra-display.spec.ts` 等)
  でも同じ結果を確認済み

**タイムアウト実測**: UI-B-03(伝播パルス)は設計メモどおり
`SLOT_DURATION_IN_SECONDS × 1000 × 15` = 30 秒を上限にしたが、実機では
チェーンが継続稼働中のため 336ms(1回のポーリングサイクル以内)で
パルスを検出できた。30 秒という上限値は「コールドスタート直後で
まだピア確立が済んでいない」等の余裕を見込んだ値であり、実際の
検出時間そのものは大幅に短い。

作業中に見つけた新規のバグ・改善要望(ロケータ選定ミス以外)は無かった
(GitHub Issue の起票は無し)。なお検証に使った既存 Docker スタックには
本 Issue と無関係な手動テスト由来の停止済みコンテナ
(`chainviz-ethereum-hoge-1`, exited)が残っていたが、A層ポーリングは
稼働中コンテナのみを対象にする(`docker/poller.ts` の `listContainers({
all: false })`)ため実害はなく、本 Issue の実装・検証に影響しなかった。

**次の担当への申し送り**: UI 層でカードの総数や種別を数える場合は
`.infra-card` 単体では wallet/contract/ghost カードまで含んでしまう。
`.infra-card--node` / `.infra-card--workbench` のような種別修飾クラス、
または完全一致の `getByTestId` を使うこと(#200 以降で同様の集計が
必要になった場合の注意点として残す)。

#### テスト強化記録(2026-07-09)

実装済み9シナリオ(UI-CONN-01 / UI-A-01〜05 / UI-B-01〜03)を、境界値・
否定ケース・状態遷移の観点で確認し、以下を追加した。実装コードには
手を入れていない(既存実装に対するテストの追加のみ)。

- **UI-A-01(ブートノードバッジ)**: 従来は reth1 のバッジ表示のみを確認
  していた。ブートノードは docker-compose.yml 上 reth1 と beacon1 の2つ
  なので、beacon1 のバッジ表示も確認するよう追加。さらに非ブートノード
  (reth2)にはバッジが出ないことを `toHaveCount(0)` で確認する否定側の
  確認を追加した。否定側が無いとバッジが常時表示される実装でも合格して
  しまい「ブートノード固有の表示」を検証できないため。
- **UI-A-02(詳細ポップオーバー) / UI-A-05(用語ポップオーバー)**: どちらも
  ホバー(hovered / open 状態)でのみ条件レンダリングされる。従来は
  「ホバー後に表示される」ことのみ確認していたので、前提として「ホバー
  前は要素が存在しない(`toHaveCount(0)`)」ことを確認するステップを先頭に
  追加し、状態遷移(非表示 → ホバー → 表示)を明示的に検証するようにした。

**強化しなかった点とその判断**:

- UI-A-03(言語切り替え)・UI-A-04(ドラッグ配置)の永続化は、既に
  `expect.poll` / リロード後の再取得で待ちを構成しており、固定 sleep や
  暗黙のタイミング依存が無くフレーキーになりにくい。UI-A-04 は
  ドラッグ後に移動量 > 5 を poll で確認してからリロードへ進んでおり、
  境界(移動が反映される前にリロードする)は既に塞がれている。追加不要と
  判断した。
- UI-B-03(伝播パルス)のタイムアウト `SLOT_DURATION_SECONDS × 1000 × 15`
  = 30秒は、`SLOT_DURATION_IN_SECONDS=2` を前提にした倍率としてコードと
  worklog の両方に前提条件が明記済み。実測では 318〜336ms で検出できて
  おり、上限値はコールドスタートの余裕分。固定値の根拠として妥当なため
  変更しない。
- collector 未接続時の表示・要素が現れない場合のタイムアウトといった
  異常系は、SCENARIOS.md に UI-ERR-01〜04 として別途カタログ済み(いずれも
  `予` = 未実装、別 Issue 待ち)。これらを #199 のテスト強化に混ぜて先取り
  実装するのは「新機能の実装をしない」方針に反するため行わない。UI 層の
  異常系は UI-ERR-* の実装 Issue で対応するのが適切。

**動作確認**: `pnpm --filter @chainviz/e2e build`(tsc --noEmit)・リポジトリ
全体の `pnpm build` / `pnpm lint` / `pnpm test`(shared 4 / collector 40・
1084 / frontend 91・1368 / e2e unit 5、いずれも既存どおり green)が
通ることを確認。`pnpm test:e2e:ui` を実機(稼働中の chainviz-ethereum
スタックを再利用)で実行し、9件全て green を確認した(約19秒)。

補足(検証環境): この環境では Playwright のブラウザ起動に必要な共有
ライブラリ(libnspr4.so 等)が未導入で、`playwright install-deps` は sudo
パスワードが必要なため使えなかった。別セッションが scratchpad に展開済み
だった nss/nspr の .deb 展開物を `LD_LIBRARY_PATH` に加えて起動した。
CI ではなくローカル実行前提(CLAUDE.md の方針)であり、恒久対応が必要なら
実行ホストへ `libnss3` / `libnspr4` を導入するのが本筋。

作業中に見つけた新規のバグ・改善要望は無し(GitHub Issue の起票なし)。

#### レビュー記録(2026-07-09, chainviz-reviewer)

ブランチ `issue-199-ui-scenarios-conn-a-b`(mainからの8コミット)を静的レビューした。

**確認して問題なかった点**:

- ARCHITECTURE.md §8.4 の規約準拠: 9件すべての `test()` タイトルが
  「`<シナリオID>: <タイトル>`」形式で SCENARIOS.md の見出しと一致。
  SCENARIOS.md 側の箇条書きはすべて同文の `test.step()` として実装済み
  (前提のみのステップも空実装+コメントで対応関係を維持しており妥当)
- ロケータは `data-testid` を正としており、文言依存は UI-A-03(言語切り替え、
  §8.5 の明示的な例外)のみ。使用している全 testid
  (`connection-status-badge` / `infra-card-*` / `infra-popover-*` /
  `glossary-term-container`(termKey="container" 由来) / `language-toggle` /
  `canvas-toolbar-add-node` / `p2p-legend*`)と CSS クラス
  (`.infra-card--node/--workbench` / `.peer-pulse` / `status-badge--connected`)
  が frontend 実装に実在することを突き合わせた
- `.infra-card` 誤カウント問題の修正: `WalletCard`(`infra-card--wallet`)/
  `ContractCard`(`infra-card--contract`)/`GhostNodeCard`(`ghost-card--*`)の
  クラス構成を確認し、`infraCards()` の
  `.infra-card--node, .infra-card--workbench` 絞り込みが A層カードのみに
  一致することを検証した。経緯コメントもファイル冒頭と worklog に明記済み
- UI-B-03 のタイムアウト: `SLOT_DURATION_IN_SECONDS=2`(values.env 30行目と
  一致)を根拠にした倍率であることと、値変更時の前提条件が
  `p2p-graph.spec.ts` のコメントと本 worklog の両方に明記されている
  (CLAUDE.md の固定値ルールを満たす)
- ブートノードの実態確認: docker-compose.yml で `com.chainviz.p2p-role:
  bootnode` を持つのは reth1/beacon1 の2つで、テスト強化(84fee93)の
  肯定2件+reth2 の否定1件と整合
- アサーションの質: バッジはクラス+文言+モック表記の否定、カードは
  総数+個別 testid+操作ボタンの有無(肯定/否定)、ドラッグは
  「移動した(>5px)」「リロード後も一致(<1px)」「元位置と異なる」の3点
  比較、凡例は件数の数値検証と、いずれも壊れた実装で通る形ではない
- エラー握りつぶし無し(`readNodeTranslate` は不正 transform を実値付きで
  throw、boundingBox null も throw。空 catch 無し)
- `pnpm build` / `pnpm lint` / `pnpm test`(shared 58 / collector 1084 /
  frontend 1368 / e2e unit 50)がすべて green であることを実行して確認
- コミット粒度: 8コミットとも1関心事ずつに分割されており Conventional
  Commits 準拠(UI-CONN実装と foundation-smoke 削除の同居は「置き換え」
  という単一の関心事として妥当)
- docs 整合: PLAN.md のチェック+Issue リンク、WORKLOG.md 索引、
  SCENARIOS.md の `予` マーク削除(9件、内容変更なし)を確認

**差し戻し(軽微・1件)**:

- テスト強化(0aba6e4)で UI-A-02 / UI-A-05 に追加された
  `test.step("ホバー前は(用語)ポップオーバーが表示されていない")`
  (infra-display.spec.ts 135行目・249行目)に対応する箇条書きが
  SCENARIOS.md に無い。SCENARIOS.md は「シナリオの正」であり、§8.4 は
  箇条書きと `test.step` の1対1対応を規約としているため、このままでは
  テストレポートにカタログ外のステップが現れる。UI-A-02 / UI-A-05 の
  各見出しに前提(または確認)の箇条書きを1行ずつ追記して対応を回復する
  こと。あわせて UI-A-01 の「ブートノードのカードにブートノードバッジが
  表示される」も、実装が非ブートノードへの否定確認まで行うようになった
  ので「(非ブートノードには表示されない)」等へ文言を更新するとなお良い

**指摘のみ(対応不要)**:

- SCENARIOS.md §1 の棚卸しは「移行先 UI シナリオが green になった
  コミットで WS 版を削除」としており、UI-A-01 / UI-B-01 に対応する
  a-b-layer.test.ts の WS 版は文言上このブランチで削除対象になるが、
  PLAN.md の次項目(#200)に「移行済み WS テストの整理」が明記されて
  いるため、計画どおりの繰り延べと判断した
- `SLOT_DURATION_SECONDS = 2` は values.env との二重管理だが、前提条件の
  明記があるため現状のままで可。将来スロット時間を変える際は両方を
  更新すること

#### 再レビュー記録(2026-07-09, chainviz-reviewer)

差し戻し対応コミット 5517e16(SCENARIOS.md のみ +5 行)を再レビューした。
判定: **合格**。

- UI-A-02 / UI-A-05 に「前提: ホバー前は(用語)ポップオーバーが表示されて
  いない」が追記され、infra-display.spec.ts の該当 `test.step`(135行目・
  249行目)と1対1対応が回復したことを確認した
- UI-A-01 のブートノードバッジの箇条書きに「（非ブートノードのカードには
  表示されない）」が追記され、テスト強化(84fee93)で追加された reth2 への
  否定確認と記述が整合したことを確認した
- 全9シナリオ(UI-CONN-01 / UI-A-01〜05 / UI-B-01〜03)について箇条書きと
  `test.step` を改めて突き合わせ、過不足(カタログ外のステップ・未実装の
  箇条書き)が無いことを確認した
- `pnpm lint` / `pnpm build` / `pnpm test` をリポジトリ全体で再実行し、
  すべて green であることを確認した(5517e16 は Markdown のみの変更)

補足(対応不要): UI-A-01 の該当 `test.step` タイトルは追記前の文言
「ブートノードのカードにブートノードバッジが表示される」のままで、
括弧書き部分を含まない。否定確認自体はステップ内部で実施されており、
括弧書きは同一アサーションの補足注記と解釈できるため許容とした。
厳密な同文一致に揃えたい場合はステップタイトルへの括弧書き追加を
今後の軽微な整理候補とする。

#### QA検証記録(2026-07-09, chainviz-qa)

ブランチ `issue-199-ui-scenarios-conn-a-b` を実機で検証した。判定: **合格**
(完了条件を満たしている)。

**検証環境**: 稼働中の chainviz-ethereum スタック(7コンテナ、約2時間稼働)を
再利用。Playwright chromium の起動に必要な共有ライブラリ(libnspr4.so /
libnss3.so / libasound.so.2 等)がホスト未導入・sudo 不可のため、scratchpad に
展開済みの nss/nspr .deb 展開物を `LD_LIBRARY_PATH` に加えて chromium を
起動した(worklog テスト強化記録と同じ回避策。恒久対応が必要なら実行ホストへ
`libnss3`/`libnspr4`/`libasound2` を導入するのが本筋)。事前に `pnpm build`
(shared/collector/frontend/e2e)が通ることを確認済み。

**1. UI 層 E2E フルラン(`pnpm test:e2e:ui`)**: 9シナリオ全て green を確認。
`playwright test` のフルラン(1 worker、約19秒)で、UI-CONN-01 / UI-A-01〜05 /
UI-B-01〜03 がすべて成功した(単体実行ではなくスイート全体で確認)。

**2. 他テストとの非競合**:
- `pnpm test`(ユニット): shared 58 / collector 1084 / frontend 1368 /
  e2e unit 50 = 全 green。
- `pnpm test:e2e`(プロトコル層): 6ファイル 24テスト全 green(約485秒)。
- UI 層とプロトコル層は共通の排他ロックにより直列実行され、ポート
  (UI: collector 4125 / vite 5275、プロトコル: 4123 等)も分離されているため
  衝突しない。UI 層テストがユニットテスト(`pnpm test`)に混入しないことも
  確認(testDir が src/ui/*.spec.ts に限定されている)。

**3. 目視確認(実ブラウザ操作 + スクリーンショット)**: 一時的に collector
(port 4127、稼働中スタックを観測)と vite dev(port 5276)を起動し、chromium で
実際に操作して以下を確認した。
- WS スナップショット疎通: collector から entities 29件(node 6 / workbench 1 /
  wallet 1 / block 21)+ edges が配信されていることを WebSocket 直接接続で確認。
- カード表示: A層カード(node/workbench)7枚を確認。beacon1 / reth1 に
  「Bootnode」バッジ、EOA ウォレットカード(残高・nonce)、ワークベンチカードを表示。
- ホバーポップオーバー: ノードカードにホバーで詳細ポップオーバー(IP アドレス
  172.28.2.1 / ポート 5052 / クライアント lighthouse / CPU 4.2% / メモリ 535MB
  等)が出現することを確認。
- 言語切り替え: トグルでヘッダタイトルが「chainviz — インフラ可視化」⇔
  「chainviz — Infrastructure」に切り替わることを確認(英語表示では
  Connected バッジ・Add node/Add workbench・NODE/WORKBENCH/EOA ラベル・
  Establishing P2P connection... エッジラベル・凡例文言まで正しく描画)。
- ドラッグ配置の永続化: UI-A-04(ドラッグ後・リロード後の transform 比較)が
  E2E で green。
- P2P エッジ: ノードカード間に peer エッジ2本、右下凡例に
  「Consensus network 1 / Execution network 1」を表示。
- ブロック伝播パルス: チェーン進行中に `.peer-pulse` 要素(2個)がエッジ上に
  実際に出現することを確認(UI-B-03 も green)。実測で数秒以内にパルスを検出。

補足: headless chromium にホスト側 CJK フォントが無いため、スクリーンショット
上では日本語がいわゆる tofu(□)で表示されるが、これはフォント未導入による
描画のみの問題であり、アプリの不具合ではない(言語トグルの E2E アサーション・
DOM テキスト取得では実際の日本語文言が正しく取得できている)。

**完了条件の充足**:
- SCENARIOS.md の UI シナリオ(UI-CONN-01 / UI-A-01〜05 / UI-B-01〜03、`保` を
  除く該当分)が全て実装され green: 満たす。
- プロトコル層に残すテスト(SCENARIOS.md §3)が引き続き green: 満たす。
- `pnpm lint && pnpm build && pnpm test` に UI 層テストが混入しない: 満たす
  (testDir 限定を確認)。

差し戻し・新規バグの起票は無し。
