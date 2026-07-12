# Issue #296 フォーク（一時的な分岐）の色分け表現

### 2026-07-12 Issue #296 フォークの色分け表現の設計

- 担当: designer
- ブランチ: issue-296-fork-color-coding
- 内容: 実装着手前の設計。データフロー・判定規則・collector/frontend の
  作業分担を確定し、`docs/ARCHITECTURE.md` に §9 として反映した。
  `packages/shared` は構造変更なし（`NodeEntity.headBlockHash` の契約を
  JSDoc で明文化したのみ）。

## 設計の要点

### 1. 器は既存の `NodeEntity.headBlockHash`（shared の型変更なし）

- スキーマに最初から存在するが、Ethereum アダプタは常に空文字列を入れて
  いた（`adapters/ethereum/index.ts` の `toEntity` に「本Issueのスコープ外」
  というコメントあり）。フォークの色分けは「各ノードがどの tip を見て
  いるか」の永続状態そのものなので、新しいエンティティ・DiffEvent 種別を
  作らず、このフィールドを埋めることで実現する。
- 「未観測 = 空文字列」の契約を JSDoc に明文化した（optional 化はしない。
  既存の必須 string を維持し、旧スナップショット互換も "" のままで成立）。

### 2. 検知（collector）: 追加 RPC ゼロ

- 情報源は既存の `eth_subscribe(newHeads)`。newHeads は「そのノードの
  正準ヘッドが変わった」通知なので、最後に通知されたヘッダ＝現在の tip。
  reorg でヘッドが差し替わったときも newHeads が飛ぶので追従できる。
- `EthereumAdapter` に head キャッシュ（stableId → tip ハッシュ）を新設。
  `subscribeBlocks` のコールバック内で `target.receivedAtKeys` の全キー
  （Execution 自身 + 対応する beacon のエイリアス。Issue #141 と同じ扱い）
  へ書き込み、`pollInfra` の `toEntity` がキャッシュから
  `headBlockHash` を埋める。「書き込みは購読、読み出しは toEntity、store の
  書き手は applyInfra 1 本」という syncStatusCache（Issue #187）と同じ構造。
- キャッシュの掃除は「毎 tick 現在の観測対象集合と突き合わせて破棄」
  （`trackedNodeInternalsIds` と同じ方式）。
- 反映レイテンシは最大 3 秒（pollInfra 周期）。この固定値が成立する前提:
  この環境で自然フォークはほぼ発生せず（2 バリデーター・同一ホスト・
  ms 伝播）、観察は人為パーティション（数十秒持続）で行うため。前提が
  崩れたら「newHeads 受信時に entityUpdated を即時配信する経路」を
  別 Issue で追加する（ARCHITECTURE §9.1 に明記済み）。
- 「フォークかどうか」の判定は collector では行わない。ワールドステートには
  観測事実（各ノードの tip）だけを載せ、判定・色分けはフロントの導出とする
  （tip 集合から一意に導出できる情報を二重に配信しない）。

### 3. フォーク判定（frontend・純粋関数）

最重要の仕様判断: **tip が違う ≠ フォーク**。通常の伝播でも毎ブロック
ms 単位で tip はズレるし、同期中ノードは古い tip を指す。これを誤検知
すると毎スロット色が付いて学習表現として壊れる。区別は parentHash の
祖先関係で行う:

- 対象: `headBlockHash` が非空で、かつそのハッシュの `BlockEntity` を
  フロントのストアから引けるノードのみ。
- 高い方の tip から低い方の tip の高さまで parentHash を辿る:
  - 同じハッシュへ到達 → 同一チェーン上（ラグ）→ フォークではない
  - 同じ高さでハッシュが違う / 辿った先が違う → フォーク
  - 途中のブロックが未知で辿り切れない → フォークとみなさない（安全側）
- 収束の検知は専用状態を持たない。更新のたびに再計算し、条件が消えたら
  色が消える（これ自体が「収束すると色が揃う」の表現）。
- 色割り当ての安定性: 「新しい tip が既に色付きの tip の子孫なら同じ色を
  引き継ぐ」規則（フォーク継続中に枝が伸びても色が飛び替わらない）。
  全 tip 収束でリセット。

### 4. 表現（最小スコープ）

- ノードカードにフォーク色の縁取り/発光（専用 CSS 変数系統。既存のエッジ
  色体系と混同しない色）。同じ tip のノードが同じ色。
- ポップオーバーに「見ている tip」（短縮ハッシュ）行 + 用語アンカー `fork`。
- `glossary/ethereum/terms/b-network.yaml` に `fork` を追加
  （{ja, en}。英語文言は chainviz-i18n のレビュー対象）。
- 収束瞬間の演出・凡例への追加は任意（必須にしない。UX 判断）。

### 5. Issue #298 との関係（統括への報告事項）

- **最小スコープ（ノードカードの色分け）に留め、#298 との統合は必須と
  しない**と判断した。両者は独立に成立する。
- 接点（#298 の設計担当と統括が知っておくべきこと）:
  - 両者とも `BlockEntity`（hash / number / parentHash）が情報源。
  - #296 が `headBlockHash` を埋めると、#298 側は「各ノードがどのブロックを
    tip と見ているか」のマーカー表示に使える（任意）。
  - #298 がチェーン構造（分岐）を描く場合、分岐の色は #296 のフォーク色
    パレットと揃えると学習効果が高い（任意。色体系の調整は統括）。

## 作業分担と依存順序

1. **collector（収集悟）**: head キャッシュ新設・`subscribeBlocks`
   コールバックでの記録・`toEntity` での読み出し・対象集合との突き合わせ
   による掃除・`index.ts` の「スコープ外」コメント更新・ユニットテスト。
2. **frontend（描画麗）**: フォーク判定の純粋関数（例:
   `entities/forkState.ts`。祖先探索には防御的な打ち切り上限を設ける）、
   色割り当てを保持するフック、`InfraNodeCard` の色表現、ポップオーバー
   行、i18n 文言、glossary `fork` 追加、`mockData.ts` へのフォーク
   シナリオ追加（モックでの目視確認・テスト用）、ユニットテスト。
3. 依存: collector が先（実機確認はフロント単独では不可）。ただし
   frontend は mockData で並行着手できる。
4. **node-env（構築初）**: 変更なし。再現手順（後述）が確立したら
   `profiles/ethereum/README.md` への追記のみ発生しうる。

## 決定事項・注意点

- **shared の型変更なし**（JSDoc 追記のみ。ビルド・テストへの影響なし
  を全パッケージで確認済み）。
- **再現手段は実測前提の机上案**: `docker network disconnect` は IP ごと
  失わせ collector 観測と beacon↔validator 通信を壊すため不可。ホスト側
  `DOCKER-USER` チェーンで beacon1(172.28.2.1)↔beacon2(172.28.2.2) 間を
  DROP する iptables 方式（sudo 前提）を第一候補とする。両陣営が自分の
  バリデーターのスロットでだけ提案して別ブランチが伸び、解除で fork
  choice が一方へ収束（reorg）する想定。EL 側 devp2p の遮断が追加で
  必要かも含め、実装/QA 時に必ず実測で確立し、手順を記録すること。
- **E2E（Playwright）**: 実環境でのフォーク誘発は sudo 前提で自動化に
  不向き。UI シナリオはモックデータ駆動（mockData のフォークシナリオ）
  とユニットテスト中心を提案する（採否は統括判断）。
- **別 Issue の起票を推奨**: `subscribeBlocks` が起動時に一度だけ対象を
  列挙するため、addNode で追加したノードに newHeads 購読が張られない
  （ブロック伝播パルスにも影響する既存ギャップ）。#296 では「未観測 =
  色分け対象外」の縮退として受容し、購読の動的追従は別 Issue とする。
- 3 秒レイテンシ・祖先探索の打ち切り上限など、固定値を置く場合は前提
  条件をコードコメントと本ファイルの両方に残すこと（CLAUDE.md の運用
  ルール）。

## 実装時に判断してよいこと（未決のまま渡す点）

- カードの色表現の具体（縁取りかグローか、パレットの色数・色値）。
  既存の色体系と衝突しないことだけが条件。
- 祖先探索の打ち切り上限の値（フロントが保持するブロック数から導出）。
- head キャッシュの掃除を pollInfra 側と D層ループ側のどちらに置くか。
- 収束瞬間の演出（任意機能。入れるなら UX 相談）。

### 2026-07-12 collector 実装着手前の方針確認メモ

- 担当: collector
- ブランチ: issue-296-fork-color-coding
- 設計メモの「作業分担と依存順序」1.（collector）の範囲をそのまま実施する。
  以下は着手前に確認した実装方針で、設計メモからの変更点は無い。

**データフロー**

- 新規ファイル `packages/collector/src/adapters/ethereum/head-tip-cache.ts` に
  `HeadTipCache` クラスを追加する。`beacon-sync-status.ts` /
  `sync-status.ts` と同じ「stableId をキーにした Map、書き込みは購読側、
  読み出しは `toEntity`」の形にそろえる。API は
  `recordHead(nodeIds, hash)` / `resolve(stableId)` /
  `prune(currentIds)` の3つのみとし、判定ロジックは一切持たせない。
- 書き込み: `EthereumAdapter.subscribeBlocks` の newHeads コールバック内で、
  既存の `blockTracker.record(target.receivedAtKeys, header, this.now())` と
  同じ `target.receivedAtKeys` をそのまま `headTipCache.recordHead()` に渡す。
  `receivedAtKeys` は「Execution 自身 + 対応する beacon のエイリアス」を
  既に解決済み（`targets.ts` の `executionTargets`）なので、Issue #141 の
  エイリアス記録をそのまま再利用でき、新しい解決ロジックは不要。
- 読み出し: `toEntity()` で `headTipCache.resolve(obs.stableId) ?? ""` を
  `NodeEntity.headBlockHash` に設定する（syncStatusCache 由来の
  `resolvedSync` と同じ書き方）。
- 掃除: 「pollInfra 側か D層ループ側か」は設計メモで未決だったが、
  `pollInfra` 側を採用する。理由: `subscribeBlocks` は起動時に一度だけ
  対象を列挙するだけで周期ループを持たないため、D層ループのような
  「毎 tick 現在の対象集合と比較する」場所が無い。一方 `pollInfra` は
  A層のポーリング（既定3秒間隔）で毎回 Docker 観測を取り直しており、
  そこから得られる `entities`（kind === "node"）が「現在存在するノードの
  stableId 集合」そのものなので、追加の Docker 問い合わせなしに
  `headTipCache.prune()` を呼べる。

**テスト方針**

- `head-tip-cache.ts` 単体のロジック（記録・上書き・prune）は
  `head-tip-cache.test.ts` に閉じる。
- `subscribeBlocks` の newHeads 受信から `pollInfra` の次回呼び出しで
  `headBlockHash` に反映されるまでの配線自体は単体テストでは検証できない
  （2つの public メソッドをまたぐため）ので、新規ファイル
  `head-block-hash.test.ts` に end-to-end のテストとして分離する
  （既存の `peer-block-adapter.test.ts` は既に3000行超と大きいため、
  これ以上テストを積み増さず新規責務は新規ファイルに置く。1ファイル
  1責務の原則）。removeNode から addNode への再利用シナリオ（prune の
  効果）もここで検証する。

**やらないこと（designer の分担どおり）**

- フォーク判定（祖先関係の比較）・色割り当ては実装しない。
- `subscribeBlocks` が動的追加ノードに追従しない既知のギャップ
  （設計メモの「別 Issue の起票を推奨」）への対応はしない。

### 2026-07-12 collector 実装完了

- 担当: collector
- ブランチ: issue-296-fork-color-coding
- 実施内容は上記の方針確認メモのとおり。追加・変更ファイル:
  - 追加: `packages/collector/src/adapters/ethereum/head-tip-cache.ts`
    （`HeadTipCache` クラス。ロジックのみ、判定は持たない）
  - 追加: `packages/collector/src/adapters/ethereum/head-tip-cache.test.ts`
    （単体テスト、8件）
  - 追加: `packages/collector/src/adapters/ethereum/head-block-hash.test.ts`
    （`subscribeBlocks` から `pollInfra` への配線を確認する end-to-end
    テスト、6件。removeNode から addNode への再利用シナリオを含む）
  - 変更: `packages/collector/src/adapters/ethereum/index.ts`
    （`headTipCache` フィールド追加、`subscribeBlocks` のコールバックで
    `recordHead` を呼ぶ、`toEntity` で `headBlockHash` を読み出す、
    `pollInfra` で `prune` を呼ぶ）
  - 変更: `packages/collector/src/adapters/ethereum/index.test.ts`
    （既存の「headBlockHash は常に空文字列」コメントを、Issue #296 後の
    正確な理由（B層購読を呼んでいないため未観測のまま）に更新。アサート
    する値自体は変わらない）
- 回帰テストの有効性確認: `pollInfra` から `headTipCache.prune()` 呼び出しを
  一時的に取り除いた状態で `head-block-hash.test.ts` の removeNode から
  addNode への再利用テストを実行し、実際に失敗する（古い tip が残る）こと
  を確認してから元に戻した（CLAUDE.md「直したはずで済ませない」への対応）。
- 実機確認: 既に稼働中だった `chainviz-ethereum` の docker compose スタック
  （メインリポジトリの `profiles/ethereum` から起動されたもの。本 Issue は
  `profiles/` に変更が無いため、これをそのまま流用して問題ないと判断した）
  に対し、本ブランチでビルドした collector を一時的なポート（4200/4201、
  常設の 4000/4001・別ブランチ検証中の 4100/4101 とは衝突しない値）で起動
  し、WebSocket スナップショットを取得して確認した:
  - reth1/2/3・beacon1/2/3 の `headBlockHash` が全て同一の tip ハッシュで
    埋まっている（同一チェーンに追従中のため一致は正しい挙動）。
  - beacon と対応する reth で `headBlockHash` が完全に一致している
    （Issue #141 のエイリアス記録が正しく効いている）。
  - validator1/2 は `headBlockHash` が空文字列のまま（P2P非参加で
    `executionTargets`/`receivedAtKeys` の対象外のため、想定どおり）。
  - 数秒後に再度スナップショットを取得し、`headBlockHash` と
    `blockHeight` の両方が新しい値に更新されていることを確認（購読が
    継続して効いている、静的な初期値ではないことの確認）。
  - 確認に使った WebSocket クライアントの一時スクリプトはリポジトリに
    含めず、確認後に削除した。
- `pnpm --filter @chainviz/collector build` / `test`（53ファイル、1323件）
  はいずれも成功。
- `docs/PLAN.md` の Issue #296 のチェックボックスは、フロント側の実装
  （祖先関係の比較によるフォーク判定・色分け表現）が別途完了するまで
  未チェックのまま残す（本 Issue は collector と frontend にまたがる
  1つの Issue のため）。

### 2026-07-12 collector テスト強化（エッジケース・異常系・境界値）

- 担当: tester
- ブランチ: issue-296-fork-color-coding
- 実装担当が書いた基本テスト（ハッピーパス中心）に対し、見落としやすい
  エッジケース・異常系・境界値のテストを追加した。実装ロジックは変更して
  いない（追加・変更したのはテストファイル 2 件のみ）。
- 追加観点と対応ファイル:
  - `head-tip-cache.test.ts`（単体、8 → 13 件）:
    - prune が対象外の複数エントリを 1 回で全破棄すること（Map 肥大化防止）。
    - prune に空集合を渡すと全消去されること（境界値）。
    - `recordHead` に空のキー配列を渡しても既存エントリを壊さず、新規も
      作らないこと（異常系・防御）。
    - reth1/beacon1 と reth2/beacon2 の 2 群を別々の tip で記録したとき、
      beacon エイリアスが群間で取り違えられないこと（取り違え防止）。
    - ブロック番号の大小に関わらず「最後に受信した newHeads が勝つ」
      （last-write-wins）こと。reorg でより低い番号のヘッドへ差し替わる
      追従を壊さないための意図された契約であり、バグではない旨をコメントで
      明記（受信順序に関する設計判断の固定化）。
  - `head-block-hash.test.ts`（配線 end-to-end、6 → 10 件）:
    - 2 組の完全な EL/CL 群（reth1/beacon1・reth2/beacon2）で、beacon が
      別群の tip を継承しないこと（`receivedAtKeys` のノード群キー分離の
      end-to-end 版）。
    - validator（`lighthouse vc`）は execution ノードと同じノード群キー "1"
      を持っても headBlockHash が空文字列のままであること（executionTargets
      の対象外・役割ガード。`resolveDrivesNodeId` 系と同じパターンとの整合）。
    - 複数ノードのうち 1 つだけが観測から消えたとき、prune がその 1 件だけを
      破棄し、残るノードの tip は保持されること（巻き添え防止）。
    - reorg で番号が下がるヘッドが後から来ても最後の受信を採用すること
      （配線レベルの last-write-wins）。
  - validator フィクスチャのヘルパーを `head-block-hash.test.ts` に追加した。
- 回帰テストの有効性確認（意図的に実装を壊して検出できることを確認し、
  確認後に元へ戻した。CLAUDE.md「直したはずで済ませない」への対応）:
  - `recordHead` を「既存キーは上書きしない」に改変 → last-write-wins 系の
    単体・配線テストが両方失敗することを確認。
  - `prune` を no-op に改変 → prune 系の単体・配線テスト（全破棄・空集合・
    巻き添え防止）が失敗することを確認。
  - `subscribeBlocks` の `recordHead(target.receivedAtKeys, ...)` を
    `recordHead([target.stableId], ...)`（beacon エイリアスを落とす）に
    改変 → 2 群分離・validator 非干渉・beacon エイリアスの配線テストが
    失敗することを確認。
- `pnpm lint` / `pnpm --filter @chainviz/collector build` / `test`
  （53 ファイル、1332 件）はいずれも成功。
- 実装のバグらしき挙動は見つからなかった。newHeads の受信順序に関する
  last-write-wins は、設計メモ（reorg 追従）に沿った意図された挙動であり、
  番号ガードを入れない判断を characterization test として固定した
  （差し戻しは不要）。
### 2026-07-12 Issue #296 frontend側実装（方針確認メモ）

- 担当: frontend
- ブランチ: `issue-296-fork-color-coding-frontend`（collector担当が同時に
  `issue-296-fork-color-coding` を使用中のため別名に分岐。設計メモに
  従いcollector側の`headBlockHash`埋め込み実装には触れない）
- 実装着手前に立てた方針:
  - フォーク判定は `entities/forkState.ts` に純粋関数として実装する。
    `detectForkGroups(nodeTips, blocks)` が入力（各ノードのid・
    headBlockHash・BlockEntity集合）だけから決定的にフォークグループを
    返す。祖先探索（`chainRelation`）は「高い方のtipから低い方の高さまで
    parentHashを辿り、同じ高さで一致するか」を見る。打ち切り上限は
    `blocks.length`（フロントが保持しているブロック数を超えて辿ることは
    できないため、それをそのまま上限に使う。固定のマジックナンバーでは
    ない）。
  - 複数tipの関係判定はUnion-Findで行う。"same"（同一チェーン）または
    "unknown"（辿り切れず判定不能・安全側）のペアは同じグループへ併合し、
    "fork"（確定）と判定されたペアだけ別グループに残す。結果として
    最終グループ数が2以上になったときだけフォーク扱いにする。
    「unknownを安全側で併合する」実装は、遠く離れた場所に本物の
    フォークがあってもunknownなペアを介して同一グループへ吸収されうる
    （過小検出）というトレードオフを許容する意図的な設計判断（誤って
    色を付ける過大検出より学習上の害が小さいという設計方針に従う）。
  - 色の安定性（「新しいtipが既に色付きのtipの子孫なら同じ色を引き継ぐ」）
    はReact側の状態（useRef）を持つ`entities/useForkColors.ts`の
    `useForkColorAssignment`フックに閉じ込め、判定ロジック自体
    （forkState.ts）とは分離する（`blockPulse.ts`/`useBlockPulses.ts`と
    同じ「純粋計算とReactスケジューリングの分離」パターンを踏襲）。
    フォークが検出されなくなった瞬間に内部状態をリセットする（専用の
    収束イベントは作らない）。
  - 表現は`InfraNodeData.forkColorIndex?: number`（0〜3）を新設し、
    `App.tsx`が`isNew`/`operationPending`と同じ「stabilizeNodes後段で
    後付けする派生状態」パターンで注入する。CSSは`.infra-card--fork-0`
    〜`-3`（`outline`プロパティ。既存の役割別カード枠は`border-color`を
    使うため衝突しない）。`InfraPopover`に「見ている tip」欄
    （`shortHex`短縮 + `GlossaryTerm termKey="fork"`）を追加する。
  - `packages/shared`の型変更は無し（設計メモどおり、`headBlockHash`は
    既存フィールド）。

### 2026-07-12 Issue #296 frontend側実装（完了報告）

- 新規ファイル:
  - `packages/frontend/src/entities/forkState.ts`
    （`buildBlockIndex`/`chainRelation`/`detectForkGroups`/
    `highestTipHash`/`defaultMaxAncestorSteps`）
  - `packages/frontend/src/entities/forkState.test.ts`
  - `packages/frontend/src/entities/useForkColors.ts`
    （`useForkColorAssignment`フック、`FORK_COLOR_PALETTE_SIZE`）
  - `packages/frontend/src/entities/useForkColors.test.ts`
  - `packages/frontend/src/entities/InfraNodeCard.forkColor.test.tsx`
  - `packages/frontend/src/entities/InfraPopover.forkTip.test.tsx`
  - `packages/frontend/src/websocket/mockData.forkScenario.test.ts`
- 変更ファイル:
  - `packages/frontend/src/entities/infraNode.ts`
    （`InfraNodeData.forkColorIndex?: number`を追加）
  - `packages/frontend/src/entities/InfraNodeCard.tsx`
    （`forkColorIndex`をクラス名`infra-card--fork-{index}`へ反映し、
    `InfraPopover`へ橋渡し）
  - `packages/frontend/src/entities/InfraPopover.tsx`
    （`forkColorIndex`が数値かつ`entity.headBlockHash`が非空のときだけ
    「見ている tip」欄を追加。`shortHex`を再利用）
  - `packages/frontend/src/app/App.tsx`
    （`useForkColorAssignment(nodeEntities, blocks)`を呼び、
    `infraNodesWithHighlight`に`forkColorIndex`を後付けした
    `infraNodesWithForkColor`を新設して`nodes`の組み立てに使う）
  - `packages/frontend/src/i18n/messages.ts`（`field.headTip`を追加）
  - `packages/frontend/src/styles.css`
    （`--fork-color-a`/`--fork-color-b`と`.infra-card--fork-0`〜`-3`。
    `outline`+`box-shadow`。役割別カード枠は`border-color`のため両立する）
  - `packages/frontend/src/websocket/mockData.ts`
    （`createForkMockSnapshot()`・`mockForkConvergeDiffs()`を追加。
    `createMultiNetworkMockSnapshot`と同じ「既定シナリオには含めない
    専用シナリオ」の流儀。branch A（reth-node-1/lighthouse-1、高さ130）と
    branch B（reth-node-2/lighthouse-2、高さ129）が高さ128の共通祖先から
    分岐した状態を表す。既存の`validatorNode()`がデモ用placeholderとして
    headBlockHashに`"0x00000080"`を持っていたため（本来validatorは
    空文字列のはず）、このシナリオでは明示的に空へ上書きしている）
  - `glossary/ethereum/terms/b-network.yaml`（用語`fork`を追加。{ja, en}）

- 動作確認: `pnpm --filter @chainviz/frontend build`・
  `pnpm --filter @chainviz/frontend test`（128ファイル1963件）がいずれも
  通ることを確認。加えてvite開発サーバーを一時的に
  `createForkMockSnapshot()`へ差し替えて実際にブラウザ（Playwright）で
  確認し、(1) branch A（reth-node-1/lighthouse-1）がゴールド、branch B
  （reth-node-2/lighthouse-2）がシアンの輪郭で色分けされ、validator-1/
  validator-2（headBlockHash未観測）には色が付かないこと、(2) カードの
  ポップオーバーに「見ている tip」欄が短縮ハッシュ付きで出ること、
  (3) `mockForkConvergeDiffs()`を適用すると全カードの色が消える（収束）
  ことをスクリーンショットで確認した。確認用の一時的な配線
  （`connect()`内での`createForkMockSnapshot()`差し替えと収束diffの
  `setTimeout`送出）はコミット前に元へ戻し、`mockData.ts`の差分は
  意図した新規エクスポート（`createForkMockSnapshot`/
  `mockForkConvergeDiffs`）のみになっていることを確認済み。
- 既知の限界（設計メモに明記済み・今回のスコープ外）:
  - `subscribeBlocks`が起動時に一度だけ対象を列挙するため、addNodeで
    追加したノードには`headBlockHash`が付かない（色分け対象外になる）。
  - フロントのフォーク判定は反映レイテンシがcollector側のpollInfra周期
    （最大3秒）に依存する。
- 次の担当（査読誠/検証大地）向けの注意点:
  - collector側の`headBlockHash`埋め込み実装は別ブランチ
    （`issue-296-fork-color-coding`）で並行実装中。マージ時は統括による
    cherry-pick合流を想定（このブランチ単体では実環境QAは完結しない。
    モックデータでの検証は上記のとおり完了している）。
  - `entities/forkState.ts`の「unknownペアは安全側で併合する」実装は、
    離れた場所の本物のフォークをunknown経由で見逃しうるトレードオフを
    意図的に許容している（誤って色を付ける方が学習上の害が大きいという
    設計方針に従った判断）。レビュー時にこの前提を踏まえてほしい。
