### 2026-07-11 Issue #235 collector停止中に送信したaddNode/addWorkbenchはゴースト消滅のみでエラートーストが出ない

#### 設計メモ（着手前）

現状確認（実装コードを読んで確認）:

- `packages/frontend/src/websocket/client.ts` の `createChainvizClient` は
  `sendCommand()` の中で `socket` の有無を確認せず、常に
  `generateCommandId()` で新しい commandId を発行して返している
  （`socket?.send(...)` は socket が null なら何もしない no-op）。つまり
  「未接続でコマンドが実際には送られていない」ことを呼び出し側が知る手段が
  無い。
- `packages/frontend/src/commands/useCommands.ts` の `dispatch` は
  `sendCommand(command)` の戻り値が `undefined` の場合のみ何もせず return
  するガードを既に持っている（`useWorldState.ts` の `sendCommand` は
  クライアント自体が無い場合 `undefined` を返せる型になっている）が、
  現状の `client.ts` の実装ではこの分岐に実際には到達しない（常に文字列が
  返るため）。
- `dispatch` は addNode/addWorkbench の場合、commandId 発行と同時に
  ゴースト（仮カード）を楽観的に生成する。実体到着
  (`entityAdded`)・失敗 (`commandResult(ok:false)`) のどちらも来ない場合、
  `entities/ghostNode.ts` の `GHOST_TIMEOUT_MS`（60秒、UX上の安全網）で
  ゴーストが黙って消えるだけになっている（`useCommands.ts` 272-292行目の
  タイマー effect。`removeGhostByCommandId` を呼ぶのみで通知は無い）。
- 実際に `createChainvizClient` を使い、FakeSocket で「接続 → 接続済み →
  close イベント（collector 停止相当）」を再現したうえで `addNode` を
  dispatch し、`GHOST_TIMEOUT_MS` 分だけ疑似タイマーを進めるテストを一時的に
  書いて実行し、「ゴーストは2枚生成される→60秒後に消える→この間 `notify`
  は一度も呼ばれない」ことを実際に確認した（Issueの再現。確認後にテストは
  削除し、実装後に正式な回帰テストとして書き直す）。

原因の切り分け:

- `sendCommand` が「実際に送られたか」を偽らずに返せていないことが根本原因。
  ここを直せば `useCommands.dispatch` 側の「未接続なら何もしない」という
  既存の分岐が初めて意味を持つようになる。ただしこの分岐は現状「ゴーストも
  作らず黙って return するだけ」なので、ここに新たにエラートースト通知を
  追加する必要がある。

修正方針:

1. `client.ts`: `sendCommand` は `socket` が null（未接続）のときは
   commandId を発行せず `undefined` を返す（`socket.send` も呼ばない）。
   `ChainvizClient.sendCommand` の型を `string` → `string | undefined` に
   変更する（`useWorldState.ts` 側の型は既に `string | undefined` なので
   そちらの変更は不要）。
   - 判定条件は `status !== "connected"` ではなく `!socket` にする。
     `connect()` は `createSocket()` 呼び出し直後（"open" イベント到達前、
     つまり `status === "connecting"` の間）から同期的に `socket` 変数を
     セットしており、既存のいくつかの単体テスト
     （`sends commands with generated ids...` / `supports a custom command
     id generator`）は明示的に "open" を発火させないまま
     `sendCommand` を呼んでいる。ここを `status === "connected"` 必須に
     すると、これらの正常系テストまで壊してしまい、本Issueのスコープ
     （切断状態での送信）を超える。加えて「CONNECTING状態での送信は
     ブラウザの WebSocket 仕様上 send() が例外を投げる」という別の潜在
     問題があるが、これは本Issueの再現手順（"切断バッジに変わった後に
     押す" = close イベント済みで `socket` が既に null）とは別の関心事
     なので今回は触れない（気づいた点として記録のみ）。
   - 実際の再現手順（collector停止→切断バッジ表示後にボタンを押す）では
     "close" イベントが既に発火済みで `socket` は null になっているため、
     `!socket` 判定で確実に捕捉できる。
2. `useCommands.ts` の `dispatch`: `sendCommand` が `undefined` を返した
   場合、ゴーストを作らず即座にエラートーストを出す（60秒待たせない）。
   理由が明確（未接続）なので、`describeCommandError` とは別に
   「未接続」の理由文言を組み込んだ専用のメッセージ組み立て関数を
   `commandMessages.ts` に追加する（`error` 引数には collector から
   返る生の英語エラー文字列を想定しており、未接続時の理由は最初から
   i18n 済みの文言にしたいため、既存関数を流用せず別関数にする）。
3. 加えて、Issueの対応案の2つ目（「ゴーストの安全網タイムアウト発火時にも
   実体到着が無かったことをエラートーストとして通知する」）も実装する。
   理由: (1) の対応だけでは「addNode 送信時点では接続していたが、
   commandResult が返る前に collector が落ちた／メッセージが失われた」
   という別の異常系（`socket` が非nullのまま、あるいは応答だけが来ない
   ケース）はカバーできない。ゴーストの安全網タイムアウトは元々
   「ユーザー通知が目的の設計ではない」（`ghostNode.ts` のコメント）が、
   実体到着もエラーも無いままゴーストが消えるのは実質的に失敗確定なので、
   この時点でエラートーストを出すのは既存設計と矛盾しない拡張と判断する。
   - `useCommands.ts` のタイマー effect（272-292行目）で、タイムアウトが
     実際に発火した時点（＝まだゴーストが残っていた＝それまでに解決
     しなかった）で `pendingRef` から対応する command を引いて
     `notifyRef.current` を呼ぶ。あわせて `pendingRef.current.delete` で
     エントリを消す（現状はここが handleCommandResult でしか消えないため、
     commandResult が永遠に来ないこの経路では地味に `pendingRef` が
     リークしていた。ついでに直す）。
   - こちらの理由文言も「未接続」ではなく「応答なし（タイムアウト）」の
     別の i18n キーにする（未接続とは限らない一般的なタイムアウトのため）。
4. i18n: `command.error.notConnected`（未接続）・`command.error.timeout`
   （タイムアウト）の2つの新しいメッセージキーを `messages.ts` に追加する
   （ja/en 両方）。
5. 影響範囲の確認: `client.ts` の型変更を受けて、既存の
   `client.test.ts` の「sendCommand before connect ...」テストは新しい
   仕様（undefined を返す）に合わせて書き換える。`useCommands.ts` の
   dispatch は addNode/addWorkbench 以外（removeNode/removeWorkbench/
   runWorkbenchOperation）でも `sendCommand` の戻り値を共通で使っている
   ため、未接続時にはこれらの操作も同じ経路でエラートーストが出て
   早期returnする（pendingRemovalCounts/pendingOperationCountsに一切
   触れないまま return するため、「スピナーが消えないまま固着する」という
   副作用も無い）。この副次効果は本Issueのスコープを広げる意図の変更では
   なく、根本原因（`sendCommand` が偽りの成功を返す）を直したことで自然に
   解消される話なので、そのまま許容する。

テスト方針:

- `packages/frontend/src/websocket/client.test.ts`: 未接続時（socket が
  null）は `sendCommand` が `undefined` を返し、何も送信しないことを
  検証するテストに書き換え・追加する。
- `packages/frontend/src/commands/useCommands.ts` に対応する新規テスト
  ファイル（1関心事1ファイルの方針に沿い、既存 `useCommands.test.tsx` に
  追記せず新規ファイル `useCommandsDisconnected.test.tsx` を作る）で、
  以下を検証する:
  - 未接続（`sendCommand` が `undefined` を返す）状態で addNode /
    addWorkbench を dispatch すると、ゴーストを作らず即座にエラートースト
    が呼ばれること
  - 未接続状態で removeNode 等を dispatch した場合も同様に即座にエラー
    トーストが呼ばれ、pending系のSetが汚染されないこと
  - 接続済み（`sendCommand` が commandId を返す）状態で addNode した後、
    commandResult もentityAddedも来ないまま `GHOST_TIMEOUT_MS` が経過した
    場合、ゴーストが消えると同時にエラートーストが呼ばれること

（設計メモはここまで。以下は実装後の追記）

補足（実装中に気づいた設計判断の追加）:

- 安全網タイムアウト発火時にエラートーストを出す条件は、単に「ゴーストが
  まだ残っている」ではなく「`pendingRef` にその commandId の command が
  まだ残っている（＝commandResult 自体が一度も届いていない）」に限定した。
  理由: `commandResult(ok:true)` が届いた後は、ゴーストは実エンティティの
  diff 到着だけを待っている状態であり、これはコマンド自体は成功している
  （コンテナ起動が単に遅いだけ、等）。`ghostNode.ts` の `GHOST_TIMEOUT_MS`
  のコメントに「コンテナ起動が恒常的にこれより長くかかる環境が出てきた
  場合は見直すこと」とあるとおり、起動が遅いだけのケースは実際にありうる
  ため、ここで無条件にエラートーストを出すと「成功しているのに失敗したと
  誤って伝える」false positive になってしまう。`pendingRef` の有無で
  「commandResult 自体が来なかった（＝送信できていない/応答が失われた等の
  異常系）」場合だけに絞ることで、この false positive を避けた。

#### 実装記録

- 担当: frontend
- ブランチ: issue-235-error-toast-on-ghost
- 再現確認（修正前）: `createChainvizClient`（実際のクライアント実装）を
  FakeSocket で駆動し、「接続 → 接続済み → close イベント（collector 停止
  相当）」を再現したうえで `addNode` を dispatch し、`GHOST_TIMEOUT_MS` 分
  だけ疑似タイマーを進めるテストを一時的に書いて実行し、「ゴーストは2枚
  生成される → 60秒後に消える → その間 `notify` は一度も呼ばれない」ことを
  実際に確認した（Issue の再現）。確認後にこのテストは削除した。
- 変更点:
  1. `packages/frontend/src/websocket/client.ts`: `ChainvizClient.sendCommand`
     の型を `string` → `string | undefined` に変更。実装は `socket` が
     null（未接続）のときは commandId を発行せず・送信もせず `undefined` を
     返すようにした。判定条件は `status === "connected"` ではなく `!socket`
     にしている（設計メモのとおり、`connecting` 状態での送信可否は別の
     既存潜在課題であり、今回のスコープではない）。
  2. `packages/frontend/src/commands/commandMessages.ts`: 「未接続」
     （`describeCommandNotConnectedError`）と「タイムアウト」
     （`describeCommandTimeoutError`）専用の失敗文言組み立て関数を追加。
     どちらも内部で共通の `describeLocalCommandError` を使う。
  3. `packages/frontend/src/i18n/messages.ts`: `command.error.notConnected`・
     `command.error.timeout` の2つの ja/en メッセージキーを追加。
  4. `packages/frontend/src/commands/useCommands.ts`:
     - `dispatch` で `sendCommand` が `undefined` を返した場合、ゴーストを
       作らず即座に `describeCommandNotConnectedError` のメッセージで
       エラートーストを出すように変更（それまでは黙って return するだけ
       だった）。
     - ゴーストの安全網タイムアウト（`GHOST_TIMEOUT_MS`）発火時、
       `pendingRef` にその commandId がまだ残っている（＝commandResult が
       一度も届いていない）場合に限り `describeCommandTimeoutError` の
       メッセージでエラートーストを出すように変更。あわせて、この経路で
       `pendingRef` のエントリを確実に削除するようにした（従来は
       `handleCommandResult` でしか削除されず、commandResult が永遠に
       来ないこの経路では地味にリークしていた）。
  5. `packages/frontend/src/websocket/client.test.ts`: 「未接続で送信すると
     `undefined` を返し、実際には送信しない」ことを検証する2テスト
     （connect 前 / close 後）に既存の1テストを置き換えた。
  6. 新規テストファイル `packages/frontend/src/commands/useCommandsDisconnected.test.tsx`:
     未接続時に addNode/addWorkbench/removeNode/runWorkbenchOperation の
     いずれでもゴーストを作らず即座にエラートーストが出ること、pending系の
     Set が汚染されないこと、再接続後は通常どおり動作を再開すること、
     ゴーストの安全網タイムアウトで commandResult 自体が来なかった場合に
     エラートーストが出ること、逆に commandResult(ok:true) 済みでゴースト
     だけが残っている場合はタイムアウトでも通知しないこと（成功したものを
     誤って失敗と伝えない）を検証する。
- 修正確認（修正後）: 上記「再現確認」と同じ手順（`createChainvizClient` を
  FakeSocket で駆動し close イベントを発火させてから addNode を dispatch）
  のテストを実行し、ゴーストが作られることすらなく即座に
  `"Failed to add node: Not connected to the collector"` のエラートーストが
  1回だけ呼ばれることを確認した。確認後、このテストは削除し（内容は
  `useCommandsDisconnected.test.tsx` の1件目のテストとして正式に残した）、
  `git status` で作業ツリーに一時ファイルが残っていないことを確認した。
- 確認したこと:
  - `pnpm --filter @chainviz/frontend build` / `pnpm --filter @chainviz/frontend test`
    が通ることを確認（既存1624件 + 新規7件 = 1631件、全件成功）。
  - リポジトリ全体の `pnpm build` / `pnpm test`（shared 59 / e2e 77 /
    collector 1137 / frontend 1631、計4パッケージ）が通ることを確認。
  - 変更ファイルに対して `eslint` を実行しエラーが無いことを確認
    （root の `pnpm lint` は monorepo 全体対象で重いため、変更ファイルへの
    直接実行で代替。最終的な `pnpm lint` はレビュー/QAで確認される想定）。
- 決定事項・注意点（次の担当が知っておくべきこと）:
  - `client.ts` の未接続判定は `!socket`（`status === "connected"` では
    ない）。理由は設計メモのとおり、`connecting` 状態（`open` イベント
    未到達）での送信可否は本Issueのスコープ外の別の潜在課題であるため。
  - ゴーストの安全網タイムアウトでの通知は「`pendingRef` に command が
    残っている（commandResult 未着）」場合のみに限定している。
    `commandResult(ok:true)` 後にゴーストが実体到着を待ち続けて
    タイムアウトするケース（コンテナ起動が遅いだけ）では通知しない。
    この閾値（60秒）で正当な遅延まで誤検知するようになった場合は、
    `GHOST_TIMEOUT_MS` 自体の見直し（ghostNode.ts のコメント参照）を
    検討すること。
  - `removeNode`/`removeWorkbench`/`runWorkbenchOperation` も
    `dispatch` の同じ経路を通るため、未接続時はこれらも同様に即座に
    エラートーストが出て `pendingRemovalCounts`/`pendingOperationCounts`
    にも触れずに return する（スピナー固着の副作用が起きない）ことを
    テストで確認済み。これは本Issueのスコープを意図的に広げたものでは
    なく、根本原因（`sendCommand` が偽りの成功を返していたこと）の
    修正から自然に波及した副次効果。
  - スコープ外として見送った点（気づいたが本Issueでは対応しない）:
    WebSocket が `connecting` 状態（`open` イベント未到達）のときに
    `send()` を呼ぶと、実ブラウザの WebSocket 仕様上
    `InvalidStateError` が投げられる（現状のコードは `socket` の有無しか
    見ておらず、この状態を考慮していない）。今回の再現手順・Issueの
    スコープ（切断済み状態での送信）とは別の潜在的な不具合のため、
    別Issueとして起票する価値があるかもしれない。

#### テスト強化記録

- 担当: テスト強化（chainviz-tester）
- 目的: 実装担当が書いた基本テストに対し、未接続で即失敗する経路と安全網
  タイムアウトで失敗する経路の区別・境界値・競合状態を追加で検証する。
  実装コードは変更していない（既存テストの追加・強化のみ）。
- ファイル分割: 既存の `useCommandsDisconnected.test.tsx` は「未接続で送信
  自体が失敗する経路」と「安全網タイムアウトによる失敗通知」の2つの関心を
  含んでいたため、後者を新規ファイル `useCommandsGhostTimeout.test.tsx` に
  切り出した（1ファイル1責務。既存の Issue #167 のファイル分割方針に倣う）。
  各ファイルは他のテストファイルと同じく自前の `setup()` を持つ。
- `useCommandsDisconnected.test.tsx`（未接続の送信失敗経路）に追加した観点:
  - 未接続時に removeWorkbench でも即座にエラートーストが出て
    `pendingRemovalIds` が汚染されないこと（removeNode と対で、削除系の
    両方向を確認）。
  - 未接続のまま addNode を連続で複数回呼んでも、1回につき1件ずつ確実に
    エラートーストが出てゴーストが1枚も生まれないこと（連打の境界）。
  - 未接続で addNode / addWorkbench / removeNode を混在させて連続送信した
    場合、各コマンド種別に応じた理由付き文言が正しい順序で出ること
    （文言のすり替わり・取り違えが無いか）。
  - 接続中に addNode（ゴースト2枚）を出した直後に切断され、次の addNode が
    即失敗しても、先行中のゴーストが影響を受けずに残ること（接続→切断の
    タイミングがずれるケース）。
  - 未接続経路ではゴーストを作らない＝安全網タイマーも張られないため、
    `GHOST_TIMEOUT_MS` 経過後もタイムアウト由来の2件目の通知が出ず通知が
    1件のままであること（「未接続で即失敗」と「タイムアウトで失敗」が
    二重に発火しないことの確認）。
- `useCommandsGhostTimeout.test.tsx`（安全網タイムアウトの失敗通知）に
  追加・移設した観点:
  - addNode の2枚のゴースト（同一 commandId）が両方タイムアウトしても、
    通知は1件だけであること（2枚のタイマーが両方発火しても二重通知に
    ならない）。
  - addWorkbench のタイムアウトでもワークベンチ固有の理由文言で通知される
    こと（addNode だけでなく addWorkbench でも同じ経路が機能するか）。
  - commandResult(ok:true) 済みの addNode（2枚）がタイムアウトしても
    通知しないこと（コンテナ起動が遅いだけの成功を誤って失敗と伝える
    false positive の防止。既存の addWorkbench 版に加えて2枚ゴースト版も
    確認）。
  - commandResult(ok:false) で既に失敗トーストが出た後にタイムアウト時刻へ
    達しても、再通知（二重通知）が起きないこと（ok:false 経路と
    タイムアウト経路が両方発火しないことの確認）。
  - 未解決の addNode と解決済み（ok:true）の addWorkbench が同時に飛んで
    いる状態でタイムアウトに達したとき、通知は未解決の addNode の分だけで
    あること（pendingRef による commandId 単位の判別が正しく効くか）。
- `websocket/client.test.ts` に追加した観点:
  - 明示的な `disconnect()` 後は `sendCommand` が `undefined` を返し何も
    送信しないこと、その後 `connect()` で再接続すれば新しい socket 上で
    通常どおり送信でき commandId が返ること（切断→再接続をまたいだ
    送信可否の境界。既存テストは close イベント・connect 前のみを対象と
    していた）。
- 回帰検出の確認: `useCommands.ts` の安全網タイムアウトの発火条件
  （`if (resultNeverArrived)`）を一時的に `if (true)` へ改変すると、上記の
  「ok:true 済みでは通知しない」系のテストが実際に失敗することを確認し、
  false positive 検出テストが機能していること（空振りでないこと）を
  検証した。確認後は改変を元に戻した。
- 実行結果: `pnpm --filter @chainviz/frontend build`（tsc -b、エラー無し）・
  `pnpm --filter @chainviz/frontend test`（108ファイル 1641件、全件成功。
  強化前の1631件から test のみで +10 件）が通ることを確認した。
- 注意点: この worktree では実装担当（client.ts / useCommands.ts /
  commandMessages.ts / messages.ts）の変更がまだコミットされていなかった。
  テスト強化のコミットはテストファイルのみを対象にしており、実装本体の
  コミットは統括に委ねる。
