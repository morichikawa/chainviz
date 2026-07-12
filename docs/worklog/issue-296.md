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
