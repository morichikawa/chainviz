### 2026-07-08 Issue #168 ウォレットカードへのトークン残高表示（設計メモ）

- 担当: frontend
- ブランチ: issue-168-wallet-token-balance
- 参照: `docs/ARCHITECTURE.md` §6.7「ウォレットのトークン残高」（表示方針は
  既に確定済みのためこのメモは実装レベルの詳細のみを補足する）

#### 表示形式

- `WalletCard`: 残高行（`… ETH · nonce n`）の直下に「トークン残高」ラベル
  （GlossaryTerm: `token`）付きのチップ列を追加する。各チップは
  `{formatted} {symbol}`（例: `1000.5000 CVZ`）。既存の ETH 残高表示
  （`formatEther` が小数第4位までを出す）と桁数を揃え、**桁区切り
  （カンマ）は入れない**。Issue本文の例（`1,000.5 CVZ`）はあくまで
  「読める形」の一般的な例示と解釈し、既存の ETH 残高表示にカンマが
  無いことと一貫させることを優先する。
- `WalletPopover`: 「トークン残高」フィールド行を追加し、各トークンを
  「コントラクト名（無ければ symbol） + {formatted} {symbol}」の1行で
  リスト表示する（ARCHITECTURE.md「コントラクト名＋残高」の指示どおり）。
- どちらも `tokenBalances` が省略・空、または全件が突き合わせ不能なら
  セクションごと非表示にする（Phase 3 までのカードの見た目を変えない、
  既存の「省略時は行ごと出さない」流儀を踏襲）。

#### 突き合わせ・ダングリングガード

- `WalletEntity.tokenBalances[].contractAddress` で `ContractEntity`
  （`contractsByAddress`。App.tsx で既に構築済み、Issue #166 で
  `WalletCard`/`WalletPopover` に配線済み）を引く。
- 該当する `ContractEntity` が見つからない、または見つかっても
  `token`（symbol/decimals）を持たない場合はその1件を**結果から除外**する
  （ARCHITECTURE.md 明記の「ダングリングガード」の流儀。symbol/decimals が
  不明な生の数値をアドレスだけで出すと桁の意味が分からず混乱するため、
  「コントラクトアドレスのみ表示」ではなく非表示を選ぶ）。

#### decimals変換ロジック

- `packages/frontend/src/entities/tokenAmount.ts`（新規）に
  `formatUnits(amount, decimals, fractionDigits = 4)` を切り出す。
  `walletNode.ts` の既存 `formatEther`（wei 固定decimals=18）はこの
  一般化の特殊ケースとして `formatUnits(wei, 18, fractionDigits)` を呼ぶ
  薄いラッパーに変更する（ARCHITECTURE.md 「formatEther は decimals 可変の
  formatUnits へ一般化して共用する」の指示どおり）。既存の呼び出し元
  （`WalletCard`/`WalletPopover`/テスト）は `walletNode.js` からの
  `formatEther` インポートのまま変更不要にする。
- `operations/etherAmount.ts`（Issue #167、ETH文字列 → wei 変換。UI入力用）
  とは逆方向（最小単位 → 人間可読な小数表記。エンティティ表示用）の変換で、
  対になるユーティリティとして別ファイルに独立させる。置き場所は
  `entities/`（`formatEther` と同じくカード表示のための変換であり、
  `operations/` は定型操作フォームの入力パースが主目的のため）。
- コントラクト・突き合わせ（ダングリングガードの判定含む）は
  `packages/frontend/src/entities/walletTokenBalances.ts`（新規）の
  `resolveWalletTokenBalances(tokenBalances, contractsByAddress)` に切り出す
  （`resolveWalletTransactions` と同種の「エンティティ突き合わせ」ヘルパー。
  `formatUnits` 自体とは責務が別なので同一ファイルにしない）。

#### モックデータ

- `packages/frontend/src/websocket/mockData.ts` の `aliceWallet()` に
  ChainvizToken(CVZ, decimals18) 分の `tokenBalances` を追加する。
- `bobWallet()` にも、正常な CVZ 残高に加えて、存在しないコントラクト
  アドレスを指す `tokenBalance` を追加し、ダングリングガードで非表示に
  なることをオフラインで確認できるようにする。

---

### 実装記録

- 内容: 設計メモどおりに実装した。主な変更点は以下。
  - `packages/frontend/src/entities/tokenAmount.ts`（新規）: 最小単位の
    10進文字列を `decimals` 桁の小数表記へ変換する `formatUnits(amount,
    decimals, fractionDigits = 4)`。BigInt計算で精度落ちしない。
    `fractionDigits` は実際の `decimals` を超えて出さない（存在しない精度を
    ゼロ埋めしない）。`decimals === 0` は小数点を出さない。`amount` が
    数値として解釈できない、または `decimals` が非負整数でない場合は
    `amount` をそのまま返す。
  - `packages/frontend/src/entities/walletNode.ts`: 既存の `formatEther`
    （ETH残高表示。decimals=18固定でBigInt直書きしていた実装）を
    `formatUnits(weiString, 18, fractionDigits)` を呼ぶだけの薄い
    ラッパーに置き換えた。エクスポートするシグネチャは変えていないため、
    `WalletCard`/`WalletPopover`/既存テストの呼び出し元は無変更で動く。
  - `packages/frontend/src/entities/walletTokenBalances.ts`（新規）:
    `resolveWalletTokenBalances(tokenBalances, contractsByAddress)`。
    `WalletEntity.tokenBalances` の各件を `contractAddress` で
    `ContractEntity` と突き合わせ、`token`（symbol/decimals）を持つものだけ
    `{ contractAddress, symbol, contractName, formatted }` へ解決する。
    対応する `ContractEntity` が見つからない、または `token` を持たない
    場合はその1件を結果から除外する（ダングリングガード）。
  - `packages/frontend/src/entities/WalletCard.tsx`: 残高行の直下に
    「トークン残高」ラベル（GlossaryTerm: `token`）付きのチップ列を追加。
    チップは `{formatted} {symbol}`、title 属性にコントラクト名
    （無ければ短縮アドレス）を持つ。`resolveWalletTokenBalances` の結果が
    空ならセクション自体を出さない。
  - `packages/frontend/src/entities/WalletPopover.tsx`: 「トークン残高」
    フィールド行を追加。各トークンをリスト表示し、1件ごとに
    「コントラクト名（無ければ symbol）」と「{formatted} {symbol}」を
    左右に配置する（`.infra-field` と同じ「ラベル/値を両端に置く」見た目に
    揃えるため、専用CSS `.wallet-popover__token-item` を追加した）。
  - `packages/frontend/src/i18n/messages.ts`: `field.tokenBalances`
    （「トークン残高」/「Token balances」）を追加。
  - `packages/frontend/src/styles.css`: `.wallet-card__tokens` /
    `.wallet-card__token-chips` / `.wallet-token-chip`（コントラクトの
    活動チップと同系の配色。`--contract-edge` を再利用）、および
    `.wallet-popover__token-list` / `.wallet-popover__token-item` /
    `.wallet-popover__token-amount` を追加した。
  - `packages/frontend/src/websocket/mockData.ts`: `aliceWallet()` に
    ChainvizToken(CVZ) の `tokenBalances`（1000.5 CVZ）を追加。
    `bobWallet()` には正常な CVZ 残高（250.25 CVZ）に加え、存在しない
    コントラクトアドレス（`UNTRACKED_TOKEN_CONTRACT`）を指す
    `tokenBalance` を追加し、ダングリングガードの動作をオフラインで
    確認できるようにした。
- 追加したテスト:
  - `entities/tokenAmount.test.ts`: decimals可変・fractionDigits上限・
    decimals=0・負数・不正入力（非数値/非整数decimals/負のdecimals）の
    境界値。
  - `entities/walletTokenBalances.test.ts`: 突き合わせ成功・
    `tokenBalances`省略/空・対応`ContractEntity`未観測・`token`欠落・
    複数件中一部のみ解決可能・`name`欠落時に`contractName`が`undefined`に
    なることを確認。
  - `entities/WalletCard.test.tsx` / `entities/WalletPopover.test.tsx`:
    トークン残高チップ/フィールド行の表示・非表示（省略/空/ダングリング）
    の分岐を追加。
  - `websocket/mockData.tokenBalances.test.ts`（新規）: モックスナップ
    ショットのAlice/Bobの`tokenBalances`が、実際にカタログ・非カタログの
    ContractEntityと期待どおり突き合わせ可能/不能であることを確認。
- 動作確認: `pnpm --filter @chainviz/frontend dev` でモッククライアントを
  起動し、実際にキャンバス上でAliceのウォレットカードに
  「1000.5000 CVZ」、Bobのウォレットカードに「250.2500 CVZ」のチップが
  1件ずつ表示されること（Bobの正体不明トークンはダングリングガードで
  非表示になっていること）、ホバーのポップオーバーでも
  「ChainvizToken 1000.5000 CVZ」のように整形済みで表示されることを
  スクリーンショットで確認した（このサンドボックス環境では通常のブラウザ
  操作ができないため、キャッシュ済みの Playwright Chromium バイナリと
  別プロセスで抽出済みの共有ライブラリ(`libnss3`等)を`LD_LIBRARY_PATH`で
  読み込ませる方法で headless 起動した）。
- `pnpm --filter @chainviz/frontend build` / `pnpm --filter @chainviz/frontend
  test`（テストファイル76件・1191件、全件成功）を確認済み。
- 次の担当（chainviz-tester等）への申し送り:
  - `formatUnits`の境界値（`decimals`が非常に大きい場合、`amount`が
    極端に大きい/小さい場合等）はテストを増強できる余地がある。
  - `resolveWalletTokenBalances`は「アドレス突き合わせ」のみを見ており、
    同一`contractAddress`が`tokenBalances`内に重複するケースは
    サーバー側（collector）の前提上起こらない想定で未対応（重複時は
    両方とも表示される＝配列を単純にmapするだけ）。異常系として扱うか
    どうかはサーバー側の保証次第。

---

### レビュー記録（chainviz-reviewer）

- 判定: **合格**（下記の軽微な修正2点をレビュー側で実施済み）。
- 確認した内容:
  - `docs/ARCHITECTURE.md` §6.7 との整合: チップ列「{amount} {symbol}」・
    ラベル「トークン残高」（GlossaryTerm: `token`）・ダングリングガード・
    省略/空/全件照合不能時の行ごと非表示・`formatEther` の `formatUnits`
    への一般化・専用演出なし、のすべてが設計どおり実装されている。
  - `tokenAmount.ts` の decimals 変換: BigInt の商・剰余で整数部と小数部を
    分け、小数部を `decimals` 桁にゼロ埋めしてから先頭
    `min(fractionDigits, decimals)` 桁を切り出す実装で、桁合わせ・切り捨て
    （四捨五入しない）・uint256 最大値の精度保持をテストで確認した。
  - **casing 突き合わせの前提の検証**（testerの申し送り対応）: collector 側の
    コードを実際に確認した。`ContractEntity.address` は `ContractTracker`
    の `normalizeAddress`（`contracts.ts`）で常に小文字正規化され、
    `TokenBalance.contractAddress` は `ContractTracker.tokenContractAddresses()`
    が返す **`entity.address` そのもの**（同一文字列）を `WalletTracker` →
    `mergeTokenBalances`（`diff.ts`）が無加工で運ぶだけなので、両者の表記
    一致は「並行して同じ正規化をしている」のではなく**構造上同一の文字列
    ソースに由来する**ことを確認した。前提は成立している。フロント側の
    防御的正規化は不要と判断（仮に将来崩れてもダングリングガードで
    非表示に落ちるだけでクラッシュしない。testerのピン留めテストが
    乖離を検出する）。代わりに、この規約（ChainAdapter 実装は
    `ContractEntity.address` と同一表記で載せること）を
    `packages/shared/src/world-state/entities.ts` の `TokenBalance.contractAddress`
    の JSDoc に明文化した（shared の型注釈更新はレビュー担当の権限内）。
- レビュー側で実施した修正（呼び出し元の許可に基づく軽微な修正）:
  - **`formatUnits` の `fractionDigits=0` バグ修正**（tester発見の
    「末尾に余分なドットが残る」問題）: 現在の呼び出し元はすべて既定値4の
    ため実害は無いが、公開ユーティリティの契約（`fractionDigits` は表示
    小数桁数の上限）に反する出力であり、将来の呼び出しで静かに壊れるため
    修正した。あわせて、負の `fractionDigits` を渡すと `slice` の負インデックス
    解釈で**意図しない桁数の小数部が漏れる**（例: 18桁中16桁が出る）ことも
    発見したため、0 に切り上げる形で同時に修正した。CLAUDE.md の
    「実際に再現して確認する」に従い、回帰テスト2件
    （`tokenAmount.test.ts`）を先に追加して修正前に失敗（`"1."` /
    `"1.5000000000000000"`）することを確認してから修正し、修正後に
    通過することを確認した。
- テストの質: tester 追加分を含め、ハッピーパスだけでなく異常系
  （非数値・非整数/負のdecimals・空文字列の `BigInt("")===0n` 挙動の
  ピン留め）・境界値（uint256最大・decimals>18・ゼロ埋め・切り捨て・
  casing差異・順序保持）を実質的に検証しており、壊れたコードでも通る
  「意味のないテスト」は見当たらない。
- エラー握りつぶし・環境依存の固定値: 新規コードは純関数のみで該当なし。
  変換不能時に入力をそのまま返すフォールバックは既存 `formatEther` の
  契約踏襲でコメントに明記済み。
- `pnpm lint` / `pnpm build` / `pnpm test`: リポジトリ全体で全件通過
  （frontend はテストファイル76件・1205件成功）。
- 注意点（統括への申し送り）:
  - 本ブランチは未コミットのため、コミット分割時は「frontend実装」
    「テスト強化」「レビュー修正（formatUnits の fractionDigits 修正＋
    回帰テスト）」「shared の JSDoc 追記」を関心事ごとに分けること。
  - tester の作業記録がこのファイルに未追記（実装記録までしか無い）。
    記録の追記を tester または統括側で補うこと。

---

### テスト強化記録（chainviz-tester）

- 担当: tester（実装担当が書いた基本テストを異常系・境界値の観点で強化）
- 追加・強化したテスト:
  - `entities/tokenAmount.test.ts`: +8件。`fractionDigits=0` で末尾に余分な
    ドット（`"1."`）が残る不具合、負の `fractionDigits` で `slice` の負
    インデックス解釈により意図しない桁数の小数部が漏れる不具合を検出する
    ケースを含む境界値（uint256最大値、decimals>18、decimals=0、ゼロ埋め、
    切り捨て（四捨五入しない）、非数値/非整数decimals/負のdecimalsの
    フォールバック、空文字列の `BigInt("")===0n` 挙動のピン留め）を追加した。
    このうち `fractionDigits` 関連の2件は当初のバグを検出し、reviewer 側の
    修正で通過するようになった。
  - `entities/walletTokenBalances.test.ts`: +5件。`tokenBalances` の順序
    保持、`contractAddress` の casing（大小文字）差異時の突き合わせ挙動、
    複数件中一部のみ解決可能なケース、`token` 欠落・`ContractEntity` 未観測
    でのダングリング除外を強化した。
  - `entities/WalletPopover.test.tsx`: +1件。トークン残高フィールド行の
    表示（コントラクト名＋整形済み残高）と、突き合わせ不能時に行が出ない
    ことの分岐を追加した。
- 前提の突き合わせ確認（reviewer へ申し送り、reviewer が collector 側の
  コードで検証済み）: `ContractEntity.address`（`ContractTracker` の
  `normalizeAddress` で小文字正規化）と `TokenBalance.contractAddress`
  （`tokenContractAddresses()` が返す `entity.address` そのもの）は構造上
  同一文字列に由来するため、フロント側での防御的正規化は不要。ピン留め
  テストで casing 差異時の挙動を固定した。

---

### QA検証記録（chainviz-qa）

- 担当: qa（実際に動かしての検証）
- 環境: ブランチ issue-168-wallet-token-balance（未コミット）を
  worktree `chainviz-wt-168` で検証。
- 静的ゲート（独立実行）:
  - `pnpm lint`: 通過。
  - `pnpm build`: 通過。
  - `pnpm test`: 全通過（frontend テストファイル76件・1205件成功、
    collector 944件、shared 40件、e2e 34件）。collector のテストログに
    出るエラー行はエラーハンドリングを検証するテストの想定出力であり
    失敗ではない。
- 実機確認（`pnpm --filter @chainviz/frontend build:web` →
  `pnpm --filter @chainviz/frontend preview` で起動し、headless Chromium
  （Playwright）で画面を操作して確認）:
  - Alice のウォレットカード: トークン残高チップに「1000.5000 CVZ」が
    1件表示され、title 属性はコントラクト名「ChainvizToken」。人間可読
    形式で表示されていることをスクリーンショットで確認した。
  - Bob のウォレットカード: 正常な CVZ 残高「250.2500 CVZ」が1件のみ
    表示され、存在しないコントラクト（UNTRACKED_TOKEN_CONTRACT）を指す
    ダングリング残高は表示されない（トークンチップ総数=1、ダングリング
    チップの要素数=0）ことを確認した。ダングリングガードが機能している。
  - トークン残高0件のウォレット（SAFE_WALLET、`tokenBalances` を持たない）:
    カードにトークン残高セクション自体が出ないことをキャンバス全体の
    スクリーンショットで確認した。
  - WalletPopover（Alice にホバー）: 「トークン残高」フィールド行に
    「ChainvizToken 1000.5000 CVZ」が整形済みで表示されることを確認した。
  - コンソールエラー・ページエラーは実害のある内容なし（404 は favicon等の
    リソースで機能に影響なし）。
- 判定: **合格**。Issue #168 の完了条件（人間可読形式のトークン残高表示・
  ダングリング残高の非表示・0件時のセクション非表示・WalletPopover での
  表示）をすべて満たしている。
