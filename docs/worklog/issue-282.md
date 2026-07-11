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
