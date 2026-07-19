import { keccak256Hex } from "./keccak256.js";

/**
 * 「ハッシュのしくみ」デモ（Issue #401）の疑似ブロック1件。実チェーンの
 * `BlockEntity`（`@chainviz/shared`）とは無関係の、完全に独立した学習用
 * データ（UX設計 `docs/worklog/issue-401.md` §2）。実データに影響しない
 * 安全な砂場のため、番号は実リボンの `#124` のような値と混同しない
 * 小さい固定値（1・2・3）にする。
 */
export interface HashChainDemoBlock {
  /** 1, 2, 3 固定。 */
  number: number;
  /** 「ブロックに格納されている」親ハッシュ（記録値）。ユーザーが直接
   * 編集することはできず、「親ハッシュをつなぎ直す」操作（`relinkBlock`）
   * でのみ書き換わる。 */
  storedParentHash: string;
  /** 自由に編集できるテキスト（唯一のユーザー編集対象）。 */
  data: string;
}

/** デモの状態。パネルを開いた瞬間から閉じるまでのローカル state（UX設計§3冒頭）。 */
export interface HashChainDemoState {
  blocks: HashChainDemoBlock[];
}

/** 起点ブロック（#1）の `storedParentHash`。「この砂場の起点。親はいない」印。 */
export const GENESIS_PARENT_HASH = `0x${"0".repeat(64)}`;

/** 初期データ（UX設計§3「送金風の例文」）。3言語で分ける必要のない固有名詞主体のため、
 * i18n 化はしない（アドレスや金額など他の画面のデータ由来テキストと同じ扱い）。 */
const SEED_DATA: readonly string[] = [
  "Alice → Bob: 5 ETH",
  "Bob → Carol: 2 ETH",
  "Carol → Alice: 1 ETH",
];

/**
 * ブロックのハッシュを導出する（state には持たない。UX設計§3「導出値」）。
 * 実ブロックのヘッダ全体を RLP エンコードしてハッシュ化する実装は再現せず、
 * `番号|親ハッシュ(記録値)|データ` を UTF-8 で連結して keccak256 する簡略化
 * （UX設計§2で合意済み。パネル内の `hashDemo.simplifiedNote` で注記する）。
 *
 * 重要な性質: この計算はブロック自身のフィールドだけで決まり、他のブロックの
 * 状態（有効/無効かどうか）を一切参照しない。実チェーンと同じく「ハッシュは
 * 中身から決まる指紋」であることをそのまま反映している。
 */
export function deriveBlockHash(block: HashChainDemoBlock): string {
  return keccak256Hex(`${block.number}|${block.storedParentHash}|${block.data}`);
}

/**
 * 初期状態を作る。#1 の `storedParentHash` は全ゼロ（`GENESIS_PARENT_HASH`）、
 * #2 以降はその時点の直前ブロックの導出ハッシュを記録した、3ブロックすべてが
 * 有効な状態から必ず始まる（パネルを開き直すたびにここへ戻る。UX設計§3冒頭：
 * 「学習デモは毎回同じ起点が明快」）。
 */
export function createInitialHashChainDemoState(): HashChainDemoState {
  const blocks: HashChainDemoBlock[] = [];
  SEED_DATA.forEach((data, index) => {
    const previous = blocks[index - 1];
    const storedParentHash = previous ? deriveBlockHash(previous) : GENESIS_PARENT_HASH;
    blocks.push({ number: index + 1, storedParentHash, data });
  });
  return { blocks };
}

/**
 * 「最初に戻す」操作（UX設計§3操作フロー5）。閉じたら破棄する設計のため、
 * 実質 `createInitialHashChainDemoState()` の呼び直しと同じだが、呼び出し側
 * （View）の意図を明確にするため別名の関数として公開する。
 */
export function resetHashChainDemoState(): HashChainDemoState {
  return createInitialHashChainDemoState();
}

/**
 * ブロックが有効かどうか: 自身の `storedParentHash` が、直前ブロックの
 * **現在の**導出ハッシュと一致するか。先頭（index 0）は親を持たないため
 * 常に有効（UX設計§3「導出式」）。
 *
 * 範囲外の index には防御的に true を返す（呼び出し側の境界ミスで誤って
 * 「無効」を表示してしまわないため。3ブロック固定の本デモでは通常発生しない）。
 */
export function isBlockValid(blocks: readonly HashChainDemoBlock[], index: number): boolean {
  if (index <= 0) return true;
  const block = blocks[index];
  const previous = blocks[index - 1];
  if (!block || !previous) return true;
  return block.storedParentHash === deriveBlockHash(previous);
}

/** 全ブロックが有効かどうか（UX設計§3操作フロー4「まとめメッセージ」の判定材料の一部）。 */
export function isFullyRepaired(blocks: readonly HashChainDemoBlock[]): boolean {
  return blocks.every((_, index) => isBlockValid(blocks, index));
}

/**
 * 指定ブロックの `data` を書き換える（唯一のユーザー編集操作。UX設計§3
 * 操作フロー2）。他のブロックのフィールドは一切変えない。
 *
 * 重要な性質（実装設計メモ参照）: この操作で導出ハッシュが変わるのは
 * 編集した本人だけ。後続ブロックの `storedParentHash`（記録値）はまだ古い
 * ままなので、**直後の1ブロックだけ**が無効になる（`isBlockValid` が false
 * を返すようになる）。さらにその次のブロックは、直後のブロックが
 * `relinkBlock` で実際にハッシュを変えるまでは無効にならない（後述）。
 */
export function updateBlockData(
  state: HashChainDemoState,
  index: number,
  data: string,
): HashChainDemoState {
  return {
    blocks: state.blocks.map((block, i) => (i === index ? { ...block, data } : block)),
  };
}

/**
 * 「親ハッシュをつなぎ直す」操作（UX設計§3操作フロー3。連鎖修復の核）。
 * 指定ブロックの `storedParentHash` を、直前ブロックの現在の導出ハッシュへ
 * 書き換える。これにより指定ブロック自身は有効に戻るが、`storedParentHash`
 * が変わったことで指定ブロック自身の導出ハッシュも変わるため、**次の
 * ブロックはまだ無効のまま**残る（1回の relink ごとに「無効の先頭」が
 * 1つずつ後ろへ進む）。
 *
 * 先頭ブロック（index 0）には親が無いため no-op（元の state をそのまま返す）。
 */
export function relinkBlock(state: HashChainDemoState, index: number): HashChainDemoState {
  if (index <= 0) return state;
  const previous = state.blocks[index - 1];
  if (!previous) return state;
  const nextParentHash = deriveBlockHash(previous);
  return {
    blocks: state.blocks.map((block, i) =>
      i === index ? { ...block, storedParentHash: nextParentHash } : block,
    ),
  };
}
