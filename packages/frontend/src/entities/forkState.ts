import type { BlockEntity } from "@chainviz/shared";

/**
 * フォーク（一時的な分岐）検知の純粋関数（ARCHITECTURE.md §9.2、Issue #296）。
 *
 * 各ノードの `NodeEntity.headBlockHash`（tip のブロックハッシュ）を比較し、
 * 「通常の伝播ラグ・同期中ノードの古い tip」と「本物の分岐」を
 * `BlockEntity.parentHash` の祖先関係で区別する。判定はワールドステートに
 * 保存された観測事実（各ノードの tip・保持しているブロック集合）だけから
 * 導出し、collector 側では判定結果を持たない（tip 集合から一意に導出できる
 * ため、二重に配信しない）。
 *
 * 安全側の方針: 祖先を辿り切れない（対象のブロックがフロントのストアに
 * 無い）場合はフォークと確定しない。誤って「フォークではない」と扱う
 * （過小検出）方が、誤って「フォーク」と表示する（過大検出・毎スロット
 * 色が付く）よりも学習上の害が小さいという設計判断による。
 */

/** フォーク判定の対象になりうるノードの最小情報。 */
export interface ForkTipCandidate {
  id: string;
  headBlockHash: string;
}

/** ブロックハッシュ → BlockEntity の索引を作る。 */
export function buildBlockIndex(
  blocks: readonly BlockEntity[],
): Map<string, BlockEntity> {
  const byHash = new Map<string, BlockEntity>();
  for (const block of blocks) byHash.set(block.hash, block);
  return byHash;
}

/**
 * 祖先探索の打ち切り上限の既定値。フロントが実際に保持しているブロック数
 * より多くホップすることはあり得ない（それを超えて辿ろうとしても未知の
 * ブロックで打ち切られるだけ）ため、既知ブロック数をそのまま上限に使う
 * （Issue #296 設計メモ「打ち切り上限の値はフロントが保持するブロック数から
 * 導出する」）。ブロックが1件も無ければ0（探索自体が発生しない）。
 *
 * この関数は「保持ブロック数」という実測値から上限を導出するためのもので、
 * 環境によらず成立する（固定のマジックナンバーではない）。
 */
export function defaultMaxAncestorSteps(blockCount: number): number {
  return blockCount;
}

/**
 * `tip` から高さ `targetNumber` まで `parentHash` を辿った先のブロックハッシュを
 * 返す。以下の場合は null（辿り切れない・安全側でフォーク判定に使わない）:
 * - 探索中に `blockByHash` に無いブロックへ到達した
 * - `maxSteps` 以内に `targetNumber` へ到達できなかった
 * - `targetNumber` が `tip.number` より大きい（呼び出し側の前提違反）
 */
function resolveAncestorAtHeight(
  tip: BlockEntity,
  targetNumber: number,
  blockByHash: ReadonlyMap<string, BlockEntity>,
  maxSteps: number,
): string | null {
  let current = tip;
  let steps = 0;
  while (current.number > targetNumber) {
    if (steps >= maxSteps) return null;
    const parent = blockByHash.get(current.parentHash);
    if (!parent) return null;
    current = parent;
    steps += 1;
  }
  return current.number === targetNumber ? current.hash : null;
}

/**
 * 2つの tip の関係。
 * - "same": 同一チェーン上（一方が他方の祖先、または完全一致）。フォークではない。
 * - "fork": 同じ高さで異なるブロック、または祖先を辿った先が異なる。本物の分岐。
 * - "unknown": 祖先を辿り切れず判定できない（安全側でフォークとはみなさない）。
 */
export type ChainRelation = "same" | "fork" | "unknown";

/** 2つの tip（BlockEntity）の関係を判定する（純粋関数）。 */
export function chainRelation(
  a: BlockEntity,
  b: BlockEntity,
  blockByHash: ReadonlyMap<string, BlockEntity>,
  maxSteps: number,
): ChainRelation {
  if (a.hash === b.hash) return "same";
  const [higher, lower] = a.number >= b.number ? [a, b] : [b, a];
  const ancestorHash = resolveAncestorAtHeight(
    higher,
    lower.number,
    blockByHash,
    maxSteps,
  );
  if (ancestorHash === null) return "unknown";
  return ancestorHash === lower.hash ? "same" : "fork";
}

/** フォーク検知結果の1グループ（同一チェーン上にいるノード群）。 */
export interface ForkGroup {
  /** グループの代表キー（グループ内に含まれる tip ハッシュの辞書順最小値）。 */
  groupKey: string;
  /** このグループに属するノード id（昇順）。 */
  nodeIds: string[];
  /** このグループに属する tip ハッシュ（昇順。複数ありうる。同一チェーン上の
   * 異なる高さの tip が同じグループに入ることがあるため）。 */
  tipHashes: string[];
}

/** Union-Find（経路圧縮つき）。distinct tip hash の集合を判定結果に応じて併合する。 */
function createUnionFind(keys: Iterable<string>): {
  find: (x: string) => string;
  union: (a: string, b: string) => void;
} {
  const parent = new Map<string, string>();
  for (const key of keys) parent.set(key, key);

  function find(x: string): string {
    let root = x;
    while (true) {
      const next = parent.get(root);
      if (next === undefined || next === root) break;
      root = next;
    }
    let cur = x;
    while (cur !== root) {
      const next = parent.get(cur) as string;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  function union(a: string, b: string): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  return { find, union };
}

/**
 * ノード群の tip からフォークグループを検知する（純粋関数）。
 *
 * - 対象は `headBlockHash` が非空で、かつそのハッシュの `BlockEntity` を
 *   `blocks` から引けるノードのみ（未観測ノード・スナップショット欠落は対象外）。
 * - 相異なる tip が1つ以下（全ノードが同一 tip、または対象ノードが1件以下）
 *   なら空を返す（フォークなし）。
 * - 各 tip ペアを `chainRelation` で判定し、"same" または "unknown"（安全側）
 *   のペアは同じグループへ併合する。"fork" と確定したペアだけを別グループに
 *   残す。この結果、最終的なグループ数が2以上になったときだけフォークとして
 *   扱う（1グループに収束すればフォークなし）。
 *
 * 「unknown を安全側でグループ併合する」実装は、離れた場所で本物のフォークが
 * あっても、その間に unknown なペアが挟まると同一グループへ吸収されうる
 * （過小検出）。これは意図的なトレードオフで、「誤って色を付ける（過大検出）
 * より、稀に色が付かない（過小検出）方が学習上の害が小さい」という設計方針
 * （ARCHITECTURE.md §9.2）に基づく。
 */
export function detectForkGroups(
  nodeTips: readonly ForkTipCandidate[],
  blocks: readonly BlockEntity[],
  options: { maxAncestorSteps?: number } = {},
): ForkGroup[] {
  const blockByHash = buildBlockIndex(blocks);
  const maxSteps = options.maxAncestorSteps ?? defaultMaxAncestorSteps(blocks.length);

  const resolved: { id: string; block: BlockEntity }[] = [];
  for (const node of nodeTips) {
    if (node.headBlockHash === "") continue;
    const block = blockByHash.get(node.headBlockHash);
    if (!block) continue;
    resolved.push({ id: node.id, block });
  }

  const distinctTipHashes = [...new Set(resolved.map((r) => r.block.hash))].sort();
  if (distinctTipHashes.length < 2) return [];

  const blockByTip = new Map(resolved.map((r) => [r.block.hash, r.block]));
  const uf = createUnionFind(distinctTipHashes);

  for (let i = 0; i < distinctTipHashes.length; i += 1) {
    for (let j = i + 1; j < distinctTipHashes.length; j += 1) {
      const a = blockByTip.get(distinctTipHashes[i]);
      const b = blockByTip.get(distinctTipHashes[j]);
      if (!a || !b) continue; // 到達しない（distinctTipHashes は blockByTip のキー由来）
      const relation = chainRelation(a, b, blockByHash, maxSteps);
      if (relation !== "fork") uf.union(distinctTipHashes[i], distinctTipHashes[j]);
    }
  }

  const byRoot = new Map<string, { nodeIds: Set<string>; tipHashes: Set<string> }>();
  for (const { id, block } of resolved) {
    const root = uf.find(block.hash);
    let bucket = byRoot.get(root);
    if (!bucket) {
      bucket = { nodeIds: new Set(), tipHashes: new Set() };
      byRoot.set(root, bucket);
    }
    bucket.nodeIds.add(id);
    bucket.tipHashes.add(block.hash);
  }

  if (byRoot.size < 2) return [];

  return [...byRoot.values()]
    .map((bucket) => {
      const tipHashes = [...bucket.tipHashes].sort();
      return {
        groupKey: tipHashes[0],
        nodeIds: [...bucket.nodeIds].sort(),
        tipHashes,
      };
    })
    .sort((x, y) => x.groupKey.localeCompare(y.groupKey));
}

/** グループ内で最も高さ（`BlockEntity.number`）が大きい tip ハッシュを返す。 */
export function highestTipHash(
  group: ForkGroup,
  blockByHash: ReadonlyMap<string, BlockEntity>,
): string {
  let best = group.tipHashes[0];
  let bestNumber = blockByHash.get(best)?.number ?? Number.NEGATIVE_INFINITY;
  for (const hash of group.tipHashes) {
    const number = blockByHash.get(hash)?.number ?? Number.NEGATIVE_INFINITY;
    if (number > bestNumber) {
      best = hash;
      bestNumber = number;
    }
  }
  return best;
}
