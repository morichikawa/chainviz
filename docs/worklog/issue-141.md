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
