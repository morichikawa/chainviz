import { keccak256Hex } from "./keccak256.js";
import { deriveAddress, recoverAddress, sign } from "./secp256k1.js";

/**
 * 「署名と検証のしくみ」デモ（Issue #402）の疑似データ・ドメインロジック。
 * 実チェーンの `TransactionEntity`（`@chainviz/shared`）とは無関係の、
 * 完全に独立した学習用データ（UX設計 `docs/worklog/issue-402.md` §2）。
 * `hashChainDemo.ts`（Issue #401）と対になるファイルで、同じ設計判断
 * （state には導出値を持たない・純粋関数で状態遷移を表す）を踏襲する。
 */

/** 砂場専用の署名者。実ウォレットの秘密鍵は一切扱わない。 */
export type DemoKeyId = "alice" | "attacker";

/** 送金の内容（唯一のユーザー編集対象。実 tx の nonce 等は出さない簡略化）。 */
export interface TxDraft {
  to: string;
  amountEth: string;
}

/** デモの状態。パネルを開いた瞬間から閉じるまでのローカル state。 */
export interface SignatureDemoState {
  /** ワークベンチが署名して送った時点の内容と使った鍵（署名はここから導出）。 */
  sent: { content: TxDraft; signedBy: DemoKeyId };
  /** ノード側で見えている内容（編集 = 改ざん）。 */
  received: TxDraft;
}

/**
 * 砂場専用の固定秘密鍵。ラベル文字列を keccak256 した値を秘密鍵として使う
 * ことで「乱数ではなく決定的に導出された、実ウォレットとは無関係の
 * 使い捨て鍵」であることをコード上も明確にする（実装設計メモ参照。
 * `keccak256Hex` の出力は常に32byteのため、そのまま secp256k1 の秘密鍵
 * として使える）。
 */
const ALICE_SECRET_KEY_HEX = keccak256Hex("chainviz:sigdemo:alice");
const ATTACKER_SECRET_KEY_HEX = keccak256Hex("chainviz:sigdemo:attacker");
const RECIPIENT_SECRET_KEY_HEX = keccak256Hex("chainviz:sigdemo:recipient");

/** Alice役の固定アドレス。tx の `from` として常にこれが表示される。 */
export const ALICE_ADDRESS = deriveAddress(ALICE_SECRET_KEY_HEX);
/** 攻撃者役の固定アドレス。「なりすまし」が実際に別アドレスになることを示す。 */
export const ATTACKER_ADDRESS = deriveAddress(ATTACKER_SECRET_KEY_HEX);
/** 宛先の初期値（Bob役）。この人物は署名しないため秘密鍵は公開しない。 */
const RECIPIENT_ADDRESS = deriveAddress(RECIPIENT_SECRET_KEY_HEX);

/** Alice の秘密鍵を画面表示するための値（`sigDemo.privateKey`。実際の秘密鍵は
 * 画面に出さないという既存の glossary `signature` の説明と矛盾しないよう、
 * 「これは砂場専用の使い捨て鍵」であることをパネル内に明記する前提で公開する）。 */
export const ALICE_SANDBOX_PRIVATE_KEY = ALICE_SECRET_KEY_HEX;

function secretKeyFor(id: DemoKeyId): string {
  return id === "alice" ? ALICE_SECRET_KEY_HEX : ATTACKER_SECRET_KEY_HEX;
}

const INITIAL_TX_DRAFT: TxDraft = { to: RECIPIENT_ADDRESS, amountEth: "1" };

/**
 * 署名対象のメッセージハッシュを導出する（state には持たない）。実際の
 * tx の RLP / EIP-155 エンコードは再現せず、`from|to|amount` を UTF-8 連結
 * して keccak256 する簡略化（UX設計§2で合意済み。`sigDemo.simplifiedNote`
 * で注記する）。
 *
 * 重要な性質: `from` には常に `ALICE_ADDRESS` を使う。実際に誰の鍵で署名
 * したか（`signedBy`）に関わらず、「これは Alice が送った」という主張
 * 内容そのものは変わらない、という改ざん検知の要点をそのまま体現する。
 */
function messageHash(content: TxDraft): string {
  return keccak256Hex(`${ALICE_ADDRESS}|${content.to}|${content.amountEth}`);
}

/** 初期状態を作る。常に有効な状態から始まる（学習デモは毎回同じ起点が明快）。 */
export function createInitialSignatureDemoState(): SignatureDemoState {
  const content = { ...INITIAL_TX_DRAFT };
  return { sent: { content, signedBy: "alice" }, received: { ...content } };
}

/**
 * 「最初に戻す」操作。閉じたら破棄する設計のため実質
 * `createInitialSignatureDemoState()` の呼び直しと同じだが、呼び出し側
 * （View）の意図を明確にするため別名で公開する（#401 と同じ判断）。
 */
export function resetSignatureDemoState(): SignatureDemoState {
  return createInitialSignatureDemoState();
}

/**
 * 上ゾーン（ワークベンチ）での編集（UX設計操作フロー1）。上ゾーンは常に
 * Alice 自身の操作という前提のため `signedBy` を明示的に `"alice"` に
 * 固定し、`sent.content` と `received` の両方を同じ内容に更新する
 * （＝本人が署名し直して送り直した状態。有効なまま追従する）。
 */
export function updateWorkbenchContent(
  state: SignatureDemoState,
  patch: Partial<TxDraft>,
): SignatureDemoState {
  const content = { ...state.sent.content, ...patch };
  return { sent: { content, signedBy: "alice" }, received: { ...content } };
}

/**
 * 下ゾーン（ノードに届いた内容）だけの編集（UX設計操作フロー2。通信途中の
 * 改ざんの想定）。`sent`（署名時点の内容・署名そのもの）には触れない。
 */
export function updateReceivedContent(
  state: SignatureDemoState,
  patch: Partial<TxDraft>,
): SignatureDemoState {
  return { ...state, received: { ...state.received, ...patch } };
}

/**
 * 「攻撃者の鍵で署名し直す」（UX設計操作フロー3）。改ざん後の内容
 * （`received`）に対して攻撃者の鍵で署名し直す。署名自体は数学的に
 * 正しくなるが、復元されるのは攻撃者のアドレスで `from`（Alice）とは
 * 一致しないため無効のまま（`isValid` が自然にそう判定する。個別の
 * 特殊分岐は設けない）。
 */
export function resignAsAttacker(state: SignatureDemoState): SignatureDemoState {
  return { sent: { content: { ...state.received }, signedBy: "attacker" }, received: state.received };
}

/**
 * 「Alice が署名し直す（正しく送り直す）」（UX設計操作フロー4）。改ざん後の
 * 内容に対して Alice 自身の鍵で署名し直す。これにより有効な状態へ戻る。
 */
export function resignAsAlice(state: SignatureDemoState): SignatureDemoState {
  return { sent: { content: { ...state.received }, signedBy: "alice" }, received: state.received };
}

/** ワークベンチが計算した署名データ（`sigDemo.signature`。導出値、state には持たない）。 */
export function deriveSignature(state: SignatureDemoState): string {
  return sign(secretKeyFor(state.sent.signedBy), messageHash(state.sent.content));
}

/**
 * ノードが署名から復元したアドレス（`sigDemo.recovered`。導出値）。
 * 「届いた内容」（`received`）に対するメッセージハッシュで復元する点が
 * 核心: 署名は署名時点の内容に対するものだが、検証は届いた内容に対して
 * 行われるため、内容が変わっていれば復元結果は一致しなくなる。
 */
export function deriveRecoveredAddress(state: SignatureDemoState): string {
  return recoverAddress(deriveSignature(state), messageHash(state.received));
}

/** 検証結果: 復元アドレスが送信者（常に Alice）と一致するか。 */
export function isValid(state: SignatureDemoState): boolean {
  return deriveRecoveredAddress(state) === ALICE_ADDRESS;
}
