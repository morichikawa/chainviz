# Issue #243 validator clientノードの同期状態が永久に「同期中」(blockHeight 0)と表示される

### 2026-07-11 Issue #243 調査（Issue #215 で解消済みの確認）

- 担当: designer（設計）
- ブランチ: issue-243-validator-sync-display
- 内容: 本 Issue の症状が Issue #215（単位A、ノード役割可視化）の実装で
  既に解消されているかを、コードの静的確認と実機（実 Docker スタック +
  実 collector + 実ブラウザ）の両方で検証した。**結論: Issue #215 で
  解消済み。コード変更・型変更は不要**。設計フェーズのみで完結する。

## 判定の根拠

### 静的確認（#215 の対応内容と本 Issue の症状の対応関係）

Issue #215 は `NodeEntity.nodeRole`（compose の `com.chainviz.role`
ラベル由来の生文字列）を導入し、frontend の
`packages/frontend/src/chain-profiles/ethereum/nodeRoles.ts` が
`showsSyncState` フラグ（「このノードはチェーンのコピーを同期する係か」）
で表示を制御するようにした。`nodeRole: "validator"` は
`showsSyncState: false` であり:

- `InfraPopover.tsx`: `nodeShowsSyncState(entity.nodeRole)` が false の
  とき「同期状態」「ブロック高」の2行を出さない（本 Issue が報告した
  「永久に『同期中』/ブロック高 0」の表示経路そのもの）
- `InfraNodeCard.tsx`: 同条件でカードヘッダの同期状態ドット
  （`infra-card__status`。syncing だと常時「不調」色）自体を描画しない
- 上記2箇所以外に validator の `syncStatus`/`blockHeight` が表示に漏れる
  経路が無いことを確認した:
  - カード面の同期ステージミニバー（`InfraNodeCardSyncProgress`）は
    `syncStatus === "syncing"` かつ `internals.syncStages` が条件。
    validator は D層観測（reth メトリクス）の対象外で `syncStages` を
    決して持たないため表示されない
  - `syncProgress.ts` の `computeMaxSyncTargetHeight`（同期ミニバーの
    分母）は `internals.syncStages` を持つノードのみ集計するため、
    validator の `blockHeight: 0` が分母計算を汚染することもない
- ユニットテストも既に本 Issue の症状ケースを直接カバーしている
  （`InfraPopover.test.tsx`「hides the sync and blockHeight rows for a
  validator node」ほか、`syncStatus: "syncing"` の validator でドットが
  出ないこと・synced の実データを持っていても役割駆動で隠すことまで
  網羅済み。#215 のテスト強化時に追加されたもの）

### 実機確認

稼働中の chainviz-ethereum スタック（7コンテナ、2026-07-11 再作成済み =
`com.chainviz.role` ラベル付き）に対し、本ブランチをビルドした検証用
collector（ポート4300/4301。既存の別セッション用 collector 4000/4001 には
触れていない）と vite dev server（ポート5273、`VITE_COLLECTOR_URL` で
4300 へ接続）を起動し、Playwright（chromium）で実際に描画を確認した。

1. **collector の WS スナップショット**: validator1/validator2 は
   `nodeRole: "validator"`, `p2pRole: "none"`, `syncStatus: "syncing"`,
   `blockHeight: 0`。つまり **collector は本 Issue が指摘したとおり今も
   プレースホルダ（syncing/0）を配信している**が、`nodeRole` が併せて
   届いている
2. **validator1 のポップオーバー（実ブラウザ）**: IP・ポート・プロセス・
   CPU・メモリ・クライアント・役割「バリデーター」のみが表示され、
   「同期状態」「同期中」「ブロック高」はいずれも表示されない
3. **対照（reth1 のポップオーバー）**: 「同期状態: 同期済み」「ブロック高:
   2286」が従来どおり表示される（execution の表示は非退行）
4. **カードの同期状態ドット**: validator1 は 0 個、reth1 は 1 個
5. 検証用 collector/vite プロセスは確認後に停止済み（別セッションの
   collector 4000/4001 は温存）

## 設計判断（collector 側を変更しない理由）

Issue 本文が指摘した collector 側のフォールバック
（`packages/collector/src/adapters/ethereum/index.ts` の `toEntity` が
同期観測キャッシュ未命中時に `syncStatus: "syncing"` / `blockHeight: 0` を
与える）は**変更しない**。理由:

- shared の `NodeEntity.syncStatus`/`blockHeight` は必須フィールドであり、
  validator だけ省略可能にする型変更は、既存の全消費箇所（collector の
  diff/store、frontend の導出関数群）へ波及する割に、ユーザーに見える
  改善が無い（表示は既に `showsSyncState` で役割駆動に制御されている）
- 「同期という概念を持たないノードの表現」という本 Issue の設計判断は、
  #215 が「データ（プレースホルダは配信し続ける）と表示（役割で出し分ける）
  の分離」という形で既に下している。frontend のテストにも「validator が
  実データ（synced/777）を持っていても表示しない = 表示は role-driven で
  data-driven ではない」という契約が固定されており、この方針と一貫する
- collector は `nodeRole` の解釈をしない（ChainAdapter 境界: 生ラベルの
  転記のみ。値の意味づけはフロントのチェーンプロファイル表現セットの責務）
  という #215 の整理を崩さない

## 前提条件・注意点

- この解消は **validator コンテナが `com.chainviz.role: "validator"`
  ラベルを持つこと**（= #215 以降の compose テンプレートでコンテナが
  作成されていること）が前提。#215 より前に作成された稼働中スタックでは
  ラベルが無く `nodeRole` が省略されるため、フォールバック（従来どおり
  同期状態を表示）に倒れて症状が残る。その場合は `docker compose up -d`
  等でのコンテナ再作成が必要（コードの不具合ではなく運用上の注意）
- `nodeRole` 省略時に同期表示を出す既存挙動（`nodeShowsSyncState` が
  `true` を返す）は、旧スナップショット・未知チェーンとの互換のための
  意図された仕様であり、変更しない

## 派生して起票した Issue（本 Issue の範囲外）

CL ノード（beacon1/beacon2、`nodeRole: "consensus"`）も
`syncStatus: "syncing"` / `blockHeight: 0` のまま永久に変わらないことを
同じ実機確認で観測した（consensus は `showsSyncState: true` のため
ポップオーバーに「同期状態: 同期中 / ブロック高 0」が出続ける）。これは
同期観測の情報源が reth の Finish checkpoint（EL のみ）であることによる
`docs/ARCHITECTURE.md` §7.3 に明記済みの既知ギャップだが、「健全なのに
不調に見える」という利用者可視の症状としては #243 と同種のため、
[#274](https://github.com/morichikawa/chainviz/issues/274) として起票した
（対処の設計は本 Issue のスコープ外。validator と違い beacon は「チェーンを
追う係」なので表示を消す対処は不適切で、値の情報源の設計が必要）。

## 完了状態

- コード変更なし（docs のみ）。`docs/PLAN.md` のバックログに #243 の
  項目を追加し、調査完了としてチェックを付けた
- Issue のクローズは統括の判断に委ねる（コード変更が無いため PR の
  `Closes #243` による自動クローズか、手動クローズかは統括が選択する）
