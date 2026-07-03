// newHeads で受け取ったブロックヘッダを、チェーン非依存な BlockEntity へ
// 正規化しつつ、各ノードの受信時刻をブロック単位で束ねる純粋なトラッカー。
// 同じブロックを複数ノードが受信するため、hash をキーに receivedAt を
// マージし、伝播の波アニメーション用の受信時刻マップを育てていく。

import type { BlockEntity } from "@chainviz/shared";
import type { NewHeadHeader } from "./eth-ws-client.js";

/** 16 進数文字列（0x 接頭辞つき）を数値へ。解釈できなければ 0。 */
export function parseHexNumber(hex: string | undefined): number {
  if (!hex) return 0;
  const value = Number.parseInt(hex, 16);
  return Number.isFinite(value) ? value : 0;
}

/**
 * ブロックハッシュごとに、どのノードがいつ受信したかを蓄積する。
 * 同一ブロックの再受信では最初の受信時刻を保持する（波の起点を安定させる）。
 * 保持数が maxBlocks を超えたら古いものから捨てる（メモリ無制限化の防止）。
 */
export class BlockPropagationTracker {
  private readonly blocks = new Map<string, BlockEntity>();

  constructor(private readonly maxBlocks = 200) {}

  /**
   * ノード nodeId がブロック header を receivedAt(epoch ms) に受信したことを
   * 記録し、マージ後の BlockEntity を返す。
   */
  record(
    nodeId: string,
    header: NewHeadHeader,
    receivedAt: number,
  ): BlockEntity {
    const existing = this.blocks.get(header.hash);
    const received: Record<string, number> = { ...(existing?.receivedAt ?? {}) };
    // 同一ノードからの再通知では最初の時刻を保持する。
    if (received[nodeId] === undefined) received[nodeId] = receivedAt;

    const block: BlockEntity = {
      kind: "block",
      hash: header.hash,
      number: parseHexNumber(header.number),
      parentHash: header.parentHash,
      timestamp: parseHexNumber(header.timestamp),
      receivedAt: received,
    };

    // Map は挿入順を保つので、更新時は一度消してから入れ直し最新扱いにする。
    this.blocks.delete(header.hash);
    this.blocks.set(header.hash, block);
    this.evictOldest();
    return block;
  }

  private evictOldest(): void {
    while (this.blocks.size > this.maxBlocks) {
      const oldest = this.blocks.keys().next().value;
      if (oldest === undefined) break;
      this.blocks.delete(oldest);
    }
  }
}
