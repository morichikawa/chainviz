# Issue #37-39 作業記録

### 2026-07-04 Issue #37・#38・#39 キャンバスからのノード/ワークベンチ追加・削除（frontend）
- 担当: frontend
- ブランチ: issue-37-frontend-add-remove-ui
- 内容: ステップ5の frontend 側3件（追加ボタン UI・カード削除ボタン・失敗時
  エラー表示）を実装した。collector 側（#34〜#36）は並行して実装中のため、
  操作コマンドの送信配線と mock でのシミュレーションまでを担当した。
  - 操作コマンド送信の土台:
    - `world-state/useWorldState.ts` を拡張し、接続中クライアントを ref に保持して
      `sendCommand(command)` を返すようにした。`onCommandResult` ハンドラも
      受け取れるようにし、毎レンダーで参照が変わっても再接続しないよう ref 経由で
      最新を呼ぶ。
    - `commands/useCommands.ts` … `useWorldState` を内包し、コマンド発行アクション
      （addNode / addWorkbench / removeNode / removeWorkbench）・送信コマンドの
      pending 追跡・`commandResult(ok:false)` 時のトースト通知を組み合わせるフック。
      送信時に commandId をキーに command を pending へ記録し、失敗結果が返ったら
      どの操作が失敗したかを添えて通知する。
    - `commands/commandMessages.ts` … 純粋関数。ワークベンチ名の正規化
      （`resolveWorkbenchLabel`、空なら既定ラベル `workbench`）と、失敗時文言の
      組み立て（`describeCommandError`、i18n の定型文 + collector からの error 文字列）。
    - `commands/CommandActionsContext.tsx` … React Flow のカスタムノード
      （InfraNodeCard）はキャンバス内部に描画され props を渡しにくいため、削除
      アクションを context 経由で配る。
  - #37 追加ボタン: `canvas/CanvasToolbar.tsx` をキャンバス左上に重ねて配置。
    ノード追加ボタンと、ラベル入力欄つきワークベンチ追加フォームを持つ。
    プロファイルは現状 Ethereum 1種のみのため選択 UI は置かず、addNode は
    `chainProfile: "ethereum"` 固定。
  - #38 削除ボタン: `entities/InfraNodeCard.tsx` のヘッダ右端に×ボタンを追加。
    node なら removeNode、workbench なら removeWorkbench を送る。React Flow の
    ドラッグ開始を拾わないよう `nodrag` クラスと onPointerDown の伝播停止を付けた。
    バリデーターノードの削除不可判定はフロントでは行わず、collector が返す
    エラー（#39 の経路）で表現する。
  - #39 エラー表示: `notifications/`（`notificationStore.ts` 純粋ロジック、
    `useNotifications.ts` フック、`Toast.tsx` UI）でトースト通知の仕組みを用意し、
    #37・#38 共通で使う。トーストは画面右下に積まれ手動で閉じられる。
  - i18n: 追加・削除ボタン、入力欄プレースホルダ、トースト関連、コマンド失敗
    メッセージ（種別ごと + 汎用フォールバック）を `i18n/messages.ts` に ja/en で追加。
  - mock: collector 未完成のため `websocket/mockData.ts` の `createMockClient` に
    コマンド結果のシミュレーションを追加。addNode/addWorkbench は entityAdded diff を
    流して ok:true、removeNode/removeWorkbench は存在すれば entityRemoved で ok:true、
    初期スナップショットのノード（reth-node-1/2・lighthouse-1＝バリデーター相当）は
    削除不可で ok:false を返す。これで collector なしでも成功・失敗双方の見た目を
    確認できる。結果は pending 登録後に返るよう常に非同期（既定は queueMicrotask、
    `commandLatencyMs` 指定時は setTimeout）で resolve する。
- 決定事項・注意点:
  - `packages/shared` の型変更は不要だった。`Command` 型は設計済みのものを
    そのまま利用。
  - `sendCommand` は未接続（unmount 後など）だと undefined を返す。useCommands は
    undefined のとき pending へ記録しないため、結果の来ないコマンドが宙に残らない。
  - トーストは現状 error 種別のみ使用。将来 info/success を足せるよう
    `NotificationKind` を持たせてある。自動消滅は未実装（手動クローズのみ）。
  - mock の削除不可ノード判定は実環境の完了条件（compose 起動のバリデーターは
    削除不可）を模したもの。実際の可否判定は collector 側（#35）が担う。
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過（frontend 265 tests）。

### 2026-07-04 Issue #37・#38・#39 テスト強化（エッジケース・異常系・境界値）
- 担当: tester
- ブランチ: issue-37-frontend-add-remove-ui
- 内容: frontend 実装担当が書いた基本テスト（265 tests）に、異常系・境界値の
  観点でユニットテストを追加した（新機能の実装は行わず、テストのみ追加。
  301 tests）。実装コードは変更していない。
  - `commands/commandMessages.test.ts`: `resolveWorkbenchLabel` にタブ/改行の
    空白扱い、語間空白の保持、特殊文字・絵文字の保持、超長文字列の非切り詰めを
    追加。`describeCommandError` に command 不明でも詳細を付す挙動、空文字列
    error を欠落と同等に扱う挙動、詳細前後の空白トリムを追加。
  - `notifications/notificationStore.test.ts`: 同一メッセージを別 id で複数
    保持、200 件連続追加の順序・非破壊、同一 id 複数エントリの一括除去、空配列
    からの dismiss を追加。
  - `notifications/useNotifications.test.tsx`: 重複メッセージへの一意 id 付与、
    手動クローズ後に同内容の通知が来ても新 id で再表示、50 件バーストの id 一意性、
    notify/dismiss の参照安定、未知 id dismiss の no-op を追加。
  - `commands/useCommands.test.tsx`: 同一 commandResult の二重到達（2 回目は
    command 不明の汎用文言）、成功後に遅れて届く失敗結果、未送信 commandId の
    結果を無視、同一アクション連打時の各コマンド独立追跡、結果未到達時の無通知を
    追加。setup に `resolveById` ヘルパを追加。
  - `canvas/CanvasToolbar.test.tsx`: 空白のみラベルの未トリム通過、特殊文字・
    絵文字ラベルの素通し、フォーム submit（Enter 相当）での送信、追加ボタン連打時
    の二重送信ガード無し（クリックごとに 1 発行）、ツールバーから remove 系を
    呼ばないことを追加。
  - `entities/InfraNodeCard.test.tsx`: 削除ボタンの nodrag クラス付与、pointerdown
    が祖先（React Flow ノードラッパ相当）へ伝播しないこと、syncing ノードでも削除
    ボタンが機能すること、連打時の二重送信ガード無しを追加。
  - `websocket/mockData.test.ts`: 未存在 nodeId 削除の拒否、ワークベンチの追加→
    削除ラウンドトリップ、混在追加バーストの entity id 一意性・初期 id との非衝突、
    command id の単調増加、`commandLatencyMs` 遅延中の切断で保留タイマー破棄・
    結果非到達、遅延経過後の結果到達を追加。
- 決定事項・注意点:
  - 実装のバグは検出されなかった。追加した観点はいずれも既存実装で期待どおりに
    通過した。
  - 追加・削除ボタンの二重送信防止は UI 側では行われない仕様（クリックごとに
    コマンドを 1 発行）であることをテストで明文化した。将来 pending 中の
    ボタン無効化を入れる場合はこれらのテストを更新する必要がある。
  - `pnpm lint` / `pnpm --filter @chainviz/frontend build` / 同 test すべて通過
    （frontend 301 tests）。

### 2026-07-04 Issue #37・#38・#39 静的レビュー（frontend 追加・削除 UI）
- 担当: reviewer
- ブランチ: issue-37-frontend-add-remove-ui
- 内容: frontend のステップ5実装（#37 追加ボタン UI / #38 カード削除ボタン /
  #39 コマンド失敗時のエラー表示）と tester のテスト強化（265→301 tests）を
  静的にレビューした。
  - 境界の遵守: フロントは Docker/ノード API に触れておらず、操作はすべて
    shared の `Command` 型（既存の protocol 定義）を WebSocket クライアント
    経由で送る形になっている。チェーン固有語彙（`eth_getLogs` 等）の漏れなし。
    `DEFAULT_CHAIN_PROFILE = "ethereum"` はプロファイル識別子であり RPC 語彙
    ではないため問題ない（プロファイルが増えた時点で選択 UI に置き換える
    前提のハードコード。コメントにも明記済み）。
  - `packages/shared` の型変更は不要という判断は妥当。`Command` /
    `ServerMessage` / `ClientMessage` はステップ0の設計時に定義済みで、
    今回の実装はそれをそのまま消費している。
  - モジュール構成: `commands/`（純粋ロジック・フック・context の3分割）、
    `notifications/`（store・フック・UI の3分割）とも1ファイル1責務を守って
    おり、循環依存なし。`index.ts` の再エクスポートも純粋ロジックのみで方針
    どおり。
  - i18n: 追加文言はすべて `messages.ts` に `{ja, en}` で追加されており
    既存の仕組みに沿っている。
  - テストの質: tester 追加分（二重到達する commandResult、成功後の遅延失敗、
    未送信 commandId、連打、空白のみ/絵文字/超長ラベル、mock の遅延タイマー
    破棄など）は異常系・境界値を実質的に検証しており、実装をなぞるだけの
    無意味なテストは見当たらない。
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過
    （frontend 301 tests）を確認。
  - docs 齟齬の修正: `docs/ARCHITECTURE.md` §1 の frontend フォルダ一覧に
    新設の `commands/` と `notifications/` が載っていなかったため追記した
    （このレビューでの唯一の修正）。
- 決定事項・注意点:
  - 「二重送信防止を UI 側で行わない」設計は現時点で許容と判断した。追加
    ボタンの連打は「複数追加したい」という正当な操作と区別できず、pending 中
    のボタン無効化は複雑さに見合わない。ただし削除ボタンは、collector の反映
    （entityRemoved の diff）が届くまで数秒カードが残るため、その間の再クリック
    が「not found」エラートーストになり得る。実環境でこれが紛らわしいと判明
    したら「削除 pending 中はそのカードの削除ボタンを無効化する」改善を検討
    する（現状のテストは連打=複数発行を明文化済みなので、その際はテストも更新）。
  - 実 WebSocket クライアント（`websocket/client.ts`）の `sendCommand` は
    ソケット未接続でも commandId を返すため、未接続時に送ったコマンドは
    pending に残り結果が来ない（トーストも出ない）。mock では起きない経路
    だが、collector 接続後の実環境で接続断中の操作 UX を改善する余地がある
    （将来課題。今回の完了条件には影響しない）。
  - コミットはまだ行っていない。コミット時は関心事ごと（コマンド送信の土台 /
    #37 ツールバー / #38 削除ボタン / #39 通知 / mock 拡張 / テスト強化 /
    docs）に分割すること。
