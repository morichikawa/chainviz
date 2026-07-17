import { describe, expect, it, vi } from "vitest";
import type { ContractCatalog } from "./catalog.js";
import { ContractTracker } from "./contracts.js";

const catalog: ContractCatalog = {
  ChainvizToken: {
    name: "ChainvizToken",
    abi: [],
    token: { symbol: "CVZ", decimals: 18 },
  },
  Counter: { name: "Counter", abi: [] },
};

describe("ContractTracker.recordDeployment", () => {
  it("returns an unknown-contract entity (address only) when there is no catalog match", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    const entity = tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(entity).toEqual({
      kind: "contract",
      address: "0xnew",
      chainType: "ethereum",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
  });

  it("returns null (does not re-emit) for a duplicate notification of the same address", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    const second = tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(second).toBeNull();
  });

  it("applies a pending catalog key registered before the deployment was detected", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    // deployContract 経由: コマンド処理側が先に登録する想定。
    expect(tracker.registerDeployment("0xnew", "ChainvizToken")).toBeNull();

    const entity = tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(entity).toEqual({
      kind: "contract",
      address: "0xnew",
      chainType: "ethereum",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
      name: "ChainvizToken",
      catalogKey: "ChainvizToken",
      token: { symbol: "CVZ", decimals: 18 },
    });
  });

  it("omits token for a cataloged contract without token metadata", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.registerDeployment("0xctr", "Counter");
    const entity = tracker.recordDeployment({
      address: "0xctr",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx2",
    });
    expect(entity?.name).toBe("Counter");
    expect(entity?.token).toBeUndefined();
  });

  it("applies the most recent pending key when registerDeployment is called twice before detection", () => {
    // 検知前に同じアドレスへ 2 回登録した場合（例: 誤操作で別コントラクトの
    // キーを重ねて登録）、最後に登録したキーが適用される（後勝ち）。
    const tracker = new ContractTracker("ethereum", catalog);
    expect(tracker.registerDeployment("0xnew", "Counter")).toBeNull();
    expect(tracker.registerDeployment("0xnew", "ChainvizToken")).toBeNull();

    const entity = tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(entity?.catalogKey).toBe("ChainvizToken");
    expect(entity?.name).toBe("ChainvizToken");
  });

  it("returns null on a duplicate recordDeployment even after a pending key was applied", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.registerDeployment("0xnew", "ChainvizToken");
    const first = tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(first?.catalogKey).toBe("ChainvizToken");

    const second = tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(second).toBeNull();
    // 追跡中の状態は初回のカタログ適用済みエンティティのまま。
    expect(tracker.get("0xnew")?.catalogKey).toBe("ChainvizToken");
  });

  it("consumes the pending key so a later duplicate deployment stays unaffected", () => {
    // pendingCatalogKeys は適用時に delete される。別アドレスの登録が
    // 混ざっても取り違えないことを確認する。
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.registerDeployment("0xaaa", "ChainvizToken");
    tracker.registerDeployment("0xbbb", "Counter");

    const a = tracker.recordDeployment({
      address: "0xaaa",
      deployerAddress: "0xd",
      createdByTxHash: "0xt",
    });
    const b = tracker.recordDeployment({
      address: "0xbbb",
      deployerAddress: "0xd",
      createdByTxHash: "0xt",
    });
    expect(a?.catalogKey).toBe("ChainvizToken");
    expect(b?.catalogKey).toBe("Counter");
  });
});

describe("ContractTracker.registerDeployment (after detection)", () => {
  it("updates an already-tracked unknown contract in place and returns the updated entity", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });

    const updated = tracker.registerDeployment("0xnew", "ChainvizToken");
    expect(updated).toEqual({
      kind: "contract",
      address: "0xnew",
      chainType: "ethereum",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
      name: "ChainvizToken",
      catalogKey: "ChainvizToken",
      token: { symbol: "CVZ", decimals: 18 },
    });
    expect(tracker.get("0xnew")).toEqual(updated);
  });

  it("returns null when re-registering the same catalog key (no change)", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    tracker.registerDeployment("0xnew", "ChainvizToken");
    expect(tracker.registerDeployment("0xnew", "ChainvizToken")).toBeNull();
  });

  it("ignores and logs a warning for an unknown catalog key", () => {
    const log = vi.fn();
    const tracker = new ContractTracker("ethereum", catalog, log);
    const result = tracker.registerDeployment("0xnew", "NoSuchContract");
    expect(result).toBeNull();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('unknown catalog key "NoSuchContract"'),
    );
    // ペンディング登録もされないので、後で検知されても未知のまま。
    const entity = tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(entity?.name).toBeUndefined();
  });

  it("does nothing when there is no catalog at all (catalog load failed at startup)", () => {
    const log = vi.fn();
    const tracker = new ContractTracker("ethereum", undefined, log);
    expect(tracker.registerDeployment("0xnew", "ChainvizToken")).toBeNull();
    expect(log).toHaveBeenCalled();
    const entity = tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(entity?.name).toBeUndefined();
  });

  it("re-catalogs an already-cataloged contract when registered with a different key", () => {
    // 一度カタログ照合済みのコントラクトを別のキーで再登録した場合、name /
    // catalogKey はその場で新しいカタログ情報に差し替わる（entityUpdated 相当を
    // 返す）。誤登録の訂正など、めったに起きない経路の現状を固定する。
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    tracker.registerDeployment("0xnew", "ChainvizToken");

    const updated = tracker.registerDeployment("0xnew", "Counter");
    expect(updated?.catalogKey).toBe("Counter");
    expect(updated?.name).toBe("Counter");
    expect(tracker.get("0xnew")?.catalogKey).toBe("Counter");
    // 既知の限界（報告済み）: applyCatalog は既存エンティティへスプレッドで
    // 上書きするだけなので、トークン付き（ChainvizToken）からトークン無し
    // （Counter）へ切り替えても、前回の token フィールドが残留する。トークン
    // 付きコントラクトを別のトークン無しコントラクトのキーで再登録するのは
    // 通常運用では発生しない経路のため、現状の挙動をそのまま固定する。
    expect(updated?.token).toEqual({ symbol: "CVZ", decimals: 18 });
  });

  it("ignores and logs an empty-string catalog key", () => {
    // 空文字キーはカタログに存在しないため、unknown key と同じ縮退経路を通る
    // （pending 登録もされない）。
    const log = vi.fn();
    const tracker = new ContractTracker("ethereum", catalog, log);
    expect(tracker.registerDeployment("0xnew", "")).toBeNull();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("unknown catalog key"),
    );
    const entity = tracker.recordDeployment({
      address: "0xnew",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(entity?.name).toBeUndefined();
  });
});

describe("ContractTracker.get", () => {
  it("returns undefined for an address that has not been recorded", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    expect(tracker.get("0xabsent")).toBeUndefined();
  });
});

describe("ContractTracker.getCatalogEntry (Issue #162)", () => {
  it("returns the CatalogEntry (with ABI) for a cataloged, tracked contract", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.registerDeployment("0xtoken", "ChainvizToken");
    tracker.recordDeployment({
      address: "0xtoken",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(tracker.getCatalogEntry("0xtoken")).toBe(catalog.ChainvizToken);
  });

  it("normalizes address casing the same way as get()", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.registerDeployment("0xABCDEF", "Counter");
    tracker.recordDeployment({
      address: "0xabcdef",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(tracker.getCatalogEntry("0xABCDEF")).toBe(catalog.Counter);
  });

  it("returns undefined for an untracked address", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    expect(tracker.getCatalogEntry("0xabsent")).toBeUndefined();
  });

  it("returns undefined for a tracked but uncataloged (unknown) contract", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.recordDeployment({
      address: "0xunknown",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(tracker.getCatalogEntry("0xunknown")).toBeUndefined();
  });

  it("returns undefined when there is no catalog at all (catalog load failed at startup)", () => {
    const tracker = new ContractTracker("ethereum", undefined);
    tracker.recordDeployment({
      address: "0xtoken",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(tracker.getCatalogEntry("0xtoken")).toBeUndefined();
  });
});

describe("ContractTracker.tokenContractAddresses (Issue #164)", () => {
  it("returns an empty array when nothing has been deployed", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    expect(tracker.tokenContractAddresses()).toEqual([]);
  });

  it("excludes tracked contracts without token metadata (e.g. Counter)", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.registerDeployment("0xctr", "Counter");
    tracker.recordDeployment({
      address: "0xctr",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(tracker.tokenContractAddresses()).toEqual([]);
  });

  it("excludes untracked / uncataloged (unknown) contracts", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.recordDeployment({
      address: "0xunknown",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(tracker.tokenContractAddresses()).toEqual([]);
  });

  it("includes a deployed, cataloged token contract's normalized address", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.registerDeployment("0xTOKEN", "ChainvizToken");
    tracker.recordDeployment({
      address: "0xTOKEN",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(tracker.tokenContractAddresses()).toEqual(["0xtoken"]);
  });

  it("includes multiple token contracts and excludes non-token ones from the same call", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.registerDeployment("0xtoken1", "ChainvizToken");
    tracker.recordDeployment({
      address: "0xtoken1",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    tracker.registerDeployment("0xctr", "Counter");
    tracker.recordDeployment({
      address: "0xctr",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx2",
    });
    expect(tracker.tokenContractAddresses()).toEqual(["0xtoken1"]);
  });

  it("does not yet include a token contract whose catalog key is only pending (not yet applied)", () => {
    // registerDeployment がデプロイ検知前に呼ばれた場合、pendingCatalogKeys に
    // 積まれるだけで recordDeployment 前は追跡マップに存在しない。
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.registerDeployment("0xtoken", "ChainvizToken");
    expect(tracker.tokenContractAddresses()).toEqual([]);
  });
});

describe("ContractTracker address casing normalization (Issue #161 review follow-up)", () => {
  // 実測（reth + foundry, chainviz-reviewer 2026-07-07）: forge create の
  // "Deployed to:" 行は EIP-55 チェックサム表記（大小混在）、reth の
  // eth_getBlockReceipts の contractAddress は全小文字。同一コントラクトの
  // はずのこの2つの表記が食い違うと、GUI からの deployContract
  // （registerDeployment 経由・チェックサム表記）とブロック取り込みの検知
  // （recordDeployment 経由・小文字表記）が別アドレスとして扱われ、
  // catalogKey が反映されない。
  const checksummed = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  const lowercased = "0x5fbdb2315678afecb367f032d93f642f64180aa3";

  it("applies a catalog key registered with checksummed casing to a deployment detected with lowercase casing", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    expect(tracker.registerDeployment(checksummed, "ChainvizToken")).toBeNull();

    const entity = tracker.recordDeployment({
      address: lowercased,
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(entity).toEqual({
      kind: "contract",
      address: lowercased,
      chainType: "ethereum",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
      name: "ChainvizToken",
      catalogKey: "ChainvizToken",
      token: { symbol: "CVZ", decimals: 18 },
    });
    // 同一コントラクトとして 1 件だけ追跡されている（casing 違いで別アドレス
    // として二重登録されていない）。
    expect(tracker.get(checksummed)?.catalogKey).toBe("ChainvizToken");
    expect(tracker.get(lowercased)?.catalogKey).toBe("ChainvizToken");
  });

  it("applies a catalog key registered with lowercase casing to a deployment already detected with checksummed casing", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.recordDeployment({
      address: checksummed,
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });

    const updated = tracker.registerDeployment(lowercased, "ChainvizToken");
    expect(updated?.address).toBe(lowercased);
    expect(updated?.catalogKey).toBe("ChainvizToken");
    expect(tracker.get(checksummed)).toEqual(updated);
  });

  it("get() normalizes casing so a checksummed lookup finds an entry recorded with lowercase casing", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.recordDeployment({
      address: lowercased,
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(tracker.get(checksummed)).toEqual(tracker.get(lowercased));
  });
});

describe("ContractTracker.reset (Issue #357)", () => {
  it("forgets previously tracked contracts", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.recordDeployment({
      address: "0xabc",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(tracker.get("0xabc")).toBeDefined();

    tracker.reset();

    expect(tracker.get("0xabc")).toBeUndefined();
  });

  it("forgets pending catalog key registrations (registerDeployment before recordDeployment)", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    // まだデプロイを検知していないアドレスに先にカタログキーを登録する
    // （registerDeployment のコメント参照。pendingCatalogKeys に保留される）。
    tracker.registerDeployment("0xabc", "ChainvizToken");

    tracker.reset();

    // reset 後に同じアドレスのデプロイを検知しても、パージ前の保留登録が
    // 残っていれば「未知のコントラクト」ではなくカタログ照合済みで現れて
    // しまう。reset 後は「未知のコントラクト」として現れることを確認する。
    const entity = tracker.recordDeployment({
      address: "0xabc",
      deployerAddress: "0xdeployer",
      createdByTxHash: "0xtx1",
    });
    expect(entity?.catalogKey).toBeUndefined();
  });

  it("allows a fresh chain to redeploy at the same address after reset", () => {
    const tracker = new ContractTracker("ethereum", catalog);
    tracker.recordDeployment({
      address: "0xabc",
      deployerAddress: "0xold-deployer",
      createdByTxHash: "0xold-tx",
    });

    tracker.reset();

    // reset 前は同一アドレスの再デプロイは無視される（recordDeployment の
    // 「既に追跡済みなら null」仕様）。reset 後は新規デプロイとして受理
    // されることを確認する（新チェーンでの再デプロイを表す）。
    const entity = tracker.recordDeployment({
      address: "0xabc",
      deployerAddress: "0xnew-deployer",
      createdByTxHash: "0xnew-tx",
    });
    expect(entity?.deployerAddress).toBe("0xnew-deployer");
  });
});
