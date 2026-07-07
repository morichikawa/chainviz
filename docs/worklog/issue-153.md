# Issue #153 beaconStableIdForExecution の docker compose プロジェクト・スコープ漏れ

### 2026-07-07 Issue #153 プロジェクト境界のスコープ対応（実装）

- 担当: collector
- ブランチ: issue-153-beacon-project-scope
- 内容: `packages/collector/src/adapters/ethereum/targets.ts` の
  `beaconStableIdForExecution()` が、compose サービス名から役割プレフィックス
  を剥がしたノード群キー（例: "reth1"/"beacon1" → "1"）の一致だけで
  execution ⇔ beacon の対応付けを行っており、docker compose プロジェクト部
  （`projectOf()`。stableId の `"<project>/<service>"` の `<project>` 部分）
  を比較していなかった不具合を修正した。同ファイルには既に `projectOf()` が
  存在していたが未使用だった。

## 経緯・原因

1 つの collector インスタンスが複数の docker compose プロジェクトを同時に
観測する状況（通常運用では起きないが、Issue #141 の QA 検証時にメイン環境と
検証用の使い捨て環境を同時観測した際に実際に観測された。詳細は
`docs/worklog/issue-141.md` の QA セクション「補足」を参照）で、ノード群キー
だけが一致する別プロジェクトの beacon を誤って対応付けてしまい、
プロジェクト跨ぎの実行エッジ（例:
`chainviz-ethereum/reth1 <-> chainviz-qa141/reth2`）が発生する可能性が
あった。

## 変更内容

`beaconStableIdForExecution()` を、探索対象の beacon 候補を
「execution コンテナと同じ `projectOf(stableId)` を持つもの」に絞り込むよう
修正した。ノード群キーの一致判定自体（`serviceNodeKey()`）は変更していない。
対応する beacon が自プロジェクトに存在しなければ、従来どおり `undefined`
（呼び出し側でフォールバック）を返す。

## テスト

`packages/collector/src/adapters/ethereum/targets.test.ts`:

- 既存の "returns the first beacon encountered when several share the node
  key" テストは、修正前の（意図的でない）挙動をそのまま固定してしまって
  いたため、"only matches a beacon within the same compose project, even if
  another project's beacon is observed first" に書き換えた。他プロジェクトの
  同名 beacon が観測順で先に来ても、自プロジェクトの beacon だけが選ばれる
  ことを検証する。
- 新規に "returns undefined when only a different project's beacon shares
  the node key" を追加した。自プロジェクトに対応する beacon が存在せず、
  別プロジェクトの同名サービスしかない場合はフォールバックすることを固定した。
- `executionTargets` 側の対応するテスト "uses the first matching beacon for
  the shared node key when several exist" も、同様に修正後の仕様
  （`receivedAtKeys` の beacon キーは同一プロジェクトの beacon になる）へ
  書き換えた。

新規テストが実際に修正前の不具合を検出できることを、変更前の
`targets.ts`（`git stash` で一時的に退避）に対して実行して確認した
（3件失敗）。その後修正版に戻して全件通過することを確認した。

## 実機での動作確認

メインの `chainviz-ethereum` docker compose プロジェクトが稼働中の環境で、
`dockerode` の `listContainers()`（読み取り専用。コンテナの作成・削除等は
一切行っていない）で実際のコンテナ一覧を取得し、そこに合成した
`other-project/beacon1`（実在しない別プロジェクトの beacon を模した
オブジェクト。docker には一切登録していない）を観測配列に混ぜてビルド後の
`beaconStableIdForExecution()` を呼び出した。

- 修正前のコード: `other-project/beacon1` が誤って返された（不具合の再現）。
- 修正後のコード: `chainviz-ethereum/beacon1`（自プロジェクトの beacon）が
  正しく返された。

検証に使ったスクリプトは一時ファイルであり、確認後に削除した
（コミットには含めていない）。メインの docker compose プロジェクトに対する
書き込み・削除等の操作は行っていない。

## 結果

- `pnpm build`（collector）成功。
- `pnpm test`（collector）: 712 件全て通過（既存の書き換え2件 + 新規1件を
  含む）。
- `packages/shared` の型変更は無し。フロント側の変更も無し（本 Issue の
  スコープは collector の対応付けロジックのみ）。

## 次の担当への申し送り

- 静的レビュー・実機 QA は未実施。レビュー・QA を経てからマージすること。
- push / PR 作成 / マージ / Issue クローズは統括の判断・実行に委ねる。

### 2026-07-07 Issue #153 テスト強化（異常系・境界値）

- 担当: テスト強化（chainviz-tester）
- ブランチ: issue-153-beacon-project-scope
- 対象: `packages/collector/src/adapters/ethereum/targets.test.ts`

実装担当が書いた基本テスト（ハッピーパス中心）に対し、プロジェクト・
スコープ周りの境界値・異常系を追加した。実装（`targets.ts`）は変更していない。

追加したテスト（計7件）:

`beaconStableIdForExecution`:
- 3 プロジェクト混在（proj-a/proj-b/proj-c がノード群キー "1" を共有）で、
  観測順を交錯させても各 execution が自プロジェクトの beacon にだけ対応する
  ことを確認（2 プロジェクト超でも #153 のスコープが成立することの固定）。
- プロジェクト名が接頭辞関係にある場合（"chainviz" ⊂ "chainviz-ethereum"）、
  projectOf の完全一致判定により別プロジェクト扱いになり対応付けないこと。
- beacon 側 stableId にプロジェクト接頭辞が無い場合、projectOf が stableId
  全体を返して execution のプロジェクトと一致せず対応付けないこと。
- execution・beacon の双方にプロジェクト接頭辞が無い場合、projectOf が
  それぞれ "reth1" / "beacon1" を返して一致せず対応が取れないこと（後述の
  「点検で確認した仕様上の限界」を固定）。
- stableId に想定外の追加スラッシュが含まれても、projectOf が先頭セグメント
  のみをプロジェクトとみなすこと（"proj/extra/reth1" と "proj/extra/beacon1"
  は先頭 "proj" が一致するので対応する）。

`executionTargets`:
- 2 プロジェクトを beacon 先・プロジェクト順入れ替えで同時観測しても、各
  reth の receivedAtKeys の beacon キーが同一プロジェクトの beacon になり、
  クロスプロジェクトのエッジが発生しないことを end-to-end で確認。

`executionPeerTargets`:
- 複数プロジェクト混在時、各 execution の networkId が自身の stableId から
  導かれ、プロジェクト跨ぎの混線が起きないことを確認（下記点検の裏付け）。

結果: `pnpm --filter @chainviz/collector build` 成功、`pnpm --filter
@chainviz/collector test` 719 件全通過（既存 712 + 新規 7）。

### 同ファイル内の関連ロジックの点検（#153 の修正範囲外）

`executionPeerTargets` / `beaconTargets` / `executionRpcUrls` /
`executionTargets` の各関数を、同種のプロジェクト・スコープ漏れが無いか
点検した。`beaconStableIdForExecution` 以外はノード横断の対応付けを行わず、
各コンテナの networkId / URL を自身の stableId から独立に導いているため、
プロジェクト跨ぎの誤対応は構造的に発生しない。バグは見つからなかった。

### 点検で確認した仕様上の限界（バグではない、実害なし）

`beaconStableIdForExecution` はプロジェクト一致を projectOf（stableId の
先頭スラッシュ前）で判定するため、compose ラベルが揃わず stableId が
コンテナ名/コンテナ ID にフォールバックした（= プロジェクト接頭辞を
持たない）ノードでは execution ⇔ beacon の対応が取れなくなる（projectOf が
"reth1" / "beacon1" のように別々の値を返して一致しないため）。ただし
通常運用の stableId は必ず "<project>/<service>" 形式（computeStableId が
project ラベルと service ラベルの両方が揃ったときのみスラッシュ形式を作る）
であり、その場合は service ラベルが取れているので #153 の前提が満たされる。
接頭辞を持たない stableId になるのは project ラベル・service ラベルの
どちらか一方でも欠けた異常時のみで、その際はそもそも beacon 対応が取れなく
ても receivedAtKeys が自身の stableId のみにフォールバックするだけなので
実害は無い。この挙動を回帰テストとして固定した。
（2026-07-07 静的レビューでの訂正: 当初「両ラベルが欠けた場合のみ」と記載
していたが、正確には computeStableId の `project && service` という AND
条件により、どちらか一方でも欠ければ非スラッシュ形式になる。結論（実害
なし）自体への影響はない。）

### 2026-07-07 Issue #153 静的レビュー（合格）

- 担当: レビュー（chainviz-reviewer）
- ブランチ: issue-153-beacon-project-scope
- 判定: **合格**

確認した内容:

1. **設計原則との整合**: 修正は `packages/collector/src/adapters/ethereum/`
   内に完結しており、既存の `projectOf()`（同ファイル内で networkId 導出に
   使用済み）を再利用している。`packages/shared` やフロントへのチェーン固有
   語彙の漏出は無い。既存プロファイルへの分岐追加でもない。コメントで
   スコープの理由（Issue #153）と Ethereum 固有知識の閉じ込めを明記して
   おり、CLAUDE.md の ChainAdapter 境界の原則に沿う。
2. **shared の型変更が無いこと**: `git status` / `git diff --stat` で変更
   ファイルは `targets.ts` / `targets.test.ts` / docs 3 件のみであることを
   確認。`packages/shared` に変更は無い。
3. **仕様上の限界の記録の妥当性**: `computeStableId`（`docker/observe.ts`）
   を読み、「project ラベルと service ラベルの両方が揃ったときのみ
   `<project>/<service>` 形式になる」という記録どおりの実装であることを
   確認した。接頭辞を持たない stableId では対応が取れず receivedAtKeys が
   自身の stableId のみにフォールバックする、という限界の説明・回帰テスト
   （"does not match when neither execution nor beacon carries a project
   prefix"）とも整合する。1 点だけ補足: worklog の「接頭辞を持たない
   stableId になるのは**両ラベルが欠けた**異常時のみ」は、正確には
   「**どちらか一方でも**ラベルが欠けた異常時」（`project && service` の
   AND 条件のため）。結論（実害無し）には影響しないため差し戻しはせず、
   ここに訂正として記録する。
4. **エラーの握りつぶし**: 変更箇所に catch は無く、対応が取れない場合は
   `undefined` を返して呼び出し側（`executionTargets`）が自身の stableId
   のみへフォールバックする設計。フォールバックの挙動はコメント・テストの
   両方で明示されており、握りつぶしには当たらない。
5. **ビルド・lint・テスト**: リポジトリルートで `pnpm lint` / `pnpm build` /
   `pnpm test` をすべて実行し全通過（collector 719 件・frontend 791 件、
   worklog の記録と一致）。
6. **テストの質**: 旧仕様（観測順依存）を固定していたテスト 2 件を修正後の
   仕様へ書き換え、フォールバック（undefined）・3 プロジェクト混在・
   接頭辞一致の排除（完全一致）・接頭辞欠落・追加スラッシュの各境界値を
   カバー。実装担当が修正前コードで新規テストの失敗（3 件）を確認した旨も
   記録されており、「壊れたコードでも通るテスト」ではないことが担保
   されている。
7. **固定値の埋め込み**: タイムアウト・件数上限等の環境依存の定数追加は無い。
8. **docs との齟齬**: `docs/ARCHITECTURE.md` / `docs/CONCEPT.md` に
   `beaconStableIdForExecution` やノード群キーへの言及は無く（アダプタ内部の
   実装詳細）、更新は不要。

コミット粒度について（現時点で全変更が未コミット）:

変更は関心事ごとに以下の 3 コミットへ分けることを推奨する（過去 Issue
（#143 等）の粒度に合わせた形。`targets.test.ts` は実装担当分と tester 分が
混在しているため `git add -p` での分割が必要）:

1. `fix(collector)`: `targets.ts` の修正 + 実装担当による既存テスト
   書き換え 2 件・新規 1 件
2. `test(collector)`: tester による境界値・異常系テスト 7 件
3. `docs`: `docs/worklog/issue-153.md` 新規 + `docs/WORKLOG.md` 索引 +
   `docs/PLAN.md` チェックボックス

push / PR 作成 / マージ / Issue クローズは統括に委ねる。QA（chainviz-qa）は
未実施。
