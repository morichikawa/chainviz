# Issue #141 reth(EL)同士のエッジにブロック伝播パルスが走らない

### 2026-07-07 Issue #141 EL間エッジへのブロック伝播パルス対応（設計）

- 担当: designer（設計）
- ブランチ: issue-141-el-block-pulse
- 内容: EL(reth)同士のピアエッジ（Issue #106 で描画されるようになった
  `<project>-execution` の networkId のエッジ）にブロック伝播パルスが
  構造的に一切走らない問題の設計。collector 側の記録方法・frontend 側の
  影響・shared の型変更要否を確定した。

## 現状分析（設計判断の前提）

- collector は **CL 側のブロック購読を一切行っていない**。B層の受信時刻の
  唯一のソースは、各 EL(reth) への `eth_subscribe(newHeads)`
  （`packages/collector/src/adapters/ethereum/index.ts` の
  `subscribeBlocks()`）。
- `targets.ts` の `executionTargets()` が `ExecutionTarget.receivedAtKey` に
  「同じ論理ノードを構成する beacon の stableId」（見つからなければ EL 自身の
  stableId）を割り当て、`subscribeBlocks()` は
  `blockTracker.record(target.receivedAtKey, header, now)` でその 1 キーに
  だけ記録する。EL 自身の stableId は（フォールバック時を除き）
  `receivedAt` に現れない。これが本 Issue の原因。
- したがって Issue 本文の論点「CL ブロックと EL ブロックが別々の
  `BlockEntity` になるのではないか」は**そもそも起きない**。`BlockEntity` は
  execution ブロックのハッシュ単位で 1 つだけ存在し、beacon の stableId
  キーは「EL の受信イベントを CL エッジの端点名で記録した別名」にすぎない。
  統合・分離を検討する対象の「CL ブロックエンティティ」は存在しないため、
  エンティティ統合の設計は不要。

## 設計（決定事項）

対応方針は Issue 記載どおり「同じ `newHeads` 受信 1 回を、beacon の
stableId と EL 自身の stableId の 2 キー・同一時刻で `receivedAt` に
記録する」。変更は collector のみ。frontend・shared は変更不要。

### collector の変更（3 ファイル）

1. `packages/collector/src/adapters/ethereum/targets.ts`
   - `ExecutionTarget.receivedAtKey: string` を
     `receivedAtKeys: string[]` に変更する。
   - 値は beacon が見つかれば `[beaconStableId, 自身のstableId]`、
     見つからなければ `[自身のstableId]`（beacon は consensus クライアント、
     自身は execution コンテナなので stableId が一致することは構成上なく、
     この作り方なら重複排除は不要）。
   - doc コメントを「CL エッジ用の beacon キーと EL エッジ用の自身キーの
     両方に記録する」趣旨へ更新する。
2. `packages/collector/src/adapters/ethereum/blocks.ts`
   - `BlockPropagationTracker.record(nodeId: string, ...)` を
     `record(nodeIds: readonly string[], header, receivedAt): BlockEntity`
     に変更する。各キーについて既存の「同一キーの再受信は初回時刻を保持」の
     意味論はそのまま。
   - 1 回の呼び出しで 1 つのマージ済み `BlockEntity` を返す形を保つことで、
     「newHeads 受信 1 回 = `onBlock` 発火 1 回 = 差分イベント 1 回」という
     現在の粒度を維持する（キーごとに `record` を 2 回呼んで最後の戻り値
     だけを流す案は、呼び出し側に「2 回呼んで 1 回だけ emit」という不自然な
     パターンを強いるため不採用）。
3. `packages/collector/src/adapters/ethereum/index.ts`
   - `subscribeBlocks()` 内の `blockTracker.record(target.receivedAtKey, ...)`
     を `record(target.receivedAtKeys, ...)` に変更する。

### テストへの影響（意図的な仕様変更を含む）

- `targets.test.ts` / `blocks.test.ts` / `peer-block-adapter.test.ts` の
  期待値を新仕様に更新する。
- 特に peer-block-adapter.test.ts の「reth1 と geth1 が beacon1 を共有する
  ケース」（現在は `{beacon1: 1000}` の 1 キーに畳まれることを固定している
  テスト）は、新仕様では
  `{beacon1: 1000, reth1: 1000, geth1: 1500}` になる。beacon1 キーは
  初回優先で 1000 のまま、EL 各自のキーには各自の実受信時刻が入る。
  **これは本 Issue の目的そのもの**（EL-EL エッジ reth1-geth1 が実受信差分で
  パルス対象になる）なので、テストの期待値変更は仕様変更として正しい。

## frontend への影響（変更不要と判断した根拠）

査読担当のレビュー申し送りにあった懸念「CL-CL エッジ・EL-EL エッジが
対応するネットワーク種別のブロック伝播だけを見るように分離されるか」に
ついて、`packages/frontend/src/entities/blockPulse.ts` を確認した結論:
**frontend のロジック変更は不要**。

- `computeBlockPulses()` は「エッジの両端点の stableId で `receivedAt` を
  引き、両方に有限値があるエッジだけ」を対象にする。CL エッジの端点は
  beacon の stableId のみ、EL エッジの端点は execution の stableId のみで、
  端点集合が互いに素（混在エッジは存在しない。targets.ts のコメントと
  ARCHITECTURE.md 4章のとおり）。よって同じ `receivedAt` マップに EL キーを
  足しても、CL エッジは beacon キーだけ・EL エッジは EL キーだけを読む。
  分離は端点照合だけで自然に成立し、networkId によるフィルタ追加は不要。
- `waveOriginTime()`（波の起点 t0 = 全値の min）: beacon キーと EL キーは
  同一イベントの同一時刻の複製なので min は変わらない。既存の CL エッジの
  パルスタイミング（startDelayMs / durationMs）は変更前と完全に一致する。
- `isFreshBlock()`（max 基準の鮮度判定）も同様に不変。
- `useBlockPulses` の重複排除は blockHash×edgeId 単位なので、EL エッジ分の
  パルスが新規に走るだけで既存分と干渉しない。
- 期待される見え方: 同じ論理ブロックの伝播で、共通の起点 t0 から CL 層・
  EL 層の両方に波が走る。EL エッジは EL ノード間の実受信差分、CL エッジは
  従来どおり（EL 受信時刻のエイリアス同士の差分）。

## shared の型変更

不要。`BlockEntity.receivedAt` は `Record<string, number>` で任意の
stableId キーを許容しており、キーが増えても型・スキーマに変更はない。
（`docs/ARCHITECTURE.md` の 4 章「アダプタが担う観測」の該当記述は設計時点で
更新済み。）

## 実装担当への引き継ぎ

- 担当: collector（frontend の作業は無し。tester が回帰テストを足すのは可）。
- 決定済みとしてよい前提: 上記「collector の変更（3 ファイル）」の内容、
  `record()` のシグネチャ（`nodeIds: readonly string[]`）、
  `receivedAtKeys` の構成規則（beacon あり=2要素 / なし=1要素）。
- 実装時に判断してよい点: `record()` 内部のループの書き方などの実装詳細。
- 注意点:
  - beacon キーの時刻は「同じ論理ノードの EL の受信時刻」のエイリアスで
    あり CL の実受信時刻ではない、という既存の意味論は変えない。CL 側の
    実受信時刻の観測（Beacon API の event stream 等）は本 Issue の範囲外
    （先回り実装をしない）。
  - tester への観点: (1) 上記の意図的な期待値変更、(2) beacon フォール
    バック時に `receivedAtKeys` が 1 要素になること、(3) frontend 側に
    「CL/EL キー混在の `BlockEntity` で CL エッジのタイミングが従来と
    不変・EL エッジが新たにパルス対象になる」ことを固定する回帰テストを
    `blockPulse` テストへ足す価値がある。

### 2026-07-07 Issue #141 EL間エッジへのブロック伝播パルス対応（実装）

- 担当: collector（実装）
- ブランチ: issue-141-el-block-pulse
- 設計どおり、collector の 3 ファイルを変更した。

## 変更内容

1. `packages/collector/src/adapters/ethereum/targets.ts`
   - `ExecutionTarget.receivedAtKey: string` を `receivedAtKeys: string[]`
     に変更。`executionTargets()` は、対応する beacon が見つかれば
     `[beaconStableId, obs.stableId]`、見つからなければ `[obs.stableId]`
     を返すようにした。
2. `packages/collector/src/adapters/ethereum/blocks.ts`
   - `BlockPropagationTracker.record(nodeId: string, ...)` を
     `record(nodeIds: readonly string[], ...)` に変更。内部でキーごとに
     ループし、各キーについて「未記録なら受信時刻を設定する」（初回優先）
     従来の意味論をそのまま維持した。1 回の呼び出しで 1 つのマージ済み
     `BlockEntity` を返す粒度も変えていない。
3. `packages/collector/src/adapters/ethereum/index.ts`
   - `subscribeBlocks()` 内の呼び出しを
     `this.blockTracker.record(target.receivedAtKeys, header, this.now())`
     に変更。

いずれも doc コメントを新しい仕様（複数キー・同一時刻記録の趣旨、Issue #141
への参照）に更新した。frontend・`packages/shared` は設計どおり変更していない。

## テスト

- `blocks.test.ts`: 既存の `record()` 呼び出しをすべて配列引数に更新した
  うえで、新規に以下を追加した。
  - 複数キーを 1 回の呼び出しで同一時刻に記録できること
  - 複数キーそれぞれが呼び出しをまたいで独立に「初回優先」を保つこと
  - 空配列を渡しても既存の `receivedAt` に影響しないこと（境界値）
- `targets.test.ts`: `receivedAtKey` を参照していた既存アサーションを
  `receivedAtKeys`（配列）に更新した。beacon 対応時は
  `[beacon, 自身]` の2要素、フォールバック時は `[自身]` の1要素になる
  ことを検証している。
- `peer-block-adapter.test.ts`: `subscribeBlocks` の統合テスト3件の期待値を
  更新した。
  - 「両ノードとも beacon が対応する」ケース: `receivedAt` に
    beacon キーと reth 自身のキーの両方が入ることを確認するよう変更。
  - 「beacon対応ありなしが混在する」ケース: beacon 対応のある reth1 側に
    `beacon1` キーと `reth1` キーの両方が入ることを確認するよう変更。
  - 「reth1とgeth1がbeacon1を共有する」ケース（レビュー時点で名指しされて
    いたテスト）: 従来は `{beacon1: 1000}` の1キーに畳まれることを固定して
    いたが、新仕様では `{beacon1: 1000, reth1: 1000, geth1: 1500}` になる
    ことを固定するよう更新した。beacon1 キーは初回優先で共有され続ける一方、
    reth1・geth1 は自身のキーにそれぞれの実受信時刻を独立して持つ。

`pnpm build` / `pnpm test`（collector パッケージ、リポジトリ全体の
`pnpm -r build` も含む）がすべて通ることを確認した。

## 実機での動作確認

`profiles/ethereum` の compose を複製し、プロジェクト名・サブネット・
公開ポートをすべて変更した使い捨て環境（`chainviz-elpulse-test`、
reth1/beacon1 + reth2/beacon2 の2ノード構成）をスクラッチパッド配下に
作成して起動した（メインの `chainviz-ethereum` プロジェクトには一切
触れていない）。Docker のコンテナ一覧を `com.docker.compose.project`
ラベルでこの使い捨てプロジェクトだけに絞るようフィルタした
`DockerPoller` 経由で、ビルド後の `EthereumAdapter.subscribeBlocks()` を
実際に動かし、`onBlock` に渡ってくる `BlockEntity.receivedAt` を目視で
確認した。

観測結果（一部抜粋、実際のブロック受信時刻。ミリ秒 epoch）:

```
number=47 receivedAt={ beacon1: ...057044, reth1: ...057044 }
(2回目の受信後)
number=47 receivedAt={
  beacon1: ...057044, reth1: ...057044,
  beacon2: ...057054, reth2: ...057054,
}
```

reth1 と reth2 の受信時刻が実際に約10ms異なっており、EL-EL エッジ
（reth1-reth2）が実受信差分でパルス対象になることを実データで確認した。
確認後、使い捨て環境は `docker compose down -v` で完全に破棄した。

## 次の担当への申し送り

- `chainviz-tester` へ: 上記で書いた基本テストに加え、異常系・境界値の
  観点（例: `receivedAtKeys` に同じ文字列が重複して渡るケースがあり得るか
  の再検証、`BlockPropagationTracker` の eviction と多キー記録の組み合わせ
  など）を強化してもらう余地がある。
- frontend 側の回帰テスト（`blockPulse` テストへの追加）は、設計時点で
  「変更不要」と判断済みだが、tester が固定用の回帰テストを追加する価値は
  ある旨、設計メモに引き続き記載してある。

### 2026-07-07 Issue #141 異常系・境界値テストの強化（テスト強化）

- 担当: tester（テスト強化。実装は変更していない）
- ブランチ: issue-141-el-block-pulse
- 実装担当が書いた基本テストに対し、異常系・境界値・レイヤ分離の観点で
  テストを追加した。実装コードには手を入れていない。

## 追加したテスト

`packages/collector/src/adapters/ethereum/blocks.test.ts`
（`BlockPropagationTracker`）:

- 複数キーの 1 回の `record()` 呼び出しに「すでに記録済みのキー（共有 beacon）」
  と「未記録のキー」が混在するケースで、共有キーは初回時刻を保ち、未記録キー
  だけが今回の時刻を得ること（本 Issue の核心的な混在状態の意味論）。
- 空配列を新規ハッシュに渡したとき、`receivedAt` が空でも `BlockEntity` 自体は
  生成・追跡され、後続のキー付き受信が同じブロックにマージされること（空配列が
  「エンティティを作らない」に化けない境界値）。
- 1 回の呼び出しの配列に同じキーが重複して現れても、初回優先の判定で 1 回だけ
  記録され値が安定すること（理論上起きない入力への防御）。
- 呼び出しをまたいで同じキーが重複配列で来ても最早時刻を保つこと。
- ある受信で返した `BlockEntity` のスナップショットが、後続の受信で別キーが
  増えても後から書き換わらないこと（`record` が既存 `receivedAt` をコピーして
  から足すためのアリアシング防止の確認）。

`packages/collector/src/adapters/ethereum/targets.test.ts`
（`executionTargets`）:

- `receivedAtKeys` が `[beacon, 自身]` の順で、2 要素が重複しない（自身の
  stableId が beacon キーと一致しない）ことを固定。
- ノード群キーを共有する beacon が複数観測されたとき、beacon キーは最初に
  見つかったものになる（現状の観測順依存の挙動を固定）。

`packages/frontend/src/entities/blockPulse.test.ts`
（`computeBlockPulses`、"mixed CL/EL keys (Issue #141)" describe を新設）:

- 設計判断「frontend は変更不要」を裏付ける回帰テスト。CL エッジのパルス出力が、
  `receivedAt` に EL キーを足しても beacon キーだけの block と完全に一致すること。
- 1 つの CL/EL キー混在 block から、CL エッジと EL エッジが独立にパルスを立て、
  それぞれ対応するレイヤの端点キーだけを読むこと。
- EL エッジが beacon キーを一切読まないことの証明として、beacon と reth の時刻を
  意図的に食い違わせ、EL エッジの `durationMs`・`startDelayMs` が reth 時刻だけ
  から算出されることを確認。
- beacon キーを EL ノード間で共有するケース（統合テストの reth1/geth1 共有
  beacon1 に対応）で、EL-EL エッジが実受信差分でパルス対象になること。

## 結果

- collector: 641 → 648 テスト、frontend: 761 → 765 テスト。いずれも全て通過。
- `pnpm --filter @chainviz/collector build` / `pnpm --filter @chainviz/frontend
  build` ともに成功。
- 実装のバグは検出されなかった。実装担当の申し送りにあった「重複キーが渡る
  ケース」「eviction と多キー記録の組み合わせ」も、既存の初回優先ロジックで
  正しく処理されることをテストで確認した。

## 補足（バグではないが記録として残す nuance）

- `waveOriginTime()` は `receivedAt` の全キーの min を波の起点 t0 とする。
  設計メモは「beacon キーと EL キーは同一時刻の複製なので min は変わらない」と
  しているが、これは「全 Execution ノードに対応する beacon がある」均質な構成
  （実 Ethereum profile）でのみ厳密に成り立つ。beacon を持たない EL only ノードが
  最も早く受信する混在構成では、その EL キーが t0 を早める余地があり、CL エッジの
  `startDelayMs` が変わり得る。ただしこれは「ブロックがネットワーク全体で最初に
  観測された時刻を起点にする」という意味づけとして妥当な挙動であり、実 profile
  では発生しないため、バグとして扱わず記録に留める（実装変更は不要）。

### 2026-07-07 Issue #141 静的レビュー1回目（差し戻し・軽微指摘2点）

- 担当: reviewer（静的レビュー）
- ブランチ: issue-141-el-block-pulse
- 判定: **差し戻し（軽微）**。実装本体・テスト・docs 更新は設計と整合して
  おり健全。ビルド・lint・テストも全て通る。ただし下記2点のコメント修正が
  必要（いずれもコード挙動の変更は不要）。

## 確認した内容（問題なし）

- 設計の反映: `targets.ts` の `receivedAtKeys: string[]`（beacon あり=
  `[beacon, 自身]` / なし= `[自身]`）、`blocks.ts` の
  `record(nodeIds: readonly string[], ...)`（キーごとに初回優先、1回の
  呼び出しで1つのマージ済み BlockEntity を返す粒度を維持）、`index.ts` の
  呼び出し更新、いずれも設計メモの決定事項どおり。designer が訂正した前提
  （「CL ブロックと EL ブロックが別 BlockEntity になる」問題はそもそも
  存在せず、beacon キーは EL 受信時刻のエイリアス）もコメント・
  ARCHITECTURE.md に正しく反映されている。
- `packages/shared`: 変更なしを確認（`git diff packages/shared/` が空。
  `BlockEntity.receivedAt` の型は `Record<string, number>` のまま）。
  旧 `receivedAtKey`（単数）への参照も残っていない。
- エラーの握りつぶし: 変更箇所（targets.ts / blocks.ts / index.ts）は
  純粋ロジックのみで、新規の catch 節・失敗の黙殺は無い。
- 品質ゲート: `pnpm lint` / `pnpm build` / `pnpm test` がリポジトリ全体で
  成功（shared 13 / collector 648 / frontend 765 / e2e 34、全件通過）。
- テストの質: blocks.test.ts の「記録済みキーと未記録キーの混在」「空配列」
  「重複キー」「スナップショットの非破壊性」、targets.test.ts の
  「[beacon, 自身] の順序と非重複」「観測順依存の固定」、
  peer-block-adapter.test.ts の期待値更新（共有 beacon ケースが本 Issue の
  目的どおり EL 各自のキーを持つことの固定）、frontend の CL/EL 分離回帰
  テストとも、実装の詳細をなぞるだけでない意味のあるアサーションになって
  いる。

## 指摘1: waveOriginTime の前提条件がコード上のコメントに無い

tester が本ファイルの「補足」に記録した前提条件（beacon キーと EL キーが
同一時刻の複製なので t0 が変わらないのは「全 Execution ノードに対応する
beacon がある」構成でのみ厳密に成立する。beacon を持たない EL only ノードが
最速受信する混在構成では t0 が早まり CL エッジの `startDelayMs` が変わり
得るが、それは意味づけとして妥当）が、worklog にしか書かれていない。
CLAUDE.md「品質ゲートを骨抜きにしない運用ルール」の「前提条件はコード上の
コメントと worklog の両方に明記」に従い、
`packages/frontend/src/entities/blockPulse.ts` の `waveOriginTime()` の
doc コメント、または `blockPulse.test.ts` の "mixed CL/EL keys
(Issue #141)" describe 冒頭コメントのいずれかに、この前提を1〜3行で
追記すること。

## 指摘2: blockPulse.test.ts のテストコメントがアサーションと食い違う

"reads EL-edge timing from EL keys only, ignoring the beacon aliases" の
コメントは「EL エッジの durationMs が reth 時刻の差（400ms）から出ることを
証明する。beacon 時刻（999/999）を読んでいたら差 0 になるはず」と述べるが、
実際のアサーションは `durationMs: MIN_PULSE_DURATION_MS`（450ms フロア）で
あり、beacon 時刻を読んで差 0 だったとしても同じくフロアで 450ms になる
ため、durationMs では判別できない。実際に判別しているのは
`startDelayMs === 1`（reth1=1000 − t0=999。beacon を読んでいれば 0）の
アサーションのみ。対応はどちらでもよい:
(a) コメントを「判別は startDelayMs で行う」趣旨に修正する、または
(b) reth2 の時刻を 1400→1500 等に変えて実差分をフロア超（500ms）にし、
durationMs でも判別できるようにする（(b) の方がテストとして強くなる）。
なお同ファイル最後のテストの「大→小の逆走ではなく… 実際の先着は reth1。」
というコメントも文が途切れているので、修正ついでに整えるとよい
（`reverse: true` のアサーションを足すとなお良い）。

## コミット粒度についての判断

本 Issue の変更は現時点で全て未コミット（ブランチ上のコミットは main 由来の
PLAN バックログ分のみ）。指摘対応後、以下の3コミット程度に分けるのが適切:

1. `feat(collector):` 実装3ファイル + collector 側テスト
   （実装担当の基本テストと tester の強化分は同一ファイルに混在しており、
   `git add -p` で厳密に分ける労力に見合わないため1コミットで可）
2. `test(frontend):` blockPulse.test.ts の CL/EL 分離回帰テスト
3. `docs:` ARCHITECTURE.md / PLAN.md / WORKLOG.md / worklog/issue-141.md

## 次の担当への申し送り

- 指摘1・2はコメントのみの修正でロジック変更を伴わないため、修正後の
  再レビューは該当2ファイルの差分確認と `pnpm lint && pnpm test` の再実行で
  足りる。
- 実機での完了条件検証（EL エッジに実際にパルスが見えること）は QA の担当。

### 2026-07-07 Issue #141 静的レビュー2回目（差し戻し・軽微指摘1点）

- 担当: reviewer（静的レビュー・再レビュー）
- ブランチ: issue-141-el-block-pulse
- 判定: **差し戻し（軽微・コメント1箇所のみ）**。前回の指摘2点は正しく
  解消されたが、指摘2の対応の際に修正されたコメントが実挙動と逆の記述に
  なっている。

## 前回指摘の解消確認（問題なし）

- 指摘1（waveOriginTime の前提条件）: `blockPulse.ts` の `waveOriginTime()`
  doc コメントに「beacon 非対の EL only ノードでは t0 が早まりうるが、
  実プロファイル（全ノード beacon 対）では発生しない」旨が明記された。
  worklog（tester の補足）との両方に記載があり、CLAUDE.md の運用ルールを
  満たす。解消。
- 指摘2（テストコメントとアサーションの食い違い）: "reads EL-edge timing
  from EL keys only" テストが `reth2: 1500`（実差分 500ms、フロア 450ms 超）
  に変更され、`durationMs: 500` を検証するようになった。beacon 時刻
  （999/999、差 0ms）を読んでいればフロアの 450ms になり assert が落ちる
  ため、判別可能なテストとして成立している。`startDelayMs === 1` の判別も
  維持。解消。
- 品質ゲート: `pnpm lint` / `pnpm build` / `pnpm test` がリポジトリ全体で
  成功（shared 13 / e2e 34 / collector 648 / frontend 765、全件通過。
  依頼時に示された collector 648 件・frontend 765 件と一致）。
- コミット粒度: `feat(collector)`（実装 + collector テスト）/
  `test(frontend)`（回帰テスト + 関連 doc コメント）/ `docs`（worklog 等）
  の3分割で、前回レビューで示した分割案どおり。適切。

## 新規指摘: el-shared テストのコメントが実挙動と逆

`blockPulse.test.ts` の "emits an EL pulse from real receive diff when a
beacon key is shared across EL nodes" テスト内のコメント

> 端点は [小, 大] = [geth1, reth1] に正規化済みだが、実際の先着はreth1
> なのでfrom=reth1・to=geth1の正方向(逆走ではない)になる。

が誤り。`BlockPulseSegment.reverse` の定義は「エッジの正規化順
（source=小, target=大）に対し逆向きに走るか」であり、このケースは
target（reth1 = 大側）が先に受信しているため、`blockPulse.ts` の分岐
コメント「大側（target）が先に受信 → 正規化順に対して逆走」のとおり
**reverse: true（逆走）** になる。実際に同一入力
（receivedAt = {beacon1:1000, reth1:1000, geth1:1500}、
edge(source=p/geth1, target=p/reth1)）で `computeBlockPulses` を実行して
`reverse: true` を確認済み。テストは `reverse` を assert していないため
通過してしまうが、コメントを信じて後から `reverse: false` を足すと落ちる、
前回指摘2と同種の食い違い。

対応: コメントを「reth1(大)→geth1(小) へ走るため正規化順に対しては逆走
（reverse: true）」の趣旨に修正する。あわせて `toMatchObject` に
`reverse: true` を足して挙動を固定することを推奨する（前回レビューでも
推奨済み）。

## 次の担当への申し送り

- 修正はテストファイル内のコメント1箇所（+ 推奨アサーション1行）のみ。
  ロジック変更は不要。修正後の再レビューは該当テストの差分確認と
  `pnpm --filter @chainviz/frontend test` の再実行で足りる。

### 2026-07-07 Issue #141 静的レビュー3回目（合格）

- 担当: reviewer（静的レビュー・再々レビュー）
- ブランチ: issue-141-el-block-pulse
- 対象: 前回差し戻し（テストコメント1箇所 + reverse アサーション推奨）への
  対応コミット `5bef514`
- 判定: **合格**

## 確認内容

- **コメントと実装の突き合わせ**: `blockPulse.ts` の `computeBlockPulses`
  内の分岐（`targetTime < sourceTime` の場合 `fromNodeId = edge.target`、
  `toNodeId = edge.source`、`reverse = true`）と、修正後のテストコメント
  「edge(source=geth1, target=reth1)だが、実際にはtarget側(reth1,1000)が
  先に受信し…reverse=trueになる」を実際に突き合わせてトレースした。
  フィクスチャは `edge("p/geth1", "p/reth1", "el-shared")`（source=geth1,
  target=reth1。辞書順の正規化前提とも一致）、
  `receivedAt = {beacon1:1000, reth1:1000, geth1:1500}`。
  sourceTime=1500 > targetTime=1000 なので target 先着分岐に入り、
  from=p/reth1・to=p/geth1・reverse=true・rawDiff=500ms（フロア450ms超の
  ため実差分がそのまま durationMs）・t0=1000 で startDelayMs=0。
  テストの期待値（fromNodeId/toNodeId/reverse/durationMs/startDelayMs）
  全項目と一致し、コメントの記述も実装の意味論と正確に一致している。
- **reverse アサーション**: `toMatchObject` に `reverse: true` が追加され、
  前回まで検証されていなかった逆走の意味論がテストで固定された。今後
  コメントと挙動が食い違えばテストが落ちる。
- **品質ゲート**: `pnpm lint` / `pnpm build` / `pnpm test` がリポジトリ
  全体で成功（shared 13 / e2e 34 / collector 648 / frontend 765、全件
  通過。依頼時に示された collector 648 件・frontend 765 件と一致）。
- **コミット粒度**: 差し戻し対応は `fix(frontend)` 1コミット
  （`blockPulse.test.ts` のみ、+5/-3行）で、関心事の混在なし。適切。

## 次の担当への申し送り

- 静的レビューはこれで完了。実機での完了条件検証（EL-EL エッジに実際に
  パルスが走ること）は QA（chainviz-qa）の担当。
- push / PR 作成 / マージ / Issue クローズは統括の判断・実行に委ねる。

### 2026-07-07 Issue #141 実機検証（QA・合格）

- 担当: qa（検証）
- ブランチ: issue-141-el-block-pulse
- 判定: **合格**。`docs/PLAN.md` の完了条件「reth(EL)同士のピアエッジ上でも、
  実際のブロック受信タイミングに基づいたブロック伝播パルスが表示される」を
  実機で確認した。

## 検証環境（メイン環境を破壊しない独立した合成環境）

- `profiles/ethereum` の compose を scratchpad へ複製し、プロジェクト名を
  `chainviz-qa141`、サブネットを `172.29.0.0/16`、公開ポートを
  `18545`(reth1 RPC)/`15052`(beacon1 API) に変更した使い捨て環境を
  `docker compose up -d` で起動した（reth1/beacon1 + reth2/beacon2 の
  2 ノード構成）。稼働中のメイン環境 `chainviz-ethereum`（project
  172.28.0.0/16、collector 4000/4001・frontend 5173）には一切触れていない。
- 修正版 collector は本ワークツリーで `pnpm build`（HEAD c1573fc を反映した
  build marker を確認）した dist を、ポート 4100/4101 で起動した。frontend は
  本ワークツリーの vite を `VITE_COLLECTOR_URL=ws://127.0.0.1:4100` で
  ポート 5273 に起動した。

## 確認内容

1. collector 側データ（WebSocket 4100 を直接購読して確認）
   - 合成環境のブロックが `receivedAt` に
     `chainviz-qa141/reth1` と `chainviz-qa141/reth2`（EL 自身のキー、
     Issue #141 で追加）を両方持ち、両者の受信時刻が実際に数 ms 異なる
     （例: reth1=…191043 / reth2=…191040、差 -3〜+5ms）ことを、
     複数ブロックにわたって観測した。従来からの beacon キー
     （`chainviz-qa141/beacon1`・`beacon2`）も同時に記録されており、
     設計どおり beacon キーは EL 受信時刻のエイリアスになっている
     （beacon1 時刻 == reth1 時刻）。
   - EL 間ピアエッジ `chainviz-qa141-execution:
     chainviz-qa141/reth1 <-> chainviz-qa141/reth2` が存在することを確認。
2. frontend 側の視覚的挙動（ヘッドレス Chromium で実画面を描画して確認）
   - 実際に frontend を開き、React Flow が描画する
     `data-id="peer-chainviz-qa141-execution::chainviz-qa141/reth1::chainviz-qa141/reth2"`
     エッジ（reth 同士の EL エッジ）そのものの上に、ブロック伝播パルスの
     `circle.peer-pulse`（`animateMotion dur=450ms`）が繰り返し現れることを
     確認した（対象エッジに限定したポーリングで 329 サンプル中 73 サンプルで
     パルス出現）。パルス時間が最小値 450ms フロアなのは、reth1/reth2 の
     実受信差が数 ms でフロアに丸められるためであり、想定どおり（パルス自体は
     実受信タイミングに基づいて起動している）。
   - 回帰確認: CL(beacon)間エッジ（`chainviz-qa141-consensus`）のパルスも
     従来どおり出続けている（394 サンプル中 92 サンプルでパルス出現）ことを
     確認。EL エッジ追加で CL エッジのパルスが壊れていない。

## 補足（本 Issue の欠陥ではないテスト構成上の注意）

- 1 つの collector でメイン・合成の 2 プロジェクトを同時観測したため、
  `beaconStableIdForExecution()` がプロジェクトをスコープせず全観測から
  beacon をマッチする既存挙動により、稀にメイン reth のブロックに合成 beacon
  キーが混ざる／`chainviz-ethereum/reth1 <-> chainviz-qa141/reth2` という
  プロジェクト跨ぎの実行エッジが 1 本描かれる、という副作用が観測された。
  ただしこれは「2 プロジェクトを 1 collector で観測する」本検証固有の構成に
  よるもので、実運用の単一プロジェクト構成（各ノードキーに beacon が 1 つ
  しか存在しない）では発生しない。EL 自身のキー（`obs.stableId`）は常に正しく
  自プロジェクトにスコープされるため、本 Issue の EL-EL パルス検証
  （reth1/reth2 キー）には影響しない。Issue #141 の範囲外の既存挙動であり、
  本検証の合否には関係しない。
- メイン環境は検証の前後で無傷（コンテナ 7 個稼働継続、reth1 のブロック高が
  正常に進行、ピアはメイン reth2 のみでネットワーク混線なし、collector/
  frontend のポート 4000/4001/5173 も稼働継続）であることを確認した。
- 検証終了後、合成環境は `docker compose down -v` でコンテナ・ネットワーク・
  ボリュームをすべて破棄し、自分が起動した collector(4100)/frontend(5273)
  プロセスも停止した。
