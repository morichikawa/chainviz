// C層(ウォレット/コントラクト/操作)シナリオが共通で使う、定型操作パネルの
// 開閉・送信ヘルパーとワークベンチ追加ヘルパー。UI-C-01〜UI-C-07
// (wallet-balance.spec.ts / contract-lifecycle.spec.ts /
// token-balance.spec.ts の3ファイル)で共有する。この3ファイルは同じ操作
// パネルの開閉・入力・送信という一連の操作を繰り返すため、
// commands-node.spec.ts / commands-workbench.spec.ts が個別に持つ小さな
// ロケータヘルパー(`anyGhostCard`等)とは違い、共有モジュールへ切り出す
// (重複コードによる修正漏れを避ける狙い。docs/worklog/issue-201.md
// 設計メモ参照)。

import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { SLOT_DURATION_MS } from "../../helpers/slot-time.js";
import { serviceEntityId } from "./serviceIds.js";

/** compose 起動の静的ワークベンチの entity id(プリセットウォレット持ち)。 */
export const STATIC_WORKBENCH_ID = serviceEntityId("workbench");

/**
 * addWorkbench 等、ワークベンチカード/ウォレットカードが出現するまでの
 * 待ち上限。`commands-workbench.spec.ts` の `ADD_WORKBENCH_CARD_TIMEOUT_MS`
 * と同じ実績値(30秒。A層/C層ポーリング間隔3000msの実測から安定して通る値)を
 * 踏襲する。
 */
export const ENTITY_APPEAR_TIMEOUT_MS = 30_000;

/**
 * 定型操作(送金・デプロイ・呼び出し)の実行結果(残高/nonce/コントラクト
 * カード/アクティビティチップ等)がUIへ反映されるまでの待ち上限。
 *
 * `cast`/`forge` は tx の receipt を待ってから終了するため、この待ちは slot
 * 時間に依存する。tx が次のブロックに取り込まれるまで最大1 slot、jitter を
 * 見込んで2 slot 分を slot 時間に比例させ、加えて collector のブロック購読
 * (newHeads)からWS配信までのオーバーヘッド・実行環境の負荷変動分を固定
 * オーバーヘッドとして足す。slot 時間は `helpers/slot-time.ts` が values.env
 * から導出する単一の値(`SLOT_DURATION_MS`)を使う。
 *
 * 下限は、slot 由来ではない `ADD_NODE_CARD_TIMEOUT_MS`/
 * `ADD_WORKBENCH_CARD_TIMEOUT_MS`(いずれもA/C層ポーリング3秒由来の実績値
 * 30秒)を割り込まないよう 30 秒とする(slot=2秒でも30秒、slot=12秒なら44秒)。
 */
export const OPERATION_EFFECT_TIMEOUT_MS = Math.max(
  30_000,
  SLOT_DURATION_MS * 2 + 20_000,
);

/**
 * 定型操作パネルを開くテストで使う、既定より大きいビューポート。
 *
 * 操作パネル(`OperationPanel.tsx`)はワークベンチカードの右側に固定位置
 * (`left: calc(100% + 12px)`)で開く。キャンバス上の位置はグリッド配置
 * (エンティティ数に応じて右・下に伸びる)のため、既定のビューポート
 * (Desktop Chrome プリセット、1280x720)では、追加ワークベンチ/
 * コントラクトが数枚存在するだけでパネルの送信ボタンがビューポート外に
 * はみ出し、クリックできなくなることを実機で確認した(パネル側に表示領域
 * 内へ自動で収める機構が無い。フロントエンド側の改善提案として別途
 * GitHub Issue化する。docs/worklog/issue-201.md 設計メモ参照)。
 * テスト側の回避策として、操作パネルを実際に開いて送信するテスト
 * (wallet-balance/contract-lifecycle/token-balance の3ファイル)だけ
 * 大きめのビューポートを使う。
 */
export const OPERATION_PANEL_VIEWPORT = { width: 1920, height: 1200 };

/** 生成中のゴーストカード(種類を問わない)を指すロケータ。 */
export function anyGhostCard(page: Page): Locator {
  return page.locator('[data-testid^="ghost-card-"]');
}

/** ツールバーからラベルを入力してワークベンチ追加ボタンを押す。 */
export async function submitAddWorkbench(page: Page, label: string): Promise<void> {
  await page.getByTestId("canvas-toolbar-workbench-label").fill(label);
  await page.getByTestId("canvas-toolbar-add-workbench").click();
}

/**
 * ワークベンチ→ウォレットの所有エッジ(`own-<workbenchId>-<address>` の
 * data-id)から、対象ウォレットのアドレスを取り出す
 * (`commands-workbench.spec.ts` の同名関数と同じ考え方。workbenchId 同士が
 * 前方一致してしまうケースを避けるため prefix に "0x" まで含める)。
 */
export async function ownershipEdgeWalletAddress(
  page: Page,
  workbenchId: string,
): Promise<string> {
  const prefix = `own-${workbenchId}-0x`;
  const edge = page.locator(`[data-id^="${prefix}"]`).first();
  await expect(edge).toHaveCount(1, { timeout: ENTITY_APPEAR_TIMEOUT_MS });
  const dataId = await edge.getAttribute("data-id");
  if (!dataId) {
    throw new Error(`ownership edge for ${workbenchId} has no data-id`);
  }
  // prefix には曖昧さ回避のため "0x" まで含めているが、戻り値のアドレス
  // 自体は "0x" を含める必要があるため、その分(2文字)を巻き戻して切り出す。
  return dataId.slice(prefix.length - 2);
}

/**
 * ラベルを付けてワークベンチを追加し、カード出現とウォレットカード出現
 * (ウォレットアドレスの解決含む)まで待つ。UI-C 層のシナリオが送金/呼び出し
 * 先として「別のウォレット」を必要とするたびに使う。
 */
export async function addWorkbenchAndGetWallet(
  page: Page,
  label: string,
): Promise<{ workbenchId: string; address: string }> {
  const workbenchId = serviceEntityId(label);
  await submitAddWorkbench(page, label);
  await expect(page.getByTestId(`infra-card-${workbenchId}`)).toBeVisible({
    timeout: ENTITY_APPEAR_TIMEOUT_MS,
  });
  const address = await ownershipEdgeWalletAddress(page, workbenchId);
  await expect(page.getByTestId(`wallet-card-${address}`)).toBeVisible({
    timeout: ENTITY_APPEAR_TIMEOUT_MS,
  });
  return { workbenchId, address };
}

export type OperationTab = "transfer" | "deploy" | "call";

/**
 * ワークベンチの操作ボタン(`infra-card-operate-<id>`)を押して操作パネルを
 * 開き、指定タブへ切り替える。既定は送金タブ(パネルを開いた直後の既定
 * タブ)。
 */
export async function openOperationPanel(
  page: Page,
  workbenchId: string,
  tab: OperationTab = "transfer",
): Promise<Locator> {
  await page.getByTestId(`infra-card-operate-${workbenchId}`).click();
  const panel = page.getByTestId(`operation-panel-${workbenchId}`);
  await expect(panel).toBeVisible();
  if (tab !== "transfer") {
    await panel.getByTestId(`operation-tab-${tab}`).click();
  }
  return panel;
}

/**
 * 開いている操作パネルのフォームを送信する。送信ボタン自体には
 * `data-testid` が無く(`docs/ARCHITECTURE.md` §8.5 の追加計装対象にも
 * 含まれていない)、文言(i18n)依存のロケータは避ける方針(§8.5)のため、
 * 表示中の1フォーム内の `type="submit"` ボタンという構造的な属性で特定する
 * (タブ切り替えで他のフォームはDOMから外れているため、常に1件だけに絞れる)。
 */
async function submitOperationForm(panel: Locator): Promise<void> {
  await panel.locator('form button[type="submit"]').click();
}

/** 送金タブに宛先・金額(ETH建て10進文字列)を入力して送信する。 */
export async function submitTransfer(
  page: Page,
  workbenchId: string,
  params: { to: string; amount: string },
): Promise<void> {
  const panel = await openOperationPanel(page, workbenchId, "transfer");
  await panel.getByTestId("operation-transfer-to").fill(params.to);
  await panel.getByTestId("operation-transfer-amount").fill(params.amount);
  await submitOperationForm(panel);
}

/** デプロイタブでカタログのコントラクトを選び、コンストラクタ引数を入力して送信する。 */
export async function submitDeploy(
  page: Page,
  workbenchId: string,
  params: { catalogKey: string; constructorArgs?: Record<string, string> },
): Promise<void> {
  const panel = await openOperationPanel(page, workbenchId, "deploy");
  await panel.getByTestId("operation-deploy-contract").selectOption(params.catalogKey);
  for (const [name, value] of Object.entries(params.constructorArgs ?? {})) {
    await panel.getByTestId(`operation-deploy-arg-${name}`).fill(value);
  }
  await submitOperationForm(panel);
}

/** 呼び出しタブで対象コントラクト・関数を選び、引数を入力して送信する。 */
export async function submitCall(
  page: Page,
  workbenchId: string,
  params: {
    contractAddress: string;
    functionSignature: string;
    args?: Record<string, string>;
    amount?: string;
  },
): Promise<void> {
  const panel = await openOperationPanel(page, workbenchId, "call");
  // target を先に選ぶと function は対象コントラクトの先頭関数へリセットされる
  // ため(CallForm.tsx の selectContract)、その後に目的の関数を選び直す。
  await panel.getByTestId("operation-call-target").selectOption(params.contractAddress);
  await panel.getByTestId("operation-call-function").selectOption(params.functionSignature);
  for (const [name, value] of Object.entries(params.args ?? {})) {
    await panel.getByTestId(`operation-call-arg-${name}`).fill(value);
  }
  if (params.amount !== undefined) {
    await panel.getByTestId("operation-call-amount").fill(params.amount);
  }
  await submitOperationForm(panel);
}

/** `deploy-<deployer>-<contract>` の data-id 接頭辞・アドレス長(0x + 40桁の16進)。 */
const DEPLOY_EDGE_PREFIX = "deploy-";
const ETH_ADDRESS_LENGTH = 42;

/**
 * 指定したデプロイ元ウォレットからのデプロイエッジ(`deploy-<deployer>-<address>`
 * の data-id。`entities/deployEdge.ts` 参照)一覧から、デプロイ済みコントラクト
 * のアドレス集合を取り出す。新規デプロイの検知(前後の差分)に使う。
 *
 * `deploy-`以降を固定長(42文字 = "0x" + 40桁16進)で分割して比較する。
 * CSS属性の前方一致セレクタで単純に `deploy-${deployerAddress}-` を
 * 前方一致させると、deployerAddressの大文字小文字表記が食い違う場合
 * (`ContractEntity.deployerAddress`はreceipt由来の小文字表記、
 * `WalletEntity.address`はmnemonicから導出したEIP-55チェックサム表記に
 * なりうる。`store-transaction-wallet-link.test.ts`と同じ事情)に一致せず、
 * 常に空集合を返してしまう不具合を実機で確認したため、小文字化してから
 * 比較する。
 */
export async function deployedContractAddresses(
  page: Page,
  deployerAddress: string,
): Promise<Set<string>> {
  const deployerLower = deployerAddress.toLowerCase();
  const edges = page.locator(`[data-id^="${DEPLOY_EDGE_PREFIX}"]`);
  const dataIds = await edges.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-id") ?? ""),
  );
  const result = new Set<string>();
  for (const dataId of dataIds) {
    const rest = dataId.slice(DEPLOY_EDGE_PREFIX.length);
    const edgeDeployer = rest.slice(0, ETH_ADDRESS_LENGTH);
    const edgeContract = rest.slice(ETH_ADDRESS_LENGTH + 1); // "-" の分を1文字読み飛ばす
    if (edgeDeployer.toLowerCase() === deployerLower) result.add(edgeContract);
  }
  return result;
}
