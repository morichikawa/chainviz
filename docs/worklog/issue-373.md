# Issue #373 UI-CMD-07: ワークベンチ削除ボタンがE2E上でstableにならないことがある(原因調査)

### 2026-07-17 Issue #373 起票(Issue #346からの分割)とバックログ追記のレビュー

- 担当: reviewer
- ブランチ: docs-issue-371-backlog
- 内容: Issue #346(UI層E2Eテストのflaky不具合)の対応中、UI-CMD-07 の
  「削除ボタンが stable にならない」事象だけが原因不明のまま再現できな
  かったため、統括が Issue #373 として分割起票し、`docs/PLAN.md` の
  バックログへ追記した。あわせて #346 の既存項目の記載を実際に判明した
  解決経緯で更新した。その内容をレビューした。
- レビュー結果: 合格
  - Issue #373 本文と PLAN.md の追記が過不足なく一致(#346 からの分割で
    あること・クリーンな環境で6回連続実行しても再現できなかったこと・
    preserveDraggingState(Issue #328)のコードレビューでも断定できる原因が
    見つからなかったこと・着手時は chainviz-detective による原因調査から
    始めること・クリーンな独立した合成環境が望ましいこと)
  - #346 の記載更新も裏付けを確認: chainviz-frontend の調査・実装記録が
    ブランチ `issue-346-e2e-hover-flakiness` 上の
    `docs/worklog/issue-346.md` に実在し、UI-C-04/UI-D-03 は Issue #245 の
    PopoverPortal 化で locator の子孫スコープが壊れていたことの発見と修正、
    UI-ERR-02 は Issue #235 の修正にテストが追随していなかったことの
    発見と修正、UI-CMD-07 の不再現と分割提案、のいずれも PLAN.md の
    更新文と一致
  - 追記フォーマットは既存バックログ項目と一貫。#346 のチェックボックスを
    未完了のまま残す判断(修正ブランチが未マージ・Issue も OPEN)も適切
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過
- 決定事項・注意点:
  - Issue #373 本文と本ブランチの PLAN.md が参照する
    `docs/worklog/issue-346.md` のフロントエンド調査記録は、本ブランチ
    ではなく `issue-346-e2e-hover-flakiness` ブランチにのみ存在する。
    main 上で参照が成立するのは同ブランチのマージ後
  - 本ブランチと `issue-346-e2e-hover-flakiness` は PLAN.md の #346 項目を
    それぞれ異なる文面で更新しており、後からマージする側でコンフリクトが
    発生する見込み。本ブランチの文面(#373 への分割まで反映)のほうが
    新しく正確なため、解消時はこちらを優先するのがよい
  - 実装(原因調査)着手は後日。着手時はまず chainviz-detective に依頼し、
    共有 Docker スタックの環境汚染の影響を避けるため独立した合成環境
    (Issue #369 の解決が前提になり得る)で行うことが望ましい
  - docs 配下のみの変更のため、CLAUDE.md の例外規定に基づき
    chainviz-qa は省略(reviewer 合格のみ)

### 2026-07-18 Issue #373 原因調査(detective)

- 担当: detective
- ブランチ: issue-373-ui-cmd-07-investigation
- 結論: **根本原因を特定し、実際に再現に成功した**。「削除ボタンが stable に
  ならない」は誤読で、実際は**削除ボタンがビューポート外にあり、Playwright が
  クリック可能になるのを永久にリトライしていた**。原因はフロントエンドの
  初期 fitView のタイミング競合(下記)。

## 1. 再現した症状

共有 Docker スタックは他 Issue の並行作業で使用中のため使わず、**Docker に
一切依存しない隔離合成環境**を構築して再現した:

- 偽 collector(実プロトコル `snapshot`/`diff`/`commandResult` を話す
  WebSocket サーバ。scratchpad 上のスクリプトで、リポジトリのコードは
  一切変更していない)を起動し、実スタック相当の世界状態(ノード6 + 静的
  ワークベンチ1 + ウォレット + ブロック + ピアエッジ)と、実環境相当の
  差分トラフィック(ブロック 12 秒周期、リソース/残高パッチ 3 秒周期、
  nodeLinkActivity 3 秒周期)を配信
- 実フロントエンド(vite dev、`VITE_COLLECTOR_URL` で偽 collector を指定)
- **実物の `packages/e2e/src/ui/commands-workbench.spec.ts`** を、
  globalSetup(Docker 起動)を除いた scratch Playwright 設定
  (timeout 102 秒 = 本番設定と同値)で実行

結果: **UI-CMD-05/06 は合格、UI-CMD-07 のみ 102 秒タイムアウトで失敗**。
原報告(issue-322.md の QA 記録)と完全に同じ形。エラーのコールログ:

```
locator resolved to <button ... aria-busy="false" ... data-testid="infra-card-remove-chainviz-ethereum/e2e-ui-alice">×</button>
attempting click action
  194 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - element is outside of the viewport
    - retrying click action
```

原報告の観測(ボタンは解決できて aria-busy=false、
「waiting for element to be visible, enabled and stable」が延々続く、
102 秒タイムアウト)がすべて一致する。QA が「stable 判定が成立しない」と
読んだのは、Playwright がリトライごとに繰り返し出す集約行
`194 × waiting for element to be visible, enabled and stable` のこと。
実際には毎回のリトライで stable 判定自体は**通過**しており
(`element is visible, enabled and stable`)、その直後の
**`element is outside of the viewport`** が真の失敗理由だった。

## 2. 検証した仮説と実測結果

| 仮説 | 検証方法 | 結果 |
| --- | --- | --- |
| カードが毎フレーム位置変動して stable にならない(#328 系) | 失敗発生中のページ内で rAF ごとに削除ボタン3個の getBoundingClientRect を30秒間サンプリング | **棄却**。1805 フレームで rect 変化 0 回。rAF 間隔も正常(p95=17ms)。ボタンは完全に静止していた |
| rAF が発火せず stable 判定の Promise が未解決のまま停止 | Playwright 1.61 の `_checkElementIsStable` 実装を読解 + 上記 rAF 計測 | **棄却**。rAF は正常に発火。なお実装上、要素が動いていれば「element is not stable」がログに出るはずで、原報告のログの形とも合わない |
| ビューポートを継続的に動かす経路(自動パン等)がある | frontend 全体で `setCenter`/`setViewport`/`fitView`/`zoomTo` を grep | **棄却**。あるのは初回 `fitView` prop とパネル行クリック時の `setCenter` のみ(後者は本テストで不使用) |
| 削除ボタンがビューポート外に置かれ、クリックが永久リトライ | 失敗発生時の全カード rect とビューポート transform をダンプ | **裏付け**。transform が `translate(260px, -279.5px) scale(2)`(zoom = maxZoom の 2)で、`e2e-ui-alice` のカードが screen x=1940(ビューポート幅 1280 の外)にあった |
| 初期 fitView が snapshot 到着前に発火している | ページ内の rAF 毎に「WS イベント・ノード数・transform」を時系列記録(6回反復) | **確定**。全 6 回とも「nodes=1(空のチェーンリボンのみ)の時点で fitView が発火し zoom=2 に確定 → 直後に snapshot が届き 17 ノード描画 → 以後 transform は二度と変わらない」。ある実測: app の WS 接続 t=303ms → **fit 発火 t=337ms(リボン1枚のみ)** → snapshot 到着 t=344ms → 17 ノード描画 t=402ms |

## 3. 根本原因

因果の連鎖は次のとおり:

1. `Canvas.tsx` は React Flow に `fitView` prop を渡している。これは
   「ノードが初めて計測できた時点で 1 回だけ」実行される初期フィット
2. チェーンリボン(Issue #298)は**ワールドステート到着前から常に nodes
   配列に存在する唯一のノード**。そのため初期フィットは高確率で
   「タイルが空の小さなリボンカード 1 枚」に対して実行され、ズームが
   maxZoom(=2)に張り付いた状態でリボン付近へ寄る
3. 直後に snapshot が届いてカード群(420px ピッチのグリッド配置)が現れるが、
   **再フィットは二度と行われない**。zoom=2 では可視フロー領域が実質
   640×360 しかなく、グリッド後方のカードはビューポート外に置かれる。
   UI-CMD-07 の配置(インフラカード10枚)では `e2e-ui-alice`(グリッド
   (840,0))が圏外、`e2e-ui-carol`/`carol-2`((0,200)/(420,200))は圏内
   になる — 実際に合成環境でも alice のクリックだけが失敗した
4. React Flow のキャンバスはスクロールコンテナではなく CSS transform で
   パンするため、Playwright の自動スクロール(scrollIntoViewIfNeeded)は
   何もできず、`click()` は「visible/enabled/stable は通過 →
   outside of the viewport → リトライ」をテストタイムアウト(102秒)まで
   繰り返す。`toBeVisible()`/`toHaveCount()` はビューポート内であることを
   要求しないため、テスト前半の出現確認は全部通ってしまい、クリックだけが
   失敗する
5. snapshot の描画が React Flow の初期計測より**先に**間に合った場合は
   全カードを含む正しいフィットになり合格する。勝敗を分ける窓は数十 ms
   しかなく、マシン負荷・タイミングで揺れる — これが flaky の正体。
   Issue #322 の QA 時(フルスイート実行中の高負荷ホスト)は悪い側に
   倒れ続け、後日の frontend 調査(6 回連続合格)は良い側に倒れ続けたと
   説明できる。テストごとに新しいページを開くので、この競合はテスト単位で
   独立に再抽選される(同一セッション内で UI-CMD-01〜04 が通って 07 だけ
   落ちたこととも整合する)

同じ根本原因が、同 QA セッションで観測された **UI-D-03 の
「element is outside of the viewport」失敗**(こちらは QA が正しく
ビューポート外と診断済み)も説明する。また、`afterAll` の
`cleanupRemovableCards` も同じ理由でクリックに失敗するため、実 Docker
環境ではコンテナ残留(共有スタックに `workbench-3` 等が残る現象)の
一因にもなり得る。

補足(正直な限定): 当時の失敗トレース(`trace: retain-on-failure`)は
後続のテスト実行で上書き済みで、原失敗の生ログそのものは検分できて
いない。ただし原報告に記録された観測(102 秒・aria-busy=false・
「waiting for element to be visible, enabled and stable」の繰り返し)は
本再現の出力と 1 点残らず一致しており、別原因(毎フレームの位置変動)は
上記のとおり実測で棄却できたため、これを根本原因と断定する。

## 4. 次にどうすべきか

- **修正の主担当は frontend**(`packages/frontend`)。初期 fitView が
  「空のリボンだけを見て確定してしまう」ことが根本原因なので、対応の
  方向性は例えば: 最初の snapshot 反映後にフィットする(`fitView` prop を
  やめ `hasReceivedSnapshot` を契機に `fitView()` を 1 回呼ぶ)、
  もしくは初期フィットの `maxZoom` を抑える等。挙動仕様(いつフィット
  すべきか)の判断を含むため、chainviz-designer で方針を決めてから
  chainviz-frontend が実装する流れを推奨する
- **e2e 側の追随も検討**(`packages/e2e`): 本質修正とは別に、カードを
  実座標でクリックするテストは「ビューポート外だと永久リトライになる」
  構造的な脆さを持つ。クリック前に対象を確実に可視化する共通ヘルパー
  (React Flow の fitView をテスト側から起動する、等)を挟むと再発時に
  すぐ気付ける
- 再現手段として、本調査で使った「偽 collector + 実フロント + 実 spec」の
  合成環境(scratchpad のスクリプト。リポジトリ非汚染)が修正後の回帰
  確認にもそのまま使える。修正担当が必要なら手順を引き継ぐ
- なお、完全隔離の実 Docker 合成環境は Issue #369(composeProject の
  ハードコード)未実装のため現状構築できない(compose のプロジェクト名・
  ネットワークサブネット・collector の探索ラベルがすべて固定値)。今回は
  Docker 非依存の合成環境で代替した

## 5. 調査環境のクリーンアップ

- 偽 collector(port 4899)・vite(port 5379)は調査終了時に停止済み
- 共有 Docker スタック・他 worktree には一切触れていない
- リポジトリへの変更は本 worklog と `docs/WORKLOG.md` 索引のみ
