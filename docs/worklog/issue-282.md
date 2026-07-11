# Issue #282 fetchBeaconSyncingのhead_slotパースが非準拠値(空文字/null等)を静かに0として受理する

### 2026-07-11 設計メモ（着手前）

- 担当: collector
- ブランチ: issue-282-head-slot-parse-strict

#### 原因

`packages/collector/src/adapters/ethereum/beacon-api.ts` の
`fetchBeaconSyncing` は `head_slot` を `Number(data.head_slot)` で
パースし `Number.isFinite` のみで検査している。`Number(...)` は
JavaScript の緩い数値変換規則をそのまま適用するため、以下のような
Beacon API 仕様（10進文字列の uint64）に非準拠な値が静かに通ってしまう。

- `Number("")` → `0`（空文字列）
- `Number(null)` → `0`
- `Number("0x10")` → `16`（16進として解釈）
- `Number("1e3")` → `1000`（指数表記）
- `Number(" 10 ")` → `10`（前後空白を許容）

一方、フィールド自体が欠落（`undefined`）している場合は
`Number(undefined)` が `NaN` になり `Number.isFinite` で弾かれて
throw されるため、「欠落」と「空文字列/null」で扱いが非対称になっている
（Issue #274 のレビューで指摘済み、`docs/worklog/issue-274.md` の
「head_slot パース厳格化の判断」節を参照）。

#### 修正方針

`head_slot` の値が以下のいずれかの形のときのみ受理し、それ以外は
一律 throw する専用のパース関数 `parseHeadSlot` を新設する。

1. **10進整数文字列**: 正規表現 `/^\d+$/` に一致する文字列（先頭の
   `+`/`-`・空白・16進プレフィックス・指数表記を含まない、1桁以上の
   数字のみ）。一致した場合のみ `Number(...)` で変換する（正規表現を
   通過済みなので安全）。
2. **非負整数のJSON数値**: `typeof value === "number" &&
   Number.isInteger(value) && value >= 0`。既存テストで固定されている
   「JSON数値の head_slot も受理する」挙動（例: `head_slot: 16587`）を
   壊さないために必要（Issue #274 のテスト強化で追加された観点）。

上記のどちらにも当てはまらない値（空文字列・空白のみ・null・16進
文字列・指数表記文字列・負数・小数・非数値型・**欄が無い
undefined を含む**）は `parseHeadSlot` が `undefined` を返し、
呼び出し元でエラーメッセージ付きで throw する。これにより「欠落」も
「不正な値」も同じ検証経路を通るようになり、Issue本文が指摘した
非対称性も解消される（欠落時に個別の `undefined` チェックを別途持たない）。

エラーハンドリングの扱い（throw して呼び出し側でログさせ、キャッシュは
前回値を保持する）は既存の `is_syncing` のパターンをそのまま踏襲する
（新しいエラー処理方針を持ち込まない）。

#### 実装箇所

- `beacon-api.ts` にモジュール内ヘルパー `parseHeadSlot(value: unknown):
  number | undefined` を追加し、`fetchBeaconSyncing` 内の
  `Number(data.head_slot)` / `Number.isFinite` チェックを置き換える。
  Beacon API 固有の形状検証なので同ファイル内に閉じ込める
  （ChainAdapter 境界を越えない）。
- テストは `beacon-api.test.ts` の `fetchBeaconSyncing` describe に
  異常系ケースを追加する（空文字列・空白のみ・null・16進・指数表記・
  負数・小数・欠落）。既存の「JSON数値」「genesis の 0」「10進文字列」
  ケースは受理されたままであることを維持（回帰確認）。

#### 修正前の実際の挙動確認（着手前に確認する）

修正前のコードで以下を確認してから着手する。

- `head_slot: ""` → `headSlot: 0` として resolve される（本来はエラー）
- `head_slot: null` → `headSlot: 0` として resolve される（本来はエラー）
- `head_slot: "0x10"` → `headSlot: 16` として resolve される（本来はエラー）
- `head_slot: "1e3"` → `headSlot: 1000` として resolve される（本来はエラー）
- `head_slot` 欠落（undefined）→ 既に throw される（非対称の反対側）

修正後はいずれも throw されることを確認する。

### 2026-07-11 実装記録

- 担当: collector
- ブランチ: issue-282-head-slot-parse-strict

#### 実施内容

1. `packages/collector/src/adapters/ethereum/beacon-api.ts` に
   `parseHeadSlot(value: unknown): number | undefined` を追加し、
   `fetchBeaconSyncing` 内の `Number(data.head_slot)` /
   `Number.isFinite(...)` の判定を置き換えた。設計メモどおり、10進整数
   文字列（`/^\d+$/`）または非負整数の JSON 数値のみを受理し、それ以外
   （欠落 `undefined` を含む）は `undefined` を返す。呼び出し元は
   `headSlot === undefined` のとき従来と同じ throw 文言
   （`unexpected head_slot in ...`）を出す。
2. `beacon-api.test.ts` の `fetchBeaconSyncing` describe に、
   `it.each` で非準拠値（空文字列・空白のみ・null・16進文字列・
   指数表記文字列・前後空白付き数字・負数の文字列/数値・小数点付き
   文字列/数値・boolean・配列・オブジェクト）がすべて throw することを
   検証するケースと、JSON数値の `head_slot: 0` が受理される（genesis の
   `"0"` 文字列ケースと対になる境界値）ケースを追加した。既存の
   「10進文字列」「JSON数値」「genesisの"0"」「フラグ欠落」等の
   受理系ケースは変更していない（回帰なし）。

#### 修正前後の実測確認

- 修正前（`Number(...)` ベースの旧実装）に一時的に戻して
  `beacon-api.test.ts` を実行し、新規追加した非準拠値ケースのうち
  `""` / `" "` / `null` / `"0x10"` / `"1e3"` / `" 10 "` / `"-5"` /
  `"10.5"` / `-5` / `3.5` / `true` / `[16587]` の12件が実際に失敗する
  （＝旧実装が本 Issue の不具合を再現する）ことを確認した。
- 修正後の実装に戻し、同じテストがすべて成功することを確認した
  （新実装が実際に不具合を解消していることの確認）。

#### 確認コマンド

- `pnpm --filter @chainviz/collector build`: 成功。
- `pnpm --filter @chainviz/collector test`: 46 ファイル / 1242 件
  すべて成功（修正前 1228 件から +14）。

#### 未対応・次担当への申し送り

- `pnpm build` / `pnpm test`（リポジトリ全体、shared/frontend含む）は
  未実行。本 Issue は collector 単独の変更（`beacon-api.ts` の内部
  ロジックのみで shared 型・frontend への波及なし）のため、レビュー・
  QA 側での全体確認を想定している。
- `docs/ARCHITECTURE.md` §7.3 などの記述は Issue #274 で既に
  「Beacon API から head_slot を観測する」という仕組みの説明として
  確定済みであり、本 Issue はそのパースの厳格化のみのため追記していない。

### 2026-07-11 テスト強化記録

- 担当: tester
- ブランチ: issue-282-head-slot-parse-strict

#### 追加した観点

実装担当の基本テスト（受理系の回帰・主要な非準拠値の throw）を土台に、
`parseHeadSlot` の境界値と D層ループでの結合的な異常系を追加した。

1. `beacon-api.test.ts` の `fetchBeaconSyncing` に、`parseHeadSlot` の
   境界値ケースを追加（`parseHeadSlot` はモジュール内非公開関数のため
   `fetchBeaconSyncing` 経由で検証）。
   - 受理される境界値（`it.each`）: 先頭ゼロ付き 10進文字列 `"007"` →
     10進解釈で 7、genesis `"0"` → 0、`Number.MAX_SAFE_INTEGER` 相当の
     文字列 `"9007199254740991"` と JSON 数値、`MAX_SAFE_INTEGER` を
     超える 10進文字列 `"9007199254740993"`（`/^\d+$/` の形は満たすため
     受理するが JS の倍精度で precision が失われ 9007199254740992 になる、
     という現挙動を明示的に固定）。
   - throw される境界値（`it.each`）: 全角数字 `"１２３"`・Arabic-Indic
     数字 `"٣"`（`\d` は Unicode フラグ無しで ASCII 数字のみに一致する
     ことの確認）、符号付き文字列 `"+5"`、JSON 数値の `Infinity` / `NaN`
     （`Number.isInteger` で弾かれる非整数の防御）。
2. `resolveBeaconSyncStatus` / `BeaconSyncStatusCache` は既存テストで
   真理値表 8 通り・genesis 0・forgetNode・再観測などを網羅済みのため、
   パース厳格化に伴う追加は不要と判断（既存 21 件が引き続き通ることを確認）。
3. `peer-block-adapter.test.ts` の Beacon API 由来の syncStatus describe
   （Issue #274）に、D層ループでの結合的な異常系を 2 件追加。
   - 片方の beacon が非準拠 `head_slot`（16進文字列 `"0x10"`。旧実装が
     静かに 16 として受理していた値）を返しても、`pollOneBeaconSync` が
     ノード単位で握って（stableId と head_slot をログして）返すため D層
     ループがクラッシュせず、健全な sibling beacon（`head_slot` 4242）は
     巻き添えにならず解決されること。`console.error` に失敗ノードの
     stableId と head_slot が残る（握りつぶさない）ことも確認。
   - 非準拠値は一時的な縮退として扱い、次周期で準拠値（`"512"`）に戻れば
     解決へ回復すること（旧実装のように誤った値で埋めたまま固まらない）。

#### 確認コマンド

- `pnpm --filter @chainviz/collector build`: 成功。
- `pnpm --filter @chainviz/collector test`: 46 ファイル / 1254 件すべて
  成功（テスト強化前 1242 件から +12）。

#### 実装バグの疑い

- なし。追加した境界値・異常系はいずれも現実装の意図どおりに振る舞う
  （非準拠値は例外なく throw され、`pollOneBeaconSync` がノード単位で
  握って他ノードに波及させない）。実装ロジックへの変更は行っていない。

### 2026-07-11 レビュー記録

- 担当: reviewer
- ブランチ: issue-282-head-slot-parse-strict
- 判定: **合格**

#### 確認した内容

1. **MAX_SAFE_INTEGER 超過値の precision 欠落を伴う受理の許容可否**:
   許容できると判断。slot は 12 秒間隔で進むため 2^53 (約 9.007e15) に
   到達するには約 34 億年かかり、実運用で到達する可能性は事実上ゼロ。
   仮に非準拠クライアントが桁あふれした値を返しても、head_slot は
   表示・比較用の観測値であり、誤差 1〜2 の表示ズレに留まる（syncStatus
   判定はフラグのみで決まるため波及しない）。この前提はテストコードの
   コメントに明記されており、「固定値の前提条件をコメントに残す」運用
   ルールも満たしている。
2. **エラー経路**: `fetchBeaconSyncing` の throw は
   `pollOneBeaconSync`（`index.ts`）の catch で stableId と実際の
   エラーオブジェクトごと `console.error` に出力され、握りつぶしなし。
   ノード単位で return するため `Promise.all` の D層ループ全体・他ノード
   には波及しない。この両面（握りつぶさない/適切に閉じ込める）が
   `peer-block-adapter.test.ts` の新規テスト 2 件で実際に検証されている。
3. **欠落時の非対称性の解消**: 欠落 `undefined` は `parseHeadSlot` の
   最終 `return undefined`（非 string・非 number の経路）を通り、空文字列
   /null 等の不正値と同一の throw 経路に統一された。Issue #274 時点の
   「欠落は throw、空文字列/null は 0 受理」という非対称は解消。
4. **ビルド・テスト**: リポジトリ全体で `pnpm build` / `pnpm lint` /
   `pnpm test` すべて成功（shared 62 / collector 1254 / frontend 1884 /
   e2e 158 件）。
5. **テストの質**: 修正前実装に戻して新規テスト 12 件が失敗することを
   実装担当が確認済み（ミューテーション確認）で、「壊れたコードでも通る
   無意味なテスト」ではない。境界値（先頭ゼロ・全角/Arabic-Indic 数字・
   符号付き・Infinity/NaN・MAX_SAFE_INTEGER 前後）と結合異常系（sibling
   非汚染・次周期回復）の両面をカバー。
6. **コミット粒度**: 5 コミット（fix 1・test 2・docs 2）でいずれも
   単一の関心事。Conventional Commits 準拠。
7. **境界の遵守**: `parseHeadSlot` は `adapters/ethereum/beacon-api.ts`
   内に閉じており、shared 型・frontend への波及なし。docs
   （PLAN.md のチェック+Issue リンク、WORKLOG.md 索引、本ファイル）も
   実装と一致。`docs/ARCHITECTURE.md` §7.3 は仕組みの説明として既存の
   記述で足りており追記不要という実装担当の判断も妥当。

#### 非ブロッキングの所見（対応不要、記録のみ）

- `parseHeadSlot` の文字列経路は `/^\d+$/` 通過後の `Number(...)` 結果に
  有限性チェックを持たないため、理論上 309 桁以上の数字列は `Infinity`
  として受理される（JSON 数値経路の `Infinity` は `Number.isInteger` で
  弾かれるのと対照的）。ただし Beacon API 仕様の uint64 は最大 20 桁で
  あり、既に許容した precision 欠落よりさらに遠い理論上の話のため、
  差し戻し対象とはしない。将来 `parseHeadSlot` を汎用化する際に
  思い出すこと。

### 2026-07-11 QA検証記録

- 担当: qa
- ブランチ: issue-282-head-slot-parse-strict
- 判定: **合格**

#### 検証の狙い

Issue #282 の head_slot パース厳格化が、Issue #274 で実装した beacon
（consensus 役割）ノードの同期状態表示（同期済み/ヘッドスロット）の正常
動作を壊していないことを、稼働中の実 Ethereum スタックの実データで確認する
（回帰確認）。

#### 実施環境

- 稼働中の `chainviz-ethereum` スタック（reth1/2・beacon1/2・validator1/2・
  workbench。beacon1 が `localhost:5052`、reth1 が `localhost:8545` を公開）
- 本ブランチの collector を `pnpm --filter @chainviz/collector build` で
  ビルドし、`CHAINVIZ_ETHEREUM_PROFILE_DIR` を profiles/ethereum に向けて
  `node dist/index.js` で起動

#### 実施内容と結果

1. **実 Beacon API レスポンスの形の確認**: `GET
   http://localhost:5052/eth/v1/node/syncing` は
   `head_slot":"18847"` のように head_slot を10進整数文字列で返す。これは
   `parseHeadSlot` の受理形式（`/^\d+$/`）に合致する。数秒間隔で観測すると
   head_slot が 18852 → 18854 → 18855 と進行しており、チェーンが稼働中で
   あることも確認。
2. **collector 経由の同期状態表示（WebSocket 疎通）**: WebSocket
   （`ws://localhost:4000`）に接続し、snapshot と diff を受信して consensus
   役割（beacon）ノードの `syncStatus` / `blockHeight`（=head_slot）を約30秒
   追跡した。beacon1/beacon2 とも一貫して `syncStatus="synced"` を示し、
   `blockHeight` は 18913 → 18915 → 18918 → 18920 → 18923 → 18925 と実際の
   head_slot 進行に追従して更新され続けた。厳格化したパースが実データの
   10進整数文字列 head_slot を正しく受理し、同期状態表示が正常に機能する
   ことを確認。
3. **collector ログのエラー確認**: 起動から検証終了まで collector の標準
   出力・標準エラーに error / unexpected / head_slot / throw / fail /
   warn のいずれの語も出力されなかった（WebSocket・ロギングプロキシの
   listen ログのみ）。厳格化により正常レスポンスが誤って弾かれてログを
   汚すようなことは起きていない。

#### 完了条件との対応

- 「Issue #282 の修正が Issue #274 の beacon 同期状態表示の正常動作を
  壊していないこと」: 満たしている。実データで beacon の同期済み表示と
  head_slot 追従更新が正常動作し、collector にエラーも出ていない。
