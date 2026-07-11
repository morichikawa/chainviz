### 2026-07-11 Issue #270 UI-CMD-01のaddNode成功判定がIssue #215のsubtitle形式変更に追従しておらず常に失敗する

- 担当: frontend
- ブランチ: issue-270-uicmd01-subtitle-match

#### 設計メモ(着手前)

- 原因: `InfraNodeCard.tsx`（Issue #215）でカードのsubtitleが
  `{clientType}`単独から`{役割ラベル} · {clientType}`（nodeRoleが解釈
  できる場合）に変わった。`packages/e2e/src/ui/commands-node.spec.ts`の
  UI-CMD-01が`subtitle === "reth"` / `subtitle === "lighthouse"`という
  完全一致でカードを判別しており、常に不一致になって`addedRethId` /
  `addedBeaconId`を捕捉できない。
- 横断確認: `grep -rn "subtitle\|textContent" packages/e2e/src/ui/`で
  UI層spec全体を確認したところ、`infra-display.spec.ts`のUI-A-01にも
  同種の問題があった（`toHaveText(clientType)`という完全一致。reth1/reth2
  は`nodeRole: "execution"`が付与されるため実際の表示は「実行クライアント
  · reth」であり、`toHaveText("reth")`は不一致になる）。Issue #233のQA
  では気づかれていなかったが、同一原因のリグレッションのため合わせて
  修正する。`commands.test.ts`（プロトコル層。`e.clientType === "reth"`）
  はワールドステートのエンティティを直接見ており、DOM文字列を見ていない
  ため対象外。
- 安定したtestid等の代替手段: `InfraNodeCard.tsx`を確認したが、subtitle
  内のclientType単体を指す個別のdata-testidは存在しない（`infra-card-<id>`
  はカード全体、`.infra-card__subtitle`はテキスト全体）。役割ラベルの
  実際の文言(「実行クライアント」等)はi18n・チェーンプロファイル
  （`chain-profiles/ethereum/nodeRoles.ts`）の変更で増減しうるため、
  ラベル文言自体をテストに決め打ちしたくない。そのため、subtitleの
  末尾がclientTypeと一致するかどうかで判定する正規表現ヘルパーを
  `packages/e2e/src/ui/support/subtitle.ts`に新設する
  （`(?:^|\s)${clientType}$`。旧来のフォールバック形式=clientTypeのみの
  完全一致にもこの正規表現はそのまま一致する）。
- 修正対象: `commands-node.spec.ts`(UI-CMD-01)、`infra-display.spec.ts`
  (UI-A-01)の2ファイル。新設ヘルパーを両方から利用する。

#### 実施内容

- `packages/e2e/src/ui/support/subtitle.ts`を新設し、
  `subtitleEndsWithClientType(clientType)`（subtitle文字列の末尾が
  clientTypeと一致するかを判定する正規表現を返すヘルパー）を実装した。
  ユニットテスト`subtitle.unit.test.ts`を追加（新形式・旧フォールバック
  形式の一致、別clientTypeとの不一致、"rethink"のような部分一致誤検出の
  否定、正規表現特殊文字のエスケープを検証）。
- `commands-node.spec.ts`のUI-CMD-01で`subtitle === "reth"` /
  `subtitle === "lighthouse"`という完全一致だった箇所を
  `subtitleEndsWithClientType(...).test(subtitle)`に置き換えた。
- `infra-display.spec.ts`のUI-A-01で`toHaveText(clientType)`という完全
  一致だった箇所（設計メモ着手前調査で発見した同種のリグレッション）も
  同様に`toHaveText(subtitleEndsWithClientType(clientType))`に置き換えた。

#### 再現・検証（実機Docker + Playwright）

- 修正前のコード（`git stash`で一時的に戻した状態）で
  `pnpm --filter @chainviz/e2e exec playwright test src/ui/commands-node.spec.ts`
  を実行し、UI-CMD-01が`Error: added reth card must be identified`
  （`addedRethId`/`addedBeaconId`が空文字のまま）で失敗することを確認した。
  このとき`addNode`で作られたコンテナ(`reth4`/`beacon4`)は
  `afterAll`の早期returnにより後片付けされず残存することも実際に確認した
  （Issue本文の記載どおりの挙動）。
- 修正後のコードで同じテストを再実行し、UI-CMD-01〜04が全て成功する
  ことを確認した。あわせて`infra-display.spec.ts`のUI-A-01（旧
  `toHaveText(clientType)`だった箇所を含む）も成功することを確認した。
- 検証環境の注記: このマシンではPlaywrightの`chrome-headless-shell`が
  `libnspr4.so`等の共有ライブラリ不足で起動できない状態だったため、
  `LD_LIBRARY_PATH=/home/zoe/chrome-deps/root/usr/lib/x86_64-linux-gnu`
  を付与して実行した（Issue #245のworklogで使われたのと同じ回避策。
  Playwrightバイナリ自体・依存パッケージの変更は行っていない）。
- UI-A-02・UI-A-05（ホバーでポップオーバーが出ることを検証するテスト）
  はこのヘッドレス環境では修正前後どちらのコードでも失敗することを
  確認した（`git stash`で修正前に戻して単体実行し同一の失敗を再現）。
  今回のsubtitle判定とは無関係な、この検証環境固有の事象であり、
  Issue #270のスコープ外として扱う。

#### 決定事項・注意点

- subtitle内のclientType単体を指す専用の`data-testid`は存在しない
  （`InfraNodeCard.tsx`確認済み）ため、テストid化ではなく正規表現での
  末尾一致判定を採用した。役割ラベルの文言（i18n・チェーンプロファイル
  追加で増減しうる）をテスト側に決め打ちしない設計。
- 修正前コードでの再現実行時に生成された`reth4`/`beacon4`コンテナは、
  実際のcollector経由のUI操作（該当entity idの削除ボタンをPlaywright
  から明示的にクリック）で後片付けした。docker CLIで直接コンテナを
  操作することはしていない。
