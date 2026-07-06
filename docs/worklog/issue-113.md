# Issue #113 仮カード(ゴーストノード)の配置indexが、削除を挟むと重なることがある

### 2026-07-06 Issue #113 バックログ登録のレビュー

- 担当: reviewer
- ブランチ: docs-plan-add-113-backlog
- 内容: Issue #113 の起票と `docs/PLAN.md` バックログへの追加（コミット
  5717441、docs のみの変更）をレビューし、合格とした
- 確認したこと:
  - `gh issue view 113` で Issue が OPEN であり、タイトル
    「仮カード(ゴーストノード)の配置indexが、削除を挟むと重なることがある」
    が PLAN.md のバックログ記載と一致すること。`frontend` ラベル付与も適切
    （原因箇所が `packages/frontend/src/commands/useCommands.ts` のため）
  - Issue 本文が、Issue #102 の静的レビュー時に指摘した内容
    （`docs/worklog/issue-102.md` の 2026-07-06 静的レビュー記録。
    現時点では issue-102-add-ghost-node ブランチ上）を正確に反映している
    こと。具体的には:
    - 原因コードの記載（`index: infraCount + ghostSeqRef.current`）が
      issue-102-add-ghost-node ブランチの実装（コミット 83152de 時点の
      `useCommands.ts`）と一致する
    - 再現手順（entityAdded で infraCount=1 → addNode で index=1、seq→1 →
      entityRemoved で infraCount=0 → addNode で index=0+1=1 となり
      1枚目と同一セルに重なる）が、増分と減分が相殺するという指摘の
      メカニズムどおりである
    - 「ゴーストが消えても巻き戻さない（以後常に新しいセルへ置ける）」
      というコメントが過大な主張である点、影響が表示上の重なりのみで
      機能への実害が無い点、対応方針（配置 index を単調増加カウンタ単独に
      する）も、レビュー時の申し送りと一致する
  - `pnpm lint` がリポジトリ全体で通ること（exit 0）
  - コミットが 5717441 の1件のみで、docs のみの変更として関心事が
    混ざっていないこと
- 注記: Issue 本文が参照する `useCommands.ts` のコードは、レビュー時点では
  main 未マージの issue-102-add-ghost-node ブランチ上にある。#102 が
  マージされる前に本 Issue に着手しないこと（着手時は #102 マージ後の
  実装を前提にする）。
- QA について: docs のみの変更のため、統括の判断により chainviz-qa は
  省略（動かして検証する対象が無い）。

### 2026-07-06 Issue #113 実装(frontend: ゴースト配置indexの重なり修正)

- 担当: frontend
- ブランチ: issue-113-fix-ghost-position-overlap
- 内容: `packages/frontend/src/commands/useCommands.ts` のゴースト（仮カード）
  配置indexの計算方法を変更した。
  - 旧実装: `index: infraCount + ghostSeqRef.current`（現在の infraCount と
    単調増加する連番の単純合算）。infraCount は既存の node/workbench
    エンティティ数で、削除が起きると減少する。ゴーストが生きている間に
    既存インフラが削除されると、後から発行したゴーストの計算結果が
    先に発行済みのゴーストの位置と一致してしまい、グリッド上で重なる
    バグがあった（Issue本文の再現手順どおり）。
  - 新実装: `ghostIndexRef`（次に払い出すインデックスを保持する ref）を
    `Math.max(ghostIndexRef.current, infraCount)` で更新し、実際に払い出す
    index もこの値を使う。infraCount は「最低限このインデックス以上を使う」
    という下限としてのみ参照し、加算はしない。ghostIndexRef 自体は
    一度払い出した値より小さい値を二度と返さない単調増加のカウンタになる
    ため、既存インフラの削除で infraCount が下がっても、既に表示中の
    ゴーストの位置を再利用することがない。既存の「既存 node/workbench
    カードと衝突しない」という下限の仕組みは維持している。
  - `ghostSeqRef` にあった「ゴーストが消えても巻き戻さない（以後常に新しい
    セルへ置ける）」というコメントは、この不具合が示すとおり過大な主張
    だったため削除し、新しい変数名・設計意図に合わせて書き直した。
- テスト: `packages/frontend/src/commands/useCommands.test.tsx` に
  Issue #113 専用の describe ブロックを追加した。
  - Issue本文の再現手順（entityAdded で登録 → addNode → entityRemoved で
    削除 → addNode）をそのままテストケース化し、2枚目のゴーストの座標が
    1枚目と一致しないことを確認する
  - 既存インフラを複数回削除しながら addNode を繰り返しても、生存中の
    全ゴーストの座標が互いに重複しないことを確認する
  - 修正前のコード（`git stash` で一時的に旧実装へ戻した状態）でこの2件が
    実際に失敗すること、修正後に成功することを確認済み（「直したはず」で
    済ませず実際に再現・再確認した）
- 確認: `pnpm build`（frontend）・`pnpm test`（frontend、全541件）・
  `pnpm eslint`（変更ファイルに対して）がいずれも成功
- 次の担当への申し送り: 実装済みだが `chainviz-tester` によるテスト強化・
  `chainviz-reviewer` の静的レビュー・`chainviz-qa` の検証は未実施。
  `docs/PLAN.md` のチェックボックスは更新済みだが、Issue のクローズは
  PR マージ時の `Closes #113` に委ねる（自分ではクローズしない）。

### 2026-07-06 Issue #113 テスト強化(tester: 配置indexの異常系・境界値)

- 担当: tester
- ブランチ: issue-113-fix-ghost-position-overlap
- 内容: `packages/frontend/src/commands/useCommands.test.tsx` に describe ブロック
  「placement index edge cases (Issue #113)」を追加し、配置 index 計算
  （`Math.max(ghostIndexRef, infraCount)` の単調増加カウンタ）の不変条件を
  異常系・境界値の観点で 7 件のテストで固定した。位置の一致/不一致は実装が
  内部で使う `defaultGridPosition` を用いて座標を直接照合している。
  - 3枚以上の仮カードが同時に存在する状態で、途中（2番目）の仮カードだけを
    失敗で消した後に再度 addNode しても、空いたセルを再利用せず単調増加で
    次のセルへ置かれること
  - 仮カードが実体到着で確定し、その実体がその後削除されて infraCount が
    下がっても、まだ表示中の別の仮カードと重ならないこと（index が巻き戻ら
    ないこと）
  - node 用と workbench 用の仮カードが交互に混在しても、両者は同一の単調
    カウンタを共有して種別に関わらず別セルへ置かれること（位置計算の独立性）
  - 他クライアントからの一括追加通知で infraCount が一気に跳ね上がった場合
    （5件同時追加）、次に払い出す index が `Math.max` の下限で infraCount 側へ
    押し出され、既存 infra カードのグリッドセルと重ならないこと
  - 同一イベントハンドラ内での連続 addNode（render を挟まない）でも、既存
    infra が存在する状態で両者が別セルへ、かつ infraCount を下限として前方へ
    置かれること
  - 追加・確定・削除・失敗が入り乱れる長いシーケンスを通して、生存中の全
    仮カードの座標が常に互いに重複しないこと
  - 既存 infra 削除を挟んで node 仮カード → workbench 仮カードの順で発行した
    場合（旧 `infraCount + seq` 方式では両者が index 1 で衝突していた、node/
    workbench 混在の再現ケース）、単調カウンタ方式では workbench 仮カードが
    index 2 へ押し出され重ならないこと
- 確認: `pnpm test`（frontend、全 548 件・useCommands は 48 件）が成功。
  `tsc --noEmit`（frontend、テストファイル含む）が型エラー無しで通ること。
  `pnpm build`（frontend、`tsc -b`）が成功すること。
- 実装のバグ: 見つからなかった。実装は Issue #113 の設計意図どおりで、追加
  したテストはすべて現行実装で成功する。
- 補足（既知の制約・#113 スコープ外）: 既に配置済みの仮カードは、その後に
  実体カードがグリッドの前方セルを埋めていった場合に実体カードと重なりうる
  （仮カードの位置は生成時に固定され、後から遡って移動しないため）。これは
  #113 が対象とする「仮カード同士の生成時の重なり」とは別の事象で、仮カードは
  実体到着や安全網タイムアウトで速やかに消えるため実害は小さい。修正対象では
  ないが観察として記録する。
- 次の担当への申し送り: `chainviz-reviewer` の静的レビュー・`chainviz-qa` の
  検証は未実施。
