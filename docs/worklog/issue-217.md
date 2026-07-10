### 2026-07-10 Issue #217 エラー時のトースト通知が長文で右下のポップアップが崩れる

- 担当: frontend
- ブランチ: issue-217-toast-layout-fix

#### 設計メモ（着手前）

対象ファイル:
- `packages/frontend/src/notifications/Toast.tsx`（コンポーネント本体、変更なし）
- `packages/frontend/src/styles.css`（`.toast-stack` / `.toast` / `.toast__message` の CSS。ここを修正する）

再現方法（着手前に実施）:
1. `packages/frontend/src/app/App.tsx` に一時的なデバッグ用 `useEffect` を追加し、
   URL に `?repro217=1` を付けたときだけ `notify()` を長文エラー（複数行・
   ハイフンなしの長いファイルパスや64桁の16進文字列を含む、Issue #209 で
   実際に問題になった forge/cast の生エラーに似た文字列）で1回呼ぶようにした
   （実装完了後に削除する前提の一時コードであることをコメントに明記）。
2. `pnpm --filter @chainviz/frontend dev` で Vite dev サーバーを起動（モック
   クライアントがデフォルトなので collector 不要）。
3. `packages/e2e` が devDependency に持つ Playwright（Chromium）を使い、
   `http://localhost:<port>/?repro217=1` をヘッドレスで開いてスクリーンショットを
   取得。あわせて `.toast` / `.toast__message` の `getBoundingClientRect()` を
   `page.evaluate` で取得し、実際の描画幅を数値でも確認した。

原因（実測で確定）:
- `.toast-stack` は `max-width: 360px` を持ち、`.toast`（flex item）自体の幅は
  正しく360pxに収まっていた（`toastRect.width === 360`）。
- しかし `.toast__message`（`.toast` 内の `flex: 1` な子要素）の実測幅は
  512.67px あり、親の360pxを大きく超えて右にはみ出していた
  （`msgRect.right(1429.67) > toastRect.right(1264)`）。これが「右下のポップ
  アップが崩れる」の直接原因。
- Flexbox の仕様上、flex item の `min-width` の初期値は `auto` であり、
  明示的に `min-width: 0` を指定しない限り「中身のコンテンツが持つ最小幅
  （＝改行できない最長の連続文字列の幅）」を下回って縮まない。今回のテスト
  文字列に含まれる64桁の16進文字列やスラッシュ区切りの長いパスの一部が、
  デフォルトの折り返し規則（`overflow-wrap: normal`）では360px幅の枠内で
  折り返せない「1つの塊」と判定され、`.toast__message` がその塊の幅ぶん
  最小幅を持ってしまい、`flex: 1` によるシュリンクが効かず親を突き破って
  右にはみ出していた。
- `.toast` 自体も `.toast-stack` の flex item であり同じ理論上のリスクを
  持つが、今回の実測では `.toast` の直接の子は `.toast__message`
  （テキスト）と `.toast__dismiss`（×ボタン、`flex-shrink: 0` で固定幅）
  のみで、テキスト側の `min-width: auto` の影響がまず子要素側に出ていた。
  ただし将来 `.toast` に別の子要素が増えるケースに備え、`.toast` 自身にも
  同じ対策（`min-width: 0`）を入れておく（守りを二重にしておく）。

修正方針:
1. `.toast` と `.toast__message` の両方に `min-width: 0` を追加し、
   flex item のデフォルトの「縮まない」挙動を止める。
2. `.toast__message` に `overflow-wrap: anywhere` を追加し、スペースの
   無い長い文字列（16進アドレス・ハッシュ・URL・ファイルパス等）でも
   360px 幅の中で強制的に折り返せるようにする。
3. `.toast__message` に `white-space: pre-wrap` を追加する。現状は通常の
   `white-space: normal` のため、複数行のエラー文字列に含まれる改行が
   すべて1つのスペースに畳まれて長い1行になってしまう。`pre-wrap` に
   すると、元のメッセージに含まれる改行はそのまま活かしつつ、長い行は
   引き続き折り返される（`overflow-wrap: anywhere` と両立する）。
4. 1件のトーストが極端に長い（多数行のスタックトレース等）場合の保険として、
   `.toast__message` に `max-height` と `overflow-y: auto` を追加し、
   1件のトーストが画面を占有し続けないようにする（Issueの補足にある
   「スクロール等」に対応）。上限値は「トースト内で無理なく読める行数」
   という表示上の設計値であり、CLAUDE.md が禁止する「観測状態に依存した
   固定値」（実行時に変動しうる値をハードコードするケース）とは性質が
   異なる純粋な UI 上限値のため、決め打ちで問題ない。
5. トースト通知一覧全体（`.toast-stack`）の高さの上限は今回のスコープ外と
   する。今回問題になっているのは「1件のメッセージが長い」ケースであり、
   同時に大量のトーストが積み上がって画面からあふれるケースは別の性質の
   問題（現状は1操作1トーストなので実運用ではまず起きない）。気づいた点
   として記録だけ残す。

ロジックを伴わない純粋な CSS 修正のため、CLAUDE.md の方針どおりユニット
テストは追加しない（`Toast.tsx` 自体の TSX / ロジックは変更していない）。

#### 実装記録

- 内容: `packages/frontend/src/styles.css` の `.toast` / `.toast__message` に、
  上記設計メモどおり `min-width: 0` / `overflow-wrap: anywhere` /
  `white-space: pre-wrap` / `max-height: 220px` + `overflow-y: auto` を追加。
  `Toast.tsx` 自体のロジック・マークアップは変更なし。
- 再現・修正確認の手順（実測）:
  1. `App.tsx` に一時的な `useEffect`（`?repro217=1` で長文エラーを1件
     `notify()` する）を追加し、`pnpm --filter @chainviz/frontend dev` で
     Vite dev サーバーを起動（モッククライアントがデフォルトなので
     collector 不要）。
  2. `packages/e2e` の devDependency である Playwright の Chromium
     （`@playwright/test` の headless_shell バイナリ）を、この開発環境では
     `libnspr4.so` 等の共有ライブラリが system 側に見当たらずそのままでは
     起動できなかったため、`chromium_headless_shell`（依存ライブラリが
     少ない headless 専用ビルド）を使い、あわせて事前に用意されていた
     scratchpad 配下の抽出済み `.deb` ライブラリ（`libnspr4.so` /
     `libnss3.so` 等）を `LD_LIBRARY_PATH` に追加して起動した。
  3. 修正前: `.toast__message` の実測幅が 512.67px（親 `.toast` の実測幅
     360px を大きく超過）で、スクリーンショット上もトーストが画面右端の
     外まではみ出して閉じるボタン（×）が見えない状態になることを確認。
  4. 修正後: `.toast__message` の実測幅は 311px（360px の枠内）に収まり、
     スクリーンショット上も枠内に収まって×ボタンも正しい位置に表示される
     ことを確認。あわせて `scrollHeight(346px) > clientHeight(220px)` と
     `overflow-y: auto` により、上限を超えた分はスクロールで読める状態に
     なっていることも確認。
  5. 修正確認後、`App.tsx` の一時コードは削除（`git status` で
     `packages/frontend/src/styles.css` のみが変更されていることを確認済み）。
- 検証: `pnpm build` / `pnpm lint` / `pnpm test`（リポジトリ全体、
  `packages/shared` `packages/collector` `packages/frontend` `packages/e2e`
  の4パッケージすべて）を実行し、いずれも成功（既存テストの回帰なし）。
  ロジック変更を伴わない CSS のみの修正のため新規ユニットテストは追加して
  いない。
- 気づいた点（このIssueのスコープ外として記録のみ）: `.toast-stack`
  自体の高さには上限がない。現状は1操作につき1トーストが基本のため
  同時に大量のトーストが積み上がって画面からあふれる状況は考えにくいが、
  将来同時多発的にエラーが出るケースが増えるなら別途検討の余地がある。

### 2026-07-10 Issue #217 レビュー（合格）

- 担当: reviewer
- 対象: ブランチ `issue-217-toast-layout-fix`（コミット 5e7f5d8、CSS のみの変更）
- 結果: **合格**。

確認した内容:

- 原因分析の妥当性: `.toast-stack`（column flex・`max-width: 360px`）→
  `.toast`（row flex）→ `.toast__message`（`flex: 1`）という構造を確認。
  row flex item の `min-width` 初期値 `auto` が「折り返せない最長の連続
  文字列の min-content 幅」を下回って縮まないという分析は CSS Flexbox
  仕様（automatic minimum size）と一致し、worklog の実測値
  （`.toast` は 360px のまま・`.toast__message` だけが 512.67px）とも
  整合する。妥当。
- 短いメッセージへの副作用: `min-width: 0` / `overflow-wrap: anywhere` は
  通常の折り返し可能な短文には影響しない。`max-height: 220px` +
  `overflow-y: auto` も短文では発動しない。副作用なし。
- `white-space: pre-wrap` の影響範囲: トースト文言の生成元は
  `describeCommandError()`（`commandMessages.ts`）のみで、i18n の定型文
  （`messages.ts` に `\n` リテラルなし）＋ collector の error 文字列
  （`error?.trim()` で前後の空白・改行は除去済み）の連結。pre-wrap で
  挙動が変わるのは「error 内部の改行・連続スペースが保持される」点のみで、
  これは複数行エラーを読みやすくする意図どおりの変更。先頭・末尾の
  余分な空行が出る経路は無い。
- 再現用の一時コード（`App.tsx` の `?repro217=1`）が削除済みであることを
  grep で確認（`repro217` の残存なし）。
- ユニットテスト未追加の判断: `Toast.tsx` を含む TS/TSX のロジック変更が
  一切無い純粋な CSS 修正のため、CLAUDE.md の「純粋な UI の見た目調整は
  テスト対象外」に該当し妥当。
- `max-height: 220px` の固定値: 実行時の観測値に依存しない表示上の設計値
  であり、前提がコード内コメントと本 worklog の両方に明記されている。
  「観測状態依存の固定値の禁止」ルールに抵触しない。
- `pnpm build` / `pnpm lint` / `pnpm test`（リポジトリ全体）すべて通過
  （frontend: 105 ファイル 1606 テスト成功）。
- `docs/PLAN.md` の #217 チェック・`docs/WORKLOG.md` 索引 1 行・本 worklog
  の内容が実装と整合。`docs/ARCHITECTURE.md` にトーストの CSS 詳細の記述は
  無く、docs との齟齬なし。
- コミットは 1 件（`fix(frontend): ...`、Conventional Commits 形式）で
  粒度も適切。

補足（指摘ではなく情報として）:

- `.toast` 自体への `min-width: 0` は、`.toast-stack` が column flex で
  ある現状では cross 軸の指定となり、仕様上 `min-width: auto` は cross 軸
  では 0 相当に解決されるため実質的な効果は無い（worklog の実測でも
  `.toast` は 360px に収まっていた）。将来 flex-direction が変わった場合の
  防御として無害なので、そのままで問題ない。
- ブランチの分岐点が main の #216 マージ前（26f4273）のため、
  `docs/PLAN.md` / `docs/WORKLOG.md` はマージ時にコンフリクトする
  可能性がある。マージ担当（統括）はリベースまたはコンフリクト解消を
  想定しておくとよい。
