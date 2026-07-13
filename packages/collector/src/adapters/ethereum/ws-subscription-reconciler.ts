// 周期ポーリングで列挙される対象集合（execution ノードなど）と、既に開いて
// いる長寿命 WebSocket 購読の集合を突き合わせ、差分（新規出現・消滅・
// 実質的な内容の変化）だけを開閉する汎用リコンサイラ。`Subscription`
// （eth-ws-client.ts）にのみ依存し、ExecutionTarget など特定のチェーン
// 固有の型には依存しない（Issue #301。`subscribeBlocks` 用に新設したが、
// `subscribeTransactions` など他の永続 WebSocket 購読でも再利用できる）。
//
// 背景（詳細は docs/worklog/issue-301.md）: `subscribeBlocks` は従来、起動時に
// 一度だけ対象ノードを列挙して WebSocket 購読を張っていたため、addNode で
// 後から追加されたノードには購読が張られなかった。`subscribePeers` /
// `subscribeNodeInternals` と同じ周期ループにして毎 tick 対象を列挙し直す
// ことでこの問題を解消するが、WebSocket は HTTP と違って長寿命の接続なので
// 毎 tick 張り直すのは無駄。このクラスは「対象集合の差分だけを開閉する」
// 部分を汎用的に切り出したもの。

import type { Subscription } from "./eth-ws-client.js";

/** WsSubscriptionReconciler の構築時オプション。 */
export interface WsSubscriptionReconcilerOptions<Target> {
  /**
   * 対象を一意に識別するキー（購読レジストリのキー）。通常は
   * ノードの stableId。同じキーの対象が既に購読済みなら、
   * `signatureOf` が変わらない限り新規購読を開かない
   * （二重購読の構造的な防止）。
   */
  keyOf: (target: Target) => string;
  /**
   * 対象の「購読内容」を表す文字列。同じキーでもこの値が前回と変われば、
   * 既存の購読を close してから新しい購読を開き直す（張り直し）。
   * 例: `subscribeBlocks` では `wsUrl + receivedAtKeys` を連結した文字列を使い、
   * IP 変更や beacon ペアリングの変化（reth が先に観測され `[self]` で購読した
   * 後に対応する beacon が観測されて `[beacon, self]` へ変わる等）に追従する。
   */
  signatureOf: (target: Target) => string;
  /** 対象へ実際に購読を開く処理。 */
  open: (target: Target) => Subscription;
}

interface RegistryEntry {
  signature: string;
  subscription: Subscription;
}

/**
 * 対象集合の差分だけを開閉するリコンサイラ。`reconcile()` を毎 tick 呼ぶことで、
 * - まだ購読していない対象（新規キー）には `open()` で購読を開く
 * - 前回まで購読していたが今回の対象集合に無くなったキーは `close()` する
 * - 既に購読済みで `signatureOf` の値が変わったキーは `close()` してから
 *   開き直す
 * を行う。個々の `Subscription` の切断→再接続は呼び出し側（例:
 * eth-ws-client.ts の内部再接続）に委ね、このクラスはノードの出現・消滅・
 * signature 変化だけを扱う。
 */
export class WsSubscriptionReconciler<Target> {
  private readonly registry = new Map<string, RegistryEntry>();

  constructor(private readonly options: WsSubscriptionReconcilerOptions<Target>) {}

  /**
   * 今回 tick の対象集合と現在の購読レジストリを突き合わせ、差分だけを
   * 開閉する。
   */
  reconcile(targets: Target[]): void {
    const { keyOf, signatureOf, open } = this.options;
    const currentKeys = new Set<string>();

    for (const target of targets) {
      const key = keyOf(target);
      currentKeys.add(key);
      const signature = signatureOf(target);
      const existing = this.registry.get(key);

      if (existing === undefined) {
        this.registry.set(key, { signature, subscription: open(target) });
        continue;
      }
      if (existing.signature !== signature) {
        existing.subscription.close();
        this.registry.set(key, { signature, subscription: open(target) });
      }
      // signature が同じなら何もしない（既存の長寿命接続を維持する）。
    }

    for (const [key, entry] of this.registry) {
      if (!currentKeys.has(key)) {
        entry.subscription.close();
        this.registry.delete(key);
      }
    }
  }

  /** 現在登録済みの全購読を close する（dispose 用）。 */
  closeAll(): void {
    for (const entry of this.registry.values()) entry.subscription.close();
    this.registry.clear();
  }

  /** 現在購読中のキー数（テスト用）。 */
  get size(): number {
    return this.registry.size;
  }
}
