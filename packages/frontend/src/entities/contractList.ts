import type { ContractFlowNode } from "./contractNode.js";
import type { GhostFlowNode } from "./ghostNode.js";

/**
 * コントラクト一覧パネル（Issue #218 + #211「単位C」。
 * `docs/worklog/issue-211.md` 参照）の純粋なデータ変換群。React Flow の
 * ノード配列（コントラクトカード + デプロイ中のゴーストカード）から
 * パネルに出す行データを組み立て、出現順で並べ替える。
 */

export type ContractListStatus = "deployed" | "deploying";

/** コントラクト一覧パネルの行1件分。 */
export interface ContractListEntry {
  /** React Flow 上のノード id（`deployed` は address、`deploying` は ghost id）。 */
  nodeId: string;
  status: ContractListStatus;
  /**
   * `deployed`: カタログで特定できた表示名（未特定なら undefined。呼び出し側が
   * 「未知のコントラクト」にフォールバックする）。
   * `deploying`: ghost が持つカタログキー（表示名を兼ねる。`GhostNodeCard` と
   * 同じ扱い）。常に値が入る。
   */
  name?: string;
  /** `deployed` のときのみ意味を持つコントラクトアドレス。 */
  address?: string;
  /** `deployed` かつ token メタ情報があるときのみ意味を持つシンボル。 */
  tokenSymbol?: string;
}

/**
 * 実カード（コントラクト）とデプロイ中のゴーストカードから一覧の行データを
 * 組み立てる。カタログ外の「未知のコントラクト」も一覧性のために含める点が
 * `operations/deployedContracts.ts`（呼び出しタブの候補。カタログ既知のみ）
 * との違い（`docs/worklog/issue-211.md`「変更しないこと」参照）。
 */
export function buildContractListEntries(
  contracts: ContractFlowNode[],
  deployingGhosts: GhostFlowNode[],
): ContractListEntry[] {
  const deployed: ContractListEntry[] = contracts.map((node) => ({
    nodeId: node.id,
    status: "deployed",
    name: node.data.entity.name,
    address: node.data.entity.address,
    tokenSymbol: node.data.entity.token?.symbol,
  }));
  const deploying: ContractListEntry[] = deployingGhosts.map((ghost) => ({
    nodeId: ghost.id,
    status: "deploying",
    name: ghost.data.label,
  }));
  return [...deployed, ...deploying];
}

/**
 * 出現順（新しいものが上）に並べ替える。`order` は id ごとの出現シーケンス
 * 番号（`useAppearanceOrder` が返すもの。大きいほど新しい）。`order` に無い
 * id は最も古い扱い（`-Infinity`）にして末尾へ送る（呼び出し側の
 * `useAppearanceOrder` は同じ id 配列から作るため通常は起こらない防御的措置）。
 */
export function sortEntriesByAppearance(
  entries: ContractListEntry[],
  order: ReadonlyMap<string, number>,
): ContractListEntry[] {
  return [...entries].sort((a, b) => {
    const orderA = order.get(a.nodeId) ?? Number.NEGATIVE_INFINITY;
    const orderB = order.get(b.nodeId) ?? Number.NEGATIVE_INFINITY;
    return orderB - orderA;
  });
}

/** `resolveNodeCenter` が測定値未確定時に使うフォールバック幅・高さ(flow px)。 */
export const FALLBACK_NODE_WIDTH = 220;
export const FALLBACK_NODE_HEIGHT = 120;

/**
 * ノードの左上座標(`position`)と実測サイズ(`measured`)から、パン先の中心
 * 座標を求める（`setCenter` に渡す値。React Flow はノード中心ではなく
 * 左上座標しか持たないため呼び出し側で加算する必要がある）。
 *
 * `measured` が未確定（レンダー直後などでまだ計測されていない）場合は
 * `FALLBACK_NODE_WIDTH`/`FALLBACK_NODE_HEIGHT` で近似する。厳密な中心でなく
 * ても許容できる（`setCenter` はカードが画面内に入ればよい導線目的のため）。
 */
export function resolveNodeCenter(
  position: { x: number; y: number },
  measured: { width?: number; height?: number } | undefined,
): { x: number; y: number } {
  const width = measured?.width ?? FALLBACK_NODE_WIDTH;
  const height = measured?.height ?? FALLBACK_NODE_HEIGHT;
  return { x: position.x + width / 2, y: position.y + height / 2 };
}
