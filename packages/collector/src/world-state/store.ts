// インメモリのワールドステート store。現在のエンティティ集合を保持し、
// 新しいポーリング結果を取り込むたびに差分（DiffEvent[]）を計算して返す。

import type {
  BlockEntity,
  ChainType,
  ContractEntity,
  DiffEvent,
  NodeEntity,
  NodeInternals,
  PeerEdge,
  TransactionEntity,
  WalletEntity,
  WorkbenchEntity,
  WorldStateEntity,
  WorldStateSnapshot,
} from "@chainviz/shared";
import {
  computeDiff,
  computeEdgeDiff,
  computeWalletDiff,
  edgeKey,
  entityId,
  type WalletObservation,
} from "./diff.js";

/** node / workbench（InfraEntity 系）かどうか。 */
function isInfraEntity(entity: WorldStateEntity): boolean {
  return entity.kind === "node" || entity.kind === "workbench";
}

/**
 * `WalletEntity.recentTxHashes` に保持する tx hash 数の上限。フロント側
 * （`entities/transaction.ts` の `DEFAULT_RECENT_TX_LIMIT`、既定 6）が表示
 * 件数を絞るため、ここでは無制限に増やさない程度の余裕を持たせるだけの
 * 上限（フロントの表示件数と厳密に一致させる必要はない）。
 */
const MAX_WALLET_RECENT_TX_HASHES = 20;

/**
 * store が保持する block エンティティの、観測済み最大ブロック番号からの
 * 保持窓の幅（Issue #298）。放置すると `applyBlock` は block を一度入れたら
 * 削除しないため、長時間稼働でスナップショットが際限なく肥大する。
 *
 * 挿入順の evict（古い順に間引く）ではなく番号窓にしているのは、addNode
 * 直後の追いつき中ノードが過去ブロックの newHeads を大量に流すケースで、
 * 挿入順 evict だと正史の先端タイルが一時的に押し出されてしまうため
 * （番号窓なら追いつきフラッドは「窓より古い番号」として取り込み自体を
 * 拒否できる。§ applyBlock 参照）。
 *
 * この固定値 32 が成立する前提条件（CLAUDE.md「今この瞬間に観測できる
 * 状態に依存した固定値をロジックに埋め込まない」対応。値を変える場合は
 * 以下も併せて見直すこと。詳細は docs/worklog/issue-298.md 参照）:
 * - フロント（チェーンリボン）の表示件数（既定 8 件）以上であること
 * - 同一番号で複数ハッシュが共存するフォークの余地を残すこと（#296）
 * - `BlockPropagationTracker`（アダプタ内、200 件保持）からの遅延
 *   receivedAt マージが、対象ブロックがまだ窓内にあるうちに
 *   entityUpdated として反映される余裕があること
 */
const BLOCK_RETENTION = 32;

/**
 * store が保持する pending（未取り込み）tx エンティティ数の上限（Issue #303）。
 * included/failed tx は対応する block の store 内存在に連動して自動的に
 * 有界になる（`applyTransaction` の入口ガード・`evictBlocksBelow` 参照）が、
 * pending tx は block を持たないためその窓の対象外であり、代わりにこの
 * 件数上限で有界化する。超過時は挿入順（Map の反復順）で最古の pending
 * から間引く。
 *
 * この固定値 256 が成立する前提条件（CLAUDE.md「今この瞬間に観測できる
 * 状態に依存した固定値をロジックに埋め込まない」対応。値を変える場合は
 * 以下も併せて見直すこと。詳細は docs/worklog/issue-303.md 参照）:
 * - 健全に稼働するチェーンでは pending tx は 1〜2 ブロックで included へ
 *   遷移して掃けるため、同時に滞留する pending は少数に留まる。この上限は
 *   「今この瞬間の同時滞留数」から導いた値ではなく、「一度も採掘されない
 *   tx（無効・過少ガス・置換で捨てられた等）が病的に溜まり続ける」ケース
 *   だけを防ぐ安全弁として設定している
 * - cap で間引かれた pending がその後 included/failed になった場合でも、
 *   `applyTransaction` の入口ガードを通って再度取り込まれるため、恒久的な
 *   取りこぼしにはならない（一時的にウォレットの tx チップ等から消えるだけ）
 */
const PENDING_TX_RETENTION = 256;

export class WorldStateStore {
  private readonly entities = new Map<string, WorldStateEntity>();
  private edges: PeerEdge[] = [];
  private timestamp = Date.now();
  /**
   * これまでに `applyBlock` へ渡された block のうち観測済みの最大番号
   * （単調増加）。block 保持窓の下限計算に使う。まだ 1 件も block を
   * 取り込んでいなければ undefined。
   */
  private maxObservedBlockNumber: number | undefined;

  constructor(private readonly chainType: ChainType = "ethereum") {}

  /** 現在の全量スナップショットを返す。 */
  getSnapshot(): WorldStateSnapshot {
    return {
      chainType: this.chainType,
      timestamp: this.timestamp,
      entities: [...this.entities.values()],
      edges: [...this.edges],
    };
  }

  /**
   * A 層のポーリング結果（node/workbench の集合）を取り込む。差分計算は
   * InfraEntity 系だけを対象にし、他層が入れたエンティティ（ウォレット等）は
   * 消さずに残す。返り値は適用した差分イベント。
   */
  applyInfra(next: WorldStateEntity[]): DiffEvent[] {
    const prevInfra = [...this.entities.values()].filter(isInfraEntity);
    const diff = computeDiff(prevInfra, next);
    for (const event of diff) this.applyEvent(event);
    this.timestamp = Date.now();
    return diff;
  }

  /**
   * B 層のピア接続（PeerEdge の集合）を取り込む。前回のエッジ集合との差分を
   * 計算し、edgeAdded / edgeRemoved を適用する。返り値は適用した差分イベント。
   */
  applyPeers(next: PeerEdge[]): DiffEvent[] {
    const diff = computeEdgeDiff(this.edges, next);
    for (const event of diff) this.applyEvent(event);
    this.timestamp = Date.now();
    return diff;
  }

  /**
   * B 層のブロック受信タイミング（BlockEntity）を取り込む。ブロックはハッシュを
   * キーとするエンティティなので、既存の同一ブロックとの差分だけを計算する
   * （他のエンティティは触らない）。
   *
   * `BLOCK_RETENTION`（既定 32）によるブロック番号ベースの保持窓を適用する
   * （Issue #298）:
   * - 取り込みによって観測済み最大ブロック番号が更新された後の窓
   *   （`newMax - BLOCK_RETENTION + 1` 以上）より古い番号のブロックは
   *   取り込まず、空の差分を返す（エラーではない正常系。addNode 直後の
   *   追いつき中ノードが過去ブロックの newHeads を大量に流すケースの対策）
   * - 取り込みの結果、窓から外れた既存ブロックは削除し `entityRemoved` を
   *   差分として配信する
   * - 同一番号・別ハッシュ（フォーク）のブロックはどちらも窓内であれば
   *   両方保持される（削除はブロック番号だけで判定し、ハッシュの同一性は
   *   見ない）
   * - 窓から外れて削除される block の hash に `blockHash` が一致する
   *   included/failed tx（`TransactionEntity`）も同じ差分の中で併せて
   *   削除する（Issue #303。「included/failed tx が store に在るのは、
   *   その block が store に在るときだけ」という不変条件を保つ）
   *
   * 返り値は適用した差分イベント（この block 自身の add/update に加えて、
   * 窓から外れた既存ブロックとそれに紐づく tx の entityRemoved を含む）。
   */
  applyBlock(block: BlockEntity): DiffEvent[] {
    const newMax =
      this.maxObservedBlockNumber === undefined
        ? block.number
        : Math.max(this.maxObservedBlockNumber, block.number);
    const windowLowerBound = newMax - BLOCK_RETENTION + 1;

    if (block.number < windowLowerBound) {
      // 窓より古い番号の流入は破棄する。maxObservedBlockNumber は
      // このブロックによっては動かない（newMax の計算上、この分岐に
      // 入るのは block.number < 既存の maxObservedBlockNumber の場合のみ）。
      return [];
    }

    this.maxObservedBlockNumber = newMax;
    const diff = this.applyKeyed(block);
    const evicted = this.evictBlocksBelow(windowLowerBound);
    return evicted.length > 0 ? [...diff, ...evicted] : diff;
  }

  /**
   * 保持窓の下限（`lowerBound`）未満のブロック番号を持つ block エンティティを
   * 削除し、`entityRemoved` イベントとして返す。`applyBlock` からのみ呼ぶ。
   * 削除した block の hash に `blockHash` が一致する included/failed tx も
   * 同じ差分イベント配列に含めて併せて削除する（Issue #303）。
   */
  private evictBlocksBelow(lowerBound: number): DiffEvent[] {
    const events: DiffEvent[] = [];
    const evictedBlockHashes = new Set<string>();
    for (const entity of this.entities.values()) {
      if (entity.kind !== "block") continue;
      if (entity.number >= lowerBound) continue;
      const event: DiffEvent = { type: "entityRemoved", id: entityId(entity) };
      this.applyEvent(event);
      events.push(event);
      evictedBlockHashes.add(entityId(entity));
    }
    if (evictedBlockHashes.size === 0) return events;

    // 窓落ちした block を親に持つ tx（included/failed。blockHash が一致）を
    // 併せて削除する。pending tx（blockHash なし）はこのループの対象外
    // （`entity.blockHash` が undefined なら Set.has は必ず false になる）。
    for (const entity of this.entities.values()) {
      if (entity.kind !== "transaction") continue;
      if (!entity.blockHash || !evictedBlockHashes.has(entity.blockHash)) continue;
      const event: DiffEvent = { type: "entityRemoved", id: entityId(entity) };
      this.applyEvent(event);
      events.push(event);
    }
    return events;
  }

  /**
   * C 層の tx ライフサイクル（TransactionEntity）を取り込む。tx はハッシュを
   * キーとするエンティティなので、既存の同一 tx との差分だけを計算する
   * （pending → included の遷移は entityUpdated として出る）。
   *
   * Issue #303: 種別に応じて 2 系統の保持窓を適用する。
   * - included/failed tx（`blockHash` を持つ）: **入口ガード**として、その
   *   `blockHash` を id に持つ block が store に存在するときだけ取り込む。
   *   存在しなければ空の差分を返して捨てる（addNode 直後の追いつきで届く
   *   過去ブロックの tx は、対応する block が番号窓で既に弾かれているため
   *   同じ窓で自動的に弾かれる。前提: block は対応する included/failed tx
   *   より先に store へ届く。docs/worklog/issue-303.md 参照）。取り込んだ
   *   場合の退去は `applyBlock`/`evictBlocksBelow` が block 退去と同時に行う
   * - pending tx（`blockHash` を持たない）: block 連動の対象外とし、代わりに
   *   `PENDING_TX_RETENTION` による件数上限を適用する
   *
   * 返り値は適用した差分イベント。
   */
  applyTransaction(tx: TransactionEntity): DiffEvent[] {
    if (tx.blockHash !== undefined) {
      const block = this.entities.get(tx.blockHash);
      if (!block || block.kind !== "block") return [];
      return this.applyKeyed(tx);
    }

    const diff = this.applyKeyed(tx);
    const evicted = this.evictExcessPendingTransactions();
    return evicted.length > 0 ? [...diff, ...evicted] : diff;
  }

  /**
   * pending tx（`blockHash` なし）が `PENDING_TX_RETENTION` を超えている
   * 場合、超過分を Map の挿入順（＝ store への取り込み順）で最古のものから
   * 間引き、`entityRemoved` イベントとして返す。`applyTransaction` からのみ
   * 呼ぶ。
   */
  private evictExcessPendingTransactions(): DiffEvent[] {
    const pendingIds: string[] = [];
    for (const entity of this.entities.values()) {
      if (entity.kind === "transaction" && entity.status === "pending") {
        pendingIds.push(entityId(entity));
      }
    }
    const excess = pendingIds.length - PENDING_TX_RETENTION;
    if (excess <= 0) return [];

    const events: DiffEvent[] = [];
    for (let i = 0; i < excess; i++) {
      const event: DiffEvent = { type: "entityRemoved", id: pendingIds[i] };
      this.applyEvent(event);
      events.push(event);
    }
    return events;
  }

  /**
   * 指定 hash を持つ tx エンティティが store に存在するか。`applyTransaction`
   * の入口ガードで捨てられた（＝ store に一度も取り込まれていない）tx を
   * 呼び出し側が判別するために使う（Issue #303。`linkTransactionToWallets`
   * は store に存在しない tx のウォレット紐付けを避けるべきため）。
   */
  hasTransaction(hash: string): boolean {
    const entity = this.entities.get(hash);
    return entity !== undefined && entity.kind === "transaction";
  }

  /**
   * この tx の `from`/`to` に一致する既存の `WalletEntity` があれば、その
   * `recentTxHashes` へこの tx の hash を反映する（ウォレットカードの
   * tx チップ表示。`WalletEntity.recentTxHashes` は元々この用途で
   * 定義されていたが、Issue #201 の E2E 実装で「実際の collector からは
   * 一度も更新されない」欠落が発覚したため追加した）。
   *
   * アドレスの表記揺れ（tx.from/to は RPC 由来の小文字表記、WalletEntity.
   * address は mnemonic から導出した EIP-55 チェックサム表記になりうる。
   * `wallet-derivation.ts` 参照）を吸収するため、小文字化して比較する
   * （`contracts.ts` の `normalizeAddress` と同じ考え方。ただし store の
   * 既存キー・他ルックアップとの一貫性を保つため `WalletEntity.address`
   * 自体の表記は変更しない）。
   *
   * 一致するウォレットが無い（まだ観測されていない・ワークベンチ所有の
   * ウォレットではない相手）場合はそのアドレス分は何もしない
   * （ダングリング参照ガード。ARCHITECTURE.md「対応するエンティティが
   * 未観測なら表示しない」と同じ流儀）。同一 hash が既に載っている場合
   * （pending → included で同じ tx が複数回 applyTransaction される）も
   * 重複追加しない。返り値は適用した差分イベント。
   */
  linkTransactionToWallets(tx: TransactionEntity): DiffEvent[] {
    const candidateAddresses = new Set(
      [tx.from, tx.to]
        .filter((address): address is string => typeof address === "string" && address.length > 0)
        .map((address) => address.toLowerCase()),
    );
    if (candidateAddresses.size === 0) return [];

    const events: DiffEvent[] = [];
    for (const entity of this.entities.values()) {
      if (entity.kind !== "wallet") continue;
      if (!candidateAddresses.has(entity.address.toLowerCase())) continue;
      if (entity.recentTxHashes.includes(tx.hash)) continue;

      const recentTxHashes = [tx.hash, ...entity.recentTxHashes].slice(
        0,
        MAX_WALLET_RECENT_TX_HASHES,
      );
      const after: WalletEntity = { ...entity, recentTxHashes };
      const diff = computeDiff([entity], [after]);
      for (const event of diff) this.applyEvent(event);
      events.push(...diff);
    }
    if (events.length > 0) this.timestamp = Date.now();
    return events;
  }

  /**
   * C 層（新 Phase 4）のコントラクトのデプロイ検知・内容更新（ContractEntity）を
   * 取り込む。コントラクトはアドレスをキーとするエンティティなので、既存の
   * 同一アドレスとの差分だけを計算する（「未知」→カタログ照合済みへの更新は
   * entityUpdated として出る）。返り値は適用した差分イベント。
   */
  applyContract(contract: ContractEntity): DiffEvent[] {
    return this.applyKeyed(contract);
  }

  /**
   * 安定キー（block/transaction はハッシュ、contract はアドレス。entityId
   * 参照）を持つ単一エンティティを取り込む共通処理。既存の同一キーの
   * エンティティとだけ差分を取り、他のエンティティやエッジには触れない。
   */
  private applyKeyed(
    entity: BlockEntity | TransactionEntity | ContractEntity,
  ): DiffEvent[] {
    const existing = this.entities.get(entityId(entity));
    const prev = existing ? [existing] : [];
    const diff = computeDiff(prev, [entity]);
    for (const event of diff) this.applyEvent(event);
    this.timestamp = Date.now();
    return diff;
  }

  /**
   * C 層のウォレット観測（WalletObservation の集合）を取り込む。差分は wallet
   * エンティティだけを対象にし、他層のエンティティは触らない。観測に現れなく
   * なったウォレットは削除せず ownerWorkbenchId を null にして残す（CONCEPT.md
   * の決定。computeWalletDiff 参照）。返り値は適用した差分イベント。
   */
  applyWallets(observed: WalletObservation[]): DiffEvent[] {
    const prevWallets = [...this.entities.values()].filter(
      (e): e is WalletEntity => e.kind === "wallet",
    );
    const diff = computeWalletDiff(prevWallets, observed, this.chainType);
    for (const event of diff) this.applyEvent(event);
    this.timestamp = Date.now();
    return diff;
  }

  /**
   * D層: ノード内部の観測状態（NodeInternals）を既存の NodeEntity へ
   * `internals` フィールドのパッチとして反映する（docs/ARCHITECTURE.md
   * §7.3）。node/workbench の追加・削除は A 層（applyInfra）だけが担うため、
   * ここでは新規追加は行わない。対象ノードが store に存在しない（削除済み・
   * addNode 直後で A 層のポーリングをまだ経ていない等）観測は、具体的な
   * ノード id をログに残したうえで捨てる（CLAUDE.md「エラーを握りつぶす
   * コードを見逃さない」）。返り値は適用した差分イベント。
   */
  applyNodeInternals(nodeId: string, internals: NodeInternals): DiffEvent[] {
    const existing = this.entities.get(nodeId);
    if (!existing || existing.kind !== "node") {
      console.error(
        `[world-state] applyNodeInternals: node ${nodeId} not found; dropping node internals observation`,
      );
      return [];
    }
    const after: NodeEntity = { ...existing, internals };
    const diff = computeDiff([existing], [after]);
    for (const event of diff) this.applyEvent(event);
    this.timestamp = Date.now();
    return diff;
  }

  /**
   * 指定 IP を持つワークベンチエンティティを返す（無ければ undefined）。
   * ロギングプロキシが観測した呼び出し元 IP（RpcObservation.callerIp）を
   * ワークベンチのエンティティ id へ解決するために使う（Issue #80）。
   */
  findWorkbenchByIp(ip: string): WorkbenchEntity | undefined {
    for (const entity of this.entities.values()) {
      if (entity.kind === "workbench" && entity.ip === ip) return entity;
    }
    return undefined;
  }

  /**
   * 指定 IP を持つノードエンティティを返す（無ければ undefined）。
   * ロギングプロキシの転送先（CHAINVIZ_PROXY_TARGET のホスト）を、その IP を
   * 持つノードのエンティティ id へ解決するために使う（Issue #80）。
   */
  findNodeByIp(ip: string): NodeEntity | undefined {
    for (const entity of this.entities.values()) {
      if (entity.kind === "node" && entity.ip === ip) return entity;
    }
    return undefined;
  }

  private applyEvent(event: DiffEvent): void {
    switch (event.type) {
      case "entityAdded":
        this.entities.set(entityId(event.entity), event.entity);
        break;
      case "entityUpdated": {
        const existing = this.entities.get(event.id);
        if (existing) {
          this.entities.set(event.id, {
            ...existing,
            ...event.patch,
          } as WorldStateEntity);
        }
        break;
      }
      case "entityRemoved":
        this.entities.delete(event.id);
        break;
      case "edgeAdded": {
        const key = edgeKey(event.edge);
        if (!this.edges.some((e) => edgeKey(e) === key)) {
          this.edges = [...this.edges, event.edge];
        }
        break;
      }
      case "edgeRemoved":
        this.edges = this.edges.filter(
          (e) =>
            !(
              e.fromNodeId === event.fromNodeId &&
              e.toNodeId === event.toNodeId &&
              e.networkId === event.networkId
            ),
        );
        break;
      case "operationObserved":
        // 揮発性の観測イベント。RPC 呼び出しは「観測された瞬間の出来事」であり
        // 永続的な接続状態ではないため、store の状態には畳み込まない
        // （スナップショットにも含めない）。broadcastDiff で passthrough 配信
        // されるだけで、ここでは意図的に何もしない（Issue #80）。
        break;
    }
  }
}
